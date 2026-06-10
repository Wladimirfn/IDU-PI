import assert from "node:assert/strict";
import { test } from "node:test";
import {
	runColaViewPanelTui,
	runInteractiveHome,
	runTareasViewPanelTui,
	type TaskQueuePanelDispatchRuntime,
} from "../src/cli.js";
import {
	formatTareasYCola,
	StructuredTaskQueue,
	type StructuredTask,
} from "../src/structured-task-queue.js";

type HomeShim = Parameters<typeof runInteractiveHome>[1];
type TareasShim = Parameters<typeof runTareasViewPanelTui>[1];
type ColaShim = Parameters<typeof runColaViewPanelTui>[1];

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
// StructuredTaskQueue, the home menu's "tareas" choice enters the
// read-only Tareas panel and shows the tasks in the panel body.
// We drive runInteractiveHome with a shimmed selectMenu: first
// call returns "tareas" (the home menu choice), second call
// returns "back" (the panel's back). The shim captures the
// content passed to it. The content shown to the user in the
// Tareas panel must contain the 3 task IDs (truncated to 12 chars
// by formatTaskQueueRow) and the "Tareas (N)" count header.
test("home menu 'tareas' choice shows the 3 tasks from the real queue in the Tareas panel", async () => {
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
		// 1: home menu → "tareas" (enter the read-only Tareas panel).
		// 2: panel → "back" (leave the panel, return to home menu).
		// 3: home menu → "exit" (leave the home menu).
		if (callIndex === 1) return "tareas";
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

	// The Tareas panel content must contain the 3 task IDs (truncated
	// to 12 chars by formatTaskQueueRow) and the "Tareas (N)" header.
	const panelContent = capturedContents[1];
	assert.ok(panelContent, "expected the panel to render content");
	assert.match(panelContent, /Tareas \(3\):/u);
	for (const id of realTaskIds) {
		assert.match(
			panelContent,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${panelContent}`,
		);
	}
	// Must NOT contain the B3 stacked sub-panel headers — the Tareas
	// panel is read-only and only shows the Tareas table.
	assert.doesNotMatch(panelContent, /Cola de acciones/u);
	assert.doesNotMatch(panelContent, /Lista de tareas/u);
});

// Wiring test 2: With a runtime that has 3 tasks, the home menu's
// "cola" choice enters the actionable Cola panel and shows the
// "Cola de acciones (N)" header in the panel body.
test("home menu 'cola' choice shows the 'Cola de acciones (N)' header in the Cola panel", async () => {
	const queue = makeQueueWithTasks([
		{ text: "Alpha task", category: "bug", priority: 3 },
		{ text: "Bravo task", category: "feature", priority: 5 },
		{ text: "Charlie task", category: "maint", priority: 0 },
	]);
	const runtime = buildRuntimeFromQueue(queue);
	const realTaskIds = queue.listTasks().map((t) => t.id);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		// 1: home menu → "cola" (enter the actionable Cola panel).
		// 2: panel → "back" (leave the panel, return to home menu).
		// 3: home menu → "exit".
		if (callIndex === 1) return "cola";
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
	assert.match(panelContent, /Cola de acciones \(3\):/u);
	for (const id of realTaskIds) {
		assert.match(
			panelContent,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${panelContent}`,
		);
	}
	// Must NOT contain the Tareas (read-only) header — the Cola
	// panel is actionable and only shows the Cola de acciones table.
	assert.doesNotMatch(panelContent, /^Tareas \(/u);
	assert.doesNotMatch(panelContent, /Lista de tareas/u);
});

// Wiring test 3: With an empty queue, the home menu's "tareas"
// choice shows the empty-state message in the Tareas panel.
test("home menu 'tareas' choice shows the empty-state for an empty queue", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		if (callIndex === 1) return "tareas";
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
	assert.match(panelContent, /Tareas \(0\):/u);
	assert.match(panelContent, /sin tareas/u);
});

// Wiring test 4: With an empty queue, the home menu's "cola"
// choice shows the empty-state message in the Cola panel.
test("home menu 'cola' choice shows the empty-state for an empty queue", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedContents: Array<string | undefined> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, _options, _status, content) => {
		capturedContents.push(content);
		callIndex += 1;
		if (callIndex === 1) return "cola";
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
	assert.match(panelContent, /Cola de acciones \(0\):/u);
	assert.match(panelContent, /sin acciones pendientes/u);
});

// Wiring test 5: Direct behavioral test of runTareasViewPanelTui
// with 3 tasks. This proves the panel renders the real queue
// content (not a placeholder) when called by the home menu.
test("runTareasViewPanelTui renders the 3 real tasks from the queue runtime", async () => {
	const queue = makeQueueWithTasks([
		{ text: "Alpha", category: "bug", priority: 3 },
		{ text: "Bravo", category: "feature", priority: 5 },
		{ text: "Charlie", category: "maint", priority: 0 },
	]);
	const runtime = buildRuntimeFromQueue(queue);
	const realTaskIds = queue.listTasks().map((t) => t.id);

	let capturedContent: string | undefined;
	const shim: TareasShim = async (_title, _options, _status, content) => {
		if (content !== undefined) capturedContent = content;
		return "back";
	};

	const result = await runTareasViewPanelTui(runtime, shim);
	assert.equal(result, "__back");
	assert.ok(capturedContent, "expected the panel to render content");
	assert.match(capturedContent!, /Tareas \(3\):/u);
	for (const id of realTaskIds) {
		assert.match(
			capturedContent!,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${capturedContent}`,
		);
	}
});

// Wiring test 6: Direct behavioral test of runColaViewPanelTui
// with 3 actionable tasks. This proves the Cola panel renders
// the real queue content and shows the "Cola de acciones (N)"
// header.
test("runColaViewPanelTui renders the 3 actionable tasks from the queue runtime", async () => {
	const queue = makeQueueWithTasks([
		{ text: "Alpha", category: "bug", priority: 3 },
		{ text: "Bravo", category: "feature", priority: 5 },
		{ text: "Charlie", category: "maint", priority: 0 },
	]);
	const runtime = buildRuntimeFromQueue(queue);
	const realTaskIds = queue.listTasks().map((t) => t.id);

	let capturedContent: string | undefined;
	const shim: ColaShim = async (_title, _options, _status, content) => {
		if (content !== undefined) capturedContent = content;
		return "back";
	};

	const result = await runColaViewPanelTui(runtime, shim);
	assert.equal(result, "__back");
	assert.ok(capturedContent, "expected the panel to render content");
	assert.match(capturedContent!, /Cola de acciones \(3\):/u);
	for (const id of realTaskIds) {
		assert.match(
			capturedContent!,
			new RegExp(id.slice(0, 12), "u"),
			`panel content should contain truncated id ${id.slice(0, 12)}, got: ${capturedContent}`,
		);
	}
});

// Wiring test 7: The home menu has BOTH "Tareas" and "Cola"
// entries (no longer a single "Tareas y cola" entry).
test("home menu exposes both 'Tareas' and 'Cola' entries", async () => {
	const queue = new StructuredTaskQueue({ filePath: undefined });
	const runtime = buildRuntimeFromQueue(queue);

	const capturedOptions: Array<unknown> = [];
	let callIndex = 0;
	const shim: HomeShim = async (_title, options, _status, _content) => {
		capturedOptions.push(options);
		callIndex += 1;
		// 1: home menu → "exit".
		return "exit";
	};

	await runInteractiveHome(runtime, shim);

	assert.ok(capturedOptions.length >= 1, "expected at least 1 menu call");
	const homeOptions = capturedOptions[0] as Array<{ label: string; value: string }>;
	const labels = homeOptions.map((o) => o.label);
	assert.ok(
		labels.includes("Tareas"),
		`home menu should have a "Tareas" entry, got: ${labels.join(", ")}`,
	);
	assert.ok(
		labels.includes("Cola"),
		`home menu should have a "Cola" entry, got: ${labels.join(", ")}`,
	);
	// The old unified "Tareas y cola" entry should be gone.
	assert.ok(
		!labels.includes("Tareas y cola"),
		`home menu should NOT have a "Tareas y cola" entry anymore, got: ${labels.join(", ")}`,
	);
});

// Wiring test 8: Sanity check that formatTareasYCola (the legacy
// formatter used by idu-queue-detail) still renders a task row
// with the truncated id (12 chars) and count header, so other
// callers of the formatter (CLI / idu-queue-detail) keep working.
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
