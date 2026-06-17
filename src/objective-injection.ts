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
 * Thin wrapper around `enqueueInjectionReminder` with a stable
 * fingerprint ("objective") so the general logic handles dedup,
 * escalation, and stale re-emission. Also passes the cached
 * `lastInjectionId` from the state file as a `legacyId` so entries
 * written by pre-sub-PR-B code (no fingerprint ref) can still be
 * found and escalated.
 */
export function enqueueObjectiveReminder(input: {
	stateRoot: string;
	planObjective: string;
	now?: Date;
}): EnqueueResult {
	const now = input.now ?? new Date();
	const cachedState = readReminderState(input.stateRoot);
	const result = enqueueInjectionReminder({
		stateRoot: input.stateRoot,
		injectionKind: "objective_reminder",
		fingerprint: "objective",
		injectionId: `obj-rem-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
		summary: `Refresh project objective via \`idu_supervisor_context_pack\` before non-trivial work. Do not infer the objective from README or memory.`,
		evidenceRefs: ["piso:objective_reminder"],
		options: ["ack", "refresh"],
		severity: "info",
		decisionRequired: false,
		legacyId: cachedState?.lastInjectionId ?? undefined,
		now,
	});
	// Keep the legacy state file in sync so other tools that read
	// <stateRoot>/objective-reminder.json (cadence, tests) still work.
	if (result.enqueued && result.injectionId) {
		const statePath = resolveObjectiveStatePath(input.stateRoot);
		writeReminderStateToPath(statePath, {
			lastReminderAt: now.toISOString(),
			lastEscalationAt: result.escalated ? now.toISOString() : null,
			turnsSinceLastReminder: 0,
			lastInjectionId: result.injectionId,
		});
	}
	return result;
}

// =========================================================================
// Sub-PR B: generalized injection enqueue (objective + hygiene)
// =========================================================================

/** Prefix used to mark the fingerprint ref inside evidenceRefs.
 *  We use this prefix to scan injections.jsonl for the existing
 *  un-acked entry without needing a sidecar state file. */
export const INJECTION_FINGERPRINT_REF_PREFIX = "injection-fingerprint:";

/**
 * Generalized injection enqueue. The caller picks:
 *   - injectionKind: free-form kind tag (e.g. "objective_reminder",
 *     "hygiene_junk_file").
 *   - fingerprint: a STABLE string used as the dedup key. For
 *     objective reminders this is "objective" (only one un-acked at
 *     a time). For hygiene, it's `hyg:<sha1[0:8]>` per path. The
 *     fingerprint is also stored in `evidenceRefs` so the function
 *     can find the existing entry on a subsequent call.
 *   - injectionId: the candidate ID for a fresh emission. On
 *     escalation, the EXISTING id is kept (not the new one).
 *
 * Returns:
 *   - reason: "dedup" → no-op, recent un-acked entry exists.
 *   - reason: "escalated" → existing entry flipped to blocking.
 *   - reason: "fresh" → new entry appended.
 */
export function enqueueInjectionReminder(input: {
	stateRoot: string;
	injectionKind: string;
	fingerprint: string;
	injectionId: string;
	summary: string;
	evidenceRefs: readonly string[];
	options?: readonly string[];
	severity?: "info" | "warning" | "critical";
	decisionRequired?: boolean;
	escalateAfterMs?: number;
	dedupWindowMs?: number;
	/** Optional fallback for legacy entries that pre-date the
	 *  fingerprint-ref convention. When the fingerprint lookup fails,
	 *  the function also tries this id. Used by `enqueueObjectiveReminder`
	 *  to bridge entries written by pre-sub-PR-B code. */
	legacyId?: string;
	now?: Date;
}): EnqueueResult {
	const now = input.now ?? new Date();
	const escalateAfter =
		input.escalateAfterMs ?? OBJECTIVE_REMINDER_ESCALATE_AFTER_MS;
	const dedupWindow = input.dedupWindowMs ?? OBJECTIVE_REMINDER_DEDUP_WINDOW_MS;
	const fingerprintRef = `${INJECTION_FINGERPRINT_REF_PREFIX}${input.fingerprint}`;

	const all = readAllInjections(input.stateRoot);
	// Prefer the fingerprint-keyed lookup (the canonical path for
	// emissions written by THIS function). Fall back to a single
	// explicit `legacyId` so older entries (no fingerprint ref) can
	// still be located. We do NOT use a kind-only fallback because
	// the same kind can hold multiple un-acked entries (e.g. one
	// per hygiene finding) and a kind-only lookup would cross-dedup
	// them.
	const fpMatch = all.find(
		(i) =>
			i.kind === input.injectionKind &&
			!i.acked &&
			Array.isArray(i.decisionEnvelope?.evidenceRefs) &&
			(i.decisionEnvelope?.evidenceRefs as string[]).includes(fingerprintRef),
	);
	const legacyMatch =
		fpMatch || !input.legacyId
			? null
			: (all.find((i) => i.injectionId === input.legacyId && !i.acked) ?? null);
	const existing = fpMatch ?? legacyMatch;
	const existingTs = existing?.ts ? Date.parse(existing.ts) : null;
	const ageMs =
		existingTs !== null && Number.isFinite(existingTs)
			? now.getTime() - existingTs
			: Number.POSITIVE_INFINITY;

	// Case 1: dedup — recent un-acked entry, no-op.
	if (existing && ageMs < escalateAfter) {
		return {
			enqueued: false,
			escalated: false,
			injectionId: null,
			reason: "dedup",
		};
	}

	// Case 2: escalate — same injectionId, severity=warning,
	// decisionRequired=true.
	if (
		existing &&
		existing.injectionId &&
		ageMs >= escalateAfter &&
		ageMs < dedupWindow
	) {
		const idx = all.findIndex((i) => i.injectionId === existing.injectionId);
		if (idx >= 0) {
			const original = all[idx];
			const escalated: InjectionRecord = {
				...original,
				decisionEnvelope: {
					...original.decisionEnvelope,
					severity: "warning",
					orchestratorDecisionRequired: true,
				},
				acked: false,
			};
			all[idx] = escalated;
			writeAllInjections(input.stateRoot, all);
		}
		return {
			enqueued: true,
			escalated: true,
			injectionId: existing.injectionId,
			reason: "escalated",
		};
	}

	// Case 3: stale — auto-ack the old one before emitting fresh.
	if (existing && existing.injectionId && ageMs >= dedupWindow) {
		markInjectionAckedInFile(input.stateRoot, existing.injectionId);
	}

	// Case 4: fresh — append a new entry. evidenceRefs gets the
	// fingerprint ref PREPENDED so future calls can locate this entry
	// for dedup/escalation.
	const refs: string[] = [fingerprintRef, ...input.evidenceRefs];
	const injection: InjectionRecord = {
		injectionId: input.injectionId,
		kind: input.injectionKind,
		triggerId: input.injectionKind,
		ts: now.toISOString(),
		decisionEnvelope: {
			severity: input.severity ?? "info",
			summary: input.summary,
			options: input.options ? [...input.options] : ["ack"],
			evidenceRefs: refs,
			orchestratorDecisionRequired: input.decisionRequired ?? false,
		},
		acked: false,
	};
	appendInjectionToFile(input.stateRoot, injection);
	return {
		enqueued: true,
		escalated: false,
		injectionId: input.injectionId,
		reason: "fresh",
	};
}

/**
 * Enqueue a hygiene reminder for a single sensor finding. Wraps
 * `enqueueInjectionReminder` with `injectionKind = "hygiene_junk_file"`
 * and a fingerprint derived from the path hash (stable across calls).
 */
export function enqueueHygieneReminder(input: {
	stateRoot: string;
	finding: { path: string; pattern: string; fingerprint: string };
	now?: Date;
}): EnqueueResult {
	const injectionId = `hyg-${input.finding.fingerprint.slice(0, 8)}-${Date.now()}`;
	return enqueueInjectionReminder({
		stateRoot: input.stateRoot,
		injectionKind: "hygiene_junk_file",
		fingerprint: `hyg:${input.finding.fingerprint}`,
		injectionId,
		summary: `Junk file: ${input.finding.path} (matched pattern: ${input.finding.pattern}). Run \`find . -name '${input.finding.pattern}' -delete\` to clean up, or set up an allowlist in <stateRoot>/hygiene-patterns.json.`,
		evidenceRefs: [`hygiene_sensor:${input.finding.fingerprint}`],
		options: ["ack", "clean", "allowlist"],
		severity: "info",
		decisionRequired: false,
		now: input.now,
	});
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
	triggerId?: string;
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
