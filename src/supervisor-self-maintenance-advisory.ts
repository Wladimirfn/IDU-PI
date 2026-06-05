import type { StructuredTask } from "./structured-task-queue.js";

export type SupervisorSelfMaintenanceSignalCategory =
	| "backlog_pressure"
	| "stale_tasks"
	| "repeated_failure_patterns"
	| "neglected_areas"
	| "learning_loop_pressure";

export type SupervisorSelfMaintenanceSeverity = "info" | "warning" | "high";

export type SupervisorSelfMaintenanceSignal = {
	id: string;
	category: SupervisorSelfMaintenanceSignalCategory;
	severity: SupervisorSelfMaintenanceSeverity;
	confidence: number;
	evidenceRefs: string[];
	summary: string;
	recommendedActions: string[];
	skillLearningInputs?: string[];
};

export type SupervisorSelfMaintenanceTotals = {
	totalTasks: number;
	openTasks: number;
	pendingTasks: number;
	runningTasks: number;
	doneTasks: number;
	failedTasks: number;
	stalePendingTasks: number;
	staleRunningTasks: number;
	staleTasks: number;
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

export function buildSupervisorSelfMaintenanceAdvisory(
	input: BuildSupervisorSelfMaintenanceAdvisoryInput,
): SupervisorSelfMaintenanceAdvisory {
	const now = input.now ?? new Date();
	const tasks = input.tasks.filter(
		(task) => !task.projectId || task.projectId === input.projectId,
	);
	const pendingTasks = tasks.filter((task) => task.status === "pending");
	const runningTasks = tasks.filter((task) => task.status === "running");
	const doneTasks = tasks.filter((task) => task.status === "done");
	const failedTasks = tasks.filter((task) => task.status === "failed");
	const openTasks = pendingTasks.length + runningTasks.length;
	const stalePendingTasks = pendingTasks.filter(
		(task) => ageMs(now, task.createdAt) > 3 * DAY_MS,
	);
	const staleRunningTasks = runningTasks.filter(
		(task) => ageMs(now, task.updatedAt) > 2 * HOUR_MS,
	);

	const signals: SupervisorSelfMaintenanceSignal[] = [];
	const backlogSignal = buildBacklogSignal(openTasks, runningTasks.length);
	if (backlogSignal) signals.push(backlogSignal);

	const staleSignal = buildStaleSignal(stalePendingTasks, staleRunningTasks);
	if (staleSignal) signals.push(staleSignal);

	const repeatedSignal = buildRepeatedFailureSignal(tasks);
	if (repeatedSignal) signals.push(repeatedSignal);

	const learningSignal = buildLearningLoopSignal(tasks, failedTasks.length);
	if (learningSignal) signals.push(learningSignal);

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
		totals: {
			totalTasks: tasks.length,
			openTasks,
			pendingTasks: pendingTasks.length,
			runningTasks: runningTasks.length,
			doneTasks: doneTasks.length,
			failedTasks: failedTasks.length,
			stalePendingTasks: stalePendingTasks.length,
			staleRunningTasks: staleRunningTasks.length,
			staleTasks: stalePendingTasks.length + staleRunningTasks.length,
		},
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
	if (repeated.length === 0) return undefined;
	const labels = repeated.map(
		([keyword, group]) => `structured-task-queue:${keyword}=${group.length}`,
	);
	return {
		id: "repeated-failure-patterns",
		category: "repeated_failure_patterns",
		severity: repeated.some(([, group]) => group.length >= 3)
			? "high"
			: "warning",
		confidence: repeated.some(([, group]) => group.length >= 3) ? 0.85 : 0.75,
		evidenceRefs: labels,
		summary: "Repeated failure patterns need supervisor learning review",
		recommendedActions: [
			"Add or strengthen a regression test around the repeated failure before changing automation.",
			"Review whether the repeated pattern needs a small skill, rule, or checklist update after evidence is confirmed.",
		],
		skillLearningInputs: repeated.map(
			([keyword, group]) =>
				`${keyword}: ${sampleTaskIds(group).join(", ") || `${group.length} task(s)`}`,
		),
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

function ageMs(now: Date, timestamp: string): number {
	const parsed = Date.parse(timestamp);
	if (Number.isNaN(parsed)) return 0;
	return now.getTime() - parsed;
}

function sampleTaskIds(tasks: readonly StructuredTask[]): string[] {
	return tasks.slice(0, 5).map((task) => task.id);
}
