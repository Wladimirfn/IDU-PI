import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/lab_review_plan builds plan without running AgentLabs", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("lab_review_plan"/);
	assert.match(source, /buildLabReviewPlan\(/);
	assert.match(source, /formatLabReviewPlan\(/);
	assert.match(source, /enqueueTask\(/);

	const handler = source.slice(source.indexOf('bot.command("lab_review_plan"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf("bot.command(QUICK_PROMPT_COMMANDS"),
	);
	assert.doesNotMatch(handlerBlock, /runTestLab\(/);
	assert.doesNotMatch(handlerBlock, /runLabForProfiles\(/);
	assert.doesNotMatch(handlerBlock, /runLabForProfilesService\(/);
});
