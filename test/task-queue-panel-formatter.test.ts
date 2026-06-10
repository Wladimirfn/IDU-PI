import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatActionQueueTable,
	formatColaViewTable,
	formatTaskListTable,
	formatTaskQueueOptionLabel,
	formatTaskQueueRow,
	formatTareasViewTable,
	formatTareasYCola,
	isActionableTask,
	paginateStructuredTaskQueue,
	renderColaViewPanel,
	renderTaskQueuePanel,
	renderTareasViewPanel,
	sortTasksByCreatedAtDesc,
	summarizeTaskQueueOptionDetails,
	summarizeTaskQueueRow,
	TASK_QUEUE_COLA_PAGE_SIZE,
	TASK_QUEUE_OPTION_DETAILS_MAX,
	TASK_QUEUE_TAREAS_PAGE_SIZE,
	TASK_QUEUE_TAREAS_SUMMARY_MAX,
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
	assert.ok(
		row.includes("task-abcdef1"),
		`row should contain truncated id "task-abcdef1", got: ${row}`,
	);
	assert.ok(
		row.includes("proposed"),
		`row should contain status "proposed", got: ${row}`,
	);
	assert.ok(
		row.includes("risky"),
		`row should contain guard "risky", got: ${row}`,
	);
	assert.ok(
		row.includes("P3"),
		`row should contain priority "P3", got: ${row}`,
	);
	assert.ok(
		row.includes("2h 13m"),
		`row should contain age "2h 13m", got: ${row}`,
	);
	assert.ok(
		row.includes("bug"),
		`row should contain category "bug", got: ${row}`,
	);
});

// Test 2: formatTaskQueueRow maps guardRisk to guard labels
test("formatTaskQueueRow maps guardRisk low to safe", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "low" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("safe"),
		`row should contain guard "safe", got: ${row}`,
	);
});

test("formatTaskQueueRow maps guardRisk medium to risky", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "medium" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("risky"),
		`row should contain guard "risky", got: ${row}`,
	);
});

test("formatTaskQueueRow maps guardRisk high to risky", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "high" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("risky"),
		`row should contain guard "risky", got: ${row}`,
	);
});

test("formatTaskQueueRow maps guardRisk blocker to blocking", () => {
	const task = makeTask({ guardStatus: "clear", guardRisk: "blocker" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("blocking"),
		`row should contain guard "blocking", got: ${row}`,
	);
});

test("formatTaskQueueRow maps no guardStatus to em-dash", () => {
	const task = makeTask({ guardStatus: undefined, guardRisk: undefined });
	const row = formatTaskQueueRow(task);
	assert.ok(row.includes("—"), `row should contain guard "—", got: ${row}`);
});

// Test 3: formatTaskQueueRow maps status to display labels
test("formatTaskQueueRow maps pending+needs_confirmation to paused", () => {
	const task = makeTask({
		status: "pending",
		guardStatus: "needs_confirmation",
	});
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("paused"),
		`row should contain status "paused", got: ${row}`,
	);
});

test("formatTaskQueueRow maps pending (no guard) to proposed", () => {
	const task = makeTask({ status: "pending", guardStatus: undefined });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("proposed"),
		`row should contain status "proposed", got: ${row}`,
	);
});

test("formatTaskQueueRow maps pending+approved to proposed", () => {
	const task = makeTask({ status: "pending", guardStatus: "approved" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("proposed"),
		`row should contain status "proposed", got: ${row}`,
	);
});

test("formatTaskQueueRow maps running to in_progress", () => {
	const task = makeTask({ status: "running" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("in_progress"),
		`row should contain status "in_progress", got: ${row}`,
	);
});

test("formatTaskQueueRow maps failed to blocked", () => {
	const task = makeTask({ status: "failed" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("blocked"),
		`row should contain status "blocked", got: ${row}`,
	);
});

test("formatTaskQueueRow maps done to done", () => {
	const task = makeTask({ status: "done" });
	const row = formatTaskQueueRow(task);
	assert.ok(
		row.includes("done"),
		`row should contain status "done", got: ${row}`,
	);
});

// Test 4: formatTaskQueueRow formats age correctly
test("formatTaskQueueRow formats age >24h as Nd Nh", () => {
	const now = new Date("2026-06-14T18:00:00.000Z");
	const task = makeTask({ createdAt: "2026-06-10T12:00:00.000Z" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(
		row.includes("4d 6h"),
		`row should contain age "4d 6h", got: ${row}`,
	);
});

test("formatTaskQueueRow formats age <24h as Nh Nm", () => {
	const now = new Date("2026-06-10T14:13:00.000Z");
	const task = makeTask({ createdAt: "2026-06-10T12:00:00.000Z" });
	const row = formatTaskQueueRow(task, { now: () => now });
	assert.ok(
		row.includes("2h 13m"),
		`row should contain age "2h 13m", got: ${row}`,
	);
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

	assert.equal(
		taskLines.length,
		3,
		`expected 3 task lines, got ${taskLines.length}`,
	);

	// Task 1: proposed/risky/P3/bug
	const task1Line = taskLines.find((line: string) =>
		line.includes("task-abc1234"),
	);
	assert.ok(task1Line, "task 1 line not found");
	assert.ok(
		task1Line.includes("proposed"),
		`task 1 should contain "proposed", got: ${task1Line}`,
	);
	assert.ok(
		task1Line.includes("risky"),
		`task 1 should contain "risky", got: ${task1Line}`,
	);
	assert.ok(
		task1Line.includes("P3"),
		`task 1 should contain "P3", got: ${task1Line}`,
	);
	assert.ok(
		task1Line.includes("bug"),
		`task 1 should contain "bug", got: ${task1Line}`,
	);

	// Task 2: paused/risky/P5/feature
	const task2Line = taskLines.find((line: string) =>
		line.includes("task-def6789"),
	);
	assert.ok(task2Line, "task 2 line not found");
	assert.ok(
		task2Line.includes("paused"),
		`task 2 should contain "paused", got: ${task2Line}`,
	);
	assert.ok(
		task2Line.includes("risky"),
		`task 2 should contain "risky", got: ${task2Line}`,
	);
	assert.ok(
		task2Line.includes("P5"),
		`task 2 should contain "P5", got: ${task2Line}`,
	);
	assert.ok(
		task2Line.includes("feature"),
		`task 2 should contain "feature", got: ${task2Line}`,
	);

	// Task 3: blocked/blocking/P0/maint
	const task3Line = taskLines.find((line: string) =>
		line.includes("task-ghi1111"),
	);
	assert.ok(task3Line, "task 3 line not found");
	assert.ok(
		task3Line.includes("blocked"),
		`task 3 should contain "blocked", got: ${task3Line}`,
	);
	assert.ok(
		task3Line.includes("blocking"),
		`task 3 should contain "blocking", got: ${task3Line}`,
	);
	assert.ok(
		task3Line.includes("P0"),
		`task 3 should contain "P0", got: ${task3Line}`,
	);
	assert.ok(
		task3Line.includes("maint"),
		`task 3 should contain "maint", got: ${task3Line}`,
	);
});

// --- New tests for paginated TUI panel and row summary -----------

// Test 7: summarizeTaskQueueOptionDetails returns the original text
// when it fits in maxLength (no truncation, no ellipsis).
test("summarizeTaskQueueOptionDetails returns the original text when it fits", () => {
	const task = makeTask({
		text: "Short task description",
		originalText: "Short task description",
	});
	const summary = summarizeTaskQueueOptionDetails(task);
	assert.equal(summary, "Short task description");
	assert.ok(
		!summary.endsWith("..."),
		`summary should not end with "...", got: ${summary}`,
	);
});

// Test 8: summarizeTaskQueueOptionDetails truncates the details to
// TASK_QUEUE_OPTION_DETAILS_MAX (80) chars and appends an ellipsis.
test("summarizeTaskQueueOptionDetails truncates the details to 80 chars with ellipsis", () => {
	const longDetails =
		"Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	assert.ok(longDetails.length > TASK_QUEUE_OPTION_DETAILS_MAX);
	const task = makeTask({ text: longDetails, originalText: longDetails });
	const summary = summarizeTaskQueueOptionDetails(task);
	assert.equal(
		summary.length,
		TASK_QUEUE_OPTION_DETAILS_MAX,
		`summary should be exactly ${TASK_QUEUE_OPTION_DETAILS_MAX} chars, got ${summary.length}: ${summary}`,
	);
	assert.ok(
		summary.endsWith("..."),
		`summary should end with "...", got: ${summary}`,
	);
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
	assert.equal(
		summary.length,
		80,
		`summary should be 80 chars, got ${summary.length}`,
	);
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
	assert.match(
		label,
		/^✓ Aprobar {2}\[pending\] task-abcdef1 {2}Realizar x cosa en x lugar$/u,
	);
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
	assert.equal(
		page0.page.pageCount,
		3,
		`expected 3 pages, got ${page0.page.pageCount}`,
	);
	assert.equal(page0.page.pageIndex, 0);
	assert.equal(page0.page.total, 27);
	assert.equal(
		page0.tasks.length,
		10,
		`page 0 should have 10 tasks, got ${page0.tasks.length}`,
	);

	const page1 = paginateStructuredTaskQueue(tasks, 1, 10);
	assert.equal(page1.page.pageIndex, 1);
	assert.equal(
		page1.tasks.length,
		10,
		`page 1 should have 10 tasks, got ${page1.tasks.length}`,
	);

	const page2 = paginateStructuredTaskQueue(tasks, 2, 10);
	assert.equal(page2.page.pageIndex, 2);
	assert.equal(
		page2.tasks.length,
		7,
		`page 2 should have 7 tasks, got ${page2.tasks.length}`,
	);

	// Out-of-range pageIndex is clamped to the last page.
	const page3 = paginateStructuredTaskQueue(tasks, 3, 10);
	assert.equal(
		page3.page.pageIndex,
		2,
		`page 3 should be clamped to 2, got ${page3.page.pageIndex}`,
	);
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
		Array.from({ length: 10 }, (_, i) =>
			makeTask({ id: `task-tttttttttttt${i}` }),
		),
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
	assert.equal(
		secondPage.tasks.length,
		1,
		`page 1 should have 1 task, got ${secondPage.tasks.length}`,
	);
});

// Test 13: renderTaskQueuePanel produces paginated options for a
// 27-task queue. Each task has 3 menu options (view/approve/reject)
// and the nav entries are present.
test("renderTaskQueuePanel paginates 27 tasks into 3 pages of 10/10/7", () => {
	const tasks: StructuredTask[] = Array.from({ length: 27 }, (_, i) =>
		makeTask({
			id: `task-0000${i.toString().padStart(4, "0")}abcdef`,
			status: "pending",
		}),
	);

	const page0 = renderTaskQueuePanel({
		tasks,
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	const viewOptionsPage0 = page0.options.filter((o) =>
		o.value.startsWith("view:"),
	);
	const approveOptionsPage0 = page0.options.filter((o) =>
		o.value.startsWith("approve:"),
	);
	const rejectOptionsPage0 = page0.options.filter((o) =>
		o.value.startsWith("reject:"),
	);
	assert.equal(
		viewOptionsPage0.length,
		10,
		`page 0 should have 10 view options`,
	);
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
	assert.equal(
		viewOptions.length,
		1,
		`expected 1 view option after fallback, got ${viewOptions.length}`,
	);
	assert.ok(render.options.some((o) => o.value === "back"));
});

// -----------------------------------------------------------------
// Tests for the B3 panel split: "Lista de tareas" (read-only) +
// "Cola de acciones" (actionable) sub-panels.
// -----------------------------------------------------------------

// Test 16: isActionableTask is true for the four actionable display
// statuses (proposed / paused / in_progress / blocked) and false for
// done (the existing structural status that maps to "done").
test("isActionableTask returns true for proposed, paused, in_progress, blocked", () => {
	// pending with no guard → proposed
	assert.equal(
		isActionableTask(makeTask({ status: "pending", guardStatus: undefined })),
		true,
	);
	// pending with needs_confirmation → paused
	assert.equal(
		isActionableTask(
			makeTask({ status: "pending", guardStatus: "needs_confirmation" }),
		),
		true,
	);
	// running → in_progress
	assert.equal(isActionableTask(makeTask({ status: "running" })), true);
	// failed → blocked
	assert.equal(isActionableTask(makeTask({ status: "failed" })), true);
});

test("isActionableTask returns false for done and skipped", () => {
	// done is excluded
	assert.equal(isActionableTask(makeTask({ status: "done" })), false);
	// skipped is excluded (forward-compat: future status "skipped")
	assert.equal(isActionableTask(makeTask({ status: "skipped" })), false);
});

// Test 17: summarizeTaskQueueRow returns short text verbatim and
// truncates to 80 chars with "..." for long text.
test("summarizeTaskQueueRow returns short text verbatim", () => {
	const task = makeTask({
		text: "Short task description",
		originalText: "Short task description",
	});
	assert.equal(summarizeTaskQueueRow(task), "Short task description");
});

test("summarizeTaskQueueRow truncates long details to 80 chars with ellipsis", () => {
	const long =
		"Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	assert.ok(long.length > TASK_QUEUE_OPTION_DETAILS_MAX);
	const task = makeTask({ text: long, originalText: long });
	const summary = summarizeTaskQueueRow(task);
	assert.equal(summary.length, TASK_QUEUE_OPTION_DETAILS_MAX);
	assert.ok(summary.endsWith("..."));
	assert.equal(
		summary.slice(0, TASK_QUEUE_OPTION_DETAILS_MAX - 3),
		long.slice(0, TASK_QUEUE_OPTION_DETAILS_MAX - 3),
	);
});

test("summarizeTaskQueueRow normalizes whitespace before measuring", () => {
	const task = makeTask({
		text: "a".repeat(40) + " " + "b".repeat(40),
		originalText: "a".repeat(40) + "\n\t  " + "b".repeat(40),
	});
	assert.equal(task.originalText!.length, 84);
	const summary = summarizeTaskQueueRow(task);
	assert.equal(summary.length, 80);
	assert.ok(summary.endsWith("..."));
});

// Test 18: formatTaskListTable renders ALL tasks (including done)
// with the "Lista de tareas" header and an extra summary column.
test("formatTaskListTable renders all tasks including done with a summary column", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const doneTask = makeTask({
		id: "task-done001x",
		text: "Closed task",
		status: "done",
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const activeTask = makeTask({
		id: "task-active001",
		text: "Active task",
		status: "pending",
		guardStatus: undefined,
		priority: 5,
		createdAt: "2026-06-10T10:00:00.000Z",
	});

	const output = formatTaskListTable([doneTask, activeTask], {
		now: () => now,
	});

	assert.match(output, /Lista de tareas \(2\)/u);
	// both tasks must be present, even though one is done
	assert.ok(output.includes("task-done001"));
	assert.ok(output.includes("task-active0"));
	// the done task line should still appear in the top sub-panel
	const doneLine = output
		.split("\n")
		.find((line: string) => line.includes("task-done001"));
	assert.ok(doneLine, "done task line should be present in Lista de tareas");
	assert.ok(doneLine.includes("done"), "done task line should contain 'done'");
	// summary column appended to each row
	assert.ok(
		output.includes("Closed task"),
		"summary column should include the done task's details",
	);
	assert.ok(
		output.includes("Active task"),
		"summary column should include the active task's details",
	);
});

test("formatTaskListTable returns an empty-state marker for zero tasks", () => {
	const output = formatTaskListTable([]);
	assert.match(output, /Lista de tareas \(0\)/u);
	assert.match(output, /sin tareas/u);
});

// Test 19: formatActionQueueTable shows only actionable tasks with
// the "Cola de acciones" header.
test("formatActionQueueTable renders actionable tasks with id|status|priority|summary", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const proposed = makeTask({
		id: "task-prop001a",
		text: "Proposed task",
		status: "pending",
		guardStatus: undefined,
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const paused = makeTask({
		id: "task-paus001b",
		text: "Paused task",
		status: "pending",
		guardStatus: "needs_confirmation",
		guardRisk: "high",
		priority: 5,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const done = makeTask({
		id: "task-done001x",
		text: "Done task",
		status: "done",
		priority: 2,
		createdAt: "2026-06-10T10:00:00.000Z",
	});

	const output = formatActionQueueTable([proposed, paused, done], {
		now: () => now,
	});

	assert.match(output, /Cola de acciones \(2\)/u);
	assert.ok(output.includes("task-prop001"));
	assert.ok(output.includes("task-paus001"));
	assert.ok(!output.includes("task-done001"));
	// proposed row should show proposed status
	const proposedLine = output
		.split("\n")
		.find((line: string) => line.includes("task-prop001"));
	assert.ok(proposedLine);
	assert.ok(proposedLine.includes("proposed"));
	assert.ok(proposedLine.includes("P3"));
	// paused row should show paused status
	const pausedLine = output
		.split("\n")
		.find((line: string) => line.includes("task-paus001"));
	assert.ok(pausedLine);
	assert.ok(pausedLine.includes("paused"));
	assert.ok(pausedLine.includes("P5"));
});

test("formatActionQueueTable returns an empty-state marker for zero actionable tasks", () => {
	const output = formatActionQueueTable([]);
	assert.match(output, /Cola de acciones \(0\)/u);
	assert.match(output, /sin acciones/u);
});

// Test 20: renderTaskQueuePanel body shows both "Lista de tareas"
// and "Cola de acciones" headers and a separator between them.
test("renderTaskQueuePanel body contains both Lista de tareas and Cola de acciones headers", () => {
	const task = makeTask({ id: "task-abcdef123456789" });
	const render = renderTaskQueuePanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});

	assert.match(render.content, /Lista de tareas/u);
	assert.match(render.content, /Cola de acciones/u);
});

// Test 21: renderTaskQueuePanel body shows ALL tasks (including
// done) in the top sub-panel, but menu options only for actionable.
test("renderTaskQueuePanel body shows done and skipped tasks but menu only has actionable options", () => {
	const doneTask = makeTask({
		id: "task-doneline0011",
		text: "Done task",
		status: "done",
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const skippedTask = makeTask({
		id: "task-skipline0022",
		text: "Skipped task",
		status: "skipped",
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const actionableTask = makeTask({
		id: "task-activeline33",
		text: "Actionable task",
		status: "pending",
		guardStatus: undefined,
		priority: 5,
		createdAt: "2026-06-10T10:00:00.000Z",
	});

	const render = renderTaskQueuePanel({
		tasks: [doneTask, skippedTask, actionableTask],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});

	// The body must show ALL three tasks in the top sub-panel.
	assert.ok(
		render.content.includes("task-donelin"),
		`body should show the done task, got: ${render.content}`,
	);
	assert.ok(
		render.content.includes("task-skiplin"),
		`body should show the skipped task, got: ${render.content}`,
	);
	assert.ok(
		render.content.includes("task-activel"),
		`body should show the actionable task, got: ${render.content}`,
	);

	// Menu options: only the actionable task should have view/approve/reject.
	const viewOptions = render.options.filter((o) => o.value.startsWith("view:"));
	const approveOptions = render.options.filter((o) =>
		o.value.startsWith("approve:"),
	);
	const rejectOptions = render.options.filter((o) =>
		o.value.startsWith("reject:"),
	);
	assert.equal(
		viewOptions.length,
		1,
		`expected 1 view option (actionable only), got ${viewOptions.length}`,
	);
	assert.equal(viewOptions[0].value, `view:${actionableTask.id}`);
	assert.equal(approveOptions.length, 1);
	assert.equal(approveOptions[0].value, `approve:${actionableTask.id}`);
	assert.equal(rejectOptions.length, 1);
	assert.equal(rejectOptions[0].value, `reject:${actionableTask.id}`);
});

// Test 22: renderTaskQueuePanel paginates the action sub-panel
// (27 actionable tasks → 3 pages of 10/10/7 options).
test("renderTaskQueuePanel paginates the action sub-panel into 3 pages of 10/10/7", () => {
	const tasks: StructuredTask[] = Array.from({ length: 27 }, (_, i) =>
		makeTask({
			id: `task-act0000${i.toString().padStart(4, "0")}aaa`,
			status: "pending",
			guardStatus: undefined,
		}),
	);

	const page0 = renderTaskQueuePanel({
		tasks,
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.equal(
		page0.options.filter((o) => o.value.startsWith("view:")).length,
		10,
		"page 0 should have 10 view options",
	);
	assert.ok(page0.options.some((o) => o.value === "page:next"));
	assert.ok(!page0.options.some((o) => o.value === "page:prev"));

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
	assert.ok(page2.options.some((o) => o.value === "page:prev"));
	assert.ok(!page2.options.some((o) => o.value === "page:next"));
});

// Test 23: renderTaskQueuePanel body shows the summary column for
// each task in the Lista de tareas sub-panel (first 80 chars of
// details, with ellipsis when truncated).
test("renderTaskQueuePanel body shows summary column truncated to 80 chars with ellipsis", () => {
	const longDetails =
		"Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	const task = makeTask({
		id: "task-abcdef123456789",
		text: longDetails,
		originalText: longDetails,
		status: "pending",
		guardStatus: undefined,
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});

	const render = renderTaskQueuePanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});

	// The summary should appear truncated with ellipsis in the
	// top sub-panel (Lista de tareas).
	assert.ok(
		render.content.includes("..."),
		`body should include an ellipsis for the truncated summary, got: ${render.content}`,
	);
	// First 77 chars of the long details should be present in the
	// body.
	const expected = longDetails.slice(0, TASK_QUEUE_OPTION_DETAILS_MAX - 3);
	assert.ok(
		render.content.includes(expected),
		`body should include the first 77 chars of the details, got: ${render.content}`,
	);
});

// Test 24: renderTaskQueuePanel body uses a separator between the
// two sub-panels.
test("renderTaskQueuePanel body uses a separator between the two sub-panels", () => {
	const task = makeTask({ id: "task-abcdef123456789" });
	const render = renderTaskQueuePanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	// The "Lista de tareas" section must appear before the
	// "Cola de acciones" section in the body.
	const listIdx = render.content.indexOf("Lista de tareas");
	const queueIdx = render.content.indexOf("Cola de acciones");
	assert.ok(listIdx >= 0, "body should contain 'Lista de tareas'");
	assert.ok(queueIdx >= 0, "body should contain 'Cola de acciones'");
	assert.ok(
		listIdx < queueIdx,
		`'Lista de tareas' should appear before 'Cola de acciones', got listIdx=${listIdx}, queueIdx=${queueIdx}`,
	);
});

// Test 25: renderTaskQueuePanel body still has the empty-state
// behaviour when the queue is completely empty.
test("renderTaskQueuePanel body shows the empty-state when no tasks exist", () => {
	const render = renderTaskQueuePanel({
		tasks: [],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.match(render.content, /no tasks in the queue/u);
	assert.ok(render.options.some((o) => o.value === "back"));
	assert.ok(render.options.some((o) => o.value === "exit"));
});

// Test 26: renderTaskQueuePanel body shows the Cola de acciones
// empty-state marker when there are tasks but none are actionable.
test("renderTaskQueuePanel body shows Cola de acciones empty marker when no actionable tasks", () => {
	const doneTask = makeTask({
		id: "task-done001x",
		text: "Done task",
		status: "done",
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const render = renderTaskQueuePanel({
		tasks: [doneTask],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.match(render.content, /Lista de tareas \(1\)/u);
	assert.match(render.content, /Cola de acciones \(0\)/u);
	// Menu should not have any task actions.
	const actionOptions = render.options.filter(
		(o) =>
			o.value.startsWith("view:") ||
			o.value.startsWith("approve:") ||
			o.value.startsWith("reject:"),
	);
	assert.equal(
		actionOptions.length,
		0,
		`expected 0 action options, got ${actionOptions.length}`,
	);
});

// -----------------------------------------------------------------
// Tests for the B4 panel split: Tareas (read-only) and Cola
// (actionable) as TWO separate home-menu entries, not stacked
// sub-panels in one entry.
// -----------------------------------------------------------------

// Test 27: sortTasksByCreatedAtDesc returns a copy sorted by
// createdAt DESC. Does not mutate the input.
test("sortTasksByCreatedAtDesc returns a copy sorted by createdAt DESC", () => {
	const tasks: StructuredTask[] = [
		makeTask({
			id: "task-aaa00000000001",
			createdAt: "2026-06-10T10:00:00.000Z",
		}),
		makeTask({
			id: "task-bbb00000000002",
			createdAt: "2026-06-10T12:00:00.000Z",
		}),
		makeTask({
			id: "task-ccc00000000003",
			createdAt: "2026-06-10T08:00:00.000Z",
		}),
	];
	const sorted = sortTasksByCreatedAtDesc(tasks);
	// Newest first.
	assert.equal(sorted[0].id, "task-bbb00000000002");
	assert.equal(sorted[1].id, "task-aaa00000000001");
	assert.equal(sorted[2].id, "task-ccc00000000003");
	// Input is not mutated.
	assert.equal(tasks[0].id, "task-aaa00000000001");
});

// Test 28: formatTareasViewTable sorts by createdAt DESC.
test("formatTareasViewTable sorts tasks by createdAt DESC (most recent first)", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const oldTask = makeTask({
		id: "task-old00000000001",
		text: "Old task",
		category: "bug",
		createdAt: "2026-06-08T10:00:00.000Z",
	});
	const newTask = makeTask({
		id: "task-new00000000002",
		text: "New task",
		category: "feature",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const midTask = makeTask({
		id: "task-mid00000000003",
		text: "Mid task",
		category: "maint",
		createdAt: "2026-06-09T10:00:00.000Z",
	});
	// Note: input order is intentionally NOT sorted.
	const output = formatTareasViewTable([oldTask, newTask, midTask], {
		now: () => now,
	});
	assert.match(output, /Tareas \(3\):/u);
	// Extract row order by id substring.
	const newIdx = output.indexOf("task-new000");
	const midIdx = output.indexOf("task-mid000");
	const oldIdx = output.indexOf("task-old000");
	assert.ok(newIdx >= 0, `expected new task id in output, got: ${output}`);
	assert.ok(midIdx >= 0, `expected mid task id in output, got: ${output}`);
	assert.ok(oldIdx >= 0, `expected old task id in output, got: ${output}`);
	assert.ok(
		newIdx < midIdx,
		`new should appear before mid, got newIdx=${newIdx} midIdx=${midIdx}`,
	);
	assert.ok(
		midIdx < oldIdx,
		`mid should appear before old, got midIdx=${midIdx} oldIdx=${oldIdx}`,
	);
});

// Test 29: formatTareasViewTable paginates 15 tasks per page.
test("formatTareasViewTable paginates 15 tasks per page", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const tasks: StructuredTask[] = Array.from({ length: 30 }, (_, i) =>
		makeTask({
			id: `task-tareas${i.toString().padStart(4, "0")}abc`,
			text: `Task ${i}`,
			createdAt: new Date(Date.parse("2026-06-10T00:00:00.000Z") + i * 1000)
				.toISOString(),
		}),
	);

	// Page 0: 15 tasks (the most recent 15, which are tasks 29..15).
	const page0 = formatTareasViewTable(tasks, {
		now: () => now,
		pageIndex: 0,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	assert.match(page0, /Tareas \(30\):/u);
	// Count task lines: each starts with a "task-tareas" id.
	const page0Lines = page0.split("\n").filter((line) =>
		line.startsWith("task-tareas"),
	);
	assert.equal(
		page0Lines.length,
		15,
		`page 0 should have 15 task rows, got ${page0Lines.length}`,
	);

	// Page 1: 15 tasks (the older 15, which are tasks 14..0).
	const page1 = formatTareasViewTable(tasks, {
		now: () => now,
		pageIndex: 1,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	const page1Lines = page1.split("\n").filter((line) =>
		line.startsWith("task-tareas"),
	);
	assert.equal(
		page1Lines.length,
		15,
		`page 1 should have 15 task rows, got ${page1Lines.length}`,
	);

	// Out-of-range pageIndex is clamped to the last page by
	// paginateStructuredTaskQueue, so page 2 returns the same
	// content as page 1 (15 rows).
	const page2 = formatTareasViewTable(tasks, {
		now: () => now,
		pageIndex: 2,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	const page2Lines = page2.split("\n").filter((line) =>
		line.startsWith("task-tareas"),
	);
	assert.equal(
		page2Lines.length,
		15,
		`page 2 (out-of-range) should clamp to the last page (15 rows), got ${page2Lines.length}`,
	);
});

// Test 30: formatTareasViewTable includes ALL tasks (no filter).
test("formatTareasViewTable includes ALL tasks (done, skipped, blocked all appear)", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const proposed = makeTask({
		id: "task-prop0000000001",
		text: "Proposed",
		status: "pending",
		guardStatus: undefined,
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const paused = makeTask({
		id: "task-paus0000000002",
		text: "Paused",
		status: "pending",
		guardStatus: "needs_confirmation",
		priority: 5,
		createdAt: "2026-06-09T10:00:00.000Z",
	});
	const blocked = makeTask({
		id: "task-block0000000003",
		text: "Blocked",
		status: "failed",
		priority: 0,
		createdAt: "2026-06-08T10:00:00.000Z",
	});
	const done = makeTask({
		id: "task-done0000000004",
		text: "Done",
		status: "done",
		priority: 2,
		createdAt: "2026-06-07T10:00:00.000Z",
	});
	const skipped = makeTask({
		id: "task-skip0000000005",
		text: "Skipped",
		status: "skipped",
		priority: 1,
		createdAt: "2026-06-06T10:00:00.000Z",
	});

	const output = formatTareasViewTable(
		[proposed, paused, blocked, done, skipped],
		{ now: () => now },
	);

	assert.match(output, /Tareas \(5\):/u);
	// All five tasks must appear in the body.
	assert.ok(output.includes("task-prop000"));
	assert.ok(output.includes("task-paus000"));
	assert.ok(output.includes("task-block00"));
	assert.ok(output.includes("task-done000"));
	assert.ok(output.includes("task-skip000"));
});

// Test 31: formatTareasViewTable uses 60-char summary with ellipsis.
test("formatTareasViewTable summary is truncated to 60 chars with ellipsis", () => {
	const long =
		"Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	assert.ok(long.length > TASK_QUEUE_TAREAS_SUMMARY_MAX);
	const task = makeTask({
		id: "task-long0000000001",
		text: long,
		originalText: long,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const output = formatTareasViewTable([task], {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
	});
	// The summary column appended to the row should be exactly 60
	// chars and end with "...".
	const expected = long.slice(0, TASK_QUEUE_TAREAS_SUMMARY_MAX - 3) + "...";
	assert.ok(
		output.includes(expected),
		`output should include 60-char truncated summary, got: ${output}`,
	);
	assert.equal(
		expected.length,
		TASK_QUEUE_TAREAS_SUMMARY_MAX,
		`truncated summary should be exactly ${TASK_QUEUE_TAREAS_SUMMARY_MAX} chars, got ${expected.length}`,
	);
});

// Test 32: formatTareasViewTable returns an empty-state marker.
test("formatTareasViewTable returns an empty-state marker for zero tasks", () => {
	const output = formatTareasViewTable([]);
	assert.match(output, /Tareas \(0\):/u);
	assert.match(output, /sin tareas/u);
});

// Test 33: formatColaViewTable filters out done and skipped.
test("formatColaViewTable filters out done and skipped tasks", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const proposed = makeTask({
		id: "task-prop0000000001",
		text: "Proposed",
		status: "pending",
		guardStatus: undefined,
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const paused = makeTask({
		id: "task-paus0000000002",
		text: "Paused",
		status: "pending",
		guardStatus: "needs_confirmation",
		priority: 5,
		createdAt: "2026-06-09T10:00:00.000Z",
	});
	const blocked = makeTask({
		id: "task-block0000000003",
		text: "Blocked",
		status: "failed",
		priority: 0,
		createdAt: "2026-06-08T10:00:00.000Z",
	});
	const done = makeTask({
		id: "task-done0000000004",
		text: "Done",
		status: "done",
		priority: 2,
		createdAt: "2026-06-07T10:00:00.000Z",
	});
	const skipped = makeTask({
		id: "task-skip0000000005",
		text: "Skipped",
		status: "skipped",
		priority: 1,
		createdAt: "2026-06-06T10:00:00.000Z",
	});

	const output = formatColaViewTable(
		[proposed, paused, blocked, done, skipped],
		{ now: () => now },
	);

	assert.match(output, /Cola de acciones \(3\):/u);
	assert.ok(output.includes("task-prop000"));
	assert.ok(output.includes("task-paus000"));
	assert.ok(output.includes("task-block00"));
	// done and skipped must be excluded.
	assert.ok(!output.includes("task-done000"));
	assert.ok(!output.includes("task-skip000"));
});

// Test 34: formatColaViewTable paginates 10 tasks per page.
test("formatColaViewTable paginates 10 actionable tasks per page", () => {
	const now = new Date("2026-06-10T12:00:00.000Z");
	const tasks: StructuredTask[] = Array.from({ length: 25 }, (_, i) =>
		makeTask({
			id: `task-cola${i.toString().padStart(4, "0")}abc`,
			text: `Task ${i}`,
			status: "pending",
			guardStatus: undefined,
			createdAt: new Date(Date.parse("2026-06-10T00:00:00.000Z") + i * 1000)
				.toISOString(),
		}),
	);

	// Page 0: 10 tasks.
	const page0 = formatColaViewTable(tasks, {
		now: () => now,
		pageIndex: 0,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
	});
	assert.match(page0, /Cola de acciones \(25\):/u);
	const page0Lines = page0.split("\n").filter((line) =>
		line.startsWith("task-cola"),
	);
	assert.equal(
		page0Lines.length,
		10,
		`page 0 should have 10 task rows, got ${page0Lines.length}`,
	);

	// Page 1: 10 tasks.
	const page1 = formatColaViewTable(tasks, {
		now: () => now,
		pageIndex: 1,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
	});
	const page1Lines = page1.split("\n").filter((line) =>
		line.startsWith("task-cola"),
	);
	assert.equal(
		page1Lines.length,
		10,
		`page 1 should have 10 task rows, got ${page1Lines.length}`,
	);

	// Page 2: 5 tasks.
	const page2 = formatColaViewTable(tasks, {
		now: () => now,
		pageIndex: 2,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
	});
	const page2Lines = page2.split("\n").filter((line) =>
		line.startsWith("task-cola"),
	);
	assert.equal(
		page2Lines.length,
		5,
		`page 2 should have 5 task rows, got ${page2Lines.length}`,
	);
});

// Test 35: formatColaViewTable returns empty-state when no actionable.
test("formatColaViewTable returns empty-state when no actionable tasks", () => {
	const done = makeTask({
		id: "task-done0000000001",
		text: "Done",
		status: "done",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const output = formatColaViewTable([done]);
	assert.match(output, /Cola de acciones \(0\):/u);
	assert.match(output, /sin acciones pendientes/u);
});

// Test 36: renderTareasViewPanel options are NAV ONLY (no per-task).
test("renderTareasViewPanel options are nav only (no per-task actions)", () => {
	const task = makeTask({
		id: "task-abcdef123456789",
		text: "Test task",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const render = renderTareasViewPanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 15,
	});

	// No view/approve/reject options at all (the panel is read-only).
	const taskOptions = render.options.filter(
		(o) =>
			o.value.startsWith("view:") ||
			o.value.startsWith("approve:") ||
			o.value.startsWith("reject:"),
	);
	assert.equal(
		taskOptions.length,
		0,
		`expected 0 task options (read-only panel), got ${taskOptions.length}`,
	);

	// Nav must include ← Anterior (only if page > 0) and Siguiente →
	// (only if more pages), then ← Volver and Exit.
	// With 1 task, no page nav, so options are just ← Volver + Exit.
	assert.equal(render.options.length, 2);
	assert.equal(render.options[0].value, "back");
	assert.equal(render.options[1].value, "exit");
});

// Test 37: renderTareasViewPanel with many tasks shows page nav.
test("renderTareasViewPanel with 45 tasks paginates 15/page and shows ← Anterior / Siguiente →", () => {
	const tasks: StructuredTask[] = Array.from({ length: 45 }, (_, i) =>
		makeTask({
			id: `task-tareas${i.toString().padStart(4, "0")}abc`,
			text: `Task ${i}`,
			createdAt: new Date(Date.parse("2026-06-10T00:00:00.000Z") + i * 1000)
				.toISOString(),
		}),
	);

	// Page 0: Siguiente → + ← Volver + Exit (no ← Anterior on page 0).
	const page0 = renderTareasViewPanel({
		tasks,
		pageIndex: 0,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	assert.ok(page0.options.some((o) => o.value === "page:next"));
	assert.ok(!page0.options.some((o) => o.value === "page:prev"));
	assert.ok(page0.options.some((o) => o.value === "back"));
	assert.ok(page0.options.some((o) => o.value === "exit"));

	// Page 1 (middle): ← Anterior + Siguiente → + ← Volver + Exit.
	const page1 = renderTareasViewPanel({
		tasks,
		pageIndex: 1,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	assert.ok(page1.options.some((o) => o.value === "page:prev"));
	assert.ok(page1.options.some((o) => o.value === "page:next"));
	assert.ok(page1.options.some((o) => o.value === "back"));
	assert.ok(page1.options.some((o) => o.value === "exit"));

	// Page 2 is the last page (45 / 15 = 3 pages): ← Anterior +
	// ← Volver + Exit (no Siguiente →).
	const page2 = renderTareasViewPanel({
		tasks,
		pageIndex: 2,
		pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
	});
	assert.ok(page2.options.some((o) => o.value === "page:prev"));
	assert.ok(!page2.options.some((o) => o.value === "page:next"));
	assert.ok(page2.options.some((o) => o.value === "back"));
	assert.ok(page2.options.some((o) => o.value === "exit"));

	// Body shows the header and at most 15 task rows on page 0.
	assert.match(page0.content, /Tareas \(45\):/u);
	const page0Rows = page0.content.split("\n").filter((line) =>
		line.startsWith("task-tareas"),
	);
	assert.equal(
		page0Rows.length,
		15,
		`page 0 body should have 15 task rows, got ${page0Rows.length}`,
	);
});

// Test 38: renderTareasViewPanel always has the Exit option, even
// with non-empty tasks. (Spec: "Only ← Anterior, Siguiente →,
// ← Volver, Exit" — Exit is always present.)
test("renderTareasViewPanel always has Exit option with non-empty tasks", () => {
	const tasks: StructuredTask[] = Array.from({ length: 45 }, (_, i) =>
		makeTask({
			id: `task-exit${i.toString().padStart(4, "0")}abc`,
			text: `Task ${i}`,
			createdAt: new Date(Date.parse("2026-06-10T00:00:00.000Z") + i * 1000)
				.toISOString(),
		}),
	);
	for (let p = 0; p < 3; p += 1) {
		const render = renderTareasViewPanel({
			tasks,
			pageIndex: p,
			pageSize: TASK_QUEUE_TAREAS_PAGE_SIZE,
		});
		assert.ok(
			render.options.some((o) => o.value === "exit"),
			`page ${p} should have Exit option, got: ${JSON.stringify(render.options)}`,
		);
	}
});

// Test 39: renderColaViewPanel generates 3 options per task.
test("renderColaViewPanel generates exactly 3 options per actionable task (👁 Ver, ✓ Aprobar, ✗ Rechazar)", () => {
	const tasks: StructuredTask[] = [
		makeTask({
			id: "task-aaa00000000001",
			text: "Task A",
			status: "pending",
			guardStatus: undefined,
			priority: 3,
			createdAt: "2026-06-10T10:00:00.000Z",
		}),
		makeTask({
			id: "task-bbb00000000002",
			text: "Task B",
			status: "pending",
			guardStatus: "needs_confirmation",
			priority: 5,
			createdAt: "2026-06-10T09:00:00.000Z",
		}),
		makeTask({
			id: "task-ccc00000000003",
			text: "Task C",
			status: "running",
			priority: 4,
			createdAt: "2026-06-10T08:00:00.000Z",
		}),
	];
	const render = renderColaViewPanel({
		tasks,
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});

	// 3 actionable tasks -> 9 task options (3 per task).
	const viewOptions = render.options.filter((o) =>
		o.value.startsWith("view:"),
	);
	const approveOptions = render.options.filter((o) =>
		o.value.startsWith("approve:"),
	);
	const rejectOptions = render.options.filter((o) =>
		o.value.startsWith("reject:"),
	);
	assert.equal(
		viewOptions.length,
		3,
		`expected 3 view options (one per task), got ${viewOptions.length}`,
	);
	assert.equal(approveOptions.length, 3);
	assert.equal(rejectOptions.length, 3);

	// Exactly 3 options per task, no repeated IDs.
	assert.deepEqual(
		viewOptions.map((o) => o.value).sort(),
		[
			"view:task-aaa00000000001",
			"view:task-bbb00000000002",
			"view:task-ccc00000000003",
		],
	);
	assert.deepEqual(
		approveOptions.map((o) => o.value).sort(),
		[
			"approve:task-aaa00000000001",
			"approve:task-bbb00000000002",
			"approve:task-ccc00000000003",
		],
	);
	assert.deepEqual(
		rejectOptions.map((o) => o.value).sort(),
		[
			"reject:task-aaa00000000001",
			"reject:task-bbb00000000002",
			"reject:task-ccc00000000003",
		],
	);

	// The 3 option labels for each task must include the canonical
	// emojis: 👁 Ver, ✓ Aprobar, ✗ Rechazar.
	for (const taskId of [
		"task-aaa00000000001",
		"task-bbb00000000002",
		"task-ccc00000000003",
	]) {
		const labels = render.options
			.filter((o) => o.value.endsWith(taskId))
			.map((o) => o.label);
		assert.ok(
			labels.some((l) => l.startsWith("👁 Ver")),
			`expected "👁 Ver" label for ${taskId}, got: ${labels.join(" | ")}`,
		);
		assert.ok(
			labels.some((l) => l.startsWith("✓ Aprobar")),
			`expected "✓ Aprobar" label for ${taskId}, got: ${labels.join(" | ")}`,
		);
		assert.ok(
			labels.some((l) => l.startsWith("✗ Rechazar")),
			`expected "✗ Rechazar" label for ${taskId}, got: ${labels.join(" | ")}`,
		);
	}
});

// Test 40: renderColaViewPanel options are only for actionable tasks.
test("renderColaViewPanel menu options only include actionable tasks (done and skipped excluded)", () => {
	const done = makeTask({
		id: "task-done0000000001",
		text: "Done",
		status: "done",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const skipped = makeTask({
		id: "task-skip0000000002",
		text: "Skipped",
		status: "skipped",
		createdAt: "2026-06-10T09:00:00.000Z",
	});
	const active = makeTask({
		id: "task-active0000000003",
		text: "Active",
		status: "pending",
		guardStatus: undefined,
		priority: 3,
		createdAt: "2026-06-10T08:00:00.000Z",
	});
	const render = renderColaViewPanel({
		tasks: [done, skipped, active],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});

	// Only the active task should have view/approve/reject options.
	const allTaskOptionIds = render.options
		.filter(
			(o) =>
				o.value.startsWith("view:") ||
				o.value.startsWith("approve:") ||
				o.value.startsWith("reject:"),
		)
		.map((o) => o.value.split(":")[1]);
	const uniqueIds = Array.from(new Set(allTaskOptionIds));
	assert.deepEqual(
		uniqueIds,
		[active.id],
		`expected only the active task id in menu, got: ${uniqueIds}`,
	);

	// The Cola body shows ONLY actionable tasks: the header count
	// is the actionable count (1), and done/skipped are excluded
	// from the body as well as the menu.
	assert.match(render.content, /Cola de acciones \(1\):/u);
	assert.ok(!render.content.includes("task-done000"));
	assert.ok(!render.content.includes("task-skip000"));
	assert.ok(render.content.includes("task-active"));
});

// Test 41: renderColaViewPanel paginates 10 actionable tasks/page.
test("renderColaViewPanel paginates 25 actionable tasks into 3 pages of 10/10/5", () => {
	const tasks: StructuredTask[] = Array.from({ length: 25 }, (_, i) =>
		makeTask({
			id: `task-cola${i.toString().padStart(4, "0")}abc`,
			text: `Task ${i}`,
			status: "pending",
			guardStatus: undefined,
			createdAt: new Date(Date.parse("2026-06-10T00:00:00.000Z") + i * 1000)
				.toISOString(),
		}),
	);

	// Page 0: 10 tasks = 30 task options.
	const page0 = renderColaViewPanel({
		tasks,
		pageIndex: 0,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
		viewedTaskId: undefined,
	});
	assert.equal(
		page0.options.filter((o) => o.value.startsWith("view:")).length,
		10,
		"page 0 should have 10 view options",
	);
	assert.ok(page0.options.some((o) => o.value === "page:next"));
	assert.ok(!page0.options.some((o) => o.value === "page:prev"));

	// Page 1: 10 tasks = 30 task options.
	const page1 = renderColaViewPanel({
		tasks,
		pageIndex: 1,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
		viewedTaskId: undefined,
	});
	assert.equal(
		page1.options.filter((o) => o.value.startsWith("view:")).length,
		10,
		"page 1 should have 10 view options",
	);
	assert.ok(page1.options.some((o) => o.value === "page:prev"));
	assert.ok(page1.options.some((o) => o.value === "page:next"));

	// Page 2: 5 tasks = 15 task options.
	const page2 = renderColaViewPanel({
		tasks,
		pageIndex: 2,
		pageSize: TASK_QUEUE_COLA_PAGE_SIZE,
		viewedTaskId: undefined,
	});
	assert.equal(
		page2.options.filter((o) => o.value.startsWith("view:")).length,
		5,
		"page 2 should have 5 view options",
	);
	assert.ok(page2.options.some((o) => o.value === "page:prev"));
	assert.ok(!page2.options.some((o) => o.value === "page:next"));
});

// Test 42: renderColaViewPanel body shows "Cola de acciones (N)"
// header, not the stacked B3 view.
test("renderColaViewPanel body shows the Cola de acciones (N) header", () => {
	const task = makeTask({
		id: "task-abcdef123456789",
		text: "Test",
		status: "pending",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const render = renderColaViewPanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 10,
		viewedTaskId: undefined,
	});
	assert.match(render.content, /Cola de acciones \(1\):/u);
	// Should NOT contain the B3 stacked headers.
	assert.doesNotMatch(render.content, /Lista de tareas/u);
	assert.doesNotMatch(render.content, /^─+$/u);
});

// Test 43: renderTareasViewPanel body shows the Tareas (N) header
// only, not the Cola header.
test("renderTareasViewPanel body shows the Tareas (N) header only", () => {
	const task = makeTask({
		id: "task-abcdef123456789",
		text: "Test",
		createdAt: "2026-06-10T10:00:00.000Z",
	});
	const render = renderTareasViewPanel({
		tasks: [task],
		pageIndex: 0,
		pageSize: 15,
	});
	assert.match(render.content, /Tareas \(1\):/u);
	assert.doesNotMatch(render.content, /Cola de acciones/u);
	assert.doesNotMatch(render.content, /Lista de tareas/u);
});
