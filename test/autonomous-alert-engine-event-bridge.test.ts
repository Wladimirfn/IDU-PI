import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitStuckTaskEventsFromAlertReport } from "../src/autonomous-alert-engine-event-bridge.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-aaeeb-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

const FIXED_TS = "2026-06-08T10:00:00.000Z";

test("emitStuckTaskEventsFromAlertReport con stale_work y warning emite 1 línea task_stuck", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "d-1",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
						summary: "Tarea vieja",
						ageMs: 3_700_000,
					},
				],
			},
		});
		assert.equal(result.emittedCount, 1);
		assert.ok(existsSync(join(stateRoot, "events.jsonl")));
		const lines = readFileSync(join(stateRoot, "events.jsonl"), "utf8").trim().split("\n");
		assert.equal(lines.length, 1);
		const ev = JSON.parse(lines[0] ?? "{}");
		assert.equal(ev.kind, "task_stuck");
		assert.equal(ev.payload.domain, "stale_work");
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport con domain repeated_bug NO emite", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "d-1",
						kind: "repeated_bug",
						domain: "repeated_bug",
						severity: "high",
						summary: "Bug repetido",
					},
				],
			},
		});
		assert.equal(result.emittedCount, 0);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport con 0 decisiones NO modifica disco", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: { decisions: [] },
		});
		assert.equal(result.emittedCount, 0);
		assert.equal(existsSync(join(stateRoot, "events.jsonl")), false);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport con 2 stale_work emite 2 líneas", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "d-1",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
						summary: "A",
					},
					{
						id: "d-2",
						kind: "backlog_pressure",
						domain: "backlog_pressure",
						severity: "warning",
						summary: "B",
					},
				],
			},
		});
		assert.equal(result.emittedCount, 2);
		const lines = readFileSync(join(stateRoot, "events.jsonl"), "utf8").trim().split("\n");
		assert.equal(lines.length, 2);
	} finally {
		cleanup();
	}
});
