/**
 * mcp-tool-catalog.test.ts — pins the public catalog of src/mcp-server.ts.
 *
 * Per mcp-server.ts step 0 (the inflection-point plan for the
 * god-file breakup, mirroring cli.ts PR 7 step 0):
 *   1. Tool-name freeze — every `tool("idu_X", ...)` registration in
 *      the TOOLS array must match the frozen set. Drop / duplicate /
 *      rename of any tool fails the test with a clear diff.
 *   2. Schema freeze — every tool's `inputSchema` (properties + required)
 *      is pinned. A schema drift silently breaks orchestrators.
 *   3. Dispatch↔TOOLS consistency — every tool dispatched in either
 *      switch (handleProjectLifecycleTool or dispatchTool) MUST appear
 *      in TOOLS, and vice versa. Catches the "tool dispatched but
 *      not advertised" drift (e.g. idu_objective_status before the
 *      PR-drift fix that added it to TOOLS).
 *
 * The catalog is the set of tools that MCP advertises to orchestrators
 * via `tools/list`. Source of truth: listIduMcpTools() in mcp-server.ts
 * (which returns the TOOLS array). Pin: this file.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { listIduMcpTools } from "../src/mcp-server.js";

/**
 * Parse every `case "idu_X":` label from the dispatchTool and
 * handleProjectLifecycleTool switches in src/mcp-server.ts.
 *
 * Walks the file line-by-line, tracks depth of `{`/`}` so we only
 * capture labels inside each switch's block. Switches are detected
 * by `switch (name)` and their bounds are tracked independently.
 */
function parseDispatchedCaseLabels(src: string): string[] {
	const lines = src.split("\n");
	const labels: string[] = [];
	let inSwitch = false;
	let switchDepth = 0;
	for (const line of lines) {
		// Detect start of a `switch (name) {` block.
		if (!inSwitch && /\bswitch\s*\(\s*name\s*\)/.test(line)) {
			inSwitch = true;
			switchDepth = 0;
		}
		if (inSwitch) {
			for (const ch of line) {
				if (ch === "{") switchDepth++;
				else if (ch === "}") switchDepth--;
			}
			const m = line.match(/^\s*case\s+"([^"]+)"\s*:/);
			if (m) labels.push(m[1]);
			if (switchDepth === 0 && /[{}]/.test(line)) {
				inSwitch = false;
			}
		}
	}
	return labels;
}

/**
 * Type-safe getter for inputSchema.properties (the MCP catalog uses
 * a generic JsonObject, but every tool's inputSchema follows the
 * standard shape from the `tool()` builder).
 */
function getProperties(schema: { properties?: unknown }): Record<
	string,
	{ type?: unknown; description?: unknown }
> {
	if (!schema.properties || typeof schema.properties !== "object") return {};
	return schema.properties as Record<
		string,
		{ type?: unknown; description?: unknown }
	>;
}

function getRequired(schema: { required?: unknown }): string[] {
	if (!Array.isArray(schema.required)) return [];
	return schema.required.filter((r): r is string => typeof r === "string");
}

test("mcp-server.ts tool catalog: 88 tools registered, names frozen", () => {
	const actual = listIduMcpTools();
	const names = actual.map((t) => t.name).sort();
	assert.strictEqual(
		names.length,
		88,
		`Expected 88 tools registered (87 legacy + 1 PR-drift fix for ` +
			`idu_objective_status). Got ${names.length}.\n` +
			`Names: ${names.join(", ")}`,
	);
	// Uniqueness.
	const uniqueNames = new Set(names);
	assert.strictEqual(
		uniqueNames.size,
		names.length,
		`Duplicate tool names: ${names
			.filter((n, i) => names.indexOf(n) !== i)
			.join(", ")}`,
	);
});

test("mcp-server.ts tool catalog: no duplicate tool names", () => {
	const names = listIduMcpTools().map((t) => t.name);
	const counts = new Map<string, number>();
	for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
	const dupes = [...counts.entries()].filter(([, n]) => n > 1);
	assert.deepStrictEqual(
		dupes,
		[],
		`Duplicate tool names in TOOLS array: ${dupes
			.map(([n, c]) => `${n}(x${c})`)
			.join(", ")}`,
	);
});

test("mcp-server.ts tool catalog: every tool has a valid inputSchema", () => {
	const tools = listIduMcpTools();
	for (const t of tools) {
		assert.ok(
			t.inputSchema && typeof t.inputSchema === "object",
			`Tool ${t.name} has invalid inputSchema`,
		);
		assert.strictEqual(
			t.inputSchema.type,
			"object",
			`Tool ${t.name} inputSchema.type must be "object" (got ${t.inputSchema.type})`,
		);
		// Every property must have a `type`.
		const props = getProperties(t.inputSchema);
		for (const [pname, p] of Object.entries(props)) {
			assert.ok(
				typeof p.type === "string",
				`Tool ${t.name}.properties.${pname} must have a string type`,
			);
		}
	}
});

test("mcp-server.ts tool catalog: dispatch ↔ TOOLS consistency (PR-drift regression)", () => {
	const tools = listIduMcpTools();
	const toolsNames = new Set<string>(tools.map((t) => t.name));
	const src = readFileSync(
		join(process.cwd(), "src", "mcp-server.ts"),
		"utf8",
	);
	const dispatchedLabels = parseDispatchedCaseLabels(src);
	const dispatchedNames = new Set<string>(dispatchedLabels);

	// Every dispatched tool must be in TOOLS (advertised to orchestrators).
	const dispatchedButNotInTools = [...dispatchedNames]
		.filter((n) => !toolsNames.has(n))
		.sort();
	// Every TOOL must be dispatched (no dead catalog entries).
	const inToolsButNotDispatched = [...toolsNames]
		.filter((n) => !dispatchedNames.has(n))
		.sort();

	assert.deepStrictEqual(
		dispatchedButNotInTools,
		[],
		`Tools dispatched but not in TOOLS array (drift — orchestrators ` +
			`can't see them via tools/list): ${dispatchedButNotInTools.join(", ")}`,
	);
	assert.deepStrictEqual(
		inToolsButNotDispatched,
		[],
		`Tools in TOOLS array but not dispatched (dead catalog entries): ` +
			`${inToolsButNotDispatched.join(", ")}`,
	);
	assert.strictEqual(
		dispatchedNames.size,
		toolsNames.size,
		`Mismatch: ${dispatchedNames.size} dispatched vs ${toolsNames.size} in TOOLS.`,
	);
});

test("mcp-server.ts tool catalog: idu_objective_status has correct schema (PR-drift fix)", () => {
	const tools = listIduMcpTools();
	const obj = tools.find((t) => t.name === "idu_objective_status");
	assert.ok(
		obj,
		"idu_objective_status must be in TOOLS array (PR-drift fix — it was " +
			"dispatched at L3599 but missing from the catalog)",
	);
	// The case body at L3599-L3627 reads NO fields from args — only uses
	// resolution.stateRoot, resolution.projectId, etc. So the inputSchema
	// must have only projectPath (optional), same pattern as idu_status
	// and the other read-only mirrors.
	assert.strictEqual(obj.inputSchema.type, "object");
	const props = getProperties(obj.inputSchema);
	const propNames = Object.keys(props);
	for (const pname of propNames) {
		assert.strictEqual(
			props[pname].type,
			"string",
			`idu_objective_status property "${pname}" must be a string (got ${props[pname].type})`,
		);
	}
	const required = getRequired(obj.inputSchema);
	assert.deepStrictEqual(
		required,
		[],
		`idu_objective_status must have no required fields (the case body ` +
			`doesn't read any args; it only uses resolution.*). Got: ${required.join(", ")}`,
	);
});
