import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	inspectEvents,
	formatInspectEventsReport,
} from "../src/events-inspector.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-events-"));
	mkdirSync(join(root, "events"), { recursive: true });
	return { stateRoot: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function appendEvent(stateRoot: string, event: Record<string, unknown>): void {
	const path = join(stateRoot, "events.jsonl");
	writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: "a", encoding: "utf8" });
}

test("inspectEvents retorna todos los eventos sin filtros", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, { ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T18:01:00Z", kind: "task_created", projectId: "idu-pi" });
		const r = inspectEvents({ stateRoot, now: new Date("2026-06-08T19:00:00Z") });
		assert.equal(r.total, 2);
		assert.equal(r.filteredCount, 2);
	} finally {
		cleanup();
	}
});

test("inspectEvents filtra por projectId", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, { ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T18:01:00Z", kind: "task_stuck", projectId: "other" });
		const r = inspectEvents({ stateRoot, projectId: "idu-pi", now: new Date("2026-06-08T19:00:00Z") });
		assert.equal(r.total, 2);
		assert.equal(r.filteredCount, 1);
		assert.equal(r.events[0].projectId, "idu-pi");
	} finally {
		cleanup();
	}
});

test("inspectEvents filtra por kinds múltiples", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, { ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T18:01:00Z", kind: "task_created", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T18:02:00Z", kind: "intention_registered", projectId: "idu-pi" });
		const r = inspectEvents({
			stateRoot,
			kinds: ["task_stuck", "task_created"],
			now: new Date("2026-06-08T19:00:00Z"),
		});
		assert.equal(r.total, 3);
		assert.equal(r.filteredCount, 2);
		assert.ok(r.events.every((e) => e.kind === "task_stuck" || e.kind === "task_created"));
	} finally {
		cleanup();
	}
});

test("inspectEvents filtra por since y until", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, { ts: "2026-06-08T16:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		appendEvent(stateRoot, { ts: "2026-06-08T20:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		const r = inspectEvents({
			stateRoot,
			since: new Date("2026-06-08T17:00:00Z"),
			until: new Date("2026-06-08T19:00:00Z"),
			now: new Date("2026-06-08T21:00:00Z"),
		});
		assert.equal(r.total, 3);
		assert.equal(r.filteredCount, 1);
		assert.equal(r.events[0].ts, "2026-06-08T18:00:00Z");
	} finally {
		cleanup();
	}
});

test("inspectEvents respeta limit", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		for (let i = 0; i < 5; i++) {
			appendEvent(stateRoot, { ts: `2026-06-08T18:0${i}:00Z`, kind: "task_stuck", projectId: "idu-pi" });
		}
		const r = inspectEvents({ stateRoot, limit: 3, now: new Date("2026-06-08T19:00:00Z") });
		assert.equal(r.total, 5);
		assert.equal(r.filteredCount, 5);
		assert.equal(r.events.length, 3);
		assert.equal(r.truncated, true);
	} finally {
		cleanup();
	}
});

test("inspectEvents ignora líneas corruptas y las cuenta", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, { ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" });
		writeFileSync(join(stateRoot, "events.jsonl"), "{corrupted line}\n", { flag: "a", encoding: "utf8" });
		const r = inspectEvents({ stateRoot, now: new Date("2026-06-08T19:00:00Z") });
		assert.equal(r.filteredCount, 1);
		assert.equal(r.malformedCount, 1);
	} finally {
		cleanup();
	}
});

test("inspectEvents retorna total=0 si no hay archivo", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const r = inspectEvents({ stateRoot, now: new Date("2026-06-08T19:00:00Z") });
		assert.equal(r.total, 0);
		assert.equal(r.filteredCount, 0);
	} finally {
		cleanup();
	}
});

test("formatInspectEventsReport genera tabla legible", () => {
	const out = formatInspectEventsReport({
		total: 5,
		filteredCount: 2,
		truncated: false,
		malformedCount: 0,
		events: [
			{ ts: "2026-06-08T18:00:00Z", kind: "task_stuck", projectId: "idu-pi" },
			{ ts: "2026-06-08T18:01:00Z", kind: "task_created", projectId: "idu-pi" },
		],
		filters: { projectId: "idu-pi", kinds: ["task_stuck", "task_created"] },
	});
	assert.match(out, /total=5 filtered=2/);
	assert.match(out, /projectId=idu-pi kinds=task_stuck,task_created/);
	assert.match(out, /18:00:00.*task_stuck/);
	assert.match(out, /18:01:00.*task_created/);
});
