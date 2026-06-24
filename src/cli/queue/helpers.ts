/**
 * helpers.ts — queue cluster (I).
 * PR 5 of 7 (Item 4). Move + re-export PURO.
 *
 * 8 helpers + 2 types. 6 cases for idu-queue* and idu-task stay inline
 * in the switch (cluster A, extracted in a separate phase).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { TaskTemplateKind } from "../../task-templates.js";
import {
	buildTaskPrompt,
	formatTaskTemplateHelp,
} from "../../task-templates.js";
import {
	type StructuredTaskQueue,
	analyzeStructuredTaskSignal,
	structuredTaskInputForText,
} from "../../structured-task-queue.js";
import type { StructuredTask } from "../../structured-task-queue.js";
import type { LabDbRepository } from "../../lab-db-repository.js";
import type { ProjectPreflightReport } from "../../project-preflight.js";
import { shouldUseAutomaticGuardrails } from "../../idu-session.js";
import { maybeRunSupervisorAfterTask } from "../../idu-supervisor-hooks.js";
import { loadProjectCore } from "../../project-core.js";
import {
	loadProjectConstitution,
	deriveConstitutionFromProjectCore,
} from "../../project-constitution.js";
import { formatProjectCoreForPrompt } from "../../project-core.js";
import { primaryIntentConcept } from "../dispatch-glue/index.js";

export function createCliTask(
	kind: TaskTemplateKind,
	details: string,
	context: {
		projectId: string;
		projectPath: string;
		workspaceRoot: string;
		supervisorActivityStateRoot?: string;
		structuredTaskQueue: StructuredTaskQueue;
		labDbRepository: LabDbRepository;
		preflight: (request: string) => ProjectPreflightReport;
	},
): StructuredTask {
	const prompt = buildTaskPrompt(kind, details);
	if (!prompt) {
		throw new Error(formatTaskTemplateHelp());
	}
	const signal = analyzeStructuredTaskSignal(details || prompt);
	let task = context.structuredTaskQueue.enqueueTask(
		structuredTaskInputForText(prompt, {
			source: "cli",
			projectId: context.projectId,
			category: kind,
			originalText: details,
			analyzer: () => signal,
		}),
	);
	if (shouldUseAutomaticGuardrails(context.projectId)) {
		const report = context.preflight(prompt);
		const guardRisk = strongestGuardRisk(report.risk, task.intentRiskHint);
		const reason = [
			`preflight ${report.risk}`,
			task.intentRiskHint ? `intent ${task.intentRiskHint}` : undefined,
			task.intentConcepts?.length
				? `intención: ${task.intentKind}/${task.intentConcepts.join("+")}`
				: undefined,
			...report.affectedAreas.map((area) => `área: ${area}`),
			...report.warnings,
		]
			.filter(Boolean)
			.join("; ");
		task =
			guardRisk === "high" || guardRisk === "blocker"
				? (context.structuredTaskQueue.markNeedsConfirmation(task.id, {
						guardRisk,
						guardReason: reason,
					}) ?? task)
				: (context.structuredTaskQueue.markGuardClear(
						task.id,
						guardRisk,
						reason,
					) ?? task);
	}
	try {
		context.labDbRepository.recordUserSignal({
			id: randomUUID(),
			projectId: context.projectId,
			source: "cli-task",
			rawText: details || prompt,
			detectedEmotion: signal.emotion,
			urgency: signal.urgency,
			confidence: signal.confidence,
			matchedKeywords: signal.matchedKeywords,
		});
	} catch {
		// SQLite/semantic trigger is secondary; CLI task creation remains the source of truth.
	}
	maybeRunSupervisorAfterTask({
		projectId: context.projectId,
		projectPath: context.projectPath,
		workspaceRoot: context.workspaceRoot,
		supervisorActivityStateRoot:
			context.supervisorActivityStateRoot ?? context.workspaceRoot,
		repository: context.labDbRepository,
		queue: context.structuredTaskQueue,
		task,
	});
	return task;
}

export function semanticCompactionProjectContext(
	projectPath: string,
	stateRoot: string,
): {
	projectCore?: string;
	constitution?: string;
} {
	try {
		const core = loadProjectCore(projectPath);
		if (core.status !== "confirmed") return {};
		const constitution = existsSync(
			join(stateRoot, "config", "project-constitution.json"),
		)
			? loadProjectConstitution(stateRoot)
			: deriveConstitutionFromProjectCore(core);
		return {
			projectCore: formatProjectCoreForPrompt(core),
			constitution: JSON.stringify(
				{
					status: constitution.status,
					principles: constitution.principles,
					requiredPractices: constitution.requiredPractices,
					forbiddenPractices: constitution.forbiddenPractices,
					approvalRules: constitution.approvalRules,
					validationGates: constitution.validationGates,
				},
				null,
				2,
			),
		};
	} catch {
		return {};
	}
}

export function strongestGuardRisk(
	preflightRisk: ProjectPreflightReport["risk"],
	intentRisk: StructuredTask["intentRiskHint"],
): ProjectPreflightReport["risk"] {
	const order: ProjectPreflightReport["risk"][] = [
		"low",
		"medium",
		"high",
		"blocker",
	];
	if (!intentRisk) return preflightRisk;
	return order.indexOf(intentRisk) > order.indexOf(preflightRisk)
		? intentRisk
		: preflightRisk;
}

export function approveStructuredTaskById(
	queue: StructuredTaskQueue,
	id: string,
): StructuredTask | undefined {
	const task = queue.findByIdPrefix(id);
	return task ? queue.markGuardApproved(task.id) : undefined;
}

export function rejectStructuredTaskById(
	queue: StructuredTaskQueue,
	id: string,
): StructuredTask | undefined {
	const task = queue.findByIdPrefix(id);
	return task
		? queue.markGuardRejected(task.id, "Rechazada por confirmación humana.")
		: undefined;
}

export function completeStructuredTaskById(
	queue: StructuredTaskQueue,
	id: string,
	evidence: string,
): StructuredTask | undefined {
	const task = queue.findByIdPrefix(id);
	return task ? queue.markDone(task.id, evidence) : undefined;
}

export function formatCliTaskResult(task: StructuredTask): string {
	const paused = task.guardStatus === "needs_confirmation";
	return [
		"Idu-pi Task",
		"",
		"Estado:",
		paused ? "Tarea pausada: requiere confirmación humana" : "queued",
		"",
		"ID:",
		task.id,
		"",
		"Categoría:",
		task.category,
		"",
		"Prioridad:",
		String(task.priority),
		"",
		"Emoción:",
		task.emotion ?? "neutral",
		...(task.intentKind
			? [
					"",
					"Intención:",
					`${task.intentKind}/${primaryIntentConcept(task.intentConcepts)}/${task.intentRiskHint ?? "low"}`,
				]
			: []),
		...(task.guardStatus
			? [
					"",
					"Guard:",
					`${task.guardStatus}${task.guardRisk ? `/${task.guardRisk}` : ""}`,
				]
			: []),
		...(paused
			? [
					"",
					"Aprobar:",
					`idu-pi idu-queue-approve ${task.id}`,
					"Rechazar:",
					`idu-pi idu-queue-reject ${task.id}`,
				]
			: []),
		"",
		"Nota segura:",
		"Registré la tarea y la señal localmente; no ejecuté IA ni AgentLabs.",
	].join("\n");
}

export type TaskQueuePanelDispatchRuntime = {
	queueApprove: (id: string) => StructuredTask | undefined;
	queueReject: (id: string) => StructuredTask | undefined;
	listTasks: () => StructuredTask[];
};

export type TaskQueuePanelDispatchResult = {
	action:
		| "approve"
		| "reject"
		| "view"
		| "page-next"
		| "page-prev"
		| "back-to-list"
		| "not-found"
		| "back"
		| "exit";
	taskId?: string;
	message?: string;
};

export function dispatchTaskQueuePanelChoice(
	runtime: TaskQueuePanelDispatchRuntime,
	choice: string,
): TaskQueuePanelDispatchResult {
	if (choice === "back") {
		return { action: "back" };
	}
	if (choice === "exit") {
		return { action: "exit" };
	}
	if (choice === "back-to-list") {
		return { action: "back-to-list" };
	}
	if (choice === "page:next") {
		return { action: "page-next" };
	}
	if (choice === "page:prev") {
		return { action: "page-prev" };
	}
	if (choice.startsWith("view:")) {
		const id = choice.slice("view:".length);
		return { action: "view", taskId: id };
	}
	if (choice.startsWith("approve:")) {
		const id = choice.slice("approve:".length);
		const task = runtime.queueApprove(id);
		if (!task) {
			return { action: "not-found", message: `task not found: ${id}` };
		}
		return {
			action: "approve",
			taskId: id,
			message: `Tarea aprobada: ${task.id}. No ejecuté IA ni AgentLabs.`,
		};
	}
	if (choice.startsWith("reject:")) {
		const id = choice.slice("reject:".length);
		const task = runtime.queueReject(id);
		if (!task) {
			return { action: "not-found", message: `task not found: ${id}` };
		}
		return {
			action: "reject",
			taskId: id,
			message: `Tarea rechazada: ${task.id}.`,
		};
	}
	return { action: "exit" };
}

