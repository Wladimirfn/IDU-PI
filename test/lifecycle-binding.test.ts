import assert from "node:assert/strict";
import test from "node:test";
import {
	buildLifecycleBinding,
	validateLifecycleBinding,
} from "../src/lifecycle-binding.js";
import type { MasterPlanTaskTree } from "../src/master-plan-task-tree.js";

const readyTree: MasterPlanTaskTree = {
	version: 1,
	status: "ready",
	projectId: "idu-pi",
	objective: "Idu-pi supervises a living project loop.",
	blockingReasons: [],
	hitos: [
		{
			id: "hito-1",
			title: "Hito 1 — Bibliotecario Continuous Intelligence",
			goal: "Monitor sources and create flow-bound proposals.",
			tasks: [
				{
					id: "hito-1-task-1",
					hitoId: "hito-1",
					title: "Create flow-bound proposal generation",
					acceptanceCriteria: ["Proposals include flow and contract evidence."],
					subtasks: [],
				},
			],
		},
	],
};

test("lifecycle binding validates hito spec flow and contracts", () => {
	const binding = buildLifecycleBinding({
		taskTree: readyTree,
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "dependency-governance",
		contractIds: ["security", "agent"],
		evidenceRefs: ["plan:hito-1"],
	});

	assert.equal(binding.status, "bound");
	assert.deepEqual(binding.blockingReasons, []);
	assert.equal(binding.hitoId, "hito-1");
	assert.equal(binding.specId, "spec-flow-bound-proposals");
	assert.equal(binding.flowId, "dependency-governance");
});

test("lifecycle binding blocks when hito is missing", () => {
	const binding = buildLifecycleBinding({
		taskTree: readyTree,
		hitoId: "missing-hito",
		specId: "spec-flow-bound-proposals",
		flowId: "dependency-governance",
		contractIds: ["security"],
		evidenceRefs: ["plan:hito-1"],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(binding.blockingReasons.some((reason) => /hito/u.test(reason)));
});

test("lifecycle binding blocks empty flow and contract ids", () => {
	const binding = validateLifecycleBinding({
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "",
		contractIds: [],
		evidenceRefs: ["plan:hito-1"],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(binding.blockingReasons.some((reason) => /flowId/u.test(reason)));
	assert.ok(
		binding.blockingReasons.some((reason) => /contractIds/u.test(reason)),
	);
});

test("lifecycle binding blocks empty hito and spec ids", () => {
	const binding = validateLifecycleBinding({
		hitoId: " ",
		specId: "",
		flowId: "dependency-governance",
		contractIds: ["agent"],
		evidenceRefs: ["plan:hito-1"],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(binding.blockingReasons.some((reason) => /hitoId/u.test(reason)));
	assert.ok(binding.blockingReasons.some((reason) => /specId/u.test(reason)));
});

test("lifecycle binding trims and deduplicates contract ids", () => {
	const binding = validateLifecycleBinding({
		hitoId: " hito-1 ",
		specId: " spec-flow-bound-proposals ",
		flowId: " dependency-governance ",
		contractIds: [" security ", "agent", "security", " ", "agent"],
		evidenceRefs: [" plan:hito-1 ", "plan:hito-1", "review:1"],
	});

	assert.equal(binding.status, "bound");
	assert.equal(binding.hitoId, "hito-1");
	assert.equal(binding.specId, "spec-flow-bound-proposals");
	assert.equal(binding.flowId, "dependency-governance");
	assert.deepEqual(binding.contractIds, ["security", "agent"]);
	assert.deepEqual(binding.evidenceRefs, ["plan:hito-1", "review:1"]);
});

test("lifecycle binding blocks empty evidence refs", () => {
	const binding = validateLifecycleBinding({
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "dependency-governance",
		contractIds: ["agent"],
		evidenceRefs: [" ", ""],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(
		binding.blockingReasons.some((reason) => /evidenceRefs/u.test(reason)),
	);
});
