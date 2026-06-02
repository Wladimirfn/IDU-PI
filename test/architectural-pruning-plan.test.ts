import assert from "node:assert/strict";
import test from "node:test";
import { buildArchitecturalPruningPlan } from "../src/architectural-pruning-plan.js";

test("architectural pruning plan is advisory-only and non-destructive", () => {
	const plan = buildArchitecturalPruningPlan({
		projectId: "idu-pi",
		now: () => new Date("2026-06-02T00:00:00.000Z"),
	});

	assert.equal(plan.version, 1);
	assert.equal(plan.projectId, "idu-pi");
	assert.equal(plan.generatedAt, "2026-06-02T00:00:00.000Z");
	assert.equal(plan.mode, "advisory_only");
	assert.equal(plan.noDeletion, true);
	assert.equal(plan.noAutoApprove, true);
	assert.equal(plan.stateRootOnlyRuntimeWrites, true);
	assert.equal(plan.mcpAuthority, "advisory");
	assert.match(plan.warning, /Do not delete/u);
	assert.ok(plan.nonGoals.some((goal) => /Do not execute AgentLabs/u.test(goal)));
});

test("architectural pruning plan identifies bounded candidates", () => {
	const plan = buildArchitecturalPruningPlan({ projectId: "idu-pi" });

	assert.ok(plan.candidates.length >= 5);
	assert.ok(
		plan.candidates.some(
			(candidate) =>
				candidate.id === "prune-001" &&
				candidate.classification === "duplication" &&
				candidate.confidence === "high" &&
				candidate.files.includes("src/supervisor-improvement-decisions.ts"),
		),
	);
	assert.ok(
		plan.candidates.every((candidate) =>
			candidate.blockedBy.some((blocker) => /approval|review|tests/u.test(blocker)),
		),
	);
});
