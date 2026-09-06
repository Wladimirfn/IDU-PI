import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	appendAutonomousAlertDecision,
	defaultAutonomousAlertControlState,
	readAutonomousAlertEngineState,
	resolveAutonomousAlertDecisionLogPath,
	resolveAutonomousAlertEngineStatePath,
	updateAutonomousAlertControlState,
} from "../src/autonomous-alert-engine-state.js";
import type { AutonomousAlertDecision } from "../src/autonomous-alert-engine.js";

test("alert engine state paths stay under stateRoot reports", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		assert.equal(
			resolveAutonomousAlertEngineStatePath(root),
			join(root, "reports", "autonomous-alert-engine-state.json"),
		);
		assert.equal(
			resolveAutonomousAlertDecisionLogPath(root),
			join(root, "reports", "autonomous-alert-decisions.jsonl"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("default state is active with no disabled domains", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const state = readAutonomousAlertEngineState(
			root,
			new Date("2026-06-05T00:00:00.000Z"),
		);
		assert.deepEqual(
			state.control,
			defaultAutonomousAlertControlState(new Date("2026-06-05T00:00:00.000Z")),
		);
		assert.deepEqual(state.cooldowns, {});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("control updates write only alert state", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const state = updateAutonomousAlertControlState(
			root,
			{ active: false, reason: "user stop" },
			new Date("2026-06-05T00:00:00.000Z"),
		);
		assert.equal(state.control.active, false);
		assert.equal(state.control.reason, "user stop");
		assert.equal(existsSync(resolveAutonomousAlertEngineStatePath(root)), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("append decision records jsonl and cooldown", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const decision: AutonomousAlertDecision = {
			version: 1,
			id: "alert-repeated_bug:telegram",
			generatedAt: "2026-06-05T00:00:00.000Z",
			projectId: "idu-pi",
			authority: "advisory",
			domain: "repeated_bug",
			severity: "warning",
			confidence: 0.9,
			evidenceRefs: ["structured-task:1"],
			rawHonesty: true,
			uncomfortableTruths: [],
			recommendedAction: "create_task",
			cooldownKey: "repeated_bug:telegram",
			requiresHuman: false,
			forbiddenActions: [],
		};
		const state = appendAutonomousAlertDecision(
			root,
			decision,
			new Date("2026-06-05T00:00:00.000Z"),
		);
		assert.equal(
			state.cooldowns["repeated_bug:telegram"],
			"2026-06-06T00:00:00.000Z",
		);
		const log = readFileSync(
			resolveAutonomousAlertDecisionLogPath(root),
			"utf8",
		);
		assert.match(log, /alert-repeated_bug:telegram/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
