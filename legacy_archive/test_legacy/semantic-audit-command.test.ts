import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { recordBugFinding, recordLabRun } from "../src/lab-db.js";
import type { LabRunRecord } from "../src/lab-reports.js";
import {
	buildSemanticAuditStatus,
	formatSemanticAuditRunResult,
	formatSemanticAuditStatus,
	runManualSemanticAudit,
} from "../src/semantic-audit-command.js";

async function withTempDb(
	fn: (dbPath: string, repository: LabDbRepository) => void | Promise<void>,
) {
	const dir = mkdtempSync(join(tmpdir(), "semantic-audit-command-"));
	try {
		const dbPath = join(dir, "lab.db");
		await fn(dbPath, new LabDbRepository(dbPath));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function labRun(id: string): LabRunRecord {
	return {
		id,
		projectId: "pi-telegram-bridge",
		projectPath: "/project",
		agentId: "reviewer",
		agentLabel: "Reviewer",
		workspace: "main",
		durationLabel: "1s",
		durationMs: 1000,
		status: "completed",
		summary: "done",
		startedAt: "2026-05-23T00:00:00.000Z",
		finishedAt: "2026-05-23T00:00:01.000Z",
	};
}

function queryRows(
	dbPath: string,
	sql: string,
): Array<Record<string, unknown>> {
	const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

test("semantic_audit_status shows stats and checkpoint", async () => {
	await withTempDb((dbPath, repository) => {
		recordLabRun(dbPath, labRun("run-1"));
		const report = buildSemanticAuditStatus({
			projectId: "pi-telegram-bridge",
			repository,
		});
		const text = formatSemanticAuditStatus(report);

		assert.equal(report.stats.labRunCount, 1);
		assert.equal(report.checkpoint.lastLabRunCount, 0);
		assert.match(text, /Semantic Audit Status/u);
		assert.match(text, /Proyecto:\npi-telegram-bridge/u);
		assert.match(text, /Conteos actuales:/u);
		assert.match(text, /Checkpoint anterior:/u);
		assert.match(text, /Eventos nuevos:/u);
	});
});

test("semantic_audit_status detects shouldRun false below threshold", async () => {
	await withTempDb((_dbPath, repository) => {
		const report = buildSemanticAuditStatus({
			projectId: "pi-telegram-bridge",
			repository,
		});

		assert.equal(report.decision.shouldRun, false);
		assert.equal(report.decision.triggerReason, "not_enough_data");
	});
});

test("semantic_audit_status detects shouldRun true over 100", async () => {
	await withTempDb((dbPath, repository) => {
		for (let index = 0; index < 100; index += 1) {
			recordLabRun(dbPath, labRun(`run-${index}`));
		}

		const report = buildSemanticAuditStatus({
			projectId: "pi-telegram-bridge",
			repository,
		});

		assert.equal(report.decision.shouldRun, true);
		assert.equal(report.decision.triggerReason, "threshold_minor");
		assert.match(formatSemanticAuditStatus(report), /\/semantic_audit_run/u);
	});
});

test("semantic_audit_run creates manual semantic audit run", async () => {
	await withTempDb((dbPath, repository) => {
		recordBugFinding(dbPath, {
			id: "finding-1",
			projectId: "pi-telegram-bridge",
			title: "Critical finding",
			description: "Needs review.",
			severity: "critical",
			confidence: "high",
		});

		runManualSemanticAudit({
			projectId: "pi-telegram-bridge",
			repository,
			now: () => new Date("2026-05-23T12:00:00.000Z"),
			idFactory: () => "audit-1",
		});

		const [row] = queryRows(
			dbPath,
			"SELECT mode, status, scanned_counts FROM semantic_audit_runs WHERE id = 'audit-1';",
		);
		assert.equal(row.mode, "manual");
		assert.equal(row.status, "completed");
		assert.equal(JSON.parse(row.scanned_counts as string).findingCount, 1);
	});
});

test("semantic_audit_run updates checkpoint", async () => {
	await withTempDb((dbPath, repository) => {
		recordLabRun(dbPath, labRun("run-1"));

		runManualSemanticAudit({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "audit-1",
		});

		const checkpoint =
			repository.getSemanticAuditCheckpoint("pi-telegram-bridge");
		assert.equal(checkpoint.lastLabRunCount, 1);
		assert.ok(checkpoint.lastAuditAt);
	});
});

test("semantic_audit_run does not delete data", async () => {
	await withTempDb((dbPath, repository) => {
		recordLabRun(dbPath, labRun("run-1"));

		const before = repository.getSemanticAuditStats("pi-telegram-bridge");
		const result = runManualSemanticAudit({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "audit-1",
		});
		const after = repository.getSemanticAuditStats("pi-telegram-bridge");

		assert.equal(result.checkpointUpdated, true);
		assert.equal(after.labRunCount, before.labRunCount);
		assert.equal(queryRows(dbPath, "SELECT id FROM lab_runs;").length, 1);
		assert.match(formatSemanticAuditRunResult(result), /No usé IA/u);
	});
});
