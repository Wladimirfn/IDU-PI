import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/idu_prepare is wired without unsafe operations", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("idu_prepare"/u);
	assert.match(source, /runIduPrepare\(/u);
	assert.match(source, /formatIduPrepareResult\(/u);

	const handler = source.slice(source.indexOf('bot.command("idu_prepare"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("preflight"'),
	);
	assert.doesNotMatch(handlerBlock, /applyProjectFlowsDraft\(/u);
	assert.doesNotMatch(handlerBlock, /runTestLab\(/u);
	assert.doesNotMatch(handlerBlock, /runLabForProfiles\(/u);
	assert.doesNotMatch(handlerBlock, /runLabForProfilesService\(/u);
	assert.match(
		handlerBlock,
		/lastIduPrepareByProject\.set\(projectId, result\)/u,
	);
});

test("/idu response advertises prepare only when safe", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const handler = source.slice(source.indexOf('bot.command("idu"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("idu_prepare"'),
	);

	assert.match(handlerBlock, /iduProjectDashboardText\(report\)/u);
	assert.match(source, /formatIduProjectDashboard\(/u);
	assert.match(source, /lastIduPrepareByProject\.get\(report\.projectId\)/u);
	assert.match(source, /recommendedNext: report\.recommendedNext/u);
	assert.doesNotMatch(handlerBlock, /applyProjectFlowsDraft\(/u);
});
