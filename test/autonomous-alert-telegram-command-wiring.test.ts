import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ALERT_COMMANDS = [
	"idu_alerts_status",
	"idu_alerts_tick",
	"idu_alerts_pause",
	"idu_alerts_resume",
	"idu_alerts_off",
	"idu_alerts_on",
] as const;

test("Telegram autonomous alert commands have handlers", () => {
	const source = readFileSync("src/index.ts", "utf8");
	for (const command of ALERT_COMMANDS) {
		assert.match(source, new RegExp(`bot\\.command\\("${command}"`, "u"));
	}
});

test("Telegram alert tick is read-only by default", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const start = source.indexOf('bot.command("idu_alerts_tick"');
	assert.notEqual(start, -1);
	const next = source.indexOf('bot.command("idu_alerts_pause"', start);
	assert.notEqual(next, -1);
	const block = source.slice(start, next);

	assert.match(block, /runTelegramAutonomousAlertTick\(/u);
	assert.match(block, /allowTaskCreation:\s*false/u);
	assert.doesNotMatch(block, /allowTaskCreation:\s*true/u);
	assert.doesNotMatch(block, /createTask\(/u);
});

test("Telegram alert controls use stateRoot control helpers", () => {
	const source = readFileSync("src/index.ts", "utf8");
	for (const command of [
		"idu_alerts_pause",
		"idu_alerts_resume",
		"idu_alerts_off",
		"idu_alerts_on",
	]) {
		const start = source.indexOf(`bot.command("${command}"`);
		assert.notEqual(start, -1);
		const next = source.indexOf("bot.command(", start + 1);
		const block = source.slice(start, next === -1 ? undefined : next);
		assert.match(block, /runTelegramAutonomousAlertControl\(/u);
	}
});
