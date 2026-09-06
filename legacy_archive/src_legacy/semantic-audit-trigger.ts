import type { LabDbRepository } from "./lab-db-repository.js";
import {
	shouldRunSemanticAudit,
	type SemanticAuditDecision,
	type SemanticAuditStats,
	type SemanticAuditThresholds,
} from "./semantic-audit.js";

export type SemanticAuditTriggerDecision = "executed" | "skipped" | "warning";

export type SemanticAuditTriggerResult = {
	projectId: string;
	decision: SemanticAuditTriggerDecision;
	triggerReason: SemanticAuditDecision["triggerReason"] | "error";
	summary: string;
	newEventCount?: number;
	runId?: string;
	warning?: string;
};

export type SemanticAuditTriggerRepository = Pick<
	LabDbRepository,
	| "getSemanticAuditStats"
	| "getSemanticAuditCheckpoint"
	| "createSemanticAuditRun"
	| "updateSemanticAuditCheckpoint"
>;

export type CheckSemanticAuditTriggerInput = {
	projectId: string;
	repository: Pick<
		SemanticAuditTriggerRepository,
		"getSemanticAuditStats" | "getSemanticAuditCheckpoint"
	>;
	thresholds?: SemanticAuditThresholds;
};

export type MaybeRunSemanticAuditTriggerInput = {
	projectId: string;
	repository: SemanticAuditTriggerRepository;
	thresholds?: SemanticAuditThresholds;
	now?: () => Date;
	idFactory?: (projectId: string, now: Date) => string;
};

const DEFAULT_THRESHOLDS: Required<SemanticAuditThresholds> = {
	minorThreshold: 100,
	majorThreshold: 1000,
};

export function checkSemanticAuditTrigger(
	input: CheckSemanticAuditTriggerInput,
): SemanticAuditDecision {
	const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
	const stats = input.repository.getSemanticAuditStats(input.projectId);
	const checkpoint = input.repository.getSemanticAuditCheckpoint(
		input.projectId,
	);
	return shouldRunSemanticAudit(stats, checkpoint, thresholds);
}

export function maybeRunSemanticAuditTrigger(
	input: MaybeRunSemanticAuditTriggerInput,
): SemanticAuditTriggerResult {
	try {
		const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
		const stats = input.repository.getSemanticAuditStats(input.projectId);
		const checkpoint = input.repository.getSemanticAuditCheckpoint(
			input.projectId,
		);
		const triggerDecision = shouldRunSemanticAudit(
			stats,
			checkpoint,
			thresholds,
		);
		if (!triggerDecision.shouldRun) {
			return {
				projectId: input.projectId,
				decision: "skipped",
				triggerReason: triggerDecision.triggerReason,
				newEventCount: triggerDecision.newEventCount,
				summary: "Auditoría automática omitida: no alcanzó umbral.",
			};
		}

		const now = input.now?.() ?? new Date();
		const runId = (input.idFactory ?? defaultRunId)(input.projectId, now);
		input.repository.createSemanticAuditRun({
			id: runId,
			projectId: input.projectId,
			triggerReason: triggerDecision.triggerReason,
			mode: "threshold",
			status: "completed",
			scannedCounts: scannedCounts(stats),
			summary: "Auditoría automática registrada sin IA ni compactación.",
			completedAt: now.toISOString(),
		});
		input.repository.updateSemanticAuditCheckpoint(input.projectId, stats);
		return {
			projectId: input.projectId,
			decision: "executed",
			triggerReason: triggerDecision.triggerReason,
			newEventCount: triggerDecision.newEventCount,
			runId,
			summary: "Auditoría automática registrada sin IA ni compactación.",
		};
	} catch (error) {
		return {
			projectId: input.projectId,
			decision: "warning",
			triggerReason: "error",
			summary:
				"No pude evaluar auditoría automática; el flujo principal continúa.",
			warning: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatSemanticAuditTriggerResult(
	result: SemanticAuditTriggerResult,
): string {
	return [
		"Semantic Audit Trigger",
		"",
		"Proyecto:",
		result.projectId,
		"",
		"Decisión:",
		result.decision,
		"",
		"Motivo:",
		result.triggerReason,
		"",
		"Resumen:",
		result.summary,
		...(result.runId ? ["", "Run ID:", result.runId] : []),
		...(typeof result.newEventCount === "number"
			? ["", "Eventos nuevos:", String(result.newEventCount)]
			: []),
		...(result.warning ? ["", "Warning:", result.warning] : []),
	].join("\n");
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

function defaultRunId(projectId: string, now: Date): string {
	const stamp = now
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/\.\d{3}Z$/u, "Z");
	return `semantic-audit-trigger-${projectId}-${stamp}`;
}
