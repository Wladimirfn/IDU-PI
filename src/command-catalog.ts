export type TelegramCommandEntry = {
	command: string;
	description: string;
	help: string;
	usage?: string[];
};

export type LocalCommandEntry = {
	label: string;
	command: string;
};

export const TELEGRAM_COMMANDS: TelegramCommandEntry[] = [
	{
		command: "help",
		description: "Mostrar ayuda",
		help: "/help - mostrar ayuda y comandos principales",
	},
	{
		command: "comandos",
		description: "Ver comandos Telegram, CLI, Batch y PowerShell",
		help: "/comandos - ver comandos con argumentos y comandos locales",
	},
	{
		command: "status",
		description: "Ver estado del agente activo",
		help: "/status - ver estado RPC",
	},
	{
		command: "dashboard",
		description: "Ver panel operativo del bridge",
		help: "/dashboard - panel operativo",
	},
	{
		command: "server",
		description: "Controlar bridge Telegram",
		help: "/server status|run|restart|off - controlar bridge Telegram",
		usage: ["/server status", "/server run", "/server restart", "/server off"],
	},
	{
		command: "review",
		description: "Revisar cambios actuales",
		help: "/review - revisar cambios",
	},
	{
		command: "fix_tests",
		description: "Correr tests y arreglar fallas",
		help: "/fix_tests - arreglar tests",
	},
	{
		command: "audit",
		description: "Auditar repo",
		help: "/audit - auditar repo",
	},
	{
		command: "safe_push",
		description: "Checklist seguro antes de push",
		help: "/safe_push - checklist seguro antes de push",
	},
	{
		command: "task",
		description: "Crear tarea guiada",
		help: "/task bug|feature|refactor|docs - plantilla de tarea",
		usage: [
			"/task bug <detalle>",
			"/task feature <detalle>",
			"/task refactor <detalle>",
			"/task docs <detalle>",
		],
	},
	{
		command: "queue",
		description: "Ver cola de tareas",
		help: "/queue - ver cola",
	},
	{
		command: "queue_clear",
		description: "Limpiar cola de tareas",
		help: "/queue_clear - limpiar cola",
	},
	{
		command: "config",
		description: "Configuración guiada del proyecto",
		help: "/config [doctor|init_assets] - configuración guiada del bridge/proyecto",
		usage: ["/config", "/config doctor", "/config init_assets"],
	},
	{
		command: "doctor",
		description: "Diagnosticar configuración local",
		help: "/doctor - diagnosticar configuración local",
	},
	{
		command: "agents",
		description: "Elegir agente o modelo",
		help: "/agents - elegir agente/modelo",
	},
	{
		command: "model",
		description: "Alias informativo para agents",
		help: "/model - alias informativo para /agents",
	},
	{
		command: "testlab",
		description: "Ejecutar lab en agentes clone",
		help: "/testlab [profundidad] - tests en agentes lab",
		usage: [
			"/testlab quick",
			"/testlab 3tests",
			"/testlab 5tests",
			"/testlab full",
		],
	},
	{
		command: "testlab1",
		description: "Explicar agente 1 sin lab",
		help: "/testlab1 - explicar por qué agente 1 no usa lab",
	},
	{
		command: "testlab2",
		description: "Ejecutar lab en agente 2",
		help: "/testlab2 [profundidad] - tests en agente 2",
		usage: ["/testlab2 quick", "/testlab2 3tests"],
	},
	{
		command: "testlab3",
		description: "Ejecutar lab en agente 3",
		help: "/testlab3 [profundidad] - tests en agente 3",
		usage: ["/testlab3 quick", "/testlab3 3tests"],
	},
	{
		command: "gentest_model_lab",
		description: "Elegir agente lab",
		help: "/gentest_model_lab - elegir agente lab y profundidad",
	},
	{
		command: "triagereports",
		description: "Evaluar reportes lab",
		help: "/triagereports - evaluar reportes lab",
	},
	{
		command: "reports",
		description: "Listar reportes lab",
		help: "/reports - listar reportes lab",
	},
	{
		command: "report",
		description: "Ver o decidir reporte lab",
		help: "/report <id> - ver/decidir reporte lab",
		usage: [
			"/report <id>",
			"/report <id> defer",
			"/report <id> work",
			"/report <id> ignore",
			"/report <id> save",
		],
	},
	{
		command: "syncreports",
		description: "Guardar reportes aprobados",
		help: "/syncreports - guardar decisiones aprobadas en Engram",
	},
	{
		command: "projects",
		description: "Listar proyectos guardados",
		help: "/projects - listar proyectos guardados",
	},
	{
		command: "where",
		description: "Ver proyecto activo",
		help: "/where - ver proyecto activo",
	},
	{
		command: "addproject",
		description: "Agregar proyecto autorizado",
		help: "/addproject <id> <ruta> - agregar proyecto",
		usage: ["/addproject <id> <ruta>"],
	},
	{
		command: "useproject",
		description: "Cambiar proyecto activo",
		help: "/useproject <id> - cambiar proyecto activo",
		usage: ["/useproject <id>"],
	},
	{
		command: "cwd",
		description: "Cambiar carpeta activa",
		help: "/cwd <ruta> - cambiar carpeta/proyecto activo",
		usage: ["/cwd <ruta>"],
	},
	{
		command: "new",
		description: "Alias de cwd",
		help: "/new <ruta> - alias de /cwd",
		usage: ["/new <ruta>"],
	},
	{
		command: "trabajos",
		description: "Listar trabajos recientes",
		help: "/trabajos - elegir trabajo reciente",
		usage: ["/trabajos", "/trabajos all"],
	},
	{
		command: "work",
		description: "Alias de trabajos",
		help: "/work - alias de /trabajos",
	},
	{
		command: "ver",
		description: "Ver preview de trabajo",
		help: "/ver T<n> - ver preview del trabajo",
		usage: ["/ver T1"],
	},
	{
		command: "nametrabajo",
		description: "Nombrar trabajo",
		help: "/nametrabajo T<n> <nombre> - nombrar trabajo",
		usage: ["/nametrabajo T1 <nombre>"],
	},
	{
		command: "resume",
		description: "Retomar trabajo",
		help: "/resume T<n> - retomar trabajo listado",
		usage: ["/resume T1"],
	},
	{
		command: "last",
		description: "Retomar último trabajo",
		help: "/last - retomar último trabajo del proyecto activo",
	},
	{
		command: "sessions",
		description: "Alias legacy",
		help: "/sessions - alias legacy",
	},
	{ command: "use", description: "Alias legacy", help: "/use - alias legacy" },
	{
		command: "approve",
		description: "Alias legacy",
		help: "/approve - alias legacy",
	},
	{
		command: "reject",
		description: "Alias legacy",
		help: "/reject - alias legacy",
	},
	{
		command: "resumen",
		description: "Resumir proyecto o trabajo",
		help: "/resumen [n] - resumen del proyecto o trabajo",
		usage: ["/resumen", "/resumen T1"],
	},
	{
		command: "mem",
		description: "Buscar contexto en Engram",
		help: "/mem <query> - buscar contexto en Engram vía Pi",
		usage: ["/mem <query>"],
	},
	{
		command: "mode",
		description: "Ajustar modo de orquestación",
		help: "/mode interactive|auto|clear - ajustar orquestación",
		usage: ["/mode interactive", "/mode auto", "/mode clear"],
	},
	{
		command: "cancel",
		description: "Cancelar tarea actual",
		help: "/cancel - cancelar tarea actual",
	},
];

export const CLI_COMMANDS: LocalCommandEntry[] = [
	{ label: "Instalar dependencias", command: "corepack pnpm install" },
	{ label: "Setup inicial", command: "corepack pnpm setup" },
	{ label: "Desarrollo", command: "corepack pnpm dev" },
	{ label: "Iniciar build existente", command: "corepack pnpm start" },
	{ label: "Servicio bridge", command: "corepack pnpm serve" },
	{ label: "Compilar", command: "corepack pnpm build" },
	{ label: "Tests", command: "corepack pnpm test" },
	{ label: "Limpiar outputs", command: "corepack pnpm clean" },
];

export const BATCH_COMMANDS: LocalCommandEntry[] = [
	{ label: "Setup inicial", command: "setup-pi-telegram-bridge.bat" },
	{ label: "Iniciar bridge", command: "start-pi-telegram-bridge.bat" },
	{ label: "Apagar bridge", command: "stop-pi-telegram-bridge.bat" },
	{ label: "Instalar tarea Windows", command: "install-idu-pi-task.bat" },
	{ label: "Estado tarea Windows", command: "status-idu-pi-task.bat" },
	{ label: "Desinstalar tarea Windows", command: "uninstall-idu-pi-task.bat" },
];

export const POWERSHELL_COMMANDS: LocalCommandEntry[] = [
	{
		label: "Iniciar bridge",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-bridge.ps1",
	},
	{
		label: "Apagar bridge",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-bridge.ps1",
	},
	{
		label: "Instalar tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-scheduled-task.ps1",
	},
	{
		label: "Estado tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/scheduled-task-status.ps1",
	},
	{
		label: "Desinstalar tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-scheduled-task.ps1",
	},
];

export function formatHelpText(): string {
	return `Comandos:\n${TELEGRAM_COMMANDS.map((entry) => entry.help).join("\n")}\n\nDespués de /trabajos usá T1, T2...; en otros menús seguí la instrucción visible.\nPara ver usos con argumentos, CLI, Batch y PowerShell: /comandos`;
}

export function formatBotFatherCommands(): string {
	return TELEGRAM_COMMANDS.map(
		(entry) => `${entry.command} - ${entry.description}`,
	).join("\n");
}

function formatLocalSection(
	title: string,
	entries: LocalCommandEntry[],
): string {
	return `${title}\n${entries.map((entry) => `- ${entry.label}: ${entry.command}`).join("\n")}`;
}

export function formatCommandCatalog(): string {
	const usage = TELEGRAM_COMMANDS.flatMap((entry) => entry.usage ?? []);
	return [
		`Telegram — /setcommands\n${formatBotFatherCommands()}`,
		`Telegram — usos con argumentos\n${usage.map((command) => `- ${command}`).join("\n")}`,
		formatLocalSection("CLI pnpm", CLI_COMMANDS),
		formatLocalSection("Batch directos", BATCH_COMMANDS),
		formatLocalSection("PowerShell directos", POWERSHELL_COMMANDS),
	].join("\n\n");
}
