import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentLabReviewRequestPlan } from "./agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewRunSummary,
	AgentLabReviewStatus,
} from "./agentlab-review-runner.js";
import type {
	AgentLabFinding,
	AgentLabFindingSeverity,
	AgentLabReviewReport,
	AgentLabWorkloadEnvelope,
} from "./agentlab-supervisor-contract.js";

export type AgentLabEffectivenessEventType =
	| "request_created"
	| "run_completed"
	| "status_checked";

export type AgentLabEffectivenessSource = "mcp" | "cli";

export type AgentLabEffectivenessOutcome =
	| "completed"
	| "partial"
	| "timed_out"
	| "stale"
	| "failed"
	| "security_violation";

export type AgentLabEvidenceCompleteness = "complete" | "partial" | "missing";

export type AgentLabFindingSeverityCounts = Record<
	AgentLabFindingSeverity,
	number
>;

export type AgentLabEffectivenessOutcomeCounts = Record<
	AgentLabEffectivenessOutcome,
	number
>;

export type AgentLabEvidenceCompletenessCounts = Record<
	AgentLabEvidenceCompleteness,
	number
>;

export type AgentLabEffectivenessEvent = {
	version: 1;
	id: string;
	timestamp: string;
	projectId: string;
	eventType: AgentLabEffectivenessEventType;
	source: AgentLabEffectivenessSource;
	requestCount?: number;
	runCount?: number;
	statusCount?: number;
	outcome?: AgentLabEffectivenessOutcome;
	outcomeCounts?: AgentLabEffectivenessOutcomeCounts;
	findingsBySeverity?: AgentLabFindingSeverityCounts;
	requiresHumanApproval?: boolean;
	evidenceCompleteness?: AgentLabEvidenceCompleteness;
	evidenceCompleteRuns?: number;
	evidencePartialRuns?: number;
	evidenceMissingRuns?: number;
	securityViolations?: number;
	staleRequests?: number;
	ok?: boolean;
};

export type AgentLabEffectivenessRecordInput = Omit<
	Partial<AgentLabEffectivenessEvent>,
	"version" | "id" | "timestamp" | "projectId" | "eventType" | "source"
> & {
	projectId: string;
	eventType: AgentLabEffectivenessEventType;
	source: AgentLabEffectivenessSource;
};

export type AgentLabEffectivenessRecordResult =
	| { ok: true; path: string }
	| { ok: false; path: string; error: string };

export type AgentLabEffectivenessReport = {
	version: 1;
	totalEvents: number;
	requestsCreated: number;
	reviewRuns: number;
	statusChecks: number;
	totalRequests: number;
	totalRuns: number;
	outcomes: AgentLabEffectivenessOutcomeCounts;
	findingsBySeverity: AgentLabFindingSeverityCounts;
	humanApprovalRequired: number;
	evidenceCompleteness: AgentLabEvidenceCompletenessCounts;
	securityViolations: number;
	staleRequests: number;
	tokensMeasured: false;
	contextPercentMeasured: false;
	promptTextStored: false;
	rawUserTextStored: false;
	remoteAnalytics: false;
	recent: AgentLabEffectivenessEvent[];
};

const pendingEffectivenessWrites = new Set<
	Promise<AgentLabEffectivenessRecordResult>
>();

const SEVERITIES: AgentLabFindingSeverity[] = [
	"info",
	"low",
	"medium",
	"high",
	"critical",
];

const OUTCOMES: AgentLabEffectivenessOutcome[] = [
	"completed",
	"partial",
	"timed_out",
	"stale",
	"failed",
	"security_violation",
];

export function agentLabEffectivenessEventsPath(stateRoot: string): string {
	return join(stateRoot, "reports", "agentlab-effectiveness-events.jsonl");
}

export async function recordAgentLabEffectivenessEvent(
	stateRoot: string,
	input: AgentLabEffectivenessRecordInput,
): Promise<AgentLabEffectivenessRecordResult> {
	const path = agentLabEffectivenessEventsPath(stateRoot);
	try {
		await mkdir(dirname(path), { recursive: true });
		const event = normalizeAgentLabEffectivenessEvent(input);
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

export function recordAgentLabEffectivenessEventDeferred(
	stateRoot: string,
	input: AgentLabEffectivenessRecordInput,
): void {
	const write = recordAgentLabEffectivenessEvent(stateRoot, input);
	pendingEffectivenessWrites.add(write);
	void write.finally(() => pendingEffectivenessWrites.delete(write));
}

export async function flushAgentLabEffectivenessEvents(): Promise<void> {
	await Promise.allSettled([...pendingEffectivenessWrites]);
}

export function readAgentLabEffectivenessEvents(
	stateRoot: string,
	limit = 200,
): AgentLabEffectivenessEvent[] {
	const path = agentLabEffectivenessEventsPath(stateRoot);
	if (!existsSync(path)) return [];
	try {
		const lines = readFileSync(path, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		return lines.slice(-Math.max(0, limit)).flatMap((line) => {
			try {
				const parsed: unknown = JSON.parse(line);
				const event = parseAgentLabEffectivenessEvent(parsed);
				return event ? [event] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

export function buildAgentLabEffectivenessReport(
	inputs: Array<AgentLabEffectivenessEvent | AgentLabEffectivenessRecordInput>,
	options: { recentLimit?: number } = {},
): AgentLabEffectivenessReport {
	const events = inputs.map((input) =>
		isPersistedEvent(input)
			? input
			: normalizeAgentLabEffectivenessEvent(input),
	);
	const outcomes = emptyOutcomeCounts();
	const findingsBySeverity = emptySeverityCounts();
	const evidenceCompleteness = emptyCompletenessCounts();
	let requestsCreated = 0;
	let reviewRuns = 0;
	let statusChecks = 0;
	let totalRequests = 0;
	let totalRuns = 0;
	let humanApprovalRequired = 0;
	let securityViolations = 0;
	let staleRequests = 0;
	for (const event of events) {
		if (event.eventType === "request_created") requestsCreated += 1;
		else if (event.eventType === "run_completed") reviewRuns += 1;
		else if (event.eventType === "status_checked") statusChecks += 1;
		totalRequests += event.requestCount ?? 0;
		totalRuns += event.runCount ?? 0;
		if (event.requiresHumanApproval) humanApprovalRequired += 1;
		securityViolations += event.securityViolations ?? 0;
		staleRequests += event.staleRequests ?? 0;
		if (event.outcome) outcomes[event.outcome] += 1;
		addCounts(outcomes, event.outcomeCounts);
		addCounts(findingsBySeverity, event.findingsBySeverity);
		evidenceCompleteness.complete += event.evidenceCompleteRuns ?? 0;
		evidenceCompleteness.partial += event.evidencePartialRuns ?? 0;
		evidenceCompleteness.missing += event.evidenceMissingRuns ?? 0;
		if (event.evidenceCompleteness)
			evidenceCompleteness[event.evidenceCompleteness] += 1;
	}
	return {
		version: 1,
		totalEvents: events.length,
		requestsCreated,
		reviewRuns,
		statusChecks,
		totalRequests,
		totalRuns,
		outcomes,
		findingsBySeverity,
		humanApprovalRequired,
		evidenceCompleteness,
		securityViolations,
		staleRequests,
		tokensMeasured: false,
		contextPercentMeasured: false,
		promptTextStored: false,
		rawUserTextStored: false,
		remoteAnalytics: false,
		recent: events.slice(-Math.max(0, options.recentLimit ?? 10)),
	};
}

export function agentLabEffectivenessEventFromRequestPlan(
	projectId: string,
	plan: AgentLabReviewRequestPlan,
	source: AgentLabEffectivenessSource = "mcp",
): AgentLabEffectivenessRecordInput {
	return {
		projectId,
		eventType: "request_created",
		source,
		requestCount: plan.requests.length,
		requiresHumanApproval: plan.requests.some(
			(request) => request.requiresHumanApproval,
		),
		ok: plan.errors.length === 0,
	};
}

export function agentLabEffectivenessEventFromRunResult(
	projectId: string,
	result: AgentLabReviewRunResult,
	source: AgentLabEffectivenessSource = "mcp",
): AgentLabEffectivenessRecordInput {
	const outcomeCounts = emptyOutcomeCounts();
	const completeness = emptyCompletenessCounts();
	for (const run of result.runs) {
		const outcome = outcomeFromRunStatus(run.status);
		if (outcome) outcomeCounts[outcome] += 1;
		completeness[evidenceCompletenessForRun(run)] += 1;
	}
	return {
		projectId,
		eventType: "run_completed",
		source,
		runCount: result.runs.length,
		outcomeCounts,
		findingsBySeverity: severityCounts(result.consolidatedFindings),
		requiresHumanApproval:
			result.requiresHumanApproval ||
			result.runs.some((run) => run.requiresHumanApproval),
		evidenceCompleteRuns: completeness.complete,
		evidencePartialRuns: completeness.partial,
		evidenceMissingRuns: completeness.missing,
		securityViolations: result.runs.filter(
			(run) => run.status === "security_violation",
		).length,
		ok: !result.runs.some((run) =>
			["failed", "security_violation", "timed_out"].includes(run.status),
		),
	};
}

export function agentLabEffectivenessEventFromStatus(
	projectId: string,
	status: AgentLabReviewStatus,
	workloadEnvelope?: AgentLabWorkloadEnvelope,
	source: AgentLabEffectivenessSource = "mcp",
): AgentLabEffectivenessRecordInput {
	const staleRequests =
		workloadEnvelope?.staleRequests ??
		(status.errors.some((error) => /stale|run stale/iu.test(error)) ? 1 : 0);
	if (status.result) {
		return {
			projectId,
			eventType: "status_checked",
			source,
			statusCount: 1,
			staleRequests,
			ok: status.valid,
		};
	}
	return {
		projectId,
		eventType: "status_checked",
		source,
		statusCount: 1,
		outcome: staleRequests > 0 ? "stale" : status.valid ? undefined : "failed",
		staleRequests,
		requiresHumanApproval: !status.valid,
		evidenceMissingRuns: status.valid ? 0 : 1,
		ok: status.valid,
	};
}

function normalizeAgentLabEffectivenessEvent(
	input: AgentLabEffectivenessRecordInput,
): AgentLabEffectivenessEvent {
	return {
		version: 1,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		projectId: sanitizeLabel(input.projectId, "unknown_project"),
		eventType: normalizeEventType(input.eventType),
		source: input.source === "cli" ? "cli" : "mcp",
		...optionalNumber("requestCount", input.requestCount),
		...optionalNumber("runCount", input.runCount),
		...optionalNumber("statusCount", input.statusCount),
		...(input.outcome && isOutcome(input.outcome)
			? { outcome: input.outcome }
			: {}),
		...(input.outcomeCounts
			? { outcomeCounts: normalizeOutcomeCounts(input.outcomeCounts) }
			: {}),
		...(input.findingsBySeverity
			? {
					findingsBySeverity: normalizeSeverityCounts(input.findingsBySeverity),
				}
			: {}),
		...(typeof input.requiresHumanApproval === "boolean"
			? { requiresHumanApproval: input.requiresHumanApproval }
			: {}),
		...(input.evidenceCompleteness && isCompleteness(input.evidenceCompleteness)
			? { evidenceCompleteness: input.evidenceCompleteness }
			: {}),
		...optionalNumber("evidenceCompleteRuns", input.evidenceCompleteRuns),
		...optionalNumber("evidencePartialRuns", input.evidencePartialRuns),
		...optionalNumber("evidenceMissingRuns", input.evidenceMissingRuns),
		...optionalNumber("securityViolations", input.securityViolations),
		...optionalNumber("staleRequests", input.staleRequests),
		...(typeof input.ok === "boolean" ? { ok: input.ok } : {}),
	};
}

function isPersistedEvent(
	value: AgentLabEffectivenessEvent | AgentLabEffectivenessRecordInput,
): value is AgentLabEffectivenessEvent {
	return "version" in value && "id" in value && "timestamp" in value;
}

function parseAgentLabEffectivenessEvent(
	value: unknown,
): AgentLabEffectivenessEvent | undefined {
	if (!isRecord(value) || value.version !== 1) return undefined;
	if (typeof value.projectId !== "string") return undefined;
	if (typeof value.id !== "string") return undefined;
	if (typeof value.timestamp !== "string") return undefined;
	if (!isEventType(value.eventType)) return undefined;
	if (value.source !== "mcp" && value.source !== "cli") return undefined;
	return normalizeAgentLabEffectivenessEvent({
		projectId: value.projectId,
		eventType: value.eventType,
		source: value.source,
		requestCount: numberField(value.requestCount),
		runCount: numberField(value.runCount),
		statusCount: numberField(value.statusCount),
		outcome: isOutcome(value.outcome) ? value.outcome : undefined,
		outcomeCounts: isRecord(value.outcomeCounts)
			? normalizeOutcomeCounts(value.outcomeCounts)
			: undefined,
		findingsBySeverity: isRecord(value.findingsBySeverity)
			? normalizeSeverityCounts(value.findingsBySeverity)
			: undefined,
		requiresHumanApproval:
			typeof value.requiresHumanApproval === "boolean"
				? value.requiresHumanApproval
				: undefined,
		evidenceCompleteness: isCompleteness(value.evidenceCompleteness)
			? value.evidenceCompleteness
			: undefined,
		evidenceCompleteRuns: numberField(value.evidenceCompleteRuns),
		evidencePartialRuns: numberField(value.evidencePartialRuns),
		evidenceMissingRuns: numberField(value.evidenceMissingRuns),
		securityViolations: numberField(value.securityViolations),
		staleRequests: numberField(value.staleRequests),
		ok: typeof value.ok === "boolean" ? value.ok : undefined,
	});
}

function evidenceCompletenessForRun(
	run: AgentLabReviewRunSummary,
): AgentLabEvidenceCompleteness {
	if (run.status === "partial" || (run.qualityWarnings?.length ?? 0) > 0) {
		return "partial";
	}
	if (!run.parsedReport || !run.contractValidation.valid) return "missing";
	if (run.parsedReport.evidence.length === 0) return "missing";
	const findings = allReportFindings(run.parsedReport);
	if (findings.some((finding) => !finding.evidence.trim())) return "partial";
	return "complete";
}

function outcomeFromRunStatus(
	status: AgentLabReviewRunSummary["status"],
): AgentLabEffectivenessOutcome | undefined {
	if (status === "completed") return "completed";
	if (status === "partial") return "partial";
	if (status === "timed_out") return "timed_out";
	if (status === "failed") return "failed";
	if (status === "security_violation") return "security_violation";
	return undefined;
}

function severityCounts(
	findings: AgentLabFinding[],
): AgentLabFindingSeverityCounts {
	const counts = emptySeverityCounts();
	for (const finding of findings) {
		if (SEVERITIES.includes(finding.severity)) counts[finding.severity] += 1;
	}
	return counts;
}

function allReportFindings(report: AgentLabReviewReport): AgentLabFinding[] {
	return [
		...report.qualityFindings,
		...report.safetyFindings,
		...report.architectureFindings,
		...report.tokenCostFindings,
		...report.timeFindings,
		...report.resourceFindings,
	];
}

function emptyOutcomeCounts(): AgentLabEffectivenessOutcomeCounts {
	return {
		completed: 0,
		partial: 0,
		timed_out: 0,
		stale: 0,
		failed: 0,
		security_violation: 0,
	};
}

function emptySeverityCounts(): AgentLabFindingSeverityCounts {
	return { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
}

function emptyCompletenessCounts(): AgentLabEvidenceCompletenessCounts {
	return { complete: 0, partial: 0, missing: 0 };
}

function normalizeOutcomeCounts(
	value: Record<string, unknown>,
): AgentLabEffectivenessOutcomeCounts {
	const counts = emptyOutcomeCounts();
	for (const outcome of OUTCOMES) counts[outcome] = safeCount(value[outcome]);
	return counts;
}

function normalizeSeverityCounts(
	value: Record<string, unknown>,
): AgentLabFindingSeverityCounts {
	const counts = emptySeverityCounts();
	for (const severity of SEVERITIES)
		counts[severity] = safeCount(value[severity]);
	return counts;
}

function addCounts<T extends string>(
	target: Record<T, number>,
	counts: Record<T, number> | undefined,
): void {
	if (!counts) return;
	for (const key of Object.keys(target) as T[]) {
		target[key] += counts[key] ?? 0;
	}
}

function optionalNumber<K extends string>(
	key: K,
	value: number | undefined,
): Partial<Record<K, number>> {
	if (value === undefined) return {};
	const result: Partial<Record<K, number>> = {};
	result[key] = safeCount(value);
	return result;
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

function normalizeEventType(
	type: AgentLabEffectivenessEventType,
): AgentLabEffectivenessEventType {
	return isEventType(type) ? type : "status_checked";
}

function isEventType(value: unknown): value is AgentLabEffectivenessEventType {
	return (
		value === "request_created" ||
		value === "run_completed" ||
		value === "status_checked"
	);
}

function isOutcome(value: unknown): value is AgentLabEffectivenessOutcome {
	return typeof value === "string" && OUTCOMES.includes(value as never);
}

function isCompleteness(value: unknown): value is AgentLabEvidenceCompleteness {
	return value === "complete" || value === "partial" || value === "missing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
