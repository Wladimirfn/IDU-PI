import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSupervisorSelfMaintenanceAdvisory } from "../src/supervisor-self-maintenance-advisory.js";

const baseTask = {
	id: "task-1",
	text: "Bug task. postflight context.md repeated failure",
	category: "bug" as const,
	priority: 3,
	status: "pending" as const,
	createdAt: "2026-06-01T00:00:00.000Z",
	updatedAt: "2026-06-01T00:00:00.000Z",
};

test("self-maintenance advisory detects backlog and stale pressure", () => {
	const tasks = Array.from({ length: 21 }, (_, index) => ({
		...baseTask,
		id: `task-${index}`,
		status: index < 6 ? ("running" as const) : ("pending" as const),
	}));
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	assertTopLevelContract(report);
	assert.equal(report.generatedAt, "2026-06-05T00:00:00.000Z");
	assert.deepEqual(Object.keys(report.totals).sort(), [
		"agentLabStaleRequests",
		"failedTasks",
		"guardedTasks",
		"pendingTasks",
		"runningTasks",
		"semanticNewEvents",
		"staleTasks",
		"supervisorEvents",
		"usageFailures",
	]);
	assert.equal(report.totals.pendingTasks, 15);
	assert.equal(report.totals.runningTasks, 6);
	assert.equal(report.totals.failedTasks, 0);
	assert.equal(report.totals.staleTasks, 21);
	assert.equal(report.totals.guardedTasks, 0);
	assert.equal(report.totals.supervisorEvents, 0);
	assert.equal(report.totals.usageFailures, 0);
	assert.equal(report.totals.agentLabStaleRequests, 0);
	assert.equal(report.totals.semanticNewEvents, 0);
	assert.ok(report.recommendedActions.length > 0);
	assert.ok(
		report.signals.some((signal) => signal.category === "backlog_pressure"),
	);
	assert.ok(report.signals.some((signal) => signal.category === "stale_tasks"));
	for (const signal of report.signals) {
		assertSignalContract(signal);
	}
});

test("self-maintenance advisory counts guarded tasks in totals and backlog evidence", () => {
	const guardedStatuses = [
		"needs_confirmation" as const,
		"approved" as const,
		"rejected" as const,
		"clear" as const,
	];
	const tasks = Array.from({ length: 10 }, (_, index) => ({
		...baseTask,
		id: `guarded-${index}`,
		guardStatus: guardedStatuses[index],
	}));
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	assertTopLevelContract(report);
	assert.equal(report.totals.pendingTasks, 10);
	assert.equal(report.totals.guardedTasks, 3);
	const backlog = report.signals.find(
		(signal) => signal.category === "backlog_pressure",
	);
	assert.ok(backlog);
	assertSignalContract(backlog);
	assert.ok(
		backlog.evidenceRefs.some(
			(ref) => ref === "structured-task-queue:guarded=3",
		),
	);
	assert.ok(report.recommendedActions.length > 0);
});

test("self-maintenance advisory detects repeated failure without hiding safety", () => {
	const tasks = [
		{
			...baseTask,
			id: "bug-1",
			text: "Bug: postflight context.md unexpected delta",
			status: "done" as const,
		},
		{
			...baseTask,
			id: "bug-2",
			text: "Bug: postflight context.md needs_evidence repeated",
			status: "done" as const,
		},
		{
			...baseTask,
			id: "bug-3",
			text: "Bug: postflight local-only context.md",
			status: "pending" as const,
		},
	];
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	assertTopLevelContract(report);
	assert.equal(report.generatedAt, "2026-06-05T00:00:00.000Z");
	assert.equal(report.totals.guardedTasks, 0);
	assert.equal(report.totals.supervisorEvents, 0);
	assert.equal(report.totals.usageFailures, 0);
	assert.equal(report.totals.agentLabStaleRequests, 0);
	assert.equal(report.totals.semanticNewEvents, 0);
	assert.ok(report.recommendedActions.length > 0);
	const repeated = report.signals.find(
		(signal) => signal.category === "repeated_failure_patterns",
	);
	assert.ok(repeated);
	assertSignalContract(repeated);
	assert.ok(repeated.skillLearningInputs?.length);
	assert.ok(
		repeated.recommendedActions.some((action) =>
			/regression test/u.test(action),
		),
	);
});

test("self-maintenance advisory detects neglected areas conservatively", () => {
	const tasks = [
		{
			...baseTask,
			id: "telegram-1",
			text: "Design Telegram bridge parity",
			status: "done" as const,
		},
		{
			...baseTask,
			id: "telegram-2",
			text: "Implement Telegram reset command",
			status: "pending" as const,
		},
		{
			...baseTask,
			id: "telegram-3",
			text: "Review Telegram startup status",
			status: "pending" as const,
		},
	];
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	assertTopLevelContract(report);
	const neglected = report.signals.find(
		(signal) => signal.category === "neglected_areas",
	);
	assert.ok(neglected);
	assertSignalContract(neglected);
	assert.ok(
		neglected.bibliotecarioInputs?.some((input) => /telegram/u.test(input)),
	);
	assert.ok(
		neglected.evidenceRefs.some((ref) =>
			ref.includes("structured-task-queue:telegram=total:3,done:1"),
		),
	);
});

test("self-maintenance advisory includes semantic and usage inputs in totals and signals", () => {
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks: [],
		semanticNewEvents: 125,
		usageFailures: 3,
		agentLabStaleRequests: 4,
		supervisorEvents: 2,
	});

	assertTopLevelContract(report);
	assert.equal(report.totals.semanticNewEvents, 125);
	assert.equal(report.totals.usageFailures, 3);
	assert.equal(report.totals.agentLabStaleRequests, 4);
	assert.equal(report.totals.supervisorEvents, 2);
	assert.ok(
		report.signals.some(
			(signal) => signal.category === "semantic_audit_pressure",
		),
	);
	const repeated = report.signals.find(
		(signal) => signal.category === "repeated_failure_patterns",
	);
	assert.ok(repeated);
	assertSignalContract(repeated);
	assert.ok(repeated.evidenceRefs.some((ref) => ref.includes("usage-events")));
	assert.ok(
		repeated.evidenceRefs.some((ref) => ref.includes("agentlab-review")),
	);
});

test("self-maintenance advisory detects missing supervisor activity during pressure", () => {
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks: Array.from({ length: 10 }, (_, index) => ({
			...baseTask,
			id: `pending-${index}`,
		})),
		supervisorEvents: 0,
	});

	assertTopLevelContract(report);
	assert.equal(report.totals.supervisorEvents, 0);
	const activity = report.signals.find(
		(signal) => signal.category === "supervisor_activity_pressure",
	);
	assert.ok(activity);
	assertSignalContract(activity);
	assert.ok(
		activity.evidenceRefs.some((ref) => ref === "supervisor-activity:events=0"),
	);
});

function assertTopLevelContract(
	report: ReturnType<typeof buildSupervisorSelfMaintenanceAdvisory>,
): void {
	assert.equal(report.version, 1);
	assert.equal(report.authority, "advisory");
	assert.equal(report.mode, "advisory_only");
	assert.equal(report.projectId, "idu-pi");
	assert.equal(typeof report.generatedAt, "string");
	assert.equal(report.noWrites, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.ok(Array.isArray(report.safeNotes));
	assert.ok(report.safeNotes.length > 0);
}

function assertSignalContract(signal: {
	id: string;
	category:
		| "backlog_pressure"
		| "stale_tasks"
		| "repeated_failure_patterns"
		| "neglected_areas"
		| "learning_loop_pressure"
		| "semantic_audit_pressure"
		| "supervisor_activity_pressure";
	severity: "info" | "warning" | "high";
	confidence: number;
	evidenceRefs: string[];
	summary: string;
	recommendedActions: string[];
	bibliotecarioInputs?: string[];
	skillLearningInputs?: string[];
}): void {
	assert.equal(typeof signal.id, "string");
	assert.ok(signal.id.length > 0);
	assert.ok(["info", "warning", "high"].includes(signal.severity));
	assert.equal(typeof signal.confidence, "number");
	assert.ok(signal.confidence >= 0);
	assert.ok(signal.confidence <= 1);
	assert.ok(Array.isArray(signal.evidenceRefs));
	assert.ok(signal.evidenceRefs.length > 0);
	assert.equal(typeof signal.summary, "string");
	assert.ok(signal.summary.length > 0);
	assert.ok(signal.recommendedActions.length > 0);
	assert.equal("title" in signal, false);
	assert.equal("evidence" in signal, false);
}
