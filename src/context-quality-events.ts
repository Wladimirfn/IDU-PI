import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ContextBudgetProfile } from "./context-budget.js";

export type ContextQualitySource = "mcp" | "cli";
export type ContextQualityScope = "supervisor_context_pack";
export type ContextQualityRating = "ok" | "warning" | "incomplete";

export type ContextQualityEvent = {
	version: 1;
	id: string;
	timestamp: string;
	projectId: string;
	source: ContextQualitySource;
	scope: ContextQualityScope;
	profile: ContextBudgetProfile | "unknown";
	compactness: ContextQualityRating;
	relevance: ContextQualityRating;
	noise: ContextQualityRating;
	completeness: ContextQualityRating;
	usedChars: number;
	maxTotalChars: number;
	truncated: boolean;
	omittedCount: number;
	omittedReasons: Record<string, number>;
	omittedPaths: Record<string, number>;
	contractsCount: number;
	requiredReadsCount: number;
	risksCount: number;
	autonomyGatesCount: number;
	skipNoiseGuidanceCount: number;
	hasHumanVision: boolean;
	hasPlanObjective: boolean;
	hasTaskGoal: boolean;
	hasTaskPackage: boolean;
	hasTaskContext: boolean;
	ok: boolean;
};

export type ContextQualityRecordInput = Omit<
	Partial<ContextQualityEvent>,
	"version" | "id" | "timestamp" | "projectId" | "source" | "scope"
> & {
	projectId: string;
	source: ContextQualitySource;
	scope: ContextQualityScope;
};

export type ContextQualityRecordResult =
	| { ok: true; path: string }
	| { ok: false; path: string; error: string };

export type ContextQualityReport = {
	version: 1;
	totalEvents: number;
	byScope: Record<string, number>;
	byCompactness: Record<ContextQualityRating, number>;
	byRelevance: Record<ContextQualityRating, number>;
	byNoise: Record<ContextQualityRating, number>;
	byCompleteness: Record<ContextQualityRating, number>;
	truncatedEvents: number;
	omittedReasons: Record<string, number>;
	omittedPaths: Record<string, number>;
	averageUsedChars: number;
	maxObservedChars: number;
	promptTextStored: false;
	rawUserTextStored: false;
	rawDocsStored: false;
	tokensMeasured: false;
	costMeasured: false;
	contextPercentMeasured: false;
	remoteAnalytics: false;
	recent: ContextQualityEvent[];
};

const pendingContextQualityWrites = new Set<
	Promise<ContextQualityRecordResult>
>();
const RATINGS: ContextQualityRating[] = ["ok", "warning", "incomplete"];

export function contextQualityEventsPath(stateRoot: string): string {
	return join(stateRoot, "reports", "context-quality-events.jsonl");
}

export async function recordContextQualityEvent(
	stateRoot: string,
	input: ContextQualityRecordInput,
): Promise<ContextQualityRecordResult> {
	const path = contextQualityEventsPath(stateRoot);
	try {
		await mkdir(dirname(path), { recursive: true });
		const event = normalizeContextQualityEvent(input);
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

export function recordContextQualityEventDeferred(
	stateRoot: string,
	input: ContextQualityRecordInput,
): void {
	const write = recordContextQualityEvent(stateRoot, input);
	pendingContextQualityWrites.add(write);
	void write.finally(() => pendingContextQualityWrites.delete(write));
}

export async function flushContextQualityEvents(): Promise<void> {
	await Promise.allSettled([...pendingContextQualityWrites]);
}

export function readContextQualityEvents(
	stateRoot: string,
	limit = 200,
): ContextQualityEvent[] {
	const path = contextQualityEventsPath(stateRoot);
	if (!existsSync(path)) return [];
	try {
		return readFileSync(path, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(-Math.max(0, limit))
			.flatMap((line) => {
				try {
					const parsed: unknown = JSON.parse(line);
					const event = parseContextQualityEvent(parsed);
					return event ? [event] : [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

export function buildContextQualityReport(
	inputs: Array<ContextQualityEvent | ContextQualityRecordInput>,
	options: { recentLimit?: number } = {},
): ContextQualityReport {
	const events = inputs.map((input) =>
		isPersistedEvent(input) ? input : normalizeContextQualityEvent(input),
	);
	const byScope: Record<string, number> = {};
	const byCompactness = emptyRatings();
	const byRelevance = emptyRatings();
	const byNoise = emptyRatings();
	const byCompleteness = emptyRatings();
	const omittedReasons: Record<string, number> = {};
	const omittedPaths: Record<string, number> = {};
	let truncatedEvents = 0;
	let totalUsedChars = 0;
	let maxObservedChars = 0;
	for (const event of events) {
		increment(byScope, event.scope);
		byCompactness[event.compactness] += 1;
		byRelevance[event.relevance] += 1;
		byNoise[event.noise] += 1;
		byCompleteness[event.completeness] += 1;
		if (event.truncated || event.omittedCount > 0) truncatedEvents += 1;
		totalUsedChars += event.usedChars;
		maxObservedChars = Math.max(maxObservedChars, event.usedChars);
		for (const [reason, count] of Object.entries(event.omittedReasons)) {
			omittedReasons[reason] = (omittedReasons[reason] ?? 0) + count;
		}
		for (const [path, count] of Object.entries(event.omittedPaths)) {
			omittedPaths[path] = (omittedPaths[path] ?? 0) + count;
		}
	}
	return {
		version: 1,
		totalEvents: events.length,
		byScope: sortRecord(byScope),
		byCompactness,
		byRelevance,
		byNoise,
		byCompleteness,
		truncatedEvents,
		omittedReasons: sortRecord(omittedReasons),
		omittedPaths: sortRecord(omittedPaths),
		averageUsedChars: events.length
			? Math.round(totalUsedChars / events.length)
			: 0,
		maxObservedChars,
		promptTextStored: false,
		rawUserTextStored: false,
		rawDocsStored: false,
		tokensMeasured: false,
		costMeasured: false,
		contextPercentMeasured: false,
		remoteAnalytics: false,
		recent: events.slice(-Math.max(0, options.recentLimit ?? 10)),
	};
}

export function contextQualityEventFromSupervisorContextPack(
	projectId: string,
	pack: unknown,
	source: ContextQualitySource = "mcp",
): ContextQualityRecordInput {
	const data = isRecord(pack) ? pack : {};
	const budget = isRecord(data.contextBudget) ? data.contextBudget : undefined;
	const omitted = Array.isArray(budget?.omitted) ? budget.omitted : [];
	const omittedReasons = omittedReasonsFrom(omitted);
	const omittedPaths = omittedPathsFrom(omitted);
	const goals = isRecord(data.goals) ? data.goals : {};
	const hasHumanVision = hasNonEmptyText(goals.humanVision);
	const hasPlanObjective = hasNonEmptyText(goals.planObjective);
	const hasTaskGoal = hasNonEmptyText(goals.taskGoal);
	const contractsCount = arrayCount(data.contracts);
	const requiredReadsCount = arrayCount(data.requiredReads);
	const risksCount = arrayCount(data.risks);
	const autonomyGatesCount = arrayCount(data.autonomyGates);
	const skipNoiseGuidanceCount = arrayCount(data.skipNoiseGuidance);
	const hasTaskPackage = isRecord(data.taskPackage);
	const hasTaskContext = isRecord(data.taskContext);
	const compactness = !budget
		? "incomplete"
		: budget.truncated || omitted.length > 0
			? "warning"
			: "ok";
	const relevance = !hasTaskGoal
		? "incomplete"
		: contractsCount > 0 || requiredReadsCount > 0
			? "ok"
			: "warning";
	const noise = skipNoiseGuidanceCount > 0 ? "ok" : "warning";
	const missingCompleteness = [
		hasHumanVision,
		hasPlanObjective,
		hasTaskGoal,
		hasTaskPackage,
		hasTaskContext,
		autonomyGatesCount > 0,
	].filter((present) => !present).length;
	const completeness =
		!hasTaskGoal || !hasTaskContext
			? "incomplete"
			: missingCompleteness > 0
				? "warning"
				: "ok";
	return {
		projectId,
		source,
		scope: "supervisor_context_pack",
		profile: normalizeProfile(budget?.profile),
		compactness,
		relevance,
		noise,
		completeness,
		usedChars: numberField(budget?.usedChars) ?? 0,
		maxTotalChars: numberField(budget?.maxTotalChars) ?? 0,
		truncated: Boolean(budget?.truncated),
		omittedCount: omitted.length,
		omittedReasons,
		omittedPaths,
		contractsCount,
		requiredReadsCount,
		risksCount,
		autonomyGatesCount,
		skipNoiseGuidanceCount,
		hasHumanVision,
		hasPlanObjective,
		hasTaskGoal,
		hasTaskPackage,
		hasTaskContext,
		ok:
			compactness !== "incomplete" &&
			relevance !== "incomplete" &&
			completeness !== "incomplete",
	};
}

export function formatContextQualityPanel(
	report: ContextQualityReport,
): string {
	return [
		"Calidad de contexto local",
		`eventos contexto: ${report.totalEvents}`,
		`packs supervisor: ${report.byScope.supervisor_context_pack ?? 0}`,
		`compacto: ok ${report.byCompactness.ok} · warning ${report.byCompactness.warning} · incomplete ${report.byCompactness.incomplete}`,
		`relevante: ok ${report.byRelevance.ok} · warning ${report.byRelevance.warning} · incomplete ${report.byRelevance.incomplete}`,
		`ruido: ok ${report.byNoise.ok} · warning ${report.byNoise.warning} · incomplete ${report.byNoise.incomplete}`,
		`completo: ok ${report.byCompleteness.ok} · warning ${report.byCompleteness.warning} · incomplete ${report.byCompleteness.incomplete}`,
		`truncados/omitidos: ${report.truncatedEvents}`,
		`chars promedio/máximo: ${report.averageUsedChars}/${report.maxObservedChars}`,
		"prompts/docs crudos: no almacenado",
		"tokens/costo/% contexto: no medido",
		"analytics remota: no",
	].join("\n");
}

function normalizeContextQualityEvent(
	input: ContextQualityRecordInput,
): ContextQualityEvent {
	const event: ContextQualityEvent = {
		version: 1,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		projectId: sanitizeLabel(input.projectId, "unknown_project"),
		source: input.source === "cli" ? "cli" : "mcp",
		scope: "supervisor_context_pack",
		profile: normalizeProfile(input.profile),
		compactness: normalizeRating(input.compactness),
		relevance: normalizeRating(input.relevance),
		noise: normalizeRating(input.noise),
		completeness: normalizeRating(input.completeness),
		usedChars: safeCount(input.usedChars),
		maxTotalChars: safeCount(input.maxTotalChars),
		truncated: Boolean(input.truncated),
		omittedCount: safeCount(input.omittedCount),
		omittedReasons: normalizeReasonCounts(input.omittedReasons),
		omittedPaths: normalizeReasonCounts(input.omittedPaths),
		contractsCount: safeCount(input.contractsCount),
		requiredReadsCount: safeCount(input.requiredReadsCount),
		risksCount: safeCount(input.risksCount),
		autonomyGatesCount: safeCount(input.autonomyGatesCount),
		skipNoiseGuidanceCount: safeCount(input.skipNoiseGuidanceCount),
		hasHumanVision: Boolean(input.hasHumanVision),
		hasPlanObjective: Boolean(input.hasPlanObjective),
		hasTaskGoal: Boolean(input.hasTaskGoal),
		hasTaskPackage: Boolean(input.hasTaskPackage),
		hasTaskContext: Boolean(input.hasTaskContext),
		ok: Boolean(input.ok),
	};
	return event;
}

function parseContextQualityEvent(
	value: unknown,
): ContextQualityEvent | undefined {
	if (!isRecord(value) || value.version !== 1) return undefined;
	if (typeof value.projectId !== "string") return undefined;
	if (typeof value.id !== "string") return undefined;
	if (typeof value.timestamp !== "string") return undefined;
	return {
		...normalizeContextQualityEvent({
			projectId: value.projectId,
			source: value.source === "cli" ? "cli" : "mcp",
			scope: "supervisor_context_pack",
			profile: normalizeProfile(value.profile),
			compactness: normalizeRating(value.compactness),
			relevance: normalizeRating(value.relevance),
			noise: normalizeRating(value.noise),
			completeness: normalizeRating(value.completeness),
			usedChars: numberField(value.usedChars),
			maxTotalChars: numberField(value.maxTotalChars),
			truncated: Boolean(value.truncated),
			omittedCount: numberField(value.omittedCount),
			omittedReasons: isRecord(value.omittedReasons)
				? normalizeReasonCounts(value.omittedReasons)
				: {},
			omittedPaths: isRecord(value.omittedPaths)
				? normalizeReasonCounts(value.omittedPaths)
				: {},
			contractsCount: numberField(value.contractsCount),
			requiredReadsCount: numberField(value.requiredReadsCount),
			risksCount: numberField(value.risksCount),
			autonomyGatesCount: numberField(value.autonomyGatesCount),
			skipNoiseGuidanceCount: numberField(value.skipNoiseGuidanceCount),
			hasHumanVision: Boolean(value.hasHumanVision),
			hasPlanObjective: Boolean(value.hasPlanObjective),
			hasTaskGoal: Boolean(value.hasTaskGoal),
			hasTaskPackage: Boolean(value.hasTaskPackage),
			hasTaskContext: Boolean(value.hasTaskContext),
			ok: Boolean(value.ok),
		}),
		id: value.id,
		timestamp: value.timestamp,
	};
}

function isPersistedEvent(
	value: ContextQualityEvent | ContextQualityRecordInput,
): value is ContextQualityEvent {
	return "version" in value && "id" in value && "timestamp" in value;
}

function omittedReasonsFrom(items: unknown[]): Record<string, number> {
	const reasons: Record<string, number> = {};
	for (const item of items) {
		if (!isRecord(item)) continue;
		const reason = sanitizeLabel(
			typeof item.reason === "string" ? item.reason : "unknown",
			"unknown",
		);
		reasons[reason] = (reasons[reason] ?? 0) + 1;
	}
	return sortRecord(reasons);
}

function omittedPathsFrom(items: unknown[]): Record<string, number> {
	const paths: Record<string, number> = {};
	for (const item of items) {
		if (!isRecord(item)) continue;
		const path = sanitizeLabel(
			typeof item.path === "string" ? item.path : "unknown",
			"unknown",
		);
		paths[path] = (paths[path] ?? 0) + 1;
	}
	return sortRecord(paths);
}

function normalizeReasonCounts(value: unknown): Record<string, number> {
	if (!isRecord(value)) return {};
	const normalized: Record<string, number> = {};
	for (const [key, count] of Object.entries(value)) {
		const label = sanitizeLabel(key, "unknown");
		normalized[label] = safeCount(count);
	}
	return sortRecord(normalized);
}

function emptyRatings(): Record<ContextQualityRating, number> {
	return { ok: 0, warning: 0, incomplete: 0 };
}

function normalizeRating(value: unknown): ContextQualityRating {
	return typeof value === "string" && RATINGS.includes(value as never)
		? (value as ContextQualityRating)
		: "incomplete";
}

function normalizeProfile(value: unknown): ContextBudgetProfile | "unknown" {
	return typeof value === "string"
		? (sanitizeLabel(value, "unknown") as ContextBudgetProfile | "unknown")
		: "unknown";
}

function increment(target: Record<string, number>, key: string): void {
	target[key] = (target[key] ?? 0) + 1;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function arrayCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function hasNonEmptyText(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? safeCount(value)
		: undefined;
}

function safeCount(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.trunc(value));
}

function sanitizeLabel(value: string, fallback: string): string {
	const sanitized = value
		.replace(/[^A-Za-z0-9._:-]/gu, "_")
		.slice(0, 96)
		.replace(/^_+|_+$/gu, "");
	return sanitized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
