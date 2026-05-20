import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
};

export type BugFinding = Required<
	Pick<
		BugFindingInput,
		| "id"
		| "projectId"
		| "title"
		| "description"
		| "severity"
		| "confidence"
	>
> & {
	status: FindingStatus;
	evidence: string;
	suspectedCause: string;
	affectedFiles: string[];
	dedupeKey: string;
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
`;

function sqlString(value: string | undefined): string {
	if (!value) return "NULL";
	return `'${value.replace(/'/gu, "''")}'`;
}

function runSql(dbPath: string, sql: string): string {
	return execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

export function initLabDb(dbPath: string): InitLabDbResult {
	const created = !existsSync(dbPath);
	mkdirSync(dirname(dbPath), { recursive: true });
	runSql(dbPath, SCHEMA);
	return { dbPath, created };
}

export function formatInitLabDbResult(result: InitLabDbResult): string {
	return `Lab DB\n${result.dbPath}\n\nEstado: ${result.created ? "creada" : "existente/actualizada"}`;
}

export function recordBugFinding(dbPath: string, input: BugFindingInput): void {
	initLabDb(dbPath);
	const status = input.status ?? "new";
	const affectedFiles = JSON.stringify(input.affectedFiles ?? []);
	const sql = `
INSERT INTO bug_findings (
  id, project_id, title, description, severity, confidence, status,
  evidence, suspected_cause, affected_files, dedupe_key, updated_at
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
  datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  severity = excluded.severity,
  confidence = excluded.confidence,
  status = excluded.status,
  evidence = excluded.evidence,
  suspected_cause = excluded.suspected_cause,
  affected_files = excluded.affected_files,
  dedupe_key = excluded.dedupe_key,
  updated_at = datetime('now');
`;
	runSql(dbPath, sql);
	runSql(
		dbPath,
		`INSERT INTO finding_status_events (finding_id, new_status, actor, note) VALUES (${sqlString(input.id)}, ${sqlString(status)}, 'orchestrator', 'recorded from bridge');`,
	);
}

export function listOpenFindings(dbPath: string, projectId: string): BugFinding[] {
	initLabDb(dbPath);
	const output = runSql(
		dbPath,
		`SELECT id, project_id, title, description, severity, confidence, status, COALESCE(evidence, '') AS evidence, COALESCE(suspected_cause, '') AS suspectedCause, affected_files AS affectedFiles, COALESCE(dedupe_key, '') AS dedupeKey FROM bug_findings WHERE project_id = ${sqlString(projectId)} AND status NOT IN ('fixed','ignored','duplicate') ORDER BY severity, updated_at DESC;`,
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
	}));
}
