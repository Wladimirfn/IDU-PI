import assert from "node:assert/strict";
import { test } from "node:test";
import { planAutonomousAlertCron } from "../src/autonomous-alert-cron.js";
import type { AutonomousAlertControlState } from "../src/autonomous-alert-engine.js";

const activeControl: AutonomousAlertControlState = {
	version: 1,
	active: true,
	disabledDomains: [],
	updatedAt: "2026-06-05T00:00:00.000Z",
};

test("autonomous alert cron plan returns idle when Idu is inactive", () => {
	const plan = planAutonomousAlertCron({
		projectId: "idu-pi",
		iduActive: false,
		control: activeControl,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});

	assert.equal(plan.status, "idle");
	assert.equal(plan.allowTaskCreation, false);
	assert.equal(plan.advisoryOnly, true);
	assert.deepEqual(plan.proposedActions, [
		"Activate Idu-pi before scheduled alert ticks can run.",
	]);
});

test("autonomous alert cron plan returns paused when alert engine is paused", () => {
	const plan = planAutonomousAlertCron({
		projectId: "idu-pi",
		iduActive: true,
		control: {
			...activeControl,
			pausedUntil: "2026-06-06T00:00:00.000Z",
		},
		now: new Date("2026-06-05T00:00:00.000Z"),
	});

	assert.equal(plan.status, "paused");
	assert.equal(plan.reason, "alert_engine_paused");
	assert.equal(plan.allowTaskCreation, false);
	assert.match(plan.proposedActions.join("\n"), /resume/u);
});

test("autonomous alert cron plan would run with task creation disabled by default", () => {
	const plan = planAutonomousAlertCron({
		projectId: "idu-pi",
		iduActive: true,
		control: activeControl,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});

	assert.equal(plan.status, "would_run");
	assert.equal(plan.allowTaskCreation, false);
	assert.deepEqual(plan.nextToolCall, {
		tool: "idu_autonomous_alerts_tick",
		args: { allowTaskCreation: false },
	});
});

test("autonomous alert cron plan keeps explicit safety flags", () => {
	const plan = planAutonomousAlertCron({
		projectId: "idu-pi",
		iduActive: true,
		control: activeControl,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});

	assert.equal(plan.agentLabsAllowed, false);
	assert.equal(plan.dependenciesAllowed, false);
	assert.equal(plan.rulesAllowed, false);
	assert.equal(plan.skillsAllowed, false);
	assert.equal(plan.contractsAllowed, false);
	assert.equal(plan.rawHonesty, true);
	assert.ok(plan.uncomfortableTruths.length >= 1);
});
