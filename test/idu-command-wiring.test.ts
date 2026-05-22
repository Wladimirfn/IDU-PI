import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/idu uses project connection inspection and project dashboard formatter", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("idu"/);
	assert.match(source, /inspectProjectConnection\(/);
	assert.match(source, /formatIduProjectDashboard\(/);
});
