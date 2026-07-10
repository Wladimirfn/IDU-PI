// src/mcp/pruning/handlers.ts
//
// PR 20 (Item 4, mcp-server god-file breakup): cluster pruning
// wrappers for the dispatchTool switch.
//
// 2 wrappers, one per case group (single label, no fall-through):
//   - handleArchitecturalPruningPlan (idu_architectural_pruning_plan)
//   - handleContextPruningAdvisory  (idu_context_pruning_advisory)
//
// Note: this cluster was originally part of D (supervisor-trigger) and
// was deferred per the cluster map's "Defer if cross-coupling" note.
// The two cases lived in the same contiguous block in src/mcp-server.ts
// (L2213-L2319). Single splice.
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

import { buildArchitecturalPruningPlan } from "../../architectural-pruning-plan.js";
import type { CliRuntime } from "../../cli.js";
import { buildContextPruningAdvisoryReport } from "../../context-pruning-advisory.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	workerBoundaryData,
} from "../../mcp-server.js";
import { envelope } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_architectural_pruning_plan — generate architectural pruning plan.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleArchitecturalPruningPlan(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const plan = buildArchitecturalPruningPlan({
		projectId: runtime.projectId,
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: "warn",
		severity: "warning",
		confidence: 0.78,
		summary: "Architectural pruning plan requires review before changes.",
		requiresHuman: true,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: plan.candidates.map((candidate) => candidate.id),
		nextActions: plan.recommendedNext,
		requiredActions: [
			{
				id: "architectural-pruning-human-review",
				owner: "human",
				action: "review_pruning_plan_before_changes",
				reason:
					"Architectural pruning must not be applied without human/orchestrator approval.",
				blocking: true,
			},
		],
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Architectural pruning candidates: ${plan.candidates.length}`,
		data: {
			decisionEnvelope,
			plan,
			candidates: plan.candidates,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			"Plan de poda advisory-only: no borré archivos ni apliqué refactors.",
			"No aprobé recomendaciones, no ejecuté AgentLabs y no escribí reportes runtime.",
		],
	});
}

/**
 * idu_context_pruning_advisory — generate context pruning advisory report.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleContextPruningAdvisory(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const report = buildContextPruningAdvisoryReport({
		stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
		projectId: runtime.projectId,
		repoRoot: runtime.projectPath,
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: report.signals.length ? "warn" : "allow",
		severity: report.signals.some((signal) => signal.severity === "high")
			? "warning"
			: "info",
		confidence: 0.8,
		summary: `Semantic debt advisory signals: ${report.signals.length}`,
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: report.signals.map((signal) => signal.id),
		nextActions: [
			"Review signals before adding more context or sources.",
			"Revalidate stale evidence before plan decisions depend on it.",
			"Do not delete, archive, refactor, or promote contracts from this report alone.",
		],
		requiredActions: report.signals.length
			? [
					{
						id: "semantic-debt-orchestrator-review",
						owner: "orchestrator",
						action: "review_semantic_debt_signals_before_cleanup",
						reason:
							"Semantic debt signals are advisory and must not trigger automatic cleanup.",
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
		summary: `Semantic debt advisory signals: ${report.signals.length}`,
		data: {
			decisionEnvelope,
			report,
			signals: report.signals,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			"Reporte de deuda semántica advisory-only: no borré archivos, no archivé fuentes y no apliqué refactors.",
			"No promoví contratos, no degradé contratos, no ejecuté AgentLabs y no escribí analytics remota.",
			"No guardé prompts ni documentos crudos; sólo devolví conteos, ids, rutas y metadatos derivados.",
		],
	});
}
