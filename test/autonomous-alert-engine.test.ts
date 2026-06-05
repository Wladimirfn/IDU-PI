import assert from "node:assert/strict";
import { test } from "node:test";
import type { StructuredTask } from "../src/structured-task-queue.js";
import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertControlState,
} from "../src/autonomous-alert-engine.js";

function task(
	id: string,
	text: string,
	status: StructuredTask["status"] = "pending",
): StructuredTask {
	return {
		id,
		text,
		category: "bug",
		priority: 3,
		status,
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		projectId: "idu-pi",
	};
}

const activeControl: AutonomousAlertControlState = {
	version: 1,
	active: true,
	disabledDomains: [],
	updatedAt: "2026-06-05T00:00:00.000Z",
};

test("autonomous alert report includes raw honesty contract", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [],
		allowTaskCreation: false,
	});

	assert.equal(report.rawHonesty, true);
	assert.equal(report.noImplementation, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.contractsModified, false);
	assert.equal(report.dependenciesUpdated, false);
});

test("repeated bug threshold creates low risk task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "postflight context.md bug repeated"),
			task("bug-2", "postflight context.md bug repeated again"),
			task("bug-3", "postflight local-only bug regression"),
			task("bug-4", "postflight local-only bug keeps returning"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "create_task");
	assert.equal(decision.requiresHuman, false);
	assert.equal(decision.taskDraft?.guardRisk, "low");
	assert.match(decision.taskDraft?.text ?? "", /regression test/u);
	assert.ok(decision.uncomfortableTruths.length > 0);
});

test("security and db repeated bugs escalate to human without task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "security db auth bug repeated"),
			task("bug-2", "security db auth bug repeated again"),
			task("bug-3", "security db schema bug returned"),
			task("bug-4", "security db schema bug returned again"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "ask_human");
	assert.equal(decision.requiresHuman, true);
	assert.equal(decision.taskDraft, undefined);
});

test("cooldown suppresses duplicate task creation", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "telegram bug repeated"),
			task("bug-2", "telegram bug repeated"),
			task("bug-3", "telegram bug repeated"),
			task("bug-4", "telegram bug repeated"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
		cooldowns: {
			"repeated_bug:telegram": "2026-06-06T00:00:00.000Z",
		},
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "snooze");
	assert.equal(report.suppressedByCooldown.length, 1);
});
