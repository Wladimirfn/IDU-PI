import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";

function resolution(stateRoot: string): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "mcp-supervisor-trigger-project",
		projectPath: join(stateRoot, "repo"),
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(stateRoot: string): CliRuntime {
	return {
		projectId: "mcp-supervisor-trigger-project",
		projectPath: join(stateRoot, "repo"),
		workspaceRoot: stateRoot,
		labDbPath: join(stateRoot, "lab.db"),
	} as unknown as CliRuntime;
}

test("idu_supervisor_trigger enable writes the trigger file and status returns formatted output", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-supervisor-trigger-"));
	try {
		const options = {
			projectResolver: () => resolution(stateRoot),
			runtimeFactory: () => runtime(stateRoot),
		};
		const enable = await callIduMcpTool(
			"idu_supervisor_trigger",
			{ action: "enable" },
			options,
		);

		assert.equal(enable.ok, true, enable.errors.join("\n"));
		assert.equal(enable.data.action, "enable");
		assert.match(String(enable.data.output), /state: enabled/u);
		const triggerPath = join(stateRoot, "supervisor-trigger.json");
		assert.equal(existsSync(triggerPath), true);
		assert.equal(JSON.parse(readFileSync(triggerPath, "utf8")).enabled, true);

		const status = await callIduMcpTool(
			"idu_supervisor_trigger",
			{ action: "status" },
			options,
		);
		assert.equal(status.ok, true, status.errors.join("\n"));
		assert.equal(status.data.action, "status");
		assert.match(String(status.data.output), /state: enabled/u);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("idu_supervisor_trigger rejects an invalid action", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-supervisor-trigger-invalid-"),
	);
	try {
		const result = await callIduMcpTool(
			"idu_supervisor_trigger",
			{ action: "bogus" },
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: () => runtime(stateRoot),
			},
		);

		assert.equal(result.ok, false);
		assert.match(result.errors.join("\n"), /enable, disable, status/u);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
