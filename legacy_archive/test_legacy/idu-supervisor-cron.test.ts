import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planIduSupervisorCron } from "../src/idu-supervisor-cron.js";
import type {
	SemanticAuditCheckpoint,
	SemanticAuditStats,
} from "../src/semantic-audit.js";
import { StructuredTaskQueue } from "../src/structured-task-queue.js";

function stats(patch: Partial<SemanticAuditStats> = {}): SemanticAuditStats {
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
		...patch,
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

function planWithDeps(input: { active?: boolean; stats?: SemanticAuditStats }) {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-cron-"));
	const calls = { auditRun: 0, checkpoint: 0 };
	try {
		const result = planIduSupervisorCron({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			trigger: "manual",
			options: {
				allowSemanticDraft: true,
				allowAgentTaskPlan: true,
				dryRun: false,
			},
			repository: {
				getSemanticAuditStats: () => input.stats ?? stats(),
				getSemanticAuditCheckpoint: () => checkpoint(),
				createSemanticAuditRun: () => {
					calls.auditRun += 1;
				},
				updateSemanticAuditCheckpoint: () => {
					calls.checkpoint += 1;
				},
			},
			queue: new StructuredTaskQueue({
				filePath: join(root, "reports", "tasks.jsonl"),
			}),
			isIduActive: () => input.active ?? true,
		});
		return { result, calls };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("cron plan returns idle when Idu-pi is inactive", () => {
	const { result, calls } = planWithDeps({ active: false });

	assert.equal(result.status, "skipped");
	assert.equal(result.classification, "idle");
	assert.equal(result.advisoryOnly, true);
	assert.equal(result.writesAllowed, false);
	assert.equal(calls.auditRun, 0);
	assert.equal(calls.checkpoint, 0);
});

test("cron plan classifies critical findings as urgent without writes", () => {
	const { result, calls } = planWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
	});

	assert.equal(result.status, "planned");
	assert.equal(result.classification, "urgent_review");
	assert.equal(result.loop.trigger, "cron_planning");
	assert.equal(result.loop.auditRunId, undefined);
	assert.equal(result.loop.semanticDraftPath, undefined);
	assert.equal(result.loop.createdTasks, 0);
	assert.ok(
		result.proposedActions.some((action) => /idu_supervisor_tick/u.test(action)),
	);
	assert.equal(calls.auditRun, 0);
	assert.equal(calls.checkpoint, 0);
});
