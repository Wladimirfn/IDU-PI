import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskQueue } from "../src/task-queue.js";

test("TaskQueue enqueues and drains FIFO", () => {
	const queue = new TaskQueue();
	queue.enqueue("primero");
	queue.enqueue("segundo");

	assert.equal(queue.size, 2);
	assert.deepEqual(queue.drain(), ["primero", "segundo"]);
	assert.equal(queue.size, 0);
});

test("TaskQueue dequeues one item without dropping the rest", () => {
	const queue = new TaskQueue();
	queue.enqueue("primero");
	queue.enqueue("segundo");

	assert.equal(queue.dequeue(), "primero");
	assert.deepEqual(queue.drain(), ["segundo"]);
});

test("TaskQueue can peek and remove a matching queued item", () => {
	const queue = new TaskQueue();
	queue.enqueue("primero");
	queue.enqueue("segundo");

	assert.equal(queue.peek(), "primero");
	assert.equal(queue.removeFirstMatching("segundo"), true);
	assert.deepEqual(queue.drain(), ["primero"]);
	assert.equal(queue.removeFirstMatching("missing"), false);
});

test("TaskQueue removes all matching duplicates", () => {
	const queue = new TaskQueue();
	queue.enqueue("duplicado");
	queue.enqueue("otro");
	queue.enqueue("duplicado");

	assert.equal(queue.removeAllMatching("duplicado"), 2);
	assert.deepEqual(queue.drain(), ["otro"]);
});

test("TaskQueue formats status and clears", () => {
	const queue = new TaskQueue();
	queue.enqueue("revisar README");
	queue.enqueue("correr tests");

	assert.match(queue.formatStatus(), /Q1\. revisar README/);
	assert.match(queue.formatStatus(), /Q2\. correr tests/);
	assert.equal(queue.clear(), 2);
	assert.match(queue.formatStatus(), /vacía/);
});

test("TaskQueue trims and rejects empty items", () => {
	const queue = new TaskQueue();
	assert.equal(queue.enqueue("   "), false);
	assert.equal(queue.enqueue("  hacer audit  "), true);
	assert.deepEqual(queue.drain(), ["hacer audit"]);
});
