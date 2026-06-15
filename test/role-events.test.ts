import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	emitAlertsScheduledTick,
	emitOrchestratorTurn,
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
