import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	emitAlertsScheduledTick,
	emitOrchestratorTurn,
	emitOrchestratorTurnCompleted,
	emitToolReceived,
} from "../src/role-events.js";
import { resolveEventsPath } from "../src/event-bus.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-role-events-"));
}

function readEvents(stateRoot: string): unknown[] {
	const path = resolveEventsPath(stateRoot);
	const raw = readFileSync(path, "utf8");
	return raw
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

test("emitOrchestratorTurn writes an event with kind=orchestrator_turn and the toolName", () => {
	const stateRoot = makeStateRoot();
	try {
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 1);
		const event = events[0] as { kind: string; payload: { toolName: string } };
		assert.equal(event.kind, "orchestrator_turn");
		assert.equal(event.payload.toolName, "idu_status");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("emitAlertsScheduledTick writes an event with kind=alerts_scheduled_tick and the cronExpr", () => {
	const stateRoot = makeStateRoot();
	try {
		emitAlertsScheduledTick({
			stateRoot,
			projectId: "demo",
			cronExpr: "*/15 * * * *",
			source: "cron",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 1);
		const event = events[0] as {
			kind: string;
			payload: { cronExpr: string };
			sourceRef: string;
		};
		assert.equal(event.kind, "alerts_scheduled_tick");
		assert.equal(event.payload.cronExpr, "*/15 * * * *");
		assert.equal(event.sourceRef, "cron");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("two orchestrator_turn events in a row produce two events in the JSONL", () => {
	const stateRoot = makeStateRoot();
	try {
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_pending_injections",
			now: new Date("2026-06-15T00:00:01Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 2);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// === #425 pair invariant tests ===

test("emitOrchestratorTurn returns the id of the emitted event", () => {
	const stateRoot = makeStateRoot();
	try {
		const id = emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		assert.equal(typeof id, "string");
		assert.ok((id ?? "").length > 0);
		const events = readEvents(stateRoot);
		const event = events[0] as { id?: string };
		assert.equal(event.id, id);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("emitOrchestratorTurnCompleted links back to the start event via followsUp", () => {
	const stateRoot = makeStateRoot();
	try {
		const startId = emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		emitOrchestratorTurnCompleted({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			startEventId: startId ?? "",
			outcome: "ok",
			ok: true,
			summary: "Activo",
			evidenceRefs: ["readme:vision", "plan:snapshot"],
			autonomyGateTraces: [
				{ gateId: "consult-master-plan", verdict: "allow" },
			],
			errors: [],
			now: new Date("2026-06-15T00:00:01Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 2);
		const end = events[1] as {
			kind: string;
			payload: { followsUp: string; outcome: string; ok: boolean; summary: string };
			evidenceRefs: string[];
		};
		assert.equal(end.kind, "orchestrator_turn_completed");
		assert.equal(end.payload.followsUp, startId);
		assert.equal(end.payload.outcome, "ok");
		assert.equal(end.payload.ok, true);
		assert.equal(end.payload.summary, "Activo");
		assert.deepEqual(end.evidenceRefs, ["readme:vision", "plan:snapshot"]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("emitOrchestratorTurnCompleted on a failure path carries the failure inside", () => {
	const stateRoot = makeStateRoot();
	try {
		const startId = emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		// outcome=throw, no ok, no summary, errors populated
		emitOrchestratorTurnCompleted({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			startEventId: startId ?? "",
			outcome: "throw",
			errors: ["boom"],
			evidenceRefs: [],
			now: new Date("2026-06-15T00:00:01Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 2);
		const end = events[1] as {
			kind: string;
			payload: { followsUp: string; outcome: string; errors: string[] };
		};
		assert.equal(end.payload.outcome, "throw");
		assert.deepEqual(end.payload.errors, ["boom"]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("emitToolReceived links to the end event via followsUp", () => {
	const stateRoot = makeStateRoot();
	try {
		// Synthesize a chain: start -> end -> ack
		const startId = emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		const endId = emitOrchestratorTurnCompleted({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			startEventId: startId ?? "",
			outcome: "ok",
			ok: true,
			summary: "Activo",
			evidenceRefs: [],
			now: new Date("2026-06-15T00:00:01Z"),
		});
		emitToolReceived({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			endEventId: endId ?? "",
			decision: "follow",
			verdictAcknowledged: true,
			evidenceRefs: [],
			now: new Date("2026-06-15T00:00:02Z"),
		});
		const events = readEvents(stateRoot);
		assert.equal(events.length, 3);
		const ack = events[2] as {
			kind: string;
			payload: { followsUp: string; decision: string; verdictAcknowledged: boolean };
		};
		assert.equal(ack.kind, "tool_received");
		assert.equal(ack.payload.followsUp, endId);
		assert.equal(ack.payload.decision, "follow");
		assert.equal(ack.payload.verdictAcknowledged, true);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("the audit chain: start -> end -> ack is sortable by followsUp", () => {
	const stateRoot = makeStateRoot();
	try {
		const startId = emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		const endId = emitOrchestratorTurnCompleted({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			startEventId: startId ?? "",
			outcome: "ok",
			ok: true,
			evidenceRefs: [],
			now: new Date("2026-06-15T00:00:01Z"),
		});
		emitToolReceived({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			endEventId: endId ?? "",
			decision: "ignore",
			verdictAcknowledged: false,
			evidenceRefs: [],
			now: new Date("2026-06-15T00:00:02Z"),
		});
		const events = readEvents(stateRoot) as Array<{
			kind: string;
			id?: string;
			payload: { followsUp?: string };
		}>;
		// Walk the chain: start -> end (followsUp=start) -> ack (followsUp=end)
		const start = events.find((e) => e.kind === "orchestrator_turn");
		const end = events.find(
			(e) => e.kind === "orchestrator_turn_completed" && e.payload.followsUp === start?.id,
		);
		const ack = events.find(
			(e) => e.kind === "tool_received" && e.payload.followsUp === end?.id,
		);
		assert.ok(start, "start event present");
		assert.ok(end, "end event paired with start via followsUp");
		assert.ok(ack, "ack event paired with end via followsUp");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
