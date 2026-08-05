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
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { UserEscalationEvent } from "./user-escalation.js";
import type { BugFinding } from "./lab-db.js";

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

/**
 * A finding resolved from bug_findings for message rendering.
 *
 * NOTE: line number is LOST here — affected_files stores paths only.
 * The number exists in evidence as prose (e.g. "Lines ~289-295").
 * When bug_findings gains a line column, add it to filePath + the
 * detail format in renderWithFindings.
 */
export type ResolvedFinding = {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "info";
	title: string;
	/** Verbatim from bug_findings.description. 72-486 chars today. */
	description: string;
	filePath: string;
	status: "new" | "ignored";
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
	resolvedFindings?: ResolvedFinding[];
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
	// When resolvedFindings is available, render with finding detail
	// (criticals + highs get file + title lines, rest as counts).
	// Fallback to counts-only when findings absent (pre-#383 events).
	const deliveredIdsList = pending.map((e) => e.escalationId);

	let message: DeliveryMessage | null;
	if (input.resolvedFindings && input.resolvedFindings.length > 0) {
		const pendingFindingIds = new Set(
			pending.flatMap((e) => e.triggeredFindingIds ?? []),
		);
		const relevantFindings = input.resolvedFindings.filter((f) =>
			pendingFindingIds.has(f.id),
		);
		message =
			relevantFindings.length > 0
				? renderWithFindings(relevantFindings, pending)
				: compactPendingMessage(pending);
	} else {
		message = compactPendingMessage(pending);
	}

	// If all findings were reviewed (renderWithFindings returned null),
	// still mark as delivered (no re-fire) but send no message.
	if (message === null) {
		return {
			isPremiere: false,
			messages: [],
			deliveredEscalationIds: deliveredIdsList,
			skippedAlreadyDelivered,
			skippedOutsideWindow,
			throttled: false,
			totalEvents: events.length,
		};
	}

	return {
		isPremiere: false,
		messages: [message],
		deliveredEscalationIds: deliveredIdsList,
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

/**
 * Render a delivery message WITH finding detail. The header is computed
 * from the FILTERED set (status='new' only), not from event counts —
 * so a critical that was reviewed and ignored does not produce a 🔴.
 *
 * Detail lines: open criticals + highs get file + title.
 * Counts: 3-level collapse (warning = high+medium, info = low+info).
 * Reviewed: count at foot ("N ya revisada(s)").
 *
 * Returns null when ALL findings are reviewed (nothing actionable).
 * Caller marks the event as delivered but sends no message.
 *
 * NOTE: line number is LOST — affected_files stores paths only.
 * The number exists in evidence as prose (e.g. "Lines ~289-295").
 * When bug_findings gains a line column, add it to the detail line.
 */
function renderWithFindings(
	findings: ResolvedFinding[],
	pending: UserEscalationEvent[],
): DeliveryMessage | null {
	const escalationIds = pending.map((e) => e.escalationId);

	const open = findings.filter((f) => f.status === "new");
	const reviewed = findings.filter((f) => f.status === "ignored");

	const criticals = open.filter((f) => f.severity === "critical");
	const highs = open.filter((f) => f.severity === "high");
	const mediums = open.filter((f) => f.severity === "medium");
	const lows = open.filter((f) => f.severity === "low");
	const infos = open.filter((f) => f.severity === "info");

	const warnings = highs.length + mediums.length;
	const infosCount = lows.length + infos.length;

	// Header from filtered set
	const last = pending[pending.length - 1];
	const time = hhmm(last.ts);

	let emoji: string;
	let headerLabel: string;
	if (criticals.length > 0) {
		emoji = "🔴";
		headerLabel = `${criticals.length} crítica${criticals.length === 1 ? "" : "s"}`;
	} else if (highs.length > 0) {
		emoji = "🟡";
		headerLabel = `${highs.length} alta${highs.length === 1 ? "" : "s"}`;
	} else if (warnings > 0) {
		emoji = "🟡";
		headerLabel = `${warnings} warning${warnings === 1 ? "" : "s"}`;
	} else if (infosCount > 0) {
		emoji = "🔵";
		headerLabel = `${infosCount} hallazgo${infosCount === 1 ? "" : "s"}`;
	} else {
		// All findings reviewed — nothing to say
		return null;
	}

	let text = `${emoji} [idu-pi] ${headerLabel} · supervisor ${time}\n`;

	// Detail blocks: criticals first, then highs.
	// Each gets: title line (→ file — title), description (verbatim),
	// and the finding ID goes at the bottom of the message.
	// NOTE: line number lives in description as prose (e.g. "line ~670"),
	// not in a dedicated column. When bug_findings gains a line column,
	// add it to the title line format.
	const detailFindings = [...criticals, ...highs];

	for (const f of detailFindings) {
		text += `   → ${f.filePath} — ${f.title}\n`;
	}

	// Description: verbatim, indented. The field is copied, not
	// summarized — "el mensajero no piensa." Hard-cut at budget.
	const DESC_BUDGET = 800;
	const descPrefix = "  ";
	// Calculate fixed overhead (everything except descriptions)
	const footParts: string[] = [];
	if (warnings > 0)
		footParts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
	if (infosCount > 0) footParts.push(`${infosCount} info`);
	if (reviewed.length > 0)
		footParts.push(
			`${reviewed.length} ya revisada${reviewed.length === 1 ? "" : "s"}`,
		);
	const footLine =
		footParts.length > 0 ? `  ─ ${footParts.join(" · ")} ─\n` : "";
	// Issue #459: each finding id is the return path back to the
	// full row. The alert truncates the caveat at the per-finding
	// budget, so we surface the recovery command next to the id.
	// Without this footer line, the alert shows the cut but the
	// operator has no way to know `/idu_bug_finding_show <id>`
	// exists — the command is in the catalog and `/comandos`
	// lists it, but you, looking at the alert on the phone, don't
	// have a reason to go look. The footer closes the loop: the
	// cut announces there's more, and tells you how to ask for it.
	const idLines = detailFindings
		.map(
			(f) =>
				`  ${f.id}\n` +
				`  → fila completa: /idu_bug_finding_show ${f.id}\n`,
		)
		.join("");
	const fixedOverhead = text.length + footLine.length + idLines.length;
	const descBudget = Math.max(
		0,
		DESC_BUDGET - fixedOverhead,
	);
	const perDesc =
		detailFindings.length > 0
			? Math.floor(descBudget / detailFindings.length)
			: 0;

	for (const f of detailFindings) {
		let desc = f.description;
		if (desc.length > perDesc - descPrefix.length - 1) {
			desc = desc.substring(0, perDesc - descPrefix.length - 1) + "…";
		}
		text += `${descPrefix}${desc}\n`;
	}

	// Foot
	text += footLine;

	// Finding IDs at the bottom (return path: operator → agent → status)
	text += idLines;

	return { text: text.trimEnd(), escalationIds };
}

// ---------------------------------------------------------------------------
// TUI toggle support
// ---------------------------------------------------------------------------

/**
 * Read the delivery opt-in flag. Absent = OFF (default). This is the
 * INVERTED default from bridge-autostart.json (where absent = ON):
 * delivery is the only thing that sends messages external to the
 * machine, so off-by-default is the safe choice.
 */
export function readDeliveryFlag(packageRoot: string): boolean {
	const flagPath = join(packageRoot, "escalation-delivery.json");
	if (!existsSync(flagPath)) return false;
	try {
		const raw = JSON.parse(readFileSync(flagPath, "utf8")) as {
			enabled?: boolean;
		};
		return raw.enabled === true;
	} catch {
		return false;
	}
}

/**
 * Write the delivery flag. Both enabled:false and deleting the file
 * produce the same observable result (readDeliveryFlag returns false).
 * We write enabled:false instead of deleting so the operator can see
 * the file exists and was explicitly disabled, not just missing.
 */
export function writeDeliveryFlag(
	packageRoot: string,
	enabled: boolean,
): void {
	const flagPath = join(packageRoot, "escalation-delivery.json");
	writeFileSync(
		flagPath,
		`${JSON.stringify(
			{ enabled, updatedAt: new Date().toISOString(), source: "tui" },
			null,
			2,
		)}\n`,
		"utf8",
	);
}

/**
 * Read the most recent delivery timestamp from the delivery log.
 * Returns null if the log doesn't exist or is empty. Used by the TUI
 * so an operator who receives nothing can distinguish "nothing
 * happened" from "this isn't delivering."
 */
export function readLastDelivery(deliveryLogPath: string): string | null {
	if (!existsSync(deliveryLogPath)) return null;
	let raw: string;
	try {
		raw = readFileSync(deliveryLogPath, "utf8");
	} catch {
		return null;
	}
	const lines = raw.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		if (!lines[index].trim()) continue;
		try {
			const entry = JSON.parse(lines[index]) as { deliveredAt?: unknown };
			if (typeof entry.deliveredAt === "string") return entry.deliveredAt;
		} catch {
			continue;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Finding close message (the return loop)
// ---------------------------------------------------------------------------

/**
 * Format a close confirmation message for Telegram. Same budget as the
 * alert (800 chars). One source → two destinations: the note in the DB
 * and this message read the SAME field. If they diverge, the label lies.
 *
 * @returns the formatted message, or null if the finding details are empty.
 */
export function formatFindingCloseMessage(input: {
	findingId: string;
	title: string;
	filePath: string;
	note: string;
	oldStatus: string;
	newStatus: string;
}): string | null {
	if (!input.title) return null;

	const CLOSE_BUDGET = 800;
	const emoji = input.newStatus === "fixed" ? "✅" : "🔶";

	let text =
		`${emoji} [idu-pi] Hallazgo ${input.newStatus}\n` +
		`   → ${input.filePath} — ${input.title}\n` +
		`  ${input.findingId}\n` +
		`  Razón: ${input.note}`;

	// Hard cut at budget (same rule as alert messages)
	if (text.length > CLOSE_BUDGET) {
		text = text.substring(0, CLOSE_BUDGET - 1) + "…";
	}

	return text;
}

// ---------------------------------------------------------------------------
// Bug finding detail (the read twin of /cerrar)
// ---------------------------------------------------------------------------

function formatDetailField(label: string, value: string | undefined): string {
	if (!value) return `${label}: (empty)`;
	return `${label}:\n${value}`;
}

function formatDetailAffectedFiles(affectedFiles: string[]): string {
	if (affectedFiles.length === 0) return "Affected files: (none)";
	return ["Affected files:", ...affectedFiles.map((f) => `  - ${f}`)].join("\n");
}

/**
 * Issue #459: format the full bug_finding row for the operator. The
 * alert message truncates the caveat at the per-finding budget (see
 * `DESC_BUDGET` and the per-finding division in this file's alert
 * formatter — at three findings the per-finding cut is well below
 * 800 chars). This formatter returns every column of the row verbatim,
 * no internal truncation; only `replyLong` chunks at Telegram's
 * 4096-char outer bound.
 */
export function formatBugFindingDetail(finding: BugFinding): string {
	const lines: string[] = [
		`Finding ${finding.id}`,
		`Project: ${finding.projectId}`,
		`Severity: ${finding.severity}`,
		`Confidence: ${finding.confidence}`,
		`Status: ${finding.status}`,
		`Recurrence: ${finding.recurrenceCount}`,
		``,
		`Title:`,
		finding.title || "(empty)",
		``,
		formatDetailField("Description", finding.description),
		``,
		formatDetailField("Evidence", finding.evidence),
		``,
		formatDetailField("Suspected cause", finding.suspectedCause),
		``,
		formatDetailAffectedFiles(finding.affectedFiles),
		``,
		formatDetailField("Specialty", finding.specialty),
		``,
		formatDetailField("Recurrence key", finding.dedupeKey),
	];
	// created_at/updated_at aren't currently in the BugFinding type
	// (see #459 follow-up), so we surface what we have.
	return lines.join("\n");
}
