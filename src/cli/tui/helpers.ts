/**
 * helpers.ts — TUI cluster (L).
 * PR 6 of 7 (Item 4). Move + re-export PURO.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import type { BridgeLifecycleAction } from "../../bridge-lifecycle.js";
import {
	bridgeLifecycleReply,
	launchBridgeLifecycle,
} from "../../bridge-lifecycle.js";
import {
	buildCliHomeStatus,
	formatSupervisorStatus,
	formatDiagnosticsStatus,
	formatCliProjectStatus,
	formatTelegramRemoteStatus,
	formatModelProfilesStatus,
	formatIduLogo,
	formatInstallationMenu,
	formatMainMenu,
	formatModelProfilesMenu,
	formatTaskQueueStatus,
	formatTelegramRemoteMenu,
} from "../../cli-home.js";
import {
	formatBridgeEnvStatus,
	packageEnvPath,
	readEnvDraft,
	tailTextFile,
	validateBridgeEnvDraft,
	writeEnvDraftWithBackup,
} from "../../env-config.js";
import type { TaskQueuePanelDispatchRuntime } from "../queue/index.js";
import { dispatchTaskQueuePanelChoice } from "../queue/index.js";
import { createCliRuntime } from "../../cli.js";
import { formatTareasView, renderTaskQueuePanel } from "../../structured-task-queue.js";
import {
	formatColaDeAccionesFeed,
	readColaDeAccionesFeed,
} from "../../cola-acciones-feed.js";
import {
	getSupervisorTriggerStatus,
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
} from "../../supervisor-trigger.js";
import {
	IDU_MODEL_ROLES,
	formatAgentLabModelAssignmentProposal,
	formatModelAssignments,
	loadModelAssignments,
	recommendAgentLabModelAssignments,
	saveModelAssignment,
	saveModelAssignments,
} from "../../model-assignments.js";
import {
	modelAssignmentOptionGroups,
	modelAssignmentOptions,
	resolveAssignmentSelection,
	resolveRoleSelection,
	validateAgentProfiles,
} from "../role/index.js";
import { parseAgentProfiles } from "../../config.js";
import { runWizardActivateSupervisor } from "../wizard/index.js";
import { handleProjectCommand, handleSetupCommand } from "../setup/index.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_HOME = "\x1b[H";
const ANSI_CLEAR_TO_END = "\x1b[J";
const ANSI_ALT_SCREEN_ON = "\x1b[?1049h";
const ANSI_ALT_SCREEN_OFF = "\x1b[?1049l";
const ANSI_HIDE_CURSOR = "\x1b[?25l";
const ANSI_SHOW_CURSOR = "\x1b[?25h";
const ANSI_WHITE_BG = "\x1b[47m";
const ANSI_DARK_PURPLE = "\x1b[35m";
const ANSI_DIM = "\x1b[2m";
const ANSI_PANEL_WIDTH = 72;
const COLA_DE_ACCIONES_AUTOREFRESH_MS = 5000;

export type CliQuestion = (message: string) => Promise<string>;

export type CliPrint = (message: string) => void;

export type CliHomeActionOptions = {
	bridgeLauncher?: (action: BridgeLifecycleAction, root: string) => void;
};

export type MenuOption = { label: string; value: string };

export type InteractiveHomeSelectMenu = (
	title: string,
	options: MenuOption[],
	status?: ReturnType<typeof buildCliHomeStatus>,
	content?: string,
	settings?: Pick<SelectSearchableMenuSettings, "autoRefresh">,
) => Promise<string>;

export type TareasViewDispatchRuntime = Pick<
	TaskQueuePanelDispatchRuntime,
	"listTasks"
>;

export type SelectSearchableMenuSettings = {
	status?: ReturnType<typeof buildCliHomeStatus>;
	content?: string;
	search?: boolean;
	help?: string;
	autoRefresh?: {
		intervalMs: number;
		getContent: () => string;
	};
};

export type SelectSearchableMenuInput = {
	on: (
		event: "keypress",
		listener: (chunk: string, key: { name?: string }) => void,
	) => unknown;
	removeAllListeners: (event: "keypress") => unknown;
	resume: () => unknown;
	isTTY?: boolean;
	setRawMode?: (enabled: boolean) => void;
};

export type SelectSearchableMenuOutput = {
	write: (value: string) => unknown;
	rows?: number;
};

export type SelectSearchableMenuDeps = {
	input?: SelectSearchableMenuInput;
	output?: SelectSearchableMenuOutput;
	setInterval?: (callback: () => void, intervalMs: number) => unknown;
	clearInterval?: (timer: unknown) => void;
};

export function buildHomeTaskQueueRuntime(): TaskQueuePanelDispatchRuntime {
	const empty: TaskQueuePanelDispatchRuntime = {
		queueApprove: () => undefined,
		queueReject: () => undefined,
		listTasks: () => [],
	};
	try {
		const runtime = createCliRuntime({
			createRegistryIfMissing: false,
		});
		return {
			queueApprove: (id) => runtime.queueApprove(id),
			queueReject: (id) => runtime.queueReject(id),
			listTasks: () => runtime.listTasks?.() ?? [],
		};
	} catch {
		// No project enrolled, Telegram config missing, or runtime
		// factory failed. The home menu must still render; the
		// "Tareas y cola" panel shows the empty-state message and
		// approve/reject become no-ops until a project is enrolled.
		return empty;
	}
}

export function shouldRunInteractiveHome(args: string[]): boolean {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
	const [command, subcommand] = args;
	return (
		command === undefined ||
		command === "home" ||
		((command === "setup" || command === "install" || command === "init") &&
			subcommand === "wizard") ||
		((command === "install" || command === "init") && subcommand === undefined)
	);
}

export async function runInteractiveHome(
	taskQueueRuntime: TaskQueuePanelDispatchRuntime = {
		queueApprove: () => undefined,
		queueReject: () => undefined,
		listTasks: () => [],
	},
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<string> {
	while (true) {
		const status = buildCliHomeStatus({
			argvPath: process.argv[1],
			stdinInteractive: true,
		});
		const choice = await selectMenuImpl("", mainMenuOptions(), status);
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "config") {
			const result = await runInstallationMenuTui();
			if (result === "__back") continue;
			return result;
		}
		if (choice === "project") {
			const result = await runProjectStatusPanelTui();
			if (result === "__back") continue;
			return result;
		}
		if (choice === "telegram") {
			const result = await runTelegramRemoteMenuTui(status);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "models") {
			const result = await runModelProfilesMenuTui(status);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "supervisor") {
			const result = await showTextView(
				"Supervisor",
				formatSupervisorStatus(status),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		if (choice === "tareas-view") {
			const result = await runTareasViewTui(taskQueueRuntime, selectMenuImpl);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "cola-view") {
			const result = await runColaDeAccionesViewTui(status, selectMenuImpl);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "diagnostics") {
			const result = await showTextView(
				"Diagnóstico",
				formatDiagnosticsStatus(status),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		return "Salida sin cambios.";
	}
}

export function tareasViewOptions(): MenuOption[] {
	return [
		{ label: "← Prev", value: "page:prev" },
		{ label: "Next →", value: "page:next" },
		{ label: "↻ Actualizar", value: "refresh" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export async function runTareasViewTui(
	runtime: TareasViewDispatchRuntime,
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<"__back" | string> {
	let pageIndex = 0;
	const pageSize = 15;
	while (true) {
		const tasks = runtime.listTasks();
		const buildContent = () =>
			formatTareasView(tasks, {
				now: () => new Date(),
				pageIndex,
				pageSize,
			});
		const choice = await selectMenuImpl(
			"Tareas",
			tareasViewOptions(),
			undefined,
			buildContent(),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "page:next") {
			pageIndex += 1;
		} else if (choice === "page:prev") {
			pageIndex = Math.max(0, pageIndex - 1);
		}
	}
}

export function colaDeAccionesViewOptions(): MenuOption[] {
	return [
		{ label: "↻ Actualizar ahora", value: "refresh" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export async function runColaDeAccionesViewTui(
	status: ReturnType<typeof buildCliHomeStatus>,
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<"__back" | string> {
	while (true) {
		const stateRoot = status.project.stateRoot;
		const buildContent = () =>
			formatColaDeAccionesFeed(
				readColaDeAccionesFeed(stateRoot, { limit: 500 }),
			);
		const choice = await selectMenuImpl(
			"Cola de acciones",
			colaDeAccionesViewOptions(),
			undefined,
			buildContent(),
			{
				autoRefresh: {
					intervalMs: COLA_DE_ACCIONES_AUTOREFRESH_MS,
					getContent: buildContent,
				},
			},
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		// refresh and unknown choices: stay in the loop, re-render.
	}
}

export async function runProjectStatusPanelTui(): Promise<"__back" | string> {
	while (true) {
		const buildProjectPanelContent = () =>
			formatCliProjectStatus(
				buildCliHomeStatus({
					argvPath: process.argv[1],
					stdinInteractive: true,
				}),
			);
		const choice = await selectMenu(
			"Proyecto actual",
			projectStatusPanelOptions(),
			undefined,
			buildProjectPanelContent(),
			{
				autoRefresh: {
					intervalMs: 3000,
					getContent: buildProjectPanelContent,
				},
			},
		);
		if (choice === "refresh") continue;
		if (choice === "back") return "__back";
		return "Salida sin cambios.";
	}
}

export function projectStatusPanelOptions(): MenuOption[] {
	return [
		{ label: "↻ Actualizar métricas", value: "refresh" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export function mainMenuOptions(): MenuOption[] {
	return [
		{ label: "Configurar IDU-Pi", value: "config" },
		{ label: "Proyecto actual", value: "project" },
		{ label: "Telegram remoto", value: "telegram" },
		{ label: "Modelos y perfiles", value: "models" },
		{ label: "Supervisor", value: "supervisor" },
		{ label: "Tareas", value: "tareas-view" },
		{ label: "Cola de acciones", value: "cola-view" },
		{ label: "Diagnóstico", value: "diagnostics" },
		{ label: "Exit", value: "exit" },
	];
}

export function installationMenuOptions(): MenuOption[] {
	return [
		{ label: "Verificar sistema", value: "1" },
		{ label: "Instalar/actualizar MCP en Pi", value: "2" },
		{ label: "Instalar/actualizar comandos slash globales", value: "3" },
		{ label: "Enrolar proyecto actual", value: "4" },
		{ label: "Activar supervisor en este proyecto", value: "5" },
		{ label: "Trigger supervisor", value: "6" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export function supervisorTriggerMenuOptions(currentEnabled: boolean): MenuOption[] {
	return [
		{
			label: currentEnabled ? "Desactivar trigger" : "Activar trigger",
			value: "toggle",
		},
		{ label: "↻ Refrescar estado", value: "refresh" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export function formatSupervisorTriggerTui(
	stateRoot: string,
	status: ReturnType<typeof getSupervisorTriggerStatus>,
): string {
	const fileLine = status.exists
		? `archivo: ${status.path}`
		: `archivo: (no existe — comportamiento por defecto: enabled)`;
	const updatedLine = status.updatedAt
		? `actualizado: ${status.updatedAt}`
		: "actualizado: —";
	const sourceLine = status.source ? `origen: ${status.source}` : "";
	const noteLine = status.note ? `nota: ${status.note}` : "";
	return [
		"Trigger supervisor",
		"",
		`stateRoot: ${stateRoot}`,
		fileLine,
		`estado: ${status.enabled ? "activado" : "desactivado"}`,
		updatedLine,
		...(sourceLine ? [sourceLine] : []),
		...(noteLine ? [noteLine] : []),
		"",
		status.enabled
			? "El script supervisor-tick corre normalmente (cuando no haya un CLI interactivo abierto)."
			: 'El script supervisor-tick se saltea con el motivo "skipped: trigger disabled by user".',
	].join("\n");
}

export async function runSupervisorTriggerMenuTui(
	stateRoot: string,
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<string> {
	while (true) {
		const status = getSupervisorTriggerStatus(stateRoot);
		const choice = await selectMenuImpl(
			"Trigger supervisor",
			supervisorTriggerMenuOptions(status.enabled),
			undefined,
			formatSupervisorTriggerTui(stateRoot, status),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "refresh") continue;
		if (choice === "toggle") {
			const result = status.enabled
				? disableSupervisorTrigger(stateRoot, {
						source: "tui",
						now: new Date(),
					})
				: enableSupervisorTrigger(stateRoot, {
						source: "tui",
						now: new Date(),
					});
			// Show the operator the result so they have proof the
			// opt-in was persisted. Without this feedback the user
			// can't tell whether the toggle wrote the file or
			// silently no-op'd.
			return [
				formatSupervisorTriggerResult(result),
				"",
				result.state.enabled
					? "El script supervisor-tick correrá normalmente."
					: "El script supervisor-tick se saltea silenciosamente. El estado quedó persistido en " +
						result.path,
			].join("\n");
		}
	}
}

export async function runInstallationMenuTui(
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<string> {
	while (true) {
		const choice = await selectMenuImpl(
			"Configurar IDU-Pi",
			installationMenuOptions(),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "6") {
			const stateRoot = resolveSupervisorTriggerStateRootForTui();
			if (!stateRoot) {
				await showTextView(
					"Trigger supervisor",
					[
						"No hay stateRoot del proyecto activo.",
						"Enrolá o bootstrappeá el proyecto antes de configurar el trigger.",
					].join("\n"),
				);
				continue;
			}
			const result = await runSupervisorTriggerMenuTui(
				stateRoot,
				selectMenuImpl,
			);
			if (result === "__back") continue;
			return result;
		}
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			const result = await handleInstallationChoice(choice, (message: string) =>
				rl.question(message),
			);
			await showTextView("Resultado", result);
		} finally {
			rl.close();
		}
	}
}

export function resolveSupervisorTriggerStateRootForTui(): string | undefined {
	try {
		const status = buildCliHomeStatus({
			argvPath: process.argv[1],
			stdinInteractive: Boolean(process.stdin.isTTY),
		});
		return status.project.stateRoot;
	} catch {
		return undefined;
	}
}

export function telegramRemoteMenuOptions(): MenuOption[] {
	return [
		{ label: "Ver estado remoto", value: "status" },
		{ label: "Configurar acceso remoto", value: "configure" },
		{ label: "Sincronizar comandos remotos", value: "sync" },
		{ label: "Iniciar puente remoto", value: "run" },
		{ label: "Detener puente remoto", value: "off" },
		{ label: "Reiniciar puente remoto", value: "restart" },
		{ label: "Ver logs", value: "logs" },
		{ label: "Save", value: "save" },
		{ label: "Descartar", value: "discard" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export async function runTelegramRemoteMenuTui(
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	while (true) {
		const choice = await selectMenu(
			"Telegram remoto",
			telegramRemoteMenuOptions(),
			undefined,
			formatTelegramRemoteStatus(status),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			const result = await handleTelegramRemoteChoice(
				choice,
				(message: string) => rl.question(message),
				status,
				options,
			);
			await showTextView("Telegram remoto", result);
		} finally {
			rl.close();
		}
	}
}

export function modelProfilesMenuOptions(): MenuOption[] {
	return [
		{ label: "Asignar modelo por rol", value: "assign" },
		{ label: "Ver asignaciones actuales", value: "status" },
		{ label: "Propuesta automática por AgentLab", value: "proposal" },
		{ label: "Validar configuración", value: "validate" },
		{ label: "Avanzado: editar PI_AGENT_PROFILES", value: "edit" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

export async function runModelProfilesMenuTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	while (true) {
		const choice = await selectMenu(
			"Modelos Idu-pi",
			modelProfilesMenuOptions(),
			undefined,
			formatModelProfilesStatus(status),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "status") {
			const result = await showTextView(
				"Perfiles actuales",
				formatModelProfilesStatus(status),
			);
			if (result === "exit") return "Salida sin cambios.";
			continue;
		}
		let message: string;
		if (choice === "assign") {
			message = await assignModelRoleTui(status);
		} else if (choice === "edit") {
			message = await editAgentProfilesTui(status);
		} else {
			const rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				message = await handleModelProfilesChoice(
					choice,
					(prompt: string) => rl.question(prompt),
					status,
				);
			} finally {
				rl.close();
			}
		}
		const result = await showTextView("Modelos Idu-pi", message);
		if (result === "exit") return "Salida sin cambios.";
	}
}

export async function runTaskQueuePanelTui(
	runtime: TaskQueuePanelDispatchRuntime,
	selectMenuImpl: InteractiveHomeSelectMenu = selectMenu,
): Promise<"__back" | string> {
	let pageIndex = 0;
	let viewedTaskId: string | undefined;
	const pageSize = 10;

	while (true) {
		const tasks = runtime.listTasks();
		const { content, options } = renderTaskQueuePanel(
			{
				tasks,
				pageIndex,
				pageSize,
				viewedTaskId,
			},
			{
				approveCommand: (id) => `idu-pi idu-queue-approve ${id}`,
				rejectCommand: (id) => `idu-pi idu-queue-reject ${id}`,
				now: () => new Date(),
				pageSize,
			},
		);

		const choice = await selectMenuImpl(
			"Tareas y cola",
			options as MenuOption[],
			undefined,
			content,
		);
		const result = dispatchTaskQueuePanelChoice(runtime, choice);

		if (result.action === "back") return "__back";
		if (result.action === "exit") return "Salida sin cambios.";
		if (result.action === "back-to-list") {
			viewedTaskId = undefined;
			continue;
		}
		if (result.action === "view" && result.taskId) {
			viewedTaskId = result.taskId;
			continue;
		}
		if (result.action === "page-next") {
			pageIndex += 1;
			continue;
		}
		if (result.action === "page-prev") {
			pageIndex = Math.max(0, pageIndex - 1);
			continue;
		}
		if (result.action === "approve" || result.action === "reject") {
			if (result.message) {
				await showTextView("Tareas y cola", result.message);
			}
			viewedTaskId = undefined;
			pageIndex = 0;
			continue;
		}
		if (result.action === "not-found") {
			if (result.message) {
				await showTextView("Tareas y cola", result.message);
			}
		}
	}
}

export async function selectMenu(
	title: string,
	options: MenuOption[],
	status?: ReturnType<typeof buildCliHomeStatus>,
	content?: string,
	settings: Pick<SelectSearchableMenuSettings, "autoRefresh"> = {},
): Promise<string> {
	return selectSearchableMenu(title, options, {
		status,
		content,
		search: false,
		...settings,
	});
}

export async function selectSearchableMenu(
	title: string,
	options: MenuOption[],
	settings: SelectSearchableMenuSettings = {},
	deps: SelectSearchableMenuDeps = {},
): Promise<string> {
	let selected = 0;
	let query = "";
	let refreshTimer: unknown;
	let contentOffset = 0;
	const input = deps.input ?? process.stdin;
	const output = deps.output ?? process.stdout;
	const startInterval: (callback: () => void, intervalMs: number) => unknown =
		deps.setInterval ?? setInterval;
	const stopInterval: (timer: unknown) => void =
		deps.clearInterval ??
		((timer: unknown) => clearInterval(timer as NodeJS.Timeout));
	emitKeypressEvents(input as NodeJS.ReadStream);
	const rawMode = input.isTTY;
	if (rawMode) input.setRawMode?.(true);
	input.resume();
	output.write(`${ANSI_ALT_SCREEN_ON}${ANSI_HIDE_CURSOR}`);
	const filteredOptions = () => {
		if (!settings.search || !query.trim()) return options;
		const normalized = query.trim().toLowerCase();
		return options.filter((option) =>
			`${option.label}\n${option.value}`.toLowerCase().includes(normalized),
		);
	};
	const render = () => {
		const width = ANSI_PANEL_WIDTH;
		const visible = filteredOptions();
		selected = Math.min(selected, Math.max(0, visible.length - 1));
		const pageTitle = title || "Menú principal";
		const allContentLines = settings.content
			? contentLines(settings.content, width)
			: [];
		const terminalRows = Math.max(10, output.rows ?? process.stdout.rows ?? 30);
		const statusRows = settings.status ? 10 : 0;
		const searchRowsCount = settings.search ? 1 : 0;
		const fixedRows = statusRows + searchRowsCount + visible.length + 6;
		const maxContentRows = Math.max(3, terminalRows - fixedRows);
		const maxContentOffset = Math.max(
			0,
			allContentLines.length - maxContentRows,
		);
		contentOffset = Math.min(contentOffset, maxContentOffset);
		const visibleContentLines = allContentLines.slice(
			contentOffset,
			contentOffset + maxContentRows,
		);
		const contentRows = settings.content
			? [
					midBorder(width),
					...(allContentLines.length > maxContentRows
						? [
								panelLine(
									`contenido ${contentOffset + 1}-${contentOffset + visibleContentLines.length}/${allContentLines.length} · PgUp/PgDn desplazar`,
									width,
									ANSI_DIM,
								),
							]
						: []),
					...visibleContentLines.map((line) => panelLine(line, width)),
				]
			: [];
		const searchRows = settings.search
			? [
					panelLine(
						`buscar: ${query || "(escribí para filtrar)"}`,
						width,
						ANSI_DIM,
					),
				]
			: [];
		const header = [
			...(settings.status
				? [formatIduLogo(), "", `version: ${settings.status.version}`, ""]
				: []),
			topBorder(pageTitle, width),
			panelLine(
				settings.help ??
					(settings.search
						? "↑/↓ navegar · escribir filtra · Enter elegir · Esc volver/salir"
						: settings.content
							? "↑/↓ opciones · PgUp/PgDn contenido · Enter elegir · Esc/q salir"
							: "↑/↓ navegar · Enter elegir · Esc/q salir"),
				width,
				ANSI_DIM,
			),
			...searchRows,
			...contentRows,
			midBorder(width),
		].join("\n");
		const rows = visible.length
			? visible
					.map((option, index) => {
						const label = option.label.padEnd(width - 4, " ");
						return index === selected
							? `${ANSI_DARK_PURPLE}│${ANSI_RESET} ${ANSI_WHITE_BG}${ANSI_DARK_PURPLE}❯ ${label}${ANSI_RESET} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`
							: `${ANSI_DARK_PURPLE}│${ANSI_RESET}   ${label} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`;
					})
					.join("\n")
			: panelLine("Sin resultados", width, ANSI_DIM);
		const footer = bottomBorder(width);
		output.write(
			`${ANSI_HOME}${header}\n${rows}\n${footer}${ANSI_CLEAR_TO_END}`,
		);
	};
	try {
		render();
		if (settings.autoRefresh) {
			refreshTimer = startInterval(() => {
				const refreshedContent = settings.autoRefresh?.getContent();
				if (
					refreshedContent !== undefined &&
					refreshedContent !== settings.content
				) {
					settings.content = refreshedContent;
					render();
				}
			}, settings.autoRefresh.intervalMs);
		}
		return await new Promise<string>((resolve) => {
			const onKeypress = (chunk: string, key: { name?: string }) => {
				const visible = filteredOptions();
				const scrollContent = (direction: 1 | -1) => {
					if (!settings.content) return false;
					const totalLines = contentLines(
						settings.content,
						ANSI_PANEL_WIDTH,
					).length;
					const terminalRows = Math.max(
						10,
						output.rows ?? process.stdout.rows ?? 30,
					);
					const statusRows = settings.status ? 10 : 0;
					const searchRowsCount = settings.search ? 1 : 0;
					const fixedRows = statusRows + searchRowsCount + visible.length + 6;
					const maxContentRows = Math.max(3, terminalRows - fixedRows);
					const maxContentOffset = Math.max(0, totalLines - maxContentRows);
					if (maxContentOffset === 0) return false;
					contentOffset = Math.max(
						0,
						Math.min(
							maxContentOffset,
							contentOffset + direction * maxContentRows,
						),
					);
					render();
					return true;
				};
				if (key.name === "pagedown") {
					if (scrollContent(1)) return;
				}
				if (key.name === "pageup") {
					if (scrollContent(-1)) return;
				}
				if (key.name === "up") {
					if (visible.length)
						selected = (selected - 1 + visible.length) % visible.length;
					render();
					return;
				}
				if (key.name === "down") {
					if (visible.length) selected = (selected + 1) % visible.length;
					render();
					return;
				}
				if (settings.search && key.name === "backspace") {
					query = query.slice(0, -1);
					selected = 0;
					render();
					return;
				}
				if (key.name === "return") {
					if (visible.length)
						resolve(visible[selected]?.value ?? visible[0].value);
					return;
				}
				if (key.name === "escape" || (!settings.search && key.name === "q"))
					resolve("exit");
				if (
					settings.search &&
					chunk.length === 1 &&
					chunk.charCodeAt(0) >= 32
				) {
					query += chunk;
					selected = 0;
					render();
				}
			};
			input.on("keypress", onKeypress);
		}).finally(() => input.removeAllListeners("keypress"));
	} finally {
		if (refreshTimer !== undefined) stopInterval(refreshTimer);
		if (rawMode) input.setRawMode?.(false);
		output.write(`${ANSI_SHOW_CURSOR}${ANSI_ALT_SCREEN_OFF}`);
	}
}

export async function __testSelectSearchableMenu(
	title: string,
	options: MenuOption[],
	settings: SelectSearchableMenuSettings = {},
	deps: SelectSearchableMenuDeps = {},
): Promise<string> {
	return selectSearchableMenu(title, options, settings, deps);
}

export async function showTextView(
	title: string,
	content: string,
): Promise<"back" | "exit"> {
	const choice = await selectMenu(
		title,
		[
			{ label: "← Volver", value: "back" },
			{ label: "Exit", value: "exit" },
		],
		undefined,
		content,
	);
	return choice === "back" ? "back" : "exit";
}

export function topBorder(title: string, width: number): string {
	const safeTitle = ` ${title} `;
	const right = Math.max(width - safeTitle.length - 1, 1);
	return `${ANSI_DARK_PURPLE}╭─${safeTitle}${"─".repeat(right)}╮${ANSI_RESET}`;
}

export function midBorder(width: number): string {
	return `${ANSI_DARK_PURPLE}├${"─".repeat(width)}┤${ANSI_RESET}`;
}

export function bottomBorder(width: number): string {
	return `${ANSI_DARK_PURPLE}╰${"─".repeat(width)}╯${ANSI_RESET}`;
}

export function panelLine(text: string, width: number, color = ""): string {
	const clean = text.replace(/\r/gu, "");
	const clipped =
		clean.length > width - 4 ? `${clean.slice(0, width - 5)}…` : clean;
	const padded = clipped.padEnd(width - 2, " ");
	return `${ANSI_DARK_PURPLE}│${ANSI_RESET} ${color}${padded}${ANSI_RESET} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`;
}

export function contentLines(content: string, _width: number): string[] {
	return content.replace(/\r/gu, "").split("\n");
}

export async function runInteractiveHomeWithQuestion(
	question: CliQuestion,
	print: CliPrint = () => {},
	options: CliHomeActionOptions = {},
): Promise<string> {
	const status = buildCliHomeStatus({
		argvPath: process.argv[1],
		stdinInteractive: true,
	});
	print(formatMainMenu(status));
	const choice = (await question("\nElegí una opción [1-9]: ")).trim();
	if (choice === "9" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1") return runInstallationMenu(question, print);
	if (choice === "2") return formatCliProjectStatus(status);
	if (choice === "3")
		return runTelegramRemoteMenu(question, print, status, options);
	if (choice === "4") return runModelProfilesMenu(question, print, status);
	if (choice === "5") return formatSupervisorStatus(status);
	if (choice === "6") return formatTaskQueueStatus();
	if (choice === "7") {
		// "Cola de acciones" is a live read-only TUI view (auto-refresh).
		// In the non-TUI surface the safest mirror is the formatted
		// feed snapshot so the user still sees the same data.
		return formatColaDeAccionesFeed(
			readColaDeAccionesFeed(status.project.stateRoot, { limit: 200 }),
		);
	}
	if (choice === "8") return formatDiagnosticsStatus(status);
	return [
		"Opción no reconocida. No ejecuté acciones.",
		"Usá `idu-pi` o `idu-pi setup wizard`.",
	].join("\n");
}

export async function handleModelProfilesChoice(
	choice: string,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	if (choice === "status") return formatModelProfilesStatus(status);
	if (choice === "edit") return editAgentProfiles(question, status);
	if (choice === "proposal")
		return proposeAgentLabModelAssignments(question, status);
	if (choice === "assign") return assignModelRole(question, status);
	if (choice === "validate") return validateAgentProfiles(status);
	return "Opción no reconocida. No ejecuté acciones.";
}

export async function editAgentProfilesTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const choice = await selectMenu("Editar perfiles", [
		{ label: "Editar PI_AGENT_PROFILES", value: "edit" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	]);
	if (choice !== "edit") return "Cancelado sin cambios.";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await editAgentProfiles(
			(prompt: string) => rl.question(prompt),
			status,
		);
	} finally {
		rl.close();
	}
}

export async function editAgentProfiles(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const raw = (
		await question("PI_AGENT_PROFILES (Enter vacío=volver, exit=salir): ")
	).trim();
	if (!raw || /^exit|salir|volver$/iu.test(raw))
		return "Cancelado sin cambios.";
	try {
		parseAgentProfiles(raw);
	} catch (error) {
		return `PI_AGENT_PROFILES inválido. No escribí .env.\n${error instanceof Error ? error.message : String(error)}`;
	}
	if (
		!(await confirmAction(
			question,
			"Guardar PI_AGENT_PROFILES en .env con backup?",
		))
	) {
		return "Cancelado sin cambios.";
	}
	const envPath = packageEnvPath(status.packageRoot);
	const result = writeEnvDraftWithBackup(envPath, readEnvDraft(envPath), {
		PI_AGENT_PROFILES: raw,
	});
	return [
		"Perfiles guardados en .env.",
		...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
	].join("\n");
}

export async function proposeAgentLabModelAssignments(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de proponer modelos por AgentLab.";
	const current = loadModelAssignments(stateRoot);
	const proposal = recommendAgentLabModelAssignments(
		status.agentProfiles,
		current,
		{
			cwd: status.cwd,
		},
	);
	const proposalText = formatAgentLabModelAssignmentProposal(
		proposal,
		status.agentProfiles,
	);
	if (proposal.status === "blocked") {
		return [
			proposalText,
			"",
			"No guardé cambios: la propuesta no tiene diversidad suficiente. Usá 'Asignar modelos por rol' o editá perfiles/modelos primero.",
		].join("\n");
	}
	if (
		!(await confirmAction(
			question,
			`${proposalText}\n\n¿Guardar esta propuesta en model-assignments.json?`,
		))
	) {
		return [
			proposalText,
			"",
			"Cancelado sin cambios. Podés ajustar manualmente con 'Asignar modelos por rol'.",
		].join("\n");
	}
	try {
		const nextAssignments = { ...current.assignments };
		for (const recommendation of proposal.recommendations) {
			nextAssignments[recommendation.roleId] =
				recommendation.recommendedProfileId;
		}
		const saved = saveModelAssignments(
			stateRoot,
			nextAssignments,
			status.agentProfiles,
		);
		return [
			"Propuesta AgentLab aprobada y guardada por el usuario.",
			"Idu-pi no rotó modelos automáticamente; esta escritura ocurrió sólo tras confirmación.",
			"",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar propuesta.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

export async function assignModelRoleTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de asignar modelos por rol.";
	let roleId: string;
	let profileId: string;
	while (true) {
		const assignments = loadModelAssignments(stateRoot);
		roleId = await selectSearchableMenu(
			"Elegir rol Idu-pi",
			[
				...IDU_MODEL_ROLES.map((role) => ({
					label: `${role.label} (${role.id}) — ${assignments.assignments[role.id] ?? "inherit"}`,
					value: role.id,
				})),
				{ label: "← Volver", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content:
					"Seleccioná qué rol querés configurar. Idu-pi sólo guarda la asignación después de confirmar.",
			},
		);
		if (roleId === "exit" || roleId === "__back" || roleId === "__exit")
			return "Cancelado sin cambios.";
		profileId = await selectModelAssignmentTui(status, roleId);
		if (profileId === "__back") continue;
		if (profileId === "exit" || profileId === "__exit")
			return "Cancelado sin cambios.";
		break;
	}
	let finalProfileId = profileId;
	if (finalProfileId === "__custom_model__") {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			finalProfileId = (
				await rl.question("Custom model id (provider/model): ")
			).trim();
		} finally {
			rl.close();
		}
	}
	const confirmation = await selectMenu("Confirmar asignación", [
		{ label: `Guardar ${roleId} -> ${finalProfileId}`, value: "yes" },
		{ label: "Cancelar", value: "no" },
	]);
	if (confirmation !== "yes") return "Cancelado sin cambios.";
	try {
		const saved = saveModelAssignment(
			stateRoot,
			roleId,
			finalProfileId,
			status.agentProfiles,
		);
		return [
			"Asignación guardada.",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar asignación.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

export async function selectModelAssignmentTui(
	status: ReturnType<typeof buildCliHomeStatus>,
	roleId: string,
): Promise<string> {
	const groups = modelAssignmentOptionGroups(status);
	while (true) {
		const choice = await selectSearchableMenu(
			"Elegir proveedor/modelo para el rol",
			[
				...groups.profiles.map((option) => ({
					label: option.label,
					value: option.value,
				})),
				...groups.providerGroups.map((group) => ({
					label: `[proveedor] ${group.label} — ${group.models.length} modelo${group.models.length === 1 ? "" : "s"}`,
					value: `__provider__:${group.key}`,
				})),
				...(groups.custom
					? [
							{
								label: `[avanzado] ${groups.custom.label}`,
								value: groups.custom.value,
							},
						]
					: []),
				{ label: "← Volver a roles", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content: [
					`Rol: ${roleId}`,
					"Modelos detectados en este entorno.",
					"Elegí un perfil, un proveedor/familia o la opción avanzada manual.",
				].join("\n"),
			},
		);
		if (!choice.startsWith("__provider__:")) return choice;
		const providerKey = choice.slice("__provider__:".length);
		const group = groups.providerGroups.find(
			(candidate) => candidate.key === providerKey,
		);
		if (!group) continue;
		const modelChoice = await selectSearchableMenu(
			`Elegir modelo — ${group.label}`,
			[
				...group.models.map((option) => ({
					label: option.label,
					value: option.value,
				})),
				{ label: "← Volver a proveedores", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content: [
					`Rol: ${roleId}`,
					`${group.label}: ${group.models.length} modelo${group.models.length === 1 ? "" : "s"} detectado${group.models.length === 1 ? "" : "s"}.`,
					"Se guarda el identificador técnico exacto provider/model.",
				].join("\n"),
			},
		);
		if (modelChoice === "__back") continue;
		return modelChoice;
	}
}

export async function promptModelAssignment(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string | undefined> {
	const groups = modelAssignmentOptionGroups(status);
	const providerOptions = groups.providerGroups.map((group) => ({
		value: `__provider__:${group.key}`,
		label: `[proveedor] ${group.label} — ${group.models.length} modelo${group.models.length === 1 ? "" : "s"}`,
	}));
	const firstStepOptions = [
		...groups.profiles.map((option) => ({
			value: option.value,
			label: option.label,
		})),
		...providerOptions,
		...(groups.custom
			? [
					{
						value: groups.custom.value,
						label: `[avanzado] ${groups.custom.label}`,
					},
				]
			: []),
	];
	const directOptions = modelAssignmentOptions(status);
	const firstStepText = firstStepOptions
		.map((option, index) => `${index + 1}. ${option.label}`)
		.join("\n");
	const answer = (
		await question(
			`Elegí perfil o proveedor/familia:\nModelos detectados en este entorno.\n${firstStepText}\nperfil/proveedor: `,
		)
	).trim();
	const directSelection = Number.isInteger(Number(answer))
		? undefined
		: resolveAssignmentSelection(answer, directOptions);
	if (directSelection) return directSelection;
	const firstSelection = resolveAssignmentSelection(answer, firstStepOptions);
	if (!firstSelection) return undefined;
	if (!firstSelection.startsWith("__provider__:")) return firstSelection;
	const providerKey = firstSelection.slice("__provider__:".length);
	const group = groups.providerGroups.find(
		(candidate) => candidate.key === providerKey,
	);
	if (!group) return undefined;
	const modelText = group.models
		.map((option, index) => `${index + 1}. ${option.label}`)
		.join("\n");
	const modelAnswer = (
		await question(`Elegí modelo de ${group.label}:\n${modelText}\nmodelo: `)
	).trim();
	return resolveAssignmentSelection(modelAnswer, group.models);
}

export async function assignModelRole(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de asignar modelos por rol.";
	const assignments = loadModelAssignments(stateRoot);
	const roleOptions = IDU_MODEL_ROLES.map(
		(role, index) =>
			`${index + 1}. ${role.label} (${role.id}) — ${assignments.assignments[role.id] ?? "inherit"}`,
	).join("\n");
	const roleAnswer = (
		await question(`Elegí rol por número o id:\n${roleOptions}\nrol: `)
	).trim();
	const roleId = resolveRoleSelection(roleAnswer);
	if (!roleId) return "Rol no reconocido. No escribí model-assignments.json.";
	let profileId = await promptModelAssignment(question, status);
	if (profileId === "__custom_model__") {
		profileId = (await question("Custom model id (provider/model): ")).trim();
	}
	if (!profileId)
		return "Perfil/modelo no reconocido. No escribí model-assignments.json.";
	try {
		if (
			!(await confirmAction(
				question,
				`Guardar asignación ${roleId} -> ${profileId} en model-assignments.json?`,
			))
		) {
			return "Cancelado sin cambios.";
		}
		const saved = saveModelAssignment(
			stateRoot,
			roleId,
			profileId,
			status.agentProfiles,
		);
		return [
			"Asignación guardada.",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar asignación.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

export async function runTelegramRemoteMenu(
	question: CliQuestion,
	print: CliPrint,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	print(formatTelegramRemoteMenu());
	const choice = (await question("\nElegí una opción [1-11]: ")).trim();
	if (choice === "10" || /^volver$/iu.test(choice))
		return "Volver sin cambios.";
	if (choice === "11" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	return handleTelegramRemoteChoice(choice, question, status, options);
}

export async function handleTelegramRemoteChoice(
	choice: string,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	const envPath = packageEnvPath(status.packageRoot);
	const logPath = join(status.packageRoot, "logs", "bridge.log");
	if (choice === "status" || choice === "1") {
		const draft = readEnvDraft(envPath);
		return formatBridgeEnvStatus({
			envPath,
			exists: existsSync(envPath),
			values: draft.values,
			packageRoot: status.packageRoot,
			startScriptExists: existsSync(
				join(status.packageRoot, "scripts", "start-bridge.ps1"),
			),
			stopScriptExists: existsSync(
				join(status.packageRoot, "scripts", "stop-bridge.ps1"),
			),
			logPath,
			logExists: existsSync(logPath),
			bridgeStatus: "unknown (sin shell riesgosa)",
		});
	}
	if (choice === "configure" || choice === "2") {
		const token = (await question("TELEGRAM_BOT_TOKEN: ")).trim();
		const userId = (await question("ALLOWED_USER_ID: ")).trim();
		const errors = validateBridgeEnvDraft({
			TELEGRAM_BOT_TOKEN: token,
			ALLOWED_USER_ID: userId,
		});
		if (errors.length)
			return `Configuración inválida:\n- ${errors.join("\n- ")}`;
		if (!(await confirmAction(question, "Guardar .env con backup?")))
			return "Cancelado sin cambios.";
		const result = writeEnvDraftWithBackup(envPath, readEnvDraft(envPath), {
			TELEGRAM_BOT_TOKEN: token,
			ALLOWED_USER_ID: userId,
		});
		return [
			"Acceso remoto guardado.",
			...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
			"Token guardado enmascarado; no se imprime el secreto.",
		].join("\n");
	}
	if (choice === "sync" || choice === "3") {
		return "La sincronización real de comandos remotos requiere el bot corriendo: usá /config sync_commands desde Telegram. No hay contexto bot.api en el CLI local.";
	}
	if (choice === "run" || choice === "4")
		return runBridgeLifecycleChoice("run", question, status, options);
	if (choice === "off" || choice === "5")
		return runBridgeLifecycleChoice("off", question, status, options);
	if (choice === "restart" || choice === "6")
		return runBridgeLifecycleChoice("restart", question, status, options);
	if (choice === "logs" || choice === "7") return tailTextFile(logPath, 80);
	if (choice === "save" || choice === "8")
		return "No hay draft pendiente; Configurar acceso remoto guarda con Save dentro del flujo.";
	if (choice === "discard" || choice === "9")
		return "No hay draft pendiente para descartar.";
	return "Opción Telegram remoto no reconocida. No ejecuté acciones.";
}

export async function runBridgeLifecycleChoice(
	action: BridgeLifecycleAction,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions,
): Promise<string> {
	if (
		!(await confirmAction(
			question,
			`${bridgeLifecycleReply(action)} ¿Continuar?`,
		))
	) {
		return "Cancelado sin cambios.";
	}
	(options.bridgeLauncher ?? launchBridgeLifecycle)(action, status.packageRoot);
	return bridgeLifecycleReply(action);
}

export async function runModelProfilesMenu(
	question: CliQuestion,
	print: CliPrint,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	print(formatModelProfilesMenu());
	const choice = (await question("\nElegí una opción [1-7]: ")).trim();
	if (choice === "6" || /^volver$/iu.test(choice)) return "Volver sin cambios.";
	if (choice === "7" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1" || choice === "assign")
		return assignModelRole(question, status);
	if (choice === "2" || choice === "status")
		return formatModelProfilesStatus(status);
	if (choice === "3" || choice === "proposal")
		return proposeAgentLabModelAssignments(question, status);
	if (choice === "4" || choice === "validate")
		return validateAgentProfiles(status);
	if (choice === "5" || choice === "edit")
		return editAgentProfiles(question, status);
	return "Opción no reconocida. No ejecuté acciones.";
}

export async function runInstallationMenu(
	question: CliQuestion,
	print: CliPrint,
): Promise<string> {
	print(formatInstallationMenu());
	const choice = (await question("\nElegí una opción [1-8]: ")).trim();
	return handleInstallationChoice(choice, question);
}

export async function handleInstallationChoice(
	choice: string,
	question: CliQuestion,
): Promise<string> {
	if (choice === "7" || /^volver$/iu.test(choice)) return "Volver sin cambios.";
	if (choice === "8" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1") return handleSetupCommand(["status"]);
	if (choice === "2") {
		if (
			!(await confirmAction(
				question,
				"Esto modificará ~/.pi/agent/mcp.json y/o extensions. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleSetupCommand(["mcp-init"]);
	}
	if (choice === "3") {
		if (
			!(await confirmAction(
				question,
				"Esto modificará ~/.pi/agent/mcp.json y/o extensions. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleSetupCommand(["mcp-init", "--force"]);
	}
	if (choice === "4") {
		if (
			!(await confirmAction(
				question,
				"Esto enrolará el proyecto actual y creará stateRoot. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleProjectCommand(["enroll", process.cwd()]);
	}
	if (choice === "5") {
		if (
			!(await confirmAction(question, "Esto activará guardrails. ¿Continuar?"))
		) {
			return "Cancelado sin cambios.";
		}
		return runWizardActivateSupervisor();
	}
	if (choice === "6") {
		const stateRoot = resolveSupervisorTriggerStateRootForTui();
		if (!stateRoot) {
			return [
				"No hay stateRoot del proyecto activo.",
				"Enrolá o bootstrappeá el proyecto antes de configurar el trigger.",
			].join("\n");
		}
		const status = getSupervisorTriggerStatus(stateRoot);
		if (status.enabled) {
			disableSupervisorTrigger(stateRoot, {
				source: "tui",
				now: new Date(),
			});
			return [
				"Trigger supervisor desactivado.",
				`stateRoot: ${stateRoot}`,
				'El script supervisor-tick se saltea con el motivo "skipped: trigger disabled by user".',
			].join("\n");
		}
		enableSupervisorTrigger(stateRoot, {
			source: "tui",
			now: new Date(),
		});
		return [
			"Trigger supervisor activado.",
			`stateRoot: ${stateRoot}`,
			"El script supervisor-tick corre normalmente (cuando no haya un CLI interactivo abierto).",
		].join("\n");
	}
	return "Opción de instalación no reconocida. No ejecuté acciones.";
}

export async function confirmAction(
	question: CliQuestion,
	message: string,
): Promise<boolean> {
	const answer = (await question(`${message} [y/N]: `)).trim().toLowerCase();
	return (
		answer === "y" ||
		answer === "yes" ||
		answer === "s" ||
		answer === "si" ||
		answer === "sí"
	);
}

