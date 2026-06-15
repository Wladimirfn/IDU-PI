import {
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { initLabDb, runSql } from "./lab-db.js";

export type DecisionRecord = {
	projectId: string;
	decidedAt: string;
	decidedBy: string;
	decision: string;
	targetKind: string;
	targetId: string;
	rationale?: string;
	profileRef?: string;
};

export type DecisionRow = DecisionRecord & {
	id: number;
};

export type ListDecisionsOptions = {
	projectId: string;
	since?: string;
	limit?: number;
};

const DEFAULT_LIMIT = 50;

function sqlString(value: string | undefined | null): string {
	if (value === undefined || value === null) return "NULL";
	const escaped = value.replace(/'/g, "''");
	return `'${escaped}'`;
}

function ensureSchema(dbPath: string): void {
	if (!existsSync(dbPath)) {
		mkdirSync(dirname(dbPath), { recursive: true });
	}
	initLabDb(dbPath);
	const sql = `
		CREATE TABLE IF NOT EXISTS decision_ledger (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id      TEXT    NOT NULL,
			decided_at      TEXT    NOT NULL,
			decided_by      TEXT    NOT NULL,
			decision        TEXT    NOT NULL,
			target_kind     TEXT    NOT NULL,
			target_id       TEXT    NOT NULL,
			rationale       TEXT,
			profile_ref     TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_decision_ledger_project_time
			ON decision_ledger (project_id, decided_at);
	`;
	runSql(dbPath, sql);
}

export function recordDecision(
	dbPath: string,
	record: DecisionRecord,
): DecisionRow {
	ensureSchema(dbPath);
	const sql = `
		INSERT INTO decision_ledger
			(project_id, decided_at, decided_by, decision, target_kind, target_id, rationale, profile_ref)
		VALUES (
			${sqlString(record.projectId)},
			${sqlString(record.decidedAt)},
			${sqlString(record.decidedBy)},
			${sqlString(record.decision)},
			${sqlString(record.targetKind)},
			${sqlString(record.targetId)},
			${sqlString(record.rationale ?? null)},
			${sqlString(record.profileRef ?? null)}
		);
	`;
	runSql(dbPath, sql);
	const idOutput = runSql(
		dbPath,
		"SELECT last_insert_rowid() AS id;",
	).trim();
	// last_insert_rowid is per-connection; since runSql spawns a
	// fresh sqlite3 process for each call, the rowid does not
	// survive between calls. As a fallback, count rows for the
	// decision_ledger table — a brand-new id is the next MAX+1.
	const parsed = (() => {
		try {
			return JSON.parse(idOutput) as Array<{ id: number | string }>;
		} catch {
			return [];
		}
	})();
	let id = Number(parsed[0]?.id ?? 0);
	if (id === 0) {
		// Fallback: count is the new id.
		const countOut = runSql(
			dbPath,
			"SELECT COUNT(*) AS n FROM decision_ledger;",
		).trim();
		const countParsed = JSON.parse(countOut) as Array<{ n: number }>;
		id = Number(countParsed[0]?.n ?? 0);
	}
	return { ...record, id };
}

export function listDecisions(
	dbPath: string,
	options: ListDecisionsOptions,
): DecisionRow[] {
	if (!existsSync(dbPath)) return [];
	ensureSchema(dbPath);
	const where: string[] = [];
	if (options.projectId) {
		where.push(`project_id = ${sqlString(options.projectId)}`);
	}
	if (options.since) {
		where.push(`decided_at >= ${sqlString(options.since)}`);
	}
	const limit = options.limit ?? DEFAULT_LIMIT;
	const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
	const sql = `SELECT * FROM decision_ledger
		${whereClause}
		ORDER BY decided_at DESC, id DESC
		LIMIT ${Number(limit)};`;
	const output = runSql(dbPath, sql).trim();
	if (!output) return [];
	const rows = JSON.parse(output) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		id: Number(row.id),
		projectId: String(row.project_id ?? ""),
		decidedAt: String(row.decided_at ?? ""),
		decidedBy: String(row.decided_by ?? ""),
		decision: String(row.decision ?? ""),
		targetKind: String(row.target_kind ?? ""),
		targetId: String(row.target_id ?? ""),
		rationale: typeof row.rationale === "string" ? row.rationale : undefined,
		profileRef: typeof row.profile_ref === "string" ? row.profile_ref : undefined,
	}));
}

export function appendDecisionToFile(
	path: string,
	record: DecisionRecord,
): void {
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const line = `${JSON.stringify({
		...record,
		decidedAt: record.decidedAt,
		profileRef: record.profileRef,
	})}\n`;
	if (existsSync(path)) {
		writeFileSync(path, readFileSync(path, "utf8") + line, "utf8");
	} else {
		writeFileSync(path, line, "utf8");
	}
}

export function readDecisionsFromFile(path: string): DecisionRecord[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as DecisionRecord);
}

export const decisionLedgerPath = (stateRoot: string): string =>
	join(stateRoot, "decision-ledger.jsonl");
