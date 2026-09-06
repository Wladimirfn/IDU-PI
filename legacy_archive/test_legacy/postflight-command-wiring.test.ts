import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/postflight uses connection inspection and postflight formatter", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("postflight"/);
	assert.match(source, /inspectProjectConnection\(/);
	assert.match(source, /readProjectPostflightGitState\(/);
	assert.match(source, /analyzeProjectPostflight\(/);
	assert.match(source, /formatProjectPostflightReport\(/);
});

// #309 — handlePostflight must wire stateRoot + constitutionPaths so the
// postflight auto-excludes supervisor bookkeeping writes from changedFiles.
test("handlePostflight wires stateRoot and constitutionPaths into buildPostflightTaskTrace", () => {
	const handlerSource = readFileSync("src/mcp/preflight/handlers.ts", "utf8");

	// The wiring call site must pass stateRoot.
	assert.match(
		handlerSource,
		/buildPostflightTaskTrace\(\{[\s\S]*?stateRoot:\s*sensorStateRoot/,
		"handler must pass stateRoot: sensorStateRoot to buildPostflightTaskTrace",
	);
	// The wiring call site must pass constitutionPaths containing Layout A and B.
	assert.match(
		handlerSource,
		/buildPostflightTaskTrace\(\{[\s\S]*?constitutionPaths,/,
		"handler must pass constitutionPaths to buildPostflightTaskTrace",
	);
	assert.match(
		handlerSource,
		/join\(sensorStateRoot,\s*"\.idu",\s*"config",\s*"project-constitution\.json"\)/,
		"handler must include Layout A constitution path",
	);
	assert.match(
		handlerSource,
		/join\(sensorStateRoot,\s*"config",\s*"project-constitution\.json"\)/,
		"handler must include Layout B constitution path",
	);
});
