import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	canonicalDirectory,
	isAllowedCwd,
	type BridgeConfig,
} from "./config.js";
import { initProjectConfig } from "./config-wizard.js";
import { activateIduSession, configureIduSessionStore } from "./idu-session.js";
import { assertAllowedWrite } from "./idu-scratch.js";
import {
	createDefaultProjectCore,
	validateProjectCore,
} from "./project-core.js";
import { deriveConstitutionFromProjectCore } from "./project-constitution.js";
import {
	ensureProjectStateDirs,
	resolveProjectStatePaths,
	type ProjectStatePaths,
} from "./project-state.js";
import {
	addProject,
	loadRegistry,
	saveRegistry,
	slugifyProjectId,
	type ProjectEntry,
} from "./projects.js";

export type IduBootstrapInput = {
	projectPath: string;
	config: BridgeConfig;
	registryPath?: string;
	activate?: boolean;
};

export type IduBootstrapResult = {
	project: ProjectEntry;
	statePaths: ProjectStatePaths;
	created: string[];
	existing: string[];
	warnings: string[];
	criticalDecisions: string[];
	alreadyBootstrapped: boolean;
	shouldRunPrepare: boolean;
	lastGitHead?: string;
	currentGitHead?: string;
	statePath: string;
};

type BootstrapState = {
	version: string;
	projectId: string;
	projectPath: string;
	lastAnalyzedAt: string;
	lastGitHead?: string;
	projectCoreStatus: string;
};

const PROJECT_CORE = ".idu/config/project-core.json";
const PROJECT_CONSTITUTION = ".idu/config/project-constitution.json";

export function runIduBootstrap(input: IduBootstrapInput): IduBootstrapResult {
	const projectPath = canonicalDirectory(input.projectPath);
	if (!isAllowedCwd(projectPath, input.config.allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${projectPath}`);
	}

	const registry = loadRegistry(projectPath, input.config.allowedRoots, {
		registryPath: input.registryPath,
		createIfMissing: false,
	});
	const baseProjectId = slugifyProjectId(basename(projectPath) || "project");
	let project = registry.projects.find((entry) =>
		samePath(entry.path, projectPath),
	);
	const created: string[] = [];
	const existing: string[] = [];
	const warnings: string[] = [];
	const criticalDecisions: string[] = [];

	if (!project) {
		const projectId = uniqueProjectId(
			baseProjectId,
			registry.projects.map((entry) => entry.id),
		);
		project = addProject(
			registry,
			projectId,
			projectPath,
			input.config.allowedRoots,
		);
		created.push("registry project enrollment");
	} else {
		existing.push("registry project enrollment");
	}

	const statePaths = resolveProjectStatePaths({
		workspaceRoot: input.config.agentWorkspaceRoot,
		projectId: project.id,
		projectPath,
	});
	project.stateRoot = statePaths.stateRoot;
	for (const directory of [
		statePaths.stateRoot,
		statePaths.reportsDir,
		statePaths.semanticAuditDir,
		statePaths.agentLabReportsDir,
		statePaths.workspacesDir,
	]) {
		if (existsSync(directory)) existing.push(directory);
		else created.push(directory);
	}
	ensureProjectStateDirs(statePaths);
	if (!existing.includes("state directories ready"))
		existing.push("state directories ready");

	saveRegistry(registry, input.registryPath);
	configureIduSessionStore({
		workspaceRoot: statePaths.stateRoot,
		filePath: statePaths.sessionStatePath,
	});
	if (input.activate ?? true) activateIduSession(project.id);

	const configResult = initProjectConfig(projectPath, project.id);
	created.push(...configResult.created);
	existing.push(...configResult.existing);

	const corePath = join(projectPath, PROJECT_CORE);
	const coreExisted = existsSync(corePath);
	let projectCoreStatus = "draft";
	if (!coreExisted) {
		mkdirSync(dirname(corePath), { recursive: true });
		assertAllowedWrite(corePath, {
			stateRoot: statePaths.stateRoot,
			repoRoot: projectPath,
		});
		const core = createDefaultProjectCore(project.name || project.id);
		writeFileSync(corePath, `${JSON.stringify(core, null, 2)}\n`, "utf8");
		created.push(PROJECT_CORE);
		projectCoreStatus = core.status;
	} else {
		existing.push(PROJECT_CORE);
		try {
			const parsed = JSON.parse(readFileSync(corePath, "utf8")) as unknown;
			const validation = validateProjectCore(parsed);
			if (validation.ok) projectCoreStatus = validation.core.status;
			else
				criticalDecisions.push(
					`Project Core inválido: ${validation.errors.join("; ")}`,
				);
		} catch (error) {
			criticalDecisions.push(
				`Project Core inválido: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const constitutionPath = join(projectPath, PROJECT_CONSTITUTION);
	if (!existsSync(constitutionPath)) {
		try {
			const core = JSON.parse(readFileSync(corePath, "utf8")) as unknown;
			const validation = validateProjectCore(core);
			if (validation.ok) {
				const constitution = deriveConstitutionFromProjectCore(validation.core);
				assertAllowedWrite(constitutionPath, {
					stateRoot: statePaths.stateRoot,
					repoRoot: projectPath,
				});
				writeFileSync(
					constitutionPath,
					`${JSON.stringify(constitution, null, 2)}\n`,
					"utf8",
				);
				created.push(PROJECT_CONSTITUTION);
			}
		} catch (error) {
			warnings.push(
				`No pude crear Constitution draft: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} else {
		existing.push(PROJECT_CONSTITUTION);
	}

	const statePath = join(statePaths.stateRoot, "idu-bootstrap-state.json");
	const previousState = readBootstrapState(statePath);
	const currentGitHead = readGitHead(projectPath);
	const alreadyBootstrapped =
		Boolean(previousState) &&
		previousState?.lastGitHead === currentGitHead &&
		configResult.created.length === 0 &&
		coreExisted &&
		existsSync(constitutionPath);
	const shouldRunPrepare = !alreadyBootstrapped;

	const nextState: BootstrapState = {
		version: "1.0.0",
		projectId: project.id,
		projectPath,
		lastAnalyzedAt: new Date().toISOString(),
		...(currentGitHead ? { lastGitHead: currentGitHead } : {}),
		projectCoreStatus,
	};
	writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");

	// Write a single ready signal so external tools and the
	// supervisor cycle have one source of truth for "this project
	// is bootstrapped and ready" instead of fragmenting the check
	// across idu-session-state.json + birth/status.json + manual
	// state dir probes.
	const readyPath = join(statePaths.stateRoot, "idu-ready.json");
	writeFileSync(
		readyPath,
		`${JSON.stringify(
			{
				version: 1,
				projectId: project.id,
				readyAt: new Date().toISOString(),
				...(currentGitHead ? { gitHead: currentGitHead } : {}),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	return {
		project,
		statePaths,
		created: unique(created),
		existing: unique(existing),
		warnings,
		criticalDecisions,
		alreadyBootstrapped,
		shouldRunPrepare,
		...(previousState?.lastGitHead
			? { lastGitHead: previousState.lastGitHead }
			: {}),
		...(currentGitHead ? { currentGitHead } : {}),
		statePath,
	};
}

export function formatIduBootstrapResult(result: IduBootstrapResult): string {
	const progress = result.alreadyBootstrapped
		? "100% — Idu-pi ya existía en este proyecto; validé estado y checkpoint."
		: "100% — bootstrap inicial listo; Project Core/Constitution quedan como draft hasta confirmación humana.";
	return [
		"Idu-pi bootstrap",
		"",
		`- Proyecto: ${result.project.id}`,
		`- Ruta: ${result.project.path}`,
		`- StateRoot: ${result.statePaths.stateRoot}`,
		`- Progreso: ${progress}`,
		`- Análisis: ${result.shouldRunPrepare ? "preparación segura ejecutada/recomendada" : "sin cambios relevantes detectados"}`,
		`- Git HEAD anterior: ${result.lastGitHead ?? "—"}`,
		`- Git HEAD actual: ${result.currentGitHead ?? "—"}`,
		"",
		"Creado:",
		...(result.created.length
			? result.created.map((item) => `- ${item}`)
			: ["- nada nuevo"]),
		"",
		"Existente/listo:",
		...(result.existing.length
			? result.existing.map((item) => `- ${item}`)
			: ["- —"]),
		"",
		"Decisiones humanas pendientes:",
		...(result.criticalDecisions.length
			? result.criticalDecisions.map((item) => `- ${item}`)
			: ["- Confirmar Project Core antes de tratarlo como fuente de verdad"]),
		"",
		"Notas:",
		"- AgentLabs quedan preparados en estado aislado; ejecución real sigue siendo explícita/sandbox.",
		"- No hice commit/push ni toqué Telegram.",
		...result.warnings.map((item) => `- ${item}`),
	].join("\n");
}

function readBootstrapState(path: string): BootstrapState | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as BootstrapState;
	} catch {
		return undefined;
	}
}

function readGitHead(projectPath: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

function samePath(left: string, right: string): boolean {
	const normalize = (value: string) =>
		process.platform === "win32" ? value.toLowerCase() : value;
	return normalize(left) === normalize(right);
}

function uniqueProjectId(baseId: string, existingIds: string[]): string {
	const existing = new Set(existingIds);
	if (!existing.has(baseId)) return baseId;
	for (let index = 2; index < 10_000; index += 1) {
		const candidate = `${baseId}-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
	throw new Error(`No pude crear projectId único para ${baseId}`);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
