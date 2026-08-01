import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./lab-db/migrations/runner.js";
import type { LabRunRecord } from "./lab-reports.js";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type FindingStatus =
	| "new"
	| "triaged"
	| "accepted"
	| "deferred"
	| "ignored"
	| "fixed"
	| "duplicate";

export type BugFindingInput = {
	id: string;
	projectId: string;
	title: string;
	description: string;
	severity: FindingSeverity;
	confidence: FindingConfidence;
	status?: FindingStatus;
	evidence?: string;
	suspectedCause?: string;
	affectedFiles?: string[];
	dedupeKey?: string;
	/**
	 * The AgentLab specialty that produced this finding (e.g. "security",
	 * "database"). Nullable in the DB; participates in the v2 dedupe key
	 * so two specialists reporting the same defect stay as two rows.
	 */
	specialty?: string;
};

export type BugFinding = Required<
	Pick<
		BugFindingInput,
		"id" | "projectId" | "title" | "description" | "severity" | "confidence"
	>
> & {
	status: FindingStatus;
	evidence: string;
	suspectedCause: string;
	affectedFiles: string[];
	dedupeKey: string;
	specialty: string;
	recurrenceCount: number;
};

export type ProposalType = "fix" | "test" | "investigation" | "docs" | "memory";

export type ProposalInput = {
	id: string;
	proposalType: ProposalType;
	summary: string;
	details?: string;
	priority?: number;
	createdByAgentId?: string;
};

export type UserSignalInput = {
	id: string;
	projectId: string;
	source: string;
	rawText: string;
	detectedEmotion: string;
	urgency: number;
	confidence: string;
	matchedKeywords: string[];
};

export type FindingWithProposalInput = {
	finding: BugFindingInput;
	proposal?: ProposalInput;
};

export type InitLabDbResult = {
	dbPath: string;
	created: boolean;
};

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS lab_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_label TEXT NOT NULL,
  workspace TEXT NOT NULL,
  duration_label TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','timeout','skipped')),
  summary TEXT NOT NULL,
  raw_output TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bug_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','accepted','deferred','ignored','fixed','duplicate')),
  evidence TEXT,
  suspected_cause TEXT,
  affected_files TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT,
  specialty TEXT,
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS bug_findings_dedupe_idx
  ON bug_findings(project_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND dedupe_key != '';

CREATE TABLE IF NOT EXISTS finding_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES bug_findings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES bug_findings(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN ('fix','test','investigation','docs','memory')),
  summary TEXT NOT NULL,
  details TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','implemented','superseded')),
  created_by_agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS lab_tasks (
  id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES bug_findings(id) ON DELETE SET NULL,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  project_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('reproduce','verify','fix','review','sync_engram')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','blocked','done','cancelled')),
  assigned_agent_id TEXT,
  command_budget INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('project','source','user','global')),
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  fingerprint TEXT,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding_skills (
  finding_id TEXT NOT NULL REFERENCES bug_findings(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skill_index(id) ON DELETE CASCADE,
  reason TEXT,
  PRIMARY KEY (finding_id, skill_id)
);

CREATE TABLE IF NOT EXISTS user_signal_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  detected_emotion TEXT NOT NULL,
  urgency INTEGER NOT NULL CHECK (urgency BETWEEN 1 AND 5),
  confidence TEXT NOT NULL,
  matched_keywords TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS semantic_audit_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('manual','threshold','scheduled')),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','skipped')),
  scanned_counts TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  critical_findings TEXT NOT NULL DEFAULT '[]',
  rules_to_preserve TEXT NOT NULL DEFAULT '[]',
  suggested_agent_tasks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS semantic_audit_checkpoints (
  project_id TEXT PRIMARY KEY,
  last_lab_run_count INTEGER NOT NULL DEFAULT 0,
  last_finding_count INTEGER NOT NULL DEFAULT 0,
  last_proposal_count INTEGER NOT NULL DEFAULT 0,
  last_task_count INTEGER NOT NULL DEFAULT 0,
  last_user_signal_count INTEGER NOT NULL DEFAULT 0,
  last_memory_item_count INTEGER NOT NULL DEFAULT 0,
  last_critical_finding_count INTEGER NOT NULL DEFAULT 0,
  last_high_finding_count INTEGER NOT NULL DEFAULT 0,
  last_audit_at TEXT
);

CREATE TABLE IF NOT EXISTS semantic_memory_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  importance TEXT NOT NULL CHECK (importance IN ('critical','high','medium','low','noise')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function sqlString(value: string | undefined): string {
	if (!value) return "NULL";
	return `'${value.replace(/'/gu, "''")}'`;
}

function sqlOptionalString(value: string | undefined): string {
	if (value === undefined) return "NULL";
	return `'${value.replace(/'/gu, "''")}'`;
}

function sqlInteger(value: number, fieldName: string): string {
	if (!Number.isSafeInteger(value)) {
		throw new TypeError(`${fieldName} must be a safe integer`);
	}
	return value.toString();
}

function runSql(dbPath: string, sql: string): string {
	return execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export { runSql, sqlInteger, sqlOptionalString, sqlString };

export function initLabDb(dbPath: string): InitLabDbResult {
	const created = !existsSync(dbPath);
	mkdirSync(dirname(dbPath), { recursive: true });
	runSql(dbPath, SCHEMA);
	ensureColumn(
		dbPath,
		"semantic_audit_checkpoints",
		"last_critical_finding_count",
		"INTEGER NOT NULL DEFAULT 0",
	);
	ensureColumn(
		dbPath,
		"semantic_audit_checkpoints",
		"last_high_finding_count",
		"INTEGER NOT NULL DEFAULT 0",
	);
	// Block-1 pt 3: specialty + recurrence_count on bug_findings. SQLite has
	// no ADD COLUMN IF NOT EXISTS, so ensureColumn guards with PRAGMA
	// table_info. Idempotent — a no-op when the CREATE TABLE already added
	// the columns (new DBs) or a prior init already migrated (existing DBs).
	ensureColumn(dbPath, "bug_findings", "specialty", "TEXT");
	ensureColumn(
		dbPath,
		"bug_findings",
		"recurrence_count",
		"INTEGER NOT NULL DEFAULT 1",
	);
	// B5 PR1: apply pending SQL migrations (model_invocation_log + future
	// tables). applyMigrations is idempotent and reads the SQL files
	// from src/lab-db/migrations at runtime.
	applyMigrations(dbPath);
	return { dbPath, created };
}

function ensureColumn(
	dbPath: string,
	tableName: string,
	columnName: string,
	definition: string,
): void {
	const output = runSql(dbPath, `PRAGMA table_info(${tableName});`).trim();
	const columns = output
		? (JSON.parse(output) as Array<{ name: string }>).map((row) => row.name)
		: [];
	if (columns.includes(columnName)) return;
	runSql(
		dbPath,
		`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`,
	);
}

export function formatInitLabDbResult(result: InitLabDbResult): string {
	return `Lab DB\n${result.dbPath}\n\nEstado: ${result.created ? "creada" : "existente/actualizada"}`;
}

export function recordLabRun(dbPath: string, record: LabRunRecord): void {
	initLabDb(dbPath);
	const sql = `
INSERT INTO lab_runs (
  id, project_id, project_path, agent_id, agent_label, workspace,
  duration_label, duration_ms, status, summary, raw_output, error,
  started_at, finished_at
) VALUES (
  ${sqlString(record.id)},
  ${sqlString(record.projectId)},
  ${sqlString(record.projectPath)},
  ${sqlString(record.agentId)},
  ${sqlString(record.agentLabel)},
  ${sqlString(record.workspace)},
  ${sqlString(record.durationLabel)},
  ${sqlInteger(record.durationMs, "durationMs")},
  ${sqlString(record.status)},
  ${sqlString(record.summary)},
  ${sqlOptionalString(record.rawOutput)},
  ${sqlOptionalString(record.error)},
  ${sqlString(record.startedAt)},
  ${sqlString(record.finishedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  project_path = excluded.project_path,
  agent_id = excluded.agent_id,
  agent_label = excluded.agent_label,
  workspace = excluded.workspace,
  duration_label = excluded.duration_label,
  duration_ms = excluded.duration_ms,
  status = excluded.status,
  summary = excluded.summary,
  raw_output = excluded.raw_output,
  error = excluded.error,
  started_at = excluded.started_at,
  finished_at = excluded.finished_at;
`;
	runSql(dbPath, sql);
}

export function recordFindingWithProposal(
	dbPath: string,
	input: FindingWithProposalInput,
): void {
	initLabDb(dbPath);
	const status = input.finding.status ?? "new";
	const affectedFiles = JSON.stringify(input.finding.affectedFiles ?? []);
	// status is human-controlled: set on INSERT (default 'new'), changed
	// only by triage. Re-reports MUST NOT overwrite it — the previous
	// `status = excluded.status` was the eraser. recurrence_count bumps on
	// every re-report so repeat defects are visible.
	const sql = `
INSERT INTO bug_findings (
  id, project_id, title, description, severity, confidence, status,
  evidence, suspected_cause, affected_files, dedupe_key, specialty, updated_at
) VALUES (
  ${sqlString(input.finding.id)},
  ${sqlString(input.finding.projectId)},
  ${sqlString(input.finding.title)},
  ${sqlString(input.finding.description)},
  ${sqlString(input.finding.severity)},
  ${sqlString(input.finding.confidence)},
  ${sqlString(status)},
  ${sqlString(input.finding.evidence)},
  ${sqlString(input.finding.suspectedCause)},
  ${sqlString(affectedFiles)},
  ${sqlString(input.finding.dedupeKey)},
  ${sqlOptionalString(input.finding.specialty)},
  datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  severity = excluded.severity,
  confidence = excluded.confidence,
  specialty = excluded.specialty,
  evidence = excluded.evidence,
  suspected_cause = excluded.suspected_cause,
  affected_files = excluded.affected_files,
  dedupe_key = excluded.dedupe_key,
  recurrence_count = recurrence_count + 1,
  updated_at = datetime('now')
ON CONFLICT(project_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND dedupe_key != '' DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  severity = excluded.severity,
  confidence = excluded.confidence,
  specialty = excluded.specialty,
  evidence = excluded.evidence,
  suspected_cause = excluded.suspected_cause,
  affected_files = excluded.affected_files,
  recurrence_count = recurrence_count + 1,
  updated_at = datetime('now');
`;
	runSql(dbPath, sql);
	if (!input.proposal) return;
	const findingId = findingIdForProposal(dbPath, input.finding);
	const proposalSql = `
INSERT INTO proposals (
  id, finding_id, proposal_type, summary, details, priority, created_by_agent_id
) VALUES (
  ${sqlString(input.proposal.id)},
  ${sqlString(findingId)},
  ${sqlString(input.proposal.proposalType)},
  ${sqlString(input.proposal.summary)},
  ${sqlString(input.proposal.details)},
  ${sqlInteger(input.proposal.priority ?? 3, "priority")},
  ${sqlString(input.proposal.createdByAgentId)}
)
ON CONFLICT(id) DO UPDATE SET
  finding_id = excluded.finding_id,
  proposal_type = excluded.proposal_type,
  summary = excluded.summary,
  details = excluded.details,
  priority = excluded.priority,
  created_by_agent_id = excluded.created_by_agent_id;
`;
	runSql(dbPath, proposalSql);
}

function findingIdForProposal(
	dbPath: string,
	finding: BugFindingInput,
): string {
	if (!finding.dedupeKey) return finding.id;
	const output = runSql(
		dbPath,
		`SELECT id FROM bug_findings WHERE project_id = ${sqlString(finding.projectId)} AND dedupe_key = ${sqlString(finding.dedupeKey)} LIMIT 1;`,
	).trim();
	if (!output) return finding.id;
	const rows = JSON.parse(output) as Array<{ id: string }>;
	return rows[0]?.id ?? finding.id;
}

export function recordUserSignal(dbPath: string, input: UserSignalInput): void {
	initLabDb(dbPath);
	const urgency = sqlInteger(input.urgency, "urgency");
	if (input.urgency < 1 || input.urgency > 5) {
		throw new RangeError("urgency must be between 1 and 5");
	}
	const matchedKeywords = JSON.stringify(input.matchedKeywords);
	const sql = `
INSERT INTO user_signal_events (
  id, project_id, source, raw_text, detected_emotion, urgency, confidence, matched_keywords
) VALUES (
  ${sqlString(input.id)},
  ${sqlString(input.projectId)},
  ${sqlString(input.source)},
  ${sqlString(input.rawText)},
  ${sqlString(input.detectedEmotion)},
  ${urgency},
  ${sqlString(input.confidence)},
  ${sqlString(matchedKeywords)}
);
`;
	runSql(dbPath, sql);
}

export function recordBugFinding(dbPath: string, input: BugFindingInput): void {
	initLabDb(dbPath);
	const status = input.status ?? "new";
	const affectedFiles = JSON.stringify(input.affectedFiles ?? []);
	// status is human-controlled: set on INSERT (default 'new'), changed
	// only by triage. Re-reports MUST NOT overwrite it — the previous
	// `status = excluded.status` was the eraser. recurrence_count bumps on
	// every re-report so repeat defects are visible.
	const sql = `
INSERT INTO bug_findings (
  id, project_id, title, description, severity, confidence, status,
  evidence, suspected_cause, affected_files, dedupe_key, specialty, updated_at
) VALUES (
  ${sqlString(input.id)},
  ${sqlString(input.projectId)},
  ${sqlString(input.title)},
  ${sqlString(input.description)},
  ${sqlString(input.severity)},
  ${sqlString(input.confidence)},
  ${sqlString(status)},
  ${sqlString(input.evidence)},
  ${sqlString(input.suspectedCause)},
  ${sqlString(affectedFiles)},
  ${sqlString(input.dedupeKey)},
  ${sqlOptionalString(input.specialty)},
  datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  severity = excluded.severity,
  confidence = excluded.confidence,
  specialty = excluded.specialty,
  evidence = excluded.evidence,
  suspected_cause = excluded.suspected_cause,
  affected_files = excluded.affected_files,
  dedupe_key = excluded.dedupe_key,
  recurrence_count = recurrence_count + 1,
  updated_at = datetime('now');
`;
	// Whether this id already existed decides if a status event is honest.
	// Read BEFORE the upsert: afterwards the row exists either way.
	const priorStatus = readFindingStatus(dbPath, input.id);
	runSql(dbPath, sql);
	// Log a status event only for a genuine first insert. Since the upsert no
	// longer touches `status`, a re-report changes nothing — and writing
	// "new_status = new, actor = orchestrator" every tick would fabricate a
	// transition that never happened, in the one table you would consult to
	// ask "was this ack ever undone?". At 12 findings an hour that is ~288
	// invented events a day burying the real ones.
	if (priorStatus === undefined) {
		runSql(
			dbPath,
			`INSERT INTO finding_status_events (finding_id, old_status, new_status, actor, note) VALUES (${sqlString(input.id)}, NULL, ${sqlString(status)}, 'orchestrator', 'recorded from bridge');`,
		);
	}
}

/**
 * Current status of a finding, or undefined when the row does not exist.
 * Used to tell a first insert from a re-report so the audit trail only
 * records transitions that actually occurred.
 */
function readFindingStatus(dbPath: string, id: string): string | undefined {
	const output = runSql(
		dbPath,
		`SELECT status FROM bug_findings WHERE id = ${sqlString(id)} LIMIT 1;`,
	).trim();
	if (!output) return undefined;
	const rows = JSON.parse(output) as Array<{ status: string }>;
	return rows[0]?.status;
}

/**
 * Result of a status update. Carries the finding details needed to
 * render the close message (one source → two destinations: the DB
 * note and the Telegram message read the same fields).
 */
export type FindingStatusUpdate = {
	findingId: string;
	oldStatus: string;
	newStatus: FindingStatus;
	actor: string;
	note: string;
	title: string;
	filePath: string;
	severity: string;
};

/**
 * Change a finding's status with a MANDATORY reason.
 *
 * The reason is the label #397 measures. Without it, a closed finding
 * is mute data — indistinguishable from "barrido debajo de la
 * alfombra". The code enforces non-empty; goodwill is not enough.
 *
 * Writes BOTH the status update AND a finding_status_events row.
 * Today lab-db.ts only registers births — this function closes that
 * gap for every transition.
 *
 * Idempotent: if old === new, returns without writing.
 */
export function updateFindingStatus(
	dbPath: string,
	findingId: string,
	newStatus: FindingStatus,
	actor: string,
	note: string,
): FindingStatusUpdate {
	if (!note || !note.trim()) {
		throw new Error(
			"Reason is required to change finding status. " +
				"Without it, the audit trail is mute and #397 cannot measure.",
		);
	}
	initLabDb(dbPath);

	const oldStatus = readFindingStatus(dbPath, findingId);
	if (oldStatus === undefined) {
		throw new Error(`Finding not found: ${findingId}`);
	}
	if (oldStatus === newStatus) {
		// Idempotent — no transition to record.
	}

	// Update status
	runSql(
		dbPath,
		`UPDATE bug_findings SET status = ${sqlString(newStatus)}, updated_at = datetime('now') WHERE id = ${sqlString(findingId)};`,
	);

	// Write audit event — ALWAYS, not just at birth.
	runSql(
		dbPath,
		`INSERT INTO finding_status_events (finding_id, old_status, new_status, actor, note) VALUES (${sqlString(findingId)}, ${sqlString(oldStatus)}, ${sqlString(newStatus)}, ${sqlString(actor)}, ${sqlString(note.trim())});`,
	);

	// Read finding details for the close message
	const detailOutput = runSql(
		dbPath,
		`SELECT title, severity, affected_files FROM bug_findings WHERE id = ${sqlString(findingId)} LIMIT 1;`,
	).trim();
	const detailRows = JSON.parse(detailOutput) as Array<{
		title: string;
		severity: string;
		affected_files: string;
	}>;
	const detail = detailRows[0];
	const filePath =
		(JSON.parse(detail?.affected_files || "[]") as string[])[0] ?? "";

	return {
		findingId,
		oldStatus,
		newStatus,
		actor,
		note: note.trim(),
		title: detail?.title ?? "",
		filePath,
		severity: detail?.severity ?? "",
	};
}

export function listOpenFindings(
	dbPath: string,
	projectId: string,
): BugFinding[] {
	initLabDb(dbPath);
	const output = runSql(
		dbPath,
		`SELECT id, project_id, title, description, severity, confidence, status, COALESCE(evidence, '') AS evidence, COALESCE(suspected_cause, '') AS suspectedCause, affected_files AS affectedFiles, COALESCE(dedupe_key, '') AS dedupeKey, COALESCE(specialty, '') AS specialty, COALESCE(recurrence_count, 1) AS recurrenceCount FROM bug_findings WHERE project_id = ${sqlString(projectId)} AND status NOT IN ('fixed','ignored','duplicate') ORDER BY severity, updated_at DESC;`,
	).trim();
	if (!output) return [];
	const rows = JSON.parse(output) as Array<{
		id: string;
		project_id: string;
		title: string;
		description: string;
		severity: FindingSeverity;
		confidence: FindingConfidence;
		status: FindingStatus;
		evidence: string;
		suspectedCause: string;
		affectedFiles: string;
		dedupeKey: string;
		specialty: string;
		recurrenceCount: number;
	}>;
	return rows.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		description: row.description,
		severity: row.severity,
		confidence: row.confidence,
		status: row.status,
		evidence: row.evidence,
		suspectedCause: row.suspectedCause,
		affectedFiles: JSON.parse(row.affectedFiles) as string[],
		dedupeKey: row.dedupeKey,
		specialty: row.specialty,
		recurrenceCount: row.recurrenceCount,
	}));
}
