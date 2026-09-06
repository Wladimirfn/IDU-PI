import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("agentlab request commands are wired without AgentLab execution", () => {
	const index = readFileSync("src/index.ts", "utf8");
	const cli = readFileSync("src/cli.ts", "utf8");
	const catalog = readFileSync("src/command-catalog.ts", "utf8");
	const registry = readFileSync("src/telegram-command-registry.ts", "utf8");

	assert.match(index, /bot\.command\("agentlab_request_create"/u);
	assert.match(index, /bot\.command\("agentlab_request_review"/u);
	assert.match(cli, /case "agentlab-request-create"/u);
	assert.match(cli, /case "agentlab-request-review"/u);
	assert.match(catalog, /agentlab_request_create/u);
	assert.match(registry, /agentlab_request_review/u);

	const createHandler = index.slice(
		index.indexOf('bot.command("agentlab_request_create"'),
		index.indexOf('bot.command("semantic_audit_status"'),
	);
	assert.doesNotMatch(createHandler, /runTestLab\(/u);
	assert.doesNotMatch(createHandler, /runLabForProfiles/u);
	assert.doesNotMatch(createHandler, /runLabForProfilesService/u);
	assert.doesNotMatch(createHandler, /labPrompt/u);
});
