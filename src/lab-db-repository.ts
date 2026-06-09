import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	recordFindingWithProposal,
	recordLabRun,
	recordUserSignal,
	runSql,
	type BugFinding,
	type BugFindingInput,
	type FindingWithProposalInput,
	type InitLabDbResult,
	type UserSignalInput,
} from "./lab-db.js";
import { appendLabWriteEvent } from "./event-bus.js";
import { dirname } from "node:path";
import type { LabRunRecord } from "./lab-reports.js";
import {
	insertInvocationSql,
	normalizeInvocationRecord,
	selectInvocationSql,
	type IduModelRoleId,
	type ModelInvocationRecord,
} from "./model-invocation-log.js";
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
	/**
	 * B5 rollout flag. When `false` (or `IDU_MODEL_INVOCATION_LOG=off` is
	 * in `process.env`), `appendInvocation` and `listRecentInvocations`
	 * become no-ops and no `lab_write` event is emitted.
	 */
	enableModelInvocationLog?: boolean;
	/**
	 * projectId used to stamp the `lab_write` event. Defaults to
	 * `agentlab` when not provided. Required for the audit-trail event
	 * (REQ-B0-3).
	 */
	modelInvocationLogProjectId?: string;
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

	private isModelInvocationLogDisabled(): boolean {
		if (this.options.enableModelInvocationLog === false) return true;
		const env = process.env.IDU_MODEL_INVOCATION_LOG;
		if (env && env.toLowerCase() === "off") return true;
		return false;
	}

	appendInvocation(input: ModelInvocationRecord): ModelInvocationRecord {
		// Always ensure the schema is up-to-date so the table is queryable
		// for analytics, even when logging is disabled.
		initLabDb(this.dbPath);
		if (this.isModelInvocationLogDisabled()) {
			return input;
		}
		const normalized = normalizeInvocationRecord(input);
		runSql(this.dbPath, insertInvocationSql(normalized));
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "model_invocation_log",
					operation: "insert",
					rowId: normalized.id,
					role: normalized.role,
				},
				this.options.modelInvocationLogProjectId ?? "agentlab",
			);
		} catch {
			// best-effort: a failing events.jsonl append must not roll back the row
		}
		return { ...input, id: normalized.id, ts: normalized.ts };
	}

	listRecentInvocations(
		limit: number,
		role?: IduModelRoleId,
	): ModelInvocationRecord[] {
		// Always ensure the schema is up-to-date so the table is queryable.
		initLabDb(this.dbPath);
		if (this.isModelInvocationLogDisabled()) return [];
		const raw = runSql(this.dbPath, selectInvocationSql(limit, role)).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			ts: string;
			role: IduModelRoleId;
			provider: string;
			model: string;
			status: "success" | "failure" | "skipped";
			prompt_chars: number;
			response_chars: number;
			error_message: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			ts: row.ts,
			role: row.role,
			provider: row.provider,
			model: row.model,
			status: row.status,
			promptChars: row.prompt_chars,
			responseChars: row.response_chars,
			errorMessage: row.error_message || undefined,
		}));
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
