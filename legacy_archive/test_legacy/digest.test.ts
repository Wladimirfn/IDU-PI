import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendDigestQueueEntry,
	buildDigestInjection,
	classifyInterrupt,
	clearDigestQueue,
	maybeFlushDigest,
	readDigestQueue,
	readDigestSchedule,
	resolveDigestQueuePath,
	resolveDigestSchedulePath,
	saveDigestSchedule,
	type DigestSignal,
} from "../src/digest.js";
import { readPendingInjections } from "../src/injection-store.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-digest-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function localDate(hour: number, minute: number): Date {
	return new Date(2026, 5, 12, hour, minute, 0, 0);
}

function signal(overrides: Partial<DigestSignal> = {}): DigestSignal {
	return {
		id: "task-1",
		kind: "task_stuck",
		domain: "stale_work",
		severity: "warning",
		riskLevel: "medium",
		summary: "Task has been stale for two hours",
		requiredAction: "Review task-1 when convenient",
		evidenceRefs: ["task:task-1"],
		...overrides,
	};
}

test("classifyInterrupt routes critical security/db/data-loss signals immediately, not high severity", () => {
	assert.equal(classifyInterrupt(signal({ domain: "security" })), "immediate");
	assert.equal(classifyInterrupt(signal({ domain: "db" })), "immediate");
	assert.equal(
		classifyInterrupt(signal({ riskHints: ["data_loss"] })),
		"immediate",
	);
	assert.equal(
		classifyInterrupt(signal({ riskHints: ["db_change"] })),
		"immediate",
	);
	assert.equal(
		classifyInterrupt(signal({ riskHints: ["security"] })),
		"immediate",
	);
	// Per the supervisor-main profile policy: only security/db/data-loss
	// (critical signals) interrupt; high severity alone does NOT
	// interrupt and goes to the digest. This is the W1 fix.
	assert.equal(
		classifyInterrupt(signal({ domain: "stale_work", riskLevel: "high" })),
		"digest",
	);
	assert.equal(
		classifyInterrupt(signal({ domain: "stale_work", guardRisk: "high" })),
		"digest",
	);
	assert.equal(
		classifyInterrupt(signal({ domain: "backlog", riskLevel: "medium" })),
		"digest",
	);
	assert.equal(classifyInterrupt(signal({ riskLevel: "low" })), "digest");
	assert.equal(
		classifyInterrupt(signal({ domain: "stale_work", severity: "high" })),
		"digest",
	);
});

test("buildDigestInjection returns a stable non-critical digest injection", () => {
	const now = localDate(14, 5);
	const first = signal({ id: "task-1", domain: "stale_work" });
	const second = signal({
		id: "lab-1",
		kind: "agentlab_finding_ready",
		domain: "agentlab",
		summary: "AgentLab finding ready",
		requiredAction: "Review AgentLab finding",
		evidenceRefs: ["lab:1"],
	});

	const injection = buildDigestInjection([first, second], now);
	const same = buildDigestInjection([first, second], now);

	assert.equal(injection.triggerId, "non_critical_digest");
	assert.equal(injection.ts, now.toISOString());
	assert.equal(injection.acked, false);
	assert.equal(injection.injectionId, same.injectionId);
	assert.equal(injection.decisionEnvelope.severity, "info");
	assert.equal(injection.decisionEnvelope.orchestratorDecisionRequired, false);
	assert.match(injection.decisionEnvelope.summary, /task_stuck/u);
	assert.match(injection.decisionEnvelope.summary, /agentlab_finding_ready/u);
	assert.deepEqual(injection.decisionEnvelope.evidenceRefs, [
		"task:task-1",
		"lab:1",
	]);
});

test("digest queue appends, reads, and clears JSONL safely", () => {
	const root = freshRoot();
	appendDigestQueueEntry(root, signal({ id: "task-1" }));
	appendDigestQueueEntry(root, signal({ id: "task-2" }));

	assert.equal(readDigestQueue(root).length, 2);
	assert.equal(readDigestQueue(root)[0]?.id, "task-1");
	assert.equal(existsSync(resolveDigestQueuePath(root)), true);

	clearDigestQueue(root);
	assert.deepEqual(readDigestQueue(root), []);
	assert.equal(readFileSync(resolveDigestQueuePath(root), "utf8"), "");
});

test("digest schedule defaults and round-trips", () => {
	const root = freshRoot();
	assert.deepEqual(readDigestSchedule(root), {
		version: 1,
		slotsLocal: ["09:00", "14:00", "19:00"],
	});

	saveDigestSchedule(root, {
		version: 1,
		slotsLocal: ["10:00"],
		lastFlushAt: "2026-06-12T10:05:00.000Z",
	});

	assert.equal(existsSync(resolveDigestSchedulePath(root)), true);
	assert.deepEqual(readDigestSchedule(root), {
		version: 1,
		slotsLocal: ["10:00"],
		lastFlushAt: "2026-06-12T10:05:00.000Z",
	});
});

test("maybeFlushDigest does not flush before the first due slot", () => {
	const root = freshRoot();
	appendDigestQueueEntry(root, signal());

	const result = maybeFlushDigest({
		stateRoot: root,
		now: localDate(8, 59),
	});

	assert.deepEqual(result, { flushed: false, signalCount: 1 });
	assert.equal(readDigestSchedule(root).lastFlushAt, undefined);
	assert.equal(readPendingInjections(root).length, 0);
});

test("maybeFlushDigest flushes due queue once per slot and clears queue", () => {
	const root = freshRoot();
	const now = localDate(9, 5);
	appendDigestQueueEntry(root, signal({ id: "task-1" }));
	appendDigestQueueEntry(root, signal({ id: "task-2" }));

	const first = maybeFlushDigest({ stateRoot: root, now });
	const second = maybeFlushDigest({ stateRoot: root, now });

	assert.deepEqual(first, { flushed: true, signalCount: 2 });
	assert.deepEqual(second, { flushed: false, signalCount: 0 });
	assert.equal(readDigestQueue(root).length, 0);
	assert.equal(readDigestSchedule(root).lastFlushAt, now.toISOString());
	const injections = readPendingInjections(root);
	assert.equal(injections.length, 1);
	assert.equal(injections[0]?.triggerId, "non_critical_digest");
});

test("maybeFlushDigest advances schedule without emitting empty digest", () => {
	const root = freshRoot();
	const now = localDate(14, 5);

	const result = maybeFlushDigest({ stateRoot: root, now });

	assert.deepEqual(result, { flushed: false, signalCount: 0 });
	assert.equal(readPendingInjections(root).length, 0);
	assert.equal(readDigestSchedule(root).lastFlushAt, now.toISOString());
});

test("maybeFlushDigest mirrors to notify best-effort without blocking durable injection", () => {
	const root = freshRoot();
	const now = localDate(19, 5);
	let calls = 0;
	appendDigestQueueEntry(root, signal({ id: "task-1" }));

	const result = maybeFlushDigest({
		stateRoot: root,
		now,
		notify: () => {
			calls++;
			throw new Error("telegram down");
		},
	});

	assert.deepEqual(result, { flushed: true, signalCount: 1 });
	assert.equal(calls, 1);
	assert.equal(readPendingInjections(root).length, 1);
});
