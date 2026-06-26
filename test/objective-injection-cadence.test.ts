import assert from "node:assert/strict";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	enqueueObjectiveReminder,
	readRecentSupervisorAdvisoriesForTest,
	resolveObjectiveStatePath,
	resolveTurnCounterPath,
	noteOrchestratorTurn,
	OBJECTIVE_REMINDER_TIME_MS,
	OBJECTIVE_REMINDER_ESCALATE_AFTER_MS,
	OBJECTIVE_REMINDER_DEDUP_WINDOW_MS,
	OBJECTIVE_REMINDER_TASK_COUNT,
} from "../src/objective-injection.js";
import { resolveInjectionsPath } from "../src/injection-store.js";

function makeRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-obj-cad-"));
	mkdirSync(stateRoot, { recursive: true });
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function writeReminderState(
	stateRoot: string,
	state: {
		lastReminderAt?: string;
		lastEscalationAt?: string | null;
		turnsSinceLastReminder?: number;
		lastInjectionId?: string;
	},
): void {
	const path = resolveObjectiveStatePath(stateRoot);
	writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function writeTurnCount(stateRoot: string, turnCount: number): void {
	const path = resolveTurnCounterPath(stateRoot);
	writeFileSync(
		path,
		JSON.stringify(
			{ turnCount, lastTurnAt: new Date().toISOString() },
			null,
			2,
		),
		"utf8",
	);
}

/**
 * Write a real un-acked objective_reminder injection to injections.jsonl.
 * This is the "source of truth" the function reads — without it, the
 * function treats the reminder as if it doesn't exist, which masks bugs.
 */
function writeUnackedInjection(
	stateRoot: string,
	injectionId: string,
	lastReminderAt: string,
): void {
	const path = resolveInjectionsPath(stateRoot);
	const injection = {
		injectionId,
		kind: "objective_reminder",
		triggerId: "objective_reminder",
		ts: lastReminderAt,
		acked: false,
		decisionEnvelope: {
			severity: "info",
			summary: "Refresh project objective via idu_supervisor_context_pack",
			options: ["ack", "refresh"],
			evidenceRefs: ["piso:objective_reminder"],
			orchestratorDecisionRequired: false,
		},
	};
	mkdirSync(stateRoot, { recursive: true });
	appendFileSync(path, `${JSON.stringify(injection)}\n`, "utf8");
}

function readInjectionById(
	stateRoot: string,
	injectionId: string,
): Record<string, unknown> | null {
	const path = resolveInjectionsPath(stateRoot);
	if (!existsSync(path)) return null;
	const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
	for (const line of lines) {
		try {
			const obj = JSON.parse(line) as Record<string, unknown>;
			if (obj.injectionId === injectionId) return obj;
		} catch {
			// skip malformed
		}
	}
	return null;
}

test("enqueueObjectiveReminder: enqueues when no recent reminder", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test objective",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.escalated, false);
		assert.equal(result.reason, "fresh");
		assert.ok(result.injectionId);
		// state file is created
		assert.ok(existsSync(resolveObjectiveStatePath(stateRoot)));
		// injection is appended to injections.jsonl
		assert.ok(existsSync(resolveInjectionsPath(stateRoot)));
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: does NOT enqueue when recent un-acked reminder exists (dedup)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// First enqueue
		const first = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(first.enqueued, true);
		// Try to enqueue again immediately
		const second = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(second.enqueued, false);
		assert.equal(second.reason, "dedup");
		assert.equal(second.injectionId, null);
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: enqueues fresh when last reminder is older than dedup window AND stale", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Setup: a real un-acked reminder 5h ago (past dedup window).
		// The function should treat the old one as stale: auto-ack it,
		// and enqueue a fresh one with a NEW injectionId.
		const fiveHoursAgo = new Date(
			Date.now() - 5 * 60 * 60 * 1000,
		).toISOString();
		writeUnackedInjection(stateRoot, "stale-rem-123", fiveHoursAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: fiveHoursAgo,
			lastInjectionId: "stale-rem-123",
		});
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.reason, "fresh");
		assert.notEqual(result.injectionId, "stale-rem-123");
		// The old one should be auto-acked in injections.jsonl
		const oldEntry = readInjectionById(stateRoot, "stale-rem-123");
		assert.ok(oldEntry);
		assert.equal(oldEntry.acked, true);
		// The new one should be present and un-acked
		assert.ok(result.injectionId, "fresh enqueue must produce an injectionId");
		const newEntry = readInjectionById(stateRoot, result.injectionId);
		assert.ok(newEntry);
		assert.equal(newEntry.acked, false);
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: escalates an existing un-acked reminder after 1h", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Setup: a real un-acked reminder 90min ago. The function should
		// escalate: same injectionId, severity=warning, decisionRequired=true.
		const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
		writeUnackedInjection(stateRoot, "stale-rem-456", ninetyMinAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: ninetyMinAgo,
			lastInjectionId: "stale-rem-456",
		});
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.escalated, true);
		assert.equal(result.reason, "escalated");
		assert.equal(result.injectionId, "stale-rem-456");
		// The injection in injections.jsonl must now be blocking.
		const entry = readInjectionById(stateRoot, "stale-rem-456");
		assert.ok(entry, "escalated injection must be present in injections.jsonl");
		assert.equal(entry.acked, false);
		const env = entry.decisionEnvelope as Record<string, unknown>;
		assert.equal(env.severity, "warning", "escalated severity must be warning");
		assert.equal(
			env.orchestratorDecisionRequired,
			true,
			"escalated injection must require orchestrator decision (PISO gate)",
		);
		// Sanity: no new entry should have been appended for this id.
		// (counting entries with this id should be 1, not 2)
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: dedup does NOT swallow the [1h, 4h) window for un-acked reminders", () => {
	// This test reproduces Finding D: with the old dedup condition
	// (`ageMs < DEDUP_WINDOW_MS = 4h`), a 2h-old un-acked reminder would
	// be deduped instead of escalated, leaving the PISO gate stuck in
	// "informative" state forever. With the fix (dedup uses
	// `ageMs < ESCALATE_AFTER_MS = 1h`), the 2h case escalates.
	const { stateRoot, cleanup } = makeRoot();
	try {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		writeUnackedInjection(stateRoot, "ignored-rem-789", twoHoursAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: twoHoursAgo,
			lastInjectionId: "ignored-rem-789",
		});
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(
			result.reason,
			"escalated",
			"2h-old un-acked reminder must escalate, not dedup (Finding D)",
		);
		assert.equal(result.escalated, true);
		const entry = readInjectionById(stateRoot, "ignored-rem-789");
		assert.equal(
			(entry?.decisionEnvelope as Record<string, unknown> | undefined)
				?.orchestratorDecisionRequired,
			true,
			"PISO gate must be triggered",
		);
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: writes objective-reminder.json state file", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enqueueObjectiveReminder({ stateRoot, planObjective: "Test objective" });
		const statePath = resolveObjectiveStatePath(stateRoot);
		assert.ok(existsSync(statePath));
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		assert.equal(typeof state.lastReminderAt, "string");
		assert.equal(typeof state.lastInjectionId, "string");
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: returns the canonical injection in injections.jsonl", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enqueueObjectiveReminder({ stateRoot, planObjective: "Test objective" });
		const content = readFileSync(resolveInjectionsPath(stateRoot), "utf8");
		const line = content.split("\n").find((l) => l.trim());
		assert.ok(line);
		const parsed = JSON.parse(line) as Record<string, unknown>;
		assert.equal(parsed.kind, "objective_reminder");
		assert.equal(parsed.acked, false);
		assert.equal(
			(parsed.decisionEnvelope as Record<string, unknown>)
				.orchestratorDecisionRequired,
			false,
		);
	} finally {
		cleanup();
	}
});

test("noteOrchestratorTurn: increments the turn counter", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const first = noteOrchestratorTurn({ stateRoot });
		assert.equal(first.turnCount, 1);
		const second = noteOrchestratorTurn({ stateRoot });
		assert.equal(second.turnCount, 2);
		const third = noteOrchestratorTurn({ stateRoot });
		assert.equal(third.turnCount, 3);
	} finally {
		cleanup();
	}
});

test("noteOrchestratorTurn: missing state file initializes to 1", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = noteOrchestratorTurn({ stateRoot });
		assert.equal(result.turnCount, 1);
	} finally {
		cleanup();
	}
});

test("resolveObjectiveStatePath: returns canonical path", () => {
	assert.equal(
		resolveObjectiveStatePath("/x/y"),
		join("/x/y", "objective-reminder.json"),
	);
});

test("resolveTurnCounterPath: returns canonical path", () => {
	assert.equal(
		resolveTurnCounterPath("/x/y"),
		join("/x/y", "last-orchestrator-turn.json"),
	);
});

test("readRecentSupervisorAdvisoriesForTest: returns empty when no file", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = readRecentSupervisorAdvisoriesForTest(stateRoot);
		assert.deepEqual(result, []);
	} finally {
		cleanup();
	}
});

test("OBJECTIVE_REMINDER_TIME_MS: is 1 hour (3_600_000)", () => {
	assert.equal(OBJECTIVE_REMINDER_TIME_MS, 3_600_000);
});

test("OBJECTIVE_REMINDER_ESCALATE_AFTER_MS: is 1 hour (3_600_000)", () => {
	assert.equal(OBJECTIVE_REMINDER_ESCALATE_AFTER_MS, 3_600_000);
});

test("OBJECTIVE_REMINDER_DEDUP_WINDOW_MS: is 4 hours", () => {
	assert.equal(OBJECTIVE_REMINDER_DEDUP_WINDOW_MS, 4 * 3_600_000);
});

test("OBJECTIVE_REMINDER_TASK_COUNT: is 10", () => {
	assert.equal(OBJECTIVE_REMINDER_TASK_COUNT, 10);
});

test("enqueueObjectiveReminder: does NOT crash when state file is corrupt", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const statePath = resolveObjectiveStatePath(stateRoot);
		writeFileSync(statePath, "this is not json", "utf8");
		// Should treat as "no recent reminder" and enqueue fresh
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
	} finally {
		cleanup();
	}
});

test("writeTurnCount helper: persists turn count", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		writeTurnCount(stateRoot, 42);
		assert.ok(existsSync(resolveTurnCounterPath(stateRoot)));
		const parsed = JSON.parse(
			readFileSync(resolveTurnCounterPath(stateRoot), "utf8"),
		);
		assert.equal(parsed.turnCount, 42);
	} finally {
		cleanup();
	}
});

// =========================================================================
// R2.3: `superseded` lifecycle event emitted by Case 3 auto-dedup
//
// These tests pin the D4 G1 (telemetry leak: acked without terminal event)
// + D4 G2 (superseded reserved as dead code) closure. Case 3 in
// enqueueObjectiveReminder is the single site that auto-acks a stale
// un-acked objective reminder and falls through to Case 4 to enqueue a
// fresh one. That semantic — "the old injection was replaced by a newer
// one" — is exactly the `superseded` lifecycle phase. The OLD injection
// ends up with BOTH `acked=true` (functional ack) AND a `superseded`
// terminal lifecycle event. These are complementary, not redundant.
// =========================================================================

/** Read the lifecycle telemetry log as parsed JSONL rows. */
function readTelemetryLog(stateRoot: string): Record<string, unknown>[] {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return [];
	const raw = readFileSync(path, "utf8");
	const out: Record<string, unknown>[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as Record<string, unknown>);
		} catch {
			// skip malformed (best-effort, mirrors the reader's contract)
		}
	}
	return out;
}

test("R2.3 Case 3: stale auto-dedup emits `superseded` lifecycle event for the OLD injection", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Setup: real un-acked reminder 5h ago — past DEDUP_WINDOW (4h).
		// Case 3 should fire: auto-ack the old one AND emit a `superseded`
		// lifecycle event for it.
		const fiveHoursAgo = new Date(
			Date.now() - 5 * 60 * 60 * 1000,
		).toISOString();
		writeUnackedInjection(stateRoot, "old-injection-1", fiveHoursAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: fiveHoursAgo,
			lastInjectionId: "old-injection-1",
		});

		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.reason, "fresh");

		// 1. The old injection must be auto-acked (acked=true).
		const oldEntry = readInjectionById(stateRoot, "old-injection-1");
		assert.ok(oldEntry, "old injection must still exist in injections.jsonl");
		assert.equal(
			oldEntry.acked,
			true,
			"Case 3 must auto-ack the stale injection",
		);

		// 2. The telemetry log must contain a `superseded` event for the
		//    OLD injection. A.1: the new enqueue (Case 4) also writes
		//    an `emitted` event for the NEW injection (auto-emit), so
		//    the log has >= 2 events total. We filter to the old
		//    injection's events.
		const events = readTelemetryLog(stateRoot);
		const oldEvents = events.filter(
			(e) => e.injectionId === "old-injection-1",
		);
		assert.equal(
			oldEvents.length,
			1,
			"exactly one lifecycle event must be emitted for the OLD injection",
		);
		const evt = oldEvents[0];
		assert.equal(
			evt.injectionId,
			"old-injection-1",
			"superseded event must target the OLD injection",
		);
		assert.equal(evt.phase, "superseded");
		assert.equal(evt.kind, "objective_reminder");
		assert.ok(
			typeof evt.reason === "string" &&
				(evt.reason as string).includes("auto-dedup") &&
				(evt.reason as string).includes("Case 4"),
			`reason must mention auto-dedup and Case 4; got: ${String(evt.reason)}`,
		);
		// Sanity: event must have a ts.
		assert.ok(typeof evt.ts === "string" && evt.ts.length > 0);
	} finally {
		cleanup();
	}
});

test("R2.3 negative control: recent un-acked reminder does NOT trigger `superseded` (Case 1/2 path, not Case 3)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Setup: real un-acked reminder 30min ago — well under
		// ESCALATE_AFTER (1h) and DEDUP_WINDOW (4h). Case 1 (dedup) fires,
		// Case 3 does NOT. Therefore no `superseded` event must be written.
		const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		writeUnackedInjection(stateRoot, "recent-1", thirtyMinAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: thirtyMinAgo,
			lastInjectionId: "recent-1",
		});

		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(
			result.enqueued,
			false,
			"Case 1 dedup: nothing should be enqueued",
		);
		assert.equal(result.reason, "dedup");

		// Telemetry log must be empty (no `superseded`, nothing else).
		const events = readTelemetryLog(stateRoot);
		assert.equal(
			events.length,
			0,
			`no lifecycle events must be emitted on the dedup path; got: ${JSON.stringify(events)}`,
		);
		// Sanity: the un-acked injection is still un-acked (Case 1 doesn't
		// touch the ledger).
		const entry = readInjectionById(stateRoot, "recent-1");
		assert.ok(entry);
		assert.equal(entry.acked, false);
	} finally {
		cleanup();
	}
});

test("R2.3 Case 3 fall-through: stale auto-dedup does NOT block Case 4 fresh enqueue", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Setup: stale un-acked reminder 5h ago. Case 3 must auto-ack
		// the old one AND fall through to Case 4 (fresh enqueue). Both
		// must happen: the JSONL must contain BOTH the auto-acked old
		// entry AND a new entry with a different injectionId.
		const fiveHoursAgo = new Date(
			Date.now() - 5 * 60 * 60 * 1000,
		).toISOString();
		writeUnackedInjection(stateRoot, "stale-fallthrough-1", fiveHoursAgo);
		writeReminderState(stateRoot, {
			lastReminderAt: fiveHoursAgo,
			lastInjectionId: "stale-fallthrough-1",
		});

		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(
			result.enqueued,
			true,
			"Case 4 must enqueue a fresh reminder after Case 3 auto-acks",
		);
		assert.equal(result.reason, "fresh");
		assert.ok(result.injectionId, "fresh enqueue must yield an injectionId");
		assert.notEqual(
			result.injectionId,
			"stale-fallthrough-1",
			"new injectionId must differ from the auto-acked old one",
		);

		// injections.jsonl must contain BOTH:
		// 1. The old injection, acked=true.
		const oldEntry = readInjectionById(
			stateRoot,
			"stale-fallthrough-1",
		);
		assert.ok(oldEntry, "old injection must still be in injections.jsonl");
		assert.equal(
			oldEntry.acked,
			true,
			"old injection must be auto-acked by Case 3",
		);
		// 2. The new injection, acked=false, kind=objective_reminder.
		const newEntry = readInjectionById(stateRoot, result.injectionId);
		assert.ok(
			newEntry,
			"Case 4 must append a new objective_reminder injection",
		);
		assert.equal(newEntry.kind, "objective_reminder");
		assert.equal(newEntry.acked, false);

		// And exactly one `superseded` event for the OLD one.
		// A.1: Case 4's auto-emit also writes an `emitted` event for
		// the NEW injection, so the log has >= 2 events total. We
		// filter to the old injection's events to count `superseded`.
		const events = readTelemetryLog(stateRoot);
		const oldEvents = events.filter(
			(e) => e.injectionId === "stale-fallthrough-1",
		);
		assert.equal(oldEvents.length, 1, "exactly 1 event for the OLD injection");
		assert.equal(oldEvents[0].injectionId, "stale-fallthrough-1");
		assert.equal(oldEvents[0].phase, "superseded");
	} finally {
		cleanup();
	}
});
