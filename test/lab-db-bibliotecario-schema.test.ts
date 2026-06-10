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
	const dir = mkdtempSync(join(tmpdir(), "idu-pi-bibliotecario-schema-"));
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

function indexExists(dbPath: string, indexName: string): boolean {
	return (
		querySql(
			dbPath,
			`SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${indexName}';`,
		).length > 0
	);
}

test("applyMigrations creates the five bibliotecario tables on a fresh lab.db", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	applyMigrations(dbPath);

	// B0 adds 5 tables: skills, sources, digests, ratings, proposals
	assert.equal(
		tableExists(dbPath, "skills"),
		true,
		"skills table should exist",
	);
	assert.equal(
		tableExists(dbPath, "sources"),
		true,
		"sources table should exist",
	);
	assert.equal(
		tableExists(dbPath, "digests"),
		true,
		"digests table should exist",
	);
	assert.equal(
		tableExists(dbPath, "ratings"),
		true,
		"ratings table should exist",
	);
	assert.equal(
		tableExists(dbPath, "bibliotecario_proposals"),
		true,
		"bibliotecario_proposals table should exist",
	);
});

test("applyMigrations creates all six indexes for the B0 tables", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	applyMigrations(dbPath);

	// B0 adds 6 indexes
	assert.equal(
		indexExists(dbPath, "idx_skills_name"),
		true,
		"idx_skills_name should exist",
	);
	assert.equal(
		indexExists(dbPath, "idx_skills_updated_at"),
		true,
		"idx_skills_updated_at should exist",
	);
	assert.equal(
		indexExists(dbPath, "idx_sources_kind"),
		true,
		"idx_sources_kind should exist",
	);
	assert.equal(
		indexExists(dbPath, "idx_digests_source_id"),
		true,
		"idx_digests_source_id should exist",
	);
	assert.equal(
		indexExists(dbPath, "idx_ratings_target"),
		true,
		"idx_ratings_target should exist",
	);
	assert.equal(
		indexExists(dbPath, "idx_bibliotecario_proposals_status"),
		true,
		"idx_bibliotecario_proposals_status should exist",
	);
});

test("applyMigrations records 0002_bibliotecario.sql in lab-migrations-applied only on first run", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	// First run: should apply both migrations
	const first = applyMigrations(dbPath);
	assert.ok(
		first.applied.includes("0002_bibliotecario.sql"),
		"0002_bibliotecario.sql should be applied on first run",
	);

	const rows = querySql(
		dbPath,
		"SELECT name FROM `lab-migrations-applied` ORDER BY name;",
	);
	const migrationNames = rows.map((r) => r.name);
	assert.ok(
		migrationNames.includes("0002_bibliotecario.sql"),
		"0002_bibliotecario.sql should be in lab-migrations-applied",
	);

	// Second run: should skip both migrations (idempotent)
	const second = applyMigrations(dbPath);
	assert.deepEqual(
		second.applied,
		[],
		"no migrations should be applied on second run",
	);
	assert.ok(
		second.skipped.includes("0002_bibliotecario.sql"),
		"0002_bibliotecario.sql should be skipped on second run",
	);

	// Verify only one row for 0002_bibliotecario.sql
	const count = querySql(
		dbPath,
		"SELECT COUNT(*) AS c FROM `lab-migrations-applied` WHERE name = '0002_bibliotecario.sql';",
	);
	assert.equal(
		Number(count[0].c),
		1,
		"0002_bibliotecario.sql should appear exactly once in lab-migrations-applied",
	);
});

after(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
