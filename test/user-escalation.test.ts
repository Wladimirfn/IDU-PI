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
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.escalationId, result.escalationId);
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

test("checkUserEscalation: escalates when hours since last interaction >= threshold", () => {
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
		assert.equal(result.shouldEscalate, true);
		assert.ok(result.reasons.includes("hours_since_interaction"));
		assert.ok(result.hoursSinceLastInteraction >= 6);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: does NOT escalate on hours if recent interaction", () => {
	const { stateRoot, labDbPath, cleanup } = makeRoot();
	try {
		const fiveHoursAgo = new Date(
			NOW.getTime() - 5 * 60 * 60 * 1000,
		).toISOString();
		const result = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: fiveHoursAgo,
			now: NOW,
		});
		assert.equal(result.shouldEscalate, false);
	} finally {
		cleanup();
	}
});

test("checkUserEscalation: appends to user-escalations.jsonl across ticks", () => {
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
		const result2 = checkUserEscalation({
			stateRoot,
			labDbPath,
			projectId: PROJECT_ID,
			lastUserInteractionAt: RECENT,
			now: NOW,
		});
		const events = readEscalationEvents(stateRoot);
		assert.equal(events.length, 2);
		assert.notEqual(events[0]?.escalationId, events[1]?.escalationId);
		assert.ok(result2.escalationId);
	} finally {
		cleanup();
	}
});
