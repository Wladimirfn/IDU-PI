import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/index.ts", "utf8");

test("Project Core confirmation commands are wired", () => {
	assert.match(source, /bot\.command\("idu_confirm_core"/u);
	assert.match(source, /bot\.command\("idu_reject_core"/u);
	assert.match(source, /bot\.command\("idu_core_diff"/u);
	assert.match(source, /confirmProjectCore/u);
	assert.match(source, /rejectProjectCore/u);
	assert.match(source, /diffProjectCore/u);
	assert.match(source, /formatProjectCoreConfirmationResult/u);
	assert.match(source, /formatProjectCoreDiff/u);
});

test("Project Core confirmation commands avoid unsafe integrations", () => {
	const confirmationBlock = source.slice(
		source.indexOf('bot.command("idu_confirm_core"'),
		source.indexOf('bot.command("preflight"'),
	);

	assert.doesNotMatch(confirmationBlock, /agentRouter\.prompt/u);
	assert.doesNotMatch(confirmationBlock, /runTestLab/u);
	assert.doesNotMatch(confirmationBlock, /analyzeProjectPreflight/u);
	assert.doesNotMatch(confirmationBlock, /buildProjectAdvisory/u);
	assert.doesNotMatch(confirmationBlock, /analyzeProjectPostflight/u);
});
