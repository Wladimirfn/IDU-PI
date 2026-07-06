// src/mcp/master-plan/handlers.ts
//
// PR 18 (Item 4, mcp-server god-file breakup): cluster F (master-plan)
// wrappers for the dispatchTool switch.
//
// 9 wrappers, one per case group (single label, no fall-through):
//   - handleMasterPlanStatus       (idu_master_plan_status)
//   - handleMasterPlanCreate       (idu_master_plan_create)
//   - handleMasterPlanReview       (idu_master_plan_review)
//   - handleMasterPlanApprove      (idu_master_plan_approve)
//   - handleMasterPlanReject       (idu_master_plan_reject)
//   - handlePlanSnapshot           (idu_plan_snapshot)
//   - handleNextAdvisoryAction     (idu_next_advisory_action)
//   - handleContinuationProposal   (idu_continuation_proposal)
//   - handleTaskPackageCreate      (idu_task_package_create)
//
// All 9 cases are consecutive (L2141-L2495ish in src/mcp-server.ts).
// Single splice.
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import type { CliRuntime } from "../../cli.js";
import { decisionEnvelopeFromEvidence } from "../../decision-envelope.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import { buildTaskPackageEvidenceGateways } from "../../evidence-gateways.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	buildContinuationProposal,
	buildNextAdvisoryAction,
	buildPlanSnapshot,
	buildTaskPackage,
} from "../../mcp-server.js";
import {
	booleanArg,
	envelope,
	positiveIntegerArg,
	requiredText,
	stringArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_master_plan_status — read Master Plan status.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleMasterPlanStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanStatus) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const status = runtime.masterPlanStatus();
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Plan Maestro: ${status.status}`,
		data: status as unknown as JsonObject,
		safeNotes: [...resolution.safeNotes, "No regeneré el Plan Maestro."],
	});
}

/**
 * idu_master_plan_create — create/regenerate the Master Plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleMasterPlanCreate(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanRedraft) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const result = runtime.masterPlanRedraft(stringArg(args, "reason"));
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Plan Maestro creado: ${result.plan.status}`,
		data: {
			status: result.plan.status,
			jsonPath: result.jsonPath,
			markdownPath: result.markdownPath,
			flowArtifact: result.plan.flowArtifact,
			plan: result.plan,
		} as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Creé/regeneré sólo artefactos de gobernanza en stateRoot.",
			"No ejecuté AgentLabs, no apliqué flows y no toqué el repo real.",
		],
	});
}

/**
 * idu_master_plan_review — review the Master Plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleMasterPlanReview(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReview) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const review = runtime.masterPlanReview(
		stringArg(args, "selector") ?? "latest",
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: review.plan.status !== "incompatible",
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Review Plan Maestro: ${review.plan.status}`,
		data: review as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Review sin regenerar ni ejecutar AgentLabs.",
		],
		errors:
			review.plan.status === "incompatible"
				? review.plan.criticalRisks
				: [],
	});
}

/**
 * idu_master_plan_approve — explicitly approve the Master Plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleMasterPlanApprove(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanApprove) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const result = runtime.masterPlanApprove(
		stringArg(args, "selector") ?? "latest",
		stringArg(args, "reason"),
		"mcp",
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Plan Maestro aprobado: ${result.plan.status}`,
		data: {
			status: result.plan.status,
			jsonPath: result.jsonPath,
			markdownPath: result.markdownPath,
			flowArtifact: result.plan.flowArtifact,
			approval: result.plan.approval,
			plan: result.plan,
		} as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Aprobé explícitamente sólo el Plan Maestro en stateRoot.",
			"No apliqué flows, no ejecuté AgentLabs y no toqué el repo real.",
		],
	});
}

/**
 * idu_master_plan_reject — explicitly reject the Master Plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleMasterPlanReject(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReject) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const result = runtime.masterPlanReject(
		stringArg(args, "selector") ?? "latest",
		stringArg(args, "reason"),
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Plan Maestro rechazado: ${result.plan.status}`,
		data: {
			status: result.plan.status,
			jsonPath: result.jsonPath,
			markdownPath: result.markdownPath,
			flowArtifact: result.plan.flowArtifact,
			approval: result.plan.approval,
			plan: result.plan,
		} as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Rechacé explícitamente sólo el Plan Maestro en stateRoot.",
			"No borré drafts, no ejecuté AgentLabs y no toqué el repo real.",
		],
	});
}

/**
 * idu_plan_snapshot — return compact snapshot of the Master Plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handlePlanSnapshot(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReview) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const review = runtime.masterPlanReview(
		stringArg(args, "selector") ?? "latest",
	);
	const snapshot = buildPlanSnapshot(review, runtime);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Snapshot Plan Maestro: ${snapshot.planStatus}`,
		data: snapshot,
		safeNotes: [
			...resolution.safeNotes,
			"Snapshot compacto: no regeneré Plan Maestro ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_next_advisory_action — propose the next candidate advisory action.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleNextAdvisoryAction(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReview) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const request = stringArg(args, "request") ?? "";
	const review = runtime.masterPlanReview("latest");
	const advisoryAction = buildNextAdvisoryAction(
		buildPlanSnapshot(review, runtime),
		request,
		stringArg(args, "mode") ?? "from_plan",
		stringArg(args, "maxScope") ?? "small",
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	advisoryAction.decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: String(advisoryAction.recommendation),
		severity: "info",
		confidence: 0.72,
		summary: String((advisoryAction.candidateAction as JsonObject).title),
		requiresHuman: false,
		orchestratorDecisionRequired: Boolean(
			advisoryAction.orchestratorDecisionRequired,
		),
		allowedToProceed: true,
		evidenceRefs: ["plan:snapshot", "candidate_action"],
		nextActions: [String(advisoryAction.recommendation)],
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Acción candidata: ${String((advisoryAction.candidateAction as JsonObject).title)}`,
		data: advisoryAction,
		safeNotes: [
			...resolution.safeNotes,
			"Acción candidata solamente: Idu-pi no implementa.",
			"No ejecuté AgentLabs; el orquestador decide llamadas explícitas.",
		],
	});
}

/**
 * idu_continuation_proposal — propose a continuation slice.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleContinuationProposal(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReview) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const review = runtime.masterPlanReview("latest");
	const proposal = buildContinuationProposal(
		runtime,
		buildPlanSnapshot(review, runtime),
		stringArg(args, "request") ?? "",
		positiveIntegerArg(args, "autonomyWindowMinutes"),
		stringArg(args, "maxScope") ?? "small",
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: String(proposal.summary),
		data: proposal,
		safeNotes: [
			...resolution.safeNotes,
			"Propuesta de continuidad solamente: Idu-pi no implementa.",
			"No ejecuté AgentLabs; el orquestador decide llamadas explícitas.",
			"Ejecutar idu_postflight antes de cerrar la próxima tarea.",
		],
	});
}

/**
 * idu_task_package_create — build a task package for subagent handoff.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleTaskPackageCreate(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.masterPlanReview) {
		return envelope({
			stateRoot: "", /* BUCKET-D master plan gate: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Master Plan no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Master Plan no disponible en este runtime."],
		});
	}
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const request = requiredText(args, "request");
	const review = runtime.masterPlanReview("latest");
	const snapshot = buildPlanSnapshot(review, runtime);
	const advisoryAction = buildNextAdvisoryAction(
		snapshot,
		request,
		"from_request",
		"small",
	);
	const taskPackage = buildTaskPackage(
		snapshot,
		advisoryAction,
		request,
		stringArg(args, "actionId"),
		booleanArg(args, "includePlanSnapshot", false),
	);
	const taskPackageEvidenceGateways =
		buildTaskPackageEvidenceGateways(taskPackage);
	taskPackage.evidenceGateways = taskPackageEvidenceGateways;
	taskPackage.decisionEnvelope = decisionEnvelopeFromEvidence(
		name,
		String(taskPackage.recommendation),
		taskPackageEvidenceGateways,
		{
			recommendation: String(taskPackage.recommendation),
			severity: taskPackage.humanApprovalRequired
				? "needs_approval"
				: "warning",
			confidence: 0.74,
			requiresHuman: Boolean(taskPackage.humanApprovalRequired),
			orchestratorDecisionRequired: Boolean(
				taskPackage.orchestratorDecisionRequired,
			),
			nextActions: [String(taskPackage.recommendation)],
		},
	);
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Paquete de tarea advisory: ${taskPackage.id}`,
		data: taskPackage,
		safeNotes: [
			...resolution.safeNotes,
			"Paquete para subagentes normales; Idu-pi no implementa.",
			"Governance-review del orquestador debe ocurrir antes del worker.",
		],
	});
}
