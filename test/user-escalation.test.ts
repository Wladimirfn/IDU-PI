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
	checkUserEscalation,
	readEscalationEvents,
	resolveEscalationPath,
	ESCALATION_THRESHOLDS,
} from "../src/user-escalation.js";
import { resolveInjectionsPath } from "../src/injection-store.js";

function makeRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-user-escalation-"));
	mkdirSync(stateRoot, { recursive: true });
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function makeInjection(
	stateRoot: string,
	severity: "info" | "warning" | "critical",
	acked = false,
): void {
	const injection = {
		ts: new Date().toISOString(),
		triggerId: `test-${Date.now()}-${Math.random()}`,
		kind: "supervisor_advisory",
		decisionEnvelope: {
			severity,
			summary: `Test ${severity} finding`,
			options: ["ack", "review"],
			evidenceRefs: [],
			orchestratorDecisionRequired: true,
		},
		injectionId: `inj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		acked,
	};
	const path = resolveInjectionsPath(stateRoot);
	if (!existsSync(path)) writeFileSync(path, "", "utf8");
	appendFileSync(path, `${JSON.stringify(injection)}\n`, "utf8");
}

const RECENT = "2026-06-15T12:00:00.000Z";
const NOW = new Date("2026-06-15T13:00:00.000Z"); // 1 hour after RECENT

test("checkUserEscalation: no escalation when no pending injections and recent interaction", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, false);
		assert.deepEqual(result.reasons, []);
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, 0);
		assert.equal(result.escalationId, null);
		// No escalation file written
		assert.equal(existsSync(resolveEscalationPath(stateRoot)), false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: escalates when unacked critical count >= threshold", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Create 3 critical un-acked injections
		for (let i = 0; i < ESCALATION_THRESHOLDS.recentCritical; i++) {
			makeInjection(stateRoot, "critical", false);
		}
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_critical_threshold"));
		assert.ok(result.escalationId);
		// Escalation file written
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.escalationId, result.escalationId);
		assert.ok(events[0]?.reasons.includes("recent_critical_threshold"));
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: does NOT escalate on critical if count < threshold", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Create 2 critical (below threshold of 3)
		makeInjection(stateRoot, "critical", false);
		makeInjection(stateRoot, "critical", false);
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 2);
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: escalates when unacked total >= threshold", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Create 10 warning un-acked (below critical threshold, above total threshold)
		for (let i = 0; i < ESCALATION_THRESHOLDS.recentTotal; i++) {
			makeInjection(stateRoot, "warning", false);
		}
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_total_threshold"));
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, ESCALATION_THRESHOLDS.recentTotal);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: escalates when hours since last interaction >= threshold", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Last interaction 7h ago
		const longAgo = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: longAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("hours_since_interaction"));
		assert.ok(result.hoursSinceLastInteraction >= 6);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: does NOT escalate on hours if recent interaction", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Last interaction 5h ago
		const fiveHoursAgo = new Date(
			NOW.getTime() - 5 * 60 * 60 * 1000,
		).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: fiveHoursAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: counts by ts, not by ack state (cron can auto-ack without breaking escalation)", () => {
	// This is a design change: the cron auto-acks all advisories, so
	// the user-escalation must use a different signal. We count
	// advisories by timestamp (within the last 24h) so the escalation
	// fires even when the cron has already acked everything.
	const { stateRoot, cleanup } = makeRoot();
	try {
		// 3 critical advisories, all acked, all in the last hour
		for (let i = 0; i < 3; i++) {
			makeInjection(stateRoot, "critical", true);
		}
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// Now counts: even though acked, the advisories are within
		// the last 24h, so the user-escalation sees them.
		assert.equal(result.counts.critical, 3);
		assert.equal(result.counts.total, 3);
		assert.equal(result.shouldEscalate, true);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: ignores advisories older than 24h (stale noise)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// 3 critical advisories, acked=false, but timestamped 25h ago
		for (let i = 0; i < 3; i++) {
			const stale = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
			const inj = {
				ts: stale,
				triggerId: `stale-critical-${i}`,
				decisionEnvelope: {
					severity: "critical",
					summary: `Stale critical ${i}`,
					options: ["ack"],
					evidenceRefs: [],
					orchestratorDecisionRequired: true,
				},
				injectionId: `inj-stale-${i}-${Date.now()}`,
				acked: false,
			};
			const path = resolveInjectionsPath(stateRoot);
			if (!existsSync(path)) writeFileSync(path, "", "utf8");
			appendFileSync(path, `${JSON.stringify(inj)}\n`, "utf8");
		}
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// Stale advisories (older than 24h) are ignored.
		assert.equal(result.counts.critical, 0);
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: multiple reasons in one escalation", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// 3 critical + 10 warning + 7h since = 3 reasons
		for (let i = 0; i < 3; i++) {
			makeInjection(stateRoot, "critical", false);
		}
		for (let i = 0; i < 10; i++) {
			makeInjection(stateRoot, "warning", false);
		}
		const longAgo = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: longAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.equal(result.reasons.length, 3);
		assert.ok(result.reasons.includes("recent_critical_threshold"));
		assert.ok(result.reasons.includes("recent_total_threshold"));
		assert.ok(result.reasons.includes("hours_since_interaction"));
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: appends to user-escalations.jsonl (multiple ticks)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// First tick: escalation
		for (let i = 0; i < 3; i++) {
			makeInjection(stateRoot, "critical", false);
		}
		checkUserEscalation({ stateRoot, lastUserInteractionAt: RECENT, now: NOW });
		// Second tick: another escalation
		const result2 = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 2);
		assert.notEqual(events[0]?.escalationId, events[1]?.escalationId);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: counts by severity (info + warning + critical = total)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		makeInjection(stateRoot, "info", false);
		makeInjection(stateRoot, "info", false);
		makeInjection(stateRoot, "warning", false);
		makeInjection(stateRoot, "critical", false);
		const result = checkUserEscalation({
			stateRoot,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.info, 2);
		assert.equal(result.counts.warning, 1);
		assert.equal(result.counts.critical, 1);
		assert.equal(result.counts.total, 4);
	} finally {
		cleanup();
	}
});
