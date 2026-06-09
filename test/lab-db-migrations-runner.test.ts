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

test("applyMigrations runs 0001_model_invocation_log and records it in lab-migrations-applied", () => {
	const dbPath = tmpDbPath();
	try {
		const first = applyMigrations(dbPath);
		assert.deepEqual(first.applied, ["0001_model_invocation_log.sql"]);

		const names = JSON.parse(
			sqliteJson(
				dbPath,
				"SELECT name FROM `lab-migrations-applied` ORDER BY name;",
			).trim(),
		) as Array<{ name: string }>;
		assert.deepEqual(
			names.map((row) => row.name),
			["0001_model_invocation_log.sql"],
		);

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
		assert.deepEqual(second.skipped, ["0001_model_invocation_log.sql"]);

		const names = JSON.parse(
			sqliteJson(
				dbPath,
				"SELECT count(*) AS c FROM `lab-migrations-applied`;",
			).trim(),
		) as Array<{ c: number }>;
		assert.deepEqual(names, [{ c: 1 }]);
	} finally {
		removeTmp(dbPath);
	}
});
