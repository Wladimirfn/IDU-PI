import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	recordFindingWithProposal,
	recordLabRun,
	recordUserSignal,
	runSql,
	sqlInteger,
	sqlOptionalString,
	sqlString,
	type BugFinding,
	type BugFindingInput,
	type FindingWithProposalInput,
	type InitLabDbResult,
	type UserSignalInput,
} from "./lab-db.js";
import type {
	SkillInsert,
	SkillRecord,
	SkillIndexInsert,
	SkillIndexRecord,
	SourceInsert,
	SourceRecord,
	DigestInsert,
	DigestRecord,
	RatingInsert,
	RatingRecord,
	ProposalInsert,
	ProposalRecord,
} from "./bibliotecario-types.js";
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
	/**
	 * B0: projectId used for bibliotecario lab_write events. Defaults to
	 * "bibliotecario" when not provided.
	 */
	bibliotecarioProjectId?: string;
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

	// ─────────────────────────────────────────────────────────────────────────
	// B0: Bibliotecario methods (skills, sources, digests, ratings, proposals)
	// ─────────────────────────────────────────────────────────────────────────

	appendSkill(input: SkillInsert): SkillRecord {
		initLabDb(this.dbPath);
		const createdAt = input.createdAt ?? new Date().toISOString();
		const updatedAt = input.updatedAt ?? createdAt;
		const sql = `
INSERT INTO skills (id, name, version, status, created_at, updated_at)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.name)},
	${sqlString(input.version)},
	${sqlString(input.status)},
	${sqlString(createdAt)},
	${sqlString(updatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
	name = excluded.name,
	version = excluded.version,
	status = excluded.status,
	updated_at = excluded.updated_at;
`;
		runSql(this.dbPath, sql);
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "skills",
					operation: "insert",
					rowId: input.id,
				},
				this.options.bibliotecarioProjectId ?? "bibliotecario",
			);
		} catch {
			// best-effort
		}
		return {
			id: input.id,
			name: input.name,
			version: input.version,
			status: input.status,
			createdAt,
			updatedAt,
		};
	}

	appendSkillIndex(input: SkillIndexInsert): SkillIndexRecord {
		initLabDb(this.dbPath);
		const priority = input.priority ?? 100;
		const description = input.description ?? undefined;
		const fingerprint = input.fingerprint ?? undefined;
		const sql = `
INSERT INTO skill_index (id, name, path, source, description, priority, fingerprint)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.name)},
	${sqlString(input.path)},
	${sqlString(input.source)},
	${sqlOptionalString(description)},
	${sqlInteger(priority, "priority")},
	${sqlOptionalString(fingerprint)}
)
ON CONFLICT(id) DO UPDATE SET
	name = excluded.name,
	path = excluded.path,
	source = excluded.source,
	description = excluded.description,
	priority = excluded.priority,
	fingerprint = excluded.fingerprint;
`;
		runSql(this.dbPath, sql);
		const indexedAt = new Date().toISOString();
		return {
			id: input.id,
			name: input.name,
			path: input.path,
			source: input.source,
			description: description ?? null,
			priority,
			fingerprint: fingerprint ?? null,
			indexedAt,
		};
	}

	listSkillIndex(): SkillIndexRecord[] {
		initLabDb(this.dbPath);
		const raw = runSql(
			this.dbPath,
			`SELECT id, name, path, source, description, priority, fingerprint, indexed_at FROM skill_index ORDER BY priority ASC, name ASC;`,
		).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			name: string;
			path: string;
			source: SkillIndexRecord["source"];
			description: string | null;
			priority: number;
			fingerprint: string | null;
			indexed_at: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			path: row.path,
			source: row.source,
			description: row.description,
			priority: row.priority,
			fingerprint: row.fingerprint,
			indexedAt: row.indexed_at,
		}));
	}

	listSkills(): SkillRecord[] {
		initLabDb(this.dbPath);
		const raw = runSql(
			this.dbPath,
			`SELECT id, name, version, status, created_at, updated_at FROM skills ORDER BY updated_at DESC;`,
		).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			name: string;
			version: string;
			status: SkillRecord["status"];
			created_at: string;
			updated_at: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			version: row.version,
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	appendSource(input: SourceInsert): SourceRecord {
		initLabDb(this.dbPath);
		const addedAt = input.addedAt ?? new Date().toISOString();
		const status = input.status ?? "pending";
		const sql = `
INSERT INTO sources (id, kind, path, added_at, status)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.kind)},
	${sqlString(input.path)},
	${sqlString(addedAt)},
	${sqlString(status)}
)
ON CONFLICT(id) DO UPDATE SET
	kind = excluded.kind,
	path = excluded.path,
	status = excluded.status;
`;
		runSql(this.dbPath, sql);
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "sources",
					operation: "insert",
					rowId: input.id,
				},
				this.options.bibliotecarioProjectId ?? "bibliotecario",
			);
		} catch {
			// best-effort
		}
		return {
			id: input.id,
			kind: input.kind,
			path: input.path,
			addedAt,
			status,
		};
	}

	listSources(): SourceRecord[] {
		initLabDb(this.dbPath);
		const raw = runSql(
			this.dbPath,
			`SELECT id, kind, path, added_at, status FROM sources ORDER BY added_at DESC;`,
		).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			kind: SourceRecord["kind"];
			path: string;
			added_at: string;
			status: SourceRecord["status"];
		}>;
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			path: row.path,
			addedAt: row.added_at,
			status: row.status,
		}));
	}

	appendDigest(input: DigestInsert): DigestRecord {
		initLabDb(this.dbPath);
		const generatedAt = input.generatedAt ?? new Date().toISOString();
		const sql = `
INSERT INTO digests (id, source_id, generated_at, body)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.sourceId)},
	${sqlString(generatedAt)},
	${sqlString(input.body)}
)
ON CONFLICT(id) DO UPDATE SET
	source_id = excluded.source_id,
	body = excluded.body,
	generated_at = excluded.generated_at;
`;
		runSql(this.dbPath, sql);
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "digests",
					operation: "insert",
					rowId: input.id,
				},
				this.options.bibliotecarioProjectId ?? "bibliotecario",
			);
		} catch {
			// best-effort
		}
		return {
			id: input.id,
			sourceId: input.sourceId,
			generatedAt,
			body: input.body,
		};
	}

	listDigests(sourceId?: string): DigestRecord[] {
		initLabDb(this.dbPath);
		const where = sourceId ? `WHERE source_id = ${sqlString(sourceId)}` : "";
		const raw = runSql(
			this.dbPath,
			`SELECT id, source_id, generated_at, body FROM digests ${where} ORDER BY generated_at DESC;`,
		).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			source_id: string;
			generated_at: string;
			body: string;
		}>;
		return rows.map((row) => ({
			id: row.id,
			sourceId: row.source_id,
			generatedAt: row.generated_at,
			body: row.body,
		}));
	}

	appendRating(input: RatingInsert): RatingRecord {
		initLabDb(this.dbPath);
		if (input.score < 0 || input.score > 10) {
			throw new RangeError("score must be between 0 and 10");
		}
		const ratedAt = input.ratedAt ?? new Date().toISOString();
		const sql = `
INSERT INTO ratings (id, target_id, target_kind, score, rated_at)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.targetId)},
	${sqlString(input.targetKind)},
	${sqlInteger(input.score, "score")},
	${sqlString(ratedAt)}
)
ON CONFLICT(id) DO UPDATE SET
	target_id = excluded.target_id,
	target_kind = excluded.target_kind,
	score = excluded.score,
	rated_at = excluded.rated_at;
`;
		runSql(this.dbPath, sql);
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "ratings",
					operation: "insert",
					rowId: input.id,
				},
				this.options.bibliotecarioProjectId ?? "bibliotecario",
			);
		} catch {
			// best-effort
		}
		return {
			id: input.id,
			targetId: input.targetId,
			targetKind: input.targetKind,
			score: input.score,
			ratedAt,
		};
	}

	appendProposal(input: ProposalInsert): ProposalRecord {
		initLabDb(this.dbPath);
		const createdAt = input.createdAt ?? new Date().toISOString();
		const status = input.status ?? "proposed";
		const sql = `
INSERT INTO bibliotecario_proposals (id, kind, payload, created_at, status)
VALUES (
	${sqlString(input.id)},
	${sqlString(input.kind)},
	${sqlString(input.payload)},
	${sqlString(createdAt)},
	${sqlString(status)}
)
ON CONFLICT(id) DO UPDATE SET
	kind = excluded.kind,
	payload = excluded.payload,
	status = excluded.status;
`;
		runSql(this.dbPath, sql);
		try {
			appendLabWriteEvent(
				dirname(this.dbPath),
				{
					table: "bibliotecario_proposals",
					operation: "insert",
					rowId: input.id,
				},
				this.options.bibliotecarioProjectId ?? "bibliotecario",
			);
		} catch {
			// best-effort
		}
		return {
			id: input.id,
			kind: input.kind,
			payload: input.payload,
			createdAt,
			status,
		};
	}

	listProposals(filters?: {
		status?: ProposalRecord["status"];
		kind?: string;
	}): ProposalRecord[] {
		initLabDb(this.dbPath);
		const conditions: string[] = [];
		if (filters?.status) {
			conditions.push(`status = ${sqlString(filters.status)}`);
		}
		if (filters?.kind) {
			conditions.push(`kind = ${sqlString(filters.kind)}`);
		}
		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const raw = runSql(
			this.dbPath,
			`SELECT id, kind, payload, created_at, status FROM bibliotecario_proposals ${where} ORDER BY created_at DESC;`,
		).trim();
		if (!raw) return [];
		const rows = JSON.parse(raw) as Array<{
			id: string;
			kind: string;
			payload: string;
			created_at: string;
			status: ProposalRecord["status"];
		}>;
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			payload: row.payload,
			createdAt: row.created_at,
			status: row.status,
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
