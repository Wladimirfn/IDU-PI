/**
 * Regression test for the cron tick error
 * "Cannot read properties of undefined (reading 'toLowerCase')".
 *
 * Root cause: isFailureLike(task, text) did task.category.toLowerCase(),
 * which throws when the loaded task lacks a category (e.g. a partially
 * corrupted or incomplete JSON file in the stateRoot).
 *
 * Fix: task.category?.toLowerCase() (optional chaining).
 *
 * See: scripts/idu-supervisor-tick.ps1, which runs
 * `node dist/src/cli.js idu-automaticov1 cycle` every 15 min via
 * Windows Task Scheduler.
 *
 * This test invokes buildCliSelfMaintenanceReport with a stateRoot
 * pointing at a temporary location. The function internally reads
 * structured-task-queue.json and the supervisor activity log. If any
 * task in the queue has an undefined category, the function should
 * not throw.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildCliSelfMaintenanceReport } from "../src/cli.js";

function makeRuntime(stateRoot: string) {
	return {
		workspaceRoot: stateRoot,
		projectId: "is-failure-like-test",
		projectPath: stateRoot,
	} as unknown as Parameters<typeof buildCliSelfMaintenanceReport>[0];
}

test("buildCliSelfMaintenanceReport does not throw when queue contains a task without category (cron tick regression)", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "is-failure-like-test-"));
	// Write a malformed task file that lacks category. The supervisor
	// self-maintenance advisory must tolerate this (it used to throw
	// on every cron tick).
	const queueFile = join(stateRoot, "structured-task-queue.json");
	mkdirSync(stateRoot, { recursive: true });
	writeFileSync(
		queueFile,
		JSON.stringify(
			[
				{
					id: "task-bad",
					text: "category missing on purpose",
					title: "broken task",
					status: "failed",
					// category intentionally missing
					priority: "P3",
					createdAt: "2026-06-09T00:00:00.000Z",
					updatedAt: "2026-06-09T00:00:00.000Z",
				},
			],
			null,
			2,
		),
		"utf8",
	);

	const result = await buildCliSelfMaintenanceReport(
		makeRuntime(stateRoot),
		stateRoot,
	);
	assert.ok(
		result,
		"buildCliSelfMaintenanceReport should not throw on a task without category",
	);
});
