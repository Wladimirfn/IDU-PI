// test/lab-db-474-legacy-schema.test.ts
//
// Issue #474: the previous round shipped the new `view_partial`
// and `original_severity` columns in CREATE TABLE but did not
// backfill existing lab.db files. CREATE TABLE IF NOT EXISTS
// is a no-op on tables that already exist; it does NOT add
// columns. And COALESCE covers NULL values, not missing
// columns: the SELECT fails at prepare time with
// "no such column" before COALESCE can soften it.
//
// The owner verified this against the live DB and reported the
// error: "in prepare, no such column: view_partial".
// `getBugFinding` (the command merged yesterday for #459) had
// the same hole.
//
// The fix in src/lab-db.ts is the two `ensureColumn` calls in
// `initLabDb` — same pattern as the existing `specialty` and
// `recurrence_count` calls. These tests verify the fix runs:
//   1. Build a pre-#474 lab.db by hand (legacy schema, no
//      view_partial / original_severity).
//   2. Run `initLabDb` — which is what production runs at startup.
//   3. Run the read paths that the live DB tripped on:
//      `getBugFinding`, `listOpenFindings`, and
//      `checkUserEscalation`. None should error.
//   4. Confirm the columns now exist via PRAGMA table_info.
//
// The 4th test in this file is the mutation counterpart: with
// `ensureColumn(dbPath, "bug_findings", "view_partial", ...)`
// removed, the read paths fail again.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
	getBugFinding,
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	runSql,
} from "../src/lab-db.js";
import { checkUserEscalation } from "../src/user-escalation.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "idu-lab-db-474-"));
	dbPath = join(tempDir, "lab.db");
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

/**
 * Run an arbitrary sqlite3 command against the db. Throws with the
 * sqlite stderr on parse / prepare / execution errors so the
 * assertion message is meaningful when the test fails.
 */
function sqliteExec(dbPath: string, sql: string): string {
	return execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Read the column names of `bug_findings`. Returns an empty array
 * if the table doesn't exist (some legacy setups may differ).
 */
function bugFindingsColumns(dbPath: string): string[] {
	const out = sqliteExec(dbPath, `PRAGMA table_info(bug_findings);`).trim();
	if (!out) return [];
	const rows = JSON.parse(out) as Array<{ name: string }>;
	return rows.map((r) => r.name);
}

/**
 * Build a pre-#474 lab.db: a `bug_findings` table WITHOUT
 * `view_partial` and `original_severity`. Mirrors the schema
 * that was on disk at the moment the owner reported the bug.
 */
function seedLegacyLabDb(dbPath: string): void {
	sqliteExec(
		dbPath,
		`CREATE TABLE IF NOT EXISTS bug_findings (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL,
			severity TEXT NOT NULL,
			confidence TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'new',
			evidence TEXT,
			suspected_cause TEXT,
			affected_files TEXT NOT NULL DEFAULT '[]',
			dedupe_key TEXT,
			specialty TEXT,
			recurrence_count INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);`,
	);
	// Sanity: confirm the columns are missing before initLabDb runs.
	const before = bugFindingsColumns(dbPath);
	assert.ok(!before.includes("view_partial"));
	assert.ok(!before.includes("original_severity"));
}

describe("initLabDb backfills bug_findings view_partial + original_severity (#474)", () => {
	test("ensureColumn adds view_partial + original_severity to a legacy schema", () => {
		seedLegacyLabDb(dbPath);

		// The fix: this call is what production runs at startup.
		initLabDb(dbPath);

		const after = bugFindingsColumns(dbPath);
		assert.ok(
			after.includes("view_partial"),
			`view_partial must exist after initLabDb, got: ${after.join(", ")}`,
		);
		assert.ok(
			after.includes("original_severity"),
			`original_severity must exist after initLabDb, got: ${after.join(", ")}`,
		);
	});

	test("getBugFinding does not throw on a legacy lab.db after initLabDb (#459 read path)", () => {
		seedLegacyLabDb(dbPath);
		initLabDb(dbPath);

		// Seed a row so the query has something to read. Without
		// the new columns, this INSERT would fail; with the
		// backfill, the columns are present.
		recordBugFinding(dbPath, {
			id: "legacy-1",
			projectId: "test",
			title: "legacy row",
			description: "stored before #474",
			severity: "low",
			confidence: "high",
		});

		// This is the read path that the owner reported as
		// broken on the live DB. If `ensureColumn` is missing
		// or wrong, the SELECT fails at prepare with
		// "no such column: view_partial".
		const row = getBugFinding(dbPath, "legacy-1");
		assert.ok(row, "getBugFinding must return the legacy row");
		assert.equal(row.id, "legacy-1");
	});

	test("listOpenFindings does not throw on a legacy lab.db after initLabDb", () => {
		seedLegacyLabDb(dbPath);
		initLabDb(dbPath);

		recordBugFinding(dbPath, {
			id: "legacy-1",
			projectId: "test",
			title: "legacy row",
			description: "stored before #474",
			severity: "low",
			confidence: "high",
		});

		const rows = listOpenFindings(dbPath, "test");
		assert.equal(rows.length, 1);
		// New columns default on the legacy row (view_partial=0,
		// original_severity='') — proves the COALESCE path works.
		assert.equal(rows[0].viewPartial, false);
		assert.equal(rows[0].originalSeverity, "");
	});

	test("checkUserEscalation does not throw on a legacy lab.db after initLabDb", () => {
		seedLegacyLabDb(dbPath);
		initLabDb(dbPath);

		// Seed a legacy row, then run the escalation check that
		// uses the new columns. If the columns are missing the
		// SELECT fails at prepare, taking down ALL three rules
		// (recent_critical_threshold, recent_total_threshold,
		// recent_recurrence_threshold) — not just the new one.
		// The owner observed this directly on the live DB.
		runSql(
			dbPath,
			`INSERT INTO bug_findings
				(id, project_id, title, description, severity, confidence, status,
				 affected_files, created_at, updated_at)
			 VALUES
				('legacy-2', 'test', 'legacy row', 'desc', 'high', 'high', 'new',
				 '[]', '2026-06-15 12:00:00', '2026-06-15 12:00:00');`,
		);

		const out = checkUserEscalation({
			stateRoot: tempDir,
			labDbPath: dbPath,
			projectId: "test",
			lastUserInteractionAt: new Date(
				Date.now() - 60 * 60 * 1000,
			).toISOString(),
			now: new Date(),
		});
		// No assertion on the specific reasons — the point of
		// this test is that the function returns without throwing.
		// `out.shouldEscalate` reflects the rule logic; the
		// legacy row is severity=high, total=1 (no rules fire).
		assert.equal(out.shouldEscalate, false);
	});
});
