import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import {
	recordBugFinding,
	recordLabRun,
	recordUserSignal,
} from "../src/lab-db.js";
import type { LabRunRecord } from "../src/lab-reports.js";
import type {
	SemanticAuditCheckpoint,
	SemanticAuditStats,
} from "../src/semantic-audit.js";
import {
	checkSemanticAuditTrigger,
	formatSemanticAuditTriggerResult,
	maybeRunSemanticAuditTrigger,
} from "../src/semantic-audit-trigger.js";

async function withTempDb(
	fn: (dbPath: string, repository: LabDbRepository) => void | Promise<void>,
) {
	const dir = mkdtempSync(join(tmpdir(), "semantic-audit-trigger-"));
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

function stats(
	overrides: Partial<SemanticAuditStats> = {},
): SemanticAuditStats {
	return {
		projectId: "pi-telegram-bridge",
		labRunCount: 0,
		findingCount: 0,
		proposalCount: 0,
		taskCount: 0,
		userSignalCount: 0,
		memoryItemCount: 0,
		criticalFindingCount: 0,
		highFindingCount: 0,
		...overrides,
	};
}

function checkpoint(): SemanticAuditCheckpoint {
	return {
		projectId: "pi-telegram-bridge",
		lastLabRunCount: 0,
		lastFindingCount: 0,
		lastProposalCount: 0,
		lastTaskCount: 0,
		lastUserSignalCount: 0,
		lastMemoryItemCount: 0,
		lastCriticalFindingCount: 0,
		lastHighFindingCount: 0,
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

function addUserSignals(dbPath: string, count: number): void {
	for (let index = 0; index < count; index += 1) {
		recordUserSignal(dbPath, {
			id: `signal-${index}`,
			projectId: "pi-telegram-bridge",
			source: "test",
			rawText: "urgente",
			detectedEmotion: "urgent",
			urgency: 5,
			confidence: "high",
			matchedKeywords: ["urgente"],
		});
	}
}

test("trigger skipped si no alcanza umbral", async () => {
	await withTempDb((dbPath, repository) => {
		addUserSignals(dbPath, 1);

		const result = maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
		});

		assert.equal(result.decision, "skipped");
		assert.equal(result.triggerReason, "not_enough_data");
		assert.equal(
			queryRows(dbPath, "SELECT id FROM semantic_audit_runs;").length,
			0,
		);
	});
});

test("trigger ejecuta si hay 100 eventos nuevos", async () => {
	await withTempDb((dbPath, repository) => {
		addUserSignals(dbPath, 100);

		const result = maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "trigger-100",
		});

		assert.equal(result.decision, "executed");
		assert.equal(result.triggerReason, "threshold_minor");
		assert.match(formatSemanticAuditTriggerResult(result), /executed/u);
	});
});

test("trigger ejecuta si hay 1000 eventos nuevos", () => {
	const decision = checkSemanticAuditTrigger({
		projectId: "pi-telegram-bridge",
		repository: {
			getSemanticAuditStats: () => stats({ userSignalCount: 1000 }),
			getSemanticAuditCheckpoint: checkpoint,
		},
	});

	assert.equal(decision.shouldRun, true);
	assert.equal(decision.triggerReason, "threshold_major");
});

test("trigger ejecuta si hay finding critical/high nuevo", async () => {
	await withTempDb((dbPath, repository) => {
		recordBugFinding(dbPath, {
			id: "finding-1",
			projectId: "pi-telegram-bridge",
			title: "High finding",
			description: "Needs deterministic audit.",
			severity: "high",
			confidence: "high",
		});

		const result = maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "trigger-high",
		});

		assert.equal(result.decision, "executed");
		assert.equal(result.triggerReason, "critical_findings");
	});
});

test("al ejecutar crea semantic_audit_run mode threshold", async () => {
	await withTempDb((dbPath, repository) => {
		addUserSignals(dbPath, 100);

		maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "trigger-mode",
		});

		const [row] = queryRows(
			dbPath,
			"SELECT mode, status, trigger_reason, scanned_counts FROM semantic_audit_runs WHERE id = 'trigger-mode';",
		);
		assert.equal(row.mode, "threshold");
		assert.equal(row.status, "completed");
		assert.equal(row.trigger_reason, "threshold_minor");
		assert.equal(JSON.parse(row.scanned_counts as string).userSignalCount, 100);
	});
});

test("al ejecutar actualiza checkpoint", async () => {
	await withTempDb((dbPath, repository) => {
		recordLabRun(dbPath, labRun("run-1"));
		addUserSignals(dbPath, 99);

		maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "trigger-checkpoint",
		});

		const checkpoint =
			repository.getSemanticAuditCheckpoint("pi-telegram-bridge");
		assert.equal(checkpoint.lastLabRunCount, 1);
		assert.equal(checkpoint.lastUserSignalCount, 99);
		assert.ok(checkpoint.lastAuditAt);
	});
});

test("si DB falla devuelve warning y no lanza excepción crítica", () => {
	const result = maybeRunSemanticAuditTrigger({
		projectId: "pi-telegram-bridge",
		repository: {
			getSemanticAuditStats: () => {
				throw new Error("db unavailable");
			},
			getSemanticAuditCheckpoint: () => {
				throw new Error("should not reach");
			},
			createSemanticAuditRun: () => {
				throw new Error("should not reach");
			},
			updateSemanticAuditCheckpoint: () => {
				throw new Error("should not reach");
			},
		},
	});

	assert.equal(result.decision, "warning");
	assert.match(result.warning ?? "", /db unavailable/u);
});

test("integración recordUserSignal es best-effort", async () => {
	const dir = mkdtempSync(
		join(tmpdir(), "semantic-audit-trigger-integration-"),
	);
	try {
		const dbPath = join(dir, "lab.db");
		const repository = new LabDbRepository(dbPath, {
			enableSemanticAuditTrigger: true,
			semanticAuditTriggerThresholds: { minorThreshold: 1 },
		});

		repository.recordUserSignal({
			id: "signal-1",
			projectId: "pi-telegram-bridge",
			source: "test",
			rawText: "urgente",
			detectedEmotion: "urgent",
			urgency: 5,
			confidence: "high",
			matchedKeywords: ["urgente"],
		});

		const [row] = queryRows(
			dbPath,
			"SELECT mode, status FROM semantic_audit_runs ORDER BY created_at DESC LIMIT 1;",
		);
		assert.equal(row.mode, "threshold");
		assert.equal(row.status, "completed");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("trigger no usa IA ni compacta", async () => {
	await withTempDb((dbPath, repository) => {
		addUserSignals(dbPath, 100);

		const result = maybeRunSemanticAuditTrigger({
			projectId: "pi-telegram-bridge",
			repository,
			idFactory: () => "trigger-safe",
		});

		const text = formatSemanticAuditTriggerResult(result);
		assert.doesNotMatch(text, /AgentLabs ejecutado/u);
		assert.match(text, /sin IA ni compactación/u);
		assert.equal(
			queryRows(dbPath, "SELECT id FROM user_signal_events;").length,
			100,
		);
	});
});
