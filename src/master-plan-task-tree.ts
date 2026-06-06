import type { MasterPlan, MasterPlanWorkMilestone } from "./master-plan.js";

export type MasterPlanTaskTreeStatus =
	| "ready"
	| "missing_plan"
	| "plan_not_approved"
	| "empty";

export type MasterPlanTaskTreeSubtask = {
	id: string;
	title: string;
	acceptanceCriteria: string[];
};

export type MasterPlanTaskTreeTask = {
	id: string;
	hitoId: string;
	title: string;
	acceptanceCriteria: string[];
	subtasks: MasterPlanTaskTreeSubtask[];
};

export type MasterPlanTaskTreeHito = {
	id: string;
	title: string;
	goal: string;
	tasks: MasterPlanTaskTreeTask[];
};

export type MasterPlanTaskTree = {
	version: 1;
	status: MasterPlanTaskTreeStatus;
	projectId?: string;
	objective?: string;
	hitos: MasterPlanTaskTreeHito[];
	blockingReasons: string[];
};

export function buildMasterPlanTaskTree(
	plan:
		| Pick<
				MasterPlan,
				"projectId" | "status" | "inferredObjective" | "workMilestones"
		  >
		| undefined,
): MasterPlanTaskTree {
	if (!plan) {
		return baseTree("missing_plan", ["Master Plan is missing."]);
	}
	if (plan.status !== "approved") {
		return baseTree(
			"plan_not_approved",
			["Master Plan must be approved before task tree execution."],
			plan,
		);
	}
	const hitos = plan.workMilestones.map((milestone, hitoIndex) =>
		buildHito(milestone, hitoIndex),
	);
	if (hitos.length === 0 || hitos.every((hito) => hito.tasks.length === 0)) {
		return baseTree(
			"empty",
			["Approved Master Plan has no executable milestones/tasks."],
			plan,
		);
	}
	return {
		version: 1,
		status: "ready",
		projectId: plan.projectId,
		objective: plan.inferredObjective,
		hitos,
		blockingReasons: [],
	};
}

function baseTree(
	status: MasterPlanTaskTreeStatus,
	blockingReasons: string[],
	plan?: Pick<MasterPlan, "projectId" | "inferredObjective">,
): MasterPlanTaskTree {
	return {
		version: 1,
		status,
		...(plan?.projectId ? { projectId: plan.projectId } : {}),
		...(plan?.inferredObjective ? { objective: plan.inferredObjective } : {}),
		hitos: [],
		blockingReasons,
	};
}

function buildHito(
	milestone: MasterPlanWorkMilestone,
	hitoIndex: number,
): MasterPlanTaskTreeHito {
	const hitoId = `hito-${hitoIndex + 1}`;
	const actions =
		milestone.actions.length > 0 ? milestone.actions : [milestone.goal];
	return {
		id: hitoId,
		title: milestone.name,
		goal: milestone.goal,
		tasks: actions.map((action, taskIndex) => ({
			id: `${hitoId}-task-${taskIndex + 1}`,
			hitoId,
			title: action,
			acceptanceCriteria: milestone.exitCriteria,
			subtasks: [
				{
					id: `${hitoId}-task-${taskIndex + 1}-subtask-1`,
					title: "Inspect current project evidence and constraints",
					acceptanceCriteria: [
						"Current repo state and relevant contracts are referenced before implementation.",
					],
				},
				{
					id: `${hitoId}-task-${taskIndex + 1}-subtask-2`,
					title: "Implement the smallest vertical slice",
					acceptanceCriteria: milestone.exitCriteria,
				},
				{
					id: `${hitoId}-task-${taskIndex + 1}-subtask-3`,
					title: "Verify, review, and assimilate postflight evidence",
					acceptanceCriteria: [
						"Tests/build or declared validation evidence is recorded.",
						"Fresh review or explicit waiver is recorded before closure.",
						"Postflight result updates the next task decision.",
					],
				},
			],
		})),
	};
}
