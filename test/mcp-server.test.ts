import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpMethod, TOOLS } from "../src/mcp-server.js";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { QUOTA_CACHE_PATH } from "../src/json-file.js";
import { writeCache } from "../src/quota.js";
import type { QuotaSnapshot } from "../src/types.js";

/**
 * A cache entry seeded by the MCP test below. The figures are the real ones
 * codex reported on 2026-10-01, so the assertion reads like a real reading
 * rather than a placeholder that would pass against any implementation.
 */
const CACHE_SEEDED_SNAPSHOT: QuotaSnapshot = {
	source: "codex",
	harness: "codex",
	billingModel: "plan",
	plan: "plus",
	meters: {
		"rate-limit": {
			id: "rate-limit",
			label: "Rate limit",
			windows: {
				"5h": { remainingPercent: 97, resetsAt: null, resetsInSeconds: null, windowSeconds: 18000 },
			},
		},
	},
	capturedAt: "2026-10-01T20:00:00.000Z",
	stale: false,
	unknownReason: null,
};

test("MCP tools/list is empty inside a delegated worker", async () => {
	process.env.IDU_WORKER = "true";
	try {
		const listed = (await handleMcpMethod("tools/list", undefined)) as {
			tools: Array<{ name: string }>;
		};
		assert.deepEqual(
			listed.tools,
			[],
			"a worker must not see any idu-pi tool, least of all idu_delegate",
		);
	} finally {
		delete process.env.IDU_WORKER;
	}
});

test("MCP tools/call is refused inside a worker even if a tool is named by hand", async () => {
	process.env.IDU_WORKER = "true";
	try {
		// tools/list is advisory. A client that cached the orchestrator's
		// catalogue can still name a tool, so the call itself must be refused.
		const result = (await handleMcpMethod("tools/call", {
			name: "idu_capabilities",
			arguments: {},
		})) as { isError: boolean; content: Array<{ text: string }> };

		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /not available inside a delegated worker/);
	} finally {
		delete process.env.IDU_WORKER;
	}
});

test("MCP idu_delegate cannot be called from a worker through the MCP path", async () => {
	process.env.IDU_WORKER = "true";
	try {
		const result = (await handleMcpMethod("tools/call", {
			name: "idu_delegate",
			arguments: { task: "should never run", profile: "cheap-explore" },
		})) as { isError: boolean };

		assert.equal(result.isError, true, "the MCP path must refuse delegation from a worker");
	} finally {
		delete process.env.IDU_WORKER;
	}
});

test("MCP tools/list is complete for the orchestrator", async () => {
	delete process.env.IDU_WORKER;
	const listed = (await handleMcpMethod("tools/list", undefined)) as {
		tools: Array<{ name: string }>;
	};
	assert.equal(listed.tools.length, TOOLS.length);
	assert.ok(listed.tools.some((t) => t.name === "idu_delegate"));
});

test("MCP server exposes exactly 13 tools", () => {
	assert.equal(TOOLS.length, 13);
	const names = TOOLS.map((t) => t.name);
	assert.ok(names.includes("idu_status"));
	assert.ok(names.includes("idu_preflight"));
	assert.ok(names.includes("idu_postflight"));
	assert.ok(names.includes("idu_decision_record"));
	assert.ok(names.includes("idu_decision_list"));
	assert.ok(names.includes("idu_delegate"));
	assert.ok(names.includes("idu_delegate_parallel"));
	assert.ok(names.includes("idu_worker_status"));
	assert.ok(names.includes("idu_worker_result"));
	assert.ok(names.includes("idu_worker_wait"));
	assert.ok(names.includes("idu_capabilities"));
	assert.ok(names.includes("idu_session_list"));
});

test("MCP initialize returns valid 2024-11-05 protocol", async () => {
	const res = (await handleMcpMethod("initialize", {})) as {
		protocolVersion: string;
		serverInfo: { name: string; version: string };
	};
	assert.equal(res.protocolVersion, "2024-11-05");
	assert.equal(res.serverInfo.name, "idu-cross-cli");
	assert.equal(res.serverInfo.version, "2.1.0");
});

test("MCP idu_status returns git and workspace health", async () => {
	const res = (await handleMcpMethod("tools/call", { name: "idu_status", arguments: {} })) as {
		content: Array<{ text: string }>;
	};
	assert.ok(res.content[0].text);
	const parsed = JSON.parse(res.content[0].text);
	assert.equal(parsed.ok, true);
	assert.ok(parsed.cwd);
	assert.ok(parsed.branch);
});

test("MCP idu_preflight evaluates change risk cleanly", async () => {
	const res = (await handleMcpMethod("tools/call", {
		name: "idu_preflight",
		arguments: { request: "Refactor core loop", change_mode: "refactor" },
	})) as { content: Array<{ text: string }> };
	const parsed = JSON.parse(res.content[0].text);
	assert.ok(parsed.risk);
	assert.ok(parsed.advisory);
	assert.equal(parsed.request, "Refactor core loop");
});

test("MCP idu_decision_record and idu_decision_list work dually", async () => {
	const recordRes = (await handleMcpMethod("tools/call", {
		name: "idu_decision_record",
		arguments: {
			project_id: "test-proj",
			decision: "Use lean MCP server",
			decided_by: "agent-test",
			target_kind: "architecture",
			target_id: "mcp-server",
			rationale: "Token optimization and simplicity",
		},
	})) as { content: Array<{ text: string }> };
	const recordParsed = JSON.parse(recordRes.content[0].text);
	assert.equal(recordParsed.ok, true);

	const listRes = (await handleMcpMethod("tools/call", {
		name: "idu_decision_list",
		arguments: { project_id: "test-proj", limit: 5 },
	})) as { content: Array<{ text: string }> };
	const listParsed = JSON.parse(listRes.content[0].text);
	assert.ok(Array.isArray(listParsed));
	assert.ok(listParsed.some((d: { decision: string }) => d.decision === "Use lean MCP server"));
});

test("MCP idu_session_list returns session array", async () => {
	const res = (await handleMcpMethod("tools/call", {
		name: "idu_session_list",
		arguments: {},
	})) as { content: Array<{ text: string }> };
	const list = JSON.parse(res.content[0].text);
	assert.ok(Array.isArray(list));
});

test("MCP schema validation rejects missing required arguments and invalid enums", async () => {
	// Missing required "request"
	const resMissing = (await handleMcpMethod("tools/call", {
		name: "idu_preflight",
		arguments: {},
	})) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(resMissing.isError, true);
	assert.ok(resMissing.content[0].text.includes("Missing required parameter: 'request'"));

	// Invalid enum value
	const resEnum = (await handleMcpMethod("tools/call", {
		name: "idu_preflight",
		arguments: { request: "Valid task", change_mode: "invalid_mode" },
	})) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(resEnum.isError, true);
	assert.ok(resEnum.content[0].text.includes("must be one of"));

	// Invalid argument type
	const resType = (await handleMcpMethod("tools/call", {
		name: "idu_delegate",
		arguments: { task: 12345, profile: "fast" },
	})) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(resType.isError, true);
	assert.ok(resType.content[0].text.includes("must be a string"));

	// Unknown parameter rejected (strict closed schema)
	const resUnknown = (await handleMcpMethod("tools/call", {
		name: "idu_status",
		arguments: { project_path: process.cwd(), bogus_param: "x" },
	})) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(resUnknown.isError, true);
	assert.ok(resUnknown.content[0].text.includes("Unknown parameter 'bogus_param'"));

	// Postflight missing required expected_files
	const resPostMissing = (await handleMcpMethod("tools/call", {
		name: "idu_postflight",
		arguments: { task_id: "test-task" },
	})) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(resPostMissing.isError, true);
	assert.ok(resPostMissing.content[0].text.includes("Missing required parameter: 'expected_files'"));
});

test("buildWorkerArgs enforces fail-closed permissions", async () => {
	const { buildWorkerArgs } = await import("../src/cmdline.js");
	const baseConfig = {
		version: "2.1.0",
		oneOrchestratorRule: { enabled: true, allowRecursiveDelegation: false },
		clis: {
			claude: { command: "claude", argsTemplate: [] },
			codex: { command: "codex", argsTemplate: [] },
		},
		defaultTimeoutMs: 300000,
		maxConcurrentWorkers: 4,
	};

	// 1. Missing or undefined permissions -> NO bypass
	const defaultProfile = { harness: "claude", model: "opus" };
	const res1 = buildWorkerArgs(defaultProfile, "Test task", [], baseConfig);
	assert.ok(!res1.args.includes("bypassPermissions"), "Undefined permissions must NOT bypass");

	// 2. Read-only permissions -> NO bypass
	const readOnlyProfile = { harness: "claude", model: "opus", permissions: "read-only" as const };
	const res2 = buildWorkerArgs(readOnlyProfile, "Test task", [], baseConfig);
	assert.ok(!res2.args.includes("bypassPermissions"), "Read-only permissions must NOT bypass");

	// 3. Typo in permissions -> NO bypass
	const typoProfile = { harness: "codex", permissions: "workspace-mode" as any };
	const res3 = buildWorkerArgs(typoProfile, "Test task", [], baseConfig);
	assert.ok(!res3.args.includes("--dangerously-bypass-approvals-and-sandbox"), "Typo must NOT bypass");

	// 4. Strict workspace permissions -> Bypasses allowed
	const wsProfile = { harness: "claude", permissions: "workspace" as const };
	const res4 = buildWorkerArgs(wsProfile, "Test task", [], baseConfig);
	assert.ok(res4.args.includes("bypassPermissions"), "Strict workspace must allow bypass");
});

test("Protocol Guard: SKILL.md documents exactly the 13 canonical tools with zero ghosts", async () => {
	const { readFileSync } = await import("node:fs");
	const { resolve } = await import("node:path");

	const skillPath = resolve(".pi/skills/idu-pi-parent-protocol/SKILL.md");
	const skillContent = readFileSync(skillPath, "utf8");

	// Every real tool must be present in the skill
	for (const tool of TOOLS) {
		assert.ok(
			skillContent.includes(`\`${tool.name}\``),
			`Canonical tool ${tool.name} must be documented in SKILL.md`,
		);
	}

	// Zero ghost tools: extract all `idu_*` mentions from the table
	const toolTableMatch = skillContent.match(/## Canonical Tool Catalog[\s\S]*?##/);
	assert.ok(toolTableMatch, "Canonical Tool Catalog section must exist");
	const tableText = toolTableMatch[0];
	const mentionedTools = Array.from(tableText.matchAll(/`idu_[a-z0-9_]+`/g)).map((m) => m[0].replace(/`/g, ""));
	const uniqueMentioned = Array.from(new Set(mentionedTools));

	assert.equal(uniqueMentioned.length, 13, `Expected exactly 13 unique tools in SKILL table, found: ${uniqueMentioned.length}`);

	// Verify byte identity across copies
	const agentsSkillPath = resolve(".agents/skills/idu-pi-parent-protocol/SKILL.md");
	const p1 = readFileSync(skillPath);
	const p2 = readFileSync(agentsSkillPath);
	assert.ok(p1.equals(p2), "Project-local SKILL.md copies must be byte-identical");
});

test("matchesExpectedFile precision and runPostflight records audit decision", async () => {
	const { matchesExpectedFile, runPostflight } = await import("../src/quality.js");
	const { listDecisions } = await import("../src/decision-ledger.js");

	// 1. Precision matches
	assert.equal(matchesExpectedFile("src/quality.ts", "src/quality.ts"), true);
	assert.equal(matchesExpectedFile("src/quality.ts", "quality.ts"), true);
	assert.equal(matchesExpectedFile("src/quality.ts", "src/"), true);
	assert.equal(matchesExpectedFile("src/mcp-server.ts", "src/quality.ts"), false);
	assert.equal(matchesExpectedFile("src", "src/quality.ts"), false);

	// 2. Postflight records audit in decision ledger
	const taskId = "test-postflight-audit-" + Date.now();
	const res = runPostflight({ taskId, expectedFiles: ["package.json"] });
	assert.ok(res.summary);

	const decisions = listDecisions({ limit: 5 });
	assert.ok(decisions.some((d) => d.targetId === taskId), "Postflight must record into decision ledger");

	// 3. Postflight with empty expectedFiles flags any observed changes as blast-radius violation
	const resEmpty = runPostflight({ taskId: "test-empty-expected", expectedFiles: [] });
	if (resEmpty.observedChangedCount > 0) {
		assert.equal(resEmpty.matchesIntent, false, "Empty expectedFiles with observed changes must fail intent");
		assert.equal(resEmpty.unexpectedFiles.length, resEmpty.observedChangedCount);
	}
});

test("parsePorcelainLine accurately extracts paths preserving fixed XY prefix", async () => {
	const { parsePorcelainLine } = await import("../src/quality.js");

	// Unstaged modification with leading space (Claude Opus repro case)
	assert.equal(parsePorcelainLine(" M a.txt"), "a.txt");
	assert.equal(parsePorcelainLine(" M src/quality.ts"), "src/quality.ts");

	// Staged modification
	assert.equal(parsePorcelainLine("M  src/mcp-server.ts"), "src/mcp-server.ts");

	// Untracked file
	assert.equal(parsePorcelainLine("?? new-file.ts"), "new-file.ts");

	// Rename: XY old -> new
	assert.equal(parsePorcelainLine("R  old-name.ts -> new-name.ts"), "new-name.ts");

	// Quoted paths
	assert.equal(parsePorcelainLine(' M "path with spaces/file.txt"'), "path with spaces/file.txt");

	// Empty or invalid lines
	assert.equal(parsePorcelainLine(""), null);
	assert.equal(parsePorcelainLine("   "), null);
});

test("MCP idu_delegate and idu_worker_wait descriptions mandate silent 540s wait and forbid --follow", () => {
	const delegateTool = TOOLS.find((t) => t.name === "idu_delegate");
	assert.ok(delegateTool, "idu_delegate must exist");
	const asyncProp = (delegateTool.inputSchema as any).properties.async;
	assert.ok(asyncProp.description.includes("--timeout 540000"), "idu_delegate async description must mention --timeout 540000");
	assert.ok(asyncProp.description.includes("do NOT use --follow"), "idu_delegate async description must forbid --follow");

	const waitTool = TOOLS.find((t) => t.name === "idu_worker_wait");
	assert.ok(waitTool, "idu_worker_wait must exist");
	assert.ok(waitTool.description.includes("--timeout 540000"), "idu_worker_wait description must mention --timeout 540000");
	assert.ok(!waitTool.description.includes("--follow"), "idu_worker_wait description must not suggest --follow");
});

test("Docs Guard: README profile table matches DEFAULT_PROFILES exactly (zero drift)", async () => {
	const { DEFAULT_PROFILES } = await import("../src/config.js");
	const { readFileSync } = await import("node:fs");
	const { resolve } = await import("node:path");

	const readme = readFileSync(resolve("README.md"), "utf8");
	const section = readme.match(/## Perfiles de Ejecución[\s\S]*?(?=\n## )/);
	assert.ok(section, "README must contain a '## Perfiles de Ejecución' section");

	const documented = Array.from(section![0].matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gim)).map((m) => m[1]);
	const actual = Object.keys(DEFAULT_PROFILES.profiles);

	assert.ok(documented.length > 0, "README profile table must list at least one profile");
	assert.deepEqual(
		[...documented].sort(),
		[...actual].sort(),
		`README profile table is out of sync with DEFAULT_PROFILES.\n  documented: ${documented.join(", ")}\n  in code:     ${actual.join(", ")}\nAdd or remove the profile in both places.`,
	);
});

test("Regression: idu preflight --cwd is honored and never swallowed into the request text", async () => {
	const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
	const { join, resolve } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	const cliPath = resolve("dist/src/cli.js");
	const repoRoot = resolve(".");

	// A throwaway git repo with exactly one untracked file.
	const target = mkdtempSync(join(tmpdir(), "idu-preflight-cwd-"));
	try {
		await execFileAsync("git", ["init", "-q"], { cwd: target });
		writeFileSync(join(target, "only-dirty-file.txt"), "dirty\n", "utf8");

		// Run from the repo root (a clean tree) but target the dirty temp repo.
		// Before the fix, --cwd was absorbed into the request string and the
		// audit silently ran against the repo root, reporting success anyway.
		const { stdout } = await execFileAsync(
			process.execPath,
			[cliPath, "preflight", "Tarea de prueba", "--cwd", target],
			{ cwd: repoRoot },
		);
		const parsed = JSON.parse(stdout);

		assert.ok(
			!parsed.request.includes("--cwd"),
			`--cwd must not leak into the request text (got: ${parsed.request})`,
		);
		assert.equal(parsed.request, "Tarea de prueba");
		assert.equal(
			parsed.uncommittedCount,
			1,
			"preflight must inspect the --cwd target, not the invoking directory",
		);
		assert.deepEqual(parsed.uncommittedFiles, ["?? only-dirty-file.txt"]);
	} finally {
		try { rmSync(target, { recursive: true, force: true }); } catch {}
	}
});

test("Regression: destructive preflight on a clean tree does not claim a phantom uncommitted set", async () => {
	const { runPreflight } = await import("../src/quality.js");
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	// git init is required: a bare temp dir would be absorbed by whatever
	// repository encloses it (git searches parent directories), and the
	// assertion below would then measure that repo instead of a clean tree.
	const scratch = mkdtempSync(join(tmpdir(), "idu-preflight-destructive-"));
	try {
		await execFileAsync("git", ["init", "-q"], { cwd: scratch });
		const res = runPreflight({ request: "Borrar cosas", changeMode: "destructive", cwd: scratch });
		assert.equal(res.risk, "high");
		assert.equal(res.uncommittedCount, 0);
		assert.ok(
			res.advisory.includes("destructive change mode"),
			`advisory must name the real cause; got: ${res.advisory}`,
		);
		assert.ok(
			!res.advisory.includes("(0 files)"),
			"advisory must not report a 0-file uncommitted set as a cause of high risk",
		);
	} finally {
		try { rmSync(scratch, { recursive: true, force: true }); } catch {}
	}
});

test("MCP idu_capabilities adds quota only when the orchestrator asks for it", async () => {
	const read = async (args: Record<string, unknown>) => {
		const res = (await handleMcpMethod("tools/call", {
			name: "idu_capabilities",
			arguments: args,
		})) as { isError?: boolean; content: Array<{ text: string }> };
		return { isError: res.isError === true, body: JSON.parse(res.content[0].text) as Record<string, unknown> };
	};

	// No argument at all. Two of the four sources spend a model call to answer,
	// so this must stay a cheap local read: no quota field, no probe.
	const bare = await read({});
	assert.ok(
		!("quota" in bare.body),
		"quota must be opt-in: probing is a deliberate act, not a side effect of looking at the catalogue",
	);

	// include_quota: true. The cache is seeded first so this asserts the MCP
	// plumbing without spending a live call or waiting on one.
	const hadCache = existsSync(QUOTA_CACHE_PATH);
	const previous = hadCache ? readFileSync(QUOTA_CACHE_PATH, "utf8") : null;
	try {
		writeCache(QUOTA_CACHE_PATH, [CACHE_SEEDED_SNAPSHOT], Date.now());

		const asked = await read({ include_quota: true });
		assert.equal(asked.isError, false);
		const quota = asked.body.quota as QuotaSnapshot[] | undefined;
		assert.ok(Array.isArray(quota), "include_quota: true must add the quota field");
		assert.equal(quota.length, 1);
		assert.equal(quota[0].source, "codex");
		assert.equal(quota[0].stale, true, "a cache reading must admit that it came from cache");
		assert.equal(quota[0].meters["rate-limit"]?.windows["5h"]?.remainingPercent, 97);
	} finally {
		if (previous === null) rmSync(QUOTA_CACHE_PATH, { force: true });
		else writeFileSync(QUOTA_CACHE_PATH, previous, "utf8");
	}
});

test("MCP idu_capabilities rejects a non-boolean include_quota", async () => {
	// An MCP client that stringifies its args must be told no, not silently
	// handed an off quota: "true" is not true, and truthiness would say yes.
	const res = (await handleMcpMethod("tools/call", {
		name: "idu_capabilities",
		arguments: { include_quota: "true" },
	})) as { isError: boolean; content: Array<{ text: string }> };

	assert.equal(res.isError, true);
	assert.match(res.content[0].text, /Schema validation failed for tool 'idu_capabilities'/);
});

