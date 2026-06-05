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

	assert.equal(report.version, 1);
	assert.equal(report.authority, "advisory");
	assert.equal(report.mode, "advisory_only");
	assert.equal(report.noWrites, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
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

	assert.equal(report.version, 1);
	assert.equal(report.mode, "advisory_only");
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
	confidence: number;
	evidenceRefs: string[];
	summary: string;
	recommendedActions: string[];
	bibliotecarioInputs?: string[];
	skillLearningInputs?: string[];
}): void {
	assert.equal(typeof signal.id, "string");
	assert.ok(signal.id.length > 0);
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
