import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/preflight uses connection inspection and preflight formatter", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("preflight"/);
	assert.match(source, /inspectProjectConnection\(/);
	assert.match(source, /analyzeProjectPreflight\(/);
	assert.match(source, /formatProjectPreflightReport\(/);
});
