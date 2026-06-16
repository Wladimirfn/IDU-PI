/**
 * user-escalation.ts — PR-105c.
 *
 * Determines when the supervisor should escalate to the human user
 * based on accumulation of un-acked findings and inactivity.
 *
 * Three independent rules (any one triggers escalation):
 *   1. unacked_critical_threshold: N+ un-acked critical findings
 *   2. unacked_total_threshold: N+ un-acked findings (any severity)
 *   3. hours_since_interaction: H+ hours since last user interaction
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
import { readPendingInjections } from "./injection-store.js";

export const ESCALATION_FILE = "user-escalations.jsonl";

export const ESCALATION_THRESHOLDS = {
	unackedCritical: 3,
	unackedTotal: 10,
	hoursSinceLastInteraction: 6,
} as const;

export type EscalationReason =
	| "unacked_critical_threshold"
	| "unacked_total_threshold"
	| "hours_since_interaction";

export type UserEscalationEvent = {
	ts: string;
	escalationId: string;
	reasons: EscalationReason[];
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
	lastUserInteractionAt: string; // ISO timestamp
	now?: Date;
};

export function resolveEscalationPath(stateRoot: string): string {
	return join(stateRoot, ESCALATION_FILE);
}

function countBySeverity(pending: ReturnType<typeof readPendingInjections>): {
	critical: number;
	warning: number;
	info: number;
	total: number;
} {
	const counts = { critical: 0, warning: 0, info: 0, total: pending.length };
	for (const inj of pending) {
		const sev = inj.decisionEnvelope.severity;
		if (sev === "critical") counts.critical++;
		else if (sev === "warning") counts.warning++;
		else if (sev === "info") counts.info++;
	}
	return counts;
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

export function checkUserEscalation(input: UserEscalationInput): EscalationResult {
	const now = input.now ?? new Date();
	const pending = readPendingInjections(input.stateRoot);
	const counts = countBySeverity(pending);

	const lastInteraction = new Date(input.lastUserInteractionAt);
	const hoursSince =
		(now.getTime() - lastInteraction.getTime()) / (1000 * 60 * 60);

	const reasons: EscalationReason[] = [];
	if (counts.critical >= ESCALATION_THRESHOLDS.unackedCritical) {
		reasons.push("unacked_critical_threshold");
	}
	if (counts.total >= ESCALATION_THRESHOLDS.unackedTotal) {
		reasons.push("unacked_total_threshold");
	}
	if (hoursSince >= ESCALATION_THRESHOLDS.hoursSinceLastInteraction) {
		reasons.push("hours_since_interaction");
	}

	const shouldEscalate = reasons.length > 0;
	let escalationId: string | null = null;
	if (shouldEscalate) {
		escalationId = `esc-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
		writeEscalationEvent(input.stateRoot, {
			ts: now.toISOString(),
			escalationId,
			reasons,
			counts,
			hoursSinceLastInteraction: hoursSince,
			lastUserInteractionAt: input.lastUserInteractionAt,
		});
	}

	return {
		shouldEscalate,
		reasons,
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
