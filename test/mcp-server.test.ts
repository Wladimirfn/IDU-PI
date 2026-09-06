import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpMethod, TOOLS } from "../src/mcp-server.js";

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
