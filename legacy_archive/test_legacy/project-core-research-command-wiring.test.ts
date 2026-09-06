import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/index.ts", "utf8");

test("Project Core research commands are wired", () => {
	assert.match(source, /bot\.command\("idu_research_core"/u);
	assert.match(source, /bot\.command\("idu_review_core_research"/u);
	assert.match(source, /saveProjectCoreResearchDraft/u);
	assert.match(source, /reviewProjectCoreResearchDraft/u);
	assert.match(source, /generateAiProjectDraft/u);
});

test("Project Core research commands do not wire preflight or AgentLabs", () => {
	const block = source.slice(source.indexOf('bot.command("idu_research_core"'));
	const commandBlock = block.slice(0, block.indexOf('bot.command("preflight"'));

	assert.doesNotMatch(commandBlock, /buildPreflightReport/u);
	assert.doesNotMatch(commandBlock, /runLabForProfiles/u);
	assert.doesNotMatch(commandBlock, /labPrompt/u);
});
