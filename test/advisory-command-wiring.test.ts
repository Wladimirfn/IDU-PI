import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/advisory uses preflight and advisory formatter", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("advisory"/);
	assert.match(source, /inspectProjectConnection\(/);
	assert.match(source, /analyzeProjectPreflight\(/);
	assert.match(source, /buildProjectAdvisory\(/);
	assert.match(source, /formatProjectAdvisory\(/);
});
