import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	formatBotFatherCommands,
	formatCommandCatalog,
	formatHelpText,
	telegramCommandsForApi,
	TELEGRAM_COMMANDS,
} from "../src/command-catalog.js";
import { PUBLIC_TELEGRAM_HANDLER_COMMANDS } from "../src/telegram-command-registry.js";

test("formatHelpText includes primary Telegram commands", () => {
	const text = formatHelpText();

	assert.match(
		text,
		/\/config \[doctor\|init_workspace\|init_assets\|init_project_config\|inspect_project_map\|scan_project_map\|suggest_project_flows\|draft_project_flows\|review_project_flows_draft\|apply_project_flows_draft\|ai_draft_project_blueprint\|ai_draft_project_flows\|review_ai_blueprint_draft\|review_ai_flows_draft\|skills_sync\|db_init\|sync_commands\]/,
	);
	assert.match(text, /\/comandos/);
	assert.match(text, /\/idu/);
	assert.match(text, /\/idu_off/);
	assert.match(text, /\/idu_status/);
	assert.match(text, /\/idu_prepare/);
	assert.match(text, /\/preflight <solicitud>/);
	assert.match(text, /\/advisory <solicitud>/);
	assert.match(text, /\/postflight/);
	assert.match(text, /\/lab_review_plan/);
	assert.match(text, /\/testlab \[profundidad\]/);
});

test("formatCommandCatalog includes argument examples and local command surfaces", () => {
	const text = formatCommandCatalog();

	assert.match(text, /Telegram — usos con argumentos/);
	assert.match(text, /\/config init_project_config/);
	assert.match(text, /\/config inspect_project_map/);
	assert.match(text, /\/config scan_project_map/);
	assert.match(text, /\/config suggest_project_flows/);
	assert.match(text, /\/config draft_project_flows/);
	assert.match(text, /\/config review_project_flows_draft/);
	assert.match(text, /\/config apply_project_flows_draft/);
	assert.match(text, /\/config ai_draft_project_blueprint/);
	assert.match(text, /\/config ai_draft_project_flows/);
	assert.match(text, /\/config review_ai_blueprint_draft/);
	assert.match(text, /\/config review_ai_flows_draft/);
	assert.match(text, /\/idu/);
	assert.match(text, /\/idu_off/);
	assert.match(text, /\/idu_status/);
	assert.match(text, /\/idu_prepare/);
	assert.match(text, /\/preflight <solicitud>/);
	assert.match(text, /\/advisory <solicitud>/);
	assert.match(text, /\/postflight/);
	assert.match(text, /\/lab_review_plan/);
	assert.match(text, /\/server restart/);
	assert.match(text, /\/task bug <detalle>/);
	assert.match(text, /\/queue_detail/);
	assert.match(text, /CLI pnpm/);
	assert.match(text, /corepack pnpm run setup/);
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

test("telegram command catalog matches registered handlers", () => {
	const catalogCommands = TELEGRAM_COMMANDS.map(
		(entry) => entry.command,
	).sort();
	const registryCommands = [...PUBLIC_TELEGRAM_HANDLER_COMMANDS].sort();
	const source = readFileSync("src/index.ts", "utf8");
	const registeredCommands = new Set<string>();
	const registryGroups: Record<string, readonly string[]> = {
		QUICK_PROMPT_COMMANDS: ["review", "fix_tests", "audit"],
		WORK_SESSION_COMMANDS: ["trabajos", "work"],
		PATH_SESSION_COMMANDS: ["cwd", "new"],
		LEGACY_SESSION_COMMANDS: ["sessions", "use", "approve", "reject"],
	};

	for (const match of source.matchAll(/bot\.command\(([^,]+),/gu)) {
		const commandExpression = match[1]?.trim();
		if (!commandExpression) continue;
		const literal = /^"([a-z0-9_]+)"$/u.exec(commandExpression);
		if (literal) {
			registeredCommands.add(literal[1]);
			continue;
		}
		const group = registryGroups[commandExpression];
		assert.ok(
			group,
			`Unrecognized bot.command expression: ${commandExpression}`,
		);
		for (const command of group) registeredCommands.add(command);
	}

	assert.deepEqual(registryCommands, catalogCommands);
	assert.deepEqual([...registeredCommands].sort(), catalogCommands);
});

test("telegramCommandsForApi creates setMyCommands payload from catalog", () => {
	const commands = telegramCommandsForApi();

	assert.deepEqual(commands[0], {
		command: TELEGRAM_COMMANDS[0].command,
		description: TELEGRAM_COMMANDS[0].description,
	});
	assert.ok(commands.some((entry) => entry.command === "config"));
	assert.ok(commands.some((entry) => entry.command === "idu"));
	assert.ok(commands.some((entry) => entry.command === "idu_off"));
	assert.ok(commands.some((entry) => entry.command === "idu_status"));
	assert.ok(commands.some((entry) => entry.command === "idu_prepare"));
	assert.ok(commands.some((entry) => entry.command === "idu_define_project"));
	assert.ok(commands.some((entry) => entry.command === "idu_core_status"));
	assert.ok(commands.some((entry) => entry.command === "idu_research_core"));
	assert.ok(
		commands.some((entry) => entry.command === "idu_review_core_research"),
	);
	assert.ok(commands.some((entry) => entry.command === "idu_confirm_core"));
	assert.ok(commands.some((entry) => entry.command === "idu_reject_core"));
	assert.ok(commands.some((entry) => entry.command === "idu_core_diff"));
	assert.ok(commands.some((entry) => entry.command === "preflight"));
	assert.ok(commands.some((entry) => entry.command === "advisory"));
	assert.ok(commands.some((entry) => entry.command === "postflight"));
	assert.ok(commands.some((entry) => entry.command === "lab_review_plan"));
	assert.ok(commands.some((entry) => entry.command === "queue_detail"));
	assert.ok(
		commands.some((entry) => entry.command === "queue_clear_structured"),
	);
	assert.ok(commands.some((entry) => entry.command === "queue_approve"));
	assert.ok(commands.some((entry) => entry.command === "queue_reject"));
	assert.equal(commands.length, TELEGRAM_COMMANDS.length);
	for (const entry of commands) {
		assert.match(entry.command, /^[a-z0-9_]{1,32}$/u);
		assert.ok(entry.description.length >= 1);
		assert.ok(entry.description.length <= 80);
	}
});
