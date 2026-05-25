import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("supervisor learning rules commands are wired safely", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const cli = readFileSync("src/cli.ts", "utf8");
	const registry = readFileSync("src/telegram-command-registry.ts", "utf8");
	const catalog = readFileSync("src/command-catalog.ts", "utf8");
	const extension = readFileSync(".pi/extensions/idu-pi-commands.ts", "utf8");

	for (const command of [
		"supervisor_improvements_apply",
		"supervisor_learning_rules_status",
		"supervisor_learning_rules_test",
		"supervisor_rules_disable",
		"supervisor_learning_rules_enable",
		"supervisor_rules_rollback",
	]) {
		assert.ok(source.includes(`bot.command("${command}"`));
		assert.ok(registry.includes(command));
		assert.ok(catalog.includes(command));
	}
	for (const command of [
		"idu-supervisor-improvements-apply",
		"idu-supervisor-learning-rules-status",
		"idu-supervisor-learning-rules-test",
		"idu-supervisor-learning-rules-disable",
		"idu-supervisor-learning-rules-enable",
		"idu-supervisor-learning-rules-rollback",
	]) {
		assert.ok(cli.includes(command));
		assert.ok(extension.includes(command));
	}
	assert.ok(source.includes("applySupervisorLearningRules"));
	assert.ok(source.includes("getSupervisorLearningRulesStatus"));
	assert.ok(source.includes("testSupervisorLearningRules"));
	assert.ok(source.includes("disableSupervisorLearningRule"));
	assert.ok(source.includes("enableSupervisorLearningRule"));
	assert.ok(source.includes("rollbackSupervisorLearningRules"));
});
