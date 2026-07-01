import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
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
	__testSelectSearchableMenu,
	createCliRuntime,
	runCliCommand,
	runInteractiveHomeWithQuestion,
} from "../src/cli.js";
import { saveModelAssignment } from "../src/model-assignments.js";
import { recordIduUsageEvent, usageEventsPath } from "../src/usage-events.js";
import { recordSupervisorActivityEvent } from "../src/supervisor-activity-events.js";
import { recordContextQualityEvent } from "../src/context-quality-events.js";

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
		IDU_PI_MODEL_CATALOG_PATH: process.env.IDU_PI_MODEL_CATALOG_PATH,
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
	assert.equal(
		realpathSync.native(status.project.candidatePath),
		realpathSync.native(projectPath),
	);
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

test("home warns when configured MCP runtime build may be stale", () => {
	const root = tempDir();
	const agentDir = join(root, "agent");
	const packageRoot = join(root, "pkg");
	const sourcePath = join(packageRoot, "src", "mcp-server.ts");
	const serverPath = join(packageRoot, "dist", "src", "mcp-server.js");
	mkdirSync(join(packageRoot, "src"), { recursive: true });
	mkdirSync(join(packageRoot, "dist", "src"), { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(sourcePath, "source", "utf8");
	writeFileSync(serverPath, "dist", "utf8");
	utimesSync(
		serverPath,
		new Date("2026-06-05T00:00:00.000Z"),
		new Date("2026-06-05T00:00:00.000Z"),
	);
	utimesSync(
		sourcePath,
		new Date("2026-06-05T00:10:00.000Z"),
		new Date("2026-06-05T00:10:00.000Z"),
	);
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				"idu-pi": { command: "node", args: [serverPath] },
			},
		}),
		"utf8",
	);

	const status = buildCliHomeStatus({
		env: { PI_CODING_AGENT_DIR: agentDir, PATH: "" },
		runner: () => undefined,
		stdinInteractive: false,
	});

	assert.equal(status.mcpInstalled, true);
	assert.equal(status.mcpRuntime.status, "source_newer");
	assert.match(
		formatCliSystemStatus(status),
		/MCP runtime: source newer; run corepack pnpm build and reload MCP in Pi/u,
	);
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
	assert.match(menu, /6\. Tareas/u);
	assert.match(menu, /7\. Cola de acciones/u);
	assert.match(menu, /8\. Diagnóstico/u);
	assert.match(menu, /9\. Exit/u);
	assert.match(formatInstallationMenu(), /Instalar\/actualizar MCP en Pi/u);
	assert.match(
		formatInstallationMenu(),
		/Activar supervisor en este proyecto/u,
	);
	assert.match(
		formatInstallationMenu(),
		/6\. Trigger supervisor/u,
	);
	assert.match(
		formatInstallationMenu(),
		/7\. ← Volver/u,
	);
	assert.match(formatInstallationMenu(), /8\. Exit/u);
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

test("current project panel recommends core confirmation for draft project core", () => {
	const root = tempDir("idu-cli-home-core-confirm-");
	try {
		const projectPath = join(root, "project");
		mkdirSync(projectPath, { recursive: true });
		const workspaceRoot = join(root, "workspace");
		const stateRoot = join(workspaceRoot, "projects", "project");
		// Etapa 4b.1 fix (kind-aware display): the constitution is
		// only loaded when the core is confirmed (R5.2 fail-loud
		// contract). A draft core short-circuits the constitution
		// loader with kind: "skipped" reason: "core-not-confirmed",
		// which the TUI surfaces as "missing" — the honest signal
		// that the project has no real confirmed governance.
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-core.json"),
			JSON.stringify({ status: "draft" }),
			"utf8",
		);
		const registryPath = join(root, "projects.json");
		writeFileSync(
			registryPath,
			JSON.stringify({
				activeProjectId: "project",
				projects: [
					{
						id: "project",
						name: "project",
						path: projectPath,
						stateRoot,
					},
				],
			}),
			"utf8",
		);
		const status = buildCliHomeStatus({
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
		const output = formatCliProjectStatus(status);
		assert.match(output, /Project Core: pending/u);
		// Etapa 4b.1: a draft core means the constitution loader
		// short-circuits with kind: "skipped", so the TUI shows
		// "missing" — not a fabricated "draft".
		assert.match(output, /Constitution: missing/u);
		assert.match(output, /recommended next: confirm_core/u);
		assert.doesNotMatch(output, /recommended next: bootstrap/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel shows active Constitution status", () => {
	const root = tempDir("idu-cli-home-constitution-");
	try {
		const projectPath = join(root, "project");
		mkdirSync(projectPath, { recursive: true });
		const workspaceRoot = join(root, "workspace");
		const stateRoot = join(workspaceRoot, "projects", "project");
		// Etapa 4b.1 fix: the constitution loader is gated by the
		// project core. To show Constitution: "active" we need BOTH
		// a confirmed core at Layout A AND a constitution at Layout
		// A. The pre-fix test only wrote Layout B; the bug let
		// the TUI show "active" without the core being confirmed.
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-core.json"),
			JSON.stringify({
				version: "1.0.0",
				projectName: "Demo",
				projectGoal: "Test goal.",
				problemStatement: "Test problem.",
				targetUsers: ["planner"],
				projectType: "telegram-bot",
				complexityLevel: "medium",
				deploymentTarget: "server",
				securityLevel: "medium",
				dataSensitivity: "medium",
				preferredStack: ["TypeScript"],
				rejectedStack: ["spreadsheet"],
				architectureStyle: "modular",
				includedScope: ["scope"],
				excludedScope: ["other"],
				initialModules: ["m"],
				criticalFlows: ["f"],
				successCriteria: ["s"],
				validationCommands: ["v"],
				humanDecisions: ["h"],
				assumptions: ["a"],
				openQuestions: ["q"],
				status: "confirmed",
				createdAt: "2026-05-22T00:00:00.000Z",
				updatedAt: "2026-05-22T00:00:00.000Z",
			}),
			"utf8",
		);
		// Reuse the package's default constitution as a base — its
		// shape is the contract that loadConfirmedProjectConstitution
		// enforces. Override only the active state for the test.
		// Etapa 4b.1: a confirmed core + active constitution surfaces
		// "Constitution: active" in the TUI (the same path the real
		// enforcement gate uses, R5.2 fail-loud).
		const validConstitution = JSON.parse(
			readFileSync(join(process.cwd(), "config", "default-constitution.json"), "utf8"),
		);
		validConstitution.sourceCoreStatus = "confirmed";
		validConstitution.status = "active";
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-constitution.json"),
			JSON.stringify(validConstitution),
			"utf8",
		);
		// Register the project so buildCliHomeStatus resolves the
		// stateRoot to <workspaceRoot>/projects/project (where the
		// core and constitution live). Without this, the home shows
		// the project as unregistered and constitutionStatus never
		// sees the files.
		mkdirSync(join(root, "data"), { recursive: true });
		const registryPath = join(root, "data", "projects.json");
		writeFileSync(
			registryPath,
			JSON.stringify({
				activeProjectId: "project",
				projects: [
					{
						id: "project",
						name: "project",
						path: projectPath,
						stateRoot,
					},
				],
			}),
			"utf8",
		);
		const status = buildCliHomeStatus({
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
		const output = formatCliProjectStatus(status);
		assert.match(output, /Constitution: active/u);
		assert.doesNotMatch(output, /Constitution: draft/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel shows local usage metrics from stateRoot", async () => {
	const root = tempDir("idu-cli-home-usage-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(stateRoot, {
			projectId: "project",
			surface: "cli",
			action: "idu-status",
			active: true,
			allowedToProceed: true,
			ok: true,
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Uso local/u);
		assert.match(output, /llamadas Idu-pi: 1/u);
		assert.match(output, /superficie: cli 1 · mcp 0 · tui 0/u);
		assert.match(output, /Actividad supervisor local/u);
		assert.match(output, /tokens Idu-pi: no medido/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel surfaces stale MCP context pack separately from local usage", async () => {
	const root = tempDir("idu-cli-home-stale-mcp-context-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(stateRoot, {
			projectId: "project",
			surface: "mcp",
			action: "idu_supervisor_context_pack",
		});
		await recordIduUsageEvent(stateRoot, {
			projectId: "project",
			surface: "cli",
			action: "automaticov1",
		});
		const path = usageEventsPath(stateRoot);
		const staleContextPack = new Date(Date.now() - 15 * 60_000).toISOString();
		const recentCli = new Date(Date.now() - 1 * 60_000).toISOString();
		const jsonl = readFileSync(path, "utf8")
			.trim()
			.split(/\r?\n/u)
			.map((line, index) => {
				const event = JSON.parse(line) as Record<string, unknown>;
				event.timestamp = index === 0 ? staleContextPack : recentCli;
				return JSON.stringify(event);
			})
			.join("\n");
		writeFileSync(path, `${jsonl}\n`, "utf8");
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /última llamada Idu-pi: hace 1m/u);
		assert.match(
			output,
			/MCP context pack: stale hace 15m; sugerido refrescar idu_supervisor_context_pack/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel shows context quality metrics from stateRoot", async () => {
	const root = tempDir("idu-cli-home-context-quality-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordContextQualityEvent(stateRoot, {
			projectId: "project",
			source: "mcp",
			scope: "supervisor_context_pack",
			profile: "supervisor_context_pack",
			compactness: "warning",
			relevance: "ok",
			noise: "ok",
			completeness: "ok",
			usedChars: 9000,
			maxTotalChars: 10000,
			truncated: true,
			omittedCount: 1,
			omittedReasons: { max_chars: 1 },
			contractsCount: 1,
			requiredReadsCount: 1,
			risksCount: 1,
			autonomyGatesCount: 1,
			skipNoiseGuidanceCount: 1,
			hasHumanVision: true,
			hasPlanObjective: true,
			hasTaskGoal: true,
			hasTaskPackage: true,
			hasTaskContext: true,
			ok: true,
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Calidad de contexto local/u);
		assert.match(output, /eventos contexto: 1/u);
		assert.match(output, /compacto: ok 0 · warning 1 · incomplete 0/u);
		assert.match(output, /prompts\/docs crudos: no almacenado/u);
		assert.match(output, /tokens\/costo\/% contexto: no medido/u);
		assert.match(output, /analytics remota: no/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel shows supervisor activity metrics from stateRoot", async () => {
	const root = tempDir("idu-cli-home-supervisor-activity-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordSupervisorActivityEvent(stateRoot, {
			projectId: "project",
			eventType: "supervisor_hook",
			origin: "supervisor_auto_hook",
			trigger: "after_postflight",
			status: "completed",
			createdTasks: 2,
			auditRunRecorded: true,
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Actividad supervisor local/u);
		assert.match(output, /eventos supervisor: 1/u);
		assert.match(output, /hooks automáticos: 1/u);
		assert.match(output, /tareas propuestas: 2/u);
		assert.match(output, /llamadas Idu-pi: 0/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel shows empty usage metrics without state writes", () => {
	const root = tempDir("idu-cli-home-empty-usage-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Uso local/u);
		assert.match(output, /llamadas Idu-pi: 0/u);
		assert.match(output, /compactaciones detectadas: no medido/u);
		assert.equal(
			existsSync(join(stateRoot, "reports", "idu-usage-events.jsonl")),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel hides usage metrics for unregistered projects", async () => {
	const root = tempDir("idu-cli-home-unregistered-usage-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(stateRoot, {
			projectId: "project",
			surface: "cli",
			action: "idu-status",
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: false,
				projectId: "project",
				stateRoot,
			},
		});
		assert.doesNotMatch(output, /Uso local/u);
		assert.doesNotMatch(output, /llamadas Idu-pi: 1/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current project panel usage metrics ignore workspaceRoot usage file", async () => {
	const root = tempDir("idu-cli-home-usage-root-");
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(projectPath, {
			projectId: "wrong-root",
			surface: "mcp",
			action: "wrong-root-event",
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
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
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Uso local/u);
		assert.match(output, /llamadas Idu-pi: 0/u);
		assert.doesNotMatch(output, /wrong-root-event/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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

test("model profile panel stays focused on project context and assignments", () => {
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
	assert.match(panel, /Modelos Idu-pi/u);
	assert.match(panel, /Configurá qué modelo usa cada rol/u);
	assert.match(panel, /Contexto actual:/u);
	assert.match(panel, /Proyecto:/u);
	assert.match(panel, /Asignaciones actuales:/u);
	assert.match(panel, /Acciones disponibles:/u);
	assert.match(panel, /Asignar modelo por rol/u);
	assert.match(panel, /Validar configuración/u);
	assert.match(panel, /Avanzado: editar PI_AGENT_PROFILES/u);
	assert.doesNotMatch(panel, /Unique AgentLab profile models:/u);
	assert.doesNotMatch(panel, /Duplicate model warnings:/u);
	assert.doesNotMatch(panel, /Recommended AgentLab proposal:/u);
});

test("model profile overview hides duplicate diagnostics from the main panel", () => {
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
	assert.doesNotMatch(panel, /Duplicate model warnings:/u);
	assert.doesNotMatch(panel, /estado: blocked/u);
	assert.doesNotMatch(panel, /Diversidad insuficiente/u);
});

test("model profiles submenu exposes role-first actions and advanced compatibility", () => {
	const menu = formatModelProfilesMenu();
	assert.match(menu, /Modelos Idu-pi/u);
	assert.match(menu, /1\. Asignar modelo por rol/u);
	assert.match(menu, /2\. Ver asignaciones actuales/u);
	assert.match(menu, /3\. Propuesta automática por AgentLab/u);
	assert.match(menu, /4\. Validar configuración/u);
	assert.match(menu, /5\. Avanzado: editar PI_AGENT_PROFILES/u);
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
		const answers = ["4", "2"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "7",
		);
		const after = readdirSync(root);
		assert.match(output, /Modelos Idu-pi/u);
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
			"5",
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
		const answers = ["4", "1", "agentlab-security", "codex", "s"];
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

test("interactive model role assignment accepts unified catalog direct models", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(join(root, "data"), { recursive: true });
	mkdirSync(join(projectPath, ".pi", "gentle-ai"), { recursive: true });
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
	writeFileSync(
		join(projectPath, ".pi", "gentle-ai", "models.json"),
		JSON.stringify({ "agentlab-librarian": "minimax/MiniMax-M2.7" }),
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
		process.env.PI_AGENT_PROFILES = "default|Pi default";
		const answers = [
			"4",
			"1",
			"agentlab-librarian",
			"minimax/MiniMax-M2.7",
			"s",
		];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "",
		);
		assert.match(output, /Asignación guardada/u);
		assert.match(
			readFileSync(join(stateRoot, "model-assignments.json"), "utf8"),
			/minimax\/MiniMax-M2\.7/u,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("interactive model role assignment selects snapshot models by provider group", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	const snapshotPath = join(root, "model-catalog.json");
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
	writeFileSync(
		snapshotPath,
		JSON.stringify({
			version: 1,
			generatedAt: "2026-06-03T00:00:00.000Z",
			source: "pi-model-registry",
			models: [
				{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
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
		process.env.IDU_PI_MODEL_CATALOG_PATH = snapshotPath;
		process.env.PI_AGENT_PROFILES = "default|Pi default";
		const answers = ["4", "1", "agentlab-librarian", "2", "1", "s"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "",
		);
		assert.match(output, /Asignación guardada/u);
		assert.match(
			readFileSync(join(stateRoot, "model-assignments.json"), "utf8"),
			/minimax\/MiniMax-M2\.7/u,
		);
	} finally {
		process.chdir(previousCwd);
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed Pi registry snapshot does not crash model assignment fallback", async () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	const snapshotPath = join(root, "model-catalog.json");
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
	writeFileSync(snapshotPath, "{invalid json", "utf8");
	const previous = snapshotEnv();
	const previousCwd = process.cwd();
	try {
		process.chdir(projectPath);
		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = join(root, "workspace");
		process.env.IDU_PI_REGISTRY_PATH = join(root, "data", "projects.json");
		process.env.IDU_PI_MODEL_CATALOG_PATH = snapshotPath;
		process.env.PI_AGENT_PROFILES =
			"default|Pi default;codex|GPT Codex|--model openai-codex/gpt";
		const answers = ["4", "1", "agentlab-security", "codex", "s"];
		const output = await runInteractiveHomeWithQuestion(
			async () => answers.shift() ?? "",
		);
		assert.match(output, /Asignación guardada/u);
		assert.match(
			readFileSync(join(stateRoot, "model-assignments.json"), "utf8"),
			/codex/u,
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
	const root = tempDir();
	const projectPath = join(root, "project");
	const envPath = join(root, "package.env");
	mkdirSync(projectPath, { recursive: true });
	try {
		writeFileSync(
			envPath,
			[
				`DEFAULT_CWD=${projectPath}`,
				`ALLOWED_ROOTS=${root}`,
				`AGENT_WORKSPACE_ROOT=${join(root, "workspace")}`,
			].join("\n"),
			"utf8",
		);
		delete process.env.DEFAULT_CWD;
		delete process.env.ALLOWED_ROOTS;
		delete process.env.AGENT_WORKSPACE_ROOT;
		applyPackageEnvDefaults({ envPath });
		assert.equal(process.env.DEFAULT_CWD, projectPath);
		assert.equal(process.env.ALLOWED_ROOTS, root);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
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

test("project panel auto-refresh is scoped and cleaned up", () => {
	// PR 6 of Item 4: the L cluster (TUI) was moved to src/cli/tui/helpers.ts.
	// Read from there to find the project panel code.
	const source = readFileSync(
		join(process.cwd(), "src", "cli", "tui", "helpers.ts"),
		"utf8",
	);
	assert.match(source, /↻ Actualizar métricas/u);
	assert.match(source, /runProjectStatusPanelTui/u);
	const projectPanelBlock = source.slice(
		source.indexOf("async function runProjectStatusPanelTui"),
		source.indexOf("function mainMenuOptions"),
	);
	assert.match(projectPanelBlock, /autoRefresh/u);
	assert.match(projectPanelBlock, /intervalMs:\s*3000/u);
	assert.match(projectPanelBlock, /buildCliHomeStatus/u);
	assert.match(projectPanelBlock, /formatCliProjectStatus/u);

	const menuBlock = source.slice(
		source.indexOf("async function selectSearchableMenu"),
		source.indexOf("async function showTextView"),
	);
	assert.match(menuBlock, /setInterval/u);
	assert.match(menuBlock, /clearInterval/u);
	assert.match(menuBlock, /refreshedContent !== settings\.content/u);
	assert.doesNotMatch(menuBlock, /watchFile|fs\.watch/u);
});

test("interactive project panel content scrolls independently from actions", async () => {
	const input = new EventEmitter() as EventEmitter & {
		isTTY?: boolean;
		resume: () => void;
		setRawMode: (enabled: boolean) => void;
	};
	input.isTTY = false;
	input.resume = () => undefined;
	input.setRawMode = () => undefined;
	const writes: string[] = [];
	const output = {
		rows: 14,
		write: (value: string) => {
			writes.push(value);
		},
	};
	const content = Array.from(
		{ length: 30 },
		(_, index) => `line-${index + 1}`,
	).join("\n");
	const menuPromise = __testSelectSearchableMenu(
		"Proyecto actual",
		[
			{ label: "↻ Actualizar métricas", value: "refresh" },
			{ label: "← Volver", value: "back" },
			{ label: "Exit", value: "exit" },
		],
		{ content },
		{ input, output },
	);

	assert.equal(
		writes.some((entry) => entry.includes("line-1")),
		true,
	);
	assert.equal(
		writes.some((entry) => entry.includes("line-30")),
		false,
	);
	for (let index = 0; index < 10; index += 1) {
		input.emit("keypress", "", { name: "pagedown" });
	}
	assert.equal(
		writes.some((entry) => entry.includes("line-30")),
		true,
	);
	assert.equal(
		writes.some(
			(entry) => entry.includes("contenido ") && entry.includes("/30"),
		),
		true,
	);
	input.emit("keypress", "q", { name: "q" });
	assert.equal(await menuPromise, "exit");
});

test("interactive project panel auto-refresh re-renders changed content and clears timer on exit", async () => {
	const input = new EventEmitter() as EventEmitter & {
		isTTY?: boolean;
		resume: () => void;
		setRawMode: (enabled: boolean) => void;
	};
	input.isTTY = false;
	input.resume = () => undefined;
	input.setRawMode = () => undefined;
	const writes: string[] = [];
	const output = {
		write: (value: string) => {
			writes.push(value);
		},
	};
	let intervalCallback: (() => void) | undefined;
	let cleared = false;
	let content = "eventos: 7";
	const menuPromise = __testSelectSearchableMenu(
		"Proyecto actual",
		[
			{ label: "↻ Actualizar métricas", value: "refresh" },
			{ label: "← Volver", value: "back" },
		],
		{
			content,
			autoRefresh: {
				intervalMs: 3000,
				getContent: () => content,
			},
		},
		{
			input,
			output,
			setInterval: (callback: () => void, intervalMs: number) => {
				assert.equal(intervalMs, 3000);
				intervalCallback = callback;
				return "timer";
			},
			clearInterval: (timer: unknown) => {
				assert.equal(timer, "timer");
				cleared = true;
			},
		},
	);

	assert.equal(
		writes.filter((entry) => entry.includes("eventos: 7")).length,
		1,
	);
	intervalCallback?.();
	assert.equal(
		writes.filter((entry) => entry.includes("eventos: 7")).length,
		1,
	);
	content = "eventos: 8";
	intervalCallback?.();
	assert.equal(
		writes.some((entry) => entry.includes("eventos: 8")),
		true,
	);
	input.emit("keypress", "q", { name: "q" });
	assert.equal(await menuPromise, "exit");
	assert.equal(cleared, true);
});

test("wizard source avoids AgentLabs scans prepare and bootstrap", () => {
	// PR 3 of Item 4: the wizard function (runWizardActivateSupervisor) is
	// now in src/cli/wizard/helpers.ts. Read from there to find the wizard.
	const source = readFileSync(
		join(process.cwd(), "src", "cli", "wizard", "helpers.ts"),
		"utf8",
	);
	const interactiveBlock = source.slice(
		source.indexOf("export function runWizardActivateSupervisor"),
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
