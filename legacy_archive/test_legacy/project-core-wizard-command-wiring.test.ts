import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/index.ts", "utf8");

test("/idu_define_project and /idu_core_status commands are wired", () => {
	assert.match(source, /bot\.command\("idu_define_project"/u);
	assert.match(source, /bot\.command\("idu_core_status"/u);
	assert.match(source, /startProjectCoreWizard/u);
	assert.match(source, /answerProjectCoreWizard/u);
	assert.match(source, /getProjectCoreWizardStatus/u);
	assert.doesNotMatch(source, /idu_define_project[\s\S]*agentRouter\.prompt/u);
});

test("Project Core wizard uses pending text replies", () => {
	const messageHandler = source.slice(source.indexOf('bot.on("message:text"'));

	assert.match(messageHandler, /pendingAction === "project-core-wizard"/u);
	assert.match(messageHandler, /answerProjectCoreWizard/u);
	assert.ok(
		messageHandler.indexOf('pendingAction === "project-core-wizard"') <
			messageHandler.indexOf("void runPrompt"),
	);
});
