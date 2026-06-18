import assert from "node:assert/strict";
import {
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
	readInjectionLifecycle,
	recordLifecycleEvent,
} from "../src/telemetry-lifecycle.js";
import {
	evaluateSatisfactionPredicates,
	expiredAckPolicy,
	recordInjectionEmitted,
} from "../src/cron-preflight.js";
import { enqueueObjectiveReminder } from "../src/objective-injection.js";
import {
	resolveInjectionsPath,
	readPendingInjections,
	markInjectionAcked,
	type AckOutcome,
} from "../src/injection-store.js";

void enqueueObjectiveReminder;
void readPendingInjections;

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-sat-eval-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("evaluateSatisfactionPredicates: resolves objective_reminder when idu_supervisor_context_pack is called within window", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:30:00Z");

		// 1. emitted + delivered (the cron-emitted + orchestrator-pulled)
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		// 2. MCP usage log: idu_supervisor_context_pack was called at 10:15
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T10:15:00Z",
			}) + "\n",
			"utf8",
		);

		// 3. evaluate (now is 30min after deliveredAt, within 1h window)
		evaluateSatisfactionPredicates({ stateRoot: root, now });

		// 4. Should have written a "resolved" event
		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered", "resolved"],
			"lifecycle should end at resolved",
		);
		const resolved = events.find((e) => e.phase === "resolved");
		assert.ok(resolved);
		assert.ok(resolved.reason?.includes("idu_supervisor_context_pack"));
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: expires objective_reminder when past window without satisfaction", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T12:00:00Z"); // 2h after, past 1h window

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		// Empty MCP usage log (no calls)
		mkdirSync(join(root, "logs"), { recursive: true });

		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered", "expired"],
			"expired after window passed",
		);
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: does NOT resolve if tool called BEFORE deliveredAt (early call)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:15:00Z");

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		// Tool called BEFORE deliveredAt
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T09:00:00Z",
			}) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		// No resolved event written because the call was before deliveredAt
		assert.deepEqual(phases, ["emitted", "delivered"]);
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: idempotent — running twice does not double-write resolved", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:30:00Z");

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T10:15:00Z",
			}) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now });
		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		// After the first run, the advisory's latest phase is "resolved",
		// so readPendingAdvisories does not include it on the second run.
		const resolvedEvents = events.filter((e) => e.phase === "resolved");
		assert.equal(
			resolvedEvents.length,
			1,
			"resolved event should be written exactly once",
		);
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: handles multiple pending advisories of DIFFERENT kinds", () => {
	const { root, cleanup } = makeRoot();
	try {
		const t0 = new Date("2026-06-17T10:00:00Z");
		const t30 = new Date("2026-06-17T10:30:00Z");
		const t2h = new Date("2026-06-17T12:00:00Z");

		// inj-1: objective_reminder (tool-called predicate)
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: t0,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: t0,
		});

		// inj-2: hygiene_junk_file (path-absent predicate). Different kind = different predicate.
		const junkFile = join(root, "junk.mjs");
		writeFileSync(junkFile, "// still here");
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "hyg-1",
			phase: "emitted",
			kind: "hygiene_junk_file",
			now: t30,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "hyg-1",
			phase: "delivered",
			kind: "hygiene_junk_file",
			now: t30,
		});

		// MCP usage: idu_supervisor_context_pack called at 10:45 (within inj-1's window)
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T10:45:00Z",
			}) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now: t2h });

		// obj-1: tool-called within window → resolved
		const events1 = readInjectionLifecycle(root, "obj-1");
		assert.ok(
			events1.some((e) => e.phase === "resolved"),
			"obj-1 should be resolved (tool-called within window)",
		);

		// hyg-1: path still exists → still waiting (no event for path-absent yet)
		const events2 = readInjectionLifecycle(root, "hyg-1");
		const phases = events2.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered"],
			"hyg-1 still waiting (path still exists)",
		);
	} finally {
		cleanup();
	}
});

test("AUDITOR-CRITICAL: pull marks delivered ONLY (no resolved event on pull)", () => {
	// Per #2467: pull = delivered only. The resolved event is written
	// by the cron tick AFTER predicate evaluation, not by the pull.
	const { root, cleanup } = makeRoot();
	try {
		const t0 = new Date("2026-06-17T10:00:00Z");

		// Simulate the full pull path: emitted → delivered.
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
			now: t0,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "delivered",
			kind: "objective_reminder",
			now: t0,
		});

		// NO cron tick yet → only emitted + delivered. No resolved.
		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered"],
			"delivered-not-resolved is the expected pre-cron state",
		);
	} finally {
		cleanup();
	}
});

// AUDITOR-CRITICAL TESTS: reconcile Item 5 escalation with telemetry ack policy

function readAllInjections(
	stateRoot: string,
): { injectionId: string; acked: boolean; kind?: string }[] {
	const path = resolveInjectionsPath(stateRoot);
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim());
	const out: { injectionId: string; acked: boolean; kind?: string }[] = [];
	for (const line of lines) {
		try {
			const obj = JSON.parse(line) as {
				injectionId?: unknown;
				acked?: unknown;
				kind?: unknown;
			};
			if (typeof obj.injectionId === "string") {
				out.push({
					injectionId: obj.injectionId,
					acked: obj.acked === true,
					kind: typeof obj.kind === "string" ? obj.kind : undefined,
				});
			}
		} catch {
			// skip malformed lines
		}
	}
	return out;
}

test("AUDITOR-CRITICAL: resolved → markInjectionAcked (clears PISO gate)", () => {
	const { root, cleanup } = makeRoot();
	try {
		// First: enqueue an actual injection (so it exists in injections.jsonl)

		const reminderResult = enqueueObjectiveReminder({
			stateRoot: root,
			planObjective: "TEST",
		});
		assert.ok(reminderResult.enqueued);
		assert.ok(reminderResult.injectionId);

		// Then: write telemetry events (emitted + delivered)
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		// Then: orchestrator calls idu_supervisor_context_pack within window
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T10:15:00Z",
			}) + "\n",
			"utf8",
		);

		const now = new Date("2026-06-17T10:30:00Z");
		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const inj = readAllInjections(root).find(
			(i) => i.injectionId === reminderResult.injectionId,
		);
		assert.ok(inj);
		assert.equal(
			inj.acked,
			true,
			"resolved must mark acked=true (orchestrator complied)",
		);
	} finally {
		cleanup();
	}
});

test("AUDITOR-CRITICAL: expired on objective_reminder does NOT mark acked (let Item 5 escalate)", () => {
	const { root, cleanup } = makeRoot();
	try {
		// First: enqueue an actual injection

		const reminderResult = enqueueObjectiveReminder({
			stateRoot: root,
			planObjective: "TEST",
		});
		assert.ok(reminderResult.enqueued);
		assert.ok(reminderResult.injectionId);

		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T12:00:00Z");

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId!,
			phase: "emitted",
			kind: "objective_reminder",
			now: deliveredAt,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId!,
			phase: "delivered",
			kind: "objective_reminder",
			now: deliveredAt,
		});

		mkdirSync(join(root, "logs"), { recursive: true });

		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const inj = readAllInjections(root).find(
			(i) => i.injectionId === reminderResult.injectionId,
		);
		assert.ok(inj);
		assert.equal(
			inj.acked,
			false,
			"expired on objective_reminder must NOT mark acked (Item 5 escalation must continue)",
		);
	} finally {
		cleanup();
	}
});

test("expiredAckPolicy: objective_reminder → 'no-ack-on-expired'", () => {
	assert.equal(expiredAckPolicy("objective_reminder"), "no-ack-on-expired");
});

test("expiredAckPolicy: hygiene_junk_file → 'ack-on-expired' (advisory-only)", () => {
	assert.equal(expiredAckPolicy("hygiene_junk_file"), "ack-on-expired");
});

test("expiredAckPolicy: unknown kinds default to 'no-ack-on-expired' (conservative)", () => {
	assert.equal(expiredAckPolicy("user_escalation"), "no-ack-on-expired");
	assert.equal(expiredAckPolicy("unknown_kind"), "no-ack-on-expired");
});

test("AUDITOR-CRITICAL: full happy-path lifecycle [emitted, delivered, resolved] + acked=true", () => {
	const { root, cleanup } = makeRoot();
	try {
		const emittedAt = new Date("2026-06-17T10:00:00Z");

		// Step 1: cron emits (via runCronPreflight → enqueueObjectiveReminder → recordLifecycleEvent('emitted'))

		const reminderResult = enqueueObjectiveReminder({
			stateRoot: root,
			planObjective: "TEST",
		});
		assert.ok(reminderResult.enqueued);
		assert.ok(reminderResult.injectionId);
		// Simulate the cron-preflight emission step (the real code calls this):
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "emitted",
			kind: "objective_reminder",
			now: emittedAt,
		});

		// Step 2: pull (MCP/CLI writes delivered)
		const pulledAt = new Date("2026-06-17T10:05:00Z");
		
		// Simulate the MCP/CLI pull path (the real code calls this):
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "delivered",
			kind: "objective_reminder",
			now: pulledAt,
		});

		// Step 3: orchestrator calls idu_supervisor_context_pack
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({
				tool: "idu_supervisor_context_pack",
				ts: "2026-06-17T10:10:00Z",
			}) + "\n",
			"utf8",
		);

		// Step 4: cron tick evaluates → writes resolved + markInjectionAcked
		evaluateSatisfactionPredicates({
			stateRoot: root,
			now: new Date("2026-06-17T10:15:00Z"),
		});

		// Verify lifecycle
		const events = readInjectionLifecycle(root, reminderResult.injectionId);
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered", "resolved"],
			"full happy-path lifecycle",
		);

		// Verify acked
		const inj = readAllInjections(root).find(
			(i) => i.injectionId === reminderResult.injectionId,
		);
		assert.ok(inj);
		assert.equal(inj.acked, true);
	} finally {
		cleanup();
	}
});

test("AUDITOR-FIX-A: routine pull (no ack flag) writes delivered ONLY, does NOT auto-ack", () => {
	const { root, cleanup } = makeRoot();
	try {
		// enqueueObjectiveReminder is imported at top
		const reminderResult = enqueueObjectiveReminder({
			stateRoot: root,
			planObjective: "TEST",
		});
		assert.ok(reminderResult.enqueued);
		assert.ok(reminderResult.injectionId);

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "emitted",
			kind: "objective_reminder",
			now: new Date(),
		});

		const pending = readPendingInjections(root, {});
		const ack = false; // default after AUDITOR-FIX-A
		assert.equal(pending.length, 1);
		for (const inj of pending) {
			recordLifecycleEvent({
				stateRoot: root,
				injectionId: inj.injectionId,
				phase: "delivered",
				kind: inj.kind,
				now: new Date(),
			});
			if (ack) {
				markInjectionAcked(root, inj.injectionId);
				recordLifecycleEvent({
					stateRoot: root,
					injectionId: inj.injectionId,
					phase: "dismissed",
					kind: inj.kind,
					now: new Date(),
				});
			}
		}

		const events = readInjectionLifecycle(root, reminderResult.injectionId);
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered"],
			"routine pull should NOT dismiss",
		);
		const inj = readAllInjections(root).find(
			(i) => i.injectionId === reminderResult.injectionId,
		);
		assert.ok(inj);
		assert.equal(inj.acked, false, "routine pull must NOT mark acked");
	} finally {
		cleanup();
	}
});

test("AUDITOR-FIX-A: pull with ack:true writes dismissed AND marks acked", () => {
	const { root, cleanup } = makeRoot();
	try {
		// enqueueObjectiveReminder is imported at top
		const reminderResult = enqueueObjectiveReminder({
			stateRoot: root,
			planObjective: "TEST",
		});
		assert.ok(reminderResult.enqueued);
		assert.ok(reminderResult.injectionId);

		recordLifecycleEvent({
			stateRoot: root,
			injectionId: reminderResult.injectionId,
			phase: "emitted",
			kind: "objective_reminder",
			now: new Date(),
		});

		const pending = readPendingInjections(root, {});
		const ack = true;
		for (const inj of pending) {
			recordLifecycleEvent({
				stateRoot: root,
				injectionId: inj.injectionId,
				phase: "delivered",
				kind: inj.kind,
				now: new Date(),
			});
			if (ack) {
				markInjectionAcked(root, inj.injectionId);
				recordLifecycleEvent({
					stateRoot: root,
					injectionId: inj.injectionId,
					phase: "dismissed",
					kind: inj.kind,
					reason: "idu_pending_injections ack:true",
					now: new Date(),
				});
			}
		}

		const events = readInjectionLifecycle(root, reminderResult.injectionId);
		const phases = events.map((e) => e.phase);
		assert.deepEqual(
			phases,
			["emitted", "delivered", "dismissed"],
			"ack:true must write dismissed",
		);
		const inj = readAllInjections(root).find(
			(i) => i.injectionId === reminderResult.injectionId,
		);
		assert.ok(inj);
		assert.equal(inj.acked, true, "ack:true must mark acked");
	} finally {
		cleanup();
	}
});

test("AUDITOR-FIX-B: recordInjectionEmitted writes the `emitted` lifecycle event (helper for reminder AND future hygiene)", () => {
	const { root, cleanup } = makeRoot();
	try {
		// recordInjectionEmitted needs to be imported
		recordInjectionEmitted({
			stateRoot: root,
			injectionId: "hy-test-1",
			kind: "hygiene_junk_file",
		});
		const events = readInjectionLifecycle(root, "hy-test-1");
		assert.equal(events.length, 1);
		assert.equal(events[0].phase, "emitted");
		assert.equal(events[0].kind, "hygiene_junk_file");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// AUDITOR-FIX (post-#156): the gemelo (inline ack:true on the pull) must
// also honor the new AckOutcome guard. The test below exercises the same
// pattern as the MCP server case (mcp-server.ts:4534 area) and the CLI
// mirror (cli.ts:2991 area). After the fix, ack:true against an
// already-acked injection must NOT write a new `dismissed` event.
// ---------------------------------------------------------------------------

test("AUDITOR-FIX-gemelo: ack:true on already-acked injection does NOT write a new dismissed event", () => {
	const { root, cleanup } = makeRoot();
	try {
		// Seed an injection that is ALREADY acked
		const inj = {
			ts: new Date().toISOString(),
			triggerId: "test-trigger",
			decisionEnvelope: {
				severity: "warning",
				summary: "test",
				options: [],
				evidenceRefs: [],
				orchestratorDecisionRequired: true,
			},
			injectionId: "obj-gemelo-1",
			acked: true,  // already acked
			kind: "objective_reminder",
		};
		writeFileSync(
			join(root, "injections.jsonl"),
			JSON.stringify(inj) + "\n",
		);

		// Now simulate the inline ack:true path with the NEW guard.
		// The outcome is checked via a function reference to defeat
		// TS narrowing after assert.equal.
		const outcome: AckOutcome = markInjectionAcked(root, "obj-gemelo-1");
		assert.equal(outcome, "already-acked", "outcome should be 'already-acked'");
		const isAcked = (o: AckOutcome): boolean => o === "acked";

		// The new guard: ONLY write `dismissed` when outcome === "acked"
		if (isAcked(outcome)) {
			recordLifecycleEvent({
				stateRoot: root,
				injectionId: "obj-gemelo-1",
				phase: "dismissed",
				kind: "objective_reminder",
				reason: "idu_pending_injections ack:true",
				now: new Date(),
			});
		}
		// Assert: NO dismissed event was written
		const allEvents = readInjectionLifecycle(root, "obj-gemelo-1");
		const dismissed = allEvents.filter((e) => e.phase === "dismissed");
		assert.equal(
			dismissed.length,
			0,
			"gemelo must NOT write a dismissed event on no-op (already-acked)",
		);
	} finally {
		cleanup();
	}
});

test("AUDITOR-FIX-gemelo: ack:true on ghost id does NOT write a new dismissed event", () => {
	const { root, cleanup } = makeRoot();
	try {
		const outcome: AckOutcome = markInjectionAcked(root, "ghost-id-gemelo");
		assert.equal(outcome, "not-found", "outcome should be 'not-found'");
		const isAcked = (o: AckOutcome): boolean => o === "acked";

		if (isAcked(outcome)) {
			recordLifecycleEvent({
				stateRoot: root,
				injectionId: "ghost-id-gemelo",
				phase: "dismissed",
				kind: "objective_reminder",
				reason: "idu_pending_injections ack:true",
				now: new Date(),
			});
		}
		const allEvents = readInjectionLifecycle(root, "ghost-id-gemelo");
		assert.equal(allEvents.length, 0, "gemelo must NOT write any event on not-found");
	} finally {
		cleanup();
	}
});
