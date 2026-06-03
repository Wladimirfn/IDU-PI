import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export type IduUsageSurface = "cli" | "mcp";

export type IduUsageEvent = {
	version: 1;
	id: string;
	timestamp: string;
	projectId: string;
	surface: IduUsageSurface;
	action: string;
	active?: boolean;
	risk?: string;
	recommendation?: string;
	allowedToProceed?: boolean;
	requiresHuman?: boolean;
	durationMs?: number;
	ok?: boolean;
};

export type IduUsageRecordInput = Omit<
	Partial<IduUsageEvent>,
	"version" | "id" | "timestamp" | "projectId" | "surface" | "action"
> & {
	projectId: string;
	surface: IduUsageSurface;
	action: string;
};

export type IduUsageRecordResult =
	| { ok: true; path: string }
	| { ok: false; path: string; error: string };

export type IduUsageSummary = {
	version: 1;
	totalEvents: number;
	bySurface: Record<string, number>;
	byAction: Record<string, number>;
	byRecommendation: Record<string, number>;
	active: { true: number; false: number; unknown: number };
	allowedToProceed: { true: number; false: number; unknown: number };
	requiresHuman: { true: number; false: number; unknown: number };
	recent: IduUsageEvent[];
};

export type IduUsageReport = {
	version: 1;
	totalEvents: number;
	lastActivity?: string;
	surface: { cli: number; mcp: number; other: number };
	active: { true: number; false: number; unknown: number };
	requiresHuman: number;
	notAllowed: number;
	failed: number;
	topActions: { action: string; count: number }[];
	topRecommendations: { recommendation: string; count: number }[];
	recent: IduUsageEvent[];
};

const SAFE_LABEL_RE = /[^A-Za-z0-9._:-]/gu;
const MAX_LABEL_LENGTH = 96;
const pendingUsageWrites = new Set<Promise<IduUsageRecordResult>>();

export function usageEventsPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-usage-events.jsonl");
}

export async function recordIduUsageEvent(
	stateRoot: string,
	input: IduUsageRecordInput,
): Promise<IduUsageRecordResult> {
	const path = usageEventsPath(stateRoot);
	try {
		await mkdir(dirname(path), { recursive: true });
		const event = normalizeUsageEvent(input);
		await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
		return { ok: true, path };
	} catch (error) {
		return {
			ok: false,
			path,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function recordIduUsageEventDeferred(
	stateRoot: string,
	input: IduUsageRecordInput,
): void {
	const write = recordIduUsageEvent(stateRoot, input);
	pendingUsageWrites.add(write);
	void write.finally(() => pendingUsageWrites.delete(write));
}

export async function flushIduUsageEvents(): Promise<void> {
	await Promise.allSettled([...pendingUsageWrites]);
}

export function readIduUsageEvents(
	stateRoot: string,
	limit = 200,
): IduUsageEvent[] {
	const path = usageEventsPath(stateRoot);
	if (!existsSync(path)) return [];
	try {
		const lines = readFileSync(path, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		const bounded = lines.slice(-Math.max(0, limit));
		return bounded.flatMap((line) => {
			try {
				const parsed: unknown = JSON.parse(line);
				const event = parseUsageEvent(parsed);
				return event ? [event] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

export function summarizeIduUsageEvents(
	events: IduUsageEvent[],
): IduUsageSummary {
	const bySurface: Record<string, number> = {};
	const byAction: Record<string, number> = {};
	const byRecommendation: Record<string, number> = {};
	const active = { true: 0, false: 0, unknown: 0 };
	const allowedToProceed = { true: 0, false: 0, unknown: 0 };
	const requiresHuman = { true: 0, false: 0, unknown: 0 };
	for (const event of events) {
		increment(bySurface, event.surface);
		increment(byAction, event.action);
		increment(byRecommendation, event.recommendation ?? "unknown");
		incrementTriState(active, event.active);
		incrementTriState(allowedToProceed, event.allowedToProceed);
		incrementTriState(requiresHuman, event.requiresHuman);
	}
	return {
		version: 1,
		totalEvents: events.length,
		bySurface: sortRecord(bySurface),
		byAction: sortRecord(byAction),
		byRecommendation: sortRecord(byRecommendation),
		active,
		allowedToProceed,
		requiresHuman,
		recent: events.slice(-10),
	};
}

export function buildIduUsageReport(
	events: IduUsageEvent[],
	options: { topLimit?: number; recentLimit?: number } = {},
): IduUsageReport {
	const topLimit = Math.max(1, options.topLimit ?? 5);
	const recentLimit = Math.max(0, options.recentLimit ?? 5);
	const byAction: Record<string, number> = {};
	const byRecommendation: Record<string, number> = {};
	const surface = { cli: 0, mcp: 0, other: 0 };
	const active = { true: 0, false: 0, unknown: 0 };
	let requiresHuman = 0;
	let notAllowed = 0;
	let failed = 0;
	for (const event of events) {
		if (event.surface === "cli") surface.cli += 1;
		else if (event.surface === "mcp") surface.mcp += 1;
		else surface.other += 1;
		incrementTriState(active, event.active);
		if (event.requiresHuman === true) requiresHuman += 1;
		if (event.allowedToProceed === false) notAllowed += 1;
		if (event.ok === false) failed += 1;
		increment(byAction, event.action);
		increment(byRecommendation, event.recommendation ?? "unknown");
	}
	return {
		version: 1,
		totalEvents: events.length,
		...(events.length
			? { lastActivity: events[events.length - 1]?.timestamp }
			: {}),
		surface,
		active,
		requiresHuman,
		notAllowed,
		failed,
		topActions: topEntries(byAction, topLimit).map(([action, count]) => ({
			action,
			count,
		})),
		topRecommendations: topEntries(byRecommendation, topLimit).map(
			([recommendation, count]) => ({ recommendation, count }),
		),
		recent: events.slice(-recentLimit),
	};
}

export function formatIduUsagePanel(report: IduUsageReport): string {
	if (report.totalEvents === 0) {
		return ["Uso local", "eventos: 0", "última actividad: sin eventos"].join(
			"\n",
		);
	}
	return [
		"Uso local",
		`eventos: ${report.totalEvents}`,
		`última actividad: ${formatRelativeUsageTime(report.lastActivity)}`,
		`superficie: cli ${report.surface.cli} · mcp ${report.surface.mcp}`,
		`activo/inactivo: ${report.active.true} / ${report.active.false}`,
		`requiere humano: ${report.requiresHuman}`,
		`bloqueados/no permitido: ${report.notAllowed}`,
		`errores: ${report.failed}`,
		"acciones top:",
		...(report.topActions.length
			? report.topActions.map((entry) => `- ${entry.action} ${entry.count}`)
			: ["- sin acciones"]),
	].join("\n");
}

export function formatIduUsageSummary(summary: IduUsageSummary): string {
	return [
		"Uso Idu-pi",
		"",
		`eventos: ${summary.totalEvents}`,
		"",
		"por superficie:",
		...formatCountRecord(summary.bySurface),
		"",
		"por acción:",
		...formatCountRecord(summary.byAction),
		"",
		"por recomendación:",
		...formatCountRecord(summary.byRecommendation),
		"",
		`activo: true=${summary.active.true}, false=${summary.active.false}, unknown=${summary.active.unknown}`,
		`allowedToProceed: true=${summary.allowedToProceed.true}, false=${summary.allowedToProceed.false}, unknown=${summary.allowedToProceed.unknown}`,
		`requiresHuman: true=${summary.requiresHuman.true}, false=${summary.requiresHuman.false}, unknown=${summary.requiresHuman.unknown}`,
		"",
		"recientes:",
		...(summary.recent.length
			? summary.recent.map(
					(event) =>
						`- ${event.timestamp} ${event.surface}/${event.action} ok=${event.ok ?? "unknown"} recommendation=${event.recommendation ?? "unknown"}`,
				)
			: ["- sin eventos"]),
	].join("\n");
}

function normalizeUsageEvent(input: IduUsageRecordInput): IduUsageEvent {
	return {
		version: 1,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		projectId: sanitizeLabel(input.projectId),
		surface: input.surface,
		action: sanitizeLabel(input.action),
		...(typeof input.active === "boolean" ? { active: input.active } : {}),
		...(input.risk ? { risk: sanitizeLabel(input.risk) } : {}),
		...(input.recommendation
			? { recommendation: sanitizeLabel(input.recommendation) }
			: {}),
		...(typeof input.allowedToProceed === "boolean"
			? { allowedToProceed: input.allowedToProceed }
			: {}),
		...(typeof input.requiresHuman === "boolean"
			? { requiresHuman: input.requiresHuman }
			: {}),
		...(typeof input.durationMs === "number" &&
		Number.isFinite(input.durationMs)
			? { durationMs: Math.max(0, Math.round(input.durationMs)) }
			: {}),
		...(typeof input.ok === "boolean" ? { ok: input.ok } : {}),
	};
}

function parseUsageEvent(value: unknown): IduUsageEvent | undefined {
	if (!isRecord(value)) return undefined;
	if (value.version !== 1) return undefined;
	if (typeof value.id !== "string" || !value.id.trim()) return undefined;
	if (typeof value.timestamp !== "string" || !value.timestamp.trim()) {
		return undefined;
	}
	if (typeof value.projectId !== "string" || !value.projectId.trim()) {
		return undefined;
	}
	if (value.surface !== "cli" && value.surface !== "mcp") return undefined;
	if (typeof value.action !== "string" || !value.action.trim())
		return undefined;
	return {
		version: 1,
		id: sanitizeLabel(value.id),
		timestamp: value.timestamp,
		projectId: sanitizeLabel(value.projectId),
		surface: value.surface,
		action: sanitizeLabel(value.action),
		...(typeof value.active === "boolean" ? { active: value.active } : {}),
		...(typeof value.risk === "string"
			? { risk: sanitizeLabel(value.risk) }
			: {}),
		...(typeof value.recommendation === "string"
			? { recommendation: sanitizeLabel(value.recommendation) }
			: {}),
		...(typeof value.allowedToProceed === "boolean"
			? { allowedToProceed: value.allowedToProceed }
			: {}),
		...(typeof value.requiresHuman === "boolean"
			? { requiresHuman: value.requiresHuman }
			: {}),
		...(typeof value.durationMs === "number" &&
		Number.isFinite(value.durationMs)
			? { durationMs: Math.max(0, Math.round(value.durationMs)) }
			: {}),
		...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
	};
}

function sanitizeLabel(value: string): string {
	const sanitized = value
		.trim()
		.replace(SAFE_LABEL_RE, "_")
		.slice(0, MAX_LABEL_LENGTH);
	return sanitized || "unknown";
}

function increment(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
}

function incrementTriState(
	state: { true: number; false: number; unknown: number },
	value: boolean | undefined,
): void {
	if (value === true) state.true += 1;
	else if (value === false) state.false += 1;
	else state.unknown += 1;
}

function topEntries(
	record: Record<string, number>,
	limit: number,
): [string, number][] {
	return Object.entries(record)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit);
}

function formatRelativeUsageTime(timestamp?: string): string {
	if (!timestamp) return "sin eventos";
	const time = Date.parse(timestamp);
	if (!Number.isFinite(time)) return timestamp;
	const diffMs = Math.max(0, Date.now() - time);
	const diffMinutes = Math.floor(diffMs / 60_000);
	if (diffMinutes < 1) return "recién";
	if (diffMinutes < 60) return `hace ${diffMinutes}m`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `hace ${diffHours}h`;
	const diffDays = Math.floor(diffHours / 24);
	return `hace ${diffDays}d`;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(record).sort(
			([leftKey, leftValue], [rightKey, rightValue]) =>
				rightValue - leftValue || leftKey.localeCompare(rightKey),
		),
	);
}

function formatCountRecord(record: Record<string, number>): string[] {
	const entries = Object.entries(record);
	if (!entries.length) return ["- sin datos"];
	return entries.map(([key, count]) => `- ${key}: ${count}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
