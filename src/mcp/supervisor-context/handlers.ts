// src/mcp/supervisor-context/handlers.ts
//
// PR 7 (Item 4, mcp-server god-file breakup): cluster G (supervisor-context)
// wrappers for the dispatchTool switch.
//
// 3 wrappers, one per case group (single label, no fall-through):
//   - handleSupervisorContextPack (idu_supervisor_context_pack)
//   - handleOrchestratorProcedure (idu_orchestrator_procedure)
//   - handleTaskContext           (idu_task_context)
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
import type { ContextBudgetUsage } from "../../context-budget.js";
import { buildDecisionEnvelope, decisionEnvelopeFromAdvisory } from "../../decision-envelope.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	arrayField,
	buildConsultationFromAdvisory,
	buildOrchestratorProcedure,
	buildSupervisorContextPack,
	governanceConfigData,
	planObjectiveForRuntime,
	type SupervisorConsultation,
	workerBoundaryData,
} from "../../mcp-server.js";
import { buildPreflightOrchestratorAdvisory } from "../../orchestrator-advisory.js";
import {
	booleanArg,
	envelope,
	requiredOneOf,
	requiredText,
	stringArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";
import { buildTruncationNotice } from "../envelope-advisory/truncation-notice.js";

/**
 * idu_supervisor_context_pack — compose a supervisor context pack.
 * Body verbatim from src/mcp-server.ts L2470-L2525.
 */
export async function handleSupervisorContextPack(
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
	const request = requiredText(args, "request");
	const pack = buildSupervisorContextPack(
		runtime,
		request,
		booleanArg(args, "includePlanSnapshot", false),
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const supervisorConsultation = pack.supervisorConsultation as
		| SupervisorConsultation
		| undefined;
	pack.decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation:
			supervisorConsultation?.supervisorRecommendation ?? "warn",
		severity: supervisorConsultation?.severity ?? "warning",
		confidence: supervisorConsultation?.confidence ?? 0.78,
		summary: String(pack.summary),
		requiresHuman: Boolean(pack.humanApprovalRequired),
		orchestratorDecisionRequired: true,
		allowedToProceed: supervisorConsultation?.proceed ?? true,
		evidenceRefs: supervisorConsultation?.evidenceRefs ?? [
			"readme:vision",
			"plan:snapshot",
			"task:context",
		],
		nextActions: arrayField(pack, "autonomyGates").map(String),
	});
	// REQ-EI-3 (P4): top-level truncation notice. When the context pack
	// dropped content, prepend the notice so the orchestrator sees it
	// before scrolling the rest of `safeNotes`. The existing
	// `contextBudget.truncated` bool on the payload is preserved for
	// consumer compatibility.
	const contextBudget = pack.contextBudget as
		| ContextBudgetUsage
		| undefined;
	const truncationNotice =
		contextBudget && typeof contextBudget === "object"
			? buildTruncationNotice(contextBudget)
			: null;
	const safeNotes = [
		...resolution.safeNotes,
		"Context pack advisory: no implementé, no escribí archivos y no ejecuté AgentLabs.",
		"Inyecta metas y gates; el orquestador decide y ejecuta.",
	];
	if (truncationNotice !== null) {
		safeNotes.unshift(truncationNotice);
	}
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: String(pack.summary),
		data: pack,
		safeNotes,
	});
}

/**
 * idu_orchestrator_procedure — return an orchestrator advisory procedure.
 * Body verbatim from src/mcp-server.ts L2527-L2567.
 */
export async function handleOrchestratorProcedure(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const purpose = requiredOneOf(args, "purpose", [
		"create_plan",
		"update_plan",
		"implement_change",
		"postflight_review",
	]);
	const request = stringArg(args, "request") ?? "";
	const procedure = buildOrchestratorProcedure(
		purpose,
		request,
		runtime,
		resolution,
	);
	procedure.decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: "warn",
		severity: "info",
		confidence: 0.7,
		summary: String(procedure.summary),
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: true,
		evidenceRefs: ["project:resolution", "procedure:must_consult"],
		nextActions: [String(procedure.recommendedNext)],
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: String(procedure.summary),
		data: procedure,
		safeNotes: [
			...resolution.safeNotes,
			"Idu-pi MCP informa y guía; el orquestador decide y comunica al usuario.",
			"AgentLabs son audit-only: no implementan ni crean workspaces.",
		],
	});
}

/**
 * idu_task_context — return advisory context for a task.
 * Body verbatim from src/mcp-server.ts L2569-L2611.
 */
export async function handleTaskContext(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const request = requiredText(args, "request");
	const report = runtime.preflight(request);
	const alignmentAdvisory = buildPreflightOrchestratorAdvisory(report);
	const decisionEnvelope = decisionEnvelopeFromAdvisory(
		name,
		alignmentAdvisory,
	);
	const supervisorConsultation = buildConsultationFromAdvisory({
		source: name,
		planObjective: planObjectiveForRuntime(runtime),
		advisory: alignmentAdvisory as unknown as JsonObject,
		risks: [
			String(report.risk),
			...arrayField(report as unknown as JsonObject, "warnings").map(
				String,
			),
		],
		gates: ["Preflight antes de delegar", "Orquestador decide si procede"],
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Contexto asesor: ${alignmentAdvisory.recommendation}`,
		data: {
			alignmentAdvisory,
			decisionEnvelope,
			supervisorConsultation,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			report,
		},
		safeNotes: [
			...resolution.safeNotes,
			"No ejecuté AgentLabs ni escribí archivos.",
			"El orquestador debe pasar este contexto a sus subagentes normales si decide implementar.",
		],
	});
}
