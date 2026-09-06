// src/mcp/agentlab/handlers.ts
//
// PR 12 (Item 4, mcp-server god-file breakup): cluster S (agentlab)
// wrappers for the dispatchTool switch.
//
// 3 wrappers, one per case group (single label, no fall-through):
//   - handleAgentLabRequestCreate (idu_agentlab_request_create)
//   - handleAgentLabReviewRun     (idu_agentlab_review_run)
//   - handleAgentLabReviewStatus  (idu_agentlab_review_status)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Note: the post-processor `recordMcpAgentLabEffectiveness` (outside
// the switch) stays in src/mcp-server.ts. It runs after dispatchTool
// returns and records effectiveness for the 3 agentlab tools. The
// wrapper names (handleAgentLabRequestCreate etc.) are stable, so
// the post-processor's `if (result.tool === "idu_agentlab_*")`
// checks continue to match.
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import { buildAgentLabWorkloadEnvelope } from "../../agentlab-supervisor-contract.js";
import type { CliRuntime } from "../../cli.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	agentLabSpecialtiesArg,
	agentLabStatusWorkloadEnvelope,
	aggregateRunStatus,
	compactSourceLibraryEvidence,
} from "../../mcp-server.js";
import {
	envelope,
	requiredOneOf,
	stringArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_agentlab_request_create — create AgentLab request (no execution).
 * Body verbatim from src/mcp-server.ts L4706-L4814.
 */
export async function handleAgentLabRequestCreate(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const source = requiredOneOf(args, "source", [
		"postflight",
		"master-plan",
		"skill-draft",
		"external-source-intelligence",
		"specialist-audit-plan",
	]);
	const selector = stringArg(args, "selector") ?? "latest";
	const specialties = agentLabSpecialtiesArg(args, "specialties");
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	if (source === "specialist-audit-plan" && specialties.errors.length > 0) {
		return envelope({
			stateRoot,

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Solicitud AgentLab specialist-audit-plan inválida.",
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"No ejecuté AgentLabs.",
				"No creé solicitud AgentLab inválida.",
			],
			errors: specialties.errors,
		});
	}
	const objective = stringArg(args, "objective");
	const context = stringArg(args, "context");
	// B5 PR3 v2 (REQ-B5-5): accept the optional `model` and
	// `stateRoot` args so the CLI/MCP surfaces can pick a
	// canonical model id or fall back to the create-time
	// auto-pick. Renamed to `userStateRoot` (decision T1.2 #4)
	// to avoid shadowing the resolved stateRoot used in the envelope.
	const model = stringArg(args, "model");
	const userStateRoot = stringArg(args, "stateRoot");
	const sourceLibraryEvidence =
		source === "external-source-intelligence"
			? compactSourceLibraryEvidence(
					runtime.sourceRecommend(context ?? objective ?? selector),
				)
			: undefined;
	const plan = runtime.agentLabRequestCreate(source, selector, {
		objective,
		context,
		specialties: specialties.values,
		externalSourceLibraryEvidence: sourceLibraryEvidence,
		...(model !== undefined ? { model } : {}),
		...(userStateRoot !== undefined ? { stateRoot: userStateRoot } : {}),
	});
	const workloadEnvelope =
		plan.workloadEnvelope ??
		buildAgentLabWorkloadEnvelope({
			status: "requested",
			statusReason:
				"Solicitud AgentLab creada; no ejecuta revisión automáticamente.",
			generatedAt: plan.generatedAt,
			source: "mcp",
			requests: plan.requests,
		});
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: plan.errors.length > 0 ? "block" : "warn",
		severity: plan.errors.length > 0 ? "needs_approval" : "warning",
		confidence: 0.72,
		summary: `Solicitud AgentLab creada: ${plan.path ?? "sin ruta"}`,
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: plan.errors.length === 0,
		evidenceRefs: plan.requests.map(
			(request) => `agentlab-request:${request.specialty}`,
		),
		suggestedAgentLabs: [
			...new Set(plan.requests.map((request) => request.specialty)),
		],
		nextActions: [
			"Run idu_agentlab_review_run only by explicit orchestrator decision.",
		],
	});
	return envelope({
		stateRoot,

		ok: plan.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Solicitud AgentLab creada: ${plan.path ?? "sin ruta"}`,
		data: {
			decisionEnvelope,
			workloadEnvelope,
			requestFilePath: plan.path,
			specialties: [
				...new Set(plan.requests.map((request) => request.specialty)),
			],
			plan,
		},
		safeNotes: [
			...resolution.safeNotes,
			"No ejecuté AgentLabs.",
			"Solicitud formal solamente.",
			...(source === "external-source-intelligence"
				? [
						"Usé sólo Source Library/digests locales cuando estuvieron disponibles; no hice web/live fetch.",
					]
				: []),
		],
		errors: plan.errors,
	});
}

/**
 * idu_agentlab_review_run — execute explicit AgentLab review.
 * Body verbatim from src/mcp-server.ts L4815-L4862.
 *
 * PR3 (Fix 2 — async dispatch): when the runtime returns the
 * dispatched sentinel (`consolidatedSummary` starts with
 * `"AgentLab review run dispatched: "`), surface the dispatched
 * envelope shape `{runId, status: "dispatched", dispatchPath}` at
 * `data` and DO NOT aggregate runs (the lab is in flight, no
 * `result.runs` to summarize yet). The sync-blocking path
 * (Fix 1 callers + test harnesses) keeps the existing envelope.
 */
export async function handleAgentLabReviewRun(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const selector = stringArg(args, "selector") ?? "latest";
	const result = await runtime.agentLabReviewRun(selector);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;

	// Dispatched branch: PR2 sentinel. The runtime's
	// dispatchAgentLabReviewRun wrote `<runId>.dispatch.json` and
	// returned the dispatch envelope with empty `runs`.
	const dispatchedMatch = /^AgentLab review run dispatched: (\S+)\s*$/u.exec(
		result.consolidatedSummary,
	);
	if (dispatchedMatch && result.runs.length === 0) {
		const runId = dispatchedMatch[1]!;
		const dispatchPath = result.path ?? "";
		return envelope({
			stateRoot,

			ok: true,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: `AgentLab review run dispatched: ${runId}`,
			data: {
				runId,
				status: "dispatched",
				dispatchPath,
				result,
			},
			safeNotes: [
				...resolution.safeNotes,
				...result.safeNotes,
				"AgentLab review dispatched as fire-and-forget (Fix 2).",
				`Poll status with: agentlab_review_status ${runId}`,
			],
		});
	}

	const aggregateStatus = aggregateRunStatus(
		result.runs.map((run) => run.status),
	);
	const envelopeStatus =
		aggregateStatus === "unknown" ? "skipped" : aggregateStatus;
	const workloadEnvelope =
		result.workloadEnvelope ??
		buildAgentLabWorkloadEnvelope({
			status: envelopeStatus as
				| "completed"
				| "partial"
				| "timed_out"
				| "skipped"
				| "failed"
				| "security_violation",
			statusReason: `AgentLab run aggregate status: ${aggregateStatus}.`,
			generatedAt: result.generatedAt,
			source: "mcp",
			runs: result.runs,
		});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `AgentLab review run: ${result.consolidatedSummary}`,
		data: {
			workloadEnvelope,
			runFilePath: result.path,
			status: aggregateStatus,
			findingsCount: result.consolidatedFindings.length,
			securityViolations: result.runs.filter(
				(run) => run.status === "security_violation",
			).length,
			result,
		},
		safeNotes: [
			...resolution.safeNotes,
			...result.safeNotes,
			"AgentLab review runner debe respetar sandbox/clone guard.",
		],
	});
}

/**
 * idu_agentlab_review_status — read AgentLab review status.
 * Body verbatim from src/mcp-server.ts L4863-L4960.
 */
export async function handleAgentLabReviewStatus(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const selector = stringArg(args, "selector") ?? "latest";
	const status = runtime.agentLabReviewStatus(selector);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const runs = status.result?.runs ?? [];
	const workloadEnvelope = agentLabStatusWorkloadEnvelope(status);
	const recommendations = runs.flatMap((run) => run.recommendations);
	// Issue #246: in-flight dispatch is NOT a human-required event.
	const baseRequiresHuman =
		!status.valid ||
		status.result?.requiresHumanApproval === true ||
		runs.some((run) => run.requiresHumanApproval) ||
		recommendations.some(
			(recommendation) => recommendation.requiresHumanApproval,
		);
	const agentLabRequiresHuman =
		status.state === "running" ? false : baseRequiresHuman;
	const agentLabHumanActions = agentLabRequiresHuman
		? [
				{
					id: "agentlab-review-human-approval",
					owner: "human" as const,
					action: "review_agentlab_before_proceeding",
					reason:
						"AgentLab status or recommendation requires human/orchestrator approval.",
					blocking: true,
					data: {
						recommendedNext: status.result?.recommendedNext,
						recommendations: recommendations
							.filter(
								(recommendation) => recommendation.requiresHumanApproval,
							)
							.map((recommendation) => recommendation.title),
					},
				},
			]
		: [];
	// Issue #246: branch on status.state. running → "allow", missing →
	// "ask_human". Reuses existing recommendation values — no enum growth.
	const isRunning = status.state === "running";
	const isMissing = status.state === "missing";
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: isRunning
			? "allow"
			: isMissing
				? "ask_human"
				: status.valid
					? agentLabRequiresHuman
						? "ask_human"
						: "warn"
					: "block",
		severity: agentLabRequiresHuman ? "needs_approval" : "warning",
		confidence: 0.74,
		summary: isRunning
			? `Estado AgentLab: ${status.name} (en vuelo)`
			: isMissing
				? "Estado AgentLab: run no encontrado."
				: status.valid
					? `Estado AgentLab: ${status.name}`
					: "Estado AgentLab inválido.",
		requiresHuman: isMissing || (!isRunning && agentLabRequiresHuman),
		orchestratorDecisionRequired: true,
		allowedToProceed: isRunning
			? true
			: !isMissing && status.valid && !agentLabRequiresHuman,
		evidenceRefs: (status.result?.consolidatedFindings ?? []).map(
			(finding, index) => `agentlab-finding:${index + 1}:${finding.title}`,
		),
		requiredActions: agentLabHumanActions,
		suggestedAgentLabs: runs.map((run) => run.specialty),
		nextActions: recommendations.map(
			(recommendation) => recommendation.suggestedNextStep,
		),
	});
	return envelope({
		stateRoot,

		ok: status.valid,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: isRunning
			? `Estado AgentLab: ${status.name} (en vuelo)`
			: isMissing
				? "Estado AgentLab: run no encontrado."
				: status.valid
					? `Estado AgentLab: ${status.name}`
					: "Estado AgentLab inválido.",
		data: {
			decisionEnvelope,
			workloadEnvelope,
			statusBySpecialty: Object.fromEntries(
				runs.map((run) => [run.specialty, run.status]),
			),
			findings: status.result?.consolidatedFindings ?? [],
			recommendations,
			testsSuggested: runs.flatMap((run) => run.testsSuggested),
			status,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Solo leí reporte AgentLab; no ejecuté labs.",
		],
		errors: status.errors,
	});
}
