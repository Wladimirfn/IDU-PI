import assert from "node:assert/strict";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
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
import { initLabDb, runSql, sqlString } from "../src/lab-db.js";
import { resolveInjectionsPath } from "../src/injection-store.js";

const PROJECT_ID = "test-project";

function makeRoot(): { stateRoot: string; labDbPath: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-user-escalation-"));
	mkdirSync(stateRoot, { recursive: true });
	const labDbPath = join(stateRoot, "lab.db");
	initLabDb(labDbPath);
	return {
		stateRoot,
		labDbPath,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

type SeedOptions = {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	status?: string;
	// "YYYY-MM-DD HH:MM:SS" — canonical SQLite datetime (matches created_at).
	createdAt?: string;
	projectId?: string;
	// Issue #399: when the seed caller wants to test the recurrence
	// rule, this sets `bug_findings.recurrence_count` directly via a
	// follow-up UPDATE (the INSERT path uses the schema default of 1
	// to keep every other test's seed shape stable).
	recurrenceCount?: number;
	/** Issue #474: set to 1 for sensor-capped findings. */
	viewPartial?: number;
	/** Issue #474: the severity before the #458 downgrade. */
	originalSeverity?: string;
};

function seedFinding(labDbPath: string, options: SeedOptions): void {
	const status = options.status ?? "new";
	const createdAt = options.createdAt ?? "2026-06-15 12:00:00";
	const projectId = options.projectId ?? PROJECT_ID;
	const viewPartial = options.viewPartial ?? 0;
	const originalSeverity = options.originalSeverity ?? "";
	runSql(
		labDbPath,
		`INSERT INTO bug_findings (
			id, project_id, title, description, severity, confidence, status,
			affected_files, created_at, updated_at, view_partial, original_severity
		) VALUES (
			${sqlString(options.id)},
			${sqlString(projectId)},
			${sqlString("title")},
			${sqlString("description")},
			${sqlString(options.severity)},
			${sqlString("high")},
			${sqlString(status)},
			'[]',
			${sqlString(createdAt)},
			${sqlString(createdAt)},
			${String(viewPartial)},
			${originalSeverity ? sqlString(originalSeverity) : "NULL"}
		);`,
	);
	if (options.recurrenceCount !== undefined) {
		runSql(
			labDbPath,
			`UPDATE bug_findings SET recurrence_count = ${sqlString(
				String(options.recurrenceCount),
			)} WHERE id = ${sqlString(options.id)};`,
		);
	}
}

// `now` is fixed; windowStart = now - 24h = 2026-06-14 13:00:00.
const RECENT = "2026-06-15T12:00:00.000Z";
const NOW = new Date("2026-06-15T13:00:00.000Z");
const WITHIN_WINDOW = "2026-06-15 12:00:00"; // after windowStart -> counted
const BEFORE_WINDOW = "2026-06-13 12:00:00"; // before windowStart -> stale

test("checkUserEscalation: no escalation when no open findings and recent interaction", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, false);
		assert.deepEqual(result.reasons, []);
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, 0);
		assert.equal(result.escalationId, null);
		assert.equal(existsSync(resolveEscalationPath(stateRoot)), false);
	} finally {
		cleanup();
	}
});

// D1 scenario 1: a single critical finding escalates (recentCritical = 1).
test("checkUserEscalation: a single critical finding triggers escalation (D1 recentCritical=1)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 1);
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_critical_threshold"));
		assert.ok(result.escalationId);
		assert.deepEqual(result.triggeredFindingIds, ["f-1"]);
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.escalationId, result.escalationId);
		assert.deepEqual(events[0]?.triggeredFindingIds, ["f-1"]);
	} finally {
		cleanup();
	}
});

// D1 scenario 2: 24 non-critical findings -> total=24 (< 25), critical=0,
// no escalation from either count rule.
test("checkUserEscalation: 24 non-critical findings do not escalate (below total threshold)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		for (let i = 0; i < 24; i++) {
			seedFinding(labDbPath, {
				id: `f-${i}`,
				severity: "medium",
				createdAt: WITHIN_WINDOW,
			});
		}
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, 24);
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: 25 non-critical findings escalate on total threshold (D1 recentTotal=25)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		for (let i = 0; i < ESCALATION_THRESHOLDS.recentTotal; i++) {
			seedFinding(labDbPath, {
				id: `f-${i}`,
				severity: "low",
				createdAt: WITHIN_WINDOW,
			});
		}
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.total, ESCALATION_THRESHOLDS.recentTotal);
		assert.equal(result.counts.critical, 0);
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_total_threshold"));
	} finally {
		cleanup();
	}
});

// D1 scenario 3: a triaged finding (status != 'new') is NOT counted.
test("checkUserEscalation: triaged findings (status=accepted) are NOT counted", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "accepted-1",
			severity: "critical",
			status: "accepted",
			createdAt: WITHIN_WINDOW,
		});
		seedFinding(labDbPath, {
			id: "fixed-1",
			severity: "critical",
			status: "fixed",
			createdAt: WITHIN_WINDOW,
		});
		seedFinding(labDbPath, {
			id: "ignored-1",
			severity: "critical",
			status: "ignored",
			createdAt: WITHIN_WINDOW,
		});
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// Human triage stopped all three from counting.
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, 0);
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

// D1 scenario 4: an auto-acked injection does NOT stop counting. The cron
// auto-ack flips `acked` on injections; bug_findings.status is unaffected,
// so the finding still counts. (ack-decoupling preserved.)
test("checkUserEscalation: auto-acked injection does NOT stop counting (ack-decoupling preserved)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "crit-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		// Simulate the cron auto-acking a supervisor advisory injection.
		const injectionsPath = resolveInjectionsPath(stateRoot);
		const ackedInjection = {
			ts: "2026-06-15T12:30:00.000Z",
			triggerId: "supervisor_categorize",
			kind: "supervisor_advisory",
			decisionEnvelope: {
				severity: "critical",
				summary: "1 critical",
				options: ["ack"],
				evidenceRefs: [],
				orchestratorDecisionRequired: true,
			},
			injectionId: "inj-acked-1",
			acked: true,
		};
		if (!existsSync(injectionsPath)) writeFileSync(injectionsPath, "", "utf8");
		appendFileSync(injectionsPath, `${JSON.stringify(ackedInjection)}\n`, "utf8");
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// The finding still counts even though the advisory injection was acked.
		assert.equal(result.counts.critical, 1);
		assert.equal(result.shouldEscalate, true);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: ignores findings older than the 24h window (stale noise)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "stale-1",
			severity: "critical",
			createdAt: BEFORE_WINDOW,
		});
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.total, 0);
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: counts findings only for the given projectId", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "mine-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
			projectId: PROJECT_ID,
		});
		seedFinding(labDbPath, {
			id: "other-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
			projectId: "other-project",
		});
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 1);
		assert.equal(result.counts.total, 1);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: severity collapse (high+medium=warning, low+info=info)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, { id: "h", severity: "high", createdAt: WITHIN_WINDOW });
		seedFinding(labDbPath, { id: "m", severity: "medium", createdAt: WITHIN_WINDOW });
		seedFinding(labDbPath, { id: "l", severity: "low", createdAt: WITHIN_WINDOW });
		seedFinding(labDbPath, { id: "i", severity: "info", createdAt: WITHIN_WINDOW });
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.counts.critical, 0);
		assert.equal(result.counts.warning, 2);
		assert.equal(result.counts.info, 2);
		assert.equal(result.counts.total, 4);
	} finally {
		cleanup();
	}
});

// HUECO 2 (pre-A1e): inactivity is NOT a standalone escalation reason.
// hoursSinceLastInteraction no longer triggers escalation by itself; it is
// retained in the report as an A1e delivery-timing modulator.
test("checkUserEscalation: 0 findings + 6h+ inactive does NOT escalate (inactivity alone is not a trigger)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		const longAgo = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: longAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, false);
		assert.deepEqual(result.reasons, []);
		// Inactivity is still REPORTED even though it no longer triggers.
		assert.ok(result.hoursSinceLastInteraction >= 6);
		assert.equal(existsSync(resolveEscalationPath(stateRoot)), false);
	} finally {
		cleanup();
	}
});

// HUECO 2: a critical finding drives escalation even when the user is also
// inactive — the critical (not the inactivity) is the trigger.
test("checkUserEscalation: 1 critical + 6h+ inactive escalates on the critical, not on inactivity", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "crit-inactive",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const longAgo = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: longAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_critical_threshold"));
		// hours_since_interaction is no longer produced as a reason at all:
		// the only reason is the critical threshold.
		assert.deepEqual(result.reasons, ["recent_critical_threshold"]);
	} finally {
		cleanup();
	}
});

// HUECO 1 (pre-A1e): per-finding idempotency in the DECISION, not the count.
// The same critical finding must not re-escalate every tick, but the COUNT
// still reports it honestly (total-open includes it).
test("checkUserEscalation: same critical finding does NOT re-escalate on the next tick (idempotent)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "crit-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(first.shouldEscalate, true);
		assert.deepEqual(first.triggeredFindingIds, ["crit-1"]);

		// Second tick, same finding, same time window.
		const second = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// Decision: idempotent — does not re-escalate.
		assert.equal(second.shouldEscalate, false);
		assert.deepEqual(second.reasons, []);
		assert.equal(second.escalationId, null);
		// Count stays HONEST: the finding is still open, still counted.
		assert.equal(second.counts.critical, 1);
		assert.equal(second.counts.total, 1);
		// Only one event was written (the first escalation).
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 1);
		assert.deepEqual(events[0]?.triggeredFindingIds, ["crit-1"]);
	} finally {
		cleanup();
	}
});

// HUECO 1: a NEW critical finding (different id) fires again, because its
// id is not in the idempotency memory.
test("checkUserEscalation: a NEW critical finding (different id) fires again", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "crit-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// A genuinely new critical appears on the next tick.
		seedFinding(labDbPath, {
			id: "crit-2",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("recent_critical_threshold"));
		// Only the NEW id triggered this escalation; crit-1 is not re-listed.
		assert.deepEqual(result.triggeredFindingIds, ["crit-2"]);
		// Count is still honest: both criticals are open.
		assert.equal(result.counts.critical, 2);
	} finally {
		cleanup();
	}
});

// HUECO 1: the event reports BOTH numbers — total-open criticals (honest
// count) AND new-since-last-escalation (triggeredFindingIds length).
test("checkUserEscalation: event reports BOTH total-open criticals AND new-since-last-escalation", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "crit-1",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		seedFinding(labDbPath, {
			id: "crit-2",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// First fire: both criticals are new.
		assert.equal(first.counts.critical, 2);
		assert.equal(first.triggeredFindingIds.length, 2);

		// A third critical appears.
		seedFinding(labDbPath, {
			id: "crit-3",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
		});
		const second = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// total-open criticals (honest count) = 3 ...
		assert.equal(second.counts.critical, 3);
		// ... but new-since-last-escalation = 1 (only crit-3).
		assert.deepEqual(second.triggeredFindingIds, ["crit-3"]);
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 2);
		assert.equal(events[1]?.counts.critical, 3);
		assert.deepEqual(events[1]?.triggeredFindingIds, ["crit-3"]);
	} finally {
		cleanup();
	}
});

// HUECO 1: the total rule is also idempotent — the same 25 findings do not
// re-fire on the next tick.
test("checkUserEscalation: total rule is idempotent (same 25 findings do not re-fire)", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		for (let i = 0; i < ESCALATION_THRESHOLDS.recentTotal; i++) {
			seedFinding(labDbPath, {
				id: `f-${i}`,
				severity: "low",
				createdAt: WITHIN_WINDOW,
			});
		}
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(first.shouldEscalate, true);
		assert.ok(first.reasons.includes("recent_total_threshold"));
		assert.equal(
			first.triggeredFindingIds.length,
			ESCALATION_THRESHOLDS.recentTotal,
		);

		const second = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		// Idempotent: same findings already escalated.
		assert.equal(second.shouldEscalate, false);
		// Honest count unchanged.
		assert.equal(second.counts.total, ESCALATION_THRESHOLDS.recentTotal);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Issue #399: recurrence_count is read by the escalation gate so high-
// recurrence findings stop re-firing every day. The 24h window for
// the regular thresholds stays unchanged; the recurrence rule has its
// own 7-day idempotency window.
// ---------------------------------------------------------------------------

import { RECURRENCE_COMPACT_THRESHOLD } from "../src/user-escalation.js";

const ONE_WEEK_LATER = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000); // 7d + 1h to clear the 7d idempotency boundary

test("checkUserEscalation: recurrence_count < 20 does NOT trigger recent_recurrence_threshold", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-low",
			severity: "high",
			createdAt: WITHIN_WINDOW,
			recurrenceCount: RECURRENCE_COMPACT_THRESHOLD - 1,
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(out.shouldEscalate, false);
		assert.ok(!out.reasons.includes("recent_recurrence_threshold"));
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: recurrence_count >= 20 fires recent_recurrence_threshold", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-noisy",
			severity: "high",
			createdAt: WITHIN_WINDOW,
			recurrenceCount: RECURRENCE_COMPACT_THRESHOLD,
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(out.shouldEscalate, true);
		assert.ok(out.reasons.includes("recent_recurrence_threshold"));
		assert.deepEqual(out.triggeredByRecurrence, ["f-noisy"]);
		assert.ok(out.triggeredFindingIds.includes("f-noisy"));
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: same noisy finding does NOT re-fire within 7 days (issue #399 compact)", () => {
	// The operator's complaint: the same critical finding re-notifies
	// every day for 20 days. After this fix, once the finding reaches
	// `RECURRENCE_COMPACT_THRESHOLD` the recurrence rule fires once
	// and stays quiet for 7 days.
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-noisy",
			severity: "high",
			createdAt: WITHIN_WINDOW,
			recurrenceCount: RECURRENCE_COMPACT_THRESHOLD,
		});
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(first.shouldEscalate, true);
		assert.ok(first.reasons.includes("recent_recurrence_threshold"));

		// 1 day later. The finding's `created_at` is moved into the new
		// 24h window so the regular thresholds can see it; the
		// recurrence idempotency window (7 days) still covers it, so
		// the operator sees the signal once, not twice.
		const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
		runSql(
			labDbPath,
			`UPDATE bug_findings SET created_at = ${sqlString(
				new Date(nextDay.getTime() - 60 * 60 * 1000).toISOString(),
			)} WHERE id = 'f-noisy';`,
		);
		const second = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: nextDay,
		});
		assert.equal(
			second.shouldEscalate,
			false,
			"within 7 days the recurrence signal must NOT re-fire",
		);
		assert.equal(second.counts.total, 1, "honest count unchanged");
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: noisy finding re-fires after the 7-day window expires", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-noisy",
			severity: "high",
			createdAt: WITHIN_WINDOW,
			recurrenceCount: RECURRENCE_COMPACT_THRESHOLD,
		});
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(first.shouldEscalate, true);
		assert.ok(first.reasons.includes("recent_recurrence_threshold"));

		// A week later, the 7-day idempotency window expires. The
		// recurrence rule can fire again — in case the operator fixed
		// it and it came back, or in case the operator still hasn't
		// touched it and they need a fresh nudge.
		runSql(
			labDbPath,
			`UPDATE bug_findings SET created_at = ${sqlString(
				new Date(ONE_WEEK_LATER.getTime() - 60 * 60 * 1000).toISOString(),
			)} WHERE id = 'f-noisy';`,
		);
		const later = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: ONE_WEEK_LATER,
		});
		assert.equal(
			later.shouldEscalate,
			true,
			"after 7 days the recurrence signal can re-fire",
		);
		assert.ok(later.reasons.includes("recent_recurrence_threshold"));
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: recurrence rule does not affect the regular 24h idempotency", () => {
	// The regular thresholds (recent_critical, recent_total) keep
	// their 24h window. A noisy finding that crosses
	// `RECURRENCE_COMPACT_THRESHOLD` AND is also critical must
	// trigger both reasons, and on the next tick (within 24h) the
	// regular rule is suppressed but the recurrence rule already
	// fired above and won't fire again until the 7-day window passes.
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-noisy-critical",
			severity: "critical",
			createdAt: WITHIN_WINDOW,
			recurrenceCount: RECURRENCE_COMPACT_THRESHOLD,
		});
		const first = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(first.shouldEscalate, true);
		assert.ok(first.reasons.includes("recent_critical_threshold"));
		assert.ok(first.reasons.includes("recent_recurrence_threshold"));

		// 1 hour later — within the 24h window, both rules suppressed.
		const oneHourLater = new Date(NOW.getTime() + 60 * 60 * 1000);
		const second = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: oneHourLater,
		});
		assert.equal(
			second.shouldEscalate,
			false,
			"both rules suppressed within their respective windows",
		);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: recurrence_count default 1 (no override) does NOT trigger the rule", () => {
	// New finding, no re-reports yet — recurrenceCount defaults to 1
	// via the schema. The rule must not fire on a brand-new finding.
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-fresh",
			severity: "high",
			createdAt: WITHIN_WINDOW,
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		assert.equal(out.shouldEscalate, false);
		assert.ok(!out.reasons.includes("recent_recurrence_threshold"));
	} finally {
		cleanup();
	}
});

// Issue #474: sensor-capped critical escalation rule.
// After #458, every finding from a file over MAX_FILE_CONTENT_CHARS
// has its severity downgraded — a `critical` becomes `high`.
// The `recent_critical_threshold` rule fires on NEW `critical`
// findings (severity='critical'), so after downgrade a capped
// critical is invisible to it. This rule recovers the channel.
//
// Audit criteria:
//   1. 3 findings (< total threshold) with a capped downgraded
//      critical ESCALATES via `sensor_capped_critical`.
//   2. Same finding without cap escalates via old `recent_critical_threshold`.
//   3. 3 findings with genuine `high` from complete file does NOT escalate.
//   4. Mutation: removing the `viewPartial !== 0` gate from the
//      `sensorCappedCriticalIds` filter makes test 1 fail — the
//      assertion that `sensor_capped_critical` is in `reasons`.

const NOW_474 = new Date("2026-06-15T14:00:00Z");
const RECENT_474 = new Date(NOW_474.getTime() - 60 * 1000).toISOString();

test("sensor_capped_critical (474-1): capped downgraded critical escalates", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, { id: "f-a", severity: "low" });
		seedFinding(labDbPath, { id: "f-b", severity: "low" });
		seedFinding(labDbPath, {
			id: "f-c",
			severity: "high",
			viewPartial: 1,
			originalSeverity: "critical",
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT_474,
			now: NOW_474,
		});
		assert.equal(out.shouldEscalate, true);
		assert.ok(
			out.reasons.includes("sensor_capped_critical"),
			`must include sensor_capped_critical, got: ${out.reasons.join(", ")}`,
		);
		assert.ok(!out.reasons.includes("recent_total_threshold"));
		assert.ok(!out.reasons.includes("recent_critical_threshold"));
	} finally {
		cleanup();
	}
});

test("sensor_capped_critical (474-2): raw critical escalates via old rule", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, { id: "f-raw", severity: "critical" });
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT_474,
			now: NOW_474,
		});
		assert.equal(out.shouldEscalate, true);
		assert.ok(
			out.reasons.includes("recent_critical_threshold"),
			`old rule must fire, got: ${out.reasons.join(", ")}`,
		);
	} finally {
		cleanup();
	}
});

test("sensor_capped_critical (474-3): genuine high from complete file does NOT escalate", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, { id: "f-g", severity: "low" });
		seedFinding(labDbPath, { id: "f-h", severity: "low" });
		seedFinding(labDbPath, { id: "f-i", severity: "high" });
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT_474,
			now: NOW_474,
		});
		assert.equal(out.shouldEscalate, false);
		assert.deepStrictEqual(out.reasons, []);
	} finally {
		cleanup();
	}
});

test("sensor_capped_critical (474-4): pre-mutation — rule fires correctly", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		seedFinding(labDbPath, {
			id: "f-m1",
			severity: "high",
			viewPartial: 1,
			originalSeverity: "critical",
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT_474,
			now: NOW_474,
		});
		assert.equal(out.shouldEscalate, true);
		assert.ok(
			out.reasons.includes("sensor_capped_critical"),
			"pre-mutation: rule fires",
		);
	} finally {
		cleanup();
	}
});

// The owner called out #398 shape: "two branches that should read
// the same state and one ignores it." If a future code path writes
// `original_severity` without setting `view_partial` (a regression
// of the writer), the rule must still demand `view_partial` to fire
// — otherwise we'd be escalating findings the operator never saw
// as "partial view." This test pins the rule's defensive check:
// `original_severity='critical'` alone is not enough; the writer's
// flag must agree.
test("sensor_capped_critical (474-5): rule requires view_partial=1 even when original_severity is set", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		// Defensive: a row that has original_severity='critical'
		// but view_partial=0 (i.e. the writer forgot to set the
		// flag) must NOT escalate via the sensor_capped rule.
		// The owner's audit criterion for this round:
		// "si la regla escala mirando sólo originalSeverity === 'critical',
		// entonces view_partial no participa del veredicto." The
		// rule reads both columns; this test pins that.
		// Use severity='high' (post-downgrade) so the OLD rule
		// doesn't fire on its own — the only way this finding
		// can escalate is via sensor_capped_critical.
		seedFinding(labDbPath, {
			id: "f-defensive",
			severity: "high",
			viewPartial: 0,
			originalSeverity: "critical",
		});
		const out = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT_474,
			now: NOW_474,
		});
		assert.equal(out.shouldEscalate, false);
		assert.deepEqual(out.reasons, []);
	} finally {
		cleanup();
	}
});
