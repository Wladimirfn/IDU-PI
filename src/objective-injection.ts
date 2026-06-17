/**
 * objective-injection.ts — PR-A: PISO gate (universal).
 *
 * Hosts a read-only helper that the MCP envelope() and CLI formatters
 * call to surface a blocking banner. The PISO gate is host-agnostic:
 * every orchestrator that uses idu-pi consumes the same surface, so
 * the banner appears in every response.
 *
 * The actual enqueue logic (cadence + dedup + escalation) lives in
 * the same module under a separate function (enqueueObjectiveReminder),
 * wired in PR-B. PR-A only needs the read path.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

function isObjectiveReminderRecord(
	value: unknown,
): value is Record<string, unknown> & {
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
