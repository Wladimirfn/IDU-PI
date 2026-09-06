import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";

function tmpDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "lab-migrations-test-"));
	return join(dir, "lab.db");
}

function sqliteJson(dbPath: string, sql: string): string {
	return execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function removeTmp(dbPath: string): void {
	rmSync(join(dbPath, ".."), { recursive: true, force: true });
}

test("applyMigrations runs all known migrations and records each in lab-migrations-applied", () => {
	const dbPath = tmpDbPath();
	try {
		const first = applyMigrations(dbPath);
		// Includes 0001 (B5) and 0002 (B0). Future migrations can extend this.
		assert.ok(first.applied.includes("0001_model_invocation_log.sql"));
		assert.ok(first.applied.includes("0002_bibliotecario.sql"));

		const names = JSON.parse(
			sqliteJson(
				dbPath,
				"SELECT name FROM `lab-migrations-applied` ORDER BY name;",
			).trim(),
		) as Array<{ name: string }>;
		const appliedNames = names.map((row) => row.name);
		assert.ok(appliedNames.includes("0001_model_invocation_log.sql"));
		assert.ok(appliedNames.includes("0002_bibliotecario.sql"));

		const count = JSON.parse(
			sqliteJson(
				dbPath,
				"SELECT count(*) AS c FROM model_invocation_log;",
			).trim(),
		) as Array<{ c: number }>;
		assert.deepEqual(count, [{ c: 0 }]);
	} finally {
		removeTmp(dbPath);
	}
});

test("applyMigrations is idempotent on a second call", () => {
	const dbPath = tmpDbPath();
	try {
		applyMigrations(dbPath);
		const second = applyMigrations(dbPath);
		assert.deepEqual(second.applied, []);
		assert.ok(second.skipped.includes("0001_model_invocation_log.sql"));
		assert.ok(second.skipped.includes("0002_bibliotecario.sql"));

		const names = JSON.parse(
			sqliteJson(
				dbPath,
				"SELECT count(*) AS c FROM `lab-migrations-applied`;",
			).trim(),
		) as Array<{ c: number }>;
		// Count must equal the number of migrations applied.
		assert.equal((names as Array<{ c: number }>)[0]?.c, second.skipped.length);
	} finally {
		removeTmp(dbPath);
	}
});
