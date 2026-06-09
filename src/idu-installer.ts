import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { canonicalDirectory, isAllowedCwd } from "./config.js";
import {
	addProject,
	loadRegistry,
	saveRegistry,
	slugifyProjectId,
	type ProjectEntry,
} from "./projects.js";
import {
	ensureProjectStateDirs,
	formatProjectStatePaths,
	resolveProjectStatePaths,
	type ProjectStatePaths,
} from "./project-state.js";

export type ToolStatus = {
	found: boolean;
	version?: string;
};

export type SystemDetection = {
	os: NodeJS.Platform | string;
	shell: string;
	node: ToolStatus;
	packageManagers: {
		npm: ToolStatus;
		pnpm: ToolStatus;
	};
	git: ToolStatus;
	curl: ToolStatus;
	mcpBasicSupport: boolean;
};

export type AgentConfigDetection = {
	pi: AgentConfigStatus;
	claudeCode: AgentConfigStatus;
	opencode: AgentConfigStatus;
	codex: AgentConfigStatus;
	cursor: AgentConfigStatus;
	windsurf: AgentConfigStatus;
};

export type AgentConfigStatus = {
	present: boolean;
	path: string;
};

export type DetectOptions = {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	homeDir?: string;
	platform?: NodeJS.Platform | string;
	exists?: (path: string) => boolean;
	runner?: (command: string, args: string[]) => string | undefined;
};

export type IduMcpServerConfig = {
	command: "node";
	args: string[];
	cwd: string;
	lifecycle: "lazy";
	directTools: true;
};

export type IduMcpTarget = "pi" | "opencode";

export type OpenCodeMcpServerConfig = {
	type: "local";
	command: ["node", string];
	enabled: true;
};

export type OpenCodeConfig = {
	$schema?: string;
	mcp: Record<string, unknown>;
};

export type InstallIduMcpConfigInput = {
	agentDir: string;
	mcpServerPath: string;
	target?: IduMcpTarget;
	extensionSourcePath?: string;
	force?: boolean;
	dryRun?: boolean;
	now?: () => Date;
};

export type InstallIduMcpConfigResult = {
	status: "installed" | "exists" | "dry_run";
	mcpConfigPath: string;
	backupPath?: string;
	commandExtensionPath?: string;
	commandExtensionStatus?:
		| "installed"
		| "exists"
		| "dry_run"
		| "missing_source";
	commandExtensionBackupPath?: string;
	config: { mcpServers: Record<string, unknown> } | OpenCodeConfig;
	summary: string;
};

export type ProjectEnrollInput = {
	projectPath: string;
	projectId?: string;
	workspaceRoot: string;
	allowedRoots: string[];
	registryPath?: string;
};

export type ProjectEnrollResult = {
	project: ProjectEntry;
	statePaths: ProjectStatePaths;
	created: string[];
	safeNotes: string[];
};

export type ProjectInstallStatus = {
	projectId: string;
	projectPath: string;
	registered: boolean;
	stateRoot: string;
	labDbPath: string;
	reportsDir: string;
	mcpAvailable: boolean;
	recommendedNext: string;
};

export type ProjectInstallStatusInput = {
	projectPath: string;
	workspaceRoot: string;
	allowedRoots: string[];
	registryPath?: string;
	mcpAvailable?: boolean;
};

export type IduSetupStatusInput = {
	system: SystemDetection;
	tools: SystemDetection;
	agentConfigs: AgentConfigDetection;
	mcpInstalled: boolean;
};

export type GlobalIduInstallStatus = {
	argvPath: string;
	executionMode: "global-bin" | "repo-dist" | "unknown";
	pnpmHome?: string;
	pnpmGlobalBin?: string;
	pnpmGlobalBinInPath: boolean;
	iduPiLikelyGlobal: boolean;
	recommendedAction?: string;
};

export function detectSystem(options: DetectOptions = {}): SystemDetection {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const shell =
		env.SHELL ??
		env.ComSpec ??
		(env.PSModulePath ? "powershell/cmd" : "unknown");
	const tools = detectTools(options);
	return {
		os: platform,
		shell,
		node: tools.node,
		packageManagers: tools.packageManagers,
		git: tools.git,
		curl: tools.curl,
		mcpBasicSupport: tools.node.found,
	};
}

export function detectTools(options: DetectOptions = {}): SystemDetection {
	const runner = options.runner ?? defaultRunner;
	const node = detectCommand("node", ["--version"], runner);
	const npm = detectCommand("npm", ["--version"], runner);
	const pnpm = detectCommand("pnpm", ["--version"], runner);
	const git = detectCommand("git", ["--version"], runner);
	const curl = detectCommand("curl", ["--version"], runner);
	return {
		os: options.platform ?? process.platform,
		shell: "",
		node,
		packageManagers: { npm, pnpm },
		git,
		curl,
		mcpBasicSupport: node.found,
	};
}

export function resolvePiAgentDir(options: DetectOptions = {}): string {
	const env = options.env ?? process.env;
	return resolve(
		env.PI_CODING_AGENT_DIR?.trim() ||
			join(options.homeDir ?? homedir(), ".pi", "agent"),
	);
}

export function detectAgentConfigs(
	options: DetectOptions = {},
): AgentConfigDetection {
	const home = options.homeDir ?? homedir();
	const exists = options.exists ?? existsSync;
	const piPath = resolvePiAgentDir(options);
	return {
		pi: status(piPath, exists),
		claudeCode: status(join(home, ".claude"), exists),
		opencode: status(join(home, ".config", "opencode"), exists),
		codex: status(join(home, ".codex"), exists),
		cursor: status(join(home, ".cursor"), exists),
		windsurf: status(join(home, ".windsurf"), exists),
	};
}

export function buildIduMcpConfig(mcpServerPath: string): IduMcpServerConfig {
	const resolvedServerPath = resolve(mcpServerPath);
	return {
		command: "node",
		args: [resolvedServerPath],
		cwd: resolve(dirname(resolvedServerPath), "..", ".."),
		lifecycle: "lazy",
		directTools: true,
	};
}

export function buildOpenCodeIduMcpConfig(
	mcpServerPath: string,
): OpenCodeMcpServerConfig {
	return {
		type: "local",
		command: ["node", resolve(mcpServerPath)],
		enabled: true,
	};
}

export function installIduMcpConfig(
	input: InstallIduMcpConfigInput,
): InstallIduMcpConfigResult {
	if (input.target === "opencode") return installOpenCodeIduMcpConfig(input);
	const agentDir = resolve(input.agentDir);
	const mcpConfigPath = join(agentDir, "mcp.json");
	const existing = readMcpConfig(mcpConfigPath);
	const iduConfig = buildIduMcpConfig(input.mcpServerPath);
	const hasExistingIdu = Boolean(existing.mcpServers["idu-pi"]);
	const next = {
		...existing,
		mcpServers: {
			...existing.mcpServers,
			...(hasExistingIdu && !input.force ? {} : { "idu-pi": iduConfig }),
		},
	};
	const extensionResult = installGlobalPiCommandExtension({
		agentDir,
		packageRoot: iduConfig.cwd,
		sourcePath: input.extensionSourcePath,
		force: input.force,
		dryRun: input.dryRun,
		now: input.now,
	});
	if (input.dryRun) {
		return {
			status: "dry_run",
			mcpConfigPath,
			commandExtensionPath: extensionResult.path,
			commandExtensionStatus: extensionResult.status,
			commandExtensionBackupPath: extensionResult.backupPath,
			config: next,
			summary: "Dry-run: no escribí mcp.json ni extensión de comandos.",
		};
	}
	if (hasExistingIdu && !input.force) {
		return {
			status: "exists",
			mcpConfigPath,
			commandExtensionPath: extensionResult.path,
			commandExtensionStatus: extensionResult.status,
			commandExtensionBackupPath: extensionResult.backupPath,
			config: existing,
			summary:
				"idu-pi ya existe en mcp.json; comandos slash globales verificados.",
		};
	}
	mkdirSync(agentDir, { recursive: true });
	const backupPath = backupAgentConfigFile(mcpConfigPath, input.now);
	writeFileSync(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return {
		status: "installed",
		mcpConfigPath,
		backupPath,
		commandExtensionPath: extensionResult.path,
		commandExtensionStatus: extensionResult.status,
		commandExtensionBackupPath: extensionResult.backupPath,
		config: next,
		summary: "MCP idu-pi y comandos slash globales configurados.",
	};
}

function installOpenCodeIduMcpConfig(
	input: InstallIduMcpConfigInput,
): InstallIduMcpConfigResult {
	const configDir = resolve(input.agentDir);
	const mcpConfigPath = join(configDir, "opencode.json");
	const existing = readOpenCodeConfig(mcpConfigPath);
	const iduConfig = buildOpenCodeIduMcpConfig(input.mcpServerPath);
	const hasExistingIdu = Boolean(existing.mcp["idu-pi"]);
	const next = {
		...existing,
		mcp: {
			...existing.mcp,
			...(hasExistingIdu && !input.force ? {} : { "idu-pi": iduConfig }),
		},
	};
	if (input.dryRun) {
		return {
			status: "dry_run",
			mcpConfigPath,
			config: next,
			summary: "Dry-run: no escribí opencode.json.",
		};
	}
	if (hasExistingIdu && !input.force) {
		return {
			status: "exists",
			mcpConfigPath,
			config: existing,
			summary: "idu-pi ya existe en opencode.json.",
		};
	}
	mkdirSync(configDir, { recursive: true });
	const backupPath = backupAgentConfigFile(mcpConfigPath, input.now);
	writeFileSync(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return {
		status: "installed",
		mcpConfigPath,
		backupPath,
		config: next,
		summary: "MCP idu-pi configurado para OpenCode.",
	};
}

export function printIduMcpConfig(input: {
	mcpServerPath: string;
	target?: IduMcpTarget;
}): string {
	if (input.target === "opencode") {
		return `${JSON.stringify(
			{ mcp: { "idu-pi": buildOpenCodeIduMcpConfig(input.mcpServerPath) } },
			null,
			2,
		)}\n`;
	}
	return `${JSON.stringify(
		{ mcpServers: { "idu-pi": buildIduMcpConfig(input.mcpServerPath) } },
		null,
		2,
	)}\n`;
}

type CommandExtensionInstallInput = {
	agentDir: string;
	packageRoot: string;
	sourcePath?: string;
	force?: boolean;
	dryRun?: boolean;
	now?: () => Date;
};

type CommandExtensionInstallResult = {
	path: string;
	status: "installed" | "exists" | "dry_run" | "missing_source";
	backupPath?: string;
};

function installGlobalPiCommandExtension(
	input: CommandExtensionInstallInput,
): CommandExtensionInstallResult {
	const destination = join(
		resolve(input.agentDir),
		"extensions",
		"idu-pi-commands.ts",
	);
	if (input.dryRun) return { path: destination, status: "dry_run" };
	if (!input.sourcePath || !existsSync(input.sourcePath)) {
		return { path: destination, status: "missing_source" };
	}
	const content = renderGlobalCommandExtension(
		readFileSync(input.sourcePath, "utf8"),
		input.packageRoot,
	);
	cleanupLegacyCommandExtensionBackups(dirname(destination));
	let backupPath: string | undefined;
	if (existsSync(destination)) {
		const current = readFileSync(destination, "utf8");
		if (current === content) return { path: destination, status: "exists" };
		backupPath = backupCommandExtensionFile(destination, input.now);
	}
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, content, "utf8");
	return { path: destination, status: "installed", backupPath };
}

function renderGlobalCommandExtension(
	source: string,
	packageRoot: string,
): string {
	return source.replace(
		/const IDU_PI_PACKAGE_ROOT(?::\s*string)? = "__IDU_PI_PACKAGE_ROOT__";/u,
		`const IDU_PI_PACKAGE_ROOT: string = ${JSON.stringify(resolve(packageRoot))};`,
	);
}

export function detectGlobalIduInstall(
	options: DetectOptions & { argvPath?: string } = {},
): GlobalIduInstallStatus {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const argvPath = options.argvPath ?? process.argv[1] ?? "";
	const normalizedArgv = argvPath.replace(/\\/gu, "/");
	const executionMode = /\/dist\/src\/cli\.js$/u.test(normalizedArgv)
		? "repo-dist"
		: /idu-pi(?:\.cmd|\.ps1)?$/iu.test(normalizedArgv)
			? "global-bin"
			: "unknown";
	const pnpmHome = env.PNPM_HOME?.trim() || undefined;
	const pnpmGlobalBin =
		pnpmHome ?? defaultPnpmGlobalBin(options.homeDir ?? homedir(), platform);
	const pathEntries = (env.PATH ?? env.Path ?? "")
		.split(delimiter)
		.map((entry) => normalizePath(entry))
		.filter(Boolean);
	const pnpmGlobalBinInPath = pathEntries.includes(
		normalizePath(pnpmGlobalBin),
	);
	const iduPiLikelyGlobal =
		executionMode === "global-bin" && pnpmGlobalBinInPath;
	return {
		argvPath,
		executionMode,
		...(pnpmHome ? { pnpmHome } : {}),
		pnpmGlobalBin,
		pnpmGlobalBinInPath,
		iduPiLikelyGlobal,
		...(pnpmGlobalBinInPath
			? {}
			: {
					recommendedAction:
						"corepack pnpm setup; cerrar y abrir terminal; corepack pnpm link --global",
				}),
	};
}

export function formatPnpmPathHelp(
	status: GlobalIduInstallStatus = detectGlobalIduInstall(),
): string {
	return [
		"Idu-pi global PATH help",
		"",
		"Estado:",
		`- modo ejecución: ${status.executionMode}`,
		`- argv: ${status.argvPath || "—"}`,
		`- PNPM_HOME: ${status.pnpmHome ?? "no configurado"}`,
		`- pnpm global bin: ${status.pnpmGlobalBin ?? "no detectado"}`,
		`- pnpm global bin en PATH: ${status.pnpmGlobalBinInPath ? "sí" : "no"}`,
		`- idu-pi global: ${status.iduPiLikelyGlobal ? "disponible" : "no disponible"}`,
		"",
		"Primer uso desde el repo:",
		"- corepack pnpm cli",
		"- node dist/src/cli.js",
		"",
		"Uso normal después de link global:",
		"- idu-pi",
		"",
		"Si el bin global de pnpm no está en PATH:",
		"1. corepack pnpm setup",
		"2. Cerrá y abrí una terminal nueva",
		"3. corepack pnpm link --global",
		"",
		"No modifico PATH automáticamente.",
	].join("\n");
}

function backupCommandExtensionFile(
	destination: string,
	now: () => Date = () => new Date(),
): string {
	const backupPath = join(
		dirname(destination),
		`idu-pi-commands.backup-${timestamp(now())}.bak`,
	);
	writeFileSync(backupPath, readFileSync(destination, "utf8"), "utf8");
	return backupPath;
}

function cleanupLegacyCommandExtensionBackups(extensionDir: string): void {
	if (!existsSync(extensionDir)) return;
	for (const entry of readdirSync(extensionDir)) {
		if (/^idu-pi-commands\.backup-\d{8}-\d{6}\.ts$/u.test(entry)) {
			rmSync(join(extensionDir, entry), { force: true });
		}
	}
}

export function backupAgentConfigFile(
	mcpConfigPath: string,
	now: () => Date = () => new Date(),
): string | undefined {
	if (!existsSync(mcpConfigPath)) return undefined;
	const backupPath = join(
		dirname(mcpConfigPath),
		`mcp.backup-${timestamp(now())}.json`,
	);
	writeFileSync(backupPath, readFileSync(mcpConfigPath, "utf8"), "utf8");
	return backupPath;
}

export function projectEnroll(input: ProjectEnrollInput): ProjectEnrollResult {
	const projectPath = canonicalDirectory(input.projectPath);
	if (!isAllowedCwd(projectPath, input.allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${projectPath}`);
	}
	const projectId = slugifyProjectId(
		input.projectId?.trim() || projectPath.split(/[\\/]/u).at(-1) || "project",
	);
	const registry = loadRegistry(projectPath, input.allowedRoots, {
		registryPath: input.registryPath,
		createIfMissing: false,
	});
	const project = addProject(
		registry,
		projectId,
		projectPath,
		input.allowedRoots,
	);
	const statePaths = resolveProjectStatePaths({
		workspaceRoot: input.workspaceRoot,
		projectId: project.id,
		projectPath,
	});
	const created: string[] = [];
	for (const directory of [
		statePaths.stateRoot,
		statePaths.reportsDir,
		statePaths.semanticAuditDir,
		statePaths.agentLabReportsDir,
		statePaths.workspacesDir,
	]) {
		if (!existsSync(directory)) created.push(directory);
	}
	ensureProjectStateDirs(statePaths);
	project.stateRoot = statePaths.stateRoot;
	saveRegistry(registry, input.registryPath);
	return {
		project,
		statePaths,
		created,
		safeNotes: [
			"No creé Project Core automáticamente.",
			"No ejecuté scan pesado.",
			"No toqué código del proyecto.",
		],
	};
}

export function projectInstallStatus(
	input: ProjectInstallStatusInput,
): ProjectInstallStatus {
	const projectPath = canonicalDirectory(input.projectPath);
	if (!isAllowedCwd(projectPath, input.allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${projectPath}`);
	}
	const registry = loadRegistry(projectPath, input.allowedRoots, {
		registryPath: input.registryPath,
		createIfMissing: false,
	});
	const project = registry.projects.find((entry) =>
		samePath(entry.path, projectPath),
	);
	const projectId =
		project?.id ??
		slugifyProjectId(projectPath.split(/[\\/]/u).at(-1) ?? "project");
	const statePaths = resolveProjectStatePaths({
		workspaceRoot: input.workspaceRoot,
		projectId,
		projectPath,
	});
	return {
		projectId,
		projectPath,
		registered: Boolean(project),
		stateRoot: project?.stateRoot ?? statePaths.stateRoot,
		labDbPath: statePaths.labDbPath,
		reportsDir: statePaths.reportsDir,
		mcpAvailable: input.mcpAvailable ?? false,
		recommendedNext: project
			? "Usá idu-pi setup status o idu-pi idu-status."
			: "Registrá con idu-pi project enroll <projectPath>.",
	};
}

export function formatIduSetupStatus(input: IduSetupStatusInput): string {
	const configs = input.agentConfigs;
	return [
		"Idu-pi Setup",
		"",
		"Sistema:",
		`- OS: ${input.system.os}`,
		`- shell: ${input.system.shell}`,
		`- node: ${found(input.tools.node)}`,
		`- git: ${found(input.tools.git)}`,
		`- curl: ${found(input.tools.curl)}`,
		`- MCP básico: ${input.system.mcpBasicSupport ? "yes" : "no"}`,
		"",
		"Configs detectadas:",
		`- Pi: ${configs.pi.present ? "present" : "missing"} (${configs.pi.path})`,
		`- Claude Code: ${configs.claudeCode.present ? "present" : "missing"}`,
		`- OpenCode: ${configs.opencode.present ? "present" : "missing"}`,
		`- Codex: ${configs.codex.present ? "present" : "missing"}`,
		`- Cursor: ${configs.cursor.present ? "present" : "missing"}`,
		`- Windsurf: ${configs.windsurf.present ? "present" : "missing"}`,
		`- MCP idu-pi: ${input.mcpInstalled ? "present" : "missing"}`,
		"",
		"Acciones recomendadas:",
		"1. idu-pi setup mcp-init",
		"2. idu-pi project enroll <path>",
		"3. idu-pi setup status",
	].join("\n");
}

export function formatInstallIduMcpConfigResult(
	result: InstallIduMcpConfigResult,
): string {
	return [
		"Idu-pi MCP setup",
		"",
		"status:",
		result.status,
		"",
		"mcpConfigPath:",
		result.mcpConfigPath,
		"",
		"commandExtensionPath:",
		result.commandExtensionPath ?? "—",
		"",
		"commandExtensionStatus:",
		result.commandExtensionStatus ?? "—",
		"",
		"commandExtensionBackupPath:",
		result.commandExtensionBackupPath ??
			(result.commandExtensionStatus === "dry_run" ? "dry-run" : "—"),
		"",
		"backupPath:",
		result.backupPath ?? "—",
		"",
		"summary:",
		result.summary,
	].join("\n");
}

export function formatProjectEnrollResult(result: ProjectEnrollResult): string {
	return [
		"Proyecto enrolado",
		"",
		`projectId: ${result.project.id}`,
		`projectPath: ${result.project.path}`,
		"",
		formatProjectStatePaths(result.statePaths),
		"",
		"Rutas creadas:",
		...(result.created.length
			? result.created.map((path) => `- ${path}`)
			: ["- ninguna"]),
		"",
		"Notas seguras:",
		...result.safeNotes.map((note) => `- ${note}`),
	].join("\n");
}

export function formatProjectInstallStatus(
	status: ProjectInstallStatus,
): string {
	return [
		"Idu-pi project status",
		"",
		`projectId: ${status.projectId}`,
		`projectPath: ${status.projectPath}`,
		`registered: ${status.registered ? "registered" : "unregistered"}`,
		`stateRoot: ${status.stateRoot}`,
		`labDbPath: ${status.labDbPath}`,
		`reportsDir: ${status.reportsDir}`,
		`MCP available: ${status.mcpAvailable ? "yes" : "no"}`,
		"",
		`recommendedNext: ${status.recommendedNext}`,
	].join("\n");
}

function readMcpConfig(path: string): { mcpServers: Record<string, unknown> } {
	if (!existsSync(path)) return { mcpServers: {} };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
			return { ...parsed, mcpServers: parsed.mcpServers } as {
				mcpServers: Record<string, unknown>;
			};
		}
	} catch {
		// Invalid existing config is preserved via backup before writing a valid one.
	}
	return { mcpServers: {} };
}

function readOpenCodeConfig(path: string): OpenCodeConfig {
	if (!existsSync(path)) {
		return { $schema: "https://opencode.ai/config.json", mcp: {} };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (isRecord(parsed)) {
			return {
				...parsed,
				$schema:
					typeof parsed.$schema === "string"
						? parsed.$schema
						: "https://opencode.ai/config.json",
				mcp: isRecord(parsed.mcp) ? parsed.mcp : {},
			} as OpenCodeConfig;
		}
	} catch {
		// Invalid existing config is preserved via backup before writing a valid one.
	}
	return { $schema: "https://opencode.ai/config.json", mcp: {} };
}

function detectCommand(
	command: string,
	args: string[],
	runner: (command: string, args: string[]) => string | undefined,
): ToolStatus {
	try {
		const version = runner(command, args)?.trim().split(/\r?\n/u)[0];
		return version ? { found: true, version } : { found: false };
	} catch {
		return { found: false };
	}
}

function defaultRunner(command: string, args: string[]): string | undefined {
	try {
		return execFileSync(command, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

function status(
	path: string,
	exists: (path: string) => boolean,
): AgentConfigStatus {
	return { present: exists(path), path };
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

function found(status: ToolStatus): string {
	return status.found
		? `found${status.version ? ` (${status.version})` : ""}`
		: "missing";
}

function samePath(left: string, right: string): boolean {
	const normalize = (path: string) =>
		process.platform === "win32" ? path.toLowerCase() : path;
	return normalize(left) === normalize(right);
}

function defaultPnpmGlobalBin(
	home: string,
	platform: NodeJS.Platform | string,
): string {
	return platform === "win32"
		? join(home, "AppData", "Local", "pnpm", "bin")
		: join(home, ".local", "share", "pnpm");
}

function normalizePath(path: string): string {
	const resolved = resolve(path.trim());
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
