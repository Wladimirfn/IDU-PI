import assert from "node:assert/strict";
import { test } from "node:test";
import {
	decideAllowTaskCreation,
	type AllowTaskCreationInput,
} from "../src/allow-task-creation.js";

function base(): AllowTaskCreationInput {
	return {
		allowTaskCreation: true,
		isSelfRepairDomain: false,
		railTokensAvailable: true,
		emergencyCapReached: false,
		systemicBlock: false,
		taskTreeBlock: false,
		readinessBlock: false,
	};
}

test("Layer 1: normal task, no blocks → allow (layer1, reason=ok)", () => {
	const d = decideAllowTaskCreation(base());
	assert.deepEqual(d, { allow: true, reason: "ok", layer: "layer1" });
});

test("Layer 1: normal task + systemic block → block (layer1, reason=blocked)", () => {
	const d = decideAllowTaskCreation({ ...base(), systemicBlock: true });
	assert.deepEqual(d, {
		allow: false,
		reason: "blocked",
		layer: "layer1",
	});
});

test("Layer 1: normal task + task tree block → block", () => {
	const d = decideAllowTaskCreation({ ...base(), taskTreeBlock: true });
	assert.equal(d.allow, false);
	assert.equal(d.layer, "layer1");
});

test("Layer 1: normal task + readiness block → block", () => {
	const d = decideAllowTaskCreation({ ...base(), readinessBlock: true });
	assert.equal(d.allow, false);
	assert.equal(d.layer, "layer1");
});

test("Layer 1: user opt-out (allowTaskCreation=false) → block (reason=user_opt_out)", () => {
	const d = decideAllowTaskCreation({ ...base(), allowTaskCreation: false });
	assert.deepEqual(d, {
		allow: false,
		reason: "user_opt_out",
		layer: "layer1",
	});
});

test("Layer 2: self-repair + tokens available → bypass allow (layer2, reason=self_repair_bypass)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		systemicBlock: true,
		// This caller intends the bypass to fire, so it must pass the
		// Layer 2 gate inputs explicitly: a task-able systemic signal
		// and no protected-domain floor. The fail-closed defaults
		// (absent canCreateTask=false, absent protected=true) would
		// otherwise deny the bypass.
		anySystemicSignalCanCreateTask: true,
		anySystemicSignalProtected: false,
	});
	assert.deepEqual(d, {
		allow: true,
		reason: "self_repair_bypass",
		layer: "layer2",
	});
});

test("Layer 2: self-repair + NO tokens available → block (layer2, reason=no_rail_tokens)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: false,
		systemicBlock: true,
	});
	assert.deepEqual(d, {
		allow: false,
		reason: "no_rail_tokens",
		layer: "layer2",
	});
});

test("Layer 3: emergency cap reached → block (layer3, reason=emergency_cap_reached) regardless of self-repair", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		emergencyCapReached: true,
	});
	assert.deepEqual(d, {
		allow: false,
		reason: "emergency_cap_reached",
		layer: "layer3",
	});
});

test("Layer 3: emergency cap beats self-repair bypass", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		emergencyCapReached: true,
		systemicBlock: true,
		taskTreeBlock: true,
		readinessBlock: true,
	});
	assert.equal(d.allow, false);
	assert.equal(d.reason, "emergency_cap_reached");
	assert.equal(d.layer, "layer3");
});

test("Layer 2: self-repair + no blocks + tokens → still bypass (reason=self_repair_bypass)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		// This caller intends the bypass to fire, so it passes the
		// Layer 2 gate inputs explicitly (see the test above for why).
		anySystemicSignalCanCreateTask: true,
		anySystemicSignalProtected: false,
	});
	assert.equal(d.allow, true);
	assert.equal(d.reason, "self_repair_bypass");
	assert.equal(d.layer, "layer2");
});

// Layer 2 gate — named negative cases for each new gate input.
// The gate (decideAllowTaskCreation Layer 2) takes two optional inputs
// derived from the systemic signals: anySystemicSignalCanCreateTask and
// anySystemicSignalProtected. Each has a fail-closed default and a
// distinct deny reason. These three units pin BOTH the decision and the
// reason string so a change to the gate (e.g. weakening the protected
// floor) breaks a unit with a clear name instead of a distant
// integration test.

test("Layer 2 gate: self-repair + tokens + canCreateTask:true + protected:false → allow (self_repair_bypass)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		systemicBlock: true,
		anySystemicSignalCanCreateTask: true,
		anySystemicSignalProtected: false,
	});
	assert.equal(d.allow, true);
	assert.equal(d.reason, "self_repair_bypass");
	assert.equal(d.layer, "layer2");
});

test("Layer 2 gate: self-repair + tokens + canCreateTask:false + protected:false → deny (no_repairable_signal)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		systemicBlock: true,
		// No signal produces a concrete create_task (e.g. an unmapped
		// category like repeated_failure_patterns): the block is real but
		// nothing repairable can be queued, so the bypass must not fire.
		anySystemicSignalCanCreateTask: false,
		anySystemicSignalProtected: false,
	});
	assert.equal(d.allow, false);
	assert.equal(d.reason, "no_repairable_signal");
	assert.equal(d.layer, "layer2");
});

test("Layer 2 gate [SECURITY SHIELD]: self-repair + tokens + canCreateTask:true + protected:true → deny (protected_domain_floor)", () => {
	const d = decideAllowTaskCreation({
		...base(),
		isSelfRepairDomain: true,
		railTokensAvailable: true,
		systemicBlock: true,
		// A protected domain (security / db) is present: the bypass is
		// DENIED even though canCreateTask is true. This is the
		// protected-domain floor — intentionally redundant with the
		// task-ability test so that removing security/db protection
		// becomes a visible diff that breaks THIS named unit, not a
		// failure ten layers away in an integration test.
		anySystemicSignalCanCreateTask: true,
		anySystemicSignalProtected: true,
	});
	assert.equal(d.allow, false);
	assert.equal(d.reason, "protected_domain_floor");
	assert.equal(d.layer, "layer2");
});
