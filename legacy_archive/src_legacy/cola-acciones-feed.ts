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
import { isAgentLabRunFilename } from "./agentlab-run-selector.js";

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

/**
 * Short Spanish labels for the supervisor step-status counts. Only the
 * statuses that carry a result signal are rendered; "inactive" (a step
 * that never ran) is intentionally omitted because it adds no signal.
 */
const STEP_LABEL_ES: Record<string, string> = {
	completed: "ok",
	skipped: "skip",
	active: "activa",
	warning: "alerta",
};

const SKIP_REASON_ES: Record<string, string> = {
	idu_inactive: "idu inactivo",
	no_new_events: "sin eventos nuevos",
	not_enough_data: "sin datos suficientes",
	throttled: "throttled",
	supervisor_failed: "falló el supervisor",
};

const USAGE_RECOMMENDATION_ES: Record<string, string> = {
	allow: "permitido",
	proceed: "procedió",
	warn: "advertencia",
	block: "bloqueado",
	ask_human: "pide humano",
	needs_evidence: "pide evidencia",
	needs_deeper_audit: "pide auditoría profunda",
};

function renderStepCounts(
	stepCounts: Record<string, number> | undefined,
): string {
	if (!stepCounts) return "";
	const parts: string[] = [];
	for (const key of ["completed", "skipped", "active", "warning"]) {
		const count = stepCounts[key];
		if (typeof count === "number" && count > 0) {
			parts.push(`${count} ${STEP_LABEL_ES[key]}`);
		}
	}
	return parts.join(" · ");
}

function recommendationEs(
	recommendation: string | undefined,
): string | undefined {
	if (!recommendation) return undefined;
	const mapped = USAGE_RECOMMENDATION_ES[recommendation];
	if (mapped) return mapped;
	// Unknown recommendation strings (e.g. long advisory sentences stored
	// verbatim) are themselves the outcome; surface them cleaned up.
	return recommendation.replace(/_/gu, " ").trim();
}

/**
 * Build a human-readable RESULT summary for a supervisor activity event
 * from the event's own data — not its type labels. The panel already
 * renders the timestamp; this string answers "¿qué pasó?".
 */
function summarizeSupervisorResult(event: SupervisorActivityEvent): string {
	const triggerLabel = event.trigger ? ` (${event.trigger})` : "";
	if (event.status === "skipped") {
		if (event.reason) {
			const reason = SKIP_REASON_ES[event.reason] ?? event.reason;
			return `supervisor omitido${triggerLabel}: ${reason}`;
		}
		return `supervisor omitido${triggerLabel}`;
	}
	const products: string[] = [];
	if (typeof event.createdTasks === "number" && event.createdTasks > 0) {
		products.push(
			`${event.createdTasks} tarea${event.createdTasks === 1 ? "" : "s"}`,
		);
	}
	if (event.auditRunRecorded) products.push("audit registrada");
	if (event.semanticDraftCreated) products.push("draft");
	if (event.agentTaskPlanBuilt) products.push("plan");
	const steps = renderStepCounts(event.stepCounts);
	if (products.length === 0) {
		const lead =
			event.status === "planned"
				? "planificado sin escrituras"
				: event.reason === "not_enough_data"
					? "sin hallazgos accionables"
					: "ejecutado sin productos";
		return `supervisor${triggerLabel}: ${lead}${steps ? ` · ${steps}` : ""}`;
	}
	return `supervisor${triggerLabel}: ${products.join(" · ")}${steps ? ` · ${steps}` : ""}`;
}

/**
 * Build a human-readable OUTCOME summary for an idu usage event from the
 * event's own data (recommendation / allowedToProceed / requiresHuman /
 * ok), instead of the raw "trigger fire: surface/action" type label.
 */
function summarizeUsageResult(event: IduUsageEvent): string {
	const parts: string[] = [];
	const rec = recommendationEs(event.recommendation);
	if (rec) parts.push(rec);
	const flags = [
		event.requiresHuman === true ? "pide humano" : null,
		event.allowedToProceed === false ? "bloqueado" : null,
	];
	for (const flag of flags) {
		// Avoid duplicating a flag the recommendation already states
		// (e.g. recommendation "block" + allowedToProceed=false).
		if (flag && !parts.includes(flag)) parts.push(flag);
	}
	if (event.ok === false) parts.push("error");
	let outcome: string;
	if (parts.length > 0) {
		outcome = parts.join(" · ");
	} else if (event.ok === true) {
		outcome = "ok";
	} else {
		outcome = "sin resultado registrado";
	}
	return `${event.action} → ${outcome}`;
}

function normalizeSupervisorEvents(
	events: readonly SupervisorActivityEvent[],
): ColaDeAccionesEvent[] {
	const out: ColaDeAccionesEvent[] = [];
	for (const event of events) {
		out.push({
			kind: "supervisor",
			summary: summarizeSupervisorResult(event),
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
		out.push({
			kind: "trigger",
			summary: summarizeUsageResult(event),
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
		isAgentLabRunFilename(name),
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

/**
 * Format a UTC ISO-8601 timestamp (`...Z`) as the operator's local
 * time, `YYYY-MM-DD HH:MM:SS`. The "Cola de acciones" panel previously
 * printed the raw ISO string with the trailing `Z`, which was correct
 * but not human-readable in the operator's local time (8 AM showed
 * up as "13:00" for an operator on UTC-3). This helper keeps the
 * original `ts` (UTC) intact in the event object — only the display
 * path formats to local.
 *
 * Returns the raw string on parse failure (so a malformed entry
 * never breaks the whole feed).
 */
function formatLocalTs(ts: string): string {
	const ms = Date.parse(ts);
	if (!Number.isFinite(ms)) return ts;
	const d = new Date(ms);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
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
		const ts = formatLocalTs(event.ts);
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
