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
};

function seedFinding(labDbPath: string, options: SeedOptions): void {
	const status = options.status ?? "new";
	const createdAt = options.createdAt ?? "2026-06-15 12:00:00";
	const projectId = options.projectId ?? PROJECT_ID;
	runSql(
		labDbPath,
		`INSERT INTO bug_findings (
			id, project_id, title, description, severity, confidence, status,
			affected_files, created_at, updated_at
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
			${sqlString(createdAt)}
		);`,
	);
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
