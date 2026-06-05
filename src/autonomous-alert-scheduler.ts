import {
	appendAutonomousAlertDecision,
	readAutonomousAlertEngineState,
} from "./autonomous-alert-engine-state.js";
import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertDecision,
	type AutonomousAlertEngineReport,
} from "./autonomous-alert-engine.js";
import {
	getCachedMasterPlanObjectiveSnapshot,
	type MasterPlanObjectiveSnapshot,
} from "./master-plan-objective-cache.js";
import {
	acquireAutonomousAlertSchedulerLock,
	finishAutonomousAlertSchedulerRun,
	markAutonomousAlertDecisionTaskCreated,
	readAutonomousAlertSchedulerState,
} from "./autonomous-alert-scheduler-state.js";
import type { StructuredTask } from "./structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

export type AutonomousAlertScheduledTickStatus =
	| "ran"
	| "skipped_inactive"
	| "skipped_paused"
	| "skipped_locked"
	| "blocked_objective";

export type AutonomousAlertScheduledTickInput = {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	iduActive: boolean;
	allowTaskCreation?: boolean;
	now?: Date;
	ownerId?: string;
	leaseMs?: number;
	loadPlan: () => Record<string, unknown>;
	loadTasks: () => readonly StructuredTask[];
	loadSelfMaintenanceSignals: () => readonly SupervisorSelfMaintenanceSignal[];
	createTask: (draft: {
		text: string;
		category: string;
		priority: number;
		evidenceRefs: string[];
	}) => { id: string };
};

export type AutonomousAlertScheduledTickResult = {
	version: 1;
	status: AutonomousAlertScheduledTickStatus;
	projectId: string;
	generatedAt: string;
	allowTaskCreation: boolean;
	tasksCreated: AutonomousAlertEngineReport["tasksCreated"];
	objective: MasterPlanObjectiveSnapshot;
	report?: AutonomousAlertEngineReport;
	safeNotes: string[];
};

export function runAutonomousAlertScheduledTick(
	input: AutonomousAlertScheduledTickInput,
): AutonomousAlertScheduledTickResult {
	const now = input.now ?? new Date();
	const generatedAt = now.toISOString();
	const allowTaskCreation = input.allowTaskCreation === true;
	const ownerId = input.ownerId ?? `autonomous-alert-scheduler:${process.pid}`;

	if (!input.iduActive) {
		return baseResult({
			input,
			generatedAt,
			allowTaskCreation: false,
			status: "skipped_inactive",
			objective: inactiveObjective(input, now),
		});
	}

	const engineState = readAutonomousAlertEngineState(input.stateRoot, now);
	const paused = isPaused(engineState.control, now);
	if (!engineState.control.active || paused) {
		const report = buildAutonomousAlertEngineReport({
			projectId: input.projectId,
			now,
			control: engineState.control,
			tasks: [],
			selfMaintenanceSignals: [],
			allowTaskCreation: false,
			cooldowns: engineState.cooldowns,
		});
		return baseResult({
			input,
			generatedAt,
			allowTaskCreation: false,
			status: "skipped_paused",
			objective: inactiveObjective(input, now),
			report,
		});
	}

	const lock = acquireAutonomousAlertSchedulerLock(input.stateRoot, {
		ownerId,
		now,
		leaseMs: input.leaseMs,
	});
	if (!lock.acquired) {
		return baseResult({
			input,
			generatedAt,
			allowTaskCreation: false,
			status: "skipped_locked",
			objective: inactiveObjective(input, now),
		});
	}

	const objective = getCachedMasterPlanObjectiveSnapshot({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		projectPath: input.projectPath,
		loadPlan: input.loadPlan,
		now,
	});
	if (objective.blocked) {
		finishAutonomousAlertSchedulerRun(input.stateRoot, {
			ownerId,
			status: "blocked_objective",
			now,
		});
		return baseResult({
			input,
			generatedAt,
			allowTaskCreation: false,
			status: "blocked_objective",
			objective,
		});
	}

	const report = buildAutonomousAlertEngineReport({
		projectId: input.projectId,
		now,
		control: engineState.control,
		tasks: input.loadTasks(),
		selfMaintenanceSignals: input.loadSelfMaintenanceSignals(),
		allowTaskCreation,
		cooldowns: engineState.cooldowns,
	});
	const tasksCreated = createScheduledTasks(
		input,
		report,
		now,
		allowTaskCreation,
	);
	const finalReport = { ...report, tasksCreated };
	finishAutonomousAlertSchedulerRun(input.stateRoot, {
		ownerId,
		status: "ran",
		now,
	});
	return baseResult({
		input,
		generatedAt,
		allowTaskCreation,
		status: "ran",
		objective,
		report: finalReport,
		tasksCreated,
	});
}

function createScheduledTasks(
	input: AutonomousAlertScheduledTickInput,
	report: AutonomousAlertEngineReport,
	now: Date,
	allowTaskCreation: boolean,
): AutonomousAlertEngineReport["tasksCreated"] {
	if (!allowTaskCreation) return [];
	const taskCreationBlockedByHumanEscalation = report.humanEscalations.some(
		(decision) => ["repeated_bug", "security", "db"].includes(decision.domain),
	);
	if (taskCreationBlockedByHumanEscalation) return [];
	const tasksCreated: AutonomousAlertEngineReport["tasksCreated"] = [];
	for (const decision of report.decisions) {
		if (tasksCreated.length >= 3) break;
		if (!canCreateTask(decision)) continue;
		const schedulerState = readAutonomousAlertSchedulerState(
			input.stateRoot,
			now,
		);
		if (schedulerState.createdTaskIds[decision.id]) continue;
		const task = input.createTask({
			text: decision.taskDraft.text,
			category: decision.taskDraft.category,
			priority: decision.taskDraft.priority,
			evidenceRefs: decision.taskDraft.evidenceRefs,
		});
		tasksCreated.push({
			taskId: task.id,
			alertId: decision.id,
			evidenceRefs: decision.evidenceRefs,
		});
		markAutonomousAlertDecisionTaskCreated(
			input.stateRoot,
			decision.id,
			task.id,
			now,
		);
		appendAutonomousAlertDecision(input.stateRoot, decision, now);
	}
	return tasksCreated;
}

function canCreateTask(
	decision: AutonomousAlertDecision,
): decision is AutonomousAlertDecision & {
	taskDraft: NonNullable<AutonomousAlertDecision["taskDraft"]>;
} {
	return (
		decision.recommendedAction === "create_task" && Boolean(decision.taskDraft)
	);
}

function baseResult(input: {
	input: AutonomousAlertScheduledTickInput;
	generatedAt: string;
	allowTaskCreation: boolean;
	status: AutonomousAlertScheduledTickStatus;
	objective: MasterPlanObjectiveSnapshot;
	report?: AutonomousAlertEngineReport;
	tasksCreated?: AutonomousAlertEngineReport["tasksCreated"];
}): AutonomousAlertScheduledTickResult {
	const tasksCreated = input.tasksCreated ?? [];
	return {
		version: 1,
		status: input.status,
		projectId: input.input.projectId,
		generatedAt: input.generatedAt,
		allowTaskCreation: input.allowTaskCreation,
		tasksCreated,
		objective: input.objective,
		...(input.report ? { report: input.report } : {}),
		safeNotes: [
			"Scheduled autonomous alerts are supervisor/auditor routing only; no implementation was performed.",
			"AgentLabs, dependencies, rules, skills, and contracts were not modified.",
			"Remote chat controls are not required for this scheduled executor.",
		],
	};
}

function inactiveObjective(
	input: AutonomousAlertScheduledTickInput,
	now: Date,
): MasterPlanObjectiveSnapshot {
	return {
		version: 1,
		projectId: input.projectId,
		projectPath: input.projectPath,
		planStatus: "not_consulted",
		planApproved: false,
		blocked: true,
		blockReason: "scheduler skipped before objective consultation",
		objective:
			"Objective not consulted because the scheduled tick was safely skipped.",
		summary: "Skipped before autonomous decisions.",
		risks: [],
		generatedAt: now.toISOString(),
		expiresAt: now.toISOString(),
		advisoryOnly: true,
	};
}

function isPaused(control: { pausedUntil?: string }, now: Date): boolean {
	return Boolean(
		control.pausedUntil && Date.parse(control.pausedUntil) > now.getTime(),
	);
}
