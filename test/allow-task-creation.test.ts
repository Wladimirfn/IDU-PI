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
	});
	assert.equal(d.allow, true);
	assert.equal(d.reason, "self_repair_bypass");
	assert.equal(d.layer, "layer2");
});
