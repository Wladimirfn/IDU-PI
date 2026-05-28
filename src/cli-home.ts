import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	canonicalDirectory,
	isAllowedCwd,
	parseAgentProfiles,
	type AgentProfile,
} from "./config.js";
import { profileModelLabel } from "./agent-router.js";
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
import { slugifyProjectId } from "./projects.js";

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
	constitution: "confirmed" | "draft" | "missing" | "unknown";
	allowedRoot: boolean | "unknown";
	recommendedNext: "enroll" | "bootstrap" | "idu" | "prepare";
	warning?: string;
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
	const mcpInstalled = mcpConfigHasIdu(join(agentDir, "mcp.json"), exists);
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

function findProfile(
	profiles: AgentProfile[],
	pattern: RegExp,
): AgentProfile | undefined {
	return profiles.find((profile) =>
		pattern.test(`${profile.id}\n${profile.label}`),
	);
}

function profileLabel(profile: AgentProfile | undefined): string {
	if (!profile) return "(not set)";
	return `${profile.label} / ${profileModelLabel(profile)}`;
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
		"6. Tareas y cola",
		"7. Diagnóstico",
		"8. Exit",
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
		"6. ← Volver",
		"7. Exit",
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
		`Extensión Pi: ${status.commandExtensionInstalled ? "presente" : "ausente"}`,
		"",
		"Comandos de configuración:",
		"- idu-pi setup status",
		"- idu-pi setup mcp-init",
		"- idu-pi setup path-help",
		"- idu-pi project status .",
	].join("\n");
}

export function formatTelegramRemoteStatus(status: CliHomeStatus): string {
	return [
		"Telegram remoto",
		"",
		"Telegram es una interfaz remota opcional del flujo CLI/supervisor.",
		"El core de IDU-Pi no depende de Telegram.",
		"",
		`package root: ${status.packageRoot}`,
		`config esperada: ${join(status.packageRoot, ".env")}`,
		"",
		"Acciones disponibles por ahora:",
		"- Configurar Telegram remoto: scripts/setup-env.mjs",
		"- Iniciar Telegram remoto: scripts/start-bridge.ps1",
		"- Detener Telegram remoto: scripts/stop-bridge.ps1",
		"",
		"MVP seguro: esta pantalla no inicia Telegram ni modifica .env.",
	].join("\n");
}

export function formatModelProfilesMenu(): string {
	return [
		"Modelos y perfiles",
		"",
		"1. Ver perfiles actuales",
		"2. Editar perfiles",
		"3. Asignar modelos por rol",
		"4. Validar configuración",
		"5. Save",
		"6. Descartar",
		"7. ← Volver",
		"8. Exit",
	].join("\n");
}

export function formatModelProfilesStatus(status: CliHomeStatus): string {
	const profiles = status.agentProfiles.length
		? status.agentProfiles
		: parseAgentProfiles();
	const defaultProfile = profiles[0];
	const labProfiles = profiles.slice(1);
	const generalLab = labProfiles[0];
	const securityLab =
		findProfile(labProfiles, /seguridad|security|sec/iu) ?? generalLab;
	const architectureLab =
		findProfile(labProfiles, /arquitectura|architecture|arch/iu) ?? generalLab;
	const performanceLab =
		findProfile(labProfiles, /performance|perf|rendimiento/iu) ?? generalLab;
	const codeQualityLab =
		findProfile(labProfiles, /quality|calidad|code|general/iu) ?? generalLab;
	return [
		"Modelos y perfiles",
		"",
		"Assign Models",
		"Assign models for IDU-Pi supervisor and AgentLabs.",
		"",
		"Current profiles:",
		"",
		...profiles.map(
			(profile, index) =>
				`  ${index === 0 ? "▸" : " "} ${profile.label} (${profile.id})  ${profileModelLabel(profile)}`,
		),
		"",
		"Current assignments:",
		"",
		`  ▸ Supervisor principal       ${profileLabel(defaultProfile)}`,
		`    Supervisor semántico       ${profileLabel(defaultProfile)}`,
		`    Supervisor compactación    ${profileLabel(defaultProfile)}`,
		`    AgentLab general           ${profileLabel(generalLab)}`,
		`    AgentLab seguridad         ${profileLabel(securityLab)}`,
		`    AgentLab arquitectura      ${profileLabel(architectureLab)}`,
		`    AgentLab performance       ${profileLabel(performanceLab)}`,
		`    AgentLab calidad código    ${profileLabel(codeQualityLab)}`,
		"",
		"Acciones disponibles en el menú:",
		"- Ver perfiles actuales",
		"- Editar perfiles",
		"- Asignar modelos por rol",
		"- Validar configuración",
		"- Save / Descartar",
		"",
		"MVP seguro: las acciones editables muestran el flujo previsto. No modifica .env todavía.",
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
		"Tareas y cola",
		"",
		"Acciones CLI:",
		'- idu-pi idu-task "detalle"',
		"- idu-pi idu-queue-detail",
		"- idu-pi idu-queue-approve <id>",
		"- idu-pi idu-queue-reject <id>",
		"- idu-pi idu-queue-clear-structured",
		"",
		"MVP seguro: esta pantalla no lee ni modifica la cola.",
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
	if (projectCore === "missing" || projectCore === "pending")
		return "bootstrap";
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
	exists: (path: string) => boolean,
): CliHomeProjectStatus["projectCore"] {
	const corePath = join(projectPath, "config", "project-core.json");
	if (!exists(corePath)) return "pending";
	try {
		const parsed = JSON.parse(readFileSync(corePath, "utf8")) as {
			status?: string;
		};
		return parsed.status === "confirmed" ? "confirmed" : "pending";
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
		return parsed.status === "confirmed" ? "confirmed" : "draft";
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

function mcpConfigHasIdu(
	path: string,
	exists: (path: string) => boolean,
): boolean {
	if (!exists(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		return Boolean(parsed.mcpServers?.["idu-pi"]);
	} catch {
		return false;
	}
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

export function applyPackageEnvDefaults(): void {
	for (const [key, value] of Object.entries(readPackageEnv())) {
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

function readPackageEnv(): Record<string, string | undefined> {
	const envPath = join(resolveCliPackageRoot(), ".env");
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
