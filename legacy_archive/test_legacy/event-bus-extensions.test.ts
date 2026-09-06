import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendEvent,
	computeEventHash,
	subscribeToEventKind,
	type Event,
	type EventKind,
} from "../src/event-bus.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-event-bus-ext-"));
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
	kind: "orchestrator_turn",
	projectId: "idu-pi",
	payload: { turnId: "t-1", request: "do something" },
	sourceRef: "orchestrator",
	evidenceRefs: [],
};

test("EventKind union covers the 21 new kinds required by living-roles-v2", () => {
	const newKinds: EventKind[] = [
		"orchestrator_turn",
		"alerts_scheduled_tick",
		"context_budget_grew",
		"file_changed",
		"dependency_bumped",
		"module_added",
		"breaking_change",
		"migration_added",
		"raw_sql_seen",
		"design_token_drift",
		"bundle_size_grew",
		"complexity_threshold",
		"lint_regression",
		"dead_code",
		"public_api_added",
		"broken_link",
		"project_map_changed",
		"blueprint_edited",
		"source_added",
		"source_digest_drift",
		"role_engine_cap_warning",
	];
	// The TypeScript compiler already enforces this; the runtime
	// assertion is regression-pin in case the union is reduced.
	for (const kind of newKinds) {
		const event: Event = { ...baseEvent, kind };
		assert.equal(event.kind, kind);
	}
});

test("computeEventHash is stable across calls and varies with inputs", () => {
	const a = computeEventHash(baseEvent);
	const b = computeEventHash(baseEvent);
	assert.equal(a, b, "hash should be stable for identical inputs");
	assert.equal(typeof a, "string");
	assert.equal(a.length, 16, "hash is 16 hex chars (sha1 slice)");
	// Vary kind
	assert.notEqual(
		computeEventHash({ ...baseEvent, kind: "file_changed" }),
		a,
	);
	// Vary payload
	assert.notEqual(
		computeEventHash({ ...baseEvent, payload: { turnId: "t-2" } }),
		a,
	);
	// Vary sourceRef
	assert.notEqual(
		computeEventHash({ ...baseEvent, sourceRef: "postflight" }),
		a,
	);
});

test("pub/sub registry: subscribed listener receives the event", () => {
	const root = freshRoot();
	const received: Event[] = [];
	const unsubscribe = subscribeToEventKind("orchestrator_turn", (event) => {
		received.push(event);
	});
	try {
		appendEvent(root, baseEvent);
		assert.equal(received.length, 1);
		assert.equal(received[0]!.kind, "orchestrator_turn");
	} finally {
		unsubscribe();
	}
	// After unsubscribe, no further events reach the listener.
	appendEvent(root, { ...baseEvent, ts: "2026-06-08T10:01:00.000Z" });
	assert.equal(received.length, 1);
});

test("pub/sub registry: throwing listener does not block other listeners or the JSONL write", () => {
	const root = freshRoot();
	const received: Event[] = [];
	const unsubscribeThrow = subscribeToEventKind("file_changed", () => {
		throw new Error("listener boom");
	});
	const unsubscribeOk = subscribeToEventKind("file_changed", (event) => {
		received.push(event);
	});
	try {
		// Use a unique event hash (different ts) so the in-process
		// dedup does not skip the second append.
		appendEvent(root, {
			...baseEvent,
			kind: "file_changed",
			ts: "2026-06-08T11:00:00.000Z",
			payload: { path: "src/foo.ts" },
		});
	} finally {
		unsubscribeThrow();
		unsubscribeOk();
	}
	// The good listener still got the event despite the throw.
	assert.equal(received.length, 1);
	assert.equal(received[0]!.kind, "file_changed");
	// The JSONL write still happened.
	const raw = readFileSync(join(root, "events.jsonl"), "utf8");
	const lines = raw.split("\n").filter((line) => line.length > 0);
	assert.equal(lines.length, 1);
	assert.match(lines[0]!, /"file_changed"/u);
});
