import type { StructuredTask } from "./structured-task-queue.js";

export type SupervisorSelfMaintenanceSignalCategory =
	| "backlog_pressure"
	| "stale_tasks"
	| "repeated_failure_patterns"
	| "neglected_areas"
	| "learning_loop_pressure"
	| "semantic_audit_pressure"
	| "supervisor_activity_pressure";

export type SupervisorSelfMaintenanceSeverity = "info" | "warning" | "high";

export type SupervisorSelfMaintenanceSignal = {
	id: string;
	category: SupervisorSelfMaintenanceSignalCategory;
	severity: SupervisorSelfMaintenanceSeverity;
	confidence: number;
	evidenceRefs: string[];
	summary: string;
	recommendedActions: string[];
	bibliotecarioInputs?: string[];
	skillLearningInputs?: string[];
};

export type SupervisorSelfMaintenanceTotals = {
	pendingTasks: number;
	runningTasks: number;
	failedTasks: number;
	staleTasks: number;
	guardedTasks: number;
	supervisorEvents: number;
	usageFailures: number;
	agentLabStaleRequests: number;
	semanticNewEvents: number;
};

export type SupervisorSelfMaintenanceAdvisory = {
	version: 1;
	authority: "advisory";
	mode: "advisory_only";
	projectId: string;
	generatedAt: string;
	noWrites: true;
	agentLabsExecuted: false;
	rulesApplied: false;
	skillsModified: false;
	totals: SupervisorSelfMaintenanceTotals;
	signals: SupervisorSelfMaintenanceSignal[];
	recommendedActions: string[];
	safeNotes: string[];
};

export type BuildSupervisorSelfMaintenanceAdvisoryInput = {
	projectId: string;
	now?: Date;
	tasks: readonly StructuredTask[];
	supervisorEvents?: number;
	usageFailures?: number;
	agentLabStaleRequests?: number;
	semanticNewEvents?: number;
	supervisorActivitySkipped?: number;
	supervisorActivityThrottled?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REPEATED_PATTERN_KEYWORDS = [
	"postflight",
	"context",
	"telegram",
	"bibliotecario",
	"agentlab",
	"skill",
	"source",
] as const;

const NEGLECTED_AREA_KEYWORDS = [
	"telegram",
	"bibliotecario",
	"context",
	"source",
	"agentlab",
	"skill",
] as const;

export function buildSupervisorSelfMaintenanceAdvisory(
	input: BuildSupervisorSelfMaintenanceAdvisoryInput,
): SupervisorSelfMaintenanceAdvisory {
	const now = input.now ?? new Date();
	const tasks = input.tasks.filter(
		(task) => !task.projectId || task.projectId === input.projectId,
	);
	const pendingTasks = tasks.filter((task) => task.status === "pending");
	const runningTasks = tasks.filter((task) => task.status === "running");
	const failedTasks = tasks.filter((task) => task.status === "failed");
	const openTasks = pendingTasks.length + runningTasks.length;
	const stalePendingTasks = pendingTasks.filter(
		(task) => ageMs(now, task.createdAt) > 3 * DAY_MS,
	);
	const staleRunningTasks = runningTasks.filter(
		(task) => ageMs(now, task.updatedAt) > 2 * HOUR_MS,
	);
	const totals: SupervisorSelfMaintenanceTotals = {
		pendingTasks: pendingTasks.length,
		runningTasks: runningTasks.length,
		failedTasks: failedTasks.length,
		staleTasks: stalePendingTasks.length + staleRunningTasks.length,
		guardedTasks: tasks.filter(isGuardedTask).length,
		supervisorEvents: boundedCount(input.supervisorEvents),
		usageFailures: boundedCount(input.usageFailures),
		agentLabStaleRequests: boundedCount(input.agentLabStaleRequests),
		semanticNewEvents: boundedCount(input.semanticNewEvents),
	};
	const supervisorActivitySkipped = boundedCount(
		input.supervisorActivitySkipped,
	);
	const supervisorActivityThrottled = boundedCount(
		input.supervisorActivityThrottled,
	);

	const signals: SupervisorSelfMaintenanceSignal[] = [];
	const backlogSignal = buildBacklogSignal(
		openTasks,
		runningTasks.length,
		totals.guardedTasks,
	);
	if (backlogSignal) signals.push(backlogSignal);

	const staleSignal = buildStaleSignal(stalePendingTasks, staleRunningTasks);
	if (staleSignal) signals.push(staleSignal);

	const repeatedSignal = buildRepeatedFailureSignal(
		tasks,
		totals.usageFailures,
		totals.agentLabStaleRequests,
	);
	if (repeatedSignal) signals.push(repeatedSignal);

	const neglectedAreaSignal = buildNeglectedAreaSignal(tasks);
	if (neglectedAreaSignal) signals.push(neglectedAreaSignal);

	const learningSignal = buildLearningLoopSignal(tasks, failedTasks.length);
	if (learningSignal) signals.push(learningSignal);

	const semanticSignal = buildSemanticAuditPressureSignal(
		totals.semanticNewEvents,
	);
	if (semanticSignal) signals.push(semanticSignal);

	const supervisorActivitySignal = buildSupervisorActivityPressureSignal({
		supervisorEvents: totals.supervisorEvents,
		openTasks,
		staleTasks: totals.staleTasks,
		usageFailures: totals.usageFailures,
		agentLabStaleRequests: totals.agentLabStaleRequests,
		semanticNewEvents: totals.semanticNewEvents,
		supervisorActivitySkipped,
		supervisorActivityThrottled,
	});
	if (supervisorActivitySignal) signals.push(supervisorActivitySignal);

	return {
		version: 1,
		authority: "advisory",
		mode: "advisory_only",
		projectId: input.projectId,
		generatedAt: now.toISOString(),
		noWrites: true,
		agentLabsExecuted: false,
		rulesApplied: false,
		skillsModified: false,
		totals,
		signals,
		recommendedActions: recommendedActionsFor(signals),
		safeNotes: [
			"Advisory-only report: no files, tasks, rules, skills, or contracts were written.",
			"AgentLabs was not executed by this builder.",
		],
	};
}

function buildBacklogSignal(
	openTasks: number,
	runningTasks: number,
	guardedTasks: number,
): SupervisorSelfMaintenanceSignal | undefined {
	if (openTasks < 10 && runningTasks < 5) return undefined;
	const severity: SupervisorSelfMaintenanceSeverity =
		openTasks >= 20 || runningTasks >= 5 ? "high" : "warning";
	return {
		id: "backlog-pressure",
		category: "backlog_pressure",
		severity,
		confidence: 0.9,
		evidenceRefs: [
			`structured-task-queue:open=${openTasks}`,
			`structured-task-queue:running=${runningTasks}`,
			...(guardedTasks > 0
				? [`structured-task-queue:guarded=${guardedTasks}`]
				: []),
		],
		summary: "Structured task queue has backlog pressure",
		recommendedActions: [
			"Triage open work before adding new supervisor initiatives.",
			"Finish, pause, or re-scope running tasks to reduce concurrency pressure.",
		],
	};
}

function buildStaleSignal(
	stalePendingTasks: readonly StructuredTask[],
	staleRunningTasks: readonly StructuredTask[],
): SupervisorSelfMaintenanceSignal | undefined {
	if (stalePendingTasks.length === 0 && staleRunningTasks.length === 0) {
		return undefined;
	}
	return {
		id: "stale-tasks",
		category: "stale_tasks",
		severity: staleRunningTasks.length > 0 ? "high" : "warning",
		confidence: 0.9,
		evidenceRefs: [
			`structured-task-queue:stale-pending=${stalePendingTasks.length}`,
			`structured-task-queue:stale-running=${staleRunningTasks.length}`,
			...sampleTaskIds([...stalePendingTasks, ...staleRunningTasks]),
		],
		summary: "Structured tasks are stale",
		recommendedActions: [
			"Review stale pending tasks and close, re-prioritize, or refresh them with current evidence.",
			"Inspect stale running tasks for blocked workers before launching more work.",
		],
	};
}

function buildRepeatedFailureSignal(
	tasks: readonly StructuredTask[],
	usageFailures: number,
	agentLabStaleRequests: number,
): SupervisorSelfMaintenanceSignal | undefined {
	const grouped = new Map<string, StructuredTask[]>();
	for (const task of tasks) {
		const text = searchableText(task);
		if (!isFailureLike(task, text)) continue;
		for (const keyword of REPEATED_PATTERN_KEYWORDS) {
			if (text.includes(keyword)) {
				const group = grouped.get(keyword) ?? [];
				group.push(task);
				grouped.set(keyword, group);
			}
		}
	}
	const repeated = [...grouped.entries()].filter(
		([, group]) => group.length >= 2,
	);
	const externalPatterns = [
		usageFailures >= 2
			? {
					label: `idu-usage-events:failures=${usageFailures}`,
					learningInput: `usage_failures: ${usageFailures} failure(s)`,
				}
			: undefined,
		agentLabStaleRequests >= 2
			? {
					label: `agentlab-review-requests:stale=${agentLabStaleRequests}`,
					learningInput: `agentlab_stale_requests: ${agentLabStaleRequests} stale request(s)`,
				}
			: undefined,
	].filter((pattern): pattern is { label: string; learningInput: string } =>
		Boolean(pattern),
	);
	if (repeated.length === 0 && externalPatterns.length === 0) return undefined;
	const labels = repeated.map(
		([keyword, group]) => `structured-task-queue:${keyword}=${group.length}`,
	);
	const highSeverity =
		repeated.some(([, group]) => group.length >= 3) ||
		usageFailures >= 5 ||
		agentLabStaleRequests >= 5;
	return {
		id: "repeated-failure-patterns",
		category: "repeated_failure_patterns",
		severity: highSeverity ? "high" : "warning",
		confidence: highSeverity ? 0.85 : 0.75,
		evidenceRefs: [
			...labels,
			...externalPatterns.map((pattern) => pattern.label),
		],
		summary: "Repeated failure patterns need supervisor learning review",
		recommendedActions: [
			"Add or strengthen a regression test around the repeated failure before changing automation.",
			"Review whether the repeated pattern needs a small skill, rule, or checklist update after evidence is confirmed.",
		],
		skillLearningInputs: [
			...repeated.map(
				([keyword, group]) =>
					`${keyword}: ${sampleTaskIds(group).join(", ") || `${group.length} task(s)`}`,
			),
			...externalPatterns.map((pattern) => pattern.learningInput),
		],
	};
}

function buildNeglectedAreaSignal(
	tasks: readonly StructuredTask[],
): SupervisorSelfMaintenanceSignal | undefined {
	const areas = new Map<
		string,
		{ total: number; done: number; taskIds: string[] }
	>();
	for (const task of tasks) {
		const text = searchableText(task);
		for (const keyword of NEGLECTED_AREA_KEYWORDS) {
			if (!text.includes(keyword)) continue;
			const area = areas.get(keyword) ?? { total: 0, done: 0, taskIds: [] };
			area.total += 1;
			if (task.status === "done") area.done += 1;
			if (area.taskIds.length < 5) area.taskIds.push(task.id);
			areas.set(keyword, area);
		}
	}
	const neglected = [...areas.entries()].filter(
		([, area]) => area.total >= 3 && area.done < area.total,
	);
	if (!neglected.length) return undefined;
	const highSeverity = neglected.some(([, area]) => area.total >= 5);
	return {
		id: "neglected-areas",
		category: "neglected_areas",
		severity: highSeverity ? "high" : "warning",
		confidence: highSeverity ? 0.75 : 0.65,
		evidenceRefs: neglected.map(
			([keyword, area]) =>
				`structured-task-queue:${keyword}=total:${area.total},done:${area.done}`,
		),
		summary: "Repeatedly mentioned project areas have unfinished follow-up",
		recommendedActions: [
			"Open an orchestrator review to decide whether the neglected area still matters to the Master Plan.",
			"Create one bounded task or explicitly close/defer the neglected area with evidence.",
		],
		bibliotecarioInputs: neglected.map(
			([keyword, area]) =>
				`${keyword}: ${area.total - area.done} unfinished mention(s); sample tasks ${area.taskIds.join(", ")}`,
		),
	};
}

function buildSemanticAuditPressureSignal(
	semanticNewEvents: number,
): SupervisorSelfMaintenanceSignal | undefined {
	if (semanticNewEvents < 100) return undefined;
	return {
		id: "semantic-audit-pressure",
		category: "semantic_audit_pressure",
		severity: semanticNewEvents >= 250 ? "high" : "warning",
		confidence: semanticNewEvents >= 250 ? 0.9 : 0.8,
		evidenceRefs: [`semantic-events:new=${semanticNewEvents}`],
		summary: "Semantic event backlog is ready for bounded audit triage",
		recommendedActions: [
			"Run a bounded semantic audit pass before promoting new supervisor rules or skills.",
			"Sample high-signal semantic events and convert confirmed patterns into review evidence.",
		],
		bibliotecarioInputs: [
			`semantic_new_events: ${semanticNewEvents} event(s) awaiting audit`,
		],
	};
}

function buildSupervisorActivityPressureSignal(input: {
	supervisorEvents: number;
	openTasks: number;
	staleTasks: number;
	usageFailures: number;
	agentLabStaleRequests: number;
	semanticNewEvents: number;
	supervisorActivitySkipped: number;
	supervisorActivityThrottled: number;
}): SupervisorSelfMaintenanceSignal | undefined {
	const pressureScore =
		input.openTasks +
		input.staleTasks +
		input.usageFailures +
		input.agentLabStaleRequests +
		Math.floor(input.semanticNewEvents / 25);
	const skippedOrThrottled =
		input.supervisorActivitySkipped + input.supervisorActivityThrottled;
	if (input.supervisorEvents > 0 && skippedOrThrottled < 3) {
		return undefined;
	}
	if (pressureScore === 0 && skippedOrThrottled < 3) return undefined;
	const highSeverity =
		pressureScore >= 20 ||
		skippedOrThrottled >= 5 ||
		input.supervisorEvents === 0;
	return {
		id: "supervisor-activity-pressure",
		category: "supervisor_activity_pressure",
		severity: highSeverity ? "high" : "warning",
		confidence: highSeverity ? 0.85 : 0.7,
		evidenceRefs: [
			`supervisor-activity:events=${input.supervisorEvents}`,
			`structured-task-queue:open=${input.openTasks}`,
			`structured-task-queue:stale=${input.staleTasks}`,
			`idu-usage-events:failures=${input.usageFailures}`,
			`agentlab-review-requests:stale=${input.agentLabStaleRequests}`,
			`semantic-events:new=${input.semanticNewEvents}`,
			`supervisor-activity:skipped=${input.supervisorActivitySkipped}`,
			`supervisor-activity:throttled=${input.supervisorActivityThrottled}`,
		],
		summary:
			"Supervisor activity is absent or throttled while maintenance pressure exists",
		recommendedActions: [
			"Review why supervisor activity is absent, skipped, or throttled before increasing automation scope.",
			"Resolve stale/backlog signals or record bounded supervisor activity evidence for the next advisory run.",
		],
	};
}

function buildLearningLoopSignal(
	tasks: readonly StructuredTask[],
	failedTaskCount: number,
): SupervisorSelfMaintenanceSignal | undefined {
	const learningMentions = tasks.filter((task) => {
		const text = searchableText(task);
		return /needs_evidence|repeated|regression|lesson|learning/u.test(text);
	});
	if (failedTaskCount < 3 && learningMentions.length < 3) return undefined;
	return {
		id: "learning-loop-pressure",
		category: "learning_loop_pressure",
		severity: failedTaskCount >= 3 ? "high" : "warning",
		confidence: failedTaskCount >= 3 ? 0.85 : 0.7,
		evidenceRefs: [
			`structured-task-queue:failed=${failedTaskCount}`,
			`structured-task-queue:learning-mentions=${learningMentions.length}`,
		],
		summary: "Learning loop has unresolved evidence pressure",
		recommendedActions: [
			"Convert repeated lessons into explicit tests or review checklist evidence before modifying skills.",
		],
		skillLearningInputs: sampleTaskIds(learningMentions),
	};
}

function recommendedActionsFor(
	signals: readonly SupervisorSelfMaintenanceSignal[],
): string[] {
	return [...new Set(signals.flatMap((signal) => signal.recommendedActions))];
}

function isFailureLike(task: StructuredTask, text: string): boolean {
	return (
		task.category.toLowerCase() === "bug" ||
		task.status === "failed" ||
		/fail|bug|error|unexpected|needs_evidence|regression|repeated/u.test(text)
	);
}

function searchableText(task: StructuredTask): string {
	return [
		task.text,
		task.originalText,
		task.failureReason,
		task.completionEvidence,
	]
		.filter((value): value is string => Boolean(value))
		.join(" ")
		.toLowerCase();
}

function isGuardedTask(task: StructuredTask): boolean {
	return task.guardStatus !== undefined && task.guardStatus !== "clear";
}

function boundedCount(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(Math.min(value, Number.MAX_SAFE_INTEGER));
}

function ageMs(now: Date, timestamp: string): number {
	const parsed = Date.parse(timestamp);
	if (Number.isNaN(parsed)) return 0;
	return now.getTime() - parsed;
}

function sampleTaskIds(tasks: readonly StructuredTask[]): string[] {
	return tasks.slice(0, 5).map((task) => task.id);
}
