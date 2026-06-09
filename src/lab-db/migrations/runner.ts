import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { listMigrations, migrationPath } from "./index.js";

export type ApplyMigrationsResult = {
	applied: string[];
	skipped: string[];
};

const MIGRATIONS_TABLE = "lab-migrations-applied";

function runSql(dbPath: string, sql: string): void {
	execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function runSqlFile(dbPath: string, filePath: string): void {
	const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
	execFileSync(
		"sqlite3",
		["-json", dbPath, `.read ${absolute.replace(/ /gu, "\\ ")}`],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}

function ensureMigrationsTable(dbPath: string): void {
	runSql(
		dbPath,
		`CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`,
	);
}

function alreadyApplied(dbPath: string, name: string): boolean {
	const output = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`SELECT name FROM \`${MIGRATIONS_TABLE}\` WHERE name = '${name.replace(/'/gu, "''")}';`,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
	if (!output) return false;
	const rows = JSON.parse(output) as Array<Record<string, unknown>>;
	return rows.length > 0;
}

function markApplied(dbPath: string, name: string): void {
	const escaped = name.replace(/'/gu, "''");
	runSql(
		dbPath,
		`INSERT INTO \`${MIGRATIONS_TABLE}\` (name) VALUES ('${escaped}');`,
	);
}

export function applyMigrations(dbPath: string): ApplyMigrationsResult {
	mkdirSync(dirname(dbPath), { recursive: true });
	if (!existsSync(dbPath)) {
		// Touch an empty file so sqlite3 can open it for the bootstrap.
		execFileSync(
			"node",
			["-e", "require('fs').writeFileSync(process.argv[1], '')", dbPath],
		);
	}
	ensureMigrationsTable(dbPath);

	const applied: string[] = [];
	const skipped: string[] = [];
	for (const name of listMigrations()) {
		if (alreadyApplied(dbPath, name)) {
			skipped.push(name);
			continue;
		}
		const path = migrationPath(name);
		runSqlFile(dbPath, path);
		markApplied(dbPath, name);
		applied.push(name);
	}
	return { applied, skipped };
}
