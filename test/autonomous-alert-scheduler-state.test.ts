import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	acquireAutonomousAlertSchedulerLock,
	finishAutonomousAlertSchedulerRun,
	markAutonomousAlertDecisionTaskCreated,
	readAutonomousAlertSchedulerState,
	resolveAutonomousAlertSchedulerStatePath,
} from "../src/autonomous-alert-scheduler-state.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-alert-scheduler-"));
}

test("scheduler state path stays under stateRoot reports", () => {
	const root = tempRoot();
	assert.equal(
		resolveAutonomousAlertSchedulerStatePath(root),
		join(root, "reports", "autonomous-alert-scheduler-state.json"),
	);
});

test("scheduler lock skips second owner until lease expires", () => {
	const root = tempRoot();
	const first = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "one",
		now: new Date("2026-06-05T00:00:00.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(first.acquired, true);
	assert.equal(first.reason, "acquired");
	const second = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "two",
		now: new Date("2026-06-05T00:00:30.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(second.acquired, false);
	assert.equal(second.reason, "locked");
	const third = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "three",
		now: new Date("2026-06-05T00:02:00.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(third.acquired, true);
	assert.equal(third.state.lock?.ownerId, "three");
});

test("scheduler records decision to task idempotency under stateRoot reports", () => {
	const root = tempRoot();
	markAutonomousAlertDecisionTaskCreated(
		root,
		"decision-1",
		"task-1",
		new Date("2026-06-05T00:00:00.000Z"),
	);
	const state = readAutonomousAlertSchedulerState(root);
	assert.equal(state.createdTaskIds["decision-1"], "task-1");
	assert.equal(state.lastStatus, "task_created");
	const raw = readFileSync(
		resolveAutonomousAlertSchedulerStatePath(root),
		"utf8",
	);
	assert.match(raw, /decision-1/u);
});

test("finish run releases only its own lock", () => {
	const root = tempRoot();
	acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "owner-a",
		now: new Date("2026-06-05T00:00:00.000Z"),
		leaseMs: 60_000,
	});
	finishAutonomousAlertSchedulerRun(root, {
		ownerId: "owner-b",
		status: "wrong_owner",
		now: new Date("2026-06-05T00:00:10.000Z"),
	});
	assert.equal(
		readAutonomousAlertSchedulerState(root).lock?.ownerId,
		"owner-a",
	);
	finishAutonomousAlertSchedulerRun(root, {
		ownerId: "owner-a",
		status: "ran",
		now: new Date("2026-06-05T00:00:20.000Z"),
	});
	const state = readAutonomousAlertSchedulerState(root);
	assert.equal(state.lock, undefined);
	assert.equal(state.lastStatus, "ran");
	assert.equal(state.lastRunAt, "2026-06-05T00:00:20.000Z");
});

test("scheduler state module does not import Telegram entrypoint", () => {
	const source = readFileSync(
		"src/autonomous-alert-scheduler-state.ts",
		"utf8",
	);
	assert.doesNotMatch(source, /\.\/index\.js/u);
	assert.doesNotMatch(source, /Telegraf|telegram/iu);
});
