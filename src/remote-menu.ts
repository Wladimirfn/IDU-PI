import type { ProjectRegistry } from "./projects.js";
import { getActiveProject } from "./projects.js";
import type { TelegramInlineKeyboard } from "./telegram-ui.js";

export type IduRemoteCallback =
	| { type: "menu" }
	| { type: "projects" }
	| { type: "run"; command: IduRemoteCommand }
	| { type: "project"; projectId: string };

export type IduRemoteCommand =
	| "idu"
	| "idu_status"
	| "idu_prepare"
	| "queue_detail"
	| "dashboard"
	| "doctor"
	| "projects";

const REMOTE_CALLBACK_PREFIX = "idu-remote";
const SAFE_PROJECT_ID_PATTERN = /^[a-z0-9._-]{1,40}$/u;
const REMOTE_COMMANDS = new Set<IduRemoteCommand>([
	"idu",
	"idu_status",
	"idu_prepare",
	"queue_detail",
	"dashboard",
	"doctor",
	"projects",
]);

export function buildIduRemoteMenuText(activeProjectLabel = "unknown"): string {
	return [
		"IDU-Pi remoto",
		"",
		"Telegram es un control remoto del CLI/supervisor, no otro core.",
		`Proyecto activo: ${activeProjectLabel}`,
		"",
		"Usá los botones para atajos rápidos o mandá texto libre: el bridge lo pasa al mismo flujo del CLI/supervisor.",
		"Las confirmaciones siguen apareciendo acá como botones remotos.",
	].join("\n");
}

export function buildIduRemoteMenuKeyboard(): TelegramInlineKeyboard {
	return {
		inline_keyboard: [
			[
				remoteRunButton("🚦 Activar supervisor", "idu"),
				remoteRunButton("📊 Estado", "idu_status"),
			],
			[
				{
					text: "📁 Cambiar proyecto",
					callback_data: remoteProjectsCallback(),
				},
				remoteRunButton("🧭 Preparar", "idu_prepare"),
			],
			[
				remoteRunButton("📋 Tareas", "queue_detail"),
				remoteRunButton("🩺 Diagnóstico", "doctor"),
			],
			[
				remoteRunButton("🏠 Dashboard", "dashboard"),
				remoteRunButton("📚 Proyectos", "projects"),
			],
		],
	};
}

export function formatIduRemoteProjectList(registry: ProjectRegistry): string {
	const active = getActiveProject(registry);
	const lines = registry.projects.map((project) => {
		const marker = project.id === active?.id ? "▸" : " ";
		return `${marker} ${project.id} — ${project.name}\n  ${project.path}`;
	});
	return [
		"Proyectos enrolados en IDU-Pi",
		"",
		lines.join("\n"),
		"",
		"Elegí un proyecto para activarlo. Este flujo no enrola proyectos nuevos.",
	].join("\n");
}

export function buildIduRemoteProjectKeyboard(
	registry: ProjectRegistry,
): TelegramInlineKeyboard {
	const active = getActiveProject(registry);
	const rows = registry.projects.map((project) => [
		{
			text: `${project.id === active?.id ? "✅ " : ""}${project.name}`,
			callback_data: remoteProjectCallback(project.id),
		},
	]);
	return {
		inline_keyboard: [
			...rows,
			[{ text: "← Menú remoto", callback_data: remoteMenuCallback() }],
		],
	};
}

export function formatIduRemoteCommandHint(command: IduRemoteCommand): string {
	const descriptions: Record<IduRemoteCommand, string> = {
		idu: "Activar supervisor para el proyecto activo",
		idu_status: "Ver estado de IDU-Pi",
		idu_prepare: "Preparar el proyecto de forma segura",
		queue_detail: "Ver tareas y cola",
		dashboard: "Ver panel operativo",
		doctor: "Ejecutar diagnóstico",
		projects: "Listar proyectos enrolados",
	};
	return [
		`Atajo remoto: /${command}`,
		"",
		descriptions[command],
		"",
		"Este botón apunta al mismo comando del CLI/supervisor. Si necesitás seguir, tocá el comando o escribilo como mensaje.",
	].join("\n");
}

export function parseIduRemoteCallback(
	data: string,
): IduRemoteCallback | undefined {
	if (data === remoteMenuCallback()) return { type: "menu" };
	if (data === remoteProjectsCallback()) return { type: "projects" };
	const run = data.match(/^idu-remote:run:([a-z0-9_]+)$/u);
	if (run) {
		const command = run[1] as IduRemoteCommand;
		return REMOTE_COMMANDS.has(command) ? { type: "run", command } : undefined;
	}
	const project = data.match(/^idu-remote:project:([a-z0-9._-]+)$/u);
	if (project) {
		const projectId = project[1];
		return SAFE_PROJECT_ID_PATTERN.test(projectId)
			? { type: "project", projectId }
			: undefined;
	}
	return undefined;
}

function remoteRunButton(text: string, command: IduRemoteCommand) {
	return { text, callback_data: `${REMOTE_CALLBACK_PREFIX}:run:${command}` };
}

function remoteMenuCallback(): string {
	return `${REMOTE_CALLBACK_PREFIX}:menu`;
}

function remoteProjectsCallback(): string {
	return `${REMOTE_CALLBACK_PREFIX}:projects`;
}

function remoteProjectCallback(projectId: string): string {
	return `${REMOTE_CALLBACK_PREFIX}:project:${projectId}`;
}
