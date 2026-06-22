// src/mcp/objective/handlers.ts
//
// PR 14 (Item 4, mcp-server god-file breakup): cluster J (objective-alerts)
// wrappers for the dispatchTool switch.
//
// 5 wrappers, one per case group (single label, no fall-through):
//   - handleObjectiveStatus             (idu_objective_status)
//   - handleAutonomousAlertsStatus      (idu_autonomous_alerts_status)
//   - handleAutonomousAlertsTick        (idu_autonomous_alerts_tick)
//   - handleAutonomousAlertsControl     (idu_autonomous_alerts_control)
//   - handleAutomaticov1Cycle           (idu_automaticov1_cycle)
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

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	readAutonomousAlertEngineState,
	updateAutonomousAlertControlState,
	appendAutonomousAlertDecision,
} from "../../autonomous-alert-engine-state.js";
import { buildAutonomousAlertEngineReport } from "../../autonomous-alert-engine.js";
import { runAutomaticov1AdvisoryCycle } from "../../automaticov1-cycle.js";
import type { CliRuntime } from "../../cli.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import { buildExternalIntelligenceReport } from "../../external-intelligence.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "../../external-source-registry.js";
import { getIduSessionStatus } from "../../idu-session.js";
import { buildMasterPlanTaskTree } from "../../master-plan-task-tree.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	buildRuntimeSelfMaintenanceReport,
	governanceConfigData,
	loadRuntimeAutomaticov1Plan,
	loadRuntimeExecutionReadiness,
	workerBoundaryData,
} from "../../mcp-server.js";
import { readPendingBlockingInjection } from "../../objective-injection.js";
import { recordSupervisorActivityEventDeferred } from "../../supervisor-activity-events.js";
import { inferTaskTemplateKind } from "../../task-templates.js";
import { readIduUsageEvents } from "../../usage-events.js";
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
 * idu_objective_status — read-only MCP mirror of `idu-objective-status` CLI.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleObjectiveStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	_runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	// PR-B: read-only MCP mirror of `idu-objective-status` CLI.
	// Surfaces the current PISO gate state for the orchestrator.
	const blocking = readPendingBlockingInjection(resolution.stateRoot ?? "");
	const reminderPath = join(
		resolution.stateRoot ?? "",
		"objective-reminder.json",
	);
	const reminderExists = existsSync(reminderPath);
	return envelope({
		ok: true,
		tool: name,
		projectId: resolution.projectId,
		projectPath: resolution.projectPath,
		summary: blocking
			? `objective reminder active: ${blocking.severity} ${blocking.kind} (acked=${blocking.acked}, ageMs=${blocking.ageMs})`
			: "objective reminder: no blocking injection",
		stateRoot: resolution.stateRoot,
		data: {
			blocking,
			reminderStatePath: reminderPath,
			reminderStateExists: reminderExists,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Read-only: no side effects, no enqueue.",
		],
	});
}

/**
 * idu_autonomous_alerts_status — read autonomous alert engine state.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleAutonomousAlertsStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const state = readAutonomousAlertEngineState(stateRoot);
	const selfMaintenance = buildRuntimeSelfMaintenanceReport(
		runtime,
		stateRoot,
	);
	const taskRead = selfMaintenance.taskRead;
	const report = buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: taskRead.tasks,
		selfMaintenanceSignals: selfMaintenance.report.signals,
		allowTaskCreation: false,
		cooldowns: state.cooldowns,
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alert status: ${report.decisions.length} decision(s).`,
		data: { report, state },
		safeNotes: [
			...resolution.safeNotes,
			...report.safeNotes,
			"Status read-only: no alert state, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed.",
			...taskRead.safeNotes,
		],
	});
}

/**
 * idu_autonomous_alerts_tick — run autonomous alert engine tick.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleAutonomousAlertsTick(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const state = readAutonomousAlertEngineState(stateRoot);
	const selfMaintenance = buildRuntimeSelfMaintenanceReport(
		runtime,
		stateRoot,
	);
	const taskRead = selfMaintenance.taskRead;
	const allowTaskCreation = booleanArg(args, "allowTaskCreation", false);
	const report = buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: taskRead.tasks,
		selfMaintenanceSignals: selfMaintenance.report.signals,
		allowTaskCreation,
		cooldowns: state.cooldowns,
	});
	const tasksCreated: Array<{
		taskId: string;
		alertId: string;
		evidenceRefs: string[];
	}> = [];
	const taskCreationBlockedByHumanEscalation = report.humanEscalations.some(
		(decision) =>
			["repeated_bug", "security", "db"].includes(decision.domain),
	);
	for (const decision of report.decisions) {
		if (
			decision.recommendedAction === "create_task" &&
			decision.taskDraft &&
			allowTaskCreation &&
			!taskCreationBlockedByHumanEscalation &&
			tasksCreated.length < 3
		) {
			const taskKind = inferTaskTemplateKind(decision.taskDraft.text);
			const task = runtime.createTask(taskKind, decision.taskDraft.text);
			tasksCreated.push({
				taskId: task.id,
				alertId: decision.id,
				evidenceRefs: decision.evidenceRefs,
			});
			appendAutonomousAlertDecision(stateRoot, decision);
		} else if (
			decision.recommendedAction === "ask_human" &&
			allowTaskCreation
		) {
			appendAutonomousAlertDecision(stateRoot, decision);
		}
	}
	const finalReport = { ...report, tasksCreated };
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alert tick: ${tasksCreated.length} task(s) created, ${finalReport.humanEscalations.length} escalation(s).`,
		data: {
			report: finalReport,
			allowTaskCreation,
			taskCreationStatus: allowTaskCreation ? "enabled" : "disabled",
		},
		safeNotes: [
			...resolution.safeNotes,
			...finalReport.safeNotes,
			"Tick may create capped routine tasks only; it did not implement code, run AgentLabs, update dependencies, or mutate rules/skills/contracts.",
			...taskRead.safeNotes,
		],
	});
}

/**
 * idu_autonomous_alerts_control — control autonomous alert engine.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleAutonomousAlertsControl(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (!resolution.stateRoot) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"Autonomous alert control requires a registered project stateRoot.",
			data: { resolutionStatus: resolution.status },
			safeNotes: [
				...resolution.safeNotes,
				"No escribí control de alertas porque falta stateRoot registrado.",
			],
			errors: ["registered stateRoot is required"],
		});
	}
	const action = requiredText(args, "action");
	const now = new Date();
	const current = readAutonomousAlertEngineState(resolution.stateRoot, now);
	let disabledDomains = current.control.disabledDomains;
	if (action === "disable_domain") {
		disabledDomains = [
			...new Set([...disabledDomains, requiredText(args, "domain")]),
		];
	} else if (action === "enable_domain") {
		const domain = requiredText(args, "domain");
		disabledDomains = disabledDomains.filter((item) => item !== domain);
	}
	const pauseMinutes = positiveIntegerArg(args, "pauseMinutes") ?? 60;
	let pausedUntil = current.control.pausedUntil;
	if (action === "pause") {
		pausedUntil = new Date(
			now.getTime() + pauseMinutes * 60 * 1000,
		).toISOString();
	} else if (action === "resume") {
		pausedUntil = "1970-01-01T00:00:00.000Z";
	}
	let active = current.control.active;
	if (action === "enable") active = true;
	else if (action === "disable") active = false;
	if (
		action !== "enable" &&
		action !== "disable" &&
		action !== "pause" &&
		action !== "resume" &&
		action !== "disable_domain" &&
		action !== "enable_domain"
	) {
		throw new Error(
			`unsupported autonomous alerts control action: ${action}`,
		);
	}
	const state = updateAutonomousAlertControlState(
		resolution.stateRoot,
		{
			active,
			...(pausedUntil ? { pausedUntil } : {}),
			disabledDomains,
			reason: stringArg(args, "reason") ?? action,
		},
		now,
	);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alerts control updated: ${action}`,
		data: { state },
		safeNotes: [
			...resolution.safeNotes,
			"Control write is stateRoot-only; no repo files, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed.",
		],
	});
}

/**
 * idu_automaticov1_cycle — run the first autonomous advisory cycle.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleAutomaticov1Cycle(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	let selfMaintenance:
		| ReturnType<typeof buildRuntimeSelfMaintenanceReport>
		| undefined;
	const loadSelfMaintenance = () => {
		selfMaintenance ??= buildRuntimeSelfMaintenanceReport(
			runtime,
			stateRoot,
		);
		return selfMaintenance;
	};
	const request =
		"automaticov1 cyclic autonomous loop: Bibliotecario evidence/news/docs intelligence, supervisor participation, skill proposals, project structure optimization, failure detection and repair boundaries.";
	const result = await runAutomaticov1AdvisoryCycle({
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		stateRoot,
		iduActive: getIduSessionStatus(runtime.projectId).active,
		allowTaskCreation: booleanArg(args, "allowTaskCreation", false),
		allowExternalFetch: booleanArg(args, "allowExternalFetch", false),
		allowSkillDraftProposal: booleanArg(args, "allowSkillProposals", false),
		usageEvents: readIduUsageEvents(stateRoot, 500),
		loadPlan: () => {
			if (!runtime.masterPlanReview) {
				return {
					status: "draft",
					inferredObjective:
						"Master Plan no disponible; automaticov1 bloqueado para evitar autonomía sin objetivo.",
					executiveSummary:
						"Master Plan no disponible; no se ejecuta ciclo autónomo real.",
					criticalRisks: ["Master Plan no disponible"],
				};
			}
			try {
				return runtime.masterPlanReview("latest").plan as unknown as Record<
					string,
					unknown
				>;
			} catch (error) {
				return {
					status: "draft",
					inferredObjective:
						"Master Plan no disponible o ilegible; automaticov1 bloqueado para evitar drift.",
					executiveSummary: String(
						error instanceof Error ? error.message : error,
					),
					criticalRisks: ["Master Plan no disponible"],
				};
			}
		},
		loadTasks: () => loadSelfMaintenance().taskRead.tasks,
		loadTaskTree: () =>
			buildMasterPlanTaskTree(loadRuntimeAutomaticov1Plan(runtime)),
		loadExecutionReadiness: () =>
			loadRuntimeExecutionReadiness(runtime, stateRoot),
		loadSelfMaintenanceSignals: () => loadSelfMaintenance().report.signals,
		createTask: (draft) => {
			const task = runtime.createTask(
				inferTaskTemplateKind(draft.text),
				draft.text,
			);
			return { id: task.id };
		},
		buildSupervisorCronPlan: () => runtime.supervisorCronPlan(),
		buildBibliotecarioSnapshot: () => ({
			local: runtime.sourceRecommend(request),
			requiredActions: runtime.sourceRequiredActions(),
			externalRegistry: recommendExternalSources({
				projectId: runtime.projectId,
				request,
				domains: [
					"programming_structure",
					"security",
					"academic",
					"standards",
				] as ExternalSourceDomain[],
				language: "typescript",
				framework: "node",
				maxMatches: 8,
			}),
			rawContentIncluded: false,
			webFetchAllowed: false,
			contractPromotionAllowed: false,
		}),
		buildExternalIntelligenceReport: () =>
			buildExternalIntelligenceReport({ projectId: runtime.projectId }),
		createSkillDraftFromLessons: () =>
			runtime.skillDraftFromLessons({ mode: "proposal-only" }),
	});
	recordSupervisorActivityEventDeferred(stateRoot, {
		projectId: runtime.projectId,
		eventType: "supervisor_tick",
		origin: "orchestrator_requested",
		trigger: "cron_planning",
		status: result.status === "ran" ? "completed" : "skipped",
		active: getIduSessionStatus(runtime.projectId).active,
		createdTasks: result.alertScheduledTick.tasksCreated.length,
		ok: result.status === "ran",
	});
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: result.status === "ran" ? "warn" : "warn",
		severity: result.status === "ran" ? "info" : "warning",
		confidence: 0.78,
		summary: `automaticov1 cycle: ${result.status}`,
		requiresHuman: true,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: result.evidenceRefs,
		nextActions: result.nextActions,
		requiredActions: [
			...result.recoveryActions.map((action) => ({
				id: action.id,
				owner: action.owner,
				action: action.action,
				reason: action.reason,
				blocking: action.blocking,
				data: {
					tool: action.tool,
					cliCommand: action.cliCommand,
				},
			})),
			{
				id: "automaticov1-orchestrator-review",
				owner: "orchestrator",
				action: "review_cycle_report_before_changes",
				reason:
					"automaticov1 coordinates autonomous engines but must not authorize implementation, dependency updates, skill installation, contracts, or AgentLabs.",
				blocking: true,
			},
		],
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `automaticov1 cycle: ${result.status}`,
		data: {
			decisionEnvelope,
			result,
			governanceConfig: governanceConfigData(),
			workerBoundary: workerBoundaryData(),
		},
		safeNotes: [
			...resolution.safeNotes,
			...result.safeNotes,
			"MCP automaticov1 no autoriza implementación; el orquestador decide próximos cambios.",
		],
	});
}
