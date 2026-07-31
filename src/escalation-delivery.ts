/**
 * escalation-delivery.ts — A1e delivery planning.
 *
 * PURE planning module: it computes WHICH escalation events to deliver
 * to Telegram and returns a plan. It does NOT send messages. The caller
 * (the Telegram bridge) turns the plan's messages into actual sends and
 * persists the delivery log via `appendDeliveryLog`.
 *
 * Three non-negotiable design rules from the owner:
 *   1. Ceiling compacts, doesn't queue. If N events are pending, ONE
 *      message covers all N. An alert is never deferred — a deferred
 *      alert is a record, not an alert.
 *   2. Premiere. First run with an empty delivery log emits ONE summary
 *      message and marks every in-window event as delivered. No burst
 *      on day one.
 *   3. Idempotency survives restart. `delivery-log.jsonl` records every
 *      delivered escalationId; on restart both files are read and only
 *      the undelivered events are planned.
 *
 * Historical events (pre-#383) lack `triggeredFindingIds`; they are
 * tolerated as `[]`. Counts (`critical`/`warning`/`info`/`total`) are
 * always present on every event.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { UserEscalationEvent } from "./user-escalation.js";

export const DELIVERY_LOG_FILE = "delivery-log.jsonl";

/**
 * How often the bridge checks for pending deliveries (setInterval).
 * Worst case messages/hour = floor(60 / this) = 4, but
 * MAX_MESSAGES_PER_HOUR caps the actual rate at 3.
 */
export const DELIVERY_CHECK_INTERVAL_MIN = 15;

/**
 * Hard ceiling on delivery messages per hour, independent of the tick
 * schedule. Without this, the rate is protected by the tick's hourly
 * cadence — a neighbor module. If the tick speeds up, the pipe changes
 * rate and nobody touched it. This constant makes the limit OURS.
 *
 * Worst case with DELIVERY_CHECK_INTERVAL_MIN=15: 4 checks/hour,
 * ceiling caps at 3. With compaction, each message covers ALL pending
 * events at that moment. In practice: far less, because the tick
 * generates at most ~1 event per hour.
 */
export const MAX_MESSAGES_PER_HOUR = 3;

/** A single Telegram message to send and the escalation events it covers. */
export type DeliveryMessage = {
	text: string;
	escalationIds: string[];
};

/** One append-only entry in the delivery log. */
export type DeliveryLogEntry = {
	escalationId: string;
	deliveredAt: string;
	chatId?: number;
};

/** The complete delivery plan returned by `planDelivery`. */
export type DeliveryPlan = {
	isPremiere: boolean;
	messages: DeliveryMessage[];
	deliveredEscalationIds: string[];
	skippedAlreadyDelivered: number;
	skippedOutsideWindow: number;
	throttled: boolean;
	totalEvents: number;
};

/**
 * Resolve the delivery-log path for a state root.
 */
export function deliveryLogPath(stateRoot: string): string {
	return join(stateRoot, DELIVERY_LOG_FILE);
}

/**
 * Read every escalationId already recorded in the delivery log.
 *
 * Malformed lines are skipped. A missing or empty file yields an empty
 * set — the signal that triggers the premiere summary.
 */
export function readDeliveredIds(deliveryLogPath: string): Set<string> {
	const delivered = new Set<string>();
	if (!existsSync(deliveryLogPath)) return delivered;
	let raw: string;
	try {
		raw = readFileSync(deliveryLogPath, "utf8");
	} catch {
		// Unreadable (EISDIR, EACCES) — treat as empty. The file exists
		// but cannot be read, so the premiere may fire on a log that
		// already has entries.
		//
		// What bounds that: if the write fails too, the lock in
		// runEscalationDelivery halts delivery. If the write SUCCEEDS
		// while the read keeps failing — an odd but not impossible ACL —
		// the lock never fires and every cycle re-fires the premiere.
		// The in-memory ceiling is what caps it at MAX_MESSAGES_PER_HOUR
		// instead of one message per check, forever. Do not remove that
		// ceiling on the assumption the lock covers this path.
		return delivered;
	}
	if (!raw.trim()) return delivered;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: { escalationId?: unknown };
		try {
			parsed = JSON.parse(line) as { escalationId?: unknown };
		} catch {
			continue;
		}
		if (typeof parsed.escalationId === "string") {
			delivered.add(parsed.escalationId);
		}
	}
	return delivered;
}

/**
 * Append delivery entries to the log. Creates the parent directory and
 * the file when missing. Append-only — never rewrites history. Entries
 * whose `chatId` is undefined omit the key (JSON.stringify drops it).
 */
export function appendDeliveryLog(
	deliveryLogPath: string,
	entries: DeliveryLogEntry[],
): void {
	if (entries.length === 0) return;
	mkdirSync(dirname(deliveryLogPath), { recursive: true });
	const block = entries.map((entry) => JSON.stringify(entry)).join("\n");
	appendFileSync(deliveryLogPath, `${block}\n`, "utf8");
}

/**
 * Compute the delivery plan for a batch of escalation events.
 *
 * Filters events to the freshness window, partitions delivered vs
 * pending, then applies the premiere / compact rules. Returns a plan;
 * sends nothing.
 */
export function planDelivery(input: {
	events: UserEscalationEvent[];
	deliveredIds: Set<string>;
	now: Date;
	freshnessWindowHours?: number;
	maxMessagesPerHour?: number;
	recentDeliveryCount?: number;
}): DeliveryPlan {
	const { events, deliveredIds, now } = input;
	const windowMs = (input.freshnessWindowHours ?? 24) * 3600_000;
	const nowMs = now.getTime();
	const maxPerHour = input.maxMessagesPerHour ?? MAX_MESSAGES_PER_HOUR;
	const recentCount = input.recentDeliveryCount ?? 0;

	const inWindow: UserEscalationEvent[] = [];
	let skippedOutsideWindow = 0;
	for (const ev of events) {
		const ts = Date.parse(ev.ts);
		if (Number.isFinite(ts) && nowMs - ts < windowMs) {
			inWindow.push(ev);
		} else {
			skippedOutsideWindow++;
		}
	}

	const pending: UserEscalationEvent[] = [];
	let skippedAlreadyDelivered = 0;
	for (const ev of inWindow) {
		if (deliveredIds.has(ev.escalationId)) {
			skippedAlreadyDelivered++;
		} else {
			pending.push(ev);
		}
	}

	if (pending.length === 0) {
		return {
			isPremiere: false,
			messages: [],
			deliveredEscalationIds: [],
			skippedAlreadyDelivered,
			skippedOutsideWindow,
			throttled: false,
			totalEvents: events.length,
		};
	}

	// PREMIERE: empty delivery log + at least one pending event → one
	// summary message, every in-window event marked delivered.
	if (deliveredIds.size === 0) {
		const sumCritical = sumCounts(inWindow, "critical");
		const sumTotal = sumCounts(inWindow, "total");
		const ids = inWindow.map((e) => e.escalationId);
		const text =
			`🔵 [idu-pi] Resumen inicial — ${inWindow.length} escalaciones en las últimas 24h\n` +
			`   ${sumCritical} críticas · ${sumTotal} hallazgos\n` +
			(skippedOutsideWindow > 0
				? `   ${skippedOutsideWindow} anteriores fuera de ventana, no entregadas\n`
				: "") +
			`   Eventos marcados como entregados. No se repetirán.`;
		return {
			isPremiere: true,
			messages: [{ text, escalationIds: ids }],
			deliveredEscalationIds: ids,
			skippedAlreadyDelivered,
			skippedOutsideWindow,
			throttled: false,
			totalEvents: events.length,
		};
	}

	// THROTTLE: per-hour ceiling. Pending events stay undelivered and
	// will be picked up on the next cycle. This is the limit that
	// belongs to THIS module — without it, the rate is protected by
	// the tick's hourly cadence (a neighbor module), and silently
	// changes if the tick speeds up.
	if (recentCount >= maxPerHour) {
		return {
			isPremiere: false,
			messages: [],
			deliveredEscalationIds: [],
			skippedAlreadyDelivered,
			skippedOutsideWindow,
			throttled: true,
			totalEvents: events.length,
		};
	}

	// NON-PREMIERE: compact ALL pending into a single message.
	const message = compactPendingMessage(pending);
	return {
		isPremiere: false,
		messages: [message],
		deliveredEscalationIds: pending.map((e) => e.escalationId),
		skippedAlreadyDelivered,
		skippedOutsideWindow,
		throttled: false,
		totalEvents: events.length,
	};
}

function sumCounts(
	events: UserEscalationEvent[],
	key: "critical" | "warning" | "info" | "total",
): number {
	let total = 0;
	for (const ev of events) total += ev.counts[key] ?? 0;
	return total;
}

function hhmm(isoTs: string): string {
	const d = new Date(isoTs);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

function breakdownLine(ev: UserEscalationEvent): string {
	return `   ${ev.counts.critical} críticas · ${ev.counts.warning} warnings · ${ev.counts.info} info (total: ${ev.counts.total})`;
}

/**
 * Compact a non-empty pending list into one message. A single event
 * keeps its supervisor-time header; multiple events collapse into an
 * accumulated time-range header. Per-event finding detail lines are
 * deferred until the bug_findings join exists — for now the severity
 * breakdown (the honest counts) is rendered in both cases.
 */
function compactPendingMessage(pending: UserEscalationEvent[]): DeliveryMessage {
	const escalationIds = pending.map((e) => e.escalationId);
	let text: string;
	if (pending.length === 1) {
		const ev = pending[0];
		text =
			`🔴 [idu-pi] ${ev.counts.critical} crítica(s) · supervisor ${hhmm(ev.ts)}\n` +
			breakdownLine(ev);
	} else {
		const sorted = [...pending].sort(
			(a, b) => Date.parse(a.ts) - Date.parse(b.ts),
		);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		text =
			`🔴 [idu-pi] ${pending.length} escalaciones · ${hhmm(first.ts)}–${hhmm(last.ts)}\n` +
			`   ${sumCounts(pending, "critical")} críticas acumuladas · ${sumCounts(pending, "warning")} warnings · ${sumCounts(pending, "info")} info (total: ${sumCounts(pending, "total")})`;
	}
	return { text, escalationIds };
}

