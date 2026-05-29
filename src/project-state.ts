import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

export type ProjectStatePaths = {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	labDbPath: string;
	taskQueuePath: string;
	sessionStatePath: string;
	semanticAuditDir: string;
	learningRulesPath: string;
	agentLabReportsDir: string;
	workspacesDir: string;
};

export type ResolveProjectStatePathsInput = {
	workspaceRoot: string;
	projectId: string;
	projectPath: string;
};

export type ProjectStateResetResult = {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	deletedEntries: string[];
	recreatedRoot: boolean;
	warning: string;
};

export function safeProjectStateId(input: string): string {
	const normalized = input
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/(?:^[-._]+|[-._]+$)/gu, "");
	return normalized || "project";
}

export function resolveProjectStatePaths(
	input: ResolveProjectStatePathsInput,
): ProjectStatePaths {
	const projectId = safeProjectStateId(input.projectId);
	const workspaceRoot = resolve(input.workspaceRoot);
	const stateRoot = join(workspaceRoot, "projects", projectId);
	const reportsDir = join(stateRoot, "reports");
	return {
		projectId,
		projectPath: resolve(input.projectPath),
		stateRoot,
		reportsDir,
		labDbPath: join(stateRoot, "lab.db"),
		taskQueuePath: join(stateRoot, "tasks.jsonl"),
		sessionStatePath: join(stateRoot, "idu-session-state.json"),
		semanticAuditDir: join(stateRoot, "semantic-audit"),
		learningRulesPath: join(stateRoot, "supervisor-learning-rules.json"),
		agentLabReportsDir: join(stateRoot, "agentlabs"),
		workspacesDir: join(stateRoot, "workspaces"),
	};
}

export function ensureProjectStateDirs(
	paths: ProjectStatePaths,
): ProjectStatePaths {
	for (const directory of [
		paths.stateRoot,
		paths.reportsDir,
		paths.semanticAuditDir,
		paths.agentLabReportsDir,
		paths.workspacesDir,
	]) {
		mkdirSync(directory, { recursive: true });
	}
	return paths;
}

export function resetProjectState(
	paths: ProjectStatePaths,
): ProjectStateResetResult {
	assertSafeProjectStateRoot(paths);
	const stateRoot = resolve(paths.stateRoot);
	const deletedEntries = existsSync(stateRoot)
		? readdirSync(stateRoot, { withFileTypes: true }).map((entry) => entry.name)
		: [];
	mkdirSync(stateRoot, { recursive: true });
	for (const entry of deletedEntries) {
		rmSync(join(stateRoot, entry), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	}
	mkdirSync(stateRoot, { recursive: true });
	return {
		projectId: paths.projectId,
		projectPath: paths.projectPath,
		stateRoot,
		deletedEntries,
		recreatedRoot: true,
		warning:
			"Reset destructivo de estado aislado: no desregistra el proyecto ni toca el repo real.",
	};
}

export function formatProjectStateResetResult(
	result: ProjectStateResetResult,
): string {
	return [
		"Idu-pi project state reset",
		"",
		"Proyecto:",
		result.projectId,
		"",
		"Repo real:",
		result.projectPath,
		"",
		"StateRoot limpiado:",
		result.stateRoot,
		"",
		"Entradas borradas:",
		...(result.deletedEntries.length
			? result.deletedEntries.map((entry) => `- ${entry}`)
			: ["- ninguno"]),
		"",
		"Nota segura:",
		result.warning,
	].join("\n");
}

function assertSafeProjectStateRoot(paths: ProjectStatePaths): void {
	const stateRoot = resolve(paths.stateRoot);
	const projectPath = resolve(paths.projectPath);
	if (basename(dirname(stateRoot)) !== "projects") {
		throw new Error(
			`StateRoot inseguro; esperaba carpeta padre "projects": ${stateRoot}`,
		);
	}
	if (basename(stateRoot) !== safeProjectStateId(paths.projectId)) {
		throw new Error(`StateRoot no coincide con projectId: ${stateRoot}`);
	}
	if (isSameOrInside(stateRoot, projectPath)) {
		throw new Error(
			`StateRoot apunta dentro del repo real; abortado para proteger código: ${stateRoot}`,
		);
	}
}

function isSameOrInside(child: string, parent: string): boolean {
	const relativePath = relative(resolve(parent), resolve(child));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

export function formatProjectStatePaths(paths: ProjectStatePaths): string {
	return [
		"Project state",
		"",
		"projectId:",
		paths.projectId,
		"",
		"projectPath:",
		paths.projectPath,
		"",
		"stateRoot:",
		paths.stateRoot,
		"",
		"reportsDir:",
		paths.reportsDir,
		"",
		"labDbPath:",
		paths.labDbPath,
		"",
		"taskQueuePath:",
		paths.taskQueuePath,
		"",
		"sessionStatePath:",
		paths.sessionStatePath,
		"",
		"learningRulesPath:",
		paths.learningRulesPath,
	].join("\n");
}
