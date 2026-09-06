// src/mcp/external/handlers.ts
//
// PR 9 (Item 4, mcp-server god-file breakup): cluster O (external)
// wrappers for the dispatchTool switch.
//
// 2 wrappers, one per case group (single label, no fall-through):
//   - handleExternalIntelligenceReport (idu_external_intelligence_report)
//   - handleExternalSourceRecommend    (idu_external_source_recommend)
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
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import {
	buildExternalIntelligenceReport,
	writeExternalIntelligenceReport,
} from "../../external-intelligence.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "../../external-source-registry.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	workerBoundaryData,
} from "../../mcp-server.js";
import {
	envelope,
	positiveIntegerArg,
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
 * idu_external_intelligence_report — query external sources via registry.
 * Body verbatim from src/mcp-server.ts L4238-L4324.
 */
export async function handleExternalIntelligenceReport(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!resolution.stateRoot) {
		return envelope({
			stateRoot: "", /* BUCKET-D unregistered: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"External intelligence requires registered Idu-pi stateRoot; refusing workspace fallback.",
			data: {
				stateRootRequired: true,
				workspaceFallbackAllowed: false,
			},
			safeNotes: [
				...resolution.safeNotes,
				"No escribí reporte externo porque falta stateRoot registrado.",
				"External intelligence escribe sólo bajo stateRoot/reports; no usa workspaceRoot como fallback.",
			],
			errors: ["missing_state_root"],
		});
	}
	const report = await buildExternalIntelligenceReport({
		projectId: runtime.projectId,
		sourceIds: stringListArg(args, "sourceIds"),
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const paths = writeExternalIntelligenceReport({
		stateRoot: resolution.stateRoot,
		report,
	});
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: report.signals.length ? "warn" : "allow",
		severity: report.signals.some(
			(signal) =>
				signal.severity === "critical" || signal.severity === "high",
		)
			? "warning"
			: "info",
		confidence: 0.78,
		summary: `External intelligence signals: ${report.signals.length}`,
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: report.signals.map((signal) => signal.evidenceRef),
		nextActions: [
			"Review external signals before feasibility, dependency, security, or update decisions.",
			"Do not update dependencies, promote contracts, or run AgentLabs from this report alone.",
		],
		requiredActions: report.signals.length
			? [
					{
						id: "external-intelligence-orchestrator-review",
						owner: "orchestrator",
						action: "review_external_intelligence_before_plan_decision",
						reason:
							"External ecosystem signals are advisory and require orchestrator review before any plan/dependency decision.",
						blocking: true,
					},
				]
			: [],
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `External intelligence signals: ${report.signals.length}`,
		data: {
			decisionEnvelope,
			report,
			paths,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			"External intelligence allowlist-only: no acepté URLs arbitrarias ni hice búsqueda web libre.",
			"Guardé sólo reporte normalizado bajo stateRoot/reports; no guardé cuerpos crudos, prompts, docs, headers ni env.",
			"No actualicé dependencias, no promoví contratos y no aprobé cambios por esta señal.",
			"No ejecuté AgentLabs ni analytics remota.",
		],
	});
}

/**
 * idu_external_source_recommend — recommend external sources from registry.
 * Body verbatim from src/mcp-server.ts L4325-L4378.
 */
export async function handleExternalSourceRecommend(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const request = requiredText(args, "request");
	const report = recommendExternalSources({
		projectId: runtime.projectId,
		request,
		domains: stringListArg(args, "domains") as ExternalSourceDomain[],
		language: stringArg(args, "language"),
		framework: stringArg(args, "framework"),
		maxMatches: positiveIntegerArg(args, "maxMatches"),
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: report.matches.length ? "allow" : "warn",
		severity: report.matches.length ? "info" : "warning",
		confidence: 0.8,
		summary: `External source registry matches: ${report.matches.length}`,
		requiresHuman: false,
		orchestratorDecisionRequired: report.matches.length > 0,
		allowedToProceed: false,
		evidenceRefs: report.matches.map(
			(match) => `external-source:${match.sourceId}`,
		),
		nextActions: [
			"Use registry matches as source pointers for feasibility and planning, not as fetched evidence.",
			"Verify official/academic/community sources before changing contracts, dependencies, or implementation structure.",
		],
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `External source registry matches: ${report.matches.length}`,
		data: {
			decisionEnvelope,
			report,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			"External source registry: no hice web/live fetch ni acepté URLs libres.",
			"no guardé raw docs, prompts ni cuerpos externos; sólo devolví descriptores y recomendaciones.",
			"No importé Source Library, no actualicé dependencias y no aprobé cambios por esta señal.",
			"No promoví contratos y No ejecuté AgentLabs.",
		],
	});
}
