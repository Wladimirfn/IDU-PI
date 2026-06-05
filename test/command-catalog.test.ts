import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	formatBotFatherCommands,
	formatCommandCatalog,
	formatHelpText,
	telegramCommandsForApi,
	TELEGRAM_COMMANDS,
	CLI_COMMANDS,
} from "../src/command-catalog.js";
import { PUBLIC_TELEGRAM_HANDLER_COMMANDS } from "../src/telegram-command-registry.js";

const ALERT_COMMANDS = [
	"idu_alerts_status",
	"idu_alerts_tick",
	"idu_alerts_pause",
	"idu_alerts_resume",
	"idu_alerts_off",
	"idu_alerts_on",
] as const;

test("formatHelpText includes primary Telegram commands", () => {
	const text = formatHelpText();

	assert.match(
		text,
		/\/config \[doctor\|init_workspace\|init_assets\|init_project_config\|inspect_project_map\|scan_project_map\|suggest_project_flows\|draft_project_flows\|review_project_flows_draft\|apply_project_flows_draft\|ai_draft_project_blueprint\|ai_draft_project_flows\|review_ai_blueprint_draft\|review_ai_flows_draft\|skills_sync\|db_init\|sync_commands\]/,
	);
	assert.match(text, /\/comandos/);
	assert.match(text, /\/idu_menu/);
	assert.match(text, /\/idu_projects/);
	assert.match(text, /\/idu/);
	assert.match(text, /\/idu_off/);
	assert.match(text, /\/idu_status/);
	assert.match(text, /\/idu_prepare/);
	assert.match(text, /\/idu_supervisor_tick/);
	assert.match(text, /\/idu_alerts_status/);
	assert.match(text, /\/idu_alerts_tick/);
	assert.match(text, /\/idu_alerts_pause/);
	assert.match(text, /\/idu_alerts_resume/);
	assert.match(text, /\/idu_alerts_off/);
	assert.match(text, /\/idu_alerts_on/);
	assert.match(text, /\/agentlab_request_create/);
	assert.match(text, /\/agentlab_request_review/);
	assert.match(text, /\/agentlab_review_run/);
	assert.match(text, /\/agentlab_review_status/);
	assert.match(text, /\/agentlab_report_consolidate/);
	assert.match(text, /\/agentlab_report_status/);
	assert.match(text, /\/semantic_audit_status/);
	assert.match(text, /\/semantic_audit_run/);
	assert.match(text, /\/semantic_compact_draft/);
	assert.match(text, /\/semantic_compact_review/);
	assert.match(text, /\/semantic_agent_tasks_review/);
	assert.match(text, /\/semantic_agent_tasks_create/);
	assert.match(text, /\/skill_improvements_review/);
	assert.match(text, /\/skill_improvements_create/);
	assert.match(text, /\/skill_improvements_status/);
	assert.match(text, /\/skill_drafts_create/);
	assert.match(text, /\/skill_drafts_review/);
	assert.match(text, /\/preflight <solicitud>/);
	assert.match(text, /\/advisory <solicitud>/);
	assert.match(text, /\/postflight/);
	assert.match(text, /\/lab_review_plan/);
	assert.match(text, /\/reset/);
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
	assert.match(text, /\/idu_menu/);
	assert.match(text, /\/idu_projects/);
	assert.match(text, /\/idu/);
	assert.match(text, /\/idu_off/);
	assert.match(text, /\/idu_status/);
	assert.match(text, /\/idu_prepare/);
	assert.match(text, /\/idu_supervisor_tick/);
	assert.match(text, /\/idu_alerts_status/);
	assert.match(text, /\/idu_alerts_tick/);
	assert.match(text, /\/idu_alerts_pause 60/);
	assert.match(text, /\/idu_alerts_resume/);
	assert.match(text, /\/idu_alerts_off/);
	assert.match(text, /\/idu_alerts_on/);
	assert.match(text, /\/agentlab_request_create postflight/);
	assert.match(text, /\/agentlab_request_review latest/);
	assert.match(text, /\/agentlab_review_run latest/);
	assert.match(text, /\/agentlab_review_status latest/);
	assert.match(text, /\/agentlab_report_consolidate latest/);
	assert.match(text, /\/agentlab_report_status latest/);
	assert.match(text, /\/semantic_audit_status/);
	assert.match(text, /\/semantic_audit_run/);
	assert.match(text, /\/semantic_compact_draft/);
	assert.match(text, /\/semantic_compact_review latest/);
	assert.match(text, /\/semantic_agent_tasks_review latest/);
	assert.match(text, /\/semantic_agent_tasks_create latest/);
	assert.match(text, /\/skill_improvements_review latest/);
	assert.match(text, /\/skill_improvements_create latest/);
	assert.match(text, /\/skill_improvements_status latest/);
	assert.match(text, /\/skill_drafts_create latest/);
	assert.match(text, /\/skill_drafts_review latest/);
	assert.match(text, /\/preflight <solicitud>/);
	assert.match(text, /\/advisory <solicitud>/);
	assert.match(text, /\/postflight/);
	assert.match(text, /\/lab_review_plan/);
	assert.match(text, /\/reset/);
	assert.match(text, /\/server restart/);
	assert.match(text, /\/task bug <detalle>/);
	assert.match(text, /\/queue_detail/);
	assert.match(text, /CLI pnpm/);
	assert.match(text, /corepack pnpm run setup/);
	assert.match(text, /corepack pnpm test/);
	assert.match(text, /corepack pnpm cli -- idu-semantic-compact-draft/);
	assert.match(text, /corepack pnpm cli -- idu-semantic-compact-review latest/);
	assert.match(
		text,
		/corepack pnpm cli -- idu-semantic-agent-tasks-review latest/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-semantic-agent-tasks-create latest/,
	);
	assert.doesNotMatch(text, /corepack pnpm cli -- supervisor-tick/);
	assert.match(text, /corepack pnpm cli -- idu-supervisor-tick/);
	assert.match(text, /corepack pnpm cli -- alerts status/);
	assert.match(text, /corepack pnpm cli -- alerts tick/);
	assert.match(text, /corepack pnpm cli -- alerts control pause 60/);
	assert.match(text, /corepack pnpm cli -- alerts control resume/);
	assert.match(
		text,
		/corepack pnpm cli -- idu-skill-improvements-review latest/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-skill-improvements-create latest/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-skill-improvements-status latest/,
	);
	assert.match(text, /corepack pnpm cli -- idu-skill-drafts-create latest/);
	assert.match(text, /corepack pnpm cli -- idu-skill-drafts-review latest/);
	assert.match(
		text,
		/corepack pnpm cli -- idu-source-skill-candidates-create all/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-source-skill-candidates-review latest/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-agentlab-request-create postflight/,
	);
	assert.match(text, /corepack pnpm cli -- idu-agentlab-request-review latest/);
	assert.match(text, /corepack pnpm cli -- idu-agentlab-review-run latest/);
	assert.match(text, /corepack pnpm cli -- idu-agentlab-review-status latest/);
	assert.match(
		text,
		/corepack pnpm cli -- idu-agentlab-report-consolidate latest/,
	);
	assert.match(
		text,
		/corepack pnpm cli -- idu-agentlab-report-consolidation-status latest/,
	);
	assert.doesNotMatch(
		text,
		/corepack pnpm cli -- agentlab-request-create postflight/,
	);
	assert.doesNotMatch(
		text,
		/corepack pnpm cli -- agentlab-request-review latest/,
	);
	assert.doesNotMatch(text, /corepack pnpm cli -- agentlab-review-run latest/);
	assert.doesNotMatch(
		text,
		/corepack pnpm cli -- agentlab-review-status latest/,
	);
	assert.doesNotMatch(
		text,
		/corepack pnpm cli -- agentlab-report-consolidate latest/,
	);
	assert.match(text, /corepack pnpm cli -- idu-semantic-audit-status/);
	assert.match(text, /corepack pnpm cli -- idu-queue-detail/);
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
		assert.match(entry.command, /^[a-z0-9_]+$/u);
		assert.ok(entry.description.length >= 1);
		assert.ok(entry.description.length <= 80);
	}
});

test("telegram command catalog has unique commands", () => {
	const commands = TELEGRAM_COMMANDS.map((entry) => entry.command);
	assert.equal(new Set(commands).size, commands.length);
});

test("alert commands are registered in Telegram catalog registry and CLI catalog", () => {
	const telegramCommands = TELEGRAM_COMMANDS.map((entry) => entry.command);
	const registryCommands = [...PUBLIC_TELEGRAM_HANDLER_COMMANDS];
	for (const command of ALERT_COMMANDS) {
		assert.ok(telegramCommands.includes(command));
		assert.ok(registryCommands.includes(command));
	}
	const cliCommands = CLI_COMMANDS.map((entry) => entry.command).join("\n");
	assert.match(cliCommands, /corepack pnpm cli -- alerts status/u);
	assert.match(cliCommands, /corepack pnpm cli -- alerts tick/u);
	assert.match(cliCommands, /corepack pnpm cli -- alerts control pause 60/u);
	assert.match(cliCommands, /corepack pnpm cli -- alerts control resume/u);
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
	assert.ok(commands.some((entry) => entry.command === "idu_menu"));
	assert.ok(commands.some((entry) => entry.command === "idu_projects"));
	assert.ok(commands.some((entry) => entry.command === "idu"));
	assert.ok(commands.some((entry) => entry.command === "idu_off"));
	assert.ok(commands.some((entry) => entry.command === "idu_status"));
	assert.ok(commands.some((entry) => entry.command === "idu_prepare"));
	for (const command of ALERT_COMMANDS) {
		assert.ok(commands.some((entry) => entry.command === command));
	}
	assert.ok(
		commands.some((entry) => entry.command === "semantic_audit_status"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "agentlab_request_create"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "agentlab_request_review"),
	);
	assert.ok(commands.some((entry) => entry.command === "agentlab_review_run"));
	assert.ok(
		commands.some((entry) => entry.command === "agentlab_review_status"),
	);
	assert.ok(commands.some((entry) => entry.command === "semantic_audit_run"));
	assert.ok(
		commands.some((entry) => entry.command === "semantic_compact_draft"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "semantic_compact_review"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "skill_improvements_review"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "skill_improvements_create"),
	);
	assert.ok(
		commands.some((entry) => entry.command === "skill_improvements_status"),
	);
	assert.ok(commands.some((entry) => entry.command === "skill_drafts_create"));
	assert.ok(commands.some((entry) => entry.command === "skill_drafts_review"));
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
	assert.ok(commands.some((entry) => entry.command === "reset"));
	assert.ok(commands.some((entry) => entry.command === "queue_detail"));
	assert.ok(
		commands.some((entry) => entry.command === "queue_clear_structured"),
	);
	assert.ok(commands.some((entry) => entry.command === "queue_approve"));
	assert.ok(commands.some((entry) => entry.command === "queue_reject"));
	assert.ok(commands.length <= TELEGRAM_COMMANDS.length);
	for (const entry of commands) {
		assert.match(entry.command, /^[a-z0-9_]{1,32}$/u);
		assert.ok(entry.description.length >= 1);
		assert.ok(entry.description.length <= 80);
	}
});
