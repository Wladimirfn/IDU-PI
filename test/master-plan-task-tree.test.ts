import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMasterPlanTaskTree } from "../src/master-plan-task-tree.js";

test("master plan task tree requires an approved plan", () => {
	const missing = buildMasterPlanTaskTree(undefined);
	assert.equal(missing.status, "missing_plan");
	assert.ok(missing.blockingReasons.length > 0);

	const draft = buildMasterPlanTaskTree({
		projectId: "demo",
		status: "draft",
		inferredObjective: "Build demo",
		workMilestones: [],
	});
	assert.equal(draft.status, "plan_not_approved");
	assert.ok(draft.blockingReasons.some((reason) => /approved/u.test(reason)));
});

test("master plan task tree expands hitos into tasks and subtasks", () => {
	const tree = buildMasterPlanTaskTree({
		projectId: "bitacora",
		status: "approved",
		inferredObjective: "Build maintenance log",
		workMilestones: [
			{
				name: "Hito 2 — MVP foundation",
				goal: "Deliver a usable maintenance log MVP",
				actions: ["Create intervention form", "List and edit interventions"],
				exitCriteria: [
					"npm test passes",
					"user can create a maintenance entry",
				],
			},
		],
	});

	assert.equal(tree.status, "ready");
	assert.equal(tree.projectId, "bitacora");
	assert.equal(tree.objective, "Build maintenance log");
	assert.equal(tree.hitos.length, 1);
	assert.equal(tree.hitos[0]?.tasks.length, 2);
	assert.equal(tree.hitos[0]?.tasks[0]?.subtasks.length, 3);
	assert.ok(
		tree.hitos[0]?.tasks[0]?.subtasks.some((subtask) =>
			/postflight/u.test(subtask.title),
		),
	);
});
