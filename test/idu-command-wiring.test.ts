import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/idu activates automatic guardrails and shows project dashboard", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const handler = source.slice(source.indexOf('bot.command("idu"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("idu_prepare"'),
	);

	assert.match(handlerBlock, /activateIduSession\(projectId\)/);
	assert.match(handlerBlock, /inspectProjectConnection\(/);
	assert.match(handlerBlock, /iduProjectDashboardText\(report\)/);
});

test("/idu_off and /idu_status are wired to session state", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("idu_off"/);
	assert.match(source, /deactivateIduSession\(currentProjectId\(\)\)/);
	assert.match(source, /bot\.command\("idu_status"/);
	assert.match(
		source,
		/formatIduSessionStatus\(getIduSessionStatus\(currentProjectId\(\)\)\)/,
	);
});
