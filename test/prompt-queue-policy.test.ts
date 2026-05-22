import assert from "node:assert/strict";
import { test } from "node:test";
import { decidePromptQueueAction } from "../src/prompt-queue-policy.js";

test("busy incoming prompt is enqueued once", () => {
	assert.equal(
		decidePromptQueueAction({
			activePromptInFlight: true,
			runtimeBusy: false,
			fromQueue: false,
			cancelRequest: false,
		}),
		"enqueue",
	);
});

test("queued prompt bypasses busy requeue guard while draining", () => {
	assert.equal(
		decidePromptQueueAction({
			activePromptInFlight: true,
			runtimeBusy: false,
			fromQueue: true,
			cancelRequest: false,
		}),
		"run",
	);
});

test("queued prompt defers instead of running when runtime remains busy", () => {
	assert.equal(
		decidePromptQueueAction({
			activePromptInFlight: true,
			runtimeBusy: true,
			fromQueue: true,
			cancelRequest: false,
		}),
		"defer",
	);
});

test("cancel keeps priority over queueing", () => {
	assert.equal(
		decidePromptQueueAction({
			activePromptInFlight: true,
			runtimeBusy: true,
			fromQueue: false,
			cancelRequest: true,
		}),
		"cancel",
	);
});
