#!/usr/bin/env node
// scripts/check-tool-handlers.mjs
//
// Every tool the MCP server registers must also be callable.
//
// Why this exists:
//   The dispatcher used to be a chain of `if (name === ...)` blocks. A tool
//   added to TOOLS without a branch was listed to every client and answered
//   "Unknown tool" at runtime, which reads like a client mistake rather than a
//   server defect. Nothing in CI caught it.
//
// What it checks:
//   TOOLS (what clients can see) against Object.keys(TOOL_HANDLERS) (what can
//   actually run), in both directions: a registered tool with no handler is
//   dead on arrival, and a handler for an unregistered name is unreachable.
//
// Why it imports the build:
//   Comparing the real exported values cannot drift from the source shape the
//   way a regex can. `corepack pnpm build` must run first; verify does.
//
// Why IDU_HOME is isolated:
//   Importing the modules creates the process-manager singleton, which calls
//   ensureIduDirectories(). Without isolation this gate would write into the
//   operator's real ~/.idu, the same leak class the test runner had.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isolatedHome = mkdtempSync(join(tmpdir(), "idu-tool-handler-check-"));
const previousHome = process.env.IDU_HOME;
process.env.IDU_HOME = isolatedHome;

let server;
let handlers;
try {
	server = await import(pathToFileURL(resolve("dist/src/mcp-server.js")).href);
	handlers = await import(pathToFileURL(resolve("dist/src/mcp-handlers.js")).href);
} catch (error) {
	console.error(`[tool-handlers] could not import the build: ${error?.message ?? error}`);
	console.error("[tool-handlers] run `corepack pnpm build` first.");
	if (previousHome === undefined) delete process.env.IDU_HOME;
	else process.env.IDU_HOME = previousHome;
	rmSync(isolatedHome, { recursive: true, force: true });
	process.exit(2);
} finally {
	if (previousHome === undefined) delete process.env.IDU_HOME;
	else process.env.IDU_HOME = previousHome;
	rmSync(isolatedHome, { recursive: true, force: true });
}

const registered = server.TOOLS.map((tool) => tool.name).sort();
const handled = Object.keys(handlers.TOOL_HANDLERS).sort();

if (registered.length === 0 || handled.length === 0) {
	console.error(
		`[tool-handlers] parsed 0 ${registered.length === 0 ? "registrations" : "handlers"}. ` +
			`That is a broken export, not a clean pass.`,
	);
	process.exit(2);
}

const unhandled = registered.filter((name) => !handled.includes(name));
const orphanHandlers = handled.filter((name) => !registered.includes(name));

console.log(
	`[tool-handlers] registered: ${registered.length} | handlers: ${handled.length} | ` +
		`unhandled: ${unhandled.length} | orphan-handlers: ${orphanHandlers.length}`,
);

let failed = false;

if (unhandled.length > 0) {
	console.error(
		`\n[tool-handlers] FAIL: ${unhandled.length} registered tool(s) have no handler.\n` +
			`They are listed to clients and fail at runtime:\n  ${unhandled.join("\n  ")}\n` +
			`Add the handler to TOOL_HANDLERS, or remove the tool from TOOLS.`,
	);
	failed = true;
}

if (orphanHandlers.length > 0) {
	console.error(
		`\n[tool-handlers] FAIL: ${orphanHandlers.length} handler(s) name a tool that is not registered.\n` +
			`That code is unreachable:\n  ${orphanHandlers.join("\n  ")}`,
	);
	failed = true;
}

process.exit(failed ? 1 : 0);
