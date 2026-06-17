import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	evaluateSatisfaction,
	readLifecycleLog,
	recordLifecycleEvent,
	resolveTelemetryPath,
	rolloverIfNeeded,
} from "../src/telemetry-lifecycle.js";

function makeRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-telemetry-"));
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

test("recordLifecycleEvent: appends a JSON line to <stateRoot>/injection-telemetry.jsonl", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const evt = recordLifecycleEvent({
			stateRoot,
			injectionId: "inj-1",
			phase: "emitted",
			kind: "hygiene_junk_file",
		});
		assert.equal(evt.injectionId, "inj-1");
		assert.equal(evt.phase, "emitted");
		assert.equal(evt.kind, "hygiene_junk_file");
		const path = resolveTelemetryPath(stateRoot);
		assert.ok(existsSync(path), "telemetry file should be created");
		const content = readFileSync(path, "utf8");
		const lines = content.split("\n").filter((l) => l.trim());
		assert.equal(lines.length, 1);
		const parsed = JSON.parse(lines[0]);
		assert.equal(parsed.injectionId, "inj-1");
		assert.equal(parsed.phase, "emitted");
	} finally {
		cleanup();
	}
});

test("recordLifecycleEvent: accepts each fixed phase (emitted, delivered, resolved, expired, superseded)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const phases = [
			"emitted",
			"delivered",
			"resolved",
			"expired",
			"superseded",
		] as const;
		for (const phase of phases) {
			recordLifecycleEvent({
				stateRoot,
				injectionId: `inj-${phase}`,
				phase,
			});
		}
		const events = readLifecycleLog(stateRoot);
		assert.equal(events.length, 5);
		assert.deepEqual(
			events.map((e) => e.phase).sort(),
			[...phases].sort(),
		);
	} finally {
		cleanup();
	}
});

test("recordLifecycleEvent: rejects a phase outside the fixed vocabulary", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		assert.throws(
			() =>
				recordLifecycleEvent({
					stateRoot,
					injectionId: "inj-bad",
					// @ts-expect-error -- intentionally invalid phase
					phase: "frobnicated",
				}),
			/vocabulary|phase|invalid/i,
		);
		// No file should be written for the rejected event
		const path = resolveTelemetryPath(stateRoot);
		if (existsSync(path)) {
			const content = readFileSync(path, "utf8");
			assert.equal(content.trim(), "", "rejected events must not be logged");
		}
	} finally {
		cleanup();
	}
});

test("evaluateSatisfaction: counts events per phase within the window", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const now = new Date("2026-06-17T12:00:00.000Z");
		// 3 emitted, 1 delivered, 1 resolved (all within the 24h window)
		recordLifecycleEvent({
			stateRoot,
			injectionId: "a",
			phase: "emitted",
			now,
		});
		recordLifecycleEvent({
			stateRoot,
			injectionId: "b",
			phase: "emitted",
			now,
		});
		recordLifecycleEvent({
			stateRoot,
			injectionId: "c",
			phase: "emitted",
			now,
		});
		recordLifecycleEvent({
			stateRoot,
			injectionId: "d",
			phase: "delivered",
			now,
		});
		recordLifecycleEvent({
			stateRoot,
			injectionId: "e",
			phase: "resolved",
			now,
		});
		const counts = evaluateSatisfaction({
			stateRoot,
			windowMs: 24 * 60 * 60 * 1000,
			now,
		});
		assert.equal(counts.emitted, 3);
		assert.equal(counts.delivered, 1);
		assert.equal(counts.resolved, 1);
		assert.equal(counts.expired, 0);
		assert.equal(counts.superseded, 0);
		assert.equal(counts.windowMs, 24 * 60 * 60 * 1000);
	} finally {
		cleanup();
	}
});

test("evaluateSatisfaction: ignores events outside the window", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const now = new Date("2026-06-17T12:00:00.000Z");
		// 2h ago: still in window
		recordLifecycleEvent({
			stateRoot,
			injectionId: "in",
			phase: "emitted",
			now: new Date(now.getTime() - 2 * 60 * 60 * 1000),
		});
		// 30h ago: outside a 24h window
		recordLifecycleEvent({
			stateRoot,
			injectionId: "out",
			phase: "emitted",
			now: new Date(now.getTime() - 30 * 60 * 60 * 1000),
		});
		const counts = evaluateSatisfaction({
			stateRoot,
			windowMs: 24 * 60 * 60 * 1000,
			now,
		});
		assert.equal(counts.emitted, 1, "only in-window event should be counted");
	} finally {
		cleanup();
	}
});

test("rolloverIfNeeded: rolls over at 1000 events, keeps last 1k, creates .bak", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const now = new Date("2026-06-17T12:00:00.000Z");
		// Write 1001 events directly. The 1001st triggers rollover, which
		// should keep the last 1000 in the live file and move the first
		// event(s) into the .bak file.
		for (let i = 0; i < 1001; i++) {
			recordLifecycleEvent({
				stateRoot,
				injectionId: `inj-${i}`,
				phase: "emitted",
				now,
			});
		}
		const path = resolveTelemetryPath(stateRoot);
		const bakPath = `${path}.bak`;
		assert.ok(existsSync(path), "live telemetry file must exist");
		assert.ok(existsSync(bakPath), "telemetry .bak file must exist after rollover");
		const liveLines = readFileSync(path, "utf8")
			.split("\n")
			.filter((l) => l.trim());
		assert.ok(
			liveLines.length <= 1000,
			`live file should keep at most 1000 events, got ${liveLines.length}`,
		);
		// The earliest event (inj-0) should NOT be in the live file anymore
		const liveIds = liveLines.map((l) => JSON.parse(l).injectionId);
		assert.ok(
			!liveIds.includes("inj-0"),
			"earliest event should have been rolled over to .bak",
		);
	} finally {
		cleanup();
	}
});

test("readLifecycleLog: returns empty array when no telemetry file exists", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const events = readLifecycleLog(stateRoot);
		assert.deepEqual(events, []);
	} finally {
		cleanup();
	}
});
