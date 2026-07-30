#!/usr/bin/env node
// Compares the tool names documented in the Parent Protocol skill against
// the tools actually registered by the MCP server.
//
// Why this exists: the protocol's own rule is "Never invent a base name — if
// it isn't in the table, it doesn't exist." That rule is only trustworthy if
// the table is true. On 2026-07-30 the table listed 27 names against an
// 89-tool registry, and 4 of those 27 were not registered anywhere, so an
// orchestrator following the protocol would call tools that do not exist.
//
// Two distinct checks, deliberately not the same severity:
//
//   PHANTOM (hard failure)
//     A name documented in the protocol that the server does not register.
//     This is always a defect: it sends the orchestrator at a tool that will
//     never answer.
//
//   UNDOCUMENTED (reported; failure only under --strict-coverage)
//     A registered tool the protocol does not mention. The table is curated
//     prose — "when to use this" is human judgement that cannot be generated
//     — so partial coverage is a legitimate editorial choice. What is NOT
//     legitimate is coverage drifting silently, so the gap must be declared
//     in the allowlist below and the count is printed on every run.

import { readFileSync, existsSync } from "node:fs";

const SERVER = "src/mcp-server.ts";
const PROTOCOL = "skills-bundle/idu-pi-parent-protocol/SKILL.md";

// Registered tools the protocol intentionally does not document. Adding a
// name here is a decision ("the orchestrator should not reach for this"),
// not a way to silence the check. Keep it sorted.
const INTENTIONALLY_UNDOCUMENTED = new Set([]);

// Names the protocol mentions ON PURPOSE as things that do NOT exist — its
// "never invent a tool name" section teaches by counter-example:
//
//   "No `idu_project_list` exists"
//   "❌ Inventing tool names like `idu_status_check`, `idu_get_context`"
//
// A naive scan reads those as prescriptions and reports the protocol as
// broken for being correct. So they are declared here — and the declaration
// is load-bearing in BOTH directions: if any of these ever becomes a real
// registered tool, the protocol's warning turns into a lie and this script
// fails. That is the reverse check below. Keep it sorted.
const DOCUMENTED_AS_NONEXISTENT = new Set([
	"idu_get_context",
	"idu_project_list",
	"idu_status_check",
]);

// Matches the registration call in both its single-line and wrapped forms:
//   tool("idu_status", "...", {
//   tool(
//     "idu_status",
const REGISTRATION = /\btool\(\s*["'`](idu_[a-z0-9_]+)["'`]/g;
// Any base name mentioned in the protocol, including the harness-prefixed
// spellings (mcp__idu-pi__idu_status, idu-pi_idu_status) which both end in
// the base name.
const MENTION = /idu_[a-z0-9_]+/g;

function read(path) {
	if (!existsSync(path)) {
		console.error(`[protocol-drift] missing file: ${path}`);
		process.exit(2);
	}
	return readFileSync(path, "utf8");
}

function uniqueSorted(values) {
	return [...new Set(values)].sort();
}

const strictCoverage = process.argv.includes("--strict-coverage");

const registered = uniqueSorted(
	[...read(SERVER).matchAll(REGISTRATION)].map((m) => m[1]),
);
const documented = uniqueSorted(
	[...read(PROTOCOL).matchAll(MENTION)].map((m) => m[0]),
);

if (registered.length === 0) {
	// The parser found nothing, which means the registration shape changed.
	// Reporting "0 phantoms, all good" here would be the worst outcome: a
	// green check that verifies nothing. Fail loudly instead.
	console.error(
		`[protocol-drift] parsed 0 tool registrations from ${SERVER}. ` +
			`The registration pattern likely changed — fix REGISTRATION in this ` +
			`script rather than trusting a vacuous pass.`,
	);
	process.exit(2);
}

const registeredSet = new Set(registered);
const documentedSet = new Set(documented);

const phantom = documented.filter(
	(name) => !registeredSet.has(name) && !DOCUMENTED_AS_NONEXISTENT.has(name),
);
// Reverse check: a counter-example that became real. The protocol would then
// be actively teaching that an existing tool does not exist.
const resurrected = [...DOCUMENTED_AS_NONEXISTENT].filter((name) =>
	registeredSet.has(name),
);
const undocumented = registered.filter(
	(name) => !documentedSet.has(name) && !INTENTIONALLY_UNDOCUMENTED.has(name),
);
const staleAllowlist = [...INTENTIONALLY_UNDOCUMENTED].filter(
	(name) => !registeredSet.has(name),
);

console.log(
	`[protocol-drift] registered: ${registered.length} | documented: ${documented.length} | ` +
		`phantom: ${phantom.length} | undocumented: ${undocumented.length}`,
);

if (staleAllowlist.length > 0) {
	console.log(
		`[protocol-drift] allowlist entries no longer registered (remove them): ${staleAllowlist.join(", ")}`,
	);
}

if (undocumented.length > 0) {
	console.log(
		`[protocol-drift] registered but not in the protocol table:\n  ${undocumented.join("\n  ")}`,
	);
}

let failed = false;

if (phantom.length > 0) {
	console.error(
		`\n[protocol-drift] FAIL: ${phantom.length} documented tool(s) are not registered by the server.\n` +
			`An orchestrator following the protocol would call these and get nothing:\n  ${phantom.join("\n  ")}\n` +
			`Fix the protocol table (rename or remove), or register the tool.`,
	);
	failed = true;
}

if (resurrected.length > 0) {
	console.error(
		`\n[protocol-drift] FAIL: ${resurrected.length} tool(s) are registered but the protocol ` +
			`teaches they do not exist:\n  ${resurrected.join("\n  ")}\n` +
			`Remove them from DOCUMENTED_AS_NONEXISTENT and document them properly.`,
	);
	failed = true;
}

if (strictCoverage && undocumented.length > 0) {
	console.error(
		`\n[protocol-drift] FAIL (--strict-coverage): ${undocumented.length} registered tool(s) are undocumented.\n` +
			`Document them, or declare them in INTENTIONALLY_UNDOCUMENTED with the reason.`,
	);
	failed = true;
}

process.exit(failed ? 1 : 0);
