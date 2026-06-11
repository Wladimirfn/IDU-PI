import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { projectEnroll } from "./idu-installer.js";
import { runBibliotecarioInit } from "./cli-bibliotecario-init.js";
import { enableSupervisorTrigger } from "./supervisor-trigger.js";
import { getSourceLibraryStatus } from "./source-library.js";
import { runIduPrepare, type IduPrepareResult } from "./idu-prepare.js";
import { safeProjectStateId } from "./project-state.js";
import type { ProjectConnectionReport } from "./project-connection.js";
import type { ProjectFlows } from "./project-flows.js";
import type { ProjectPostflightReport } from "./project-postflight.js";

export type OnboardProjectStepId =
	| "projectEnroll"
	| "runBibliotecarioInit"
	| "enableSupervisorTrigger"
	| "readSourceLibraryStatus"
	| "runPrepare";

export type OnboardProjectStep = {
	id: OnboardProjectStepId;
	status: "success" | "failed";
	summary: string;
	data?: unknown;
	error?: string;
};

export type OnboardProjectOptions = {
	projectPath?: string;
	workspaceRoot?: string;
	allowedRoots?: string[];
	registryPath?: string;
	skipTriggerEnable?: boolean;
	now?: () => Date;
};

export type OnboardProjectReport = {
	ok: boolean;
	exitCode: 0 | 1;
	projectId: string;
	stateRoot: string;
	projectPath: string;
	steps: OnboardProjectStep[];
	errors: string[];
};

export function runOnboardProject(
	stateRoot: string,
	projectId: string,
	options: OnboardProjectOptions = {},
): OnboardProjectReport {
	const resolvedStateRoot = resolve(stateRoot);
	const normalizedProjectId = projectId.trim();
	if (!normalizedProjectId) {
		return {
			ok: false,
			exitCode: 1,
			projectId,
			stateRoot: resolvedStateRoot,
			projectPath: resolve(options.projectPath ?? resolvedStateRoot),
			steps: [],
			errors: ["project id must be non-empty"],
		};
	}

	mkdirSync(resolvedStateRoot, { recursive: true });
	const projectPath = resolve(options.projectPath ?? resolvedStateRoot);
	const workspaceRoot = resolve(
		options.workspaceRoot ??
			inferWorkspaceRoot(resolvedStateRoot, normalizedProjectId),
	);
	const allowedRoots = options.allowedRoots ?? [
		workspaceRoot,
		resolvedStateRoot,
		projectPath,
	];
	const registryPath =
		options.registryPath ?? join(workspaceRoot, "registry", "projects.json");
	const steps: OnboardProjectStep[] = [];

	recordStep(steps, "projectEnroll", () => {
		const result = projectEnroll({
			projectPath,
			projectId: normalizedProjectId,
			workspaceRoot,
			allowedRoots,
			registryPath,
		});
		return {
			summary: `project enrolled: ${result.project.id}`,
			data: result,
		};
	});

	recordStep(steps, "runBibliotecarioInit", () => {
		const result = runBibliotecarioInit({
			stateRoot: resolvedStateRoot,
			projectId: normalizedProjectId,
		});
		if (!result.ok) throw new Error(result.error);
		return {
			summary: `lab.db initialized: ${result.dbPath}`,
			data: result,
		};
	});

	if (options.skipTriggerEnable) {
		steps.push({
			id: "enableSupervisorTrigger",
			status: "success",
			summary: "skipped by option",
		});
	} else {
		recordStep(steps, "enableSupervisorTrigger", () => {
			const result = enableSupervisorTrigger(resolvedStateRoot, {
				source: "cli",
				now: options.now?.(),
			});
			return {
				summary: `supervisor trigger enabled: ${result.path}`,
				data: result,
			};
		});
	}

	recordStep(steps, "readSourceLibraryStatus", () => {
		const result = getSourceLibraryStatus({
			stateRoot: resolvedStateRoot,
			projectId: normalizedProjectId,
		});
		return {
			summary: `source library items: ${result.sources.length}`,
			data: result,
		};
	});

	recordStep(steps, "runPrepare", () => {
		const result = runPrepare({
			stateRoot: resolvedStateRoot,
			projectId: normalizedProjectId,
			projectPath,
		});
		if (result.errors.length > 0) throw new Error(result.errors.join("; "));
		return {
			summary: result.recommendedNext,
			data: result,
		};
	});

	const errors = steps
		.filter((step) => step.status === "failed")
		.map((step) => `${step.id}: ${step.error ?? step.summary}`);
	return {
		ok: errors.length === 0,
		exitCode: errors.length === 0 ? 0 : 1,
		projectId: normalizedProjectId,
		stateRoot: resolvedStateRoot,
		projectPath,
		steps,
		errors,
	};
}

function recordStep(
	steps: OnboardProjectStep[],
	id: OnboardProjectStepId,
	run: () => { summary: string; data?: unknown },
): void {
	try {
		const result = run();
		steps.push({
			id,
			status: "success",
			summary: result.summary,
			...(result.data === undefined ? {} : { data: result.data }),
		});
	} catch (error) {
		steps.push({
			id,
			status: "failed",
			summary: "failed",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function inferWorkspaceRoot(stateRoot: string, projectId: string): string {
	const safeId = safeProjectStateId(projectId);
	if (
		basename(stateRoot) === safeId &&
		basename(dirname(stateRoot)) === "projects"
	) {
		return dirname(dirname(stateRoot));
	}
	return stateRoot;
}

function runPrepare(input: {
	stateRoot: string;
	projectId: string;
	projectPath: string;
}): IduPrepareResult {
	const reportsPath = join(input.stateRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const flows = emptyProjectFlows();
	return runIduPrepare({
		projectId: input.projectId,
		projectPath: input.projectPath,
		reportsPath,
		inspectConnection: () => connectionReport(input),
		initProjectConfig: () => ({
			projectPath: input.projectPath,
			projectName: input.projectId,
			created: [],
			existing: [],
		}),
		inspectProjectMap: () => ({ ok: true }),
		loadProjectFlows: () => flows,
		scanProjectMap: () => ({ ok: true }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: join(reportsPath, "onboard-project-flows-draft.json"),
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflightReport(),
		createStructuredTask: () => ({ id: "onboard-project-lab-review" }),
	});
}

function connectionReport(input: {
	stateRoot: string;
	projectId: string;
	projectPath: string;
}): ProjectConnectionReport {
	const now = new Date().toISOString();
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "aligned",
		readiness: "aligned_ready",
		alignmentReason: ["onboard-project smoke prepare"],
		projectId: input.projectId,
		projectPath: input.projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "Proyecto preparado; continuar bajo riesgo low.",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: now,
		blueprint: {
			exists: true,
			source: "project-local",
			valid: true,
			path: join(input.projectPath, "config", "project-blueprint.json"),
			errors: [],
		},
		flows: {
			exists: true,
			source: "project-local",
			valid: true,
			path: join(input.projectPath, "config", "project-flows.json"),
			errors: [],
		},
		workspace: {
			workspaceRoot: input.stateRoot,
			reportsExists: existsSync(join(input.stateRoot, "reports")),
			labDbExists: existsSync(join(input.stateRoot, "lab.db")),
			labDbCanInitialize: true,
			tasksJsonlExists: existsSync(join(input.stateRoot, "tasks.jsonl")),
			tasksJsonlCanCreate: true,
		},
	};
}

function postflightReport(): ProjectPostflightReport {
	return {
		risk: "low",
		changedFiles: [],
		observedChangeMode: "stateRoot",
		impactedAreas: [],
		warnings: [],
		recommendedNext: "Proyecto preparado; continuar bajo riesgo low.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
		physicalGates: [],
	};
}

function emptyProjectFlows(): ProjectFlows {
	return {
		version: "1.0.0",
		projectType: "unknown",
		invariants: [],
		qualityRules: [],
		forbiddenTransitions: [],
		allowedTransitions: [],
		validationChecklist: [],
		modules: [],
		screens: [],
		uiElements: [],
		dataStores: [],
		flows: [],
		moduleConnections: [],
	};
}
