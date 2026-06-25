import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	backupAgentConfigFile,
	buildIduMcpConfig,
	detectAgentConfigs,
	detectSystem,
	detectTools,
	formatIduSetupStatus,
	formatInstallIduMcpConfigResult,
	formatProjectEnrollResult,
	formatProjectInstallStatus,
	installIduMcpConfig,
	printIduMcpConfig,
	projectEnroll,
	projectInstallStatus,
	resolvePiAgentDir,
} from "../src/idu-installer.js";
import { runCliCommand } from "../src/cli.js";

function tempDir(prefix = "idu-installer-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("detectSystem and detectTools return best-effort diagnostics", () => {
	const system = detectSystem({ env: { SHELL: "bash" }, platform: "linux" });
	assert.equal(system.os, "linux");
	assert.equal(system.shell, "bash");
	const tools = detectTools({
		runner: (command: string) => (command === "node" ? "v20.0.0" : undefined),
	});
	assert.equal(tools.node.found, true);
	assert.equal(typeof tools.git.found, "boolean");
});

test("resolvePiAgentDir uses PI_CODING_AGENT_DIR if present", () => {
	const root = tempDir();
	const dir = join(root, "custom-pi-agent");
	const resolved = resolvePiAgentDir({
		env: { PI_CODING_AGENT_DIR: dir },
		homeDir: root,
	});
	assert.equal(resolved, dir);
	rmSync(root, { recursive: true, force: true });
});

test("detectAgentConfigs detects Pi best-effort", () => {
	const root = tempDir();
	const piDir = join(root, ".pi", "agent");
	const configs = detectAgentConfigs({
		env: {},
		homeDir: root,
		exists: (path: string) => path === piDir,
	});
	assert.equal(configs.pi.present, true);
	assert.equal(configs.pi.path, piDir);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init creates mcp.json and global slash extension when missing", () => {
	const root = tempDir();
	const mcpServerPath = join(root, "dist", "src", "mcp-server.js");
	const extensionSourcePath = join(root, "source-extension.ts");
	writeFileSync(
		extensionSourcePath,
		'const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";\n',
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath,
		extensionSourcePath,
	});
	assert.equal(result.status, "installed");
	assert.equal(result.commandExtensionStatus, "installed");
	assert.equal(result.commandExtensionBackupPath, undefined);
	assert.equal(existsSync(join(root, "mcp.json")), true);
	assert.equal(
		existsSync(join(root, "extensions", "idu-pi-commands.ts")),
		true,
	);
	assert.match(
		readFileSync(join(root, "extensions", "idu-pi-commands.ts"), "utf8"),
		new RegExp(
			`const IDU_PI_PACKAGE_ROOT: string = ${JSON.stringify(root).replace(/\\/gu, "\\\\")}`,
			"u",
		),
	);
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<
			string,
			{ args: string[]; cwd?: string; directTools?: boolean }
		>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].args[0], mcpServerPath);
	assert.equal(parsed.mcpServers["idu-pi"].directTools, true);
	assert.equal(parsed.mcpServers["idu-pi"].cwd, root);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init leaves matching global slash extension without backup", () => {
	const root = tempDir();
	const mcpServerPath = join(root, "dist", "src", "mcp-server.js");
	const extensionSourcePath = join(root, "source-extension.ts");
	writeFileSync(
		extensionSourcePath,
		'const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";\n',
		"utf8",
	);
	installIduMcpConfig({
		agentDir: root,
		mcpServerPath,
		extensionSourcePath,
	});
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath,
		extensionSourcePath,
	});
	assert.equal(result.commandExtensionStatus, "exists");
	assert.equal(result.commandExtensionBackupPath, undefined);
	assert.equal(
		existsSync(
			join(root, "extensions", "idu-pi-commands.backup-20260525-010203.bak"),
		),
		false,
	);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init backs up changed global slash extension before overwriting", () => {
	const root = tempDir();
	const extensionDir = join(root, "extensions");
	mkdirSync(extensionDir, { recursive: true });
	const extensionDestination = join(extensionDir, "idu-pi-commands.ts");
	writeFileSync(extensionDestination, "old extension", "utf8");
	const extensionSourcePath = join(root, "source-extension.ts");
	writeFileSync(
		extensionSourcePath,
		'const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";\n',
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "dist", "src", "mcp-server.js"),
		extensionSourcePath,
		now: () => new Date(2026, 4, 25, 1, 2, 3),
	});
	const expectedBackup = join(
		extensionDir,
		"idu-pi-commands.backup-20260525-010203.bak",
	);
	assert.equal(result.commandExtensionStatus, "installed");
	assert.equal(result.commandExtensionBackupPath, expectedBackup);
	assert.equal(readFileSync(expectedBackup, "utf8"), "old extension");
	assert.match(
		readFileSync(extensionDestination, "utf8"),
		/IDU_PI_PACKAGE_ROOT/u,
	);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init force backs up changed global slash extension", () => {
	const root = tempDir();
	const extensionDir = join(root, "extensions");
	mkdirSync(extensionDir, { recursive: true });
	const extensionDestination = join(extensionDir, "idu-pi-commands.ts");
	writeFileSync(extensionDestination, "old force extension", "utf8");
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "old" } } }),
		"utf8",
	);
	const extensionSourcePath = join(root, "source-extension.ts");
	writeFileSync(
		extensionSourcePath,
		'const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";\n',
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "dist", "src", "mcp-server.js"),
		extensionSourcePath,
		force: true,
		now: () => new Date(2026, 4, 25, 1, 2, 3),
	});
	const expectedBackup = join(
		extensionDir,
		"idu-pi-commands.backup-20260525-010203.bak",
	);
	assert.equal(result.status, "installed");
	assert.equal(result.commandExtensionStatus, "installed");
	assert.equal(result.commandExtensionBackupPath, expectedBackup);
	assert.equal(readFileSync(expectedBackup, "utf8"), "old force extension");
	assert.ok(result.backupPath);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init dry-run does not write extension backup", () => {
	const root = tempDir();
	const extensionDir = join(root, "extensions");
	mkdirSync(extensionDir, { recursive: true });
	const extensionDestination = join(extensionDir, "idu-pi-commands.ts");
	writeFileSync(extensionDestination, "old extension", "utf8");
	const extensionSourcePath = join(root, "source-extension.ts");
	writeFileSync(
		extensionSourcePath,
		'const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";\n',
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "dist", "src", "mcp-server.js"),
		extensionSourcePath,
		dryRun: true,
		now: () => new Date(2026, 4, 25, 1, 2, 3),
	});
	assert.equal(result.status, "dry_run");
	assert.equal(result.commandExtensionStatus, "dry_run");
	assert.equal(result.commandExtensionBackupPath, undefined);
	assert.equal(readFileSync(extensionDestination, "utf8"), "old extension");
	assert.equal(
		existsSync(
			join(extensionDir, "idu-pi-commands.backup-20260525-010203.bak"),
		),
		false,
	);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init missing extension source does not touch existing destination", () => {
	const root = tempDir();
	const extensionDir = join(root, "extensions");
	mkdirSync(extensionDir, { recursive: true });
	const extensionDestination = join(extensionDir, "idu-pi-commands.ts");
	writeFileSync(extensionDestination, "existing extension", "utf8");
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "dist", "src", "mcp-server.js"),
		extensionSourcePath: join(root, "missing-source.ts"),
		now: () => new Date(2026, 4, 25, 1, 2, 3),
	});
	assert.equal(result.commandExtensionStatus, "missing_source");
	assert.equal(result.commandExtensionBackupPath, undefined);
	assert.equal(
		readFileSync(extensionDestination, "utf8"),
		"existing extension",
	);
	assert.equal(
		existsSync(
			join(extensionDir, "idu-pi-commands.backup-20260525-010203.bak"),
		),
		false,
	);
	rmSync(root, { recursive: true, force: true });
});

test("gitignore keeps source extension versionable and backup ignored", () => {
	const sourceRule = execFileSync(
		"git",
		["check-ignore", "-v", "--no-index", ".pi/extensions/idu-pi-commands.ts"],
		{ encoding: "utf8" },
	);
	assert.match(sourceRule, /!\.pi\/extensions\/idu-pi-commands\.ts/u);
	const backupRule = execFileSync(
		"git",
		[
			"check-ignore",
			"-v",
			"--no-index",
			".pi/extensions/idu-pi-commands.backup-20260527-120000.bak",
		],
		{ encoding: "utf8" },
	);
	assert.match(backupRule, /\.pi\/extensions\/\*\.backup-\*\.bak/u);
});

test("setup formatter shows command extension backup path", () => {
	const root = tempDir();
	const text = formatInstallIduMcpConfigResult({
		status: "installed",
		mcpConfigPath: join(root, "mcp.json"),
		backupPath: join(root, "mcp.backup-20260525-010203.json"),
		commandExtensionPath: join(root, "extensions", "idu-pi-commands.ts"),
		commandExtensionStatus: "installed",
		commandExtensionBackupPath: join(
			root,
			"extensions",
			"idu-pi-commands.backup-20260525-010203.bak",
		),
		config: { mcpServers: {} },
		summary: "MCP idu-pi y comandos slash globales configurados.",
	});
	assert.match(text, /commandExtensionBackupPath:/u);
	assert.match(text, /idu-pi-commands\.backup-20260525-010203\.bak/u);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init preserves other mcpServers", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { other: { command: "x" } } }),
		"utf8",
	);
	installIduMcpConfig({ agentDir: root, mcpServerPath: join(root, "mcp.js") });
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, unknown>;
	};
	assert.ok(parsed.mcpServers.other);
	assert.ok(parsed.mcpServers["idu-pi"]);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init does not overwrite idu-pi without force", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "old" } } }),
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
	});
	assert.equal(result.status, "exists");
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, { command: string }>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].command, "old");
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init force replaces idu-pi and creates backup", () => {
	const root = tempDir();
	writeFileSync(
		join(root, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "old" } } }),
		"utf8",
	);
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
		force: true,
		now: () => new Date("2026-05-25T01:02:03Z"),
	});
	assert.equal(result.status, "installed");
	assert.ok(result.backupPath);
	assert.equal(existsSync(result.backupPath ?? ""), true);
	const parsed = JSON.parse(readFileSync(join(root, "mcp.json"), "utf8")) as {
		mcpServers: Record<string, { command: string }>;
	};
	assert.equal(parsed.mcpServers["idu-pi"].command, "node");
	rmSync(root, { recursive: true, force: true });
});

test("mcp-print and dry-run do not write files", () => {
	const root = tempDir();
	const printed = printIduMcpConfig({ mcpServerPath: join(root, "mcp.js") });
	assert.match(printed, /idu-pi/u);
	const dryRun = installIduMcpConfig({
		agentDir: root,
		mcpServerPath: join(root, "mcp.js"),
		dryRun: true,
	});
	assert.equal(dryRun.status, "dry_run");
	assert.equal(existsSync(join(root, "mcp.json")), false);
	assert.equal(
		existsSync(join(root, "extensions", "idu-pi-commands.ts")),
		false,
	);
	rmSync(root, { recursive: true, force: true });
});

test("mcp-print can emit OpenCode local MCP config", () => {
	const root = tempDir();
	const mcpServerPath = join(root, "dist", "src", "mcp-server.js");
	const printed = printIduMcpConfig({
		mcpServerPath,
		target: "opencode",
	});
	const parsed = JSON.parse(printed) as {
		mcp: Record<string, { type: string; command: string[]; enabled: boolean }>;
	};
	assert.deepEqual(parsed, {
		mcp: {
			"idu-pi": {
				type: "local",
				command: ["node", mcpServerPath],
				enabled: true,
			},
		},
	});
	rmSync(root, { recursive: true, force: true });
});

test("mcp-init can install OpenCode config without Pi slash extension", () => {
	const root = tempDir();
	const mcpServerPath = join(root, "dist", "src", "mcp-server.js");
	const result = installIduMcpConfig({
		agentDir: root,
		mcpServerPath,
		target: "opencode",
	});
	assert.equal(result.status, "installed");
	assert.equal(result.commandExtensionPath, undefined);
	assert.equal(result.commandExtensionStatus, undefined);
	assert.equal(existsSync(join(root, "opencode.json")), true);
	assert.equal(existsSync(join(root, "mcp.json")), false);
	assert.equal(
		existsSync(join(root, "extensions", "idu-pi-commands.ts")),
		false,
	);
	const parsed = JSON.parse(
		readFileSync(join(root, "opencode.json"), "utf8"),
	) as {
		mcp: Record<string, { type: string; command: string[]; enabled: boolean }>;
	};
	assert.deepEqual(parsed.mcp["idu-pi"], {
		type: "local",
		command: ["node", mcpServerPath],
		enabled: true,
	});
	rmSync(root, { recursive: true, force: true });
});

test("backupAgentConfigFile returns undefined for missing config", () => {
	const root = tempDir();
	assert.equal(backupAgentConfigFile(join(root, "mcp.json")), undefined);
	rmSync(root, { recursive: true, force: true });
});

test("buildIduMcpConfig uses node lazy server config", () => {
	const config = buildIduMcpConfig("C:/idu/dist/src/mcp-server.js");
	assert.equal(config.command, "node");
	assert.match(config.args[0], /idu[\\/]dist[\\/]src[\\/]mcp-server\.js$/u);
	assert.equal(config.lifecycle, "lazy");
	assert.equal(config.directTools, true);
	assert.match(config.cwd, /idu$/u);
});

test("project enroll registers project and creates isolated state dirs", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "Sistema_de_mantencion");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	writeFileSync(join(root, "marker.txt"), "ok", "utf8");
	const result = projectEnroll({
		projectPath,
		projectId: "Sistema de Mantención",
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
	});
	assert.equal(result.project.id, "sistema-de-mantencion");
	assert.equal(existsSync(result.statePaths.stateRoot), true);
	assert.equal(
		existsSync(join(projectPath, "config", "project-core.json")),
		false,
	);
	const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
		projects: Array<{ id: string }>;
	};
	assert.equal(registry.projects[0].id, "sistema-de-mantencion");
	rmSync(root, { recursive: true, force: true });
});

test("project status reports registered and state paths", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	projectEnroll({
		projectPath,
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
	});
	const status = projectInstallStatus({
		projectPath,
		workspaceRoot,
		allowedRoots: [root],
		registryPath,
		mcpAvailable: true,
	});
	assert.equal(status.registered, true);
	assert.equal(status.mcpAvailable, true);
	assert.match(formatProjectInstallStatus(status), /registered/u);
	rmSync(root, { recursive: true, force: true });
});

test("setup status formatter includes recommendations", () => {
	const text = formatIduSetupStatus({
		system: detectSystem({ platform: "linux", env: { SHELL: "bash" } }),
		tools: detectTools({ runner: () => undefined }),
		agentConfigs: detectAgentConfigs({
			env: {},
			homeDir: tempDir(),
			exists: () => false,
		}),
		mcpInstalled: false,
	});
	assert.match(text, /Idu-pi Setup/u);
	assert.match(text, /idu-pi setup mcp-init/u);
});

test("formatProjectEnrollResult shows created paths", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const result = projectEnroll({
		projectPath,
		workspaceRoot: join(root, "workspace"),
		allowedRoots: [root],
		registryPath: join(root, "registry.json"),
	});
	assert.match(formatProjectEnrollResult(result), /Proyecto enrolado/u);
	rmSync(root, { recursive: true, force: true });
});

test("CLI setup status works with temp environment", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["setup", "status"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Setup/u);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI setup mcp-init works in temp agent dir", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["setup", "mcp-init"]);
		assert.equal(result.exitCode, 0);
		assert.match(
			result.stdout,
			/MCP idu-pi y comandos slash globales configurados/u,
		);
		assert.equal(existsSync(join(agentDir, "mcp.json")), true);
		assert.equal(
			existsSync(join(agentDir, "extensions", "idu-pi-commands.ts")),
			true,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI setup mcp-init --target opencode writes OpenCode config only", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	const previousHome = process.env.USERPROFILE;
	try {
		process.chdir(root);
		process.env.USERPROFILE = root;
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand([
			"setup",
			"mcp-init",
			"--target",
			"opencode",
		]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /MCP idu-pi configurado para OpenCode/u);
		const opencodeConfigPath = join(
			root,
			".config",
			"opencode",
			"opencode.json",
		);
		assert.equal(existsSync(opencodeConfigPath), true);
		assert.equal(existsSync(join(agentDir, "mcp.json")), false);
		assert.equal(
			existsSync(join(agentDir, "extensions", "idu-pi-commands.ts")),
			false,
		);
		const parsed = JSON.parse(readFileSync(opencodeConfigPath, "utf8")) as {
			mcp: Record<
				string,
				{ type: string; command: string[]; enabled: boolean }
			>;
		};
		assert.equal(parsed.mcp["idu-pi"].type, "local");
		assert.equal(parsed.mcp["idu-pi"].command[0], "node");
		assert.match(parsed.mcp["idu-pi"].command[1], /mcp-server\.js$/u);
		assert.equal(parsed.mcp["idu-pi"].enabled, true);
	} finally {
		process.env.USERPROFILE = previousHome;
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI /idu bootstraps external project and second call fast-paths", async () => {
	const root = tempDir();
	const projectPath = join(root, "Sistema_de_mantencion");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const first = await runCliCommand(["idu"]);
		assert.equal(first.exitCode, 0);
		assert.match(
			first.stdout,
			/No detecté código de producto todavía|PLAN MAESTRO DE INGENIERÍA Y ARQUITECTURA \(A-Z\)/u,
		);
		assert.match(
			first.stdout,
			/¿Creamos el proyecto base\?|Plan preparado para firma humana/u,
		);
		// Slice 3/5: project-core.json now lives under <stateRoot>/.idu/config/.
		// Note: <stateRoot>/config/project-core.json is migrated on first
		// read by loadProjectCore, so the legacy path may or may not exist
		// depending on the order of reader calls. We assert the new location.
		const stateRoot = join(workspaceRoot, "projects", "sistema_de_mantencion");
		assert.equal(
			existsSync(join(stateRoot, ".idu", "config", "project-core.json")),
			true,
		);
		// Slice 2/5: project-blueprint now lives under stateRoot (Layout A).
		assert.equal(
			existsSync(join(stateRoot, ".idu", "config", "project-blueprint.json")),
			true,
		);
		assert.equal(existsSync(join(stateRoot, "master-plan.current.json")), true);
		assert.equal(existsSync(join(stateRoot, "master-plan.memory.json")), true);
		assert.equal(existsSync(join(stateRoot, "master-plan.json")), true);
		assert.equal(existsSync(join(stateRoot, "master-plan.md")), true);
		assert.equal(existsSync(join(stateRoot, "project-index.json")), true);
		assert.equal(
			readdirSync(join(stateRoot, "reports")).filter((entry) =>
				/^master-plan-.*\.json$/u.test(entry),
			).length,
			0,
		);
		assert.match(
			first.stdout,
			/Documentos preparados: JSON=|Documentos: JSON=/u,
		);
		if (!/¿Creamos el proyecto base\?/u.test(first.stdout)) {
			assert.match(first.stdout, /Aprobar plan —/u);
			assert.match(first.stdout, /Desaprobar plan —/u);
			assert.match(first.stdout, /Trabajarlo interactivo —/u);
			assert.match(first.stdout, /Reevaluar en profundidad —/u);
		}
		assert.doesNotMatch(first.stdout, /idu-pi idu-prepare/u);
		assert.doesNotMatch(first.stdout, /Advertencias breves:/u);
		const approve = await runCliCommand(["idu-master-plan-approve", "latest"]);
		assert.equal(approve.exitCode, 0);
		const second = await runCliCommand(["idu"]);
		assert.equal(second.exitCode, 0);
		assert.match(
			second.stdout,
			/No detecté código de producto todavía|PLAN MAESTRO DE INGENIERÍA Y ARQUITECTURA \(A-Z\)/u,
		);
		if (!/¿Creamos el proyecto base\?/u.test(second.stdout)) {
			assert.match(second.stdout, /Estado del Documento: APROBADO/u);
			assert.match(
				second.stdout,
				/Plan fiable y actualizado|Plan preparado para firma humana/u,
			);
		}
		assert.equal(
			readdirSync(join(stateRoot, "reports")).filter((entry) =>
				/^master-plan-.*\.json$/u.test(entry),
			).length,
			0,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI project enroll works in temp project dir", async () => {
	const root = tempDir();
	const projectPath = join(root, "Sistema_de_mantencion");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "pi-agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		setCliEnv({ projectPath, workspaceRoot, agentDir, allowedRoot: root });
		const result = await runCliCommand(["project", "enroll", projectPath]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Proyecto enrolado/u);
		assert.equal(
			existsSync(
				join(workspaceRoot, "projects", "sistema_de_mantencion", "reports"),
			),
			true,
		);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function setCliEnv(input: {
	projectPath: string;
	workspaceRoot: string;
	agentDir: string;
	allowedRoot: string;
}): void {
	process.env.DEFAULT_CWD = input.projectPath;
	process.env.ALLOWED_ROOTS = input.allowedRoot;
	process.env.AGENT_WORKSPACE_ROOT = input.workspaceRoot;
	process.env.PI_CODING_AGENT_DIR = input.agentDir;
	process.env.IDU_PI_REGISTRY_PATH = join(input.workspaceRoot, "projects.json");
	process.env.TELEGRAM_BOT_TOKEN = "test-token";
	process.env.ALLOWED_USER_ID = "12345";
}

test("setup mcp-print does not require project env", async () => {
	const previous = snapshotEnv();
	try {
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		const result = await runCliCommand(["setup", "mcp-print"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /idu-pi/u);
	} finally {
		restoreEnv(previous);
	}
});

test("setup mcp-print --target opencode emits OpenCode config", async () => {
	const previous = snapshotEnv();
	try {
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		const result = await runCliCommand([
			"setup",
			"mcp-print",
			"--target",
			"opencode",
		]);
		assert.equal(result.exitCode, 0);
		const parsed = JSON.parse(result.stdout) as {
			mcp: Record<
				string,
				{ type: string; command: string[]; enabled: boolean }
			>;
		};
		assert.equal(parsed.mcp["idu-pi"].type, "local");
		assert.equal(parsed.mcp["idu-pi"].command[0], "node");
		assert.match(parsed.mcp["idu-pi"].command[1], /mcp-server\.js$/u);
		assert.equal(parsed.mcp["idu-pi"].enabled, true);
	} finally {
		restoreEnv(previous);
	}
});

test("project status rejects paths outside allowed roots", () => {
	const root = tempDir();
	const allowed = join(root, "allowed");
	const outside = join(root, "outside");
	mkdirSync(allowed, { recursive: true });
	mkdirSync(outside, { recursive: true });
	assert.throws(
		() =>
			projectInstallStatus({
				projectPath: outside,
				workspaceRoot: join(root, "workspace"),
				allowedRoots: [allowed],
			}),
		/Ruta fuera de ALLOWED_ROOTS/u,
	);
	rmSync(root, { recursive: true, force: true });
});
