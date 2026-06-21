// src/mcp/preflight/handlers.ts
//
// PR 8 (Item 4, mcp-server god-file breakup): cluster H (preflight)
// wrappers for the dispatchTool switch.
//
// 3 wrappers, one per case group (single label, no fall-through):
//   - handlePreflight  (idu_preflight)
//   - handleAdvisory   (idu_advisory)
//   - handlePostflight (idu_postflight)
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
import {
	decisionEnvelopeFromAdvisory,
	decisionEnvelopeFromEvidence,
} from "../../decision-envelope.js";
import {
	buildPostflightEvidenceGateways,
	buildPhysicalEvidenceGateways,
	buildPreflightEvidenceGateways,
} from "../../evidence-gateways.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	arrayField,
	buildConsultationFromAdvisory,
	buildSupervisorConsultation,
	governanceConfigData,
	planObjectiveForRuntime,
	workerBoundaryData,
} from "../../mcp-server.js";
import { buildPostflightTaskTrace } from "../../postflight-core.js";
import {
	buildPreflightOrchestratorAdvisory,
	buildProjectAdvisoryForOrchestrator,
} from "../../orchestrator-advisory.js";
import { runSensorImpulses } from "../../sensor-impulses.js";
import { categorizeFindings } from "../../supervisor-categorize.js";
import {
	envelope,
	requiredText,
	stringArg,
	stringListArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_preflight — evaluate risk and impact of a human request.
 * Body verbatim from src/mcp-server.ts L2481-L2532.
 */
export async function handlePreflight(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const request = requiredText(args, "request");
	const report = runtime.preflight(request);
	const alignmentAdvisory = buildPreflightOrchestratorAdvisory(report);
	const evidenceGateways = buildPreflightEvidenceGateways(report);
	const decisionEnvelope = decisionEnvelopeFromAdvisory(
		name,
		alignmentAdvisory,
		evidenceGateways,
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
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
		gates: [
			"Preflight antes de delegar",
			"No implementar si requiere aprobación humana",
		],
	});
	return envelope({
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: alignmentAdvisory.summary,
		stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
		data: {
			alignmentAdvisory,
			decisionEnvelope,
			supervisorConsultation,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			evidenceGateways,
			risk: report.risk,
			detectedImpact: report.affectedAreas,
			rulesAffected: report.constitutionGate?.affectedRules ?? [],
			recommendedAction: report.recommendedNext,
			requiresHumanConfirmation: report.requiresHumanConfirmation,
			report,
		},
		safeNotes: [
			...resolution.safeNotes,
			"No ejecuté AgentLabs.",
			"No modifiqué archivos.",
		],
	});
}

/**
 * idu_advisory — generate safe advisory from preflight.
 * Body verbatim from src/mcp-server.ts L2535-L2571.
 */
export async function handleAdvisory(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const request = requiredText(args, "request");
	const advisory = runtime.advisory(request);
	const alignmentAdvisory = buildProjectAdvisoryForOrchestrator(advisory);
	const decisionEnvelope = decisionEnvelopeFromAdvisory(
		name,
		alignmentAdvisory,
	);
	const supervisorConsultation = buildConsultationFromAdvisory({
		source: name,
		planObjective: planObjectiveForRuntime(runtime),
		advisory: alignmentAdvisory as unknown as JsonObject,
		risks: [String(advisory.level)],
		gates: ["Advisory al orquestador", "Sin scan/IA/AgentLab automático"],
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: alignmentAdvisory.summary,
		data: {
			alignmentAdvisory,
			decisionEnvelope,
			supervisorConsultation,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			risk: advisory.level,
			suggestedNextSteps: advisory.actions,
			advisory,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Advisory al orquestador: no ejecuté scan, IA ni AgentLabs.",
		],
	});
}

/**
 * idu_postflight — inspect local changes and gates without applying.
 * Body verbatim from src/mcp-server.ts L2574-L2752.
 */
export async function handlePostflight(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const report = runtime.postflight();
	const sensorStateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const sensorImpulses = await runSensorImpulses({
		stateRoot: sensorStateRoot,
		projectRoot: runtime.projectPath,
		changedFiles: report.changedFiles,
		promptForRole: (role, message, options) => {
			if (!runtime.promptForRole) {
				throw new Error("runtime.promptForRole is not configured");
			}
			return runtime.promptForRole(role, message, {
				projectId: runtime.projectId,
				stateRoot: sensorStateRoot,
				invocationSink: options.invocationSink,
			});
		},
	});
	const supervisorAdvisory = await categorizeFindings({
		stateRoot: sensorStateRoot,
		findings: sensorImpulses
			.filter((s) => s.consult.ok)
			.map((s) => ({
				match: s.match,
				ok: s.consult.ok,
				response: s.consult.response.slice(0, 500),
			})),
		promptForRole: (role, message, _options) => {
			if (!runtime.promptForRole) {
				throw new Error("runtime.promptForRole is not configured");
			}
			return runtime.promptForRole(role, message, {
				projectId: runtime.projectId,
				stateRoot: sensorStateRoot,
			});
		},
	});
	const actionId = stringArg(args, "actionId");
	const taskPackageId = stringArg(args, "taskPackageId");
	const expectedContracts = stringListArg(args, "expectedContracts");
	const expectedFiles = stringListArg(args, "expectedFiles");
	const ignoredFiles = stringListArg(args, "ignoredFiles");
	const expectedChangeMode = stringArg(args, "expectedChangeMode");
	const taskTrace = buildPostflightTaskTrace({
		actionId,
		taskPackageId,
		expectedContracts,
		expectedFiles,
		ignoredFiles,
		expectedChangeMode,
		report,
	});
	const physicalGateways = buildPhysicalEvidenceGateways(
		report.physicalGates ?? [],
	);
	const evidenceGateways = [
		...buildPostflightEvidenceGateways({
			report,
			taskTrace,
		}),
		...physicalGateways,
	];
	const decisionEnvelope = decisionEnvelopeFromEvidence(
		name,
		report.recommendedNext,
		evidenceGateways,
		{
			recommendation: taskTrace.matchesIntent ? "warn" : "needs_evidence",
			severity: report.requiresHumanConfirmation
				? "needs_approval"
				: "warning",
			confidence: 0.76,
			requiresHuman: report.requiresHumanConfirmation,
			orchestratorDecisionRequired: true,
			suggestedAgentLabs: report.suggestedAgentLabs,
			nextActions: [report.recommendedNext, String(taskTrace.nextAdvisory)],
		},
	);
	const postflightStops = [
		...taskTrace.contractDelta.map(
			(delta) => `Contrato esperado no observado: ${delta.contract}`,
		),
		...taskTrace.unexpectedAreas.map(
			(area) => `Área inesperada en cambios: ${area}`,
		),
		...(taskTrace.modeDelta ? [String(taskTrace.modeDelta)] : []),
	];
	const supervisorConsultation = buildSupervisorConsultation({
		source: name,
		planObjective: planObjectiveForRuntime(runtime),
		supervisorRecommendation: String(decisionEnvelope.recommendation),
		severity: String(decisionEnvelope.severity),
		confidence: decisionEnvelope.confidence,
		risks: [String(report.risk), ...report.warnings],
		gates: [
			"Postflight antes de cerrar",
			"Resolver taskTrace antes de merge si hay delta",
		],
		contracts: taskTrace.observedContracts,
		evidenceRefs: decisionEnvelope.evidenceRefs,
		proceed: Boolean(
			decisionEnvelope.allowedToProceed && taskTrace.matchesIntent,
		),
		proceedRationale: taskTrace.matchesIntent
			? "Postflight coincide con intención esperada; el orquestador puede proceder si gates físicos/evidencia son suficientes."
			: "Postflight requiere evidencia adicional antes de cerrar.",
		stopRationale: postflightStops,
		requiresHuman: decisionEnvelope.requiresHuman,
		suggestedAgentLabs: report.suggestedAgentLabs,
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: report.recommendedNext,
		data: {
			decisionEnvelope,
			supervisorConsultation,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			changedFiles: report.changedFiles,
			ignoredFiles: report.ignoredFiles ?? [],
			observedChangeMode: report.observedChangeMode ?? "code",
			risk: report.risk,
			gates: report.constitutionGate ?? null,
			physicalGates: report.physicalGates ?? [],
			physicalGateways,
			evidenceGateways,
			suggestedAgentLabs: report.suggestedAgentLabs,
			requiresHumanConfirmation: report.requiresHumanConfirmation,
			sensorImpulses: sensorImpulses.map((s) => ({
				match: {
					file: s.match.file,
					role: s.match.role,
					description: s.match.description,
				},
				ok: s.consult.ok,
				response: s.consult.response,
				model: s.consult.model,
				reason: s.consult.reason,
				rail: {
					wakeCount: s.consult.rail.wakeCount,
					tokenBudget: s.consult.rail.tokenBudget,
					cooldownRemainingMs: s.consult.rail.cooldownRemainingMs,
				},
				fileContentTruncated: !!s.fileContent,
			})),
			supervisorAdvisory: supervisorAdvisory
				? {
						ok: supervisorAdvisory.ok,
						counts: supervisorAdvisory.counts,
						summary: supervisorAdvisory.advisory?.summary ?? null,
						advisoryId: supervisorAdvisory.advisory?.advisoryId ?? null,
						reason: supervisorAdvisory.reason ?? null,
					}
				: null,
			taskTrace,
			report,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Postflight lee estado git; no hace commit ni push.",
			"Physical gates reportan evidencia disponible; Idu-pi no ejecutó build/test automáticamente.",
			"Trazabilidad advisory: no cierra ni aplica cambios automáticamente.",
			`Sensor impulses: ${sensorImpulses.length} fire (${sensorImpulses.filter((s) => s.consult.ok).length} ok, ${sensorImpulses.filter((s) => !s.consult.ok).length} blocked).`,
			`Supervisor advisory: ${supervisorAdvisory?.advisory?.summary ?? "no findings"}.`,
		],
	});
}
