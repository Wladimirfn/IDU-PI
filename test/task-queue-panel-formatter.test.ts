import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatTaskQueueRow,
	formatTareasYCola,
	type StructuredTask,
} from "../src/structured-task-queue.js";

function makeTask(overrides: Partial<StructuredTask> = {}): StructuredTask {
	return {
		id: "task-abcdef123456789",
		text: "Test task",
		category: "bug",
		priority: 3,
		status: "pending",
		createdAt: "2026-06-10T10:00:00.000Z",
		updatedAt: "2026-06-10T10:00:00.000Z",
		...overrides,
	};
}

// Test 1: formatTaskQueueRow truncates id to 12 chars and renders six fields
test("formatTaskQueueRow truncates id to 12 chars and renders six fields", () => {
	const now = new Date("2026-06-10T12:13:00.000Z");
	const task = makeTask({
		id: "task-abcdef123456789",
		status: "pending",
		guardRisk: "medium",
		guardStatus: "approved",
		priority: 3,
		category: "bug",
		createdAt: "2026-06-10T10:00:00.000Z",
	});

	const row = formatTaskQueueRow(task, { now: () => now });

	// id truncated to 12 chars: "task-abcdef1"
	assert.ok(row.includes("task-abcdef1"), `row should contain truncated id "task-abcdef1", got: ${row}`);
	assert.ok(row.includes("proposed"), `row should contain status "proposed", got: ${row}`);
	assert.ok(row.includes("risky"), `row should contain guard "risky", got: ${row}`);
	assert.ok(row.includes("P3"), `row should contain priority "P3", got: ${row}`);
	assert.ok(row.includes("2h 13m"), `row should contain age "2h 13m", got: ${row}`);
	assert.ok(row.includes("bug"), `row should contain category "bug", got: ${row}`);
});

// Test 2: formatTaskQueueRow maps guardRisk to guard labels
test("formatTaskQueueRow maps guardRisk low to safe", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "low" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("safe"), `row should contain guard "safe", got: ${row}`);
});

test("formatTaskQueueRow maps guardRisk medium to risky", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "medium" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("risky"), `row should contain guard "risky", got: ${row}`);
});

test("formatTaskQueueRow maps guardRisk high to risky", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "high" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("risky"), `row should contain guard "risky", got: ${row}`);
});

test("formatTaskQueueRow maps guardRisk blocker to blocking", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "blocker" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("blocking"), `row should contain guard "blocking", got: ${row}`);
});

test("formatTaskQueueRow maps no guardStatus to em-dash", () => {
	const task = makeTask({ guardStatus: undefined, guardRisk: undefined });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("—"), `row should contain guard "—", got: ${row}`);
});

// Test 3: formatTaskQueueRow maps status to display labels
test("formatTaskQueueRow maps pending+needs_confirmation to paused", () => {
	const task = makeTask({ status: "pending", guardStatus: "needs_confirmation" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("paused"), `row should contain status "paused", got: ${row}`);
});

test("formatTaskQueueRow maps pending (no guard) to proposed", () => {
	const task = makeTask({ status: "pending", guardStatus: undefined });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("proposed"), `row should contain status "proposed", got: ${row}`);
});

test("formatTaskQueueRow maps pending+approved to proposed", () => {
	const task = makeTask({ status: "pending", guardStatus: "approved" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("proposed"), `row should contain status "proposed", got: ${row}`);
});

test("formatTaskQueueRow maps running to in_progress", () => {
	const task = makeTask({ status: "running" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("in_progress"), `row should contain status "in_progress", got: ${row}`);
});

test("formatTaskQueueRow maps failed to blocked", () => {
	const task = makeTask({ status: "failed" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("blocked"), `row should contain status "blocked", got: ${row}`);
});

test("formatTaskQueueRow maps done to done", () => {
	const task = makeTask({ status: "done" });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("done"), `row should contain status "done", got: ${row}`);
});

// Test 4: formatTaskQueueRow formats age correctly
test("formatTaskQueueRow formats age >24h as Nd Nh", () => {
	const now = new Date("2026-06-14T18:00:00.000Z");
	const task = makeTask({ createdAt: "2026-06-10T12:00:00.000Z" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(row.includes("4d 6h"), `row should contain age "4d 6h", got: ${row}`);
});

test("formatTaskQueueRow formats age <24h as Nh Nm", () => {
	const now = new Date("2026-06-10T14:13:00.000Z");
	const task = makeTask({ createdAt: "2026-06-10T12:00:00.000Z" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(row.includes("2h 13m"), `row should contain age "2h 13m", got: ${row}`);
});

test("formatTaskQueueRow formats unparseable createdAt as em-dash", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const task = makeTask({ createdAt: "not-a-date" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(row.includes("—"), `row should contain age "—", got: ${row}`);
});

test("formatTaskQueueRow formats negative diff (clock skew) as 0m", () => {
	const now = new Date("2026-06-10T09:00:00.000Z");
	const task = makeTask({ createdAt: "2026-06-10T10:00:00.000Z" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(row.includes("0m"), `row should contain age "0m", got: ${row}`);
});

// Test 5: formatTareasYCola returns "no tasks in the queue" for empty list
test("formatTareasYCola returns 'no tasks in the queue' for empty list", () => {
	const output = formatTareasYCola([]);
	assert.match(output, /no tasks in the queue/u);
});

// Test 6: formatTareasYCola renders mixed-state queue
test("formatTareasYCola renders mixed-state queue", () => {
	const now = new Date("2026-06-10T12:13:00.000Z");
	const tasks: StructuredTask[] = [
		makeTask({
			id: "task-abc123456789",
			status: "pending",
			guardStatus: "approved",
			guardRisk: "medium",
			priority: 3,
			category: "bug",
			createdAt: "2026-06-10T10:00:00.000Z",
		}),
		makeTask({
			id: "task-def678901234",
			status: "pending",
			guardStatus: "needs_confirmation",
			guardRisk: "medium",
			priority: 5,
			category: "feature",
			createdAt: "2026-06-06T06:13:00.000Z",
		}),
		makeTask({
			id: "task-ghi111111111",
			status: "failed",
			guardStatus: "clear",
			guardRisk: "blocker",
			priority: 0,
			category: "maint",
			createdAt: "2026-06-10T12:13:00.000Z",
		}),
	];

	const output = formatTareasYCola(tasks, { now: () => now });

	// Check header
	assert.match(output, /Tareas y cola \(3\)/u);

	// Check each row is present with correct fields
	const lines = output.split("\n");
	const taskLines = lines.filter((line: string) => line.includes("task-"));

	assert.equal(taskLines.length, 3, `expected 3 task lines, got ${taskLines.length}`);

	// Task 1: proposed/risky/P3/bug
	const task1Line = taskLines.find((line: string) => line.includes("task-abc1234"));
	assert.ok(task1Line, "task 1 line not found");
	assert.ok(task1Line.includes("proposed"), `task 1 should contain "proposed", got: ${task1Line}`);
	assert.ok(task1Line.includes("risky"), `task 1 should contain "risky", got: ${task1Line}`);
	assert.ok(task1Line.includes("P3"), `task 1 should contain "P3", got: ${task1Line}`);
	assert.ok(task1Line.includes("bug"), `task 1 should contain "bug", got: ${task1Line}`);

	// Task 2: paused/risky/P5/feature
	const task2Line = taskLines.find((line: string) => line.includes("task-def6789"));
	assert.ok(task2Line, "task 2 line not found");
	assert.ok(task2Line.includes("paused"), `task 2 should contain "paused", got: ${task2Line}`);
	assert.ok(task2Line.includes("risky"), `task 2 should contain "risky", got: ${task2Line}`);
	assert.ok(task2Line.includes("P5"), `task 2 should contain "P5", got: ${task2Line}`);
	assert.ok(task2Line.includes("feature"), `task 2 should contain "feature", got: ${task2Line}`);

	// Task 3: blocked/blocking/P0/maint
	const task3Line = taskLines.find((line: string) => line.includes("task-ghi1111"));
	assert.ok(task3Line, "task 3 line not found");
	assert.ok(task3Line.includes("blocked"), `task 3 should contain "blocked", got: ${task3Line}`);
	assert.ok(task3Line.includes("blocking"), `task 3 should contain "blocking", got: ${task3Line}`);
	assert.ok(task3Line.includes("P0"), `task 3 should contain "P0", got: ${task3Line}`);
	assert.ok(task3Line.includes("maint"), `task 3 should contain "maint", got: ${task3Line}`);
});
