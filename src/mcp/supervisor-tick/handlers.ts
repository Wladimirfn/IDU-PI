// src/mcp/supervisor-tick/handlers.ts
//
// PR 13 (Item 4, mcp-server god-file breakup): cluster I (supervisor-tick)
// wrappers for the dispatchTool switch.
//
// 6 wrappers, one per case group (single label, no fall-through):
//   - handleSupervisorTick         (idu_supervisor_tick)
//   - handleExecutionDirectorTick  (idu_execution_director_tick)
//   - handleProposalOutbox         (idu_proposal_outbox)
//   - handleProposalDetail         (idu_proposal_detail)
//   - handleSupervisorConsult      (idu_supervisor_consult)
//   - handleSupervisorCronPlan     (idu_supervisor_cron_plan)
//
// Note: cluster I's case bodies are SPLIT in src/mcp-server.ts because
// `idu_objective_status` (cluster J) is wedged at L2682 between
// proposal cases and the supervisor cases. Two independent splices.
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
import { buildSupervisorLoopOrchestratorAdvisory } from "../../orchestrator-advisory.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	governanceConfigData,
	workerBoundaryData,
} from "../../mcp-server.js";
import { decisionEnvelopeFromAdvisory } from "../../decision-envelope.js";
import {
	booleanArg,
	envelope,
	requiredText,
	stringArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_supervisor_tick — execute a safe supervisor tick.
 * Body verbatim from src/mcp-server.ts L2507-L2551.
 */
export async function handleSupervisorTick(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const allowSemanticDraft = booleanArg(args, "allowSemanticDraft", false);
	const allowAgentTaskPlan = booleanArg(args, "allowAgentTaskPlan", false);
	const result = runtime.supervisorTick({
		allowSemanticDraft,
		allowAgentTaskPlan,
	});
	const alignmentAdvisory = buildSupervisorLoopOrchestratorAdvisory(result);
	const decisionEnvelope = decisionEnvelopeFromAdvisory(
		name,
		alignmentAdvisory,
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: alignmentAdvisory.summary,
		data: {
			alignmentAdvisory,
			decisionEnvelope,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			stepsExecuted: result.steps.filter(
				(step) => step.status !== "skipped",
			),
			skippedReasons: result.steps.filter(
				(step) => step.status === "skipped",
			),
			recommendedNext: result.recommendedNext,
			status: result.status,
			reason: result.reason,
			allowSemanticDraft,
			allowAgentTaskPlan,
			result,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Supervisor tick no ejecuta AgentLabs.",
			"No aplica reglas ni modifica Project Core/Constitution.",
		],
	});
}

/**
 * idu_execution_director_tick — execute a safe execution director tick.
 * Body verbatim from src/mcp-server.ts L2552-L2613.
 */
export async function handleExecutionDirectorTick(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.executionDirectorTick) {
		return envelope({
			stateRoot: resolution.stateRoot ?? "", /* BUCKET-D master plan gate: guard failure; project state may still exist */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Execution director no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Execution director no disponible en este runtime."],
		});
	}
	const result = runtime.executionDirectorTick();
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: result.status === "proposal_created" ? "warn" : "allow",
		severity:
			result.status === "blocked_missing_lifecycle_binding"
				? "warning"
				: "info",
		confidence: 0.78,
		summary: `Execution director tick: ${result.status}`,
		requiresHuman: result.savedProposals.length > 0,
		orchestratorDecisionRequired: result.savedProposals.length > 0,
		allowedToProceed: result.status !== "blocked_missing_lifecycle_binding",
		evidenceRefs: result.evidenceRefs,
		nextActions: result.savedProposals.length
			? ["Review proposal outbox; Idu-pi does not implement proposals."]
			: ["No proposal action required from this tick."],
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Execution director tick: ${result.status}; saved=${result.savedProposals.length}`,
		data: {
			decisionEnvelope,
			status: result.status,
			authority: result.authority,
			generatedAt: result.generatedAt,
			proposals: result.proposals,
			savedProposals: result.savedProposals,
			blockingReasons: result.blockingReasons,
			evidenceRefs: result.evidenceRefs,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			result,
		},
		safeNotes: [
			...resolution.safeNotes,
			...result.safeNotes,
			"Tick only persists proposal JSONL under stateRoot; it does not implement code.",
			"No AgentLabs were executed or scheduled automatically.",
		],
	});
}

/**
 * idu_proposal_outbox — list flow-bound proposals saved in stateRoot.
 * Body verbatim from src/mcp-server.ts L2614-L2645.
 */
export async function handleProposalOutbox(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.proposalOutbox) {
		return envelope({
			stateRoot: resolution.stateRoot ?? "", /* BUCKET-D master plan gate: guard failure; project state may still exist */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Proposal outbox no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Proposal outbox no disponible en este runtime."],
		});
	}
	const proposals = runtime.proposalOutbox();
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Proposal outbox: ${proposals.length}`,
		data: { proposals },
		safeNotes: [
			...resolution.safeNotes,
			"Read proposal outbox from stateRoot only; no repo files were touched.",
			"Proposals are advisory and require orchestrator/human decision before work.",
		],
	});
}

/**
 * idu_proposal_detail — read proposal detail from stateRoot.
 * Body verbatim from src/mcp-server.ts L2646-L2681.
 */
export async function handleProposalDetail(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!runtime.proposalDetail) {
		return envelope({
			stateRoot: resolution.stateRoot ?? "", /* BUCKET-D master plan gate: guard failure; project state may still exist */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Proposal outbox no disponible en este runtime.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["Proposal outbox no disponible en este runtime."],
		});
	}
	const id = requiredText(args, "id");
	const proposal = runtime.proposalDetail(id);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: Boolean(proposal),
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: proposal
			? `Proposal detail: ${id}`
			: `Proposal not found: ${id}`,
		data: { id, proposal: proposal ?? null },
		safeNotes: [
			...resolution.safeNotes,
			"Read proposal detail from stateRoot only; no repo files were touched.",
			"Proposal detail is advisory; Idu-pi does not implement it.",
		],
		errors: proposal ? [] : [`Proposal not found: ${id}`],
	});
}

/**
 * idu_supervisor_consult — query a supervisor role.
 * Body verbatim from src/mcp-server.ts L2711-L2779.
 */
export async function handleSupervisorConsult(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const question = requiredText(args, "question");
	const roleRaw = stringArg(args, "role") ?? "supervisor-main";
	const context = stringArg(args, "context") ?? "";
	const result = await runtime.supervisorConsult({
		role: roleRaw as never,
		question,
		context,
	});
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: result.ok ? "warn" : "ask_human",
		severity: result.ok ? "info" : "warning",
		confidence: 0.7,
		summary: result.ok
			? `Supervisor consulted: ${result.role}`
			: `Consult failed: ${result.reason ?? "unknown"}`,
		requiresHuman: !result.ok,
		orchestratorDecisionRequired: true,
		allowedToProceed: result.ok,
		evidenceRefs: [
			`role:${result.role}`,
			`model:${result.model || "none"}`,
			`rail:wakeCount=${result.rail.wakeCount}`,
		],
		nextActions: result.ok
			? ["Read response and decide"]
			: ["Resolve blocker and retry consult"],
	});
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: result.ok,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: result.ok
			? `Supervisor ${result.role} responded (${result.response.length} chars)`
			: `Consult blocked: ${result.reason ?? "unknown"}`,
		data: {
			decisionEnvelope,
			consult: {
				role: result.role,
				question,
				context,
				response: result.response,
				model: result.model,
				provider: result.provider,
				promptChars: result.promptChars,
				elapsedMs: result.elapsedMs,
				rail: {
					tokenBudget: result.rail.tokenBudget,
					successStreak: result.rail.successStreak,
					failureStreak: result.rail.failureStreak,
					wakeCount: result.rail.wakeCount,
					cooldownMs: result.rail.cooldownMs,
					cooldownRemainingMs: result.rail.cooldownRemainingMs,
				},
				reason: result.reason,
			},
		},
		safeNotes: [
			...resolution.safeNotes,
			"Consult invokes a real model via promptForRole.",
			"Role must be enabled in role-engine.json; consult respects rail cooldowns and token budgets.",
			"No commit/push, no Telegram, no AgentLab auto-run.",
		],
	});
}

/**
 * idu_supervisor_cron_plan — propose a supervisor cron tick.
 * Body verbatim from src/mcp-server.ts L2780-L2848.
 */
export async function handleSupervisorCronPlan(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const plan = runtime.supervisorCronPlan();
	const alignmentAdvisory = buildSupervisorLoopOrchestratorAdvisory(
		plan.loop,
	);
	const decisionEnvelope = decisionEnvelopeFromAdvisory(
		name,
		alignmentAdvisory,
	);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Cron plan: ${plan.classification}`,
		data: {
			alignmentAdvisory,
			decisionEnvelope,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
			classification: plan.classification,
			proposedActions: plan.proposedActions,
			advisoryOnly: plan.advisoryOnly,
			writesAllowed: plan.writesAllowed,
			agentLabsAllowed: plan.agentLabsAllowed,
			plan,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Cron plan es advisory-only: no escribe auditorías, drafts ni tareas.",
			"No ejecuta AgentLabs ni aprueba acciones automáticamente.",
		],
	});
}
