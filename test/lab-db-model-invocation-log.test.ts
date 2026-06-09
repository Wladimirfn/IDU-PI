import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { resolveEventsPath } from "../src/event-bus.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-pi-migration-"));
	tempRoots.push(dir);
	return dir;
}

function querySql(
	dbPath: string,
	sql: string,
): Array<Record<string, unknown>> {
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

test("applyMigrations creates model_invocation_log table on a fresh lab.db", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	const result = applyMigrations(dbPath);

	assert.equal(existsSync(dbPath), true);
	assert.deepEqual(result.applied, ["0001_model_invocation_log.sql"]);
	assert.equal(result.skipped.length, 0);
	assert.equal(tableExists(dbPath, "model_invocation_log"), true);
});

test("applyMigrations creates both indexes for model_invocation_log", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	applyMigrations(dbPath);

	assert.equal(indexExists(dbPath, "idx_model_invocation_log_ts"), true);
	assert.equal(
		indexExists(dbPath, "idx_model_invocation_log_role_ts"),
		true,
	);
});

test("applyMigrations inserts a row in lab-migrations-applied after the first run", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	applyMigrations(dbPath);

	const rows = querySql(
		dbPath,
		"SELECT name, applied_at FROM `lab-migrations-applied` ORDER BY name;",
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].name, "0001_model_invocation_log.sql");
	assert.ok(typeof rows[0].applied_at === "string");
	assert.match(rows[0].applied_at as string, /^\d{4}-\d{2}-\d{2} /u);
});

test("applyMigrations is idempotent: second run applies 0 migrations", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");

	const first = applyMigrations(dbPath);
	const second = applyMigrations(dbPath);

	assert.equal(first.applied.length, 1);
	assert.deepEqual(second.applied, []);
	assert.deepEqual(second.skipped, ["0001_model_invocation_log.sql"]);
});

test("applyMigrations upgrades a pre-existing lab.db that lacks the new table", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	// Simulate a pre-B5 lab.db: an empty file plus a few legacy tables.
	// We do NOT call initLabDb() (which now also runs the migration);
	// instead we run raw SQL to seed the legacy schema.
	execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`CREATE TABLE IF NOT EXISTS bug_findings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL, confidence TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT, suspected_cause TEXT, affected_files TEXT NOT NULL DEFAULT '[]', dedupe_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); INSERT INTO bug_findings (id, project_id, title, description, severity, confidence, status) VALUES ('legacy-1', 'project', 'legacy', 'legacy row', 'low', 'high', 'new');`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	assert.equal(tableExists(dbPath, "model_invocation_log"), false);

	const result = applyMigrations(dbPath);

	assert.deepEqual(result.applied, ["0001_model_invocation_log.sql"]);
	assert.equal(tableExists(dbPath, "model_invocation_log"), true);
	// legacy row is preserved
	assert.equal(
		querySql(
			dbPath,
			"SELECT id FROM bug_findings WHERE id = 'legacy-1';",
		).length,
		1,
	);
});

test("model_invocation_log enforces the role CHECK constraint", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	applyMigrations(dbPath);

	assert.throws(() => {
		execFileSync(
			"sqlite3",
			[
				"-json",
				dbPath,
				`INSERT INTO model_invocation_log (id, role, provider, model, status, prompt_chars) VALUES ('row-bad', 'not-a-role', 'p', 'm', 'success', 1);`,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
	}, /CHECK constraint failed/u);
});

test("model_invocation_log enforces the status CHECK constraint", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	applyMigrations(dbPath);

	assert.throws(() => {
		execFileSync(
			"sqlite3",
			[
				"-json",
				dbPath,
				`INSERT INTO model_invocation_log (id, role, provider, model, status, prompt_chars) VALUES ('row-bad', 'agentlab-security', 'p', 'm', 'not-a-status', 1);`,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
	}, /CHECK constraint failed/u);
});

test("listRecentInvocations returns no rows for a freshly migrated lab.db", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	applyMigrations(dbPath);

	const repository = new LabDbRepository(dbPath);
	assert.deepEqual(repository.listRecentInvocations(50), []);
});

test("appendInvocation persists role/provider/model/status with prompt and response chars", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	const repository = new LabDbRepository(dbPath, {
		modelInvocationLogProjectId: "pi-telegram-bridge",
	});

	const result = repository.appendInvocation({
		role: "agentlab-security",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success",
		promptChars: 412,
		responseChars: 901,
	});

	assert.ok(typeof result.id === "string");
	assert.match(result.id, /^mil-/u);
	assert.ok(typeof result.ts === "string");

	const rows = querySql(
		dbPath,
		`SELECT id, role, provider, model, status, prompt_chars, response_chars FROM model_invocation_log WHERE id = '${result.id}';`,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].role, "agentlab-security");
	assert.equal(rows[0].provider, "opencode-go");
	assert.equal(rows[0].model, "deepseek-v4-pro");
	assert.equal(rows[0].status, "success");
	assert.equal(rows[0].prompt_chars, 412);
	assert.equal(rows[0].response_chars, 901);
});

test("appendInvocation appends a lab_write event with the documented payload contract", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	const repository = new LabDbRepository(dbPath, {
		modelInvocationLogProjectId: "pi-telegram-bridge",
	});

	const result = repository.appendInvocation({
		role: "agentlab-security",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success",
		promptChars: 412,
		responseChars: 901,
	});

	const eventsPath = resolveEventsPath(root);
	assert.equal(existsSync(eventsPath), true);
	const events = readFileSync(eventsPath, "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const labWriteEvents = events.filter((event) => event.kind === "lab_write");
	assert.equal(labWriteEvents.length, 1);
	assert.deepEqual(labWriteEvents[0].payload, {
		table: "model_invocation_log",
		operation: "insert",
		rowId: result.id,
		role: "agentlab-security",
	});
	assert.equal(labWriteEvents[0].sourceRef, "lab-db");
	assert.equal(labWriteEvents[0].projectId, "pi-telegram-bridge");
});

test("appendInvocation persists failure status and trims error_message", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	const repository = new LabDbRepository(dbPath);

	repository.appendInvocation({
		role: "supervisor-main",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "failure",
		promptChars: 89,
		responseChars: 0,
		errorMessage: "ENOENT pi-cli",
	});

	const rows = querySql(
		dbPath,
		`SELECT status, error_message FROM model_invocation_log WHERE role = 'supervisor-main';`,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "failure");
	assert.equal(rows[0].error_message, "ENOENT pi-cli");
});

test("listRecentInvocations orders by ts DESC and filters by role", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	const repository = new LabDbRepository(dbPath);

	repository.appendInvocation({
		role: "supervisor-main",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success",
		promptChars: 100,
		responseChars: 200,
		ts: "2026-06-08T10:00:00.000Z",
	});
	repository.appendInvocation({
		role: "agentlab-security",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success",
		promptChars: 200,
		responseChars: 300,
		ts: "2026-06-08T11:00:00.000Z",
	});
	repository.appendInvocation({
		role: "supervisor-main",
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success",
		promptChars: 300,
		responseChars: 400,
		ts: "2026-06-08T12:00:00.000Z",
	});

	const all = repository.listRecentInvocations(50);
	assert.equal(all.length, 3);
	// newest first
	assert.equal(all[0].ts, "2026-06-08T12:00:00.000Z");
	assert.equal(all[2].ts, "2026-06-08T10:00:00.000Z");

	const supervisorOnly = repository.listRecentInvocations(50, "supervisor-main");
	assert.equal(supervisorOnly.length, 2);
	assert.ok(supervisorOnly.every((row) => row.role === "supervisor-main"));

	const securityOnly = repository.listRecentInvocations(50, "agentlab-security");
	assert.equal(securityOnly.length, 1);
	assert.equal(securityOnly[0].role, "agentlab-security");
});

test("enableModelInvocationLog: false short-circuits both methods and emits no event", () => {
	const root = tempDir();
	const dbPath = join(root, "lab.db");
	const repository = new LabDbRepository(dbPath, {
		enableModelInvocationLog: false,
		modelInvocationLogProjectId: "pi-telegram-bridge",
	});

	const input = {
		role: "agentlab-security" as const,
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		status: "success" as const,
		promptChars: 10,
		responseChars: 20,
	};
	repository.appendInvocation(input);
	assert.deepEqual(repository.listRecentInvocations(50), []);

	const rows = querySql(dbPath, "SELECT COUNT(*) AS n FROM model_invocation_log;");
	assert.equal(Number(rows[0].n), 0);

	const eventsPath = resolveEventsPath(root);
	assert.equal(existsSync(eventsPath), false);
});

after(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
