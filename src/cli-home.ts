import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	canonicalDirectory,
	isAllowedCwd,
	parseAgentProfiles,
	type AgentProfile,
} from "./config.js";
import {
	formatModelAssignments,
	loadModelAssignments,
} from "./model-assignments.js";
import {
	detectGlobalIduInstall,
	detectTools,
	formatPnpmPathHelp,
	projectInstallStatus,
	resolvePiAgentDir,
	type GlobalIduInstallStatus,
	type ToolStatus,
} from "./idu-installer.js";
import { resolveProjectStatePaths } from "./project-state.js";
import { loadProjectCore } from "./project-core.js";
import { slugifyProjectId } from "./projects.js";
import {
	buildIduUsageReport,
	formatIduUsagePanel,
	readIduUsageEvents,
} from "./usage-events.js";
import {
	buildSupervisorActivityReport,
	formatSupervisorActivityPanel,
	readSupervisorActivityEvents,
} from "./supervisor-activity-events.js";
import {
	buildContextQualityReport,
	formatContextQualityPanel,
	readContextQualityEvents,
} from "./context-quality-events.js";

export type CliHomeOptions = {
	cwd?: string;
	argvPath?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	stdinInteractive?: boolean;
	version?: string;
	exists?: (path: string) => boolean;
	runner?: (command: string, args: string[]) => string | undefined;
	gitRoot?: string | null;
	registryPath?: string;
};

export type CliHomeProjectStatus = {
	candidatePath: string;
	isGitRepository: boolean;
	registered: boolean;
	projectId: string;
	stateRoot?: string;
	labDbPath?: string;
	reportsDir?: string;
	supervisor: "active" | "inactive" | "unknown";
	projectCore: "confirmed" | "pending" | "missing" | "unknown";
	constitution: "active" | "stale" | "draft" | "missing" | "unknown";
	allowedRoot: boolean | "unknown";
	recommendedNext: "enroll" | "bootstrap" | "confirm_core" | "idu" | "prepare";
	warning?: string;
};

export type CliMcpRuntimeStatus =
	| "absent"
	| "fresh"
	| "source_newer"
	| "missing"
	| "unknown";

export type CliMcpRuntimeDiagnostic = {
	installed: boolean;
	status: CliMcpRuntimeStatus;
	serverPath?: string;
	recommendedAction?: string;
};

export type CliHomeStatus = {
	version: string;
	cwd: string;
	packageRoot: string;
	agentDir: string;
	node: ToolStatus;
	git: ToolStatus;
	pnpm: ToolStatus;
	nodeFound: boolean;
	gitFound: boolean;
	mcpInstalled: boolean;
	mcpRuntime: CliMcpRuntimeDiagnostic;
	commandExtensionInstalled: boolean;
	globalInstall: GlobalIduInstallStatus;
	agentProfiles: AgentProfile[];
	project: CliHomeProjectStatus;
	stdinInteractive: boolean;
};

export function buildCliHomeStatus(
	options: CliHomeOptions = {},
): CliHomeStatus {
	const env = options.env ?? mergedPackageEnv();
	const exists = options.exists ?? existsSync;
	const cwd = resolve(options.cwd ?? process.cwd());
	const tools = detectTools({ env, runner: options.runner });
	const agentDir = resolvePiAgentDir({ env });
	const mcpRuntime = inspectMcpRuntime(join(agentDir, "mcp.json"), exists);
	const mcpInstalled = mcpRuntime.installed;
	const commandExtensionInstalled = exists(
		join(agentDir, "extensions", "idu-pi-commands.ts"),
	);
	const globalInstall = detectGlobalIduInstall({
		env,
		argvPath: options.argvPath,
		runner: options.runner,
	});
	return {
		version: options.version ?? readPackageVersion(),
		cwd,
		packageRoot: resolveCliPackageRoot(),
		agentDir,
		node: tools.node,
		git: tools.git,
		pnpm: tools.packageManagers.pnpm,
		nodeFound: tools.node.found,
		gitFound: tools.git.found,
		mcpInstalled,
		mcpRuntime,
		commandExtensionInstalled,
		globalInstall,
		agentProfiles: safeParseAgentProfiles(env.PI_AGENT_PROFILES),
		project: detectHomeProjectStatus({ ...options, cwd, env, exists }),
		stdinInteractive: options.stdinInteractive ?? Boolean(process.stdin.isTTY),
	};
}

const ANSI_RESET = "\x1b[0m";
const ANSI_DARK_PURPLE = "\x1b[35m";
const ANSI_BRIGHT_PURPLE = "\x1b[95m";
const ANSI_DIM = "\x1b[2m";

export function formatIduLogo(): string {
	return colorBrand(
		[
			"██╗██████╗ ██╗   ██╗      ██████╗  ██╗",
			"██║██╔══██╗██║   ██║      ██╔══██╗ ██║",
			"██║██║  ██║██║   ██║████╗██████╔╝ ██║",
			"██║██║  ██║██║   ██║╚═══╝██╔═══╝  ██║",
			"██║██████╔╝╚██████╔╝     ██║      ██║",
			"╚═╝╚═════╝  ╚═════╝      ╚═╝      ╚═╝",
			"IDU-Pi",
		].join("\n"),
	);
}

function colorBrand(text: string): string {
	return text
		.split("\n")
		.map((line, index) => {
			const color =
				index < 2
					? ANSI_BRIGHT_PURPLE
					: index < 5
						? ANSI_DARK_PURPLE
						: ANSI_DIM;
			return `${color}${line}${ANSI_RESET}`;
		})
		.join("\n");
}

function safeParseAgentProfiles(raw?: string): AgentProfile[] {
	try {
		return parseAgentProfiles(raw);
	} catch {
		return parseAgentProfiles();
	}
}

function formatModelProjectLabel(project: CliHomeProjectStatus): string {
	if (!project.registered) return "proyecto no registrado";
	if (project.isGitRepository) return project.projectId;
	return `${project.projectId} (detectado desde carpeta no-git)`;
}

export function formatMainMenu(status: CliHomeStatus): string {
	return [
		formatIduLogo(),
		"",
		`version: ${status.version}`,
		"",
		"1. Configurar IDU-Pi",
		"2. Proyecto actual",
		"3. Telegram remoto",
		"4. Modelos y perfiles",
		"5. Supervisor",
		"6. Tareas",
		"7. Cola de acciones",
		"8. Diagnóstico",
		"9. Exit",
	].join("\n");
}

export function formatInstallationMenu(): string {
	return [
		"Configurar IDU-Pi",
		"",
		"1. Verificar sistema",
		"2. Instalar/actualizar MCP en Pi",
		"3. Instalar/actualizar comandos slash globales",
		"4. Enrolar proyecto actual",
		"5. Activar supervisor en este proyecto",
		"6. Trigger supervisor",
		"7. ← Volver",
		"8. Exit",
	].join("\n");
}

export function formatCliSystemStatus(status: CliHomeStatus): string {
	return [
		"Estado Idu-pi",
		"",
		`version: ${status.version}`,
		`package root: ${status.packageRoot}`,
		`ejecución: ${status.globalInstall.executionMode}`,
		`node: ${formatTool(status.node)}`,
		`git: ${formatTool(status.git)}`,
		`pnpm: ${formatTool(status.pnpm)}`,
		`Pi agent dir: ${status.agentDir}`,
		`MCP idu-pi: ${status.mcpInstalled ? "presente" : "ausente"}`,
		formatMcpRuntimeLine(status.mcpRuntime),
		`Extensión Pi: ${status.commandExtensionInstalled ? "presente" : "ausente"}`,
		`pnpm global bin en PATH: ${status.globalInstall.pnpmGlobalBinInPath ? "sí" : "no"}`,
		`recommended action: ${status.globalInstall.recommendedAction ?? "ninguna"}`,
	].join("\n");
}

export function formatCliConfigurationStatus(status: CliHomeStatus): string {
	return [
		"Configuración Idu-pi",
		"",
		`package root: ${status.packageRoot}`,
		`Pi agent dir: ${status.agentDir}`,
		`MCP config: ${join(status.agentDir, "mcp.json")}`,
		`Extensión slash Pi: ${join(status.agentDir, "extensions", "idu-pi-commands.ts")}`,
		`Registry proyectos: ${resolveIduRegistryPath()}`,
		`Shim idu-pi recomendado: ${status.globalInstall.pnpmGlobalBin ?? "unknown"}`,
		`MCP idu-pi: ${status.mcpInstalled ? "presente" : "ausente"}`,
		formatMcpRuntimeLine(status.mcpRuntime),
		`Extensión Pi: ${status.commandExtensionInstalled ? "presente" : "ausente"}`,
		"",
		"Comandos de configuración:",
		"- idu-pi setup status",
		"- idu-pi setup mcp-init",
		"- idu-pi setup path-help",
		"- idu-pi project status .",
	].join("\n");
}

export function formatTelegramRemoteMenu(): string {
	return [
		"Telegram remoto",
		"",
		"1. Ver estado remoto",
		"2. Configurar acceso remoto",
		"3. Sincronizar comandos remotos",
		"4. Iniciar puente remoto",
		"5. Detener puente remoto",
		"6. Reiniciar puente remoto",
		"7. Ver logs",
		"8. Save",
		"9. Descartar",
		"10. ← Volver",
		"11. Exit",
	].join("\n");
}

export function formatTelegramRemoteStatus(status: CliHomeStatus): string {
	return [
		"Telegram remoto",
		"",
		"Telegram replica el CLI/supervisor en remoto; no es otro core.",
		`package root: ${status.packageRoot}`,
		`config esperada: ${join(status.packageRoot, ".env")}`,
		`start script: ${join(status.packageRoot, "scripts", "start-bridge.ps1")}`,
		`stop script: ${join(status.packageRoot, "scripts", "stop-bridge.ps1")}`,
		`logs: ${join(status.packageRoot, "logs", "bridge.log")}`,
		"",
		"Usá el submenu para configurar, sincronizar comandos, iniciar/detener el puente o ver logs.",
	].join("\n");
}

export function formatModelProfilesMenu(): string {
	return [
		"Modelos Idu-pi",
		"",
		"1. Asignar modelo por rol",
		"2. Ver asignaciones actuales",
		"3. Propuesta automática por AgentLab",
		"4. Validar configuración",
		"5. Avanzado: editar PI_AGENT_PROFILES",
		"6. ← Volver",
		"7. Exit",
	].join("\n");
}

export function formatModelProfilesStatus(status: CliHomeStatus): string {
	const profiles = status.agentProfiles.length
		? status.agentProfiles
		: parseAgentProfiles();
	const assignments = status.project.stateRoot
		? loadModelAssignments(status.project.stateRoot)
		: { version: 1 as const, assignments: {} };
	return [
		"Modelos Idu-pi",
		"",
		"Configurá qué modelo usa cada rol del supervisor y AgentLabs.",
		"Los cambios se guardan por proyecto después de confirmación.",
		"",
		"Contexto actual:",
		`- Proyecto: ${formatModelProjectLabel(status.project)}`,
		...(status.project.stateRoot
			? [`- StateRoot: ${status.project.stateRoot}`]
			: ["- StateRoot: no configurado"]),
		"",
		"Asignaciones actuales:",
		"",
		...(status.project.stateRoot
			? formatModelAssignments(assignments, profiles).split("\n").slice(2)
			: [
					"  - sin stateRoot; registrá el proyecto antes de guardar asignaciones",
				]),
		"",
		"Acciones disponibles:",
		"- Asignar modelo por rol",
		"- Ver asignaciones actuales",
		"- Validar configuración",
		"- Avanzado: editar PI_AGENT_PROFILES",
		"",
		"Tip: abrí idu-pi desde la carpeta del proyecto que querés configurar.",
	].join("\n");
}

export function formatSupervisorStatus(status: CliHomeStatus): string {
	const project = status.project;
	return [
		"Supervisor",
		"",
		`session: ${project.supervisor}`,
		`projectId: ${project.projectId}`,
		`Project Core: ${project.projectCore}`,
		`Constitution: ${project.constitution}`,
		"",
		"Acciones CLI:",
		"- idu-pi idu",
		"- idu-pi idu-status",
		"- idu-pi idu-off",
		"- idu-pi idu-supervisor-tick",
		"",
		"MVP seguro: esta pantalla no activa ni ejecuta el supervisor.",
	].join("\n");
}

export function formatTaskQueueStatus(): string {
	return [
		"Tareas",
		"",
		"Vista de solo lectura del task list estructurado.",
		"Acciones CLI:",
		'- idu-pi idu-task "detalle"',
		"- idu-pi idu-queue-detail",
		"- idu-pi idu-queue-approve <id>",
		"- idu-pi idu-queue-reject <id>",
		"- idu-pi idu-queue-clear-structured",
		"",
		"MVP seguro: esta pantalla no ejecuta IA ni AgentLabs.",
	].join("\n");
}

export function formatDiagnosticsStatus(status: CliHomeStatus): string {
	return [
		"Diagnóstico",
		"",
		formatCliSystemStatus(status),
		"",
		formatCliConfigurationStatus(status),
		"",
		"Ayuda PATH",
		formatSetupPathHelp(),
	].join("\n");
}

export function formatCliProjectStatus(status: CliHomeStatus): string {
	const project = status.project;
	const usagePanel =
		project.registered && project.stateRoot
			? [
					"",
					formatIduUsagePanel(
						buildIduUsageReport(readIduUsageEvents(project.stateRoot, 500)),
					),
				]
			: [];
	const supervisorActivityPanel =
		project.registered && project.stateRoot
			? [
					"",
					formatSupervisorActivityPanel(
						buildSupervisorActivityReport(
							readSupervisorActivityEvents(project.stateRoot, 500),
						),
					),
				]
			: [];
	const contextQualityPanel =
		project.registered && project.stateRoot
			? [
					"",
					formatContextQualityPanel(
						buildContextQualityReport(
							readContextQualityEvents(project.stateRoot, 500),
						),
					),
				]
			: [];
	return [
		"Proyecto actual",
		"",
		`ruta: ${project.candidatePath}`,
		`git repo: ${project.isGitRepository ? "sí" : "no"}`,
		`allowedRoots: ${project.allowedRoot === true ? "sí" : project.allowedRoot === false ? "no" : "unknown"}`,
		`enrolado: ${project.registered ? "sí" : "no"}`,
		`projectId: ${project.projectId}`,
		...(project.stateRoot ? [`stateRoot: ${project.stateRoot}`] : []),
		`session: ${project.supervisor}`,
		`Project Core: ${project.projectCore}`,
		`Constitution: ${project.constitution}`,
		...usagePanel,
		...supervisorActivityPanel,
		...contextQualityPanel,
		`recommended next: ${project.recommendedNext}`,
		...(project.warning ? [`aviso: ${project.warning}`] : []),
	].join("\n");
}

export function formatCliHome(status: CliHomeStatus): string {
	const project = status.project;
	return [
		...(status.stdinInteractive ? [formatMainMenu(status), ""] : []),
		"Idu-pi",
		`version: ${status.version}`,
		"",
		"Proyecto actual:",
		project.candidatePath,
		"",
		"Estado:",
		`- node: ${formatTool(status.node)}`,
		`- git: ${formatTool(status.git)}`,
		`- pnpm: ${formatTool(status.pnpm)}`,
		`- MCP idu-pi: ${status.mcpInstalled ? "instalado" : "no instalado"}`,
		`- Extensión Pi: ${status.commandExtensionInstalled ? "instalada" : "no instalada"}`,
		`- Proyecto git: ${project.isGitRepository ? "sí" : "no"}`,
		`- Proyecto enrolado: ${project.registered ? "sí" : "no"}`,
		`- Supervisor: ${project.supervisor}`,
		`- Project Core: ${project.projectCore}`,
		`- Constitution: ${project.constitution}`,
		`- recommended next: ${project.recommendedNext}`,
		...(project.stateRoot ? [`- stateRoot: ${project.stateRoot}`] : []),
		...(project.warning ? [`- aviso: ${project.warning}`] : []),
		"",
		"Acciones:",
		"1. Activar supervisor: idu-pi idu",
		"2. Preparar proyecto: idu-pi prepare",
		"3. Ver estado: idu-pi project status .",
		"4. Configuración: idu-pi setup status",
		"",
		"Comandos recomendados:",
		status.mcpInstalled ? "- MCP ya está instalado" : "- idu-pi setup mcp-init",
		project.registered
			? "- idu-pi idu-status"
			: project.isGitRepository
				? "- idu-pi project enroll ."
				: "- idu-pi project enroll <path>",
		"- idu-pi setup path-help",
		"",
		"Instalación global:",
		`- idu-pi global: ${status.globalInstall.iduPiLikelyGlobal ? "disponible" : "no disponible"}`,
		`- pnpm global bin en PATH: ${status.globalInstall.pnpmGlobalBinInPath ? "sí" : "no"}`,
		...(status.globalInstall.pnpmGlobalBinInPath
			? []
			: [
					"- PNPM_HOME no está en PATH",
					"- Acción recomendada: corepack pnpm setup; abrir nueva terminal; corepack pnpm link --global",
				]),
		...(status.stdinInteractive
			? ["", "Elegí una opción del menú superior."]
			: ["", "Modo no interactivo: mostré resumen y no espero input."]),
	].join("\n");
}

export function formatSetupWizardNonInteractive(
	status: CliHomeStatus = buildCliHomeStatus({ stdinInteractive: false }),
): string {
	return [
		formatCliHome({ ...status, stdinInteractive: false }),
		"",
		"Wizard:",
		"stdin no es interactivo; no espero input ni escribo archivos.",
		"Ejecutá `idu-pi` en una terminal interactiva para elegir acciones.",
	].join("\n");
}

export function formatSetupPathHelp(
	status: GlobalIduInstallStatus = detectGlobalIduInstall(),
): string {
	return formatPnpmPathHelp(status);
}

function detectHomeProjectStatus(
	options: CliHomeOptions & {
		cwd: string;
		env: NodeJS.ProcessEnv | Record<string, string | undefined>;
		exists: (path: string) => boolean;
	},
): CliHomeProjectStatus {
	const gitRoot = options.gitRoot ?? detectGitRoot(options.cwd, options.runner);
	const candidatePath = gitRoot ?? options.cwd;
	const isGitRepository = Boolean(gitRoot);
	const env = options.env;
	const workspaceRoot =
		env.AGENT_WORKSPACE_ROOT?.trim() ||
		join(resolveHomeFallback(), "Documents", "bridge-agents");
	const allowedRoots = parseAllowedRoots(env.ALLOWED_ROOTS, env.DEFAULT_CWD);
	if (!allowedRoots.length) {
		const projectId =
			slugifyProjectId(candidatePath.split(/[\\/]/u).at(-1) ?? "project") ||
			"project";
		const paths = resolveProjectStatePaths({
			workspaceRoot,
			projectId,
			projectPath: candidatePath,
		});
		return {
			candidatePath,
			isGitRepository,
			registered: false,
			projectId,
			stateRoot: paths.stateRoot,
			supervisor: "unknown",
			projectCore: projectCoreStatus(candidatePath, options.exists),
			constitution: constitutionStatus(candidatePath, options.exists),
			allowedRoot: "unknown",
			recommendedNext: "enroll",
			warning:
				"DEFAULT_CWD/ALLOWED_ROOTS no están configurados; usá ruta explícita para enrolar.",
		};
	}
	try {
		const canonicalCandidate = canonicalDirectory(candidatePath);
		if (!isAllowedCwd(canonicalCandidate, allowedRoots)) {
			const projectId =
				slugifyProjectId(
					canonicalCandidate.split(/[\\/]/u).at(-1) ?? "project",
				) || "project";
			const paths = resolveProjectStatePaths({
				workspaceRoot,
				projectId,
				projectPath: canonicalCandidate,
			});
			return {
				candidatePath: canonicalCandidate,
				isGitRepository,
				registered: false,
				projectId,
				stateRoot: paths.stateRoot,
				supervisor: "unknown",
				projectCore: projectCoreStatus(canonicalCandidate, options.exists),
				constitution: constitutionStatus(canonicalCandidate, options.exists),
				allowedRoot: false,
				recommendedNext: "enroll",
				warning:
					"cwd fuera de ALLOWED_ROOTS; usá una ruta permitida o ajustá configuración.",
			};
		}
		const status = projectInstallStatus({
			projectPath: canonicalCandidate,
			workspaceRoot,
			allowedRoots,
			mcpAvailable: false,
			registryPath: options.registryPath ?? resolveIduRegistryPath(options.env),
		});
		const supervisor = readSupervisorStatus(
			status.projectId,
			status.stateRoot,
			options.exists,
		);
		const projectCore = projectCoreStatus(canonicalCandidate, options.exists);
		return {
			candidatePath: canonicalCandidate,
			isGitRepository,
			registered: status.registered,
			projectId: status.projectId,
			stateRoot: status.stateRoot,
			labDbPath: status.labDbPath,
			reportsDir: status.reportsDir,
			supervisor,
			projectCore,
			constitution: constitutionStatus(canonicalCandidate, options.exists),
			allowedRoot: true,
			recommendedNext: recommendedProjectNext(
				status.registered,
				supervisor,
				projectCore,
			),
		};
	} catch (error) {
		const projectId =
			slugifyProjectId(candidatePath.split(/[\\/]/u).at(-1) ?? "project") ||
			"project";
		return {
			candidatePath,
			isGitRepository,
			registered: false,
			projectId,
			supervisor: "unknown",
			projectCore: "unknown",
			constitution: "unknown",
			allowedRoot: "unknown",
			recommendedNext: "enroll",
			warning: error instanceof Error ? error.message : String(error),
		};
	}
}

function formatTool(status: ToolStatus): string {
	return status.found
		? `found${status.version ? ` (${status.version})` : ""}`
		: "missing";
}

function recommendedProjectNext(
	registered: boolean,
	supervisor: CliHomeProjectStatus["supervisor"],
	projectCore: CliHomeProjectStatus["projectCore"],
): CliHomeProjectStatus["recommendedNext"] {
	if (!registered) return "enroll";
	if (projectCore === "missing") return "bootstrap";
	if (projectCore === "pending") return "confirm_core";
	if (supervisor !== "active") return "idu";
	return "prepare";
}

function parseAllowedRoots(
	raw: string | undefined,
	defaultCwd: string | undefined,
): string[] {
	return (raw?.trim() ? raw.split(";") : defaultCwd ? [defaultCwd] : [])
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function detectGitRoot(
	cwd: string,
	runner?: (command: string, args: string[]) => string | undefined,
): string | null {
	try {
		const output = runner
			? runner("git", ["-C", cwd, "rev-parse", "--show-toplevel"])
			: execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				});
		const root = output?.trim();
		return root ? resolve(root) : null;
	} catch {
		return null;
	}
}

function projectCoreStatus(
	projectPath: string,
	_exists: (path: string) => boolean,
): CliHomeProjectStatus["projectCore"] {
	// F-Item3a: route through the canonical loader (Layout A via
	// readIdPathWithMigration). The pre-fix version hardcoded
	// Layout B (`<projectPath>/config/project-core.json`); the canonical
	// file lives at `<projectPath>/.idu/config/project-core.json`.
	// The pre-fix returned "pending" even when the file at Layout A
	// was `status: "confirmed"`. `loadProjectCore` handles both
	// layouts + one-time migration internally.
	try {
		const core = loadProjectCore(projectPath);
		return core.status === "confirmed" ? "confirmed" : "pending";
	} catch {
		return "pending";
	}
}

function constitutionStatus(
	projectPath: string,
	exists: (path: string) => boolean,
): CliHomeProjectStatus["constitution"] {
	const constitutionPath = join(
		projectPath,
		"config",
		"project-constitution.json",
	);
	if (!exists(constitutionPath)) return "missing";
	try {
		const parsed = JSON.parse(readFileSync(constitutionPath, "utf8")) as {
			status?: string;
		};
		if (parsed.status === "active") return "active";
		if (parsed.status === "stale") return "stale";
		return "draft";
	} catch {
		return "unknown";
	}
}

function readSupervisorStatus(
	projectId: string,
	stateRoot: string,
	exists: (path: string) => boolean,
): "active" | "inactive" | "unknown" {
	const sessionPath = join(stateRoot, "idu-session-state.json");
	if (!exists(sessionPath)) return "inactive";
	try {
		const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as {
			projects?: Record<string, { active?: boolean }>;
		};
		return parsed.projects?.[projectId]?.active === true
			? "active"
			: "inactive";
	} catch {
		return "unknown";
	}
}

function inspectMcpRuntime(
	path: string,
	exists: (path: string) => boolean,
): CliMcpRuntimeDiagnostic {
	if (!exists(path)) return { installed: false, status: "absent" };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			mcpServers?: Record<string, { args?: unknown }>;
		};
		const server = parsed.mcpServers?.["idu-pi"];
		if (!server) return { installed: false, status: "absent" };
		const serverPath =
			Array.isArray(server.args) && typeof server.args[0] === "string"
				? server.args[0]
				: undefined;
		if (!serverPath) return { installed: true, status: "unknown" };
		if (!exists(serverPath)) {
			return {
				installed: true,
				status: "missing",
				serverPath,
				recommendedAction: "run corepack pnpm build and reload MCP in Pi",
			};
		}
		const sourcePath = sourcePathForMcpServer(serverPath);
		if (!sourcePath || !exists(sourcePath)) {
			return { installed: true, status: "unknown", serverPath };
		}
		const source = statSync(sourcePath);
		const built = statSync(serverPath);
		if (source.mtimeMs > built.mtimeMs + 1000) {
			return {
				installed: true,
				status: "source_newer",
				serverPath,
				recommendedAction: "run corepack pnpm build and reload MCP in Pi",
			};
		}
		return { installed: true, status: "fresh", serverPath };
	} catch {
		return { installed: false, status: "unknown" };
	}
}

function sourcePathForMcpServer(serverPath: string): string | undefined {
	const normalized = serverPath.replace(/\\/gu, "/");
	const marker = "/dist/src/mcp-server.js";
	if (!normalized.endsWith(marker)) return undefined;
	const separator = serverPath.includes("\\") ? "\\" : "/";
	return `${serverPath.slice(0, -marker.length)}${separator}src${separator}mcp-server.ts`;
}

function formatMcpRuntimeLine(runtime: CliMcpRuntimeDiagnostic): string {
	if (runtime.status === "source_newer") {
		return "MCP runtime: source newer; run corepack pnpm build and reload MCP in Pi";
	}
	if (runtime.status === "missing") {
		return "MCP runtime: missing dist target; run corepack pnpm build and reload MCP in Pi";
	}
	if (runtime.status === "fresh") return "MCP runtime: fresh";
	if (runtime.status === "absent") return "MCP runtime: ausente";
	return "MCP runtime: unknown";
}

function readPackageVersion(): string {
	try {
		const packagePath = join(resolveCliPackageRoot(), "package.json");
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
			version?: string;
		};
		return parsed.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

export function applyPackageEnvDefaults(
	options: { envPath?: string } = {},
): void {
	for (const [key, value] of Object.entries(readPackageEnv(options.envPath))) {
		if (value !== undefined && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

export function resolveCliPackageRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function resolveIduRegistryPath(
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
	return resolve(
		env.IDU_PI_REGISTRY_PATH?.trim() ||
			join(resolveCliPackageRoot(), "data", "projects.json"),
	);
}

function mergedPackageEnv(): Record<string, string | undefined> {
	return { ...readPackageEnv(), ...process.env };
}

function readPackageEnv(
	envPath = join(resolveCliPackageRoot(), ".env"),
): Record<string, string | undefined> {
	if (!existsSync(envPath)) return {};
	const values: Record<string, string | undefined> = {};
	try {
		for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const separator = trimmed.indexOf("=");
			if (separator === -1) continue;
			const key = trimmed.slice(0, separator).trim();
			let value = trimmed.slice(separator + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			values[key] = value;
		}
	} catch {
		return {};
	}
	return values;
}

function resolveHomeFallback(): string {
	return process.env.USERPROFILE || process.env.HOME || process.cwd();
}
