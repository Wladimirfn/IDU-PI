import {
	runIduSupervisorLoop,
	type IduSupervisorLoopInput,
	type IduSupervisorLoopResult,
} from "./idu-supervisor-loop.js";

export type IduSupervisorCronClassification =
	| "idle"
	| "watch"
	| "review_recommended"
	| "urgent_review";

export type IduSupervisorCronPlanResult = {
	status: "planned" | "skipped";
	projectId: string;
	classification: IduSupervisorCronClassification;
	proposedActions: string[];
	advisoryOnly: true;
	writesAllowed: false;
	agentLabsAllowed: false;
	loop: IduSupervisorLoopResult;
};

export function planIduSupervisorCron(
	input: IduSupervisorLoopInput,
): IduSupervisorCronPlanResult {
	const loop = runIduSupervisorLoop({
		...input,
		trigger: "cron_planning",
		options: {
			...input.options,
			allowSemanticDraft: false,
			allowAgentTaskPlan: false,
			dryRun: true,
			mode: "plan",
		},
	});
	return {
		status: loop.status === "skipped" ? "skipped" : "planned",
		projectId: input.projectId,
		classification: classifyCronPlan(loop),
		proposedActions: proposedCronActions(loop),
		advisoryOnly: true,
		writesAllowed: false,
		agentLabsAllowed: false,
		loop,
	};
}

function classifyCronPlan(
	loop: IduSupervisorLoopResult,
): IduSupervisorCronClassification {
	if (loop.status === "skipped") return "idle";
	const decision = loop.auditStatus?.decision;
	if (!decision?.shouldRun) return "watch";
	return decision.triggerReason === "critical_findings" ? "urgent_review" : "review_recommended";
}

function proposedCronActions(loop: IduSupervisorLoopResult): string[] {
	if (loop.status === "skipped") return loop.recommendedNext;
	if (!loop.auditStatus?.decision.shouldRun) {
		return ["idu_semantic_audit_status", "Esperar próximo tick advisory."];
	}
	return [
		"idu_semantic_audit_status",
		"idu_supervisor_tick manual si el orquestador decide ejecutar el registro",
		...loop.recommendedNext,
	];
}
