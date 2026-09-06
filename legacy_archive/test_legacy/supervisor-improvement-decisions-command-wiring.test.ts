import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("supervisor improvement decision commands are wired", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const registry = readFileSync("src/telegram-command-registry.ts", "utf8");
	const catalog = readFileSync("src/command-catalog.ts", "utf8");
	const extension = readFileSync(".pi/extensions/idu-pi-commands.ts", "utf8");

	for (const command of [
		"supervisor_improvements_status",
		"supervisor_improvements_approve",
		"supervisor_improvements_reject",
		"supervisor_improvements_defer",
	]) {
		assert.ok(source.includes(`bot.command("${command}"`));
		assert.ok(registry.includes(command));
		assert.ok(catalog.includes(command));
	}
	for (const command of [
		"idu-supervisor-improvements-status",
		"idu-supervisor-improvements-approve",
		"idu-supervisor-improvements-reject",
		"idu-supervisor-improvements-defer",
	]) {
		assert.ok(!extension.includes(command));
	}
});
