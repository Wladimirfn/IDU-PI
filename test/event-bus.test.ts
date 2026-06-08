import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendEvent,
	readEvents,
	resolveEventsPath,
} from "../src/event-bus.js";
import type { Event } from "../src/event-bus.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-event-bus-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

const baseEvent: Event = {
	ts: "2026-06-08T10:00:00.000Z",
	kind: "task_stuck",
	projectId: "idu-pi",
	payload: { taskId: "task-1", ageMs: 3_600_000, domain: "stale_work" },
	sourceRef: "autonomous-alert-engine",
	evidenceRefs: ["events.jsonl:test"],
};

test("appendEvent creates events.jsonl when missing", () => {
	const root = freshRoot();
	assert.equal(existsSync(resolveEventsPath(root)), false);
	appendEvent(root, baseEvent);
	assert.equal(existsSync(resolveEventsPath(root)), true);
});

test("appendEvent roundtrips event through JSONL", () => {
	const root = freshRoot();
	appendEvent(root, baseEvent);
	const events = readEvents(root);
	assert.equal(events.length, 1);
	assert.deepEqual(events[0], baseEvent);
});

test("readEvents filters by since and kindFilter", () => {
	const root = freshRoot();
	appendEvent(root, {
		...baseEvent,
		ts: "2026-06-08T10:00:00.000Z",
		kind: "task_stuck",
		payload: { taskId: "task-old" },
	});
	appendEvent(root, {
		...baseEvent,
		ts: "2026-06-08T10:10:00.000Z",
		kind: "intention_registered",
		payload: { request: "do something" },
	});
	appendEvent(root, {
		...baseEvent,
		ts: "2026-06-08T12:00:00.000Z",
		kind: "task_stuck",
		payload: { taskId: "task-recent" },
	});
	const filtered = readEvents(root, {
		since: "2026-06-08T10:05:00.000Z",
		kindFilter: "task_stuck",
	});
	assert.equal(filtered.length, 1);
	assert.equal(filtered[0].payload.taskId, "task-recent");
});

test("readEvents returns empty array when file is empty", () => {
	const root = freshRoot();
	// Create an empty file (simulate a previous failed run)
	writeFileSync(resolveEventsPath(root), "", "utf8");
	const events = readEvents(root);
	assert.equal(events.length, 0);
});

test("appendEvent rejects path traversal with invalid artifact name", () => {
	const root = freshRoot();
	assert.throws(
		() => appendEvent(root, { ...baseEvent, kind: "../../../etc/passwd" }),
		/invalid artifact name/u,
	);
	// Verify nothing was written
	assert.equal(existsSync(resolveEventsPath(root)), false);
});

test("appendEvent truncates to eventsMaxLines when cap exceeded", () => {
	const root = freshRoot();
	for (let i = 0; i < 5; i += 1) {
		appendEvent(
			root,
			{ ...baseEvent, ts: `2026-06-08T10:0${i}:00.000Z` },
			{ eventsMaxLines: 3 },
		);
	}
	const raw = readFileSync(resolveEventsPath(root), "utf8");
	const lines = raw.split("\n").filter((line) => line.length > 0);
	assert.equal(lines.length, 3);
	// Last 3 appended: ts 02, 03, 04
	assert.match(lines[0], /2026-06-08T10:02:00\.000Z/u);
	assert.match(lines[2], /2026-06-08T10:04:00\.000Z/u);
});

test("appendEvent is idempotent for identical events within the same process", () => {
	const root = freshRoot();
	const uniqueEvent: Event = {
		ts: "2026-06-08T13:00:00.000Z",
		kind: "intention_blocked",
		projectId: "idu-pi",
		payload: { intentionId: "int-1", reason: "human gate" },
		sourceRef: "intention-tracker",
		evidenceRefs: [],
	};
	appendEvent(root, uniqueEvent);
	appendEvent(root, uniqueEvent);
	const raw = readFileSync(resolveEventsPath(root), "utf8");
	const lines = raw.split("\n").filter((line) => line.length > 0);
	assert.equal(lines.length, 1);
});

test("appendEvent accepts unknown kind (lenient validation)", () => {
	const root = freshRoot();
	appendEvent(root, { ...baseEvent, kind: "made_up_kind" });
	const events = readEvents(root);
	assert.equal(events.length, 1);
	assert.equal(events[0].kind, "made_up_kind");
});
