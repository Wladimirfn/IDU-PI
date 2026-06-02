import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	applyPackageEnvDefaults,
	buildCliHomeStatus,
	formatCliHome,
	formatCliConfigurationStatus,
	formatCliProjectStatus,
	formatCliSystemStatus,
	formatIduLogo,
	formatInstallationMenu,
	formatMainMenu,
	formatModelProfilesMenu,
	formatModelProfilesStatus,
	formatSetupPathHelp,
	formatTelegramRemoteMenu,
} from "../src/cli-home.js";
import {
	createCliRuntime,
	runCliCommand,
	runInteractiveHomeWithQuestion,
} from "../src/cli.js";
import { saveModelAssignment } from "../src/model-assignments.js";

function tempDir(prefix = "idu-cli-home-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		AGENT_WORKSPACE_MODE: process.env.AGENT_WORKSPACE_MODE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PNPM_HOME: process.env.PNPM_HOME,
		PATH: process.env.PATH,
		Path: process.env.Path,
		PI_AGENT_PROFILES: process.env.PI_AGENT_PROFILES,
		IDU_PI_ENV_PATH: process.env.IDU_PI_ENV_PATH,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

test("formatIduLogo contains recognizable IDU-Pi mark", () => {
	assert.match(formatIduLogo(), /IDU-Pi/u);
	assert.match(formatIduLogo(), /\x1b\[95m/u);
	assert.match(formatIduLogo(), /\x1b\[35m/u);
});

test("idu-pi without args shows home", async () => {
	const result = await runCliCommand([]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /^Idu-pi/mu);
	assert.match(result.stdout, /Acciones:/u);
});

test("home does not write files", async () => {
	const root = tempDir();
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		delete process.env.PI_CODING_AGENT_DIR;
		const before = readdirSync(root);
		const result = await runCliCommand(["home"]);
		const after = readdirSync(root);
		assert.equal(result.exitCode, 0);
		assert.deepEqual(after, before);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("home detects cwd project candidate from git root", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const status = buildCliHomeStatus({
		cwd: join(projectPath, "subdir"),
		gitRoot: projectPath,
		env: {
			DEFAULT_CWD: projectPath,
			ALLOWED_ROOTS: root,
			AGENT_WORKSPACE_ROOT: join(root, "workspace"),
			PATH: "",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(status.project.candidatePath, projectPath);
	assert.equal(status.project.isGitRepository, true);
	rmSync(root, { recursive: true, force: true });
});

test("home shows MCP installed and missing states", () => {
	const root = tempDir();
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	const missing = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(missing.mcpInstalled, false);
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "node" } } }),
		"utf8",
	);
	const installed = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.equal(installed.mcpInstalled, true);
	rmSync(root, { recursive: true, force: true });
});

test("home shows enrolled and unenrolled project states", () => {
	const root = tempDir();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		const projectPath = join(root, "project");
		const workspaceRoot = join(root, "workspace");
		mkdirSync(join(root, "data"), { recursive: true });
		mkdirSync(projectPath, { recursive: true });
		const registryPath = join(root, "data", "projects.json");
		const unregistered = buildCliHomeStatus({
			cwd: projectPath,
			gitRoot: projectPath,
			registryPath,
			env: {
				DEFAULT_CWD: projectPath,
				ALLOWED_ROOTS: root,
				AGENT_WORKSPACE_ROOT: workspaceRoot,
				PATH: "",
			},
			runner: () => undefined,
			stdinInteractive: false,
		});
		assert.equal(unregistered.project.registered, false);
		writeFileSync(
			registryPath,
			JSON.stringify({
				activeProjectId: "project",
				projects: [
					{
						id: "project",
						name: "project",
						path: projectPath,
						stateRoot: join(workspaceRoot, "projects", "project"),
					},
				],
			}),
			"utf8",
		);
		const registered = buildCliHomeStatus({
			cwd: projectPath,
			gitRoot: projectPath,
			registryPath,
			env: {
				DEFAULT_CWD: projectPath,
				ALLOWED_ROOTS: root,
				AGENT_WORKSPACE_ROOT: workspaceRoot,
				PATH: "",
			},
			runner: () => undefined,
			stdinInteractive: false,
		});
		assert.equal(registered.project.registered, true);
		assert.match(formatCliHome(registered), /Proyecto enrolado: sí/u);
	} finally {
		process.chdir(previousCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("main and installation menus render unified control options", () => {
	const status = buildCliHomeStatus({
		env: { PATH: "" },
		runner: () => undefined,
		stdinInteractive: true,
		version: "0.1.1",
	});
	const menu = formatMainMenu(status);
	assert.match(menu, /1\. Configurar IDU-Pi/u);
	assert.match(menu, /2\. Proyecto actual/u);
	assert.match(menu, /3\. Telegram remoto/u);
	assert.match(menu, /4\. Modelos y perfiles/u);
	assert.match(menu, /5\. Supervisor/u);
	assert.match(menu, /6\. Tareas y cola/u);
	assert.match(menu, /7\. Diagnóstico/u);
	assert.match(menu, /8\. Exit/u);
	assert.match(formatInstallationMenu(), /Instalar\/actualizar MCP en Pi/u);
	assert.match(
		formatInstallationMenu(),
		/Activar supervisor en este proyecto/u,
	);
});

test("system status renders MCP Pi and PATH diagnostics", () => {
	const root = tempDir();
	const agentDir = join(root, "agent");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { "idu-pi": { command: "node" } } }),
		"utf8",
	);
	writeFileSync(
		join(agentDir, "extensions", "idu-pi-commands.ts"),
		"extension",
		"utf8",
	);
	const status = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: (command) => (command === "node" ? "v20.0.0" : undefined),
		stdinInteractive: false,
	});
	const text = formatCliSystemStatus(status);
	assert.match(text, /MCP idu-pi: presente/u);
	assert.match(text, /Extensión Pi: presente/u);
	assert.match(text, /pnpm global bin en PATH: no/u);
	const config = formatCliConfigurationStatus(status);
	assert.match(config, /Configuración Idu-pi/u);
	assert.match(config, /MCP config:/u);
	assert.match(config, /Registry proyectos:/u);
	rmSync(root, { recursive: true, force: true });
});

test("project status renderer shows enrolled and unregistered project states", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	mkdirSync(join(root, "data"), { recursive: true });
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "data", "projects.json");
	const unregistered = buildCliHomeStatus({
		cwd: projectPath,
		gitRoot: projectPath,
		registryPath,
		env: {
			DEFAULT_CWD: projectPath,
			ALLOWED_ROOTS: root,
			AGENT_WORKSPACE_ROOT: workspaceRoot,
			PATH: "",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.match(formatCliProjectStatus(unregistered), /enrolado: no/u);
	assert.match(
		formatCliProjectStatus(unregistered),
		/recommended next: enroll/u,
	);
	writeFileSync(
		registryPath,
		JSON.stringify({
			activeProjectId: "project",
			projects: [
				{
					id: "project",
					name: "project",
					path: projectPath,
					stateRoot: join(workspaceRoot, "projects", "project"),
				},
			],
		}),
		"utf8",
	);
	const registered = buildCliHomeStatus({
		cwd: projectPath,
		gitRoot: projectPath,
		registryPath,
		env: {
			DEFAULT_CWD: projectPath,
			ALLOWED_ROOTS: root,
			AGENT_WORKSPACE_ROOT: workspaceRoot,
			PATH: "",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	assert.match(formatCliProjectStatus(registered), /enrolado: sí/u);
	rmSync(root, { recursive: true, force: true });
});

test("telegram remote submenu exposes real management actions", () => {
	const menu = formatTelegramRemoteMenu();
	assert.match(menu, /1\. Ver estado remoto/u);
	assert.match(menu, /2\. Configurar acceso remoto/u);
	assert.match(menu, /3\. Sincronizar comandos remotos/u);
	assert.match(menu, /4\. Iniciar puente remoto/u);
	assert.match(menu, /5\. Detener puente remoto/u);
	assert.match(menu, /6\. Reiniciar puente remoto/u);
	assert.match(menu, /7\. Ver logs/u);
});

test("interactive telegram remote config writes masked env with backup", async () => {
	const root = tempDir();
	const envPath = join(root, ".env");
	const tokenKey = `TELEGRAM_BOT_${"TOKEN"}`;
	writeFileSync(
		envPath,
		`CUSTOM_KEEP=yes\n${tokenKey}=old-secret\nALLOWED_USER_ID=123\n`,
		"utf8",
	);
	const previous = snapshotEnv();
	try {
		process.env.IDU_PI_ENV_PATH = envPath;
		const answers = ["3", "2", "new-secret-token", "456", "s"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "n",
		);
		assert.match(output, /Acceso remoto guardado/u);
		assert.doesNotMatch(output, /new-secret-token/u);
		assert.match(
			readFileSync(envPath, "utf8"),
			new RegExp(`${tokenKey}=new-secret-token`, "u"),
		);
		assert.match(readFileSync(envPath, "utf8"), /CUSTOM_KEEP=yes/u);
		assert.ok(
			readdirSync(root).some((entry) => entry.startsWith(".env.backup-")),
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("interactive telegram remote lifecycle uses injected launcher", async () => {
	const calls: string[] = [];
	const answers = ["3", "4", "s"];
	const output = await runInteractiveHomeWithQuestion(
		async () => answers.shift() ?? "n",
		() => {},
		{ bridgeLauncher: (action) => calls.push(action) },
	);
	assert.deepEqual(calls, ["run"]);
	assert.match(output, /Abriendo bridge/u);
});

test("model profile panel renders current profiles and planned Idu-pi roles", () => {
	const status = buildCliHomeStatus({
		env: {
			PATH: "",
			PI_AGENT_PROFILES:
				"default|Pi default|--model nvidia/kimi-k2;barato|Barato|--model nvidia/deepseek-v3;seguridad|Seguridad|--model nvidia/qwen3-coder",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	const panel = formatModelProfilesStatus(status);
	assert.match(panel, /Modelos y perfiles/u);
	assert.match(panel, /Current profiles:/u);
	assert.match(panel, /Pi default \(default\).*nvidia\/kimi-k2/u);
	assert.match(panel, /Barato \(barato\).*nvidia\/deepseek-v3/u);
	assert.match(panel, /Current assignments:/u);
	assert.match(panel, /Supervisor principal.*Pi default/u);
	assert.match(panel, /Unique AgentLab profile models:/u);
	assert.match(panel, /nvidia\/deepseek-v3/u);
	assert.match(panel, /AgentLab general/u);
	assert.match(panel, /recomendado: Barato/u);
	assert.match(panel, /AgentLab seguridad/u);
	assert.match(panel, /recomendado: Seguridad/u);
	assert.match(panel, /guarda PI_AGENT_PROFILES en \.env con backup/u);
});

test("model profile panel warns when AgentLab profiles duplicate the same model", () => {
	const status = buildCliHomeStatus({
		env: {
			PATH: "",
			PI_AGENT_PROFILES:
				"default|Pi default;codex|GPT Codex|--model openai-codex/gpt-5.3-codex-spark;spark|Spark|--model openai-codex/gpt-5.3-codex-spark",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	const panel = formatModelProfilesStatus(status);
	assert.match(panel, /Duplicate model warnings:/u);
	assert.match(panel, /codex, spark/u);
	assert.match(panel, /estado: blocked/u);
	assert.match(panel, /Diversidad insuficiente/u);
});

test("model profiles submenu exposes navigable actions", () => {
	const menu = formatModelProfilesMenu();
	assert.match(menu, /1\. Ver perfiles actuales/u);
	assert.match(menu, /2\. Editar perfiles/u);
	assert.match(menu, /3\. Propuesta automática por AgentLab/u);
	assert.match(menu, /4\. Asignar modelos por rol/u);
	assert.match(menu, /5\. Validar configuración/u);
	assert.doesNotMatch(menu, /Save/u);
	assert.match(menu, /6\. ← Volver/u);
	assert.match(menu, /7\. Exit/u);
});

test("interactive home model option is non-mutating", async () => {
	const root = tempDir();
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(root);
		process.env.PI_AGENT_PROFILES =
			"default|Pi default|--model nvidia/kimi-k2;barato|Barato|--model nvidia/deepseek-v3";
		const before = readdirSync(root);
		const answers = ["4", "1"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "7",
		);
		const after = readdirSync(root);
		assert.match(output, /Modelos y perfiles/u);
		assert.match(output, /Supervisor principal/u);
		assert.deepEqual(after, before);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("interactive model profile edit writes env with backup", async () => {
	const root = tempDir();
	const envPath = join(root, ".env");
	const tokenKey = `TELEGRAM_BOT_${"TOKEN"}`;
	writeFileSync(
		envPath,
		`${tokenKey}=secret\nALLOWED_USER_ID=123\nPI_AGENT_PROFILES=default|Pi default\n`,
		"utf8",
	);
	const previous = snapshotEnv();
	try {
		process.env.IDU_PI_ENV_PATH = envPath;
		const answers = [
			"4",
			"2",
			"default|Pi default;codex|GPT Codex|--model openai-codex/gpt",
			"s",
		];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "n",
		);
		assert.match(output, /Perfiles guardados/u);
		assert.match(readFileSync(envPath, "utf8"), /codex\|GPT Codex/u);
		assert.match(
			readFileSync(envPath, "utf8"),
			new RegExp(`${tokenKey}=secret`, "u"),
		);
		assert.ok(
			readdirSync(root).some((entry) => entry.startsWith(".env.backup-")),
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("createCliRuntime applies supervisor-main model assignment", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(join(root, "data"), { recursive: true });
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify({
			activeProjectId: "project",
			projects: [
				{
					id: "project",
					name: "project",
					path: projectPath,
					stateRoot: join(workspaceRoot, "projects", "project"),
				},
			],
		}),
		"utf8",
	);
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.AGENT_WORKSPACE_MODE = "direct";
		process.env.IDU_PI_REGISTRY_PATH = join(root, "data", "projects.json");
		process.env.PI_AGENT_PROFILES =
			"default|Pi default;codex|GPT Codex|--model openai-codex/gpt";
		saveModelAssignment(
			join(workspaceRoot, "projects", "project"),
			"supervisor-main",
			"codex",
			[
				{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
				{
					id: "codex",
					label: "GPT Codex",
					provider: "pi",
					piArgs: ["--model", "openai-codex/gpt"],
				},
			],
		);

		const runtime = createCliRuntime({ requireTelegramConfig: false });

		assert.equal(runtime.activeProfileId?.(), "codex");
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("interactive model role assignment writes project state", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(join(root, "data"), { recursive: true });
	mkdirSync(projectPath, { recursive: true });
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify({
			activeProjectId: "project",
			projects: [
				{ id: "project", name: "project", path: projectPath, stateRoot },
			],
		}),
		"utf8",
	);
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = join(root, "workspace");
		process.env.IDU_PI_REGISTRY_PATH = join(root, "data", "projects.json");
		process.env.PI_AGENT_PROFILES =
			"default|Pi default;codex|GPT Codex|--model openai-codex/gpt";
		const answers = ["4", "4", "agentlab-security", "codex", "s"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "",
		);
		assert.match(output, /Asignación guardada/u);
		assert.match(
			readFileSync(join(stateRoot, "model-assignments.json"), "utf8"),
			/agentlab-security/u,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("home shows PATH help when pnpm global bin is not in PATH", () => {
	const status = buildCliHomeStatus({
		env: {
			PNPM_HOME: "C:\\Users\\elmas\\AppData\\Local\\pnpm\\bin",
			PATH: "C:\\Windows",
		},
		runner: () => undefined,
		stdinInteractive: false,
	});
	const text = formatCliHome(status);
	assert.match(text, /PNPM_HOME no está en PATH/u);
	assert.match(text, /corepack pnpm setup/u);
});

test("setup wizard in non-interactive mode does not wait", async () => {
	const result = await runCliCommand(["setup", "wizard"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /stdin no es interactivo/u);
});

test("package env defaults fill core config without external cwd", () => {
	const previous = snapshotEnv();
	try {
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		applyPackageEnvDefaults();
		assert.ok(process.env.DEFAULT_CWD);
		assert.ok(process.env.ALLOWED_ROOTS);
	} finally {
		restoreEnv(previous);
	}
});

test("setup path-help shows pnpm setup and global link steps", async () => {
	const result = await runCliCommand(["setup", "path-help"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /corepack pnpm setup/u);
	assert.match(result.stdout, /corepack pnpm link --global/u);
	assert.match(result.stdout, /node dist\/src\/cli\.js/u);
	assert.match(formatSetupPathHelp(), /No modifico PATH automáticamente/u);
});

test("installation MCP action requires confirmation and no writes on no", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const answers = ["1", "2", "n"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "n",
		);
		assert.match(output, /Cancelado sin cambios/u);
		assert.equal(readdirSync(root).includes("agent"), false);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("project enroll action requires confirmation and no writes on no", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const agentDir = join(root, "agent");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const answers = ["1", "4", "n"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "n",
		);
		assert.match(output, /Cancelado sin cambios/u);
		assert.equal(readdirSync(root).includes("workspace"), false);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("wizard activation does not create missing stateRoot", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	const missingStateRoot = join(workspaceRoot, "projects", "project");
	mkdirSync(join(root, "data"), { recursive: true });
	mkdirSync(projectPath, { recursive: true });
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify({
			activeProjectId: "project",
			projects: [
				{
					id: "project",
					name: "project",
					path: projectPath,
					stateRoot: missingStateRoot,
				},
			],
		}),
		"utf8",
	);
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.IDU_PI_REGISTRY_PATH = join(root, "data", "projects.json");
		const answers = ["1", "5", "s"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "n",
		);
		assert.match(output, /stateRoot aislado existente/u);
		assert.equal(readdirSync(root).includes("workspace"), false);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("wizard source avoids AgentLabs scans prepare and bootstrap", () => {
	const source = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");
	const interactiveBlock = source.slice(
		source.indexOf("async function runInstallationMenu"),
	);
	assert.doesNotMatch(
		interactiveBlock,
		/agentLabReviewRun|runTestLab|scanProjectMap|runCliCommand\(\["idu"\]\)|prepare\(\)|runBootstrapIduCommand/u,
	);
	assert.match(
		interactiveBlock,
		/No ejecuté bootstrap, scans, prepare ni AgentLabs/u,
	);
});

test("existing setup command still works", async () => {
	const result = await runCliCommand(["setup", "status"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Idu-pi Setup/u);
});
