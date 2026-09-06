import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("semantic agent tasks Telegram commands are wired without AgentLabs execution", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("semantic_agent_tasks_review"/u);
	assert.match(source, /bot\.command\("semantic_agent_tasks_create"/u);
	assert.match(source, /buildSemanticAgentTaskPlan/u);
	assert.match(source, /createSemanticAgentTasks/u);
	assert.doesNotMatch(source, /semantic_agent_tasks_apply/u);
});
