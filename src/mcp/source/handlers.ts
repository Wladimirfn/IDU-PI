// src/mcp/source/handlers.ts
//
// PR 19 (Item 4, mcp-server god-file breakup): cluster R (source)
// wrappers for the dispatchTool switch.
//
// 15 wrappers, one per case group (single label, no fall-through):
//   - handleSourceStatus                  (idu_source_status)
//   - handleSourceAdd                      (idu_source_add)
//   - handleSourceRemove                   (idu_source_remove)
//   - handleSourceRead                     (idu_source_read)
//   - handleSourceExtract                  (idu_source_extract)
//   - handleSourceReport                   (idu_source_report)
//   - handleSourceResearchReport           (idu_source_research_report)
//   - handleSourceDigest                   (idu_source_digest)
//   - handleSourceDigestStatus             (idu_source_digest_status)
//   - handleSourceChunkRead                (idu_source_chunk_read)
//   - handleSourceRecommendForTask         (idu_source_recommend_for_task)
//   - handleSourceRequiredActions          (idu_source_required_actions)
//   - handleSourceSkillCandidatesCreate    (idu_source_skill_candidates_create)
//   - handleSourceSkillCandidatesReview    (idu_source_skill_candidates_review)
//   - handleSourceRefresh                  (idu_source_refresh)
//
// Note: cluster R is SPLIT into 2 regions in src/mcp-server.ts:
//   - Block 1: 14 consecutive cases (L2584-L2932) — the source cases
//     before idu_skill_draft_from_lessons (PR 15 delegation)
//   - Block 2: 1 isolated case (L2936) — idu_source_refresh
// TWO independent splices.
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
import { buildDecisionEnvelope, decisionEnvelopeFromEvidence } from "../../decision-envelope.js";
import { buildSourceRequiredActionsEvidenceGateways } from "../../evidence-gateways.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	arrayField,
	boundSourceRecommendationForInjection,
	withSourceContentBudget,
	withSourceResearchBudget,
} from "../../mcp-server.js";
import { envelope, requiredText, stringArg } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_source_status — read Source Library state.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const status = runtime.sourceLibraryStatus();
	return envelope({
		stateRoot: "",

		ok: status.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source Library: ${status.state} (${status.sources.length} sources)`,
		data: { status },
		safeNotes: [
			...resolution.safeNotes,
			"Solo leí Source Library en stateRoot.",
			"No promoví contratos ni ejecuté AgentLabs.",
		],
		errors: status.errors,
	});
}

/**
 * idu_source_add — register a source under stateRoot.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceAdd(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceLibraryAdd(requiredText(args, "path"));
	return envelope({
		stateRoot: "",

		ok: result.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source agregada: ${result.addedSource?.id ?? "sin fuente"}`,
		data: { result, addedSource: result.addedSource },
		safeNotes: [
			...resolution.safeNotes,
			"Copié documentación bajo stateRoot/Doc/<project>/Source Library; texto legible puede generar snapshots/Markdown seguros.",
			"PDFs intentan conversión best-effort desde texto embebido; no hice OCR ni parsing pesado.",
			"No promoví contratos ni ejecuté AgentLabs.",
		],
		errors: result.errors,
	});
}

/**
 * idu_source_remove — remove a source from stateRoot.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceRemove(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceLibraryRemove(
		requiredText(args, "sourceId"),
	);
	return envelope({
		stateRoot: "",

		ok: result.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source removida: ${result.removedSource?.id ?? "sin fuente"}`,
		data: { result, removedSource: result.removedSource },
		safeNotes: [
			...resolution.safeNotes,
			"Removí sólo archivos registrados dentro de Source Library stateRoot.",
			"No cambié contratos, Project Core, Constitution, flows ni skills.",
			"No ejecuté AgentLabs.",
		],
		errors: result.errors,
	});
}

/**
 * idu_source_read — read source content (bounded).
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceRead(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = withSourceContentBudget(
		runtime.sourceLibraryRead(requiredText(args, "sourceId")),
		"source_chunk_read",
		"result.content",
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source read: ${result.source.id} status=${result.readStatus}`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Leí sólo fuentes registradas en Source Library stateRoot.",
			"No cambié contratos ni ejecuté AgentLabs.",
			"No consulté web/live sources.",
		],
	});
}

/**
 * idu_source_extract — extract bounded text/markdown from a source.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceExtract(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceLibraryExtract(
		requiredText(args, "sourceId"),
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source extract: ${result.source.id} status=${result.extractionStatus}`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Extracción de texto escribe sólo bajo Source Library stateRoot cuando corresponde.",
			"PDFs convertidos se leen desde Markdown seguro; PDFs sin texto embebido quedan metadata-only. No hice OCR ni parsing pesado.",
			"No cambié contratos ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_source_report — return source metadata and limitations.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceReport(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceLibraryReport(
		requiredText(args, "sourceId"),
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source report: ${result.source.id} extraction=${result.extractionStatus}`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Reporté metadata de fuente registrada solamente.",
			"No cambié contratos ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_source_research_report — create advisory research report on a query.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceResearchReport(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = withSourceResearchBudget(
		runtime.sourceLibraryResearch(requiredText(args, "query")),
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source research: ${result.signals.length} señales`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Investigué sólo fuentes registradas y texto extraído/legible.",
			"No consulté web/live sources.",
			"No promoví contratos ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_source_digest — generate digest/chunks advisory for a source.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceDigest(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceDigest(requiredText(args, "sourceId"));
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source digest: ${result.sourceId} mode=${result.processingMode}`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Digest/chunks escritos bajo stateRoot/Doc/<project>/sources/{chunks,digests} y source-library-index.json.",
			"No consulté web/live sources ni ejecuté AgentLabs.",
			"No promoví contratos.",
		],
	});
}

/**
 * idu_source_digest_status — read digest/index state.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceDigestStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceDigestStatus();
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source digest status: ${result.digests.length} fuentes`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Leí sólo estado de digests en Source Library stateRoot.",
			"No promoví contratos ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_source_chunk_read — read a specific chunk/tome from a digest.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceChunkRead(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = withSourceContentBudget(
		runtime.sourceChunkRead(
			requiredText(args, "sourceId"),
			requiredText(args, "chunkId"),
		),
		"source_chunk_read",
		"result.content",
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source chunk read: ${result.chunkId}`,
		data: { result },
		safeNotes: [
			...resolution.safeNotes,
			"Leí sólo chunks registrados bajo Source Library stateRoot.",
			"No consulté web/live sources ni ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_source_recommend_for_task — recommend sources/chunks for a task.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceRecommendForTask(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const rawResult = runtime.sourceRecommend(requiredText(args, "request"));
	const result = boundSourceRecommendationForInjection(rawResult);
	const matches = arrayField(result, "matches") as JsonObject[];
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: matches.length > 0 ? "warn" : "allow",
		severity: matches.length > 0 ? "warning" : "info",
		confidence: 0.68,
		summary: `Source recommendations: ${matches.length} matches`,
		requiresHuman: false,
		orchestratorDecisionRequired: matches.length > 0,
		allowedToProceed: true,
		evidenceRefs: matches.map(
			(match) => `source:${String(match.sourceId)}`,
		),
		nextActions: matches.map((match) =>
			String(match.orchestratorInstruction ?? ""),
		),
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source recommendations: ${matches.length} matches`,
		data: { result, decisionEnvelope },
		safeNotes: [
			...resolution.safeNotes,
			"Recomendé fuentes/chunks desde índice local; el orquestador decide y manda subagentes.",
			"No implementé, no consulté web/live sources y no ejecuté AgentLabs.",
			"No promoví contratos.",
		],
	});
}

/**
 * idu_source_required_actions — list sources missing real reading.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceRequiredActions(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceRequiredActions();
	const evidenceGateways =
		buildSourceRequiredActionsEvidenceGateways(result);
	const decisionEnvelope = decisionEnvelopeFromEvidence(
		name,
		`Source required actions: ${result.actions.length}`,
		evidenceGateways,
		{
			recommendation:
				result.actions.length > 0 ? "needs_evidence" : "allow",
			severity: result.actions.length > 0 ? "needs_approval" : "info",
			confidence: 0.86,
			requiresHuman: false,
			orchestratorDecisionRequired: result.actions.length > 0,
			nextActions: result.actions.map(
				(action) => action.requiredAction.instructions,
			),
		},
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source required actions: ${result.actions.length}`,
		data: {
			result,
			actions: result.actions,
			evidenceGateways,
			decisionEnvelope,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Listé fuentes que requieren lector bibliotecario; el orquestador debe despachar el subagente.",
			"No implementé, no ejecuté AgentLabs y no consulté web/live sources.",
			"No promoví contratos.",
		],
	});
}

/**
 * idu_source_skill_candidates_create — generate a skill candidates report.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceSkillCandidatesCreate(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.sourceSkillCandidatesCreate(
		stringArg(args, "selector") ?? "all",
	);
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: result.report.candidates.length
			? "needs_approval"
			: "allow",
		severity: result.report.candidates.length ? "warning" : "info",
		confidence: 0.72,
		summary: `Source skill candidates: ${result.report.candidates.length}`,
		requiresHuman: true,
		orchestratorDecisionRequired: result.report.candidates.length > 0,
		allowedToProceed: true,
		evidenceRefs: result.report.candidates.flatMap(
			(candidate) => candidate.evidenceRefs,
		),
		nextActions: [
			"Human/orchestrator must review before any skill promotion.",
			"Optional future AgentLab review can audit comprehension and duplicates.",
		],
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source skill candidates: ${result.report.candidates.length}`,
		data: { result, decisionEnvelope },
		safeNotes: [
			...resolution.safeNotes,
			"Creé sólo un reporte JSON bajo stateRoot/reports.",
			"No instalé skills, no escribí .agents/.atl y no promoví contratos.",
			"tokens/cost: no medido.",
		],
	});
}

/**
 * idu_source_skill_candidates_review — validate a skill candidates report.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceSkillCandidatesReview(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const review = runtime.sourceSkillCandidatesReview(
		stringArg(args, "pathOrLatest") ?? "latest",
	);
	return envelope({
		stateRoot: "",

		ok: review.ok,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: review.ok
			? `Source skill candidate report valid: ${review.report.candidates.length} candidates`
			: `Source skill candidate report invalid: ${review.errors.length} errors`,
		data: { review },
		safeNotes: [
			...resolution.safeNotes,
			"Validé reporte advisory/reports-only; no instalé skills ni ejecuté AgentLabs.",
			"tokens/cost: no medido.",
		],
		errors: review.ok ? [] : review.errors,
	});
}

/**
 * idu_source_refresh — recalculate Source Library hashes/state.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSourceRefresh(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const status = runtime.sourceLibraryRefresh();
	return envelope({
		stateRoot: "",

		ok: status.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Source Library refresh: ${status.state}`,
		data: { status },
		safeNotes: [
			...resolution.safeNotes,
			"Refresh recalculó estado/hashes en stateRoot únicamente.",
			"No cambié contratos, Project Core, Constitution, flows ni skills.",
			"No ejecuté AgentLabs.",
		],
		errors: status.errors,
	});
}
