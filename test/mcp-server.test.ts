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

