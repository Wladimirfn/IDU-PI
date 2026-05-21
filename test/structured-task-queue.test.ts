import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StructuredTaskQueue } from "../src/structured-task-queue.js";
import { TaskQueue } from "../src/task-queue.js";

async function withTempQueue(
	fn: (queue: StructuredTaskQueue, filePath: string) => void | Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "idu-structured-queue-"));
	try {
		const filePath = join(dir, "tasks.jsonl");
		await fn(new StructuredTaskQueue({ filePath }), filePath);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("StructuredTaskQueue enqueues structured tasks", async () => {
	await withTempQueue((queue) => {
		const task = queue.enqueueTask({
			text: "Run build",
			category: "verification",
			priority: 3,
			source: "lab",
			projectId: "pi-telegram-bridge",
		});

		assert.equal(task.text, "Run build");
		assert.equal(task.category, "verification");
		assert.equal(task.priority, 3);
		assert.equal(task.status, "pending");
		assert.equal(task.source, "lab");
		assert.equal(task.projectId, "pi-telegram-bridge");
		assert.match(task.id, /^task-/u);
		assert.equal(queue.listTasks().length, 1);
	});
});

test("StructuredTaskQueue respects priority when dequeuing", async () => {
	await withTempQueue((queue) => {
		queue.enqueueTask({ text: "Low", category: "general", priority: 5 });
		queue.enqueueTask({ text: "High", category: "general", priority: 1 });
		queue.enqueueTask({ text: "Medium", category: "general", priority: 3 });

		assert.equal(queue.dequeueTask()?.text, "High");
		assert.equal(queue.dequeueTask()?.text, "Medium");
		assert.equal(queue.dequeueTask()?.text, "Low");
	});
});

test("StructuredTaskQueue dequeue marks a task running", async () => {
	await withTempQueue((queue) => {
		const task = queue.enqueueTask({
			text: "Run tests",
			category: "verification",
			priority: 1,
		});

		const dequeued = queue.dequeueTask();

		assert.equal(dequeued?.id, task.id);
		assert.equal(dequeued?.status, "running");
		assert.equal(queue.listTasks()[0].status, "running");
	});
});

test("StructuredTaskQueue status transitions work", async () => {
	await withTempQueue((queue) => {
		const first = queue.enqueueTask({
			text: "First",
			category: "general",
			priority: 2,
		});
		const second = queue.enqueueTask({
			text: "Second",
			category: "general",
			priority: 2,
		});
		const third = queue.enqueueTask({
			text: "Third",
			category: "general",
			priority: 2,
		});

		assert.equal(queue.markRunning(first.id)?.status, "running");
		assert.equal(queue.markDone(second.id)?.status, "done");
		const failed = queue.markFailed(third.id, "Command failed");

		assert.equal(failed?.status, "failed");
		assert.equal(failed?.failureReason, "Command failed");
	});
});

test("StructuredTaskQueue can persist and reload", async () => {
	await withTempQueue((queue, filePath) => {
		const created = queue.enqueueTask({
			text: "Persist me",
			category: "general",
			priority: 1,
		});
		queue.markDone(created.id);

		const reloaded = new StructuredTaskQueue({ filePath });
		const tasks = reloaded.listTasks();

		assert.equal(existsSync(filePath), true);
		assert.equal(tasks.length, 1);
		assert.equal(tasks[0].id, created.id);
		assert.equal(tasks[0].status, "done");
	});
});

test("StructuredTaskQueue clear removes tasks and persists empty state", async () => {
	await withTempQueue((queue, filePath) => {
		queue.enqueueTask({ text: "One", category: "general", priority: 1 });
		queue.enqueueTask({ text: "Two", category: "general", priority: 1 });

		assert.equal(queue.clear(), 2);
		assert.deepEqual(queue.listTasks(), []);

		const reloaded = new StructuredTaskQueue({ filePath });
		assert.deepEqual(reloaded.listTasks(), []);
	});
});

test("StructuredTaskQueue does not affect legacy TaskQueue", async () => {
	await withTempQueue((structured) => {
		const legacy = new TaskQueue();
		assert.equal(legacy.enqueue("legacy task"), true);
		structured.enqueueTask({
			text: "structured task",
			category: "general",
			priority: 1,
		});

		assert.equal(legacy.dequeue(), "legacy task");
		assert.equal(legacy.dequeue(), undefined);
		assert.equal(structured.listTasks().length, 1);
	});
});
