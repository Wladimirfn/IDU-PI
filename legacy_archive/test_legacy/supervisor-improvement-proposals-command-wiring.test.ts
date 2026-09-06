import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("supervisor improvement proposal commands are wired", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const extensionSource = readFileSync(
		".pi/extensions/idu-pi-commands.ts",
		"utf8",
	);

	assert.match(source, /bot\.command\("supervisor_improvements_review"/u);
	assert.match(source, /bot\.command\("supervisor_improvements_create"/u);
	assert.match(source, /buildSupervisorImprovementPlan/u);
	assert.match(source, /createSupervisorImprovementProposals/u);
	assert.doesNotMatch(extensionSource, /idu-supervisor-improvements-review/u);
	assert.doesNotMatch(extensionSource, /idu-supervisor-improvements-create/u);
});
