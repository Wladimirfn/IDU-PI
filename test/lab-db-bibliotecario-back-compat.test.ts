import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-pi-bibliotecario-backcompat-"));
	tempRoots.push(dir);
	return dir;
}

function querySql(dbPath: string, sql: string): Array<Record<string, unknown>> {
	const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

function tableExists(dbPath: string, tableName: string): boolean {
	return (
		querySql(
			dbPath,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}';`,
		).length > 0
	);
}

test("applyMigrations upgrades a pre-B0 lab.db by adding the B0 tables without losing data", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	// Simulate a pre-B0 lab.db: only model_invocation_log + lab-migrations-applied
	// We manually create the table and mark the migration as applied
	execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`CREATE TABLE IF NOT EXISTS \`lab-migrations-applied\` (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
			 INSERT INTO \`lab-migrations-applied\` (name) VALUES ('0001_model_invocation_log.sql');`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);

	// Create the model_invocation_log table (from 0001 migration)
	execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`CREATE TABLE IF NOT EXISTS model_invocation_log (
				id TEXT PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				role TEXT NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				status TEXT NOT NULL,
				prompt_chars INTEGER NOT NULL,
				response_chars INTEGER NOT NULL DEFAULT 0,
				error_message TEXT
			);`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);

	// Insert some test data into model_invocation_log
	execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`INSERT INTO model_invocation_log (id, role, provider, model, status, prompt_chars, response_chars) VALUES ('pre-b0-row-1', 'supervisor-main', 'opencode-go', 'deepseek-v4-pro', 'success', 100, 200);`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);

	// Verify pre-B0 state: model_invocation_log exists, B0 tables do not
	assert.equal(tableExists(dbPath, "model_invocation_log"), true);
	assert.equal(
		tableExists(dbPath, "skills"),
		false,
		"skills should not exist before B0 migration",
	);
	assert.equal(
		tableExists(dbPath, "sources"),
		false,
		"sources should not exist before B0 migration",
	);
	assert.equal(
		tableExists(dbPath, "digests"),
		false,
		"digests should not exist before B0 migration",
	);
	assert.equal(
		tableExists(dbPath, "ratings"),
		false,
		"ratings should not exist before B0 migration",
	);
	// Note: proposals table might exist from the SCHEMA blob in real usage, but in this test
	// we're simulating a minimal pre-B0 state without running initLabDb

	// Run applyMigrations: should skip 0001 (already applied), apply 0002
	const result = applyMigrations(dbPath);

	assert.deepEqual(
		result.applied,
		["0002_bibliotecario.sql"],
		"only 0002 should be applied",
	);
	assert.ok(
		result.skipped.includes("0001_model_invocation_log.sql"),
		"0001 should be skipped",
	);

	// Verify B0 tables now exist
	assert.equal(
		tableExists(dbPath, "skills"),
		true,
		"skills table should exist after upgrade",
	);
	assert.equal(
		tableExists(dbPath, "sources"),
		true,
		"sources table should exist after upgrade",
	);
	assert.equal(
		tableExists(dbPath, "digests"),
		true,
		"digests table should exist after upgrade",
	);
	assert.equal(
		tableExists(dbPath, "ratings"),
		true,
		"ratings table should exist after upgrade",
	);
	// Note: In a full lab.db (with SCHEMA blob), the old 'proposals' table would exist.
	// We renamed B0's proposals to bibliotecario_proposals to avoid collision.
	assert.equal(
		tableExists(dbPath, "bibliotecario_proposals"),
		true,
		"bibliotecario_proposals table should exist after upgrade",
	);

	// Verify existing data is preserved (no data loss)
	const rows = querySql(
		dbPath,
		"SELECT id, role, provider, model FROM model_invocation_log WHERE id = 'pre-b0-row-1';",
	);
	assert.equal(rows.length, 1, "pre-B0 row should still exist");
	assert.equal(rows[0].id, "pre-b0-row-1");
	assert.equal(rows[0].role, "supervisor-main");
	assert.equal(rows[0].provider, "opencode-go");
	assert.equal(rows[0].model, "deepseek-v4-pro");
});

after(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
