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
