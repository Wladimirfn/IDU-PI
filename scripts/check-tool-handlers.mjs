#!/usr/bin/env node
// scripts/check-tool-handlers.mjs
//
// Every tool the MCP server registers must also have a dispatch branch.
//
// Why this exists:
//   check-protocol-tool-drift.mjs compares the registry against the protocol
//   skill. It never looks at the dispatcher. A tool added to TOOLS without an
//   `if (name === ...)` branch is therefore listed to every client and answers
//   "Unknown tool" at runtime, which reads like a client mistake rather than a
//   server defect. Measured on a synthetic entry: it appears in tools/list and
//   the call returns isError with an unquoted "Unknown tool" message.
//
// What it checks:
//   registered (TOOLS `name:` entries) must equal handled (dispatch branches).
//   Both directions fail: a registered tool with no branch is dead on arrival,
//   and a branch for an unregistered tool is unreachable code.
//
// Testability:
//   TOOL_HANDLER_CHECK_SERVER overrides the source path, so the negative case
//   can be exercised against a temporary copy without touching the repo.

import { readFileSync } from "node:fs";

const SERVER = process.env.TOOL_HANDLER_CHECK_SERVER ?? "src/mcp-server.ts";
const source = readFileSync(SERVER, "utf8");

// Same registration shape the drift check parses: the `name:` key of a tool
// definition object. The idu_ prefix keeps it away from serverInfo.name.
const REGISTRATION = /^[ \t]*name:[ \t]*["'`](idu_[a-z0-9_]+)["'`]/gm;
const registered = [...new Set([...source.matchAll(REGISTRATION)].map((match) => match[1]))].sort();

// A branch may carry aliases on one line, e.g.
//   if (name === "idu_status" || name === "idu_project_status") {
// so every idu_ literal on a dispatch line counts as handled.
const handled = new Set();
for (const line of source.split(/\r?\n/)) {
	if (!/^[ \t]*if \(name ===/.test(line)) continue;
	for (const match of line.matchAll(/"(idu_[a-z0-9_]+)"/g)) handled.add(match[1]);
}
const handledNames = [...handled].sort();

if (registered.length === 0 || handledNames.length === 0) {
	console.error(
		`[tool-handlers] parsed 0 ${registered.length === 0 ? "registrations" : "dispatch branches"} from ${SERVER}. ` +
			`The source shape likely changed — fix this script rather than trusting a vacuous pass.`,
	);
	process.exit(2);
}

const unhandled = registered.filter((name) => !handled.has(name));
const orphanBranches = handledNames.filter((name) => !registered.includes(name));

console.log(
	`[tool-handlers] registered: ${registered.length} | handled: ${handledNames.length} | ` +
		`unhandled: ${unhandled.length} | orphan-branches: ${orphanBranches.length}`,
);

let failed = false;

if (unhandled.length > 0) {
	console.error(
		`\n[tool-handlers] FAIL: ${unhandled.length} registered tool(s) have no dispatch branch.\n` +
			`They are listed to clients and answer "Unknown tool" at runtime:\n  ${unhandled.join("\n  ")}\n` +
			`Add the branch, or remove the tool from TOOLS.`,
	);
	failed = true;
}

if (orphanBranches.length > 0) {
	console.error(
		`\n[tool-handlers] FAIL: ${orphanBranches.length} dispatch branch(es) name a tool that is not registered.\n` +
			`That code is unreachable:\n  ${orphanBranches.join("\n  ")}`,
	);
	failed = true;
}

process.exit(failed ? 1 : 0);
