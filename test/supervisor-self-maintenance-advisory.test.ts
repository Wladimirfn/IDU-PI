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

	assert.equal(report.noWrites, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.totals.pendingTasks, 15);
	assert.equal(report.totals.runningTasks, 6);
	assert.ok(
		report.signals.some((signal) => signal.category === "backlog_pressure"),
	);
	assert.ok(report.signals.some((signal) => signal.category === "stale_tasks"));
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

	const repeated = report.signals.find(
		(signal) => signal.category === "repeated_failure_patterns",
	);
	assert.ok(repeated);
	assert.ok(repeated.skillLearningInputs?.length);
	assert.ok(
		repeated.recommendedActions.some((action) =>
			/regression test/u.test(action),
		),
	);
});
