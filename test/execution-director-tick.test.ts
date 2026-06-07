import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildExecutionDirectorTick } from "../src/execution-director-tick.js";
import type { MasterPlanTaskTree } from "../src/master-plan-task-tree.js";
import { ProposalOutboxStore } from "../src/proposal-outbox.js";

const taskTree: MasterPlanTaskTree = {
	version: 1,
	status: "ready",
	projectId: "idu-pi",
	objective: "Keep the project alive under the Master Plan.",
	blockingReasons: [],
	hitos: [
		{
			id: "hito-1",
			title: "Hito 1 — Continuous Supervisor Quality",
			goal: "Keep supervisor pressure actionable.",
			tasks: [],
		},
	],
};

test("execution director tick creates a flow-bound proposal from advisory pressure", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree,
		selfMaintenanceSignals: [
			{
				id: "learning-loop-pressure",
				category: "learning_loop_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:learning-mentions=7"],
				summary: "Learning loop has unresolved evidence pressure",
				recommendedActions: ["Convert repeated lessons into explicit tests."],
			},
		],
	});

	assert.equal(tick.version, 1);
	assert.equal(tick.authority, "advisory");
	assert.equal(tick.projectId, "idu-pi");
	assert.equal(tick.generatedAt, "2026-06-07T00:00:00.000Z");
	assert.equal(tick.status, "proposal_created");
	assert.deepEqual(tick.blockingReasons, []);
	assert.deepEqual(tick.evidenceRefs, [
		"structured-task-queue:learning-mentions=7",
	]);
	assert.ok(tick.safeNotes.some((note) => /advisory/u.test(note)));
	assert.equal(tick.proposals.length, 1);
	assert.equal(tick.proposals[0].projectId, "idu-pi");
	assert.equal(tick.proposals[0].hitoId, "hito-1");
	assert.equal(tick.proposals[0].specId, "spec-supervisor-learning-loop");
	assert.equal(tick.proposals[0].flowId, "supervisor-learning-loop");
	assert.deepEqual(tick.proposals[0].contractIds, ["agent"]);
	assert.equal(tick.proposals[0].sourceTrigger, "execution-director-tick");
	assert.equal(tick.proposals[0].sourceEngine, "supervisor");
	assert.equal(tick.proposals[0].risk, "low");
	assert.equal(tick.proposals[0].policyDecision, "auto");
	assert.equal(tick.proposals[0].recommendedAction, "create_task");
});

test("execution director tick blocks when task tree has no ready hito", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree: {
			...taskTree,
			status: "empty",
			hitos: [],
			blockingReasons: ["empty"],
		},
		selfMaintenanceSignals: [],
	});

	assert.equal(tick.status, "blocked_missing_lifecycle_binding");
	assert.equal(tick.proposals.length, 0);
	assert.ok(tick.blockingReasons.some((reason) => /hito/u.test(reason)));
});

test("execution director tick returns noop when no actionable signal exists", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree,
		selfMaintenanceSignals: [
			{
				id: "backlog-pressure",
				category: "backlog_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:open=10"],
				summary: "Backlog pressure exists",
				recommendedActions: ["Triage backlog."],
			},
		],
	});

	assert.equal(tick.status, "noop");
	assert.deepEqual(tick.proposals, []);
	assert.deepEqual(tick.blockingReasons, []);
});

test("execution director tick proposals can be persisted to proposal outbox", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree,
		selfMaintenanceSignals: [
			{
				id: "learning-loop-pressure",
				category: "learning_loop_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:learning-mentions=7"],
				summary: "Learning loop has unresolved evidence pressure",
				recommendedActions: ["Convert repeated lessons into explicit tests."],
			},
		],
	});
	const store = new ProposalOutboxStore({
		stateRoot: mkdtempSync(join(tmpdir(), "idu-tick-outbox-")),
	});
	const saved = tick.proposals.map((proposal) =>
		store.createProposal(proposal),
	);

	assert.equal(saved.length, 1);
	assert.equal(
		store.listProposals()[0]?.specId,
		"spec-supervisor-learning-loop",
	);
	assert.equal(store.listProposals()[0]?.flowId, "supervisor-learning-loop");
});
