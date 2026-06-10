import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchTaskQueuePanelChoice } from "../src/cli.js";
import type { StructuredTask } from "../src/structured-task-queue.js";

function makeFakeRuntime(tasks: StructuredTask[] = []) {
	const taskMap = new Map(tasks.map((t) => [t.id, t]));
	return {
		queueApprove: (id: string): StructuredTask | undefined => {
			const task = taskMap.get(id);
			if (!task) return undefined;
			taskMap.delete(id);
			return { ...task, status: "done" };
		},
		queueReject: (id: string): StructuredTask | undefined => {
			const task = taskMap.get(id);
			if (!task) return undefined;
			taskMap.delete(id);
			return { ...task, status: "failed" };
		},
		listTasks: (): StructuredTask[] => Array.from(taskMap.values()),
	};
}

function makeTask(id: string): StructuredTask {
	return {
		id,
		text: `Task ${id}`,
		status: "pending",
		category: "bug",
		priority: 3,
		createdAt: "2026-06-10T10:00:00.000Z",
		updatedAt: "2026-06-10T10:00:00.000Z",
	};
}

// Test 7: dispatch approves a task and returns the success message
test("dispatchTaskQueuePanelChoice approves a task", () => {
	const task = makeTask("task-123456");
	const runtime = makeFakeRuntime([task]);
	const result = dispatchTaskQueuePanelChoice(runtime, `approve:${task.id}`);
	assert.equal(result.action, "approve");
	assert.match(result.message || "", /Tarea aprobada: task-123456/);
	assert.match(result.message || "", /No ejecuté IA ni AgentLabs/);
});

// Test 8: dispatch rejects a task and returns the success message
test("dispatchTaskQueuePanelChoice rejects a task", () => {
	const task = makeTask("task-789012");
	const runtime = makeFakeRuntime([task]);
	const result = dispatchTaskQueuePanelChoice(runtime, `reject:${task.id}`);
	assert.equal(result.action, "reject");
	assert.match(result.message || "", /Tarea rechazada: task-789012/);
});

// Test 9: dispatch prints "task not found: <id>" when runtime returns undefined
test("dispatchTaskQueuePanelChoice returns not-found for missing task", () => {
	const runtime = makeFakeRuntime([]);
	const result = dispatchTaskQueuePanelChoice(runtime, "approve:task-missing");
	assert.equal(result.action, "not-found");
	assert.equal(result.message, "task not found: task-missing");
});

test("dispatchTaskQueuePanelChoice returns not-found for reject missing task", () => {
	const runtime = makeFakeRuntime([]);
	const result = dispatchTaskQueuePanelChoice(runtime, "reject:task-missing");
	assert.equal(result.action, "not-found");
	assert.equal(result.message, "task not found: task-missing");
});

// Test 10: dispatch handles back and exit
test("dispatchTaskQueuePanelChoice returns back for 'back' choice", () => {
	const runtime = makeFakeRuntime([]);
	const result = dispatchTaskQueuePanelChoice(runtime, "back");
	assert.equal(result.action, "back");
});

test("dispatchTaskQueuePanelChoice returns exit for 'exit' choice", () => {
	const runtime = makeFakeRuntime([]);
	const result = dispatchTaskQueuePanelChoice(runtime, "exit");
	assert.equal(result.action, "exit");
});

// Test 12: CLI command not-found message
// The CLI surface must mirror the panel dispatcher: when the runtime
// returns undefined for queueApprove/queueReject, the CLI should
// print the dispatcher's "task not found: <id>" message (the same
// wording the panel uses), not the bare usage hint.
test("runCliCommand idu-queue-approve prints 'task not found: <id>' for a missing task", async () => {
	const { runCliCommand } = await import("../src/cli.js");
	const runtime = makeFakeRuntime([]);
	const result = await runCliCommand(
		["idu-queue-approve", "task-missing"],
		runtime as any,
	);
	assert.notEqual(result.exitCode, 0);
	const out = `${result.stderr}\n${result.stdout}`;
	assert.match(
		out,
		/task not found: task-missing/,
		`expected dispatcher-style 'task not found: task-missing' message, got: ${out}`,
	);
	assert.doesNotMatch(
		out,
		/Uso: idu-pi queue-approve/,
		`did not expect the bare usage hint in CLI output, got: ${out}`,
	);
});

test("runCliCommand idu-queue-reject prints 'task not found: <id>' for a missing task", async () => {
	const { runCliCommand } = await import("../src/cli.js");
	const runtime = makeFakeRuntime([]);
	const result = await runCliCommand(
		["idu-queue-reject", "task-missing"],
		runtime as any,
	);
	assert.notEqual(result.exitCode, 0);
	const out = `${result.stderr}\n${result.stdout}`;
	assert.match(
		out,
		/task not found: task-missing/,
		`expected dispatcher-style 'task not found: task-missing' message, got: ${out}`,
	);
	assert.doesNotMatch(
		out,
		/Uso: idu-pi queue-reject/,
		`did not expect the bare usage hint in CLI output, got: ${out}`,
	);
});
