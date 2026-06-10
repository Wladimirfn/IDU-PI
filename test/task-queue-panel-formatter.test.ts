import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatTaskQueueOptionLabel,
	formatTaskQueueRow,
	formatTareasYCola,
	paginateStructuredTaskQueue,
	renderTaskQueuePanel,
	summarizeTaskQueueOptionDetails,
	TASK_QUEUE_OPTION_DETAILS_MAX,
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

// --- New tests for paginated TUI panel and row summary -----------

// Test 7: summarizeTaskQueueOptionDetails returns the original text
// when it fits in maxLength (no truncation, no ellipsis).
test("summarizeTaskQueueOptionDetails returns the original text when it fits", () => {
	const task = makeTask({ text: "Short task description", originalText: "Short task description" });
	const summary = summarizeTaskQueueOptionDetails(task);
	assert.equal(summary, "Short task description");
	assert.ok(!summary.endsWith("..."), `summary should not end with "...", got: ${summary}`);
});

// Test 8: summarizeTaskQueueOptionDetails truncates the details to
// TASK_QUEUE_OPTION_DETAILS_MAX (80) chars and appends an ellipsis.
test("summarizeTaskQueueOptionDetails truncates the details to 80 chars with ellipsis", () => {
	const longDetails = "Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	assert.ok(longDetails.length > TASK_QUEUE_OPTION_DETAILS_MAX);
	const task = makeTask({ text: longDetails, originalText: longDetails });
	const summary = summarizeTaskQueueOptionDetails(task);
	assert.equal(
		summary.length,
		TASK_QUEUE_OPTION_DETAILS_MAX,
		`summary should be exactly ${TASK_QUEUE_OPTION_DETAILS_MAX} chars, got ${summary.length}: ${summary}`,
	);
	assert.ok(summary.endsWith("..."), `summary should end with "...", got: ${summary}`);
	// The non-ellipsis portion should be the first 77 chars of the
	// original (whitespace normalized) text.
	assert.equal(
		summary.slice(0, TASK_QUEUE_OPTION_DETAILS_MAX - 3),
		longDetails.slice(0, TASK_QUEUE_OPTION_DETAILS_MAX - 3),
	);
});

// Test 9: summarizeTaskQueueOptionDetails normalizes whitespace
// before measuring length.
test("summarizeTaskQueueOptionDetails normalizes whitespace before measuring length", () => {
	const task = makeTask({
		text: "a".repeat(40) + " " + "b".repeat(40),
		originalText: "a".repeat(40) + "\n\t  " + "b".repeat(40),
	});
	assert.equal(task.originalText!.length, 84);
	const summary = summarizeTaskQueueOptionDetails(task, { maxLength: 80 });
	assert.equal(summary.length, 80, `summary should be 80 chars, got ${summary.length}`);
	assert.ok(summary.endsWith("..."));
	assert.equal(
		summary.slice(0, 77),
		("a".repeat(40) + " " + "b".repeat(40)).slice(0, 77),
	);
});

// Test 10: formatTaskQueueOptionLabel includes the prefix, status,
// truncated id, and the details snippet.
test("formatTaskQueueOptionLabel includes the prefix, status, id and details", () => {
	const task = makeTask({
		id: "task-abcdef123456789",
		text: "Realizar x cosa en x lugar",
		status: "pending",
	});
	const label = formatTaskQueueOptionLabel(task, "approve");
	assert.match(label, /^✓ Aprobar {2}\[pending\] task-abcdef1 {2}Realizar x cosa en x lugar$/u);
});

test("formatTaskQueueOptionLabel prefixes view/approve/reject differently", () => {
	const task = makeTask({ id: "task-abcdef123456789", text: "do thing" });
	assert.match(formatTaskQueueOptionLabel(task, "view"), /^👁 Ver/u);
	assert.match(formatTaskQueueOptionLabel(task, "approve"), /^✓ Aprobar/u);
	assert.match(formatTaskQueueOptionLabel(task, "reject"), /^✗ Rechazar/u);
});

// Test 11: paginateStructuredTaskQueue returns 3 pages of 10/10/7
// tasks for a 27-task queue at page size 10.
test("paginateStructuredTaskQueue returns 3 pages of 10/10/7 tasks for a 27-task queue", () => {
	const tasks: StructuredTask[] = Array.from({ length: 27 }, (_, i) =>
		makeTask({ id: `task-0000${i.toString().padStart(4, "0")}abcdef` }),
	);

	const page0 = paginateStructuredTaskQueue(tasks, 0, 10);
	assert.equal(page0.page.pageCount, 3, `expected 3 pages, got ${page0.page.pageCount}`);
	assert.equal(page0.page.pageIndex, 0);
	assert.equal(page0.page.total, 27);
	assert.equal(page0.tasks.length, 10, `page 0 should have 10 tasks, got ${page0.tasks.length}`);

	const page1 = paginateStructuredTaskQueue(tasks, 1, 10);
	assert.equal(page1.page.pageIndex, 1);
	assert.equal(page1.tasks.length, 10, `page 1 should have 10 tasks, got ${page1.tasks.length}`);

	const page2 = paginateStructuredTaskQueue(tasks, 2, 10);
	assert.equal(page2.page.pageIndex, 2);
	assert.equal(page2.tasks.length, 7, `page 2 should have 7 tasks, got ${page2.tasks.length}`);

	// Out-of-range pageIndex is clamped to the last page.
	const page3 = paginateStructuredTaskQueue(tasks, 3, 10);
	assert.equal(page3.page.pageIndex, 2, `page 3 should be clamped to 2, got ${page3.page.pageIndex}`);
	assert.equal(page3.tasks.length, 7);

	// Negative pageIndex is clamped to 0.
	const pageNeg = paginateStructuredTaskQueue(tasks, -1, 10);
	assert.equal(pageNeg.page.pageIndex, 0);
	assert.equal(pageNeg.tasks.length, 10);
});

// Test 12: paginateStructuredTaskQueue handles edge cases.
test("paginateStructuredTaskQueue handles empty/single/exact-page-size queues", () => {
	// Empty queue still reports 1 page (the only page) with 0 tasks.
	const empty = paginateStructuredTaskQueue([], 0, 10);
	assert.equal(empty.page.pageCount, 1);
	assert.equal(empty.page.pageIndex, 0);
	assert.equal(empty.tasks.length, 0);

	// 1-task queue: 1 page, 1 task.
	const oneTask = paginateStructuredTaskQueue(
		[makeTask({ id: "task-only0000001a" })],
		0,
		10,
	);
	assert.equal(oneTask.page.pageCount, 1);
	assert.equal(oneTask.tasks.length, 1);

	// Exact page size (10 tasks): 1 page, all 10 tasks.
	const tenTasks = paginateStructuredTaskQueue(
		Array.from({ length: 10 }, (_, i) => makeTask({ id: `task-tttttttttttt${i}` })),
		0,
		10,
	);
	assert.equal(tenTasks.page.pageCount, 1);
	assert.equal(tenTasks.tasks.length, 10);

	// 11 tasks: 2 pages, second page has 1 task.
	const elevenFull = Array.from({ length: 11 }, (_, i) =>
		makeTask({ id: `task-eeeeeeeeeeee${i}` }),
	);
	const firstPage = paginateStructuredTaskQueue(elevenFull, 0, 10);
	assert.equal(firstPage.page.pageCount, 2);
	assert.equal(firstPage.tasks.length, 10);
	const secondPage = paginateStructuredTaskQueue(elevenFull, 1, 10);
	assert.equal(secondPage.tasks.length, 1, `page 1 should have 1 task, got ${secondPage.tasks.length}`);
});

// Test 13: renderTaskQueuePanel produces paginated options for a
// 27-task queue. Each task has 3 menu options (view/approve/reject)
// and the nav entries are present.
test("renderTaskQueuePanel paginates 27 tasks into 3 pages of 10/10/7", () => {
	const tasks: StructuredTask[] = Array.from({ length: 27 }, (_, i) =>
		makeTask({ id: `task-0000${i.toString().padStart(4, "0")}abcdef`, status: "pending" }),
	);

	const page0 = renderTaskQueuePanel({
		tasks,
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	const viewOptionsPage0 = page0.options.filter((o) => o.value.startsWith("view:"));
	const approveOptionsPage0 = page0.options.filter((o) => o.value.startsWith("approve:"));
	const rejectOptionsPage0 = page0.options.filter((o) => o.value.startsWith("reject:"));
	assert.equal(viewOptionsPage0.length, 10, `page 0 should have 10 view options`);
	assert.equal(approveOptionsPage0.length, 10);
	assert.equal(rejectOptionsPage0.length, 10);
	// Page 0 has Next but no Prev.
	assert.ok(page0.options.some((o) => o.value === "page:next"));
	assert.ok(!page0.options.some((o) => o.value === "page:prev"));
	assert.ok(page0.options.some((o) => o.value === "back"));

	const page1 = renderTaskQueuePanel({
		tasks,
		pageIndex: 1,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.equal(
		page1.options.filter((o) => o.value.startsWith("view:")).length,
		10,
		"page 1 should have 10 view options",
	);
	// Page 1 has both Prev and Next.
	assert.ok(page1.options.some((o) => o.value === "page:prev"));
	assert.ok(page1.options.some((o) => o.value === "page:next"));

	const page2 = renderTaskQueuePanel({
		tasks,
		pageIndex: 2,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.equal(
		page2.options.filter((o) => o.value.startsWith("view:")).length,
		7,
		"page 2 should have 7 view options",
	);
	// Page 2 has Prev but no Next.
	assert.ok(page2.options.some((o) => o.value === "page:prev"));
	assert.ok(!page2.options.some((o) => o.value === "page:next"));
});

// Test 14: renderTaskQueuePanel body content shows the multi-line
// detail for a viewed task (intent, details, dates) when viewedTaskId
// is set, and offers approve/reject for that specific task.
test("renderTaskQueuePanel body content shows the multi-line detail for a viewed task", () => {
	const task = makeTask({
		id: "task-abcdef123456789",
		text: "Realizar x cosa en x lugar",
		status: "pending",
		createdAt: "2026-06-10T10:00:00.000Z",
		guardStatus: "needs_confirmation",
		guardRisk: "high",
	});

	const render = renderTaskQueuePanel(
		{
			tasks: [task],
			pageIndex: 0,
			pageSize: 10,
			viewedTaskId: task.id,
		},
		{
			approveCommand: (id) => `idu-pi idu-queue-approve ${id}`,
			rejectCommand: (id) => `idu-pi idu-queue-reject ${id}`,
		},
	);

	// Body must contain the task's details, the id, and the
	// approve/reject commands (mirrors formatStructuredTaskQueueDetail).
	assert.match(render.content, new RegExp(task.id, "u"));
	assert.match(render.content, /Realizar x cosa en x lugar/u);
	assert.match(
		render.content,
		new RegExp(`idu-pi idu-queue-approve ${task.id}`, "u"),
	);
	assert.match(
		render.content,
		new RegExp(`idu-pi idu-queue-reject ${task.id}`, "u"),
	);

	// The menu options for view mode are approve/reject/back-to-list
	// for the viewed task only.
	assert.equal(render.options.length, 3);
	assert.equal(render.options[0].value, `approve:${task.id}`);
	assert.equal(render.options[1].value, `reject:${task.id}`);
	assert.equal(render.options[2].value, "back-to-list");
});

// Test 15: renderTaskQueuePanel falls back to the list view when
// the viewed task no longer exists.
test("renderTaskQueuePanel falls back to list view when viewed task is missing", () => {
	const task = makeTask({ id: "task-abcdef123456789" });
	const render = renderTaskQueuePanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: "task-missing0000xyz",
	});
	// Should fall back to list view (3 task options + nav).
	const viewOptions = render.options.filter((o) => o.value.startsWith("view:"));
	assert.equal(viewOptions.length, 1, `expected 1 view option after fallback, got ${viewOptions.length}`);
	assert.ok(render.options.some((o) => o.value === "back"));
});

