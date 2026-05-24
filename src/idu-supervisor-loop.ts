import { join } from "node:path";
import { shouldUseAutomaticGuardrails } from "./idu-session.js";
import type { LabDbRepository } from "./lab-db-repository.js";
import {
	buildSemanticAuditStatus,
	type SemanticAuditStatusReport,
} from "./semantic-audit-command.js";
import type { SemanticAuditStats } from "./semantic-audit.js";
import { saveSemanticCompactionDraft } from "./semantic-compaction.js";
import {
	buildSemanticAgentTaskPlan,
	createSemanticAgentTasks,
	type CreateSemanticAgentTasksInput,
	type SemanticAgentTaskCreationResult,
	type SemanticAgentTaskPlan,
} from "./semantic-agent-tasks.js";
import type { StructuredTaskQueue } from "./structured-task-queue.js";

export type IduSupervisorTrigger =
	| "manual"
	| "on_idu_activation"
	| "after_task_registered"
	| "after_postflight"
	| "after_semantic_threshold";

export type IduSupervisorStepStatus =
	| "active"
	| "inactive"
	| "completed"
	| "skipped"
	| "warning";

export type IduSupervisorStepName =
	| "session_check"
	| "semantic_audit_status"
	| "semantic_audit_run"
	| "semantic_compaction_draft"
	| "semantic_agent_tasks";

export type IduSupervisorStepResult = {
	name: IduSupervisorStepName;
	status: IduSupervisorStepStatus;
	summary: string;
};

export type IduSupervisorLoopResult = {
	status: "completed" | "skipped" | "warning";
	reason?: "idu_inactive" | "not_enough_data";
	trigger: IduSupervisorTrigger;
	projectId: string;
	steps: IduSupervisorStepResult[];
	auditStatus?: SemanticAuditStatusReport;
	auditRunId?: string;
	semanticDraftPath?: string;
	agentTaskPlan?: SemanticAgentTaskPlan;
	createdTasks: number;
	summary: string;
	recommendedNext: string[];
	safety: {
		agentLabsExecuted: false;
		rulesApplied: false;
		memoryDeleted: false;
		projectCoreModified: false;
	};
};

export type IduSupervisorLoopInput = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	trigger: IduSupervisorTrigger;
	options: {
		allowSemanticDraft: boolean;
		allowAgentTaskPlan: boolean;
		dryRun: boolean;
		maxCreatedTasks?: number;
	};
	repository: Pick<
		LabDbRepository,
		| "getSemanticAuditStats"
		| "getSemanticAuditCheckpoint"
		| "createSemanticAuditRun"
		| "updateSemanticAuditCheckpoint"
	>;
	queue: StructuredTaskQueue;
	isIduActive?: (projectId: string) => boolean;
	saveSemanticCompactionDraft?: typeof saveSemanticCompactionDraft;
	buildSemanticAgentTaskPlan?: typeof buildSemanticAgentTaskPlan;
	createSemanticAgentTasks?: (
		input: CreateSemanticAgentTasksInput & { maxCreatedTasks?: number },
	) => SemanticAgentTaskCreationResult;
	now?: () => Date;
	idFactory?: (projectId: string, now: Date) => string;
};

const SAFE_FLAGS = {
	agentLabsExecuted: false,
	rulesApplied: false,
	memoryDeleted: false,
	projectCoreModified: false,
} as const;

export function runIduSupervisorLoop(
	input: IduSupervisorLoopInput,
): IduSupervisorLoopResult {
	const steps: IduSupervisorStepResult[] = [];
	const isActive = (input.isIduActive ?? shouldUseAutomaticGuardrails)(
		input.projectId,
	);
	steps.push({
		name: "session_check",
		status: isActive ? "active" : "inactive",
		summary: isActive ? "Idu-pi activo." : "Idu-pi inactivo.",
	});
	if (!isActive) {
		return {
			status: "skipped",
			reason: "idu_inactive",
			trigger: input.trigger,
			projectId: input.projectId,
			steps,
			createdTasks: 0,
			summary: "Idu-pi está apagado. No se ejecutó el supervisor automático.",
			recommendedNext: [
				"Activar con /idu o idu-pi idu si querés supervisor automático.",
			],
			safety: SAFE_FLAGS,
		};
	}

	const auditStatus = buildSemanticAuditStatus({
		projectId: input.projectId,
		repository: input.repository,
	});
	steps.push({
		name: "semantic_audit_status",
		status: "completed",
		summary: `shouldRun=${String(auditStatus.decision.shouldRun)} trigger=${auditStatus.decision.triggerReason}`,
	});

	let auditRunId: string | undefined;
	if (auditStatus.decision.shouldRun && !input.options.dryRun) {
		const now = input.now?.() ?? new Date();
		auditRunId = (input.idFactory ?? defaultRunId)(input.projectId, now);
		input.repository.createSemanticAuditRun({
			id: auditRunId,
			projectId: input.projectId,
			triggerReason: auditStatus.decision.triggerReason,
			mode: "threshold",
			status: "completed",
			scannedCounts: scannedCounts(auditStatus.stats),
			summary:
				"Auditoría automática del supervisor Idu-pi registrada sin compactar ni ejecutar AgentLabs.",
			completedAt: now.toISOString(),
		});
		input.repository.updateSemanticAuditCheckpoint(
			input.projectId,
			auditStatus.stats,
		);
		steps.push({
			name: "semantic_audit_run",
			status: "completed",
			summary: auditRunId,
		});
	} else {
		steps.push({
			name: "semantic_audit_run",
			status: "skipped",
			summary: auditStatus.decision.shouldRun
				? "dryRun activo."
				: "No se alcanzó umbral.",
		});
	}

	let draftPath: string | undefined;
	const canDraft =
		auditStatus.decision.shouldRun &&
		["threshold_major", "critical_findings"].includes(
			auditStatus.decision.triggerReason,
		) &&
		input.options.allowSemanticDraft;
	if (canDraft && !input.options.dryRun) {
		const draft = (
			input.saveSemanticCompactionDraft ?? saveSemanticCompactionDraft
		)({
			projectId: input.projectId,
			dbPath: join(input.workspaceRoot, "reports", "lab.db"),
			reportsPath: join(input.workspaceRoot, "reports"),
			workspaceRoot: input.workspaceRoot,
		});
		draftPath = draft.path;
		steps.push({
			name: "semantic_compaction_draft",
			status: "completed",
			summary: draft.path,
		});
	} else {
		steps.push({
			name: "semantic_compaction_draft",
			status: "skipped",
			summary: input.options.allowSemanticDraft
				? "No corresponde crear draft para este umbral."
				: "allowSemanticDraft=false.",
		});
	}

	let plan: SemanticAgentTaskPlan | undefined;
	let createdTasks = 0;
	if (input.options.allowAgentTaskPlan && !input.options.dryRun && draftPath) {
		const pathOrLatest = draftPath;
		plan = (input.buildSemanticAgentTaskPlan ?? buildSemanticAgentTaskPlan)(
			pathOrLatest,
			join(input.workspaceRoot, "reports"),
		);
		if (plan.validDraft && plan.candidates.length > 0) {
			const result = (
				input.createSemanticAgentTasks ?? createSemanticAgentTasks
			)({
				pathOrLatest,
				reportsPath: join(input.workspaceRoot, "reports"),
				queue: input.queue,
				projectId: input.projectId,
				maxCreatedTasks: input.options.maxCreatedTasks,
			});
			createdTasks = result.created.length;
			steps.push({
				name: "semantic_agent_tasks",
				status: "completed",
				summary: `${createdTasks} tarea(s) creadas.`,
			});
		} else {
			steps.push({
				name: "semantic_agent_tasks",
				status: "skipped",
				summary: "No hay draft válido con tareas sugeridas.",
			});
		}
	} else {
		steps.push({
			name: "semantic_agent_tasks",
			status: "skipped",
			summary: input.options.allowAgentTaskPlan
				? draftPath
					? "dryRun activo."
					: "Sin draft fresco de este tick."
				: "allowAgentTaskPlan=false.",
		});
	}

	const recommendedNext = recommendations(auditStatus, createdTasks);
	return {
		status: "completed",
		reason: auditStatus.decision.shouldRun ? undefined : "not_enough_data",
		trigger: input.trigger,
		projectId: input.projectId,
		steps,
		auditStatus,
		...(auditRunId ? { auditRunId } : {}),
		...(draftPath ? { semanticDraftPath: draftPath } : {}),
		...(plan ? { agentTaskPlan: plan } : {}),
		createdTasks,
		summary: auditStatus.decision.shouldRun
			? `Supervisor completado. Tareas creadas: ${createdTasks}.`
			: "No se alcanzó umbral. No se ejecutaron tareas.",
		recommendedNext,
		safety: SAFE_FLAGS,
	};
}

export function formatIduSupervisorLoopResult(
	result: IduSupervisorLoopResult,
): string {
	return [
		"Idu-pi Supervisor Tick",
		"",
		"Estado:",
		result.status,
		"",
		"Trigger:",
		result.trigger,
		"",
		"Pasos:",
		...result.steps.map((step) => `- ${step.name}: ${step.status}`),
		"",
		"Resumen:",
		result.summary,
		"",
		"Siguiente recomendado:",
		...result.recommendedNext.map((item) => `- ${item}`),
		"",
		"Nota segura:",
		"No ejecuté AgentLabs, no apliqué reglas, no borré memoria y no modifiqué Project Core/Constitution/blueprint/flows.",
	].join("\n");
}

function recommendations(
	auditStatus: SemanticAuditStatusReport,
	createdTasks: number,
): string[] {
	if (!auditStatus.decision.shouldRun)
		return ["Esperar umbral o ejecutar revisión manual."];
	const items = ["idu-semantic-compact-review latest"];
	if (createdTasks > 0) items.push("idu-queue-detail");
	else
		items.push(
			"idu-semantic-agent-tasks-review latest",
			"lab-review-plan postflight",
		);
	return items;
}

function scannedCounts(stats: SemanticAuditStats): Record<string, number> {
	return {
		labRunCount: stats.labRunCount,
		findingCount: stats.findingCount,
		proposalCount: stats.proposalCount,
		taskCount: stats.taskCount,
		userSignalCount: stats.userSignalCount,
		memoryItemCount: stats.memoryItemCount,
		criticalFindingCount: stats.criticalFindingCount,
		highFindingCount: stats.highFindingCount,
	};
}

function defaultRunId(projectId: string, now: Date): string {
	return `semantic-audit-${projectId}-${now
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14)}`;
}
