// src/mcp/bibliotecario/handlers.ts
//
// PR 4 (Item 4, mcp-server god-file breakup): cluster C
// (bibliotecario-prepare) wrappers for the dispatchTool switch.
//
// 5 wrappers, one per case group (single label, no fall-through):
//   - handlePrepare                       (idu_prepare)
//   - handleBibliotecarioInit             (idu_bibliotecario_init)
//   - handleModelInvocationStatus         (idu_model_invocation_status)
//   - handleSkillRating                   (idu_skill_rating)
//   - handleBibliotecarioProactiveAdvisory (idu_bibliotecario_proactive_advisory)
//
// Note: cluster C is SPLIT across the dispatch switch — the first 4
// cases are consecutive (L1922-L2075 in src/mcp-server.ts) but the 5th
// (`idu_bibliotecario_proactive_advisory`) lives at L4673, separated by
// ~2600 lines. Both regions are spliced independently.
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

import { join } from "node:path";
import type { CliRuntime } from "../../cli.js";
import {
	runBibliotecarioInit,
	formatBibliotecarioInit,
} from "../../cli-bibliotecario-init.js";
import {
	buildModelInvocationStatusOrError,
	formatModelInvocationStatus,
} from "../../cli-model-invocation-status.js";
import { runSkillRating, formatSkillRating } from "../../cli-skill-rating.js";
import { buildContextPruningAdvisoryReport } from "../../context-pruning-advisory.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "../../external-source-registry.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	activeMcpProjectId,
	boundSourceRecommendationForInjection,
	compactSourceSkillCandidateReview,
	arrayField,
	invalidMcpInput,
	scoreArg,
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
 * idu_prepare — execute a safe prepare without AI or AgentLabs.
 * Body verbatim from src/mcp-server.ts L1922-L1938.
 */
export async function handlePrepare(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const result = runtime.prepare();
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: result.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: result.recommendedNext,
		data: result as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Prepare seguro: no ejecuté IA ni AgentLabs.",
		],
		errors: result.errors,
	});
}

/**
 * idu_bibliotecario_init — initialize lab.db and the bootstrap skill.
 * Body verbatim from src/mcp-server.ts L1940-L1970.
 */
export async function handleBibliotecarioInit(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const projectId = activeMcpProjectId(runtime, resolution);
	if (!projectId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"project id must be non-empty",
		);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const init = runBibliotecarioInit({ stateRoot, projectId });
	if (!init.ok) {
		return invalidMcpInput(name, runtime, resolution, init.error, {
			stateRoot,
		});
	}
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Bibliotecario inicializado para ${projectId}.`,
		data: {
			activeProjectId: projectId,
			init,
			output: formatBibliotecarioInit(init),
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_model_invocation_status — show model invocation state from lab.db.
 * Body verbatim from src/mcp-server.ts L1972-L2022.
 */
export async function handleModelInvocationStatus(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const projectId = activeMcpProjectId(runtime, resolution);
	if (!projectId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"project id must be non-empty",
		);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const labDbPath = runtime.labDbPath ?? join(stateRoot, "lab.db");
	const limit = positiveIntegerArg(args, "limit");
	if (args.limit !== undefined && limit === undefined) {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"limit must be a positive integer",
		);
	}
	const result = buildModelInvocationStatusOrError({
		projectId,
		stateRoot,
		labDbPath,
		options: {
			...(stringArg(args, "role") ? { role: stringArg(args, "role") } : {}),
			...(limit !== undefined ? { limit } : {}),
		},
	});
	if (!result.ok)
		return invalidMcpInput(name, runtime, resolution, result.error, {
			labDbPath,
		});
	const formatter =
		runtime.formatModelInvocationStatus ?? formatModelInvocationStatus;
	const output = `lab.db path: ${labDbPath}\n${formatter(result.report)}`;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: "Estado de invocaciones de modelos generado.",
		data: {
			labDbPath,
			output,
			report: result.report as unknown as JsonObject,
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_skill_rating — record a score for a skill proposal.
 * Body verbatim from src/mcp-server.ts L2024-L2075.
 */
export async function handleSkillRating(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const projectId = activeMcpProjectId(runtime, resolution);
	if (!projectId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"project id must be non-empty",
		);
	const proposalId = stringArg(args, "proposalId");
	if (!proposalId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"proposalId must be non-empty",
		);
	const score = scoreArg(args, "score");
			if (!score.ok)
				return invalidMcpInput(name, runtime, resolution, score.error);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const result = runSkillRating([proposalId, score.text], {
		stateRoot,
	});
	if (!result.ok) {
		return invalidMcpInput(name, runtime, resolution, result.error, {
			proposalId,
			score: score.value,
			exitCode: result.exitCode,
		});
	}
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Skill rating registrado: ${proposalId}=${result.score}.`,
		data: {
			proposalId: result.proposalId,
			score: result.score,
			recommendation: result.recommendation,
			output: formatSkillRating(result),
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_bibliotecario_proactive_advisory — composite Bibliotecario
 * advisory coordinating evidence surfaces. Body verbatim from
 * src/mcp-server.ts L4673-L4892.
 */
export async function handleBibliotecarioProactiveAdvisory(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const request = requiredText(args, "request");
	const sourceRecommendations = runtime.sourceRecommend(request);
	const requiredSourceActions = runtime.sourceRequiredActions();
	const externalRegistry = recommendExternalSources({
		projectId: runtime.projectId,
		request,
		domains: stringListArg(args, "domains") as ExternalSourceDomain[],
		language: stringArg(args, "language"),
		framework: stringArg(args, "framework"),
		maxMatches: positiveIntegerArg(args, "maxMatches"),
	});
	const semanticDebt = buildContextPruningAdvisoryReport({
		stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
		projectId: runtime.projectId,
		repoRoot: runtime.projectPath,
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	let skillReview: JsonObject;
	let skillReviewStatus = "missing";
	try {
		skillReview = compactSourceSkillCandidateReview(
			runtime.sourceSkillCandidatesReview("latest"),
		);
		skillReviewStatus = skillReview.ok === true ? "available" : "missing";
	} catch (error) {
		skillReviewStatus = "missing";
		skillReview = compactSourceSkillCandidateReview({
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
		});
	}
	const planLibrarian = {
		surface: "plan_librarian",
		recommendation: "review_evidence_before_plan_or_contract_change",
		evidenceRefs: ["plan:snapshot", "source:recommendations"],
		requiredReads: [
			"Plan Maestro vigente",
			"master-plan.flows.json",
			"Doc/<project>/04-contratos-aprobados.md",
			"Source Library recommendation refs",
		],
		contractPromotionAllowed: false,
		limitations: [
			"No crea, aprueba ni rechaza Plan Maestro.",
			"No promueve contratos; sólo pide evidencia y revisión del orquestador.",
		],
	};
	const boundedSourceRecommendations =
		boundSourceRecommendationForInjection(sourceRecommendations);
	const boundedSourceMatches = arrayField(
		boundedSourceRecommendations,
		"matches",
	) as JsonObject[];
	const evidencePolicy = externalRegistry.evidencePolicy;
	const sourceEcosystem = {
		surface: "source_ecosystem",
		local: {
			matches: boundedSourceMatches.map((match) => ({
				sourceId: String(match.sourceId ?? ""),
				title: String(match.title ?? ""),
				chunkIds: arrayField(match, "chunkIds").map(String),
				confidence: String(match.confidence ?? "low"),
				whyRelevant: String(match.whyRelevant ?? ""),
			})),
			missingKnowledge: arrayField(
				boundedSourceRecommendations,
				"missingKnowledge",
			).map(String),
			limitations: arrayField(
				boundedSourceRecommendations,
				"limitations",
			).map(String),
			requiredActions: requiredSourceActions.actions,
			contextPressure: boundedSourceRecommendations.contextPressure,
		},
		externalRegistry: {
			matches: externalRegistry.matches.map((match) => ({
				sourceId: match.sourceId,
				name: match.name,
				category: match.category,
				whyRelevant: match.whyRelevant,
				automationMode: match.automationMode,
				promotionAllowed: match.promotionAllowed,
				claimType: match.claimType,
				evidenceRole: match.evidenceRole,
				canonicality: match.canonicality,
				requiresCorroboration: match.requiresCorroboration,
				forbiddenAsSoleAuthority: match.forbiddenAsSoleAuthority,
				policyWarnings: match.policyWarnings.slice(0, 4),
			})),
			limitations: externalRegistry.limitations,
			fetchAllowed: externalRegistry.fetchAllowed,
			rawDocsStored: externalRegistry.rawDocsStored,
		},
		rawContentIncluded: false,
		webFetchAllowed: false,
		contractPromotionAllowed: false,
	};
	const skillOptimization = {
		surface: "skill_optimization",
		recommendation: "proposal_only",
		skillPromotionAllowed: false,
		writesAllowed: false,
		installAllowed: false,
		existingCandidateReportStatus: skillReviewStatus,
		existingCandidateReport: skillReview,
		limitations: [
			"No crea ni instala skills desde esta advisory.",
			"Las skills se proponen, el supervisor enruta, el humano/orquestador aprueba y un único writer aplica.",
		],
	};
	const failureSemanticDebt = {
		surface: "failure_semantic_debt",
		signals: semanticDebt.signals.map((signal) => ({
			id: signal.id,
			category: signal.category,
			severity: signal.severity,
			evidenceRefs: signal.evidenceRefs,
			summary: signal.summary,
			recommendedAction: signal.recommendedAction,
		})),
		totals: semanticDebt.totals,
		limitations: semanticDebt.limitations,
	};
	const contextPressure = semanticDebt.signals.some(
		(signal) => signal.severity === "high",
	)
		? "high"
		: semanticDebt.signals.length > 0
			? "medium"
			: "low";
	const resourceContextCheck = {
		rawContentIncluded: false,
		webFetchAllowed: false,
		writesAllowed: false,
		agentLabAutoRunAllowed: false,
		contractPromotionAllowed: false,
		skillPromotionAllowed: false,
		tokenCostMeasured: false,
		estimatedTokenUse: "not_measured",
		pressure: contextPressure,
		surfacesConsulted: 4,
		localSourceMatches: boundedSourceMatches.length,
		externalRegistryMatches: externalRegistry.matches.length,
		semanticDebtSignals: semanticDebt.signals.length,
		contextBudgetSignals: semanticDebt.totals.contextQualityEvents,
		recommendation:
			contextPressure === "high"
				? "review_resource_and_semantic_debt_before_adding_more_context"
				: contextPressure === "medium"
					? "review_before_adding_more_context"
					: "bounded_context_ok",
	};
	const evidenceRefs = [
		...boundedSourceMatches.map(
			(match) => `source:${String(match.sourceId)}`,
		),
		...externalRegistry.matches.map(
			(match) => `external-source:${match.sourceId}`,
		),
		...semanticDebt.signals.map((signal) => signal.id),
	];
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: "warn",
		severity: semanticDebt.signals.some(
			(signal) => signal.severity === "high",
		)
			? "warning"
			: "info",
		confidence: 0.78,
		summary: "Bibliotecario proactive advisory surfaces composed.",
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs,
		nextActions: [
			"Use this advisory to choose a bounded next slice; do not implement from it directly.",
			"Ask human/orchestrator before contracts, skills, AgentLabs, dependency updates, or cleanup.",
			"Prefer exact source/chunk refs and resource checks over loading broad docs.",
		],
		requiredActions: [
			{
				id: "bibliotecario-surfaces-orchestrator-review",
				owner: "orchestrator",
				action: "review_bibliotecario_surfaces_before_changes",
				reason:
					"Composite Bibliotecario advisory coordinates evidence but must not authorize implementation, contract promotion, skill writes, web fetch, or AgentLabs.",
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
		summary: "Bibliotecario proactive advisory surfaces composed.",
		data: {
			decisionEnvelope,
			planLibrarian,
			evidencePolicy,
			sourceEcosystem,
			skillOptimization,
			failureSemanticDebt,
			resourceContextCheck,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			"Bibliotecario proactive advisory es sólo coordinación de evidencia; no implementa.",
			"No hice writes, no consulté web/live sources, no promoví contratos ni skills.",
			"No ejecuté AgentLabs ni creé solicitudes AgentLab.",
			"No incluí documentos, chunks, prompts ni reportes crudos; sólo refs, conteos y metadata compacta.",
		],
	});
}
