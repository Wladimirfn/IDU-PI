import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	analyzeStructuredTaskSignal,
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	structuredTaskCategory,
	structuredTaskInputForText,
	structuredTaskPriority,
} from "../src/structured-task-queue.js";
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

test("StructuredTaskQueue clearPersisted deletes tasks jsonl", async () => {
	await withTempQueue((queue, filePath) => {
		queue.enqueueTask({ text: "One", category: "general", priority: 1 });
		queue.enqueueTask({ text: "Two", category: "general", priority: 1 });

		assert.equal(queue.clearPersisted(), 2);
		assert.deepEqual(queue.listTasks(), []);
		assert.equal(existsSync(filePath), false);
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

test("StructuredTaskQueue uses workspaceRoot reports tasks path", async () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-structured-root-"));
	try {
		const queue = new StructuredTaskQueue({ workspaceRoot: dir });
		queue.enqueueTask({ text: "Persist from root", category: "general" });

		const reloaded = new StructuredTaskQueue({ workspaceRoot: dir });
		assert.equal(existsSync(join(dir, "reports", "tasks.jsonl")), true);
		assert.equal(reloaded.listTasks()[0].text, "Persist from root");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("structuredTaskCategory detects /task categories", () => {
	assert.equal(structuredTaskCategory("/task bug arreglo"), "bug");
	assert.equal(structuredTaskCategory("/task feature nueva vista"), "feature");
	assert.equal(structuredTaskCategory("/task refactor servicio"), "refactor");
	assert.equal(structuredTaskCategory("/task docs README"), "docs");
	assert.equal(structuredTaskCategory("revisar algo"), "general");
});

test("structuredTaskPriority uses default priority when analyzer fails", () => {
	assert.equal(
		structuredTaskPriority("texto", () => {
			throw new Error("signal unavailable");
		}),
		3,
	);
});

test("structuredTaskPriority can use analyzeUserSignal urgency", () => {
	assert.equal(structuredTaskPriority("Urgente, no funciona"), 5);
	assert.equal(structuredTaskPriority("Gracias, perfecto"), 2);
});

test("structuredTaskPriority treats neutral as normal priority", () => {
	assert.equal(structuredTaskPriority("revisar estado"), 3);
});

test("structuredTaskInputForText honors explicit task template categories", () => {
	for (const category of ["bug", "feature", "refactor", "docs"]) {
		const input = structuredTaskInputForText(
			`Operational prompt for ${category}`,
			{
				category,
			},
		);

		assert.equal(input.category, category);
	}
});

test("structuredTaskInputForText stores emotion and priority", () => {
	const urgent = structuredTaskInputForText("Urgente, no funciona", {
		source: "telegram",
		projectId: "idu-pi",
		category: "bug",
	});
	const annoyed = structuredTaskInputForText("Estoy molesto otra vez");
	const neutral = structuredTaskInputForText("revisar estado");

	assert.equal(urgent.category, "bug");
	assert.equal(urgent.priority, 5);
	assert.equal(urgent.emotion, "urgente");
	assert.equal(urgent.source, "telegram");
	assert.equal(urgent.projectId, "idu-pi");
	assert.equal(annoyed.emotion, "molesto");
	assert.equal(neutral.priority, 3);
	assert.equal(neutral.emotion, "neutral");
});

test("analyzeStructuredTaskSignal falls back to neutral", () => {
	const signal = analyzeStructuredTaskSignal("texto", () => {
		throw new Error("sqlite unavailable");
	});

	assert.equal(signal.emotion, "neutral");
	assert.equal(signal.urgency, 3);
	assert.equal(signal.confidence, "low");
	assert.deepEqual(signal.matchedKeywords, []);
});

test("formatStructuredTaskQueueDetail shows structured task fields", async () => {
	await withTempQueue((queue) => {
		queue.enqueueTask({
			text: "/task bug arreglar cola",
			category: "bug",
			priority: 4,
		});

		const detail = formatStructuredTaskQueueDetail(queue.listTasks());

		assert.match(detail, /Cola estructurada \(1\)/u);
		assert.match(detail, /task-/u);
		assert.match(detail, /pending/u);
		assert.match(detail, /P4/u);
		assert.match(detail, /bug/u);
		assert.match(detail, /neutral/u);
		assert.match(detail, /\/task bug arreglar cola/u);
	});
});

test("StructuredTaskQueue stores and formats guard state", async () => {
	await withTempQueue((queue, filePath) => {
		const task = queue.enqueueTask({
			text: "Bug task. Symptom/context: falló login",
			category: "bug",
			priority: 5,
		});

		queue.markNeedsConfirmation(task.id, {
			guardRisk: "high",
			guardReason: "auth/login requiere confirmación humana",
		});

		const reloaded = new StructuredTaskQueue({ filePath });
		const guarded = reloaded.listTasks()[0];
		assert.equal(guarded.guardStatus, "needs_confirmation");
		assert.equal(guarded.guardRisk, "high");
		assert.match(
			formatStructuredTaskQueueDetail([guarded]),
			/guard: needs_confirmation\/high/u,
		);
		assert.match(formatStructuredTaskQueueDetail([guarded]), /queue_approve/u);
	});
});

test("StructuredTaskQueue approves and rejects guarded tasks", async () => {
	await withTempQueue((queue) => {
		const approved = queue.enqueueTask({ text: "one", category: "bug" });
		const rejected = queue.enqueueTask({ text: "two", category: "bug" });

		queue.markNeedsConfirmation(approved.id, {
			guardRisk: "high",
			guardReason: "login",
		});
		queue.markNeedsConfirmation(rejected.id, {
			guardRisk: "blocker",
			guardReason: "schema",
		});

		assert.equal(queue.markGuardApproved(approved.id)?.guardStatus, "approved");
		assert.equal(
			queue.markGuardRejected(rejected.id, "rechazado")?.guardStatus,
			"rejected",
		);
		assert.equal(
			queue.markGuardRejected(rejected.id, "rechazado")?.status,
			"failed",
		);
	});
});
