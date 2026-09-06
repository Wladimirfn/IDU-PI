import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	initLabDb,
	recordBugFinding,
	recordLabRun,
	recordUserSignal,
} from "../src/lab-db.js";
import type { LabRunRecord } from "../src/lab-reports.js";
import {
	createSemanticAuditRun,
	getSemanticAuditCheckpoint,
	getSemanticAuditStats,
	recordSemanticMemoryItem,
	shouldRunSemanticAudit,
	updateSemanticAuditCheckpoint,
} from "../src/semantic-audit.js";

async function withTempDb(fn: (dbPath: string) => void | Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "semantic-audit-"));
	try {
		await fn(join(dir, "lab.db"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function runSql(dbPath: string, sql: string): Array<Record<string, unknown>> {
	const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

function tableExists(dbPath: string, tableName: string): boolean {
	return (
		runSql(
			dbPath,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}';`,
		).length > 0
	);
}

function labRun(id: string): LabRunRecord {
	return {
		id,
		projectId: "demo",
		projectPath: "/demo",
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

function emptyCheckpoint() {
	return {
		projectId: "demo",
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

test("init DB creates semantic audit tables", async () => {
	await withTempDb((dbPath) => {
		initLabDb(dbPath);

		assert.equal(tableExists(dbPath, "semantic_audit_runs"), true);
		assert.equal(tableExists(dbPath, "semantic_audit_checkpoints"), true);
		assert.equal(tableExists(dbPath, "semantic_memory_items"), true);
	});
});

test("getSemanticAuditStats counts lab_runs", async () => {
	await withTempDb((dbPath) => {
		recordLabRun(dbPath, labRun("run-1"));
		recordLabRun(dbPath, labRun("run-2"));

		assert.equal(getSemanticAuditStats(dbPath, "demo").labRunCount, 2);
	});
});

test("getSemanticAuditStats counts bug_findings", async () => {
	await withTempDb((dbPath) => {
		recordBugFinding(dbPath, {
			id: "finding-1",
			projectId: "demo",
			title: "Bug",
			description: "Something failed",
			severity: "medium",
			confidence: "high",
		});

		assert.equal(getSemanticAuditStats(dbPath, "demo").findingCount, 1);
	});
});

test("getSemanticAuditStats counts proposals", async () => {
	await withTempDb((dbPath) => {
		recordBugFinding(dbPath, {
			id: "finding-1",
			projectId: "demo",
			title: "Bug",
			description: "Something failed",
			severity: "medium",
			confidence: "high",
		});
		runSql(
			dbPath,
			"INSERT INTO proposals (id, finding_id, proposal_type, summary) VALUES ('proposal-1', 'finding-1', 'fix', 'Fix it');",
		);

		assert.equal(getSemanticAuditStats(dbPath, "demo").proposalCount, 1);
	});
});

test("getSemanticAuditStats counts user_signal_events", async () => {
	await withTempDb((dbPath) => {
		recordUserSignal(dbPath, {
			id: "signal-1",
			projectId: "demo",
			source: "telegram",
			rawText: "urgente",
			detectedEmotion: "urgent",
			urgency: 5,
			confidence: "high",
			matchedKeywords: ["urgente"],
		});

		assert.equal(getSemanticAuditStats(dbPath, "demo").userSignalCount, 1);
	});
});

test("getSemanticAuditStats counts semantic_memory_items", async () => {
	await withTempDb((dbPath) => {
		recordSemanticMemoryItem(dbPath, {
			id: "memory-1",
			projectId: "demo",
			sourceType: "decision",
			importance: "high",
			title: "Keep TDD",
			summary: "Always run tests before completion.",
			tags: ["tests", "policy"],
		});

		assert.equal(getSemanticAuditStats(dbPath, "demo").memoryItemCount, 1);
	});
});

test("getSemanticAuditCheckpoint returns defaults when missing", async () => {
	await withTempDb((dbPath) => {
		const checkpoint = getSemanticAuditCheckpoint(dbPath, "demo");

		assert.deepEqual(checkpoint, {
			projectId: "demo",
			lastLabRunCount: 0,
			lastFindingCount: 0,
			lastProposalCount: 0,
			lastTaskCount: 0,
			lastUserSignalCount: 0,
			lastMemoryItemCount: 0,
			lastCriticalFindingCount: 0,
			lastHighFindingCount: 0,
		});
	});
});

test("shouldRunSemanticAudit false below threshold", () => {
	const decision = shouldRunSemanticAudit(
		{
			projectId: "demo",
			labRunCount: 1,
			findingCount: 2,
			proposalCount: 3,
			taskCount: 4,
			userSignalCount: 5,
			memoryItemCount: 6,
			criticalFindingCount: 0,
			highFindingCount: 0,
		},
		{
			projectId: "demo",
			lastLabRunCount: 1,
			lastFindingCount: 2,
			lastProposalCount: 3,
			lastTaskCount: 4,
			lastUserSignalCount: 5,
			lastMemoryItemCount: 5,
			lastCriticalFindingCount: 0,
			lastHighFindingCount: 0,
		},
	);

	assert.equal(decision.shouldRun, false);
});

test("shouldRunSemanticAudit true with 100 new events", () => {
	const decision = shouldRunSemanticAudit(
		{
			projectId: "demo",
			labRunCount: 100,
			findingCount: 0,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 0,
			highFindingCount: 0,
		},
		emptyCheckpoint(),
	);

	assert.equal(decision.shouldRun, true);
	assert.equal(decision.triggerReason, "threshold_minor");
});

test("shouldRunSemanticAudit true with 1000 new events", () => {
	const decision = shouldRunSemanticAudit(
		{
			projectId: "demo",
			labRunCount: 1000,
			findingCount: 0,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 0,
			highFindingCount: 0,
		},
		emptyCheckpoint(),
	);

	assert.equal(decision.shouldRun, true);
	assert.equal(decision.triggerReason, "threshold_major");
});

test("shouldRunSemanticAudit true with new critical or high finding", () => {
	const decision = shouldRunSemanticAudit(
		{
			projectId: "demo",
			labRunCount: 0,
			findingCount: 1,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 0,
			highFindingCount: 1,
		},
		emptyCheckpoint(),
	);

	assert.equal(decision.shouldRun, true);
	assert.equal(decision.triggerReason, "critical_findings");
});

test("shouldRunSemanticAudit ignores old critical when new finding is low", () => {
	const decision = shouldRunSemanticAudit(
		{
			projectId: "demo",
			labRunCount: 0,
			findingCount: 2,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 1,
			highFindingCount: 0,
		},
		{
			...emptyCheckpoint(),
			lastFindingCount: 1,
			lastCriticalFindingCount: 1,
		},
	);

	assert.equal(decision.shouldRun, false);
});

test("createSemanticAuditRun stores scanned_counts as JSON", async () => {
	await withTempDb((dbPath) => {
		createSemanticAuditRun(dbPath, {
			id: "audit-1",
			projectId: "demo",
			triggerReason: "threshold_minor",
			mode: "threshold",
			status: "completed",
			scannedCounts: { labRunCount: 3, findingCount: 2 },
			summary: "Reviewed events.",
		});

		const [row] = runSql(
			dbPath,
			"SELECT scanned_counts, summary FROM semantic_audit_runs WHERE id = 'audit-1';",
		);
		assert.deepEqual(JSON.parse(row.scanned_counts as string), {
			labRunCount: 3,
			findingCount: 2,
		});
		assert.equal(row.summary, "Reviewed events.");
	});
});

test("updateSemanticAuditCheckpoint updates counts", async () => {
	await withTempDb((dbPath) => {
		const stats = {
			projectId: "demo",
			labRunCount: 1,
			findingCount: 2,
			proposalCount: 3,
			taskCount: 4,
			userSignalCount: 5,
			memoryItemCount: 6,
			criticalFindingCount: 0,
			highFindingCount: 0,
		};

		updateSemanticAuditCheckpoint(dbPath, "demo", stats);

		assert.deepEqual(getSemanticAuditCheckpoint(dbPath, "demo"), {
			projectId: "demo",
			lastLabRunCount: 1,
			lastFindingCount: 2,
			lastProposalCount: 3,
			lastTaskCount: 4,
			lastUserSignalCount: 5,
			lastMemoryItemCount: 6,
			lastCriticalFindingCount: 0,
			lastHighFindingCount: 0,
			lastAuditAt: getSemanticAuditCheckpoint(dbPath, "demo").lastAuditAt,
		});
		assert.ok(getSemanticAuditCheckpoint(dbPath, "demo").lastAuditAt);
	});
});

test("recordSemanticMemoryItem stores tags as JSON array", async () => {
	await withTempDb((dbPath) => {
		recordSemanticMemoryItem(dbPath, {
			id: "memory-1",
			projectId: "demo",
			sourceType: "bugfix",
			sourceId: "finding-1",
			importance: "critical",
			title: "Auth gate",
			summary: "Auth changes require confirmation.",
			tags: ["auth", "gate"],
		});

		const [row] = runSql(
			dbPath,
			"SELECT tags FROM semantic_memory_items WHERE id = 'memory-1';",
		);
		assert.deepEqual(JSON.parse(row.tags as string), ["auth", "gate"]);
	});
});

test("semantic audit init is idempotent", async () => {
	await withTempDb((dbPath) => {
		assert.equal(initLabDb(dbPath).created, true);
		assert.equal(initLabDb(dbPath).created, false);
	});
});
