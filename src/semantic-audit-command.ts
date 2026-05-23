import type { LabDbRepository } from "./lab-db-repository.js";
import {
	shouldRunSemanticAudit,
	type SemanticAuditCheckpoint,
	type SemanticAuditDecision,
	type SemanticAuditStats,
	type SemanticAuditThresholds,
} from "./semantic-audit.js";

export type SemanticAuditStatusReport = {
	projectId: string;
	stats: SemanticAuditStats;
	checkpoint: SemanticAuditCheckpoint;
	newEvents: SemanticAuditEventDelta;
	decision: SemanticAuditDecision;
	recommendedNext: string;
};

export type SemanticAuditRunResult = {
	projectId: string;
	runId: string;
	status: "completed" | "skipped";
	summary: string;
	checkpointUpdated: boolean;
	stats: SemanticAuditStats;
	decision: SemanticAuditDecision;
	recommendedNext: string;
};

export type SemanticAuditEventDelta = {
	labRuns: number;
	findings: number;
	proposals: number;
	tasks: number;
	userSignals: number;
	memoryItems: number;
	criticalFindings: number;
	highFindings: number;
};

export type BuildSemanticAuditStatusInput = {
	projectId: string;
	repository: Pick<
		LabDbRepository,
		"getSemanticAuditStats" | "getSemanticAuditCheckpoint"
	>;
	thresholds?: SemanticAuditThresholds;
};

export type RunManualSemanticAuditInput = BuildSemanticAuditStatusInput & {
	now?: () => Date;
	idFactory?: (projectId: string, now: Date) => string;
};

const DEFAULT_THRESHOLDS: Required<SemanticAuditThresholds> = {
	minorThreshold: 100,
	majorThreshold: 1000,
};

export function buildSemanticAuditStatus(
	input: BuildSemanticAuditStatusInput,
): SemanticAuditStatusReport {
	const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
	const stats = input.repository.getSemanticAuditStats(input.projectId);
	const checkpoint = input.repository.getSemanticAuditCheckpoint(
		input.projectId,
	);
	const decision = shouldRunSemanticAudit(stats, checkpoint, thresholds);
	return {
		projectId: input.projectId,
		stats,
		checkpoint,
		newEvents: eventDelta(stats, checkpoint),
		decision,
		recommendedNext: decision.shouldRun
			? "/semantic_audit_run"
			: "Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

export function runManualSemanticAudit(
	input: RunManualSemanticAuditInput & {
		repository: BuildSemanticAuditStatusInput["repository"] &
			Pick<
				LabDbRepository,
				"createSemanticAuditRun" | "updateSemanticAuditCheckpoint"
			>;
	},
): SemanticAuditRunResult {
	const report = buildSemanticAuditStatus(input);
	const now = input.now?.() ?? new Date();
	const runId = (input.idFactory ?? defaultRunId)(input.projectId, now);
	const status = "completed";
	const summary =
		report.decision.newEventCount > 0
			? "Auditoría manual registrada sin compactación."
			: "Auditoría manual registrada sin eventos nuevos desde el checkpoint.";
	input.repository.createSemanticAuditRun({
		id: runId,
		projectId: input.projectId,
		triggerReason: report.decision.triggerReason,
		mode: "manual",
		status,
		scannedCounts: scannedCounts(report.stats),
		summary,
		completedAt: now.toISOString(),
	});
	input.repository.updateSemanticAuditCheckpoint(input.projectId, report.stats);
	return {
		projectId: input.projectId,
		runId,
		status,
		summary,
		checkpointUpdated: true,
		stats: report.stats,
		decision: report.decision,
		recommendedNext:
			"Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

export function formatSemanticAuditStatus(
	report: SemanticAuditStatusReport,
): string {
	return [
		"Semantic Audit Status",
		"",
		"Proyecto:",
		report.projectId,
		"",
		"Conteos actuales:",
		...formatStats(report.stats),
		"",
		"Checkpoint anterior:",
		...formatCheckpoint(report.checkpoint),
		"",
		"Eventos nuevos:",
		...formatDelta(report.newEvents),
		"",
		"Decisión:",
		`shouldRun: ${String(report.decision.shouldRun)}`,
		`triggerReason: ${report.decision.triggerReason}`,
		`newEventCount: ${report.decision.newEventCount}`,
		"",
		"Siguiente recomendado:",
		report.recommendedNext,
	].join("\n");
}

export function formatSemanticAuditRunResult(
	result: SemanticAuditRunResult,
): string {
	return [
		"Semantic Audit Run",
		"",
		"Proyecto:",
		result.projectId,
		"",
		"Run ID:",
		result.runId,
		"",
		"Estado:",
		result.status,
		"",
		"Resumen:",
		result.summary,
		"",
		"Checkpoint actualizado:",
		result.checkpointUpdated ? "sí" : "no",
		"",
		"Siguiente recomendado:",
		result.recommendedNext,
		"",
		"Nota segura:",
		"No usé IA, no compacté memoria, no borré datos y no ejecuté AgentLabs.",
	].join("\n");
}

function eventDelta(
	stats: SemanticAuditStats,
	checkpoint: SemanticAuditCheckpoint,
): SemanticAuditEventDelta {
	return {
		labRuns: Math.max(0, stats.labRunCount - checkpoint.lastLabRunCount),
		findings: Math.max(0, stats.findingCount - checkpoint.lastFindingCount),
		proposals: Math.max(0, stats.proposalCount - checkpoint.lastProposalCount),
		tasks: Math.max(0, stats.taskCount - checkpoint.lastTaskCount),
		userSignals: Math.max(
			0,
			stats.userSignalCount - checkpoint.lastUserSignalCount,
		),
		memoryItems: Math.max(
			0,
			stats.memoryItemCount - checkpoint.lastMemoryItemCount,
		),
		criticalFindings: Math.max(
			0,
			stats.criticalFindingCount - checkpoint.lastCriticalFindingCount,
		),
		highFindings: Math.max(
			0,
			stats.highFindingCount - checkpoint.lastHighFindingCount,
		),
	};
}

function scannedCounts(stats: SemanticAuditStats): Record<string, number> {
	return {
		labRunCount: stats.labRunCount,
		findingCount: stats.findingCount,
		proposalCount: stats.proposalCount,
		taskCount: stats.taskCount,
		userSignalCount: stats.userSignalCount,
		memoryItemCount: stats.memoryItemCount,
		criticalFindingCount: stats.criticalFindingCount,
		highFindingCount: stats.highFindingCount,
	};
}

function formatStats(stats: SemanticAuditStats): string[] {
	return [
		`- lab_runs: ${stats.labRunCount}`,
		`- findings: ${stats.findingCount}`,
		`- proposals: ${stats.proposalCount}`,
		`- tasks: ${stats.taskCount}`,
		`- user_signals: ${stats.userSignalCount}`,
		`- memory_items: ${stats.memoryItemCount}`,
		`- critical_findings: ${stats.criticalFindingCount}`,
		`- high_findings: ${stats.highFindingCount}`,
	];
}

function formatCheckpoint(checkpoint: SemanticAuditCheckpoint): string[] {
	return [
		`- lab_runs: ${checkpoint.lastLabRunCount}`,
		`- findings: ${checkpoint.lastFindingCount}`,
		`- proposals: ${checkpoint.lastProposalCount}`,
		`- tasks: ${checkpoint.lastTaskCount}`,
		`- user_signals: ${checkpoint.lastUserSignalCount}`,
		`- memory_items: ${checkpoint.lastMemoryItemCount}`,
		`- critical_findings: ${checkpoint.lastCriticalFindingCount}`,
		`- high_findings: ${checkpoint.lastHighFindingCount}`,
		`- last_audit_at: ${checkpoint.lastAuditAt ?? "—"}`,
	];
}

function formatDelta(delta: SemanticAuditEventDelta): string[] {
	return [
		`- lab_runs: ${delta.labRuns}`,
		`- findings: ${delta.findings}`,
		`- proposals: ${delta.proposals}`,
		`- tasks: ${delta.tasks}`,
		`- user_signals: ${delta.userSignals}`,
		`- memory_items: ${delta.memoryItems}`,
		`- critical_findings: ${delta.criticalFindings}`,
		`- high_findings: ${delta.highFindings}`,
	];
}

function defaultRunId(projectId: string, now: Date): string {
	const stamp = now
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/\.\d{3}Z$/u, "Z");
	return `semantic-audit-${projectId}-${stamp}`;
}
