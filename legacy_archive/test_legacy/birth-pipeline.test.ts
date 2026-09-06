import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBirthReadiness } from "../src/birth-pipeline.js";
import type { BirthProjectMode } from "../src/birth-pipeline.js";

const base: Parameters<typeof evaluateBirthReadiness>[0] = {
	mode: "new_project" as BirthProjectMode,
	projectId: "idu-pi",
	coreStatus: "confirmed",
	masterPlanTaskTreeStatus: "ready",
	constitutionStatus: "active",
	bibliotecarioStatus: "ideas_ready_for_orchestrator",
	prototypeStatus: "approved",
	generalSpecStatus: "approved",
	requestedWorkKind: "visual_product",
};

test("not_started reports next action idu_birth_intake", () => {
	const result = evaluateBirthReadiness({
		...base,
		coreStatus: "missing",
		masterPlanTaskTreeStatus: "missing_plan",
		constitutionStatus: "missing",
		bibliotecarioStatus: "local_sources_empty",
		prototypeStatus: "missing",
		generalSpecStatus: "missing",
	});
	assert.equal(result.state, "not_started");
	assert.equal(result.allowedToImplement, false);
	assert.equal(result.repoWritesAllowed, false);
	assert.equal(result.nextRequiredAction, "idu_birth_intake");
	assert.ok(result.blockingReasons.length > 0);
});

test("new_project without ProjectCoreStatus=confirmed blocks implementation", () => {
	const result = evaluateBirthReadiness({ ...base, coreStatus: "draft" });
	assert.equal(result.allowedToImplement, false);
	assert.ok(
		result.blockingReasons.some((r) => /Project Core/i.test(r)),
		"expected Project Core reason",
	);
});

test("existing_project scan approval is not enough to allow implementation", () => {
	const result = evaluateBirthReadiness({
		...base,
		mode: "existing_project",
		coreStatus: "draft",
	});
	assert.equal(result.allowedToImplement, false);
	assert.ok(result.blockingReasons.some((r) => /Project Core/i.test(r)));
});

test("MasterPlanTaskTreeStatus=plan_not_approved blocks birth readiness", () => {
	const result = evaluateBirthReadiness({
		...base,
		masterPlanTaskTreeStatus: "plan_not_approved",
	});
	assert.equal(result.allowedToImplement, false);
	assert.ok(result.blockingReasons.some((r) => /Master Plan/i.test(r)));
});

test("missing prototype blocks UI/product-visible implementation", () => {
	const result = evaluateBirthReadiness({
		...base,
		prototypeStatus: "missing",
		requestedWorkKind: "visual_product",
	});
	assert.equal(result.allowedToImplement, false);
	assert.ok(result.blockingReasons.some((r) => /Prototype/i.test(r)));
});

test("approved general spec enables normal implementation readiness", () => {
	const result = evaluateBirthReadiness(base);
	assert.equal(result.allowedToImplement, true);
	assert.equal(result.repoWritesAllowed, false);
	assert.equal(result.state, "implementation_ready");
	assert.equal(result.scopeLimit, "implementation_ready");
});

test("non_visual_maintenance exception requires narrowedScopeAccepted and keeps repoWritesAllowed=false", () => {
	const withoutAccept = evaluateBirthReadiness({
		...base,
		prototypeStatus: "missing",
		requestedWorkKind: "non_visual_maintenance",
	});
	assert.equal(withoutAccept.allowedToImplement, false);
	assert.equal(withoutAccept.repoWritesAllowed, false);

	const withAccept = evaluateBirthReadiness({
		...base,
		prototypeStatus: "missing",
		requestedWorkKind: "non_visual_maintenance",
		narrowedScopeAccepted: true,
	});
	assert.equal(withAccept.allowedToImplement, true);
	assert.equal(withAccept.repoWritesAllowed, false);
	assert.equal(withAccept.scopeLimit, "non_visual_maintenance_only");
});

test("non_visual_maintenance exception cannot mark general spec approved", () => {
	const result = evaluateBirthReadiness({
		...base,
		prototypeStatus: "missing",
		generalSpecStatus: "approved",
		requestedWorkKind: "non_visual_maintenance",
		narrowedScopeAccepted: true,
	});
	assert.equal(result.scopeLimit, "non_visual_maintenance_only");
	assert.notEqual(result.scopeLimit, "implementation_ready");
});

test("repo_ready requires explicit human repo approval", () => {
	const withoutApproval = evaluateBirthReadiness({
		...base,
		repoPlanStatus: "planned",
		repoHumanApproval: "pending",
	});
	assert.equal(withoutApproval.repoWritesAllowed, false);

	const withApproval = evaluateBirthReadiness({
		...base,
		repoPlanStatus: "approved",
		repoHumanApproval: "approved",
	});
	assert.equal(withApproval.repoWritesAllowed, true);
	assert.equal(withApproval.state, "repo_ready");
});
