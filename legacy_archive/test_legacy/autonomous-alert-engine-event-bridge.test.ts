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
const SEEN_FILE = "stuck-events-seen.json";

function readEventLines(stateRoot: string): unknown[] {
	return readFileSync(join(stateRoot, "events.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as unknown);
}

function readSeenState(stateRoot: string): { seen: Record<string, string> } {
	return JSON.parse(readFileSync(join(stateRoot, SEEN_FILE), "utf8")) as {
		seen: Record<string, string>;
	};
}

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
		const lines = readEventLines(stateRoot);
		assert.equal(lines.length, 1);
		const ev = lines[0] as { kind?: string; payload?: { domain?: string } };
		assert.equal(ev.kind, "task_stuck");
		assert.ok(ev.payload);
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
		const lines = readEventLines(stateRoot);
		assert.equal(lines.length, 2);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport deduplica taskId+domain en el mismo bucket horario", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const input = {
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "task-1",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
					},
				],
			},
		};
		assert.equal(emitStuckTaskEventsFromAlertReport(input).emittedCount, 1);
		assert.equal(emitStuckTaskEventsFromAlertReport(input).emittedCount, 0);
		assert.equal(readEventLines(stateRoot).length, 1);
		assert.ok(readSeenState(stateRoot).seen["task-1|stale_work|2026-06-08T10"]);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport re-emite en el siguiente bucket horario", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const report = {
			decisions: [
				{
					id: "task-1",
					kind: "stale_work",
					domain: "stale_work",
					severity: "warning",
				},
			],
		};
		assert.equal(
			emitStuckTaskEventsFromAlertReport({
				stateRoot,
				projectId: "idu-pi",
				now: new Date("2026-06-08T10:30:00.000Z"),
				report,
			}).emittedCount,
			1,
		);
		assert.equal(
			emitStuckTaskEventsFromAlertReport({
				stateRoot,
				projectId: "idu-pi",
				now: new Date("2026-06-08T11:00:00.000Z"),
				report,
			}).emittedCount,
			1,
		);
		assert.equal(readEventLines(stateRoot).length, 2);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport emite dos taskId distintos en un reporte", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "task-1",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
					},
					{
						id: "task-2",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
					},
				],
			},
		});
		assert.equal(result.emittedCount, 2);
		assert.equal(readEventLines(stateRoot).length, 2);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport poda entradas vistas mayores a 2 horas", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		writeFileSync(
			join(stateRoot, SEEN_FILE),
			JSON.stringify(
				{
					version: 1,
					seen: {
						"old|stale_work|2026-06-08T07": "2026-06-08T07:59:59.000Z",
						"keep|stale_work|2026-06-08T09": "2026-06-08T09:00:00.000Z",
					},
				},
				null,
				2,
			),
			"utf8",
		);
		emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "new",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
					},
				],
			},
		});
		const state = readSeenState(stateRoot);
		assert.equal(state.seen["old|stale_work|2026-06-08T07"], undefined);
		assert.ok(state.seen["keep|stale_work|2026-06-08T09"]);
		assert.ok(state.seen["new|stale_work|2026-06-08T10"]);
	} finally {
		cleanup();
	}
});

test("emitStuckTaskEventsFromAlertReport con seen-file ausente emite y crea estado", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		assert.equal(existsSync(join(stateRoot, SEEN_FILE)), false);
		const result = emitStuckTaskEventsFromAlertReport({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				decisions: [
					{
						id: "task-1",
						kind: "stale_work",
						domain: "stale_work",
						severity: "warning",
					},
				],
			},
		});
		assert.equal(result.emittedCount, 1);
		assert.ok(existsSync(join(stateRoot, SEEN_FILE)));
	} finally {
		cleanup();
	}
});
