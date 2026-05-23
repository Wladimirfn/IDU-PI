import { execFileSync } from "node:child_process";
import { initLabDb } from "./lab-db.js";

export type SemanticAuditStats = {
	projectId: string;
	labRunCount: number;
	findingCount: number;
	proposalCount: number;
	taskCount: number;
	userSignalCount: number;
	memoryItemCount: number;
	criticalFindingCount: number;
	highFindingCount: number;
};

export type SemanticAuditCheckpoint = {
	projectId: string;
	lastLabRunCount: number;
	lastFindingCount: number;
	lastProposalCount: number;
	lastTaskCount: number;
	lastUserSignalCount: number;
	lastMemoryItemCount: number;
	lastCriticalFindingCount: number;
	lastHighFindingCount: number;
	lastAuditAt?: string;
};

export type SemanticAuditThresholds = {
	minorThreshold?: number;
	majorThreshold?: number;
};

export type SemanticAuditDecision =
	| {
			shouldRun: true;
			triggerReason:
				| "threshold_minor"
				| "threshold_major"
				| "critical_findings";
			newEventCount: number;
	  }
	| {
			shouldRun: false;
			triggerReason: "not_enough_data";
			newEventCount: number;
	  };

export type SemanticAuditRunMode = "manual" | "threshold" | "scheduled";
export type SemanticAuditRunStatus =
	| "pending"
	| "completed"
	| "failed"
	| "skipped";

export type SemanticAuditRunInput = {
	id: string;
	projectId: string;
	triggerReason: string;
	mode: SemanticAuditRunMode;
	status: SemanticAuditRunStatus;
	scannedCounts: Record<string, number>;
	summary?: string;
	criticalFindings?: unknown[];
	rulesToPreserve?: string[];
	suggestedAgentTasks?: unknown[];
	completedAt?: string;
};

export type SemanticMemoryImportance =
	| "critical"
	| "high"
	| "medium"
	| "low"
	| "noise";
export type SemanticMemoryStatus = "active" | "archived" | "superseded";

export type SemanticMemoryItemInput = {
	id: string;
	projectId: string;
	sourceType: string;
	sourceId?: string;
	importance: SemanticMemoryImportance;
	title: string;
	summary: string;
	tags?: string[];
	status?: SemanticMemoryStatus;
};

const DEFAULT_MINOR_THRESHOLD = 100;
const DEFAULT_MAJOR_THRESHOLD = 1000;

export function getSemanticAuditStats(
	dbPath: string,
	projectId: string,
): SemanticAuditStats {
	initLabDb(dbPath);
	return {
		projectId,
		labRunCount: countRows(
			dbPath,
			"lab_runs",
			`project_id = ${sqlString(projectId)}`,
		),
		findingCount: countRows(
			dbPath,
			"bug_findings",
			`project_id = ${sqlString(projectId)}`,
		),
		proposalCount: countRows(
			dbPath,
			"proposals",
			`finding_id IN (SELECT id FROM bug_findings WHERE project_id = ${sqlString(projectId)})`,
		),
		taskCount: countRows(
			dbPath,
			"lab_tasks",
			`project_id = ${sqlString(projectId)}`,
		),
		userSignalCount: countRows(
			dbPath,
			"user_signal_events",
			`project_id = ${sqlString(projectId)}`,
		),
		memoryItemCount: countRows(
			dbPath,
			"semantic_memory_items",
			`project_id = ${sqlString(projectId)}`,
		),
		criticalFindingCount: countRows(
			dbPath,
			"bug_findings",
			`project_id = ${sqlString(projectId)} AND severity = 'critical'`,
		),
		highFindingCount: countRows(
			dbPath,
			"bug_findings",
			`project_id = ${sqlString(projectId)} AND severity = 'high'`,
		),
	};
}

export function getSemanticAuditCheckpoint(
	dbPath: string,
	projectId: string,
): SemanticAuditCheckpoint {
	initLabDb(dbPath);
	const output = runSql(
		dbPath,
		`SELECT project_id, last_lab_run_count, last_finding_count, last_proposal_count, last_task_count, last_user_signal_count, last_memory_item_count, last_critical_finding_count, last_high_finding_count, last_audit_at FROM semantic_audit_checkpoints WHERE project_id = ${sqlString(projectId)} LIMIT 1;`,
	).trim();
	if (!output) return defaultCheckpoint(projectId);
	const [row] = JSON.parse(output) as Array<{
		project_id: string;
		last_lab_run_count: number;
		last_finding_count: number;
		last_proposal_count: number;
		last_task_count: number;
		last_user_signal_count: number;
		last_memory_item_count: number;
		last_critical_finding_count: number;
		last_high_finding_count: number;
		last_audit_at: string | null;
	}>;
	if (!row) return defaultCheckpoint(projectId);
	return {
		projectId: row.project_id,
		lastLabRunCount: row.last_lab_run_count,
		lastFindingCount: row.last_finding_count,
		lastProposalCount: row.last_proposal_count,
		lastTaskCount: row.last_task_count,
		lastUserSignalCount: row.last_user_signal_count,
		lastMemoryItemCount: row.last_memory_item_count,
		lastCriticalFindingCount: row.last_critical_finding_count,
		lastHighFindingCount: row.last_high_finding_count,
		...(row.last_audit_at ? { lastAuditAt: row.last_audit_at } : {}),
	};
}

export function shouldRunSemanticAudit(
	stats: SemanticAuditStats,
	checkpoint: SemanticAuditCheckpoint,
	thresholds: SemanticAuditThresholds = {},
): SemanticAuditDecision {
	const newEventCount = totalEvents(stats) - totalCheckpointEvents(checkpoint);
	if (
		stats.criticalFindingCount > checkpoint.lastCriticalFindingCount ||
		stats.highFindingCount > checkpoint.lastHighFindingCount
	) {
		return {
			shouldRun: true,
			triggerReason: "critical_findings",
			newEventCount,
		};
	}
	const majorThreshold = thresholds.majorThreshold ?? DEFAULT_MAJOR_THRESHOLD;
	if (newEventCount >= majorThreshold) {
		return { shouldRun: true, triggerReason: "threshold_major", newEventCount };
	}
	const minorThreshold = thresholds.minorThreshold ?? DEFAULT_MINOR_THRESHOLD;
	if (newEventCount >= minorThreshold) {
		return { shouldRun: true, triggerReason: "threshold_minor", newEventCount };
	}
	return { shouldRun: false, triggerReason: "not_enough_data", newEventCount };
}

export function createSemanticAuditRun(
	dbPath: string,
	input: SemanticAuditRunInput,
): void {
	initLabDb(dbPath);
	const sql = `
INSERT INTO semantic_audit_runs (
  id, project_id, trigger_reason, mode, status, scanned_counts, summary,
  critical_findings, rules_to_preserve, suggested_agent_tasks, completed_at
) VALUES (
  ${sqlString(input.id)},
  ${sqlString(input.projectId)},
  ${sqlString(input.triggerReason)},
  ${sqlString(input.mode)},
  ${sqlString(input.status)},
  ${sqlString(JSON.stringify(input.scannedCounts))},
  ${sqlOptionalString(input.summary)},
  ${sqlString(JSON.stringify(input.criticalFindings ?? []))},
  ${sqlString(JSON.stringify(input.rulesToPreserve ?? []))},
  ${sqlString(JSON.stringify(input.suggestedAgentTasks ?? []))},
  ${sqlOptionalString(input.completedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  trigger_reason = excluded.trigger_reason,
  mode = excluded.mode,
  status = excluded.status,
  scanned_counts = excluded.scanned_counts,
  summary = excluded.summary,
  critical_findings = excluded.critical_findings,
  rules_to_preserve = excluded.rules_to_preserve,
  suggested_agent_tasks = excluded.suggested_agent_tasks,
  completed_at = excluded.completed_at;
`;
	runSql(dbPath, sql);
}

export function updateSemanticAuditCheckpoint(
	dbPath: string,
	projectId: string,
	stats: SemanticAuditStats,
): void {
	initLabDb(dbPath);
	const sql = `
INSERT INTO semantic_audit_checkpoints (
  project_id, last_lab_run_count, last_finding_count, last_proposal_count,
  last_task_count, last_user_signal_count, last_memory_item_count,
  last_critical_finding_count, last_high_finding_count, last_audit_at
) VALUES (
  ${sqlString(projectId)},
  ${sqlInteger(stats.labRunCount, "labRunCount")},
  ${sqlInteger(stats.findingCount, "findingCount")},
  ${sqlInteger(stats.proposalCount, "proposalCount")},
  ${sqlInteger(stats.taskCount, "taskCount")},
  ${sqlInteger(stats.userSignalCount, "userSignalCount")},
  ${sqlInteger(stats.memoryItemCount, "memoryItemCount")},
  ${sqlInteger(stats.criticalFindingCount, "criticalFindingCount")},
  ${sqlInteger(stats.highFindingCount, "highFindingCount")},
  datetime('now')
)
ON CONFLICT(project_id) DO UPDATE SET
  last_lab_run_count = excluded.last_lab_run_count,
  last_finding_count = excluded.last_finding_count,
  last_proposal_count = excluded.last_proposal_count,
  last_task_count = excluded.last_task_count,
  last_user_signal_count = excluded.last_user_signal_count,
  last_memory_item_count = excluded.last_memory_item_count,
  last_critical_finding_count = excluded.last_critical_finding_count,
  last_high_finding_count = excluded.last_high_finding_count,
  last_audit_at = excluded.last_audit_at;
`;
	runSql(dbPath, sql);
}

export function recordSemanticMemoryItem(
	dbPath: string,
	input: SemanticMemoryItemInput,
): void {
	initLabDb(dbPath);
	const sql = `
INSERT INTO semantic_memory_items (
  id, project_id, source_type, source_id, importance, title, summary, tags,
  status, updated_at
) VALUES (
  ${sqlString(input.id)},
  ${sqlString(input.projectId)},
  ${sqlString(input.sourceType)},
  ${sqlOptionalString(input.sourceId)},
  ${sqlString(input.importance)},
  ${sqlString(input.title)},
  ${sqlString(input.summary)},
  ${sqlString(JSON.stringify(input.tags ?? []))},
  ${sqlString(input.status ?? "active")},
  datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  source_type = excluded.source_type,
  source_id = excluded.source_id,
  importance = excluded.importance,
  title = excluded.title,
  summary = excluded.summary,
  tags = excluded.tags,
  status = excluded.status,
  updated_at = datetime('now');
`;
	runSql(dbPath, sql);
}

function defaultCheckpoint(projectId: string): SemanticAuditCheckpoint {
	return {
		projectId,
		lastLabRunCount: 0,
		lastFindingCount: 0,
		lastProposalCount: 0,
		lastTaskCount: 0,
		lastUserSignalCount: 0,
		lastMemoryItemCount: 0,
		lastCriticalFindingCount: 0,
		lastHighFindingCount: 0,
	};
}

function totalEvents(stats: SemanticAuditStats): number {
	return (
		stats.labRunCount +
		stats.findingCount +
		stats.proposalCount +
		stats.taskCount +
		stats.userSignalCount +
		stats.memoryItemCount
	);
}

function totalCheckpointEvents(checkpoint: SemanticAuditCheckpoint): number {
	return (
		checkpoint.lastLabRunCount +
		checkpoint.lastFindingCount +
		checkpoint.lastProposalCount +
		checkpoint.lastTaskCount +
		checkpoint.lastUserSignalCount +
		checkpoint.lastMemoryItemCount
	);
}

function countRows(dbPath: string, table: string, where: string): number {
	const output = runSql(
		dbPath,
		`SELECT COUNT(*) AS count FROM ${table} WHERE ${where};`,
	).trim();
	if (!output) return 0;
	const rows = JSON.parse(output) as Array<{ count: number }>;
	return rows[0]?.count ?? 0;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

function sqlOptionalString(value: string | undefined): string {
	if (value === undefined) return "NULL";
	return sqlString(value);
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
