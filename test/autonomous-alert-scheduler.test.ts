import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { updateAutonomousAlertControlState } from "../src/autonomous-alert-engine-state.js";
import {
	acquireAutonomousAlertSchedulerLock,
	readAutonomousAlertSchedulerState,
} from "../src/autonomous-alert-scheduler-state.js";
import {
	runAutonomousAlertScheduledTick,
	type AutonomousAlertScheduledTickInput,
} from "../src/autonomous-alert-scheduler.js";
import type { StructuredTask } from "../src/structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "../src/supervisor-self-maintenance-advisory.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-alert-executor-"));
}

function task(id: string, text = "bug context failure"): StructuredTask {
	return {
		id,
		text,
		category: "bug",
		priority: 3,
		status: "pending",
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		projectId: "idu-pi",
	};
}

function defaultInput(
	stateRoot: string,
	overrides: Partial<AutonomousAlertScheduledTickInput> = {},
): AutonomousAlertScheduledTickInput {
	return {
		projectId: "idu-pi",
		projectPath: "C:/repo",
		stateRoot,
		now: new Date("2026-06-05T00:00:00.000Z"),
		iduActive: true,
		loadPlan: () => ({
			status: "approved",
			inferredObjective: "Idu-pi supervises the orchestrator with evidence.",
			executiveSummary: "Supervisor/auditor summary",
			criticalRisks: [],
		}),
		loadTasks: () => [],
		loadSelfMaintenanceSignals: () => [],
		createTask: () => ({ id: "created-task" }),
		...overrides,
	};
}

test("scheduled executor skips when Idu-pi is inactive", () => {
	const stateRoot = tempRoot();
	let planLoads = 0;
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			iduActive: false,
			loadPlan: () => {
				planLoads += 1;
				return { status: "approved", inferredObjective: "objective" };
			},
		}),
	);
	assert.equal(result.status, "skipped_inactive");
	assert.equal(result.tasksCreated.length, 0);
	assert.equal(planLoads, 0);
});

test("scheduled executor skips when alert control is inactive", () => {
	const stateRoot = tempRoot();
	updateAutonomousAlertControlState(
		stateRoot,
		{ active: false, reason: "test-off" },
		new Date("2026-06-05T00:00:00.000Z"),
	);
	const result = runAutonomousAlertScheduledTick(defaultInput(stateRoot));
	assert.equal(result.status, "skipped_paused");
	assert.equal(result.report?.active, false);
	assert.equal(result.tasksCreated.length, 0);
});

test("scheduled executor skips when another owner holds the lock", () => {
	const stateRoot = tempRoot();
	acquireAutonomousAlertSchedulerLock(stateRoot, {
		ownerId: "other-owner",
		now: new Date("2026-06-05T00:00:00.000Z"),
		leaseMs: 60_000,
	});
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			ownerId: "scheduler-owner",
			now: new Date("2026-06-05T00:00:10.000Z"),
		}),
	);
	assert.equal(result.status, "skipped_locked");
	assert.equal(result.tasksCreated.length, 0);
});

test("scheduled executor blocks on unapproved objective before decisions", () => {
	const stateRoot = tempRoot();
	let tasksLoaded = 0;
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			loadPlan: () => ({ status: "draft", inferredObjective: "draft" }),
			loadTasks: () => {
				tasksLoaded += 1;
				return [task("t1"), task("t2"), task("t3"), task("t4")];
			},
		}),
	);
	assert.equal(result.status, "blocked_objective");
	assert.equal(tasksLoaded, 0);
	assert.equal(result.tasksCreated.length, 0);
	assert.equal(result.objective.blocked, true);
});

test("scheduled executor is read-only by default", () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			loadTasks: () => [task("t1"), task("t2"), task("t3"), task("t4")],
			createTask: () => {
				created += 1;
				return { id: "new-task" };
			},
		}),
	);
	assert.equal(result.status, "ran");
	assert.equal(result.allowTaskCreation, false);
	assert.equal(created, 0);
	assert.equal(result.tasksCreated.length, 0);
	assert.equal(result.report?.decisions[0]?.recommendedAction, "report_only");
});

test("scheduled executor creates capped routine tasks only when explicitly allowed", () => {
	const stateRoot = tempRoot();
	let created = 0;
	const signals: SupervisorSelfMaintenanceSignal[] = [1, 2, 3, 4].map(
		(index) => ({
			id: `backlog-${index}`,
			category: "backlog_pressure",
			severity: "warning",
			confidence: 0.8,
			evidenceRefs: [`evidence:${index}`],
			summary: `Backlog pressure ${index}`,
			recommendedActions: ["Create a bounded follow-up task."],
		}),
	);
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => signals,
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);
	assert.equal(result.status, "ran");
	assert.equal(result.allowTaskCreation, true);
	assert.equal(created, 3);
	assert.equal(result.tasksCreated.length, 3);
	const schedulerState = readAutonomousAlertSchedulerState(stateRoot);
	assert.equal(
		schedulerState.createdTaskIds["alert-backlog:backlog-1"],
		"created-1",
	);
});

test("scheduled executor does not create duplicates for already materialized decisions", () => {
	const stateRoot = tempRoot();
	const signal: SupervisorSelfMaintenanceSignal = {
		id: "backlog-1",
		category: "backlog_pressure",
		severity: "warning",
		confidence: 0.8,
		evidenceRefs: ["evidence:1"],
		summary: "Backlog pressure",
		recommendedActions: ["Create a bounded follow-up task."],
	};
	const first = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => [signal],
			createTask: () => ({ id: "created-1" }),
		}),
	);
	const second = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			allowTaskCreation: true,
			now: new Date("2026-06-05T00:10:00.000Z"),
			loadSelfMaintenanceSignals: () => [signal],
			createTask: () => ({ id: "created-2" }),
		}),
	);
	assert.equal(first.tasksCreated.length, 1);
	assert.equal(second.tasksCreated.length, 0);
	assert.equal(
		readAutonomousAlertSchedulerState(stateRoot).createdTaskIds[
			"alert-backlog:backlog-1"
		],
		"created-1",
	);
});

test("scheduled executor blocks routine creation when protected human escalations exist", () => {
	const stateRoot = tempRoot();
	let created = 0;
	const signals: SupervisorSelfMaintenanceSignal[] = [
		{
			id: "security-gap",
			category: "security_review_pressure",
			severity: "warning",
			confidence: 0.9,
			evidenceRefs: ["security:evidence"],
			summary: "Security review is stale.",
			recommendedActions: ["Ask human."],
		},
		{
			id: "backlog-1",
			category: "backlog_pressure",
			severity: "warning",
			confidence: 0.8,
			evidenceRefs: ["backlog:evidence"],
			summary: "Backlog pressure.",
			recommendedActions: ["Create bounded task."],
		},
	];
	const result = runAutonomousAlertScheduledTick(
		defaultInput(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => signals,
			createTask: () => {
				created += 1;
				return { id: "created" };
			},
		}),
	);
	assert.equal(result.status, "ran");
	assert.equal(created, 0);
	assert.equal(result.tasksCreated.length, 0);
	assert.equal(result.report?.humanEscalations[0]?.domain, "security");
});

test("scheduled alert core does not depend on Telegram entrypoint", () => {
	const source = readFileSync("src/autonomous-alert-scheduler.ts", "utf8");
	assert.doesNotMatch(source, /\.\/index\.js/u);
	assert.doesNotMatch(source, /Telegraf|telegram/iu);
});
