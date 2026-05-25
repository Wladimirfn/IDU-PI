import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("skill improvement decision commands are wired", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const registry = readFileSync("src/telegram-command-registry.ts", "utf8");
	const catalog = readFileSync("src/command-catalog.ts", "utf8");
	const extension = readFileSync(".pi/extensions/idu-pi-commands.ts", "utf8");

	for (const command of [
		"skill_improvements_approve",
		"skill_improvements_reject",
		"skill_improvements_defer",
	]) {
		assert.ok(source.includes(`bot.command("${command}"`));
		assert.ok(registry.includes(command));
		assert.ok(catalog.includes(command));
	}
	for (const command of [
		"idu-skill-improvements-approve",
		"idu-skill-improvements-reject",
		"idu-skill-improvements-defer",
	]) {
		assert.ok(extension.includes(command));
	}
});
