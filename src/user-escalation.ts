/**
 * user-escalation.ts — PR-105c.
 *
 * Determines when the supervisor should escalate to the human user
 * based on accumulation of open findings.
 *
 * IDEMPOTENCY (pre-A1e): the COUNT stays honest — it reports ALL open
 * findings in the 24h window regardless of whether they already triggered
 * an escalation. The idempotency lives in the DECISION: escalation fires
 * only when there is at least one open finding whose id has NOT already
 * triggered an escalation in the last 24h. See `triggeredFindingIds`.
 *
 * Two triggers (any one fires, both idempotent per finding id):
 *   1. recent_critical_threshold: 1+ NEW open critical findings
 *   2. recent_total_threshold: 25+ NEW open findings (any severity)
 *
 * Inactivity (hoursSinceLastInteraction) is NOT a standalone trigger
 * here. It is retained in the event/report as a delivery-timing
 * modulator for A1e, but it no longer causes escalation by itself.
 *
 * D1: escalation counts bug FINDINGS from `bug_findings` (lab.db), NOT
 * advisory envelopes from injections.jsonl. A single advisory that says
 * "1 critical, 3 medium, 6 low" now counts as 10 findings, not 1.
 *
 * When escalation fires, a `user_escalation` event is written to
 * `{stateRoot}/user-escalations.jsonl`. The orchestrator reads this
 * file (or checks the result directly) to surface the alert.
 *
 * Difference from `idu_pending_injections` (the lightweight surface):
 * the user-escalation file is a higher-priority signal that should
 * reach the user through push/notification channels, not just the
 * pending-injections list.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Injection } from "./injection-store.js";
import { initLabDb, runSql, sqlString } from "./lab-db.js";

export const ESCALATION_FILE = "user-escalations.jsonl";

export const ESCALATION_WINDOW_HOURS = 24;

/**
 * Escalation thresholds.
 *
 * D1 recalibration: these now count bug FINDINGS (bug_findings rows),
 * not advisory ENVELOPES (injections). Findings are denser than envelopes
 * — one advisory can summarize many findings — so the thresholds moved:
 *   - recentCritical: 3 envelopes → 1 finding. ONE open critical finding
 *     is enough to escalate; waiting for three criticals silences the
 *     single most important signal.
 *   - recentTotal:    10 envelopes → 25 findings. Findings arrive several
 *     per advisory; 25 ≈ one to two supervisor ticks of noise volume.
 *   - hoursSinceLastInteraction: unchanged (6h). NOT a standalone
 *     escalation trigger (pre-A1e); retained as the A1e delivery-timing
 *     modulator threshold.
 */
export const ESCALATION_THRESHOLDS = {
	recentCritical: 1,
	recentTotal: 25,
	hoursSinceLastInteraction: 6,
} as const;

export type EscalationReason =
	| "recent_critical_threshold"
	| "recent_total_threshold";

export type UserEscalationEvent = {
	ts: string;
	escalationId: string;
	reasons: EscalationReason[];
	/**
	 * Finding ids that were NEW (not escalated in the prior 24h) and caused
	 * THIS escalation to fire. This is the idempotency memory: a future
	 * evaluation collects these from recent events and skips re-escalating
	 * the same ids. The `counts` field still reports ALL open findings
	 * honestly — this field only records the newly-escalated subset.
	 */
	triggeredFindingIds: string[];
	counts: {
		critical: number;
		warning: number;
		info: number;
		total: number;
	};
	hoursSinceLastInteraction: number;
	lastUserInteractionAt: string;
};

export type EscalationResult = {
	shouldEscalate: boolean;
	reasons: EscalationReason[];
	/**
	 * Finding ids that triggered this escalation (the new-since-last slice).
	 * Empty when shouldEscalate is false. `counts` remains the honest
	 * total-open picture; this is the idempotent decision subset.
	 */
	triggeredFindingIds: string[];
	counts: {
		critical: number;
		warning: number;
		info: number;
		total: number;
	};
	hoursSinceLastInteraction: number;
	escalationId: string | null;
};

export type UserEscalationInput = {
	stateRoot: string;
	/**
	 * Path to lab.db. D1: escalation counts FINDINGS from the
	 * `bug_findings` table here, not envelopes from injections.jsonl.
	 */
	labDbPath: string;
	/** Scope findings to this project (bug_findings.project_id). */
	projectId: string;
	lastUserInteractionAt: string; // ISO timestamp
	now?: Date;
};

export function resolveEscalationPath(stateRoot: string): string {
	return join(stateRoot, ESCALATION_FILE);
}

/**
 * Convert a Date to the canonical SQLite datetime string
 * "YYYY-MM-DD HH:MM:SS" — the same format `datetime('now')` emits for
 * `bug_findings.created_at`. Using one shared format makes the
 * `created_at > ?` comparison lexicographically correct (no 'T' vs ' '
 * mismatch between the stored value and the bound window start).
 */
function toSqliteDatetime(date: Date): string {
	return date.toISOString().replace("T", " ").replace(/\.\d+Z$/u, "");
}

/**
 * Count OPEN bug findings by severity within the escalation window.
 *
 * D1: escalation counts FINDINGS (bug_findings rows with status='new'),
 * not advisory ENVELOPES (injections). Severity collapse for escalation:
 *   - critical = severity 'critical'
 *   - warning  = severity 'high' or 'medium'
 *   - info     = severity 'low' or 'info'
 *   - total    = all of the above (every status='new' finding)
 *
 * ACK-DECOUPLING (PRESERVED): only status='new' findings are counted.
 * `bug_findings.status` is human-controlled — set to 'new' on insert and
 * changed ONLY by triage (accepted / deferred / ignored / fixed). The
 * cron auto-ack flips `acked` on INJECTIONS (a different surface) and
 * never touches bug_findings.status, so "count regardless of cron ack"
 * still holds. Human triage is the one thing that stops a finding from
 * counting — that is the owner's earlier decision, kept intact.
 */
function countOpenFindingsBySeverity(
	labDbPath: string,
	projectId: string,
	windowStart: Date,
): { critical: number; warning: number; info: number; total: number } {
	initLabDb(labDbPath);
	const output = runSql(
		labDbPath,
		`SELECT severity FROM bug_findings
		 WHERE project_id = ${sqlString(projectId)}
		   AND status = 'new'
		   AND created_at > ${sqlString(toSqliteDatetime(windowStart))};`,
	).trim();
	if (!output) {
		return { critical: 0, warning: 0, info: 0, total: 0 };
	}
	const rows = JSON.parse(output) as Array<{ severity: string }>;
	const counts = { critical: 0, warning: 0, info: 0, total: rows.length };
	for (const row of rows) {
		if (row.severity === "critical") counts.critical++;
		else if (row.severity === "high" || row.severity === "medium") {
			counts.warning++;
		} else if (row.severity === "low" || row.severity === "info") {
			counts.info++;
		}
	}
	return counts;
}

/**
 * Read the id + severity of OPEN bug findings within the escalation window.
 *
 * Uses the EXACT same WHERE clause as `countOpenFindingsBySeverity` so the
 * returned ids correspond 1:1 with the counted findings. This is used ONLY
 * for the idempotency DECISION (which ids are new since the last
 * escalation); it is never subtracted from the honest count. Two queries
 * are intentional — `countOpenFindingsBySeverity` stays untouched so the
 * reported count cannot regress.
 */
function readOpenFindingIds(
	labDbPath: string,
	projectId: string,
	windowStart: Date,
): { id: string; severity: string }[] {
	initLabDb(labDbPath);
	const output = runSql(
		labDbPath,
		`SELECT id, severity FROM bug_findings
		 WHERE project_id = ${sqlString(projectId)}
		   AND status = 'new'
		   AND created_at > ${sqlString(toSqliteDatetime(windowStart))};`,
	).trim();
	if (!output) return [];
	return JSON.parse(output) as Array<{ id: string; severity: string }>;
}

/**
 * Read supervisor_advisory injections within the last
 * `ESCALATION_WINDOW_HOURS` hours, regardless of acked state.
 *
 * RETAINED for backward compatibility / other consumers, but NO LONGER
 * used for escalation counting. D1 moved the count to `bug_findings`
 * (see `countOpenFindingsBySeverity`); the ack-decoupling that this
 * function embodied ("read regardless of cron auto-ack") is now expressed
 * by counting `bug_findings.status='new'`, which the injection auto-ack
 * cannot touch.
 */
function readRecentSupervisorAdvisories(
	stateRoot: string,
	now: Date,
): Injection[] {
	const filePath = join(stateRoot, "injections.jsonl");
	if (!existsSync(filePath)) return [];
	const raw = readFileSync(filePath, "utf8");
	if (!raw.trim()) return [];
	const windowStart = now.getTime() - ESCALATION_WINDOW_HOURS * 60 * 60 * 1000;
	const out: Injection[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: Injection;
		try {
			parsed = JSON.parse(line) as Injection;
		} catch {
			continue;
		}
		if (parsed.kind !== "supervisor_advisory") continue;
		const ts = Date.parse(parsed.ts);
		if (!Number.isFinite(ts)) continue;
		if (ts < windowStart) continue;
		out.push(parsed);
	}
	return out;
}

function writeEscalationEvent(
	stateRoot: string,
	event: UserEscalationEvent,
): void {
	const filePath = resolveEscalationPath(stateRoot);
	if (!existsSync(filePath)) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, "", "utf8");
	}
	appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

/**
 * Collect the set of finding ids that already triggered an escalation in
 * the last `ESCALATION_WINDOW_HOURS`. This is the idempotency memory: any
 * id present here has already reached the human once this window and must
 * not re-fire on the next tick.
 *
 * Events written before this idempotency existed have no
 * `triggeredFindingIds`; they contribute nothing (the `?? []` fallback),
 * so the first run under the new code escalates once and then goes quiet.
 */
function readAlreadyEscalatedFindingIds(stateRoot: string, now: Date): Set<string> {
	const events = readEscalationEvents(stateRoot);
	const windowStart = now.getTime() - ESCALATION_WINDOW_HOURS * 60 * 60 * 1000;
	const escalated = new Set<string>();
	for (const event of events) {
		const ts = Date.parse(event.ts);
		if (!Number.isFinite(ts)) continue;
		if (ts < windowStart) continue;
		for (const id of event.triggeredFindingIds ?? []) {
			escalated.add(id);
		}
	}
	return escalated;
}

export function checkUserEscalation(
	input: UserEscalationInput,
): EscalationResult {
	const now = input.now ?? new Date();
	const windowStart = new Date(
		now.getTime() - ESCALATION_WINDOW_HOURS * 60 * 60 * 1000,
	);

	// HONEST COUNT — ALL open findings in the window, regardless of prior
	// escalations. Unchanged: this is the total-open picture reported to
	// the human. Idempotency never removes from this number.
	const counts = countOpenFindingsBySeverity(
		input.labDbPath,
		input.projectId,
		windowStart,
	);

	// Finding ids in the window (same WHERE as the count). Used ONLY for
	// the idempotency decision — never subtracted from the count.
	const openFindings = readOpenFindingIds(
		input.labDbPath,
		input.projectId,
		windowStart,
	);

	// IDEMPOTENCY MEMORY: union of finding ids that already triggered an
	// escalation in the last 24h.
	const alreadyEscalated = readAlreadyEscalatedFindingIds(input.stateRoot, now);

	const newCriticalIds = openFindings
		.filter((f) => f.severity === "critical" && !alreadyEscalated.has(f.id))
		.map((f) => f.id);
	const newFindingIds = openFindings
		.filter((f) => !alreadyEscalated.has(f.id))
		.map((f) => f.id);

	const lastInteraction = new Date(input.lastUserInteractionAt);
	const hoursSince =
		(now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

	const reasons: EscalationReason[] = [];
	const triggeredSet = new Set<string>();

	// CRITICAL rule (idempotent): fire when at least one critical finding
	// id has NOT been escalated in the last 24h. The count above still
	// reports every open critical honestly; this gate only decides whether
	// to re-notify.
	if (newCriticalIds.length >= ESCALATION_THRESHOLDS.recentCritical) {
		reasons.push("recent_critical_threshold");
		for (const id of newCriticalIds) triggeredSet.add(id);
	}

	// TOTAL rule (idempotent): fire when the count of not-yet-escalated
	// open findings reaches the noise threshold. Reports total-open via
	// `counts.total`; escalates only on the new-since-last slice.
	if (newFindingIds.length >= ESCALATION_THRESHOLDS.recentTotal) {
		reasons.push("recent_total_threshold");
		for (const id of newFindingIds) triggeredSet.add(id);
	}

	// Inactivity is NOT a standalone escalation reason. It becomes a
	// delivery-timing modulator in A1e. Kept in the report (below) for
	// that purpose — do not add an hours_since_interaction reason here.

	const triggeredFindingIds = [...triggeredSet];
	const shouldEscalate = reasons.length > 0;
	let escalationId: string | null = null;
	if (shouldEscalate) {
		escalationId = `esc-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
		writeEscalationEvent(input.stateRoot, {
			ts: now.toISOString(),
			escalationId,
			reasons,
			triggeredFindingIds,
			counts,
			hoursSinceLastInteraction: hoursSince,
			lastUserInteractionAt: input.lastUserInteractionAt,
		});
	}

	return {
		shouldEscalate,
		reasons,
		triggeredFindingIds,
		counts,
		hoursSinceLastInteraction: hoursSince,
		escalationId,
	};
}

export function readEscalationEvents(stateRoot: string): UserEscalationEvent[] {
	const filePath = resolveEscalationPath(stateRoot);
	if (!existsSync(filePath)) return [];
	const raw = readFileSync(filePath, "utf8");
	if (!raw.trim()) return [];
	const out: UserEscalationEvent[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as UserEscalationEvent);
		} catch {
			// skip malformed lines
		}
	}
	return out;
}
