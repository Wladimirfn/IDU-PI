import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type InspectEvent = {
	ts: string;
	kind: string;
	projectId?: string;
	[key: string]: unknown;
};

export type InspectEventsInput = {
	stateRoot: string;
	projectId?: string;
	kinds?: string[];
	since?: Date;
	until?: Date;
	limit?: number;
	now: Date;
	eventsPath?: string;
};

export type InspectEventsResult = {
	total: number;
	filteredCount: number;
	truncated: boolean;
	malformedCount: number;
	events: InspectEvent[];
	filters: {
		projectId?: string;
		kinds?: string[];
		since?: string;
		until?: string;
		limit?: number;
	};
};

const DEFAULT_LIMIT = 50;
const MAX_LINE_BYTES = 200_000;

function isValidEvent(parsed: unknown): parsed is InspectEvent {
	if (typeof parsed !== "object" || parsed === null) return false;
	const r = parsed as Record<string, unknown>;
	return typeof r.ts === "string" && typeof r.kind === "string";
}

function withinRange(ts: string, since: Date | undefined, until: Date | undefined): boolean {
	const ms = Date.parse(ts);
	if (!Number.isFinite(ms)) return false;
	if (since && ms < since.getTime()) return false;
	if (until && ms > until.getTime()) return false;
	return true;
}

function readAllEvents(path: string): { events: InspectEvent[]; malformed: number; total: number } {
	if (!existsSync(path)) return { events: [], malformed: 0, total: 0 };
	const text = readFileSync(path, "utf8");
	const events: InspectEvent[] = [];
	let malformed = 0;
	let total = 0;
	for (const raw of text.split(/\r?\n/)) {
		if (!raw.trim()) continue;
		total++;
		if (raw.length > MAX_LINE_BYTES) {
			malformed++;
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (isValidEvent(parsed)) {
				events.push(parsed);
			} else {
				malformed++;
			}
		} catch {
			malformed++;
		}
	}
	return { events, malformed, total };
}

export function inspectEvents(input: InspectEventsInput): InspectEventsResult {
	const path = input.eventsPath ?? join(input.stateRoot, "events.jsonl");
	const { events, malformed, total } = readAllEvents(path);
	const limit = input.limit ?? DEFAULT_LIMIT;
	const filters: InspectEventsResult["filters"] = {};
	if (input.projectId) filters.projectId = input.projectId;
	if (input.kinds?.length) filters.kinds = input.kinds;
	if (input.since) filters.since = input.since.toISOString();
	if (input.until) filters.until = input.until.toISOString();
	if (input.limit !== undefined) filters.limit = input.limit;

	const filtered: InspectEvent[] = [];
	for (const e of events) {
		if (input.projectId && e.projectId !== input.projectId) continue;
		if (input.kinds && !input.kinds.includes(e.kind)) continue;
		if (!withinRange(e.ts, input.since, input.until)) continue;
		filtered.push(e);
	}

	filtered.sort((a, b) => a.ts.localeCompare(b.ts));
	const truncated = filtered.length > limit;
	const final = truncated ? filtered.slice(filtered.length - limit) : filtered;
	return {
		total,
		filteredCount: filtered.length,
		truncated,
		malformedCount: malformed,
		events: final,
		filters,
	};
}

export function formatInspectEventsReport(result: InspectEventsResult): string {
	const lines: string[] = [];
	lines.push("Events Inspector");
	lines.push("");
	lines.push(
		`total=${result.total} filtered=${result.filteredCount} truncated=${result.truncated} malformed=${result.malformedCount}`,
	);
	const f = result.filters;
	const filterBits: string[] = [];
	if (f.projectId) filterBits.push(`projectId=${f.projectId}`);
	if (f.kinds?.length) filterBits.push(`kinds=${f.kinds.join(",")}`);
	if (f.since) filterBits.push(`since=${f.since}`);
	if (f.until) filterBits.push(`until=${f.until}`);
	if (f.limit !== undefined) filterBits.push(`limit=${f.limit}`);
	if (filterBits.length) lines.push(`filtros: ${filterBits.join(" ")}`);
	if (result.events.length === 0) {
		lines.push("(sin eventos que coincidan)");
		return lines.join("\n");
	}
	lines.push("");
	lines.push("ts                     | kind                              | projectId");
	lines.push("-----------------------+-----------------------------------+----------");
	for (const e of result.events) {
		const ts = e.ts.length >= 19 ? e.ts.slice(11, 19) : e.ts;
		const kind = e.kind.padEnd(33);
		const proj = e.projectId ?? "—";
		lines.push(`${ts} | ${kind} | ${proj}`);
	}
	return lines.join("\n");
}
