import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type {
	IduSupervisorStepStatus,
	IduSupervisorTrigger,
	IduSupervisorLoopResult,
} from "./idu-supervisor-loop.js";

export type SupervisorActivityOrigin =
	| "supervisor_auto_hook"
	| "supervisor_manual_tick"
	| "tui_user_action"
	| "pi_runtime_event"
	| "orchestrator_requested";

export type SupervisorActivityEventType =
	| "supervisor_hook"
	| "supervisor_tick"
	| "supervisor_cron_plan";

export type SupervisorActivityStatus =
	| "completed"
	| "skipped"
	| "warning"
	| "planned";

export type SupervisorActivityReason =
	| "idu_inactive"
	| "no_new_events"
	| "throttled"
	| "supervisor_failed"
	| "not_enough_data";

export type SupervisorActivityStepCounts = Record<
	IduSupervisorStepStatus,
	number
>;

export type SupervisorActivityEvent = {
	version: 1;
	id: string;
	timestamp: string;
	projectId: string;
	eventType: SupervisorActivityEventType;
	origin: SupervisorActivityOrigin;
	trigger: IduSupervisorTrigger;
	status: SupervisorActivityStatus;
	reason?: SupervisorActivityReason;
	active?: boolean;
	bypassedThrottle?: boolean;
	dryRun?: boolean;
	planMode?: boolean;
	stepCounts?: SupervisorActivityStepCounts;
	createdTasks?: number;
	auditRunRecorded?: boolean;
	semanticDraftCreated?: boolean;
	agentTaskPlanBuilt?: boolean;
	durationMs?: number;
	ok?: boolean;
};

export type SupervisorActivityRecordInput = Omit<
	Partial<SupervisorActivityEvent>,
	| "version"
	| "id"
	| "timestamp"
	| "projectId"
	| "eventType"
	| "origin"
	| "trigger"
	| "status"
> & {
	projectId: string;
	eventType: SupervisorActivityEventType;
	origin: SupervisorActivityOrigin;
	trigger: IduSupervisorTrigger;
	status: SupervisorActivityStatus;
};

export type SupervisorActivityRecordResult =
	| { ok: true; path: string }
	| { ok: false; path: string; error: string };

export type SupervisorActivitySummary = {
	version: 1;
	totalEvents: number;
	totalTicks: number;
	totalHooks: number;
	totalCronPlans: number;
	byOrigin: Record<string, number>;
	byTrigger: Record<string, number>;
	byStatus: Record<string, number>;
	byReason: Record<string, number>;
	active: { true: number; false: number; unknown: number };
	createdTasks: number;
	auditRunsRecorded: number;
	semanticDraftsCreated: number;
	agentTaskPlansBuilt: number;
	recent: SupervisorActivityEvent[];
	tokensMeasured: false;
	contextPercentMeasured: false;
	remoteAnalytics: false;
};

export type SupervisorActivityReport = SupervisorActivitySummary;

const SAFE_LABEL_RE = /[^A-Za-z0-9._:-]/gu;
const MAX_LABEL_LENGTH = 96;
const pendingSupervisorActivityWrites = new Set<
	Promise<SupervisorActivityRecordResult>
>();

const STEP_STATUSES: IduSupervisorStepStatus[] = [
	"active",
	"inactive",
	"completed",
	"skipped",
	"warning",
];

export function supervisorActivityEventsPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-supervisor-activity-events.jsonl");
}

export async function recordSupervisorActivityEvent(
	stateRoot: string,
	input: SupervisorActivityRecordInput,
): Promise<SupervisorActivityRecordResult> {
	const path = supervisorActivityEventsPath(stateRoot);
	try {
		await mkdir(dirname(path), { recursive: true });
		const event = normalizeSupervisorActivityEvent(input);
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

export function recordSupervisorActivityEventDeferred(
	stateRoot: string,
	input: SupervisorActivityRecordInput,
): void {
	const write = recordSupervisorActivityEvent(stateRoot, input);
	pendingSupervisorActivityWrites.add(write);
	void write.finally(() => pendingSupervisorActivityWrites.delete(write));
}

export async function flushSupervisorActivityEvents(): Promise<void> {
	await Promise.allSettled([...pendingSupervisorActivityWrites]);
}

export function readSupervisorActivityEvents(
	stateRoot: string,
	limit = 200,
): SupervisorActivityEvent[] {
	const path = supervisorActivityEventsPath(stateRoot);
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
				const event = parseSupervisorActivityEvent(parsed);
				return event ? [event] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

export function filterRecentSupervisorActivityEvents(
	events: readonly SupervisorActivityEvent[],
	now: Date,
	windowMs: number,
): SupervisorActivityEvent[] {
	const cutoffMs = now.getTime() - Math.max(0, windowMs);
	return events.filter((event) => {
		const eventMs = Date.parse(event.timestamp);
		return Number.isFinite(eventMs) && eventMs >= cutoffMs;
	});
}

export function summarizeSupervisorActivityEvents(
	events: SupervisorActivityEvent[],
): SupervisorActivitySummary {
	const byOrigin: Record<string, number> = {};
	const byTrigger: Record<string, number> = {};
	const byStatus: Record<string, number> = {};
	const byReason: Record<string, number> = {};
	const active = { true: 0, false: 0, unknown: 0 };
	let totalTicks = 0;
	let totalHooks = 0;
	let totalCronPlans = 0;
	let createdTasks = 0;
	let auditRunsRecorded = 0;
	let semanticDraftsCreated = 0;
	let agentTaskPlansBuilt = 0;
	for (const event of events) {
		if (event.eventType === "supervisor_tick") totalTicks += 1;
		else if (event.eventType === "supervisor_hook") totalHooks += 1;
		else if (event.eventType === "supervisor_cron_plan") totalCronPlans += 1;
		increment(byOrigin, event.origin);
		increment(byTrigger, event.trigger);
		increment(byStatus, event.status);
		if (event.reason) increment(byReason, event.reason);
		incrementTriState(active, event.active);
		createdTasks += event.createdTasks ?? 0;
		if (event.auditRunRecorded) auditRunsRecorded += 1;
		if (event.semanticDraftCreated) semanticDraftsCreated += 1;
		if (event.agentTaskPlanBuilt) agentTaskPlansBuilt += 1;
	}
	return {
		version: 1,
		totalEvents: events.length,
		totalTicks,
		totalHooks,
		totalCronPlans,
		byOrigin: sortRecord(byOrigin),
		byTrigger: sortRecord(byTrigger),
		byStatus: sortRecord(byStatus),
		byReason: sortRecord(byReason),
		active,
		createdTasks,
		auditRunsRecorded,
		semanticDraftsCreated,
		agentTaskPlansBuilt,
		recent: events.slice(-10),
		tokensMeasured: false,
		contextPercentMeasured: false,
		remoteAnalytics: false,
	};
}

export function buildSupervisorActivityReport(
	events: SupervisorActivityEvent[],
): SupervisorActivityReport {
	return summarizeSupervisorActivityEvents(events);
}

export function formatSupervisorActivityPanel(
	report: SupervisorActivityReport,
): string {
	return [
		"Actividad supervisor local",
		`eventos supervisor: ${report.totalEvents}`,
		`hooks automáticos: ${report.totalHooks}`,
		`ticks manuales: ${report.totalTicks}`,
		`cron plans: ${report.totalCronPlans}`,
		`estado: ${report.totalEvents ? "actividad medida" : "sin actividad supervisor medida"}`,
		"por origen:",
		...formatCountRecord(report.byOrigin),
		"por trigger:",
		...formatCountRecord(report.byTrigger),
		"skips/throttles:",
		...formatCountRecord(report.byReason),
		`auditorías registradas: ${report.auditRunsRecorded}`,
		`drafts semánticos: ${report.semanticDraftsCreated}`,
		`planes de tareas: ${report.agentTaskPlansBuilt}`,
		`tareas propuestas: ${report.createdTasks}`,
		"tokens supervisor: no medido",
		"% contexto supervisor: no medido",
	].join("\n");
}

export function supervisorActivityInputFromLoopResult(
	result: IduSupervisorLoopResult,
	input: {
		origin: SupervisorActivityOrigin;
		eventType: SupervisorActivityEventType;
		durationMs?: number;
	},
): SupervisorActivityRecordInput {
	return {
		projectId: result.projectId,
		eventType: input.eventType,
		origin: input.origin,
		trigger: result.trigger,
		status: result.status,
		...(result.reason ? { reason: result.reason } : {}),
		active: result.steps.some(
			(step) => step.name === "session_check" && step.status === "active",
		),
		stepCounts: stepCounts(result.steps.map((step) => step.status)),
		createdTasks: result.createdTasks,
		auditRunRecorded: Boolean(result.auditRunId),
		semanticDraftCreated: Boolean(result.semanticDraftPath),
		agentTaskPlanBuilt: Boolean(result.agentTaskPlan),
		...(typeof input.durationMs === "number"
			? { durationMs: input.durationMs }
			: {}),
		ok: result.status !== "warning",
	};
}

function normalizeSupervisorActivityEvent(
	input: SupervisorActivityRecordInput,
): SupervisorActivityEvent {
	return {
		version: 1,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		projectId: sanitizeLabel(input.projectId),
		eventType: input.eventType,
		origin: input.origin,
		trigger: input.trigger,
		status: input.status,
		...(input.reason ? { reason: input.reason } : {}),
		...(typeof input.active === "boolean" ? { active: input.active } : {}),
		...(typeof input.bypassedThrottle === "boolean"
			? { bypassedThrottle: input.bypassedThrottle }
			: {}),
		...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
		...(typeof input.planMode === "boolean"
			? { planMode: input.planMode }
			: {}),
		...(input.stepCounts
			? { stepCounts: normalizeStepCounts(input.stepCounts) }
			: {}),
		...(typeof input.createdTasks === "number" &&
		Number.isFinite(input.createdTasks)
			? { createdTasks: Math.max(0, Math.round(input.createdTasks)) }
			: {}),
		...(typeof input.auditRunRecorded === "boolean"
			? { auditRunRecorded: input.auditRunRecorded }
			: {}),
		...(typeof input.semanticDraftCreated === "boolean"
			? { semanticDraftCreated: input.semanticDraftCreated }
			: {}),
		...(typeof input.agentTaskPlanBuilt === "boolean"
			? { agentTaskPlanBuilt: input.agentTaskPlanBuilt }
			: {}),
		...(typeof input.durationMs === "number" &&
		Number.isFinite(input.durationMs)
			? { durationMs: Math.max(0, Math.round(input.durationMs)) }
			: {}),
		...(typeof input.ok === "boolean" ? { ok: input.ok } : {}),
	};
}

function parseSupervisorActivityEvent(
	value: unknown,
): SupervisorActivityEvent | undefined {
	if (!isRecord(value)) return undefined;
	if (value.version !== 1) return undefined;
	if (typeof value.id !== "string" || !value.id.trim()) return undefined;
	if (typeof value.timestamp !== "string" || !value.timestamp.trim())
		return undefined;
	if (typeof value.projectId !== "string" || !value.projectId.trim())
		return undefined;
	if (!isEventType(value.eventType)) return undefined;
	if (!isOrigin(value.origin)) return undefined;
	if (!isTrigger(value.trigger)) return undefined;
	if (!isStatus(value.status)) return undefined;
	return {
		version: 1,
		id: sanitizeLabel(value.id),
		timestamp: value.timestamp,
		projectId: sanitizeLabel(value.projectId),
		eventType: value.eventType,
		origin: value.origin,
		trigger: value.trigger,
		status: value.status,
		...(isReason(value.reason) ? { reason: value.reason } : {}),
		...(typeof value.active === "boolean" ? { active: value.active } : {}),
		...(typeof value.bypassedThrottle === "boolean"
			? { bypassedThrottle: value.bypassedThrottle }
			: {}),
		...(typeof value.dryRun === "boolean" ? { dryRun: value.dryRun } : {}),
		...(typeof value.planMode === "boolean"
			? { planMode: value.planMode }
			: {}),
		...(isRecord(value.stepCounts)
			? { stepCounts: normalizeStepCounts(value.stepCounts) }
			: {}),
		...(typeof value.createdTasks === "number" &&
		Number.isFinite(value.createdTasks)
			? { createdTasks: Math.max(0, Math.round(value.createdTasks)) }
			: {}),
		...(typeof value.auditRunRecorded === "boolean"
			? { auditRunRecorded: value.auditRunRecorded }
			: {}),
		...(typeof value.semanticDraftCreated === "boolean"
			? { semanticDraftCreated: value.semanticDraftCreated }
			: {}),
		...(typeof value.agentTaskPlanBuilt === "boolean"
			? { agentTaskPlanBuilt: value.agentTaskPlanBuilt }
			: {}),
		...(typeof value.durationMs === "number" &&
		Number.isFinite(value.durationMs)
			? { durationMs: Math.max(0, Math.round(value.durationMs)) }
			: {}),
		...(typeof value.ok === "boolean" ? { ok: value.ok } : {}),
	};
}

function stepCounts(
	statuses: IduSupervisorStepStatus[],
): SupervisorActivityStepCounts {
	const counts = emptyStepCounts();
	for (const status of statuses) counts[status] += 1;
	return counts;
}

function normalizeStepCounts(
	value: Record<string, unknown>,
): SupervisorActivityStepCounts {
	const counts = emptyStepCounts();
	for (const status of STEP_STATUSES) {
		const count = value[status];
		if (typeof count === "number" && Number.isFinite(count)) {
			counts[status] = Math.max(0, Math.round(count));
		}
	}
	return counts;
}

function emptyStepCounts(): SupervisorActivityStepCounts {
	return { active: 0, inactive: 0, completed: 0, skipped: 0, warning: 0 };
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

function sortRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(record).sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
		),
	);
}

function formatCountRecord(record: Record<string, number>): string[] {
	const entries = Object.entries(record);
	return entries.length
		? entries.map(([key, count]) => `- ${key}: ${count}`)
		: ["- sin datos"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventType(value: unknown): value is SupervisorActivityEventType {
	return (
		value === "supervisor_hook" ||
		value === "supervisor_tick" ||
		value === "supervisor_cron_plan"
	);
}

function isOrigin(value: unknown): value is SupervisorActivityOrigin {
	return (
		value === "supervisor_auto_hook" ||
		value === "supervisor_manual_tick" ||
		value === "tui_user_action" ||
		value === "pi_runtime_event" ||
		value === "orchestrator_requested"
	);
}

function isTrigger(value: unknown): value is IduSupervisorTrigger {
	return (
		value === "manual" ||
		value === "on_idu_activation" ||
		value === "after_task_registered" ||
		value === "after_postflight" ||
		value === "after_semantic_threshold" ||
		value === "cron_planning"
	);
}

function isStatus(value: unknown): value is SupervisorActivityStatus {
	return (
		value === "completed" ||
		value === "skipped" ||
		value === "warning" ||
		value === "planned"
	);
}

function isReason(value: unknown): value is SupervisorActivityReason {
	return (
		value === "idu_inactive" ||
		value === "no_new_events" ||
		value === "throttled" ||
		value === "supervisor_failed" ||
		value === "not_enough_data"
	);
}
