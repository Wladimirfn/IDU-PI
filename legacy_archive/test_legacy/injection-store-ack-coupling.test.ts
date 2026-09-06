/**
 * injection-store-ack-coupling.test.ts — A.2 acceptance tests.
 *
 * The core invariant post-A.2: it is structurally impossible to mark
 * an injection as acked (on a real transition) without emitting the
 * corresponding terminal lifecycle event. The leak class "called
 * markInjectionAcked and forgot the manual emit" is closed. The
 * phantom-dismissal guard from the #156 audit is preserved INSIDE
 * `markInjectionAcked` — the auto-emit fires ONLY on
 * `outcome === "acked"`, never on `already-acked` or `not-found`.
 *
 * The cron exception (cron-preflight.ts) is also pinned: that
 * caller's three `markInjectionAcked` callsites stay WITHOUT
 * `{ phase }`, so its manual pre-ack emits do not double-fire.
 *
 * References issue #186.
 */

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
import { after, test } from "node:test";
import {
	appendInjection,
	markInjectionAcked,
	resolveInjectionsPath,
	type AckOutcome,
	type Injection,
} from "../src/injection-store.js";
import {
	enqueueObjectiveReminder,
	resolveObjectiveStatePath,
} from "../src/objective-injection.js";
import { evaluateSatisfactionPredicates } from "../src/cron-preflight.js";
import { ackAdvisory } from "../src/idu-ack-advisory.js";
import { recordLifecycleEvent } from "../src/telemetry-lifecycle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-a2-ack-coupling-"));
	roots.push(root);
	return root;
}

after(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function readTelemetry(stateRoot: string): Array<Record<string, unknown>> {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function eventsFor(
	stateRoot: string,
	injectionId: string,
): Array<Record<string, unknown>> {
	return readTelemetry(stateRoot).filter(
		(e) => e.injectionId === injectionId,
	);
}

function makeEnvelope(overrides: Partial<Injection> = {}): Injection {
	return {
		ts: new Date().toISOString(),
		triggerId: "a2_test",
		decisionEnvelope: {
			severity: "info",
			summary: "test injection for A.2 ack coupling",
			options: ["ack"],
			evidenceRefs: ["piso:a2_test"],
			orchestratorDecisionRequired: false,
		},
		injectionId: `inj-a2-${Math.random().toString(36).slice(2, 10)}`,
		acked: false,
		kind: "objective_reminder",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Test 1: auto-emit on `acked`
// ---------------------------------------------------------------------------

test("A.2: markInjectionAcked auto-emits exactly one terminal event on a real transition", () => {
	const stateRoot = freshRoot();
	// Seed an un-acked injection.
	const inj = makeEnvelope({ injectionId: "a2-acked-1" });
	appendInjection(stateRoot, inj);

	// Before the ack: telemetry has 1 `emitted` event (A.1 auto-emit).
	const before = eventsFor(stateRoot, "a2-acked-1");
	assert.equal(before.length, 1, "A.1 auto-emit must have produced 1 event");
	assert.equal(before[0].phase, "emitted");

	// Now ack with phase: "dismissed".
	const outcome: AckOutcome = markInjectionAcked(
		stateRoot,
		"a2-acked-1",
		{ phase: "dismissed", reason: "test dismiss" },
	);
	assert.equal(outcome, "acked", "fresh un-acked injection must yield 'acked'");

	// After: telemetry must contain exactly 1 additional `dismissed` event.
	const afterEvents = eventsFor(stateRoot, "a2-acked-1");
	assert.equal(
		afterEvents.length,
		2,
		"auto-emit must produce exactly one new terminal event",
	);
	const dismissed = afterEvents.find((e) => e.phase === "dismissed");
	assert.ok(dismissed, "dismissed event must be present");
	assert.equal(dismissed.injectionId, "a2-acked-1");
	assert.equal(dismissed.reason, "test dismiss");
	assert.equal(dismissed.kind, "objective_reminder");
});

// ---------------------------------------------------------------------------
// Test 2: NO auto-emit on `already-acked` (phantom guard #1)
// ---------------------------------------------------------------------------

test("A.2: markInjectionAcked on already-acked injection does NOT emit a second terminal event (phantom guard)", () => {
	const stateRoot = freshRoot();
	const inj = makeEnvelope({ injectionId: "a2-already-acked-1" });
	appendInjection(stateRoot, inj);

	// First call: real transition → 1 dismissed event emitted.
	const outcome1 = markInjectionAcked(stateRoot, "a2-already-acked-1", {
		phase: "dismissed",
		reason: "first",
	});
	assert.equal(outcome1, "acked");

	const afterFirst = eventsFor(stateRoot, "a2-already-acked-1");
	assert.equal(afterFirst.length, 2, "1 emitted + 1 dismissed after first ack");
	const firstDismissedCount = afterFirst.filter(
		(e) => e.phase === "dismissed",
	).length;
	assert.equal(firstDismissedCount, 1);

	// Second call: already-acked → must NOT emit a second dismissed.
	const outcome2 = markInjectionAcked(stateRoot, "a2-already-acked-1", {
		phase: "dismissed",
		reason: "second",
	});
	assert.equal(outcome2, "already-acked", "second call must yield 'already-acked'");

	const afterSecond = eventsFor(stateRoot, "a2-already-acked-1");
	assert.equal(
		afterSecond.length,
		2,
		"no new terminal event on already-acked (phantom-dismissal guard)",
	);
	const finalDismissedCount = afterSecond.filter(
		(e) => e.phase === "dismissed",
	).length;
	assert.equal(
		finalDismissedCount,
		1,
		"exactly 1 dismissed event total — the second ack was a no-op",
	);
});

// ---------------------------------------------------------------------------
// Test 3: NO auto-emit on `not-found` (phantom guard #2)
// ---------------------------------------------------------------------------

test("A.2: markInjectionAcked on ghost id does NOT emit any terminal event (phantom guard)", () => {
	const stateRoot = freshRoot();
	const outcome = markInjectionAcked(stateRoot, "ghost-id-a2", {
		phase: "dismissed",
		reason: "phantom",
	});
	assert.equal(outcome, "not-found");
	// Telemetry log must be empty — no event of any kind.
	const events = readTelemetry(stateRoot);
	assert.equal(
		events.length,
		0,
		`no events must be emitted on not-found; got: ${JSON.stringify(events)}`,
	);
});

// ---------------------------------------------------------------------------
// Test 4: Case 3 superseded via central markInjectionAcked
// ---------------------------------------------------------------------------

test("A.2: Case 3 superseded (objective-injection.ts) emits `superseded` via the central ack coupling", () => {
	const stateRoot = freshRoot();
	// Seed an un-acked objective_reminder injection 5h ago (past
	// DEDUP_WINDOW of 4h). This is the canonical Case 3 trigger.
	const fiveHoursAgo = new Date(
		Date.now() - 5 * 60 * 60 * 1000,
	).toISOString();
	const injectionsPath = resolveInjectionsPath(stateRoot);
	mkdirSync(stateRoot, { recursive: true });
	const oldInj = makeEnvelope({
		injectionId: "a2-old-superseded",
		ts: fiveHoursAgo,
	});
	writeFileSync(injectionsPath, `${JSON.stringify(oldInj)}\n`, "utf8");

	// Write the objective-reminder state file so enqueueObjectiveReminder
	// can read lastInjectionId + lastReminderAt.
	const statePath = resolveObjectiveStatePath(stateRoot);
	writeFileSync(
		statePath,
		JSON.stringify(
			{
				lastReminderAt: fiveHoursAgo,
				lastEscalationAt: null,
				turnsSinceLastReminder: 0,
				lastInjectionId: "a2-old-superseded",
			},
			null,
			2,
		),
		"utf8",
	);

	// Trigger the enqueue — Case 3 fires and the central
	// markInjectionAcked must auto-emit `superseded`.
	const result = enqueueObjectiveReminder({
		stateRoot,
		planObjective: "A.2 test",
	});
	assert.equal(result.enqueued, true);
	assert.equal(result.reason, "fresh");
	assert.notEqual(result.injectionId, "a2-old-superseded");

	// The OLD injection's telemetry must have exactly 1 `superseded` event.
	const oldEvents = eventsFor(stateRoot, "a2-old-superseded");
	assert.equal(
		oldEvents.length,
		1,
		`exactly 1 event for the OLD injection; got: ${JSON.stringify(oldEvents)}`,
	);
	assert.equal(oldEvents[0].phase, "superseded");
	assert.equal(oldEvents[0].injectionId, "a2-old-superseded");
	assert.equal(oldEvents[0].kind, "objective_reminder");
	assert.ok(
		typeof oldEvents[0].reason === "string" &&
			(oldEvents[0].reason as string).includes("auto-dedup"),
		`reason must mention auto-dedup; got: ${String(oldEvents[0].reason)}`,
	);
});

// ---------------------------------------------------------------------------
// Test 5: cron pre-ack emits STAY (positive test that pins the exception)
// ---------------------------------------------------------------------------

test("A.2: cron pre-ack manual `expired` emit fires, and cron ack callsite stays WITHOUT `{ phase }` (documented exception)", () => {
	const stateRoot = freshRoot();
	// Seed a supervisor_advisory injection 25h ago (past 24h default-expiry
	// window). It has no satisfaction predicate (F-W2-2 path), so the cron
	// emits `expired` PRE-ACK and then calls markInjectionAcked WITHOUT
	// `{ phase }` to avoid double-emit.
	const twentyFiveHoursAgo = new Date(
		Date.now() - 25 * 60 * 60 * 1000,
	).toISOString();
	const injectionsPath = resolveInjectionsPath(stateRoot);
	mkdirSync(stateRoot, { recursive: true });
	const sa = makeEnvelope({
		injectionId: "a2-cron-sa-1",
		ts: twentyFiveHoursAgo,
		kind: "supervisor_advisory",
	});
	writeFileSync(injectionsPath, `${JSON.stringify(sa)}\n`, "utf8");
	// emitted + delivered phases required for readPendingAdvisories to surface it.
	recordLifecycleEvent({
		stateRoot,
		injectionId: "a2-cron-sa-1",
		phase: "emitted",
		kind: "supervisor_advisory",
		now: new Date(twentyFiveHoursAgo),
	});
	recordLifecycleEvent({
		stateRoot,
		injectionId: "a2-cron-sa-1",
		phase: "delivered",
		kind: "supervisor_advisory",
		now: new Date(twentyFiveHoursAgo),
	});

	// Trigger the cron path.
	evaluateSatisfactionPredicates({
		stateRoot,
		now: new Date(),
	});

	// The cron MUST have written exactly 1 `expired` event for this injection.
	const events = eventsFor(stateRoot, "a2-cron-sa-1");
	const expired = events.filter((e) => e.phase === "expired");
	assert.equal(
		expired.length,
		1,
		`cron must write exactly 1 expired event for kinds-without-predicate past default-expiry window; got: ${JSON.stringify(events)}`,
	);
	assert.equal(expired[0].kind, "supervisor_advisory");

	// And the injection must be acked (ack-on-expired policy for supervisor_advisory).
	const lines = readFileSync(injectionsPath, "utf8")
		.split("\n")
		.filter(Boolean);
	const parsed = JSON.parse(lines[0]) as { acked?: boolean };
	assert.equal(
		parsed.acked,
		true,
		"supervisor_advisory past 24h must be acked by the cron (ack-on-expired policy)",
	);

	// Source-of-truth documentation test: the cron's callsite stays
	// without the 3rd argument. We import the source as a string and
	// assert the call site. This is a static test — if someone tries
	// to "uniformize" the cron by passing `{ phase }`, this fails.
	const cronSrc = readFileSync(
		join(process.cwd(), "src", "cron-preflight.ts"),
		"utf8",
	);
	// Each callsite must match the pattern `markInjectionAcked(stateRoot, id)` — NOT
	// `markInjectionAcked(stateRoot, id, { phase: ... })`. Use a regex that
	// matches `markInjectionAcked(...)` with exactly 2 args (the stateRoot
	// and injectionId). We accept trailing whitespace/comments before the `)`.
	const callsiteRegex =
		/markInjectionAcked\(\s*[a-zA-Z_$.]+\s*,\s*[a-zA-Z_$.]+\s*\)/g;
	const matches = cronSrc.match(callsiteRegex) ?? [];
	// The cron has exactly 3 callsites of markInjectionAcked (the documented count).
	assert.equal(
		matches.length,
		3,
		`cron must have exactly 3 markInjectionAcked callsites WITHOUT a third argument; found ${matches.length}. Matches: ${JSON.stringify(matches)}`,
	);

	// Defensive negative: NO callsite passes `{ phase:` to markInjectionAcked.
	assert.ok(
		!/markInjectionAcked\([^)]*\{\s*phase\s*:/u.test(cronSrc),
		"cron MUST NOT pass `{ phase }` to markInjectionAcked — the cron is the documented exception",
	);

	// Defensive positive: cron still emits the terminal event manually.
	const manualEmitRegex = /recordLifecycleEvent\(\s*\{[\s\S]*?phase:\s*"(?:expired|resolved)"/gu;
	const manualEmitCount = (cronSrc.match(manualEmitRegex) ?? []).length;
	assert.ok(
		manualEmitCount >= 3,
		`cron must keep its manual pre-ack emits; expected >= 3, found ${manualEmitCount}`,
	);
});

// ---------------------------------------------------------------------------
// Test 6: ackAdvisory still produces a `dismissed` event (no regression)
// ---------------------------------------------------------------------------

test("A.2: ackAdvisory still writes exactly one `dismissed` event on a real transition (no regression)", () => {
	const stateRoot = freshRoot();
	const inj = makeEnvelope({ injectionId: "a2-ackadvisory-1" });
	appendInjection(stateRoot, inj);

	const result = ackAdvisory({
		stateRoot,
		injectionId: "a2-ackadvisory-1",
		reason: "test escape hatch",
	});
	assert.equal(result.acked, true);
	assert.equal(result.status, "acked");

	const events = eventsFor(stateRoot, "a2-ackadvisory-1");
	const dismissed = events.filter((e) => e.phase === "dismissed");
	assert.equal(
		dismissed.length,
		1,
		`ackAdvisory must write exactly 1 dismissed event on real transition; got: ${JSON.stringify(events)}`,
	);
	assert.equal(dismissed[0].reason, "test escape hatch");
	assert.equal(dismissed[0].kind, "objective_reminder");
});

test("A.2: ackAdvisory on already-acked injection does NOT write a phantom dismissed (no regression)", () => {
	const stateRoot = freshRoot();
	const inj = makeEnvelope({ injectionId: "a2-ackadvisory-2" });
	appendInjection(stateRoot, inj);

	// First ack — real transition.
	const r1 = ackAdvisory({ stateRoot, injectionId: "a2-ackadvisory-2" });
	assert.equal(r1.acked, true);
	const after1 = eventsFor(stateRoot, "a2-ackadvisory-2").filter(
		(e) => e.phase === "dismissed",
	);
	assert.equal(after1.length, 1);

	// Second ack — already-acked. Must NOT write a second dismissed.
	const r2 = ackAdvisory({ stateRoot, injectionId: "a2-ackadvisory-2" });
	assert.equal(r2.acked, false);
	assert.equal(r2.status, "already-acked");
	const after2 = eventsFor(stateRoot, "a2-ackadvisory-2").filter(
		(e) => e.phase === "dismissed",
	);
	assert.equal(
		after2.length,
		1,
		"ackAdvisory on already-acked must NOT write a second dismissed event",
	);
});
