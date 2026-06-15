import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { projectEnroll } from "./idu-installer.js";
import { runBibliotecarioInit } from "./cli-bibliotecario-init.js";
import { enableSupervisorTrigger } from "./supervisor-trigger.js";
import { getSourceLibraryStatus } from "./source-library.js";
import { writeBirthArtifact } from "./birth-artifacts.js";
import { scanExistingProject } from "./birth-existing-scan.js";
import { inspectProjectConnection } from "./project-connection.js";
import {
	inferMission,
	persistBlueprint,
	type BlueprintArtifact,
	type MissionDraft,
	type ProjectDocs,
} from "./genesis-mission.js";
import { safeProjectStateId } from "./project-state.js";
import type { ProjectEntry } from "./projects.js";
import type { ProjectRegistry } from "./projects.js";

export type OnboardProjectStepId =
	| "projectEnroll"
	| "runBibliotecarioInit"
	| "enableSupervisorTrigger"
	| "readSourceLibraryStatus"
	| "scanExistingProject"
	| "inspectConnection"
	| "inferMission"
	| "persistBlueprint";

export type OnboardProjectStep = {
	id: OnboardProjectStepId;
	status: "success" | "failed";
	summary: string;
	data?: unknown;
	error?: string;
};

export type OnboardConfirmMission = {
	owner: string;
	now?: () => Date;
};

export type OnboardProjectOptions = {
	projectPath?: string;
	workspaceRoot?: string;
	allowedRoots?: string[];
	registryPath?: string;
	skipTriggerEnable?: boolean;
	confirmMission?: OnboardConfirmMission;
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
	missionDraft?: MissionDraft;
	blueprint?: BlueprintArtifact;
};

const MAX_README_BYTES = 16_000;

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

	let scanResult: ReturnType<typeof scanExistingProject> | undefined;
	recordStep(steps, "scanExistingProject", () => {
		scanResult = scanExistingProject({
			projectPath,
			projectId: normalizedProjectId,
		});
		writeBirthArtifact(resolvedStateRoot, "existing-scan", scanResult.scan);
		writeBirthArtifact(
			resolvedStateRoot,
			"detected-specs",
			scanResult.detectedSpecs,
		);
		return {
			summary: `scan ${scanResult.scan.scanId}: ${scanResult.scan.observed.frameworks.length} frameworks, ${scanResult.scan.observed.tests.length} test files`,
			data: scanResult,
		};
	});

	recordStep(steps, "inspectConnection", () => {
		const registry = loadRegistryQuiet(registryPath);
		const report = inspectProjectConnection({
			registry,
			defaultCwd: projectPath,
			allowedRoots,
			workspaceRoot,
			stateRoot: resolvedStateRoot,
			projectId: normalizedProjectId,
			now: options.now,
		});
		return {
			summary: `connection status=${report.status} readiness=${report.readiness} config=${report.configStatus}`,
			data: report,
		};
	});

	const docs = scanResult ? readProjectDocs(projectPath) : emptyProjectDocs();
	const missionDraft: MissionDraft | undefined = scanResult
		? (() => {
				const draft = inferMission(scanResult, docs);
				recordStep(steps, "inferMission", () => ({
					summary: `mission draft for ${draft.projectId}: ${draft.unbreakableRules.length} rules`,
					data: draft,
				}));
				writeBirthArtifact(resolvedStateRoot, "mission-draft", draft);
				return draft;
			})()
		: undefined;

	let blueprint: BlueprintArtifact | undefined;
	if (missionDraft && options.confirmMission) {
		const { owner, now } = options.confirmMission;
		recordStep(steps, "persistBlueprint", () => {
			const next: BlueprintArtifact = {
				version: 1,
				projectId: missionDraft.projectId,
				objective: missionDraft.objective,
				unbreakableRules: missionDraft.unbreakableRules,
				hierarchy: missionDraft.hierarchy,
				confirmedBy: owner,
				confirmedAt: (now?.() ?? new Date()).toISOString(),
			};
			persistBlueprint(resolvedStateRoot, next);
			blueprint = next;
			return {
				summary: `blueprint confirmed by ${owner}`,
				data: next,
			};
		});
	}

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
		missionDraft,
		blueprint,
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

function loadRegistryQuiet(registryPath: string): ProjectRegistry {
	try {
		if (!existsSync(registryPath)) {
			return { activeProjectId: null, projects: [] as ProjectEntry[] };
		}
		const raw = readFileSync(registryPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray((parsed as { projects?: unknown }).projects)
		) {
			return parsed as ProjectRegistry;
		}
	} catch {
		// ignore: registry read is best-effort for the truthful inspection path
	}
	return { activeProjectId: null, projects: [] as ProjectEntry[] };
}

function readProjectDocs(projectPath: string): ProjectDocs {
	const docs: ProjectDocs = {};
	const pkg = readPackageJsonSafe(projectPath);
	if (pkg) {
		if (typeof pkg.name === "string") {
			docs.packageName = pkg.name;
		}
		if (typeof pkg.description === "string") {
			docs.packageDescription = pkg.description;
		}
	}
	docs.tsconfigStrict = readTsconfigStrict(projectPath);
	docs.readmeTitle = readReadmeTitle(projectPath);
	return docs;
}

function emptyProjectDocs(): ProjectDocs {
	return {};
}

function readPackageJsonSafe(
	projectPath: string,
): Record<string, unknown> | undefined {
	const pkgPath = join(projectPath, "package.json");
	try {
		if (!existsSync(pkgPath)) return undefined;
		const raw = readFileSync(pkgPath, "utf8");
		if (raw.length > MAX_README_BYTES) return undefined;
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fallthrough: best-effort doc harvest
	}
	return undefined;
}

function readTsconfigStrict(projectPath: string): boolean {
	const tsconfigPath = join(projectPath, "tsconfig.json");
	try {
		if (!existsSync(tsconfigPath)) return false;
		const raw = readFileSync(tsconfigPath, "utf8");
		if (raw.length > MAX_README_BYTES) return false;
		const parsed = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			(parsed as { compilerOptions?: { strict?: unknown } }).compilerOptions
				?.strict === true
		) {
			return true;
		}
	} catch {
		// fallthrough
	}
	return false;
}

function readReadmeTitle(projectPath: string): string | undefined {
	const candidates = ["README.md", "readme.md", "README.MD"];
	for (const name of candidates) {
		const path = join(projectPath, name);
		if (!existsSync(path)) continue;
		try {
			const raw = readFileSync(path, "utf8");
			if (raw.length > MAX_README_BYTES) continue;
			const firstHeading = raw.match(/^#\s+(.+)$/mu);
			if (firstHeading) {
				return firstHeading[1].trim();
			}
		} catch {
			// fallthrough: try next candidate
		}
	}
	return undefined;
}

export { inferWorkspaceRoot as _inferWorkspaceRootForTests };
export { readProjectDocs as _readProjectDocsForTests };
export type { ProjectDocs as _ProjectDocsForTests };
