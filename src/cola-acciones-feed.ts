import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	readSupervisorActivityEvents,
	type SupervisorActivityEvent,
} from "./supervisor-activity-events.js";
import {
	readIduUsageEvents,
	type IduUsageEvent,
} from "./usage-events.js";

/**
 * "Cola de acciones" feed (live, read-only).
 *
 * The user-facing TUI panel named "Cola de acciones" is NOT a decision
 * surface for the structured task queue; it is a live read-only feed
 * of the most recent supervisor activity, agentlab runs, and
 * "trigger fires" (i.e. idu usage events recorded by
 * `recordIduUsageEvent`). Each entry is normalized into a common
 * shape so the panel can render them together, sorted by timestamp
 * DESC.
 *
 * This module is intentionally side-effect free and only reads from
 * already-existing event files. It must never write or mutate state.
 */

export type ColaDeAccionesEventKind =
	| "supervisor"
	| "agentlab"
	| "trigger";

export type ColaDeAccionesEvent = {
	kind: ColaDeAccionesEventKind;
	summary: string;
	ts: string;
	source: string;
};

export const COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT = 30;

function safeReadDirNames(dirPath: string): string[] {
	try {
		return readdirSync(dirPath);
	} catch {
		return [];
	}
}

function normalizeSupervisorEvents(
	events: readonly SupervisorActivityEvent[],
): ColaDeAccionesEvent[] {
	const out: ColaDeAccionesEvent[] = [];
	for (const event of events) {
		const triggerLabel = event.trigger ? ` (${event.trigger})` : "";
		const reasonLabel = event.reason ? ` reason=${event.reason}` : "";
		const summary = `supervisor ${event.eventType}/${event.origin} status=${event.status}${triggerLabel}${reasonLabel}`;
		out.push({
			kind: "supervisor",
			summary,
			ts: event.timestamp,
			source: "idu-supervisor-activity-events.jsonl",
		});
	}
	return out;
}

function normalizeIduUsageEvents(
	events: readonly IduUsageEvent[],
): ColaDeAccionesEvent[] {
	const out: ColaDeAccionesEvent[] = [];
	for (const event of events) {
		if (event.eventType === "pi_compaction_detected") {
			// Compaction events are not "trigger fires" of a supervisor
			// or agentlab; they are environmental noise. Skip them in
			// the live feed so the panel stays focused on actionable
			// activity.
			continue;
		}
		const recommendation = event.recommendation
			? ` recommendation=${event.recommendation}`
			: "";
		const summary = `trigger fire: ${event.surface}/${event.action}${recommendation}`;
		out.push({
			kind: "trigger",
			summary,
			ts: event.timestamp,
			source: "idu-usage-events.jsonl",
		});
	}
	return out;
}

function safeReadJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function normalizeAgentLabRuns(
	stateRoot: string | undefined,
): ColaDeAccionesEvent[] {
	if (!stateRoot) return [];
	const runDir = join(stateRoot, "agentlabs", "runs");
	if (!existsSync(runDir)) return [];
	const files = safeReadDirNames(runDir).filter((name) =>
		/^(?:current|agentlab-review-run-\d{8}-\d{6})\.json$/u.test(name),
	);
	if (files.length === 0) return [];
	const out: ColaDeAccionesEvent[] = [];
	for (const file of files) {
		const fullPath = join(runDir, file);
		const parsed = safeReadJson<{
			generatedAt?: unknown;
			projectId?: unknown;
			runs?: unknown;
		}>(fullPath);
		if (!parsed) continue;
		if (typeof parsed.generatedAt !== "string") continue;
		const projectId =
			typeof parsed.projectId === "string" ? parsed.projectId : "unknown";
		const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
		if (runs.length === 0) {
			out.push({
				kind: "agentlab",
				summary: `agentlab run (${projectId}): 0 labs executed`,
				ts: parsed.generatedAt,
				source: `agentlabs/runs/${file}`,
			});
			continue;
		}
		for (const rawRun of runs) {
			if (!rawRun || typeof rawRun !== "object") continue;
			const run = rawRun as {
				specialty?: unknown;
				status?: unknown;
				rawSummary?: unknown;
			};
			const specialty =
				typeof run.specialty === "string" ? run.specialty : "unknown";
			const status = typeof run.status === "string" ? run.status : "unknown";
			const rawSummary =
				typeof run.rawSummary === "string" && run.rawSummary.trim()
					? run.rawSummary.trim()
					: "";
			const summary = rawSummary
				? `agentlab ${specialty} (${projectId}) status=${status} — ${truncateSummary(rawSummary)}`
				: `agentlab ${specialty} (${projectId}) status=${status}`;
			out.push({
				kind: "agentlab",
				summary,
				ts: parsed.generatedAt,
				source: `agentlabs/runs/${file}`,
			});
		}
	}
	return out;
}

function truncateSummary(summary: string): string {
	const normalized = summary.replace(/\s+/gu, " ").trim();
	if (normalized.length <= 120) return normalized;
	return `${normalized.slice(0, 117)}...`;
}

/**
 * Read all relevant activity sources for the "Cola de acciones"
 * panel and return a single sorted (ts DESC) feed. Each event is
 * normalized into the common `ColaDeAccionesEvent` shape. Pure
 * function: never throws and never writes.
 */
export function readColaDeAccionesFeed(
	stateRoot: string | undefined,
	options: { limit?: number } = {},
): ColaDeAccionesEvent[] {
	const limit = Math.max(1, options.limit ?? 500);
	const supervisorEvents = stateRoot
		? readSupervisorActivityEvents(stateRoot, limit)
		: [];
	const usageEvents = stateRoot ? readIduUsageEvents(stateRoot, limit) : [];
	const agentlabEvents = normalizeAgentLabRuns(stateRoot);
	const merged = [
		...normalizeSupervisorEvents(supervisorEvents),
		...normalizeIduUsageEvents(usageEvents),
		...agentlabEvents,
	];
	merged.sort((left, right) => {
		const leftMs = Date.parse(left.ts);
		const rightMs = Date.parse(right.ts);
		if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
			return rightMs - leftMs;
		}
		if (Number.isFinite(rightMs)) return 1;
		if (Number.isFinite(leftMs)) return -1;
		return 0;
	});
	return merged;
}

export function formatColaDeAccionesFeed(
	events: readonly ColaDeAccionesEvent[],
): string {
	if (events.length === 0) {
		return "Cola de acciones (0):\n  (sin eventos recientes)";
	}
	const header = `Cola de acciones (${events.length}):`;
	const rows = events.map((event) => {
		const kind = event.kind;
		const ts = event.ts;
		const summary = truncateSummary(event.summary);
		return `${ts} | ${kind} | ${summary}`;
	});
	return `${header}\n${rows.join("\n")}`;
}

export function paginateColaDeAccionesFeed(
	events: readonly ColaDeAccionesEvent[],
	pageIndex: number,
	pageSize: number = COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT,
): {
	page: {
		pageIndex: number;
		pageCount: number;
		pageSize: number;
		total: number;
		start: number;
		end: number;
	};
	events: ColaDeAccionesEvent[];
} {
	const effectivePageSize =
		pageSize > 0 ? pageSize : COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT;
	const total = events.length;
	const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));
	const safeIndex = Math.max(0, Math.min(pageIndex, pageCount - 1));
	const start = safeIndex * effectivePageSize;
	const end = Math.min(start + effectivePageSize, total);
	return {
		page: {
			pageIndex: safeIndex,
			pageCount,
			pageSize: effectivePageSize,
			total,
			start,
			end,
		},
		events: events.slice(start, end),
	};
}
