import {
	runAutonomousAlertScheduledTick,
	type AutonomousAlertScheduledTickInput,
	type AutonomousAlertScheduledTickResult,
} from "./autonomous-alert-scheduler.js";
import type { ExternalIntelligenceReport } from "./external-intelligence.js";
import type { IduSupervisorCronPlanResult } from "./idu-supervisor-cron.js";
import type { SkillDraftFromLessonsResult } from "./skill-draft-from-lessons.js";
import type { StructuredTask } from "./structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

type UnknownJson =
	| Record<string, unknown>
	| unknown[]
	| string
	| number
	| boolean
	| null;

export type Automaticov1CycleStatus =
	| "ran"
	| "skipped_inactive"
	| "skipped_paused"
	| "skipped_locked"
	| "blocked_objective";

export type Automaticov1CycleInput = {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	iduActive: boolean;
	allowTaskCreation?: boolean;
	allowExternalFetch?: boolean;
	allowSkillDraftProposal?: boolean;
	now?: Date;
	ownerId?: string;
	leaseMs?: number;
	loadPlan: () => Record<string, unknown>;
	loadTasks: () => readonly StructuredTask[];
	loadSelfMaintenanceSignals: () => readonly SupervisorSelfMaintenanceSignal[];
	createTask: AutonomousAlertScheduledTickInput["createTask"];
	buildSupervisorCronPlan?: () => IduSupervisorCronPlanResult | UnknownJson;
	buildBibliotecarioSnapshot?: () => UnknownJson;
	buildExternalIntelligenceReport?: () => Promise<
		ExternalIntelligenceReport | UnknownJson
	>;
	createSkillDraftFromLessons?: () => SkillDraftFromLessonsResult | UnknownJson;
};

export type Automaticov1CycleResult = {
	version: 1;
	authority: "advisory";
	mode: "automaticov1_cycle";
	projectId: string;
	generatedAt: string;
	status: Automaticov1CycleStatus;
	allowedToProceed: false;
	repoWritesAllowed: false;
	stateRootWritesPossible: true;
	advisoryOnly: true;
	allowTaskCreation: boolean;
	allowExternalFetch: boolean;
	allowSkillDraftProposal: boolean;
	externalFetchExecuted: boolean;
	skillProposalExecuted: boolean;
	alertScheduledTick: AutonomousAlertScheduledTickResult;
	supervisorCronPlan?: IduSupervisorCronPlanResult | UnknownJson;
	bibliotecarioSnapshot?: UnknownJson;
	externalIntelligenceReport?: ExternalIntelligenceReport | UnknownJson;
	skillDraftFromLessons?: SkillDraftFromLessonsResult | UnknownJson;
	evidenceRefs: string[];
	nextActions: string[];
	safeNotes: string[];
};

export async function runAutomaticov1AdvisoryCycle(
	input: Automaticov1CycleInput,
): Promise<Automaticov1CycleResult> {
	const now = input.now ?? new Date();
	const allowTaskCreation = input.allowTaskCreation === true;
	const allowExternalFetch = input.allowExternalFetch === true;
	const allowSkillDraftProposal = input.allowSkillDraftProposal === true;

	const alertScheduledTick = runAutonomousAlertScheduledTick({
		projectId: input.projectId,
		projectPath: input.projectPath,
		stateRoot: input.stateRoot,
		iduActive: input.iduActive,
		allowTaskCreation,
		now,
		ownerId: input.ownerId,
		leaseMs: input.leaseMs,
		loadPlan: input.loadPlan,
		loadTasks: input.loadTasks,
		loadSelfMaintenanceSignals: input.loadSelfMaintenanceSignals,
		createTask: input.createTask,
	});

	if (!input.iduActive) {
		return baseResult({
			input,
			now,
			allowTaskCreation: false,
			allowExternalFetch: false,
			allowSkillDraftProposal: false,
			alertScheduledTick,
			status: "skipped_inactive",
		});
	}

	const supervisorCronPlan = input.buildSupervisorCronPlan?.();
	const bibliotecarioSnapshot = input.buildBibliotecarioSnapshot?.();
	const externalIntelligenceReport = allowExternalFetch
		? await input.buildExternalIntelligenceReport?.()
		: undefined;
	const skillDraftFromLessons = allowSkillDraftProposal
		? input.createSkillDraftFromLessons?.()
		: undefined;

	return baseResult({
		input,
		now,
		allowTaskCreation,
		allowExternalFetch,
		allowSkillDraftProposal,
		alertScheduledTick,
		status: alertScheduledTick.status,
		supervisorCronPlan,
		bibliotecarioSnapshot,
		externalIntelligenceReport,
		skillDraftFromLessons,
	});
}

function baseResult(input: {
	input: Automaticov1CycleInput;
	now: Date;
	allowTaskCreation: boolean;
	allowExternalFetch: boolean;
	allowSkillDraftProposal: boolean;
	alertScheduledTick: AutonomousAlertScheduledTickResult;
	status: Automaticov1CycleStatus;
	supervisorCronPlan?: IduSupervisorCronPlanResult | UnknownJson;
	bibliotecarioSnapshot?: UnknownJson;
	externalIntelligenceReport?: ExternalIntelligenceReport | UnknownJson;
	skillDraftFromLessons?: SkillDraftFromLessonsResult | UnknownJson;
}): Automaticov1CycleResult {
	const externalFetchExecuted = Boolean(input.externalIntelligenceReport);
	const skillProposalExecuted = Boolean(input.skillDraftFromLessons);
	return {
		version: 1,
		authority: "advisory",
		mode: "automaticov1_cycle",
		projectId: input.input.projectId,
		generatedAt: input.now.toISOString(),
		status: input.status,
		allowedToProceed: false,
		repoWritesAllowed: false,
		stateRootWritesPossible: true,
		advisoryOnly: true,
		allowTaskCreation: input.allowTaskCreation,
		allowExternalFetch: input.allowExternalFetch,
		allowSkillDraftProposal: input.allowSkillDraftProposal,
		externalFetchExecuted,
		skillProposalExecuted,
		alertScheduledTick: input.alertScheduledTick,
		...(input.supervisorCronPlan
			? { supervisorCronPlan: input.supervisorCronPlan }
			: {}),
		...(input.bibliotecarioSnapshot
			? { bibliotecarioSnapshot: input.bibliotecarioSnapshot }
			: {}),
		...(input.externalIntelligenceReport
			? { externalIntelligenceReport: input.externalIntelligenceReport }
			: {}),
		...(input.skillDraftFromLessons
			? { skillDraftFromLessons: input.skillDraftFromLessons }
			: {}),
		evidenceRefs: evidenceRefs(input),
		nextActions: nextActions(input),
		safeNotes: safeNotes(input),
	};
}

function evidenceRefs(input: {
	alertScheduledTick: AutonomousAlertScheduledTickResult;
	supervisorCronPlan?: IduSupervisorCronPlanResult | UnknownJson;
	bibliotecarioSnapshot?: UnknownJson;
	externalIntelligenceReport?: ExternalIntelligenceReport | UnknownJson;
	skillDraftFromLessons?: SkillDraftFromLessonsResult | UnknownJson;
}): string[] {
	return [
		`automaticov1:alert:${input.alertScheduledTick.status}`,
		...(input.supervisorCronPlan ? ["automaticov1:supervisor-cron-plan"] : []),
		...(input.bibliotecarioSnapshot
			? ["automaticov1:bibliotecario-snapshot"]
			: []),
		...(input.externalIntelligenceReport
			? ["automaticov1:external-intelligence"]
			: []),
		...(input.skillDraftFromLessons ? ["automaticov1:skill-lessons"] : []),
	];
}

function nextActions(input: {
	allowExternalFetch: boolean;
	allowSkillDraftProposal: boolean;
	alertScheduledTick: AutonomousAlertScheduledTickResult;
}): string[] {
	const actions = [
		"Review the combined automaticov1 cycle report before implementing changes.",
		"Keep Bibliotecario outputs as evidence pointers until canonical sources are verified.",
	];
	if (!input.allowExternalFetch) {
		actions.push(
			"External/news intelligence fetch is disabled by default; enable only exact allowlisted sources when needed.",
		);
	}
	if (!input.allowSkillDraftProposal) {
		actions.push(
			"Skill proposal generation is disabled by default; enable only when lessons/evidence are ready for review.",
		);
	}
	if (input.alertScheduledTick.tasksCreated.length > 0) {
		actions.push(
			"Review capped tasks created by the alert scheduler before execution.",
		);
	}
	return actions;
}

function safeNotes(input: {
	allowExternalFetch: boolean;
	allowSkillDraftProposal: boolean;
	externalIntelligenceReport?: ExternalIntelligenceReport | UnknownJson;
	skillDraftFromLessons?: SkillDraftFromLessonsResult | UnknownJson;
}): string[] {
	return [
		"automaticov1 is an advisory cycle: it coordinates existing engines but does not authorize implementation.",
		"Repository writes, dependency updates, contract promotion, skill installation, and AgentLab auto-run are forbidden by this cycle.",
		"StateRoot writes may occur through existing scheduler/report pipelines; real repo writes remain disabled.",
		input.allowExternalFetch
			? "External intelligence was explicitly enabled; only exact allowlisted builders may run."
			: "External/news fetch is disabled by default.",
		input.allowSkillDraftProposal
			? "Skill proposal pipeline was explicitly enabled; generated outputs remain review-only."
			: "Skill proposal writes are disabled by default.",
		...(input.externalIntelligenceReport
			? [
					"External intelligence report must remain advisory and must not store raw content.",
				]
			: []),
		...(input.skillDraftFromLessons
			? [
					"Skill lessons output must keep allowedToProceed=false and require human approval.",
				]
			: []),
	];
}
