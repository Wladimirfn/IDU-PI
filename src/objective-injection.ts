/**
 * objective-injection.ts — PR-A + PR-B: PISO gate + cadence.
 *
 * Hosts a read-only helper that the MCP envelope() and CLI formatters
 * call to surface a blocking banner (the PISO gate), plus the
 * enqueue logic for the objective reminder (time + task-count cadence,
 * dedup, escalation).
 *
 * The PISO gate is host-agnostic: every orchestrator that uses
 * idu-pi consumes the same surface, so the banner appears in every
 * response.
 *
 * The enqueue logic (cadence + dedup + escalation) lives in
 * the same module under a separate function (enqueueObjectiveReminder),
 * wired in PR-B. PR-A only needs the read path.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type ObjectiveReminderKind = "objective_reminder";

export type ObjectiveReminder = {
	injectionId: string;
	kind: ObjectiveReminderKind;
	decisionRequired: boolean;
	severity: "info" | "warning" | "critical";
	summary: string;
	acked: boolean;
	ts: string;
};

export type BlockingInjection = {
	injectionId: string;
	kind: ObjectiveReminderKind;
	severity: "info" | "warning" | "critical";
	decisionRequired: true;
	summary: string;
	acked: boolean;
	ts: string;
	ageMs: number;
};

/**
 * State file paths. Exposed for tests and for the cron wiring in PR-B.
 */
export function resolveObjectiveStatePath(stateRoot: string): string {
	return join(stateRoot, "objective-reminder.json");
}

export function resolveTurnCounterPath(stateRoot: string): string {
	return join(stateRoot, "last-orchestrator-turn.json");
}

/**
 * Read the most recent un-acked blocking `objective_reminder`
 * injection from the state's `injections.jsonl`. Returns null when
 * there is no pending blocking reminder.
 *
 * This is the PISO gate's read path: the MCP envelope() and the CLI
 * banner both call this on every response.
 */
export function readPendingBlockingInjection(
	stateRoot: string,
	now: Date = new Date(),
): BlockingInjection | null {
	const injections = readAllObjectiveReminders(stateRoot);
	let mostRecent: ObjectiveReminder | null = null;
	for (const inj of injections) {
		if (inj.acked) continue;
		if (!inj.decisionRequired) continue;
		if (mostRecent === null || Date.parse(inj.ts) > Date.parse(mostRecent.ts)) {
			mostRecent = inj;
		}
	}
	if (mostRecent === null) return null;
	const ageMs = Math.max(0, now.getTime() - Date.parse(mostRecent.ts));
	const blocking: BlockingInjection = {
		injectionId: mostRecent.injectionId,
		kind: mostRecent.kind,
		severity: mostRecent.severity,
		decisionRequired: true,
		summary: mostRecent.summary,
		acked: mostRecent.acked,
		ts: mostRecent.ts,
		ageMs,
	};
	return blocking;
}

function readAllObjectiveReminders(stateRoot: string): ObjectiveReminder[] {
	const filePath = join(stateRoot, "injections.jsonl");
	if (!existsSync(filePath)) return [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	if (!raw.trim()) return [];
	const out: ObjectiveReminder[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isObjectiveReminderRecord(parsed)) continue;
		const v = parsed as Record<string, unknown>;
		const envelope = v.decisionEnvelope as Record<string, unknown>;
		const reminder: ObjectiveReminder = {
			injectionId: v.injectionId as string,
			kind: "objective_reminder",
			decisionRequired: envelope.orchestratorDecisionRequired as boolean,
			severity: envelope.severity as "info" | "warning" | "critical",
			summary: envelope.summary as string,
			acked: v.acked as boolean,
			ts: v.ts as string,
		};
		out.push(reminder);
	}
	return out;
}

function isObjectiveReminderRecord(value: unknown): value is Record<
	string,
	unknown
> & {
	decisionEnvelope: Record<string, unknown>;
} {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.kind !== "objective_reminder") return false;
	if (typeof v.injectionId !== "string") return false;
	if (typeof v.acked !== "boolean") return false;
	if (typeof v.ts !== "string") return false;
	if (typeof v.decisionEnvelope !== "object" || v.decisionEnvelope === null) {
		return false;
	}
	const envelope = v.decisionEnvelope as Record<string, unknown>;
	if (typeof envelope.orchestratorDecisionRequired !== "boolean") {
		return false;
	}
	if (typeof envelope.severity !== "string") return false;
	if (typeof envelope.summary !== "string") return false;
	if (
		envelope.severity !== "info" &&
		envelope.severity !== "warning" &&
		envelope.severity !== "critical"
	) {
		return false;
	}
	return true;
}

// =========================================================================
// PR-B: cadence (enqueue + dedup + escalation + task-count)
// =========================================================================

/** Time cadence for the objective reminder: 1 hour. */
export const OBJECTIVE_REMINDER_TIME_MS = 3_600_000;
/** Escalation threshold: 1 hour after enqueue, the reminder becomes blocking. */
export const OBJECTIVE_REMINDER_ESCALATE_AFTER_MS = 3_600_000;
/** Dedup window: 4 hours. After this, a new reminder is enqueued even if the previous is un-acked. */
export const OBJECTIVE_REMINDER_DEDUP_WINDOW_MS = 4 * 3_600_000;
/** Task-count cadence: every 10 orchestrator turns. */
export const OBJECTIVE_REMINDER_TASK_COUNT = 10;

export type ObjectiveReminderState = {
	lastReminderAt: string;
	lastEscalationAt: string | null;
	turnsSinceLastReminder: number;
	lastInjectionId: string;
};

export type EnqueueResult = {
	enqueued: boolean;
	escalated: boolean;
	injectionId: string | null;
	reason: "fresh" | "dedup" | "escalated";
};

export type TurnCountResult = {
	turnCount: number;
};

/**
 * Enqueue an objective reminder if cadence/dedup rules allow.
 * The function handles:
 * - dedup: if a recent un-acked reminder exists, no-op
 * - escalation: if the most recent reminder is >1h old, mark it as blocking
 * - fresh: otherwise, append a new reminder to injections.jsonl
 */
export function enqueueObjectiveReminder(input: {
	stateRoot: string;
	planObjective: string;
	now?: Date;
}): EnqueueResult {
	const now = input.now ?? new Date();
	const statePath = resolveObjectiveStatePath(input.stateRoot);
	const state = readReminderState(input.stateRoot);
	const lastReminderAt = state?.lastReminderAt
		? new Date(state.lastReminderAt)
		: null;
	const lastInjectionId = state?.lastInjectionId ?? null;

	// Dedup: a recent un-acked reminder still counts
	if (lastReminderAt && lastInjectionId) {
		const ageMs = now.getTime() - lastReminderAt.getTime();
		// Check if the last reminder in injections.jsonl is acked
		const lastReminderStillUnacked = readInjectionsByKind(
			input.stateRoot,
			"objective_reminder",
		).find((i) => i.injectionId === lastInjectionId && !i.acked);
		if (lastReminderStillUnacked) {
			if (ageMs < OBJECTIVE_REMINDER_DEDUP_WINDOW_MS) {
				// Still within dedup window: no-op
				return {
					enqueued: false,
					escalated: false,
					injectionId: null,
					reason: "dedup",
				};
			}
			// Past dedup window (>= 4h) and still un-acked: it's stale.
			// Mark the old one as acked so it doesn't re-surface, and
			// enqueue a fresh reminder. Escalation is short-circuited here
			// because the old reminder is too old to escalate usefully.
			markInjectionAckedInFile(input.stateRoot, lastInjectionId);
		}
	}

	// Escalation: if the last reminder is >=1h old and <4h, escalate it.
	// (Past 4h already returned a fresh reminder above.)
	if (lastReminderAt && lastInjectionId) {
		const ageMs = now.getTime() - lastReminderAt.getTime();
		if (
			ageMs >= OBJECTIVE_REMINDER_ESCALATE_AFTER_MS &&
			ageMs < OBJECTIVE_REMINDER_DEDUP_WINDOW_MS
		) {
			// Find the same injectionId and overwrite with escalated version
			const injections = readAllInjections(input.stateRoot);
			const idx = injections.findIndex(
				(i) => i.injectionId === lastInjectionId,
			);
			if (idx >= 0) {
				const escalated = {
					...injections[idx],
					decisionEnvelope: {
						...injections[idx].decisionEnvelope,
						severity: "warning",
						orchestratorDecisionRequired: true,
					},
					acked: false,
				};
				injections[idx] = escalated;
				writeAllInjections(input.stateRoot, injections);
			}
			const newState: ObjectiveReminderState = {
				lastReminderAt: lastReminderAt.toISOString(),
				lastEscalationAt: now.toISOString(),
				turnsSinceLastReminder: 0,
				lastInjectionId,
			};
			writeReminderStateToPath(statePath, newState);
			return {
				enqueued: true,
				escalated: true,
				injectionId: lastInjectionId,
				reason: "escalated",
			};
		}
	}

	// Fresh: enqueue a new reminder
	const injectionId = `obj-rem-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
	const injection = {
		injectionId,
		kind: "objective_reminder",
		triggerId: "objective_reminder",
		ts: now.toISOString(),
		decisionEnvelope: {
			severity: "info",
			summary: `Refresh project objective via \`idu_supervisor_context_pack\` before non-trivial work. Do not infer the objective from README or memory.`,
			options: ["ack", "refresh"],
			evidenceRefs: ["piso:objective_reminder"],
			orchestratorDecisionRequired: false,
		},
		acked: false,
	};
	appendInjectionToFile(input.stateRoot, injection);
	const newState: ObjectiveReminderState = {
		lastReminderAt: now.toISOString(),
		lastEscalationAt: null,
		turnsSinceLastReminder: 0,
		lastInjectionId: injectionId,
	};
	writeReminderStateToPath(statePath, newState);
	return {
		enqueued: true,
		escalated: false,
		injectionId,
		reason: "fresh",
	};
}

/**
 * Note that the orchestrator completed a turn. Increments the
 * counter in `<stateRoot>/last-orchestrator-turn.json`. The cron
 * reads the counter and enqueues a reminder when it reaches
 * OBJECTIVE_REMINDER_TASK_COUNT.
 */
export function noteOrchestratorTurn(input: {
	stateRoot: string;
	now?: Date;
}): TurnCountResult {
	const now = input.now ?? new Date();
	const path = resolveTurnCounterPath(input.stateRoot);
	const existing = readTurnCounter(input.stateRoot);
	const next = (existing?.turnCount ?? 0) + 1;
	writeFileSync(
		path,
		JSON.stringify({ turnCount: next, lastTurnAt: now.toISOString() }, null, 2),
		"utf8",
	);
	return { turnCount: next };
}

// ----- internal helpers -----

function readReminderState(stateRoot: string): ObjectiveReminderState | null {
	const path = resolveObjectiveStatePath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as ObjectiveReminderState;
	} catch {
		return null;
	}
}

function writeReminderStateToPath(
	path: string,
	state: ObjectiveReminderState,
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function readTurnCounter(stateRoot: string): { turnCount: number } | null {
	const path = resolveTurnCounterPath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as { turnCount: number };
	} catch {
		return null;
	}
}

type InjectionRecord = {
	injectionId: string;
	kind?: string;
	ts?: string;
	acked?: boolean;
	decisionEnvelope?: {
		severity?: string;
		summary?: string;
		options?: string[];
		evidenceRefs?: string[];
		orchestratorDecisionRequired?: boolean;
	};
};

function readAllInjections(stateRoot: string): InjectionRecord[] {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) return [];
	const raw = readFileSync(path, "utf8");
	if (!raw.trim()) return [];
	const out: InjectionRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as InjectionRecord);
		} catch {
			// skip malformed lines (best-effort reader)
		}
	}
	return out;
}

function writeAllInjections(
	stateRoot: string,
	injections: InjectionRecord[],
): void {
	const path = join(stateRoot, "injections.jsonl");
	const content = injections.map((i) => JSON.stringify(i)).join("\n");
	writeFileSync(path, `${content}\n`, "utf8");
}

function readInjectionsByKind(
	stateRoot: string,
	kind: string,
): InjectionRecord[] {
	return readAllInjections(stateRoot).filter((i) => i.kind === kind);
}

function appendInjectionToFile(
	stateRoot: string,
	injection: InjectionRecord,
): void {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf8");
	}
	appendFileSync(path, `${JSON.stringify(injection)}\n`, "utf8");
}

function markInjectionAckedInFile(
	stateRoot: string,
	injectionId: string,
): void {
	const injections = readAllInjections(stateRoot);
	const idx = injections.findIndex((i) => i.injectionId === injectionId);
	if (idx < 0) return;
	injections[idx] = { ...injections[idx], acked: true };
	writeAllInjections(stateRoot, injections);
}

/** Read-only helper for tests: returns the most recent un-acked
 * objective_reminder in injections.jsonl. */
export function readRecentSupervisorAdvisoriesForTest(
	stateRoot: string,
): InjectionRecord[] {
	return readInjectionsByKind(stateRoot, "objective_reminder");
}
