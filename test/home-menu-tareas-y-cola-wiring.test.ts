import assert from "node:assert/strict";
import { test } from "node:test";
import {
	runInteractiveHome,
	type TaskQueuePanelDispatchRuntime,
} from "../src/cli.js";
import {
	StructuredTaskQueue,
	formatTareasView,
	formatTareasYCola,
	type StructuredTask,
} from "../src/structured-task-queue.js";

type HomeShim = Parameters<typeof runInteractiveHome>[1];

function makeQueueWithTasks(
	tasks: Array<{ text: string; category: string; priority: number }>,
): StructuredTaskQueue {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	for (const task of tasks) {
		queue.enqueueTask({
			text: task.text,
			category: task.category,
			priority: task.priority,
		});
	}
	return queue;
}

function buildRuntimeFromQueue(
	queue: StructuredTaskQueue,
): TaskQueuePanelDispatchRuntime {
	return {
		queueApprove: (id) => {
			const task = queue.findByIdPrefix(id);
			return task ? { ...task, status: "done" } : undefined;
		},
		queueReject: (id) => {
			const task = queue.findByIdPrefix(id);
			return task ? { ...task, status: "failed" } : undefined;
		},
		listTasks: () => queue.listTasks(),
	};
}

// Wiring test 1: With a runtime that has 3 tasks in a real
// StructuredTaskQueue, the home menu's "tareas-view" case shows the
// tasks in the panel content. We drive runInteractiveHome with a
// shimmed selectMenu: first call returns "tareas-view" (the home
// menu choice), second call returns "back" (the panel's back). The
// shim captures the content passed to it. The content shown to the
// user in the panel must contain the 3 task IDs (truncated to 12
// chars by formatTaskQueueRow) and the count header. The body must
// NOT contain any per-task menu option labels (no "Ver / Aprobar /
// Rechazar") because the "Tareas" view is read-only.
test("home menu tareas-view case shows the 3 tasks read-only with no per-task options", async () => {
	const queue = makeQueueWithTasks([
		{ text: "Alpha task", category: "bug", priority: 3 },
		{ text: "Bravo task", category: "feature", priority: 5 },
		{ text: "Charlie task", category: "maint", priority: 0 },
	]);
	const runtime = buildRuntimeFromQueue(queue);
	const realTaskIds = queue.listTasks().map((t) => t.id);
	assert.equal(realTaskIds.length, 3);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		// 1: home menu → "tareas-view" (enter the panel).
		// 2: panel → "back" (leave the panel, return to home menu).
		// 3: home menu → "exit" (leave the home menu).
		if (callIndex === 1) return "tareas-view";
		if (callIndex === 2) return "back";
		return "exit";
	};

	const result = await runInteractiveHome(runtime, shim);
	assert.equal(result, "Salida sin cambios.");

	// The shim was called at least twice: once for the home menu (no
	// content), once for the panel (with the formatted task list).
	assert.ok(
		capturedContents.length >= 2,
		`expected at least 2 menu calls (home + panel), got ${capturedContents.length}`,
	);

	// The panel content must contain the 3 task IDs (truncated to 12
	// chars by formatTaskQueueRow) and the new read-only header.
	const panelContent = capturedContents[1];
	assert.ok(panelContent, "expected the panel to render content");
	assert.match(panelContent, /^Tareas \(3\)/mu);
	for (const id of realTaskIds) {
		assert.match(
			panelContent,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${panelContent}`,
		);
	}
	// Must NOT include the per-task action labels (those are
	// reserved for the legacy "Cola de acciones" actionable view;
	// the read-only Tareas view must show only nav options).
	assert.doesNotMatch(
		panelContent,
		/👁 Ver/u,
		`panel content should not contain view option labels, got: ${panelContent}`,
	);
	assert.doesNotMatch(
		panelContent,
		/✓ Aprobar/u,
		`panel content should not contain approve option labels, got: ${panelContent}`,
	);
	assert.doesNotMatch(
		panelContent,
		/✗ Rechazar/u,
		`panel content should not contain reject option labels, got: ${panelContent}`,
	);
	// Must not show the old placeholder message.
	assert.doesNotMatch(
		panelContent,
		/se entrega en un commit de seguimiento/u,
	);
});

// Wiring test 2: With an empty queue, the panel must show
// "Tareas (0)" / "sin tareas".
test("home menu tareas-view case shows the empty-state marker for an empty queue", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		if (callIndex === 1) return "tareas-view";
		if (callIndex === 2) return "back";
		return "exit";
	};

	const result = await runInteractiveHome(runtime, shim);
	assert.equal(result, "Salida sin cambios.");

	assert.ok(
		capturedContents.length >= 2,
		`expected at least 2 menu calls (home + panel), got ${capturedContents.length}`,
	);
	const panelContent = capturedContents[1];
	assert.ok(panelContent, "expected the panel to render content");
	assert.match(panelContent, /Tareas \(0\)/u);
	assert.match(panelContent, /sin tareas/u);
});

// Wiring test 3: The home menu's "cola-view" case shows the live
// feed of supervisor/agentlab/trigger activity. With a
// StructuredTaskQueue that has no supervisor activity, the panel
// must render the empty-state message but still flow correctly.
// Critically, the live feed MUST be wired with auto-refresh so it
// updates as new activity arrives while the user has the view open
// (the user explicitly said "this is refreshed or shown when I am
// with the cola view open at the moment").
test("home menu cola-view case renders the live feed with auto-refresh enabled", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedContents: Array<string | undefined> = [];
	const capturedTitles: Array<string | undefined> = [];
	const capturedSettings: Array<
		{ autoRefresh?: { intervalMs: number; getContent: () => string } } | undefined
	> = [];
	let callIndex = 0;
	const shim: HomeShim = async (
		title,
		_options,
		_status,
		content,
		settings,
	) => {
		capturedTitles.push(title);
		capturedContents.push(content);
		capturedSettings.push(settings);
		callIndex += 1;
		// 1: home menu → "cola-view" (enter the live feed).
		// 2: live feed → "back" (return to home menu).
		// 3: home menu → "exit".
		if (callIndex === 1) return "cola-view";
		if (callIndex === 2) return "back";
		return "exit";
	};

	const result = await runInteractiveHome(runtime, shim);
	assert.equal(result, "Salida sin cambios.");

	assert.ok(
		capturedContents.length >= 2,
		`expected at least 2 menu calls (home + live feed), got ${capturedContents.length}`,
	);
	const feedContent = capturedContents[1];
	assert.ok(feedContent, "expected the live feed to render content");
	// Title must be the live-feed title.
	assert.equal(capturedTitles[1], "Cola de acciones");
	// The feed body is either the empty-state marker or the
	// "Cola de acciones (N):" header. Both are valid depending on
	// whether the project has any recorded activity.
	assert.match(
		feedContent!,
		/Cola de acciones/u,
		`feed content should mention "Cola de acciones", got: ${feedContent}`,
	);
	// The live feed must NEVER carry per-task action labels.
	assert.doesNotMatch(
		feedContent!,
		/👁 Ver/u,
		`live feed should not contain view option labels, got: ${feedContent}`,
	);
	assert.doesNotMatch(
		feedContent!,
		/✓ Aprobar/u,
		`live feed should not contain approve option labels, got: ${feedContent}`,
	);
	assert.doesNotMatch(
		feedContent!,
		/✗ Rechazar/u,
		`live feed should not contain reject option labels, got: ${feedContent}`,
	);
	// Auto-refresh: the live feed MUST be wired with autoRefresh
	// so it can update on its own while the view is open. The
	// existing selectMenu pattern (see src/cli.ts:4838-4848) drives
	// a timer that re-renders the body every `intervalMs`.
	const settings = capturedSettings[1];
	assert.ok(
		settings?.autoRefresh,
		`live feed must be wired with autoRefresh, got settings=${JSON.stringify(settings)}`,
	);
	assert.equal(
		settings?.autoRefresh?.intervalMs,
		5000,
		`auto-refresh interval must be 5000ms (5s), got ${settings?.autoRefresh?.intervalMs}`,
	);
	assert.equal(
		typeof settings?.autoRefresh?.getContent,
		"function",
		`auto-refresh getContent must be a function`,
	);
});

// Wiring test 4: Sanity check that formatTareasView renders a
// task row with the truncated id (12 chars) so the assertions in
// the wiring tests above are stable. Uses a fake task with a known
// id so we can assert on the exact substring.
test("formatTareasView renders the truncated id and count header for a 1-task queue", () => {
	const tasks: StructuredTask[] = [
		{
			id: "task-alpha1234",
			text: "Alpha",
			category: "bug",
			priority: 3,
			status: "pending",
			createdAt: "2026-06-10T10:00:00.000Z",
			updatedAt: "2026-06-10T10:00:00.000Z",
		},
	];
	const content = formatTareasView(tasks, { now: () => new Date() });
	// id "task-alpha1234" (14 chars) truncates to "task-alpha12" (12 chars).
	assert.match(content, /task-alpha12/u);
	assert.match(content, /^Tareas \(1\)/mu);
	assert.match(content, /bug/u);
	assert.match(content, /P3/u);
});

// Wiring test 5: Sanity check that formatTareasYCola (the legacy
// helper) still renders the truncated id and the
// "Tareas y cola (N)" header for the CLI queue-detail surface.
test("formatTareasYCola renders the truncated id and count header for a 1-task queue", () => {
	const tasks: StructuredTask[] = [
		{
			id: "task-alpha1234",
			text: "Alpha",
			category: "bug",
			priority: 3,
			status: "pending",
			createdAt: "2026-06-10T10:00:00.000Z",
			updatedAt: "2026-06-10T10:00:00.000Z",
		},
	];
	const content = formatTareasYCola(tasks, { now: () => new Date() });
	// id "task-alpha1234" (14 chars) truncates to "task-alpha12" (12 chars).
	assert.match(content, /task-alpha12/u);
	assert.match(content, /Tareas y cola \(1\)/u);
	assert.match(content, /bug/u);
	assert.match(content, /P3/u);
});
