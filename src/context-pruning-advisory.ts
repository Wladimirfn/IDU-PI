import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildArchitecturalPruningPlan } from "./architectural-pruning-plan.js";
import {
	buildContextQualityReport,
	readContextQualityEvents,
} from "./context-quality-events.js";
import {
	getSourceDigestStatus,
	getSourceRequiredActions,
} from "./source-digest.js";
import { getSourceLibraryStatus } from "./source-library.js";

export type ContextPruningSignalCategory =
	| "context_bloat"
	| "stale_evidence"
	| "stale_digest"
	| "artifact_noise"
	| "old_plan_or_spec"
	| "semantic_debt";

export type ContextPruningSignalSeverity = "low" | "medium" | "high";
export type ContextPruningSignalConfidence = "low" | "medium" | "high";
export type ContextPruningSignalSource =
	| "context_quality_events"
	| "source_library"
	| "source_digest"
	| "docs_superpowers"
	| "architectural_pruning_plan"
	| "artifacts";

export type ContextPruningAdvisorySignal = {
	id: string;
	category: ContextPruningSignalCategory;
	severity: ContextPruningSignalSeverity;
	confidence: ContextPruningSignalConfidence;
	source: ContextPruningSignalSource;
	evidenceRefs: string[];
	summary: string;
	recommendedAction: string;
	blockedBy: string[];
};

export type ContextPruningAdvisoryTotals = {
	contextQualityEvents: number;
	truncatedContextEvents: number;
	staleSources: number;
	missingDigests: number;
	requiredSourceReads: number;
	oldPlans: number;
	noisyArtifacts: number;
	pruningCandidates: number;
};

export type ContextPruningAdvisoryReport = {
	version: 1;
	projectId: string;
	generatedAt: string;
	mode: "advisory_only";
	noDeletion: true;
	noAutoDelete: true;
	noContractPromotion: true;
	rawPromptsStored: false;
	rawDocsStored: false;
	remoteAnalytics: false;
	signals: ContextPruningAdvisorySignal[];
	totals: ContextPruningAdvisoryTotals;
	limitations: string[];
};

export function buildContextPruningAdvisoryReport(input: {
	stateRoot: string;
	projectId: string;
	repoRoot?: string;
	now?: () => Date;
	contextEventLimit?: number;
}): ContextPruningAdvisoryReport {
	const repoRoot = input.repoRoot ?? process.cwd();
	const contextEvents = readContextQualityEvents(
		input.stateRoot,
		input.contextEventLimit ?? 200,
	);
	const contextReport = buildContextQualityReport(contextEvents, {
		recentLimit: 0,
	});
	const sourceStatus = getSourceLibraryStatus({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
	});
	const digestStatus = getSourceDigestStatus({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
	});
	const requiredActions = getSourceRequiredActions({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		now: input.now,
	});
	const plans = scanSuperpowerArtifacts(repoRoot, input.now?.() ?? new Date());
	const artifactNoise = scanNoisyArtifacts(repoRoot);
	const pruningPlan = buildArchitecturalPruningPlan({
		projectId: input.projectId,
		now: input.now,
	});
	const signals: ContextPruningAdvisorySignal[] = [];

	if (contextReport.truncatedEvents > 0) {
		signals.push({
			id: "context-bloat-truncated-packs",
			category: "context_bloat",
			severity: contextReport.truncatedEvents >= 3 ? "high" : "medium",
			confidence: "high",
			source: "context_quality_events",
			evidenceRefs: [
				`contextQualityEvents:${contextReport.totalEvents}`,
				`truncatedContextEvents:${contextReport.truncatedEvents}`,
				...Object.entries(contextReport.omittedReasons).map(
					([reason, count]) => `omittedReason:${reason}:${count}`,
				),
			],
			summary:
				"Supervisor context packs are hitting budget limits or omitting sections.",
			recommendedAction:
				"Prune duplicated reads/noise guidance and revalidate which context is required before delegation.",
			blockedBy: defaultBlockers(),
		});
	}

	if (
		sourceStatus.staleSources.length > 0 ||
		sourceStatus.missingSources.length > 0
	) {
		signals.push({
			id: "source-library-stale-evidence",
			category: "stale_evidence",
			severity: sourceStatus.missingSources.length > 0 ? "high" : "medium",
			confidence: "high",
			source: "source_library",
			evidenceRefs: [
				...sourceStatus.staleSources.map((id) => `staleSource:${id}`),
				...sourceStatus.missingSources.map((id) => `missingSource:${id}`),
			],
			summary: "Source Library has local evidence marked stale or missing.",
			recommendedAction:
				"Ask the orchestrator to refresh or replace evidence before using it as current knowledge.",
			blockedBy: defaultBlockers(),
		});
	}

	const missingDigests = digestStatus.digests.filter(
		(digest) => digest.status === "missing",
	);
	if (missingDigests.length > 0 || requiredActions.actions.length > 0) {
		signals.push({
			id: "source-digest-missing-or-reader-required",
			category: "stale_digest",
			severity: requiredActions.actions.length > 0 ? "high" : "medium",
			confidence: "high",
			source: "source_digest",
			evidenceRefs: [
				...missingDigests.map((digest) => `missingDigest:${digest.sourceId}`),
				...requiredActions.actions.map(
					(action) => `requiredReader:${action.sourceId}`,
				),
			],
			summary:
				"Some registered sources lack digest knowledge or require a librarian reader before use.",
			recommendedAction:
				"Generate safe digests or dispatch a read-only librarian reader before plan decisions depend on these sources.",
			blockedBy: defaultBlockers(),
		});
	}

	if (plans.oldPlanOrSpecCount > 0) {
		signals.push({
			id: "superpower-plan-spec-age-or-open-work",
			category: "old_plan_or_spec",
			severity: plans.oldPlanOrSpecCount > 20 ? "medium" : "low",
			confidence: "medium",
			source: "docs_superpowers",
			evidenceRefs: [
				`planSpecFiles:${plans.oldPlanOrSpecCount}`,
				`olderThan30Days:${plans.olderThan30Days}`,
				`totalBytes:${plans.totalBytes}`,
				...plans.samplePaths,
			],
			summary:
				"Historical plans/specs may contain stale implementation assumptions or low-signal accumulated planning history.",
			recommendedAction:
				"Treat old plans/specs as history unless current Plan Maestro or fresh evidence revalidates them.",
			blockedBy: defaultBlockers(),
		});
	}

	if (artifactNoise.noisyArtifacts > 0) {
		signals.push({
			id: "accumulated-subagent-artifacts",
			category: "artifact_noise",
			severity: artifactNoise.noisyArtifacts > 50 ? "medium" : "low",
			confidence: "medium",
			source: "artifacts",
			evidenceRefs: artifactNoise.evidenceRefs,
			summary:
				"Auxiliary artifact directories contain accumulated files that can distract context gathering.",
			recommendedAction:
				"Prefer explicit artifact IDs and ignore broad artifact directories unless a task names them.",
			blockedBy: defaultBlockers(),
		});
	}

	if (pruningPlan.candidates.length > 0) {
		signals.push({
			id: "architectural-pruning-candidates-present",
			category: "semantic_debt",
			severity: "medium",
			confidence: "medium",
			source: "architectural_pruning_plan",
			evidenceRefs: pruningPlan.candidates.map((candidate) => candidate.id),
			summary:
				"Existing advisory pruning candidates indicate duplication, overlap, stale paths, or semantic debt.",
			recommendedAction:
				"Review candidates individually with characterization tests before any refactor.",
			blockedBy: defaultBlockers(),
		});
	}

	return {
		version: 1,
		projectId: sanitizeProjectId(input.projectId),
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		mode: "advisory_only",
		noDeletion: true,
		noAutoDelete: true,
		noContractPromotion: true,
		rawPromptsStored: false,
		rawDocsStored: false,
		remoteAnalytics: false,
		signals,
		totals: {
			contextQualityEvents: contextReport.totalEvents,
			truncatedContextEvents: contextReport.truncatedEvents,
			staleSources:
				sourceStatus.staleSources.length + sourceStatus.missingSources.length,
			missingDigests: missingDigests.length,
			requiredSourceReads: requiredActions.actions.length,
			oldPlans: plans.oldPlanOrSpecCount,
			noisyArtifacts: artifactNoise.noisyArtifacts,
			pruningCandidates: pruningPlan.candidates.length,
		},
		limitations: [
			"Advisory only: this report does not delete, archive, refactor, or promote contracts.",
			"Source staleness is local file hash/size drift, not external web freshness.",
			"Plan/spec metadata is a low-confidence signal, not proof of incomplete implementation.",
			"Evidence refs are metadata paths/counts/ids only; raw prompts and raw docs are not stored.",
		],
	};
}

export function formatContextPruningAdvisoryPanel(
	report: ContextPruningAdvisoryReport,
): string {
	const byCategory = report.signals.reduce<Record<string, number>>(
		(acc, signal) => {
			acc[signal.category] = (acc[signal.category] ?? 0) + 1;
			return acc;
		},
		{},
	);
	const categories = Object.entries(byCategory)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([category, count]) => `  - ${category}: ${count}`)
		.join("\n");
	return [
		"Deuda semántica local",
		`- señales: ${report.signals.length}`,
		`- contexto truncado: ${report.totals.truncatedContextEvents}`,
		`- fuentes stale/missing: ${report.totals.staleSources}`,
		`- digests faltantes: ${report.totals.missingDigests}`,
		`- planes/specs históricos: ${report.totals.oldPlans}`,
		`- candidatos de poda: ${report.totals.pruningCandidates}`,
		categories,
		"- advisory-only: sí",
		"- borrado automático: no",
		"- promoción de contratos: no",
		"- prompts/docs crudos: no almacenado",
		"- analytics remota: no",
	]
		.filter(Boolean)
		.join("\n");
}

function scanSuperpowerArtifacts(repoRoot: string, now: Date): {
	oldPlanOrSpecCount: number;
	olderThan30Days: number;
	totalBytes: number;
	samplePaths: string[];
} {
	const dirs = [
		join(repoRoot, "docs", "superpowers", "plans"),
		join(repoRoot, "docs", "superpowers", "specs"),
	];
	const files = dirs.flatMap((dir) => listMarkdownFiles(repoRoot, dir));
	const nowMs = now.getTime();
	return {
		oldPlanOrSpecCount: files.length,
		olderThan30Days: files.filter(
			(file) => nowMs - file.mtimeMs > 30 * 24 * 60 * 60 * 1000,
		).length,
		totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
		samplePaths: files.slice(0, 8).map((file) => file.relativePath),
	};
}

function scanNoisyArtifacts(repoRoot: string): {
	noisyArtifacts: number;
	evidenceRefs: string[];
} {
	const dirs = ["subagent-artifacts", "artifacts", "reports"];
	const refs: string[] = [];
	let count = 0;
	for (const dirName of dirs) {
		const dir = join(repoRoot, dirName);
		const files = listFiles(dir);
		if (files > 0) {
			count += files;
			refs.push(`${dirName}:${files}`);
		}
	}
	return { noisyArtifacts: count, evidenceRefs: refs };
}

function listMarkdownFiles(
	repoRoot: string,
	dir: string,
): Array<{ relativePath: string; sizeBytes: number; mtimeMs: number }> {
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.flatMap((entry) => {
				const absolutePath = join(dir, entry.name);
				try {
					const stat = statSync(absolutePath);
					return [
						{
							relativePath: relative(repoRoot, absolutePath).replace(/\\/gu, "/"),
							sizeBytes: stat.size,
							mtimeMs: stat.mtimeMs,
						},
					];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

function listFiles(dir: string): number {
	if (!existsSync(dir)) return 0;
	try {
		return readdirSync(dir, { withFileTypes: true }).filter((entry) =>
			entry.isFile(),
		).length;
	} catch {
		return 0;
	}
}

function defaultBlockers(): string[] {
	return [
		"orchestrator review",
		"no automatic deletion",
		"no contract promotion",
	];
}

function sanitizeProjectId(projectId: string): string {
	return projectId
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/giu, "_");
}
