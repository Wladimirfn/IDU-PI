import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatBotFatherCommands,
	formatCommandCatalog,
	formatHelpText,
	telegramCommandsForApi,
	TELEGRAM_COMMANDS,
} from "../src/command-catalog.js";

test("formatHelpText includes primary Telegram commands", () => {
	const text = formatHelpText();

	assert.match(text, /\/config \[doctor\|init_workspace\|init_assets\|skills_sync\|db_init\|sync_commands\]/);
	assert.match(text, /\/comandos/);
	assert.match(text, /\/testlab \[profundidad\]/);
});

test("formatCommandCatalog includes argument examples and local command surfaces", () => {
	const text = formatCommandCatalog();

	assert.match(text, /Telegram — usos con argumentos/);
	assert.match(text, /\/server restart/);
	assert.match(text, /\/task bug <detalle>/);
	assert.match(text, /CLI pnpm/);
	assert.match(text, /corepack pnpm test/);
	assert.match(text, /Batch directos/);
	assert.match(text, /start-pi-telegram-bridge\.bat/);
	assert.match(text, /stop-pi-telegram-bridge\.bat/);
	assert.match(text, /PowerShell directos/);
	assert.match(text, /scripts\/start-bridge\.ps1/);
	assert.match(text, /scripts\/stop-bridge\.ps1/);
});

test("formatBotFatherCommands emits valid command-description lines", () => {
	const text = formatBotFatherCommands();
	const lines = text.split("\n");

	assert.ok(lines.includes("config - Configuración guiada del proyecto"));
	assert.ok(
		lines.includes("comandos - Ver comandos Telegram, CLI, Batch y PowerShell"),
	);
	for (const line of lines) {
		assert.match(line, /^[a-z0-9_]+ - .{1,80}$/u);
	}
	for (const entry of TELEGRAM_COMMANDS) {
		assert.match(entry.command, /^[a-z0-9_]{1,32}$/u);
		assert.ok(entry.description.length >= 1);
		assert.ok(entry.description.length <= 80);
	}
});

test("telegram command catalog has unique commands", () => {
	const commands = TELEGRAM_COMMANDS.map((entry) => entry.command);
	assert.equal(new Set(commands).size, commands.length);
});

test("telegramCommandsForApi creates setMyCommands payload from catalog", () => {
	const commands = telegramCommandsForApi();

	assert.deepEqual(commands[0], {
		command: TELEGRAM_COMMANDS[0].command,
		description: TELEGRAM_COMMANDS[0].description,
	});
	assert.ok(commands.some((entry) => entry.command === "config"));
	assert.equal(commands.length, TELEGRAM_COMMANDS.length);
	for (const entry of commands) {
		assert.match(entry.command, /^[a-z0-9_]{1,32}$/u);
		assert.ok(entry.description.length >= 1);
		assert.ok(entry.description.length <= 80);
	}
});
