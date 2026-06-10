import assert from "node:assert/strict";
import { test } from "node:test";
import {
	runInteractiveHome,
	runTaskQueuePanelTui,
	type TaskQueuePanelDispatchRuntime,
} from "../src/cli.js";
import {
	StructuredTaskQueue,
	formatTareasYCola,
	type StructuredTask,
} from "../src/structured-task-queue.js";

type HomeShim = Parameters<typeof runInteractiveHome>[1];
type PanelShim = Parameters<typeof runTaskQueuePanelTui>[1];

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
// StructuredTaskQueue, the home menu's tasks case shows the tasks
// in the panel content. We drive runInteractiveHome with a shimmed
// selectMenu: first call returns "tasks" (the home menu choice),
// second call returns "back" (the panel's back). The shim captures
// the content passed to it. The content shown to the user in the
// panel must contain the 3 task IDs (truncated to 12 chars by
// formatTaskQueueRow) and the count header.
test("home menu tasks case shows the 3 tasks from the real queue in the panel content", async () => {
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
		// 1: home menu → "tasks" (enter the panel).
		// 2: panel → "back" (leave the panel, return to home menu).
		// 3: home menu → "exit" (leave the home menu).
		if (callIndex === 1) return "tasks";
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
	// chars by formatTaskQueueRow) and the new sub-panel headers.
	const panelContent = capturedContents[1];
	assert.ok(panelContent, "expected the panel to render content");
	assert.match(panelContent, /Lista de tareas \(3\)/u);
	assert.match(panelContent, /Cola de acciones \(3\)/u);
	for (const id of realTaskIds) {
		assert.match(
			panelContent,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${panelContent}`,
		);
	}
	// Must not show the old placeholder message.
	assert.doesNotMatch(
		panelContent,
		/se entrega en un commit de seguimiento/u,
	);
});

// Wiring test 2: With an empty queue, the panel must show
// "no tasks in the queue".
test("home menu tasks case shows 'no tasks in the queue' for an empty queue", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		if (callIndex === 1) return "tasks";
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
	assert.match(panelContent, /no tasks in the queue/u);
});

// Wiring test 3: Direct behavioral test of runTaskQueuePanelTui
// with 3 tasks. This proves the panel renders the real queue
// content (not a placeholder) when called by the home menu.
test("runTaskQueuePanelTui renders the 3 real tasks from the queue runtime", async () => {
	const queue = makeQueueWithTasks([
		{ text: "Alpha", category: "bug", priority: 3 },
		{ text: "Bravo", category: "feature", priority: 5 },
		{ text: "Charlie", category: "maint", priority: 0 },
	]);
	const runtime = buildRuntimeFromQueue(queue);
	const realTaskIds = queue.listTasks().map((t) => t.id);

	let capturedContent: string | undefined;
	const shim: PanelShim = async (_title, _options, _status, content) => {
		if (content !== undefined) capturedContent = content;
		return "back";
	};

	const result = await runTaskQueuePanelTui(runtime, shim);
	assert.equal(result, "__back");
	assert.ok(capturedContent, "expected the panel to render content");
	assert.match(capturedContent!, /Lista de tareas \(3\)/u);
	assert.match(capturedContent!, /Cola de acciones \(3\)/u);
	for (const id of realTaskIds) {
		assert.match(
			capturedContent!,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${capturedContent}`,
		);
	}
	// Must not show the old placeholder message.
	assert.doesNotMatch(
		capturedContent!,
		/El panel approve\/reject se entrega en un commit de seguimiento/u,
	);
});

// Wiring test 4: Direct behavioral test of runTaskQueuePanelTui
// with an empty queue. Proves the panel falls back to the
// empty-state message.
test("runTaskQueuePanelTui renders 'no tasks in the queue' for an empty queue", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	let capturedContent: string | undefined;
	const shim: PanelShim = async (_title, _options, _status, content) => {
		if (content !== undefined) capturedContent = content;
		return "back";
	};

	const result = await runTaskQueuePanelTui(runtime, shim);
	assert.equal(result, "__back");
	assert.ok(capturedContent, "expected the panel to render content");
	assert.match(capturedContent!, /no tasks in the queue/u);
});

// Wiring test 5: Sanity check that formatTareasYCola renders a
// task row with the truncated id (12 chars), so the assertions in
// the wiring tests above are stable. Uses a fake task with a known
// id so we can assert on the exact substring.
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
