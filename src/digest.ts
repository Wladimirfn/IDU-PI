import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { appendInjection, type Injection } from "./injection-store.js";
import type { HumanIntentRiskHint } from "./human-intent.js";

/**
 * Alert digest anti-fatigue core.
 *
 * Digest flushing is driven by the autonomous-alert cron/tick. If that cron is
 * not scheduled in a deployment, queued digest entries remain durable but do not
 * flush automatically. Slot strings are interpreted in the host process local
 * timezone (for example 09:00/14:00/19:00 local time).
 */

export type InterruptRoute = "immediate" | "digest";

export type DigestSignal = {
	id: string;
	kind?: string;
	domain?: string;
	severity?: string;
	riskLevel?: string;
	guardRisk?: string;
	riskHints?: HumanIntentRiskHint[];
	summary?: string;
	requiredAction?: string;
	recommendedAction?: string;
	evidenceRefs?: string[];
	ageMs?: number;
	generatedAt?: string;
};

export type DigestSchedule = {
	version: 1;
	slotsLocal: string[];
	lastFlushAt?: string;
};

export type FlushResult = {
	flushed: boolean;
	signalCount: number;
};

export type MaybeFlushDigestOptions = {
	stateRoot: string;
	now: Date;
	notify?: (text: string) => void;
};

const DEFAULT_DIGEST_SLOTS = ["09:00", "14:00", "19:00"];
const DIGEST_TRIGGER_ID = "non_critical_digest";

export function resolveDigestQueuePath(stateRoot: string): string {
	return join(stateRoot, "digest-queue.jsonl");
}

export function resolveDigestSchedulePath(stateRoot: string): string {
	return join(stateRoot, "digest-schedule.json");
}

export function classifyInterrupt(signal: DigestSignal): InterruptRoute {
	const terms = [signal.domain, signal.kind, signal.riskLevel, signal.guardRisk]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.toLowerCase());
	const hints = signal.riskHints ?? [];
	if (
		terms.some(isImmediateRiskTerm) ||
		hints.some((hint) =>
			["security", "auth_change", "db_change", "data_loss"].includes(hint),
		)
	) {
		return "immediate";
	}
	return "digest";
}

export function buildDigestInjection(
	signals: DigestSignal[],
	now: Date,
): Injection {
	const ts = now.toISOString();
	const summary = buildDigestSummary(signals);
	return {
		ts,
		triggerId: DIGEST_TRIGGER_ID,
		decisionEnvelope: {
			severity: "info",
			summary,
			options: [
				"Review digest items",
				"No immediate interrupt required",
			],
			evidenceRefs: uniqueEvidenceRefs(signals),
			orchestratorDecisionRequired: false,
		},
		injectionId: digestInjectionId(signals, ts),
		acked: false,
	};
}

export function appendDigestQueueEntry(
	stateRoot: string,
	signal: DigestSignal,
): void {
	const path = resolveDigestQueuePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(signal)}\n`, "utf8");
}

export function readDigestQueue(stateRoot: string): DigestSignal[] {
	const path = resolveDigestQueuePath(stateRoot);
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const signals: DigestSignal[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as DigestSignal;
			if (parsed && typeof parsed.id === "string") {
				signals.push(parsed);
			}
		} catch {
			// Ignore malformed queue lines; later valid entries remain readable.
		}
	}
	return signals;
}

export function clearDigestQueue(stateRoot: string): void {
	const path = resolveDigestQueuePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "", "utf8");
}

export function readDigestSchedule(stateRoot: string): DigestSchedule {
	const path = resolveDigestSchedulePath(stateRoot);
	if (!existsSync(path)) return defaultDigestSchedule();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		const slotsLocal = Array.isArray(parsed.slotsLocal)
			? parsed.slotsLocal.filter(isValidSlot)
			: DEFAULT_DIGEST_SLOTS;
		const schedule: DigestSchedule = {
			version: 1,
			slotsLocal: slotsLocal.length > 0 ? slotsLocal : DEFAULT_DIGEST_SLOTS,
		};
		if (typeof parsed.lastFlushAt === "string") {
			schedule.lastFlushAt = parsed.lastFlushAt;
		}
		return schedule;
	} catch {
		return defaultDigestSchedule();
	}
}

export function saveDigestSchedule(
	stateRoot: string,
	schedule: DigestSchedule,
): void {
	const path = resolveDigestSchedulePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
}

export function maybeFlushDigest(opts: MaybeFlushDigestOptions): FlushResult {
	const schedule = readDigestSchedule(opts.stateRoot);
	const dueSlot = latestDueSlot(schedule.slotsLocal, opts.now);
	if (!dueSlot) {
		return { flushed: false, signalCount: readDigestQueue(opts.stateRoot).length };
	}
	const lastFlushMs = schedule.lastFlushAt
		? Date.parse(schedule.lastFlushAt)
		: undefined;
	if (
		typeof lastFlushMs === "number" &&
		Number.isFinite(lastFlushMs) &&
		lastFlushMs >= dueSlot.getTime()
	) {
		return { flushed: false, signalCount: readDigestQueue(opts.stateRoot).length };
	}
	const signals = readDigestQueue(opts.stateRoot);
	const nextSchedule = { ...schedule, lastFlushAt: opts.now.toISOString() };
	if (signals.length === 0) {
		saveDigestSchedule(opts.stateRoot, nextSchedule);
		return { flushed: false, signalCount: 0 };
	}
	const injection = buildDigestInjection(signals, opts.now);
	appendInjection(opts.stateRoot, injection);
	clearDigestQueue(opts.stateRoot);
	saveDigestSchedule(opts.stateRoot, nextSchedule);
	try {
		opts.notify?.(injection.decisionEnvelope.summary);
	} catch {
		// Telegram mirror is best-effort; durable injection is already written.
	}
	return { flushed: true, signalCount: signals.length };
}

function defaultDigestSchedule(): DigestSchedule {
	return { version: 1, slotsLocal: [...DEFAULT_DIGEST_SLOTS] };
}

function isImmediateRiskTerm(term: string): boolean {
	return (
		term === "security" ||
		term === "db" ||
		term === "database" ||
		term === "data_loss" ||
		term === "data-loss" ||
		term === "dataloss" ||
		term === "auth" ||
		term === "auth_change"
	);
}

function buildDigestSummary(signals: DigestSignal[]): string {
	if (signals.length === 0) {
		return "Non-critical digest: no pending signals.";
	}
	const lines = signals.map((signal, index) => {
		const type = signal.kind ?? signal.domain ?? "signal";
		const risk = signal.riskLevel ?? signal.guardRisk ?? signal.severity ?? "unknown";
		const action = signal.requiredAction ?? signal.recommendedAction ?? "nothing required";
		const summary = signal.summary ?? signal.id;
		return `${index + 1}. ${type}: ${summary} (risk: ${risk}; action: ${action})`;
	});
	return `Non-critical digest (${signals.length} signal${signals.length === 1 ? "" : "s"})\n${lines.join("\n")}`;
}

function uniqueEvidenceRefs(signals: DigestSignal[]): string[] {
	const refs = new Set<string>();
	for (const signal of signals) {
		for (const ref of signal.evidenceRefs ?? []) {
			refs.add(ref);
		}
	}
	return [...refs];
}

function digestInjectionId(signals: DigestSignal[], ts: string): string {
	const stableSignals = signals.map((signal) => ({
		...signal,
		evidenceRefs: [...(signal.evidenceRefs ?? [])].sort(),
	}));
	return createHash("sha1")
		.update(JSON.stringify({ triggerId: DIGEST_TRIGGER_ID, ts, signals: stableSignals }))
		.digest("hex");
}

function isValidSlot(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return /^\d{2}:\d{2}$/u.test(value) && slotDate(value, new Date()) !== undefined;
}

function latestDueSlot(slots: string[], now: Date): Date | undefined {
	const candidates = slots
		.map((slot) => slotDate(slot, now))
		.filter((slot): slot is Date => slot !== undefined)
		.filter((slot) => slot.getTime() <= now.getTime())
		.sort((a, b) => b.getTime() - a.getTime());
	return candidates[0];
}

function slotDate(slot: string, now: Date): Date | undefined {
	const match = /^(\d{2}):(\d{2})$/u.exec(slot);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		hour,
		minute,
		0,
		0,
	);
}
