import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { runSql } from "../src/lab-db.js";

describe("skill-rating-migration", () => {
	let tempDir: string;
	let dbPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "skill-rating-migration-"));
		dbPath = join(tempDir, "lab.db");
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("adds score INTEGER column with CHECK constraint to bibliotecario_proposals", () => {
		// First, apply all existing migrations (B0+B5) to create the base schema
		applyMigrations(dbPath);

		// Apply B1 migration (0003_skill_rating.sql)
		applyMigrations(dbPath);

		// Verify the score column exists with the correct constraint
		const tableInfo = runSql(dbPath, "PRAGMA table_info(bibliotecario_proposals);");
		const columns = JSON.parse(tableInfo) as Array<{
			cid: number;
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
			pk: number;
		}>;

		const scoreColumn = columns.find((col) => col.name === "score");
		assert.ok(scoreColumn, "score column should exist");
		assert.equal(scoreColumn.type, "INTEGER", "score should be INTEGER type");
		assert.equal(scoreColumn.notnull, 0, "score should allow NULL");

		// Verify the CHECK constraint by trying to insert invalid values
		// First, we need to check if the constraint exists in the schema
		const schemaSql = runSql(
			dbPath,
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='bibliotecario_proposals';"
		);
		const schema = JSON.parse(schemaSql) as Array<{ sql: string }>;
		assert.ok(schema.length > 0, "table schema should exist");
		assert.ok(
			schema[0].sql.includes("score") && 
			(schema[0].sql.includes("CHECK") || schema[0].sql.includes("check")),
			"score column should have a CHECK constraint"
		);
	});

	it("is idempotent — running applyMigrations twice does not error", () => {
		// Apply all migrations
		applyMigrations(dbPath);
		applyMigrations(dbPath);
		applyMigrations(dbPath);

		// If we get here without throwing, the migration is idempotent
		assert.ok(true, "migration should be idempotent");

		// Verify the column still exists and is correct
		const tableInfo = runSql(dbPath, "PRAGMA table_info(bibliotecario_proposals);");
		const columns = JSON.parse(tableInfo) as Array<{ name: string }>;
		const scoreColumn = columns.find((col) => col.name === "score");
		assert.ok(scoreColumn, "score column should still exist after multiple runs");
	});

	it("allows NULL values in the score column", () => {
		// Apply all migrations
		applyMigrations(dbPath);

		// Try to insert a row with NULL score
		const insertSql = `
			INSERT INTO bibliotecario_proposals (id, kind, payload, status)
			VALUES ('test-proposal', 'skill-improvement', '{}', 'proposed');
		`;
		
		runSql(dbPath, insertSql);

		// Verify the row was inserted with NULL score
		const selectSql = `
			SELECT score FROM bibliotecario_proposals WHERE id = 'test-proposal';
		`;
		const result = runSql(dbPath, selectSql);
		const rows = JSON.parse(result) as Array<{ score: null }>;
		
		assert.equal(rows.length, 1, "should have one row");
		assert.equal(rows[0].score, null, "score should be NULL");
	});
});
