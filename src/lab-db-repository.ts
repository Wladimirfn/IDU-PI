import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	recordFindingWithProposal,
	recordLabRun,
	recordUserSignal,
	type BugFinding,
	type BugFindingInput,
	type FindingWithProposalInput,
	type InitLabDbResult,
	type UserSignalInput,
} from "./lab-db.js";
import type { LabRunRecord } from "./lab-reports.js";
import {
	createSemanticAuditRun,
	getSemanticAuditCheckpoint,
	getSemanticAuditStats,
	recordSemanticMemoryItem,
	updateSemanticAuditCheckpoint,
	type SemanticAuditCheckpoint,
	type SemanticAuditRunInput,
	type SemanticAuditStats,
	type SemanticAuditThresholds,
	type SemanticMemoryItemInput,
} from "./semantic-audit.js";
import {
	checkSemanticAuditTrigger,
	maybeRunSemanticAuditTrigger,
	type SemanticAuditTriggerResult,
} from "./semantic-audit-trigger.js";

export type LabDbRepositoryOptions = {
	enableSemanticAuditTrigger?: boolean;
	semanticAuditTriggerThresholds?: SemanticAuditThresholds;
	onSemanticAuditTrigger?: (result: SemanticAuditTriggerResult) => void;
};

export class LabDbRepository {
	constructor(
		private readonly dbPath: string,
		private readonly options: LabDbRepositoryOptions = {},
	) {}

	init(): InitLabDbResult {
		return initLabDb(this.dbPath);
	}

	recordBugFinding(input: BugFindingInput): void {
		recordBugFinding(this.dbPath, input);
		this.triggerSemanticAudit(input.projectId);
	}

	recordLabRun(record: LabRunRecord): void {
		recordLabRun(this.dbPath, record);
		this.triggerSemanticAudit(record.projectId);
	}

	recordUserSignal(input: UserSignalInput): void {
		recordUserSignal(this.dbPath, input);
		this.triggerSemanticAudit(input.projectId);
	}

	recordFindingWithProposal(input: FindingWithProposalInput): void {
		recordFindingWithProposal(this.dbPath, input);
		this.triggerSemanticAudit(input.finding.projectId);
	}

	listOpenFindings(projectId: string): BugFinding[] {
		return listOpenFindings(this.dbPath, projectId);
	}

	getSemanticAuditStats(projectId: string): SemanticAuditStats {
		return getSemanticAuditStats(this.dbPath, projectId);
	}

	getSemanticAuditCheckpoint(projectId: string): SemanticAuditCheckpoint {
		return getSemanticAuditCheckpoint(this.dbPath, projectId);
	}

	createSemanticAuditRun(input: SemanticAuditRunInput): void {
		createSemanticAuditRun(this.dbPath, input);
	}

	updateSemanticAuditCheckpoint(
		projectId: string,
		stats: SemanticAuditStats,
	): void {
		updateSemanticAuditCheckpoint(this.dbPath, projectId, stats);
	}

	recordSemanticMemoryItem(input: SemanticMemoryItemInput): void {
		recordSemanticMemoryItem(this.dbPath, input);
	}

	private triggerSemanticAudit(projectId: string): void {
		if (!this.options.enableSemanticAuditTrigger) return;
		if (this.options.onSemanticAuditTrigger) {
			try {
				const decision = checkSemanticAuditTrigger({
					projectId,
					repository: this,
					thresholds: this.options.semanticAuditTriggerThresholds,
				});
				this.options.onSemanticAuditTrigger({
					projectId,
					decision: decision.shouldRun ? "executed" : "skipped",
					triggerReason: decision.triggerReason,
					newEventCount: decision.newEventCount,
					summary: decision.shouldRun
						? "Umbral semántico detectado antes de registrar auditoría automática."
						: "Auditoría automática omitida: no alcanzó umbral.",
				});
			} catch (error) {
				this.options.onSemanticAuditTrigger({
					projectId,
					decision: "warning",
					triggerReason: "error",
					summary:
						"No pude evaluar auditoría automática; el flujo principal continúa.",
					warning: error instanceof Error ? error.message : String(error),
				});
			}
		}
		maybeRunSemanticAuditTrigger({
			projectId,
			repository: this,
			thresholds: this.options.semanticAuditTriggerThresholds,
		});
	}
}
