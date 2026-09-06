// src/mcp/supervisor-trigger/handlers.ts
//
// PR 5 (Item 4, mcp-server god-file breakup): cluster D (supervisor-trigger)
// wrappers for the dispatchTool switch.
//
// 3 wrappers, one per case group (single label, no fall-through):
//   - handleSupervisorTrigger             (idu_supervisor_trigger)
//   - handleTriggerEngine                (idu_trigger_engine)
//   - handleSupervisorSelfMaintenanceAdvisory (idu_supervisor_self_maintenance_advisory)
//
// Note: cluster D is SPLIT — the first 2 cases are consecutive
// (L1932-L2078) but the 3rd (idu_supervisor_self_maintenance_advisory)
// lives at L3559, separated by ~1500 lines. Both regions are spliced
// independently. The 2 pruning cases (idu_architectural_pruning_plan,
// idu_context_pruning_advisory) are deferred to a future cluster.
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
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	activeMcpProjectId,
	buildRuntimeSelfMaintenanceReport,
	invalidMcpInput,
	supervisorTriggerActionArg,
	workerBoundaryData,
} from "../../mcp-server.js";
import {
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
	formatSupervisorTriggerStatus,
	getSupervisorTriggerStatus,
} from "../../supervisor-trigger.js";
import {
	disableTriggerEngineConfig,
	enableTriggerEngineConfig,
	formatTriggerEngineConfigResult,
	formatTriggerEngineConfigStatus,
	getTriggerEngineConfigStatus,
} from "../../trigger-engine-config.js";
import { envelope } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_supervisor_trigger — enable/disable/query the supervisor trigger.
 * Body verbatim from src/mcp-server.ts L1932-L2001.
 */
export async function handleSupervisorTrigger(
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
	const action = supervisorTriggerActionArg(args);
	if (!action) {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"action must be one of: enable, disable, status",
		);
	}
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	if (action === "enable") {
		const result = enableSupervisorTrigger(stateRoot, { source: "cli" });
		return envelope({
			stateRoot,

			ok: true,
			tool: name,
			projectId,
			projectPath: runtime.projectPath,
			summary: "Supervisor trigger enabled.",
			data: {
				action,
				result,
				output: formatSupervisorTriggerResult(result),
			},
			safeNotes: resolution.safeNotes,
		});
	}
	if (action === "disable") {
		const result = disableSupervisorTrigger(stateRoot, { source: "cli" });
		return envelope({
			stateRoot,

			ok: true,
			tool: name,
			projectId,
			projectPath: runtime.projectPath,
			summary: "Supervisor trigger disabled.",
			data: {
				action,
				result,
				output: formatSupervisorTriggerResult(result),
			},
			safeNotes: resolution.safeNotes,
		});
	}
	const status = getSupervisorTriggerStatus(stateRoot);
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Supervisor trigger is ${status.enabled ? "enabled" : "disabled"}.`,
		data: { action, status, output: formatSupervisorTriggerStatus(status) },
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_trigger_engine — enable/disable/query the trigger engine config.
 * Body verbatim from src/mcp-server.ts L2002-L2078.
 */
export async function handleTriggerEngine(
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
	const action = supervisorTriggerActionArg(args);
	if (!action) {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"action must be one of: enable, disable, status",
		);
	}
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	if (action === "enable") {
		const result = enableTriggerEngineConfig(stateRoot, { source: "cli" });
		return envelope({
			stateRoot,

			ok: true,
			tool: name,
			projectId,
			projectPath: runtime.projectPath,
			summary: "Trigger engine enabled.",
			data: {
				action,
				result,
				output: formatTriggerEngineConfigResult(result),
			},
			safeNotes: resolution.safeNotes,
		});
	}
	if (action === "disable") {
		const result = disableTriggerEngineConfig(stateRoot, { source: "cli" });
		return envelope({
			stateRoot,

			ok: true,
			tool: name,
			projectId,
			projectPath: runtime.projectPath,
			summary: "Trigger engine disabled.",
			data: {
				action,
				result,
				output: formatTriggerEngineConfigResult(result),
			},
			safeNotes: resolution.safeNotes,
		});
	}
	const status = getTriggerEngineConfigStatus(stateRoot);
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Trigger engine is ${status.enabled ? "enabled" : "disabled"}.`,
		data: {
			action,
			status,
			output: formatTriggerEngineConfigStatus(status),
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_supervisor_self_maintenance_advisory — supervisor self-maintenance
 * advisory signals report. Body verbatim from src/mcp-server.ts L3559-L3617.
 */
export async function handleSupervisorSelfMaintenanceAdvisory(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const selfMaintenance = buildRuntimeSelfMaintenanceReport(
		runtime,
		stateRoot,
	);
	const taskRead = selfMaintenance.taskRead;
	const report = selfMaintenance.report;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: report.signals.length ? "warn" : "allow",
		severity: report.signals.some((signal) => signal.severity === "high")
			? "warning"
			: "info",
		confidence: report.signals.length ? 0.8 : 0.7,
		summary: `Supervisor self-maintenance advisory signals: ${report.signals.length}`,
		requiresHuman: false,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: report.signals.map((signal) => signal.id),
		nextActions: report.recommendedActions,
		requiredActions: report.signals.length
			? [
					{
						id: "supervisor-self-maintenance-orchestrator-review",
						owner: "orchestrator",
						action: "review_self_maintenance_advisory_before_changes",
						reason:
							"Self-maintenance signals are advisory and must not trigger automatic writes, task creation, AgentLabs, rules, or skill changes.",
						blocking: true,
					},
				]
			: [],
	});
	const safeNotes = [
		...resolution.safeNotes,
		...report.safeNotes,
		"No creé tareas, no modifiqué reglas, no modifiqué skills y no toqué AgentLabs.",
		...taskRead.safeNotes,
	];
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Supervisor self-maintenance advisory signals: ${report.signals.length}`,
		data: {
			decisionEnvelope,
			report,
			signals: report.signals,
			structuredTaskInputStatus: taskRead.status,
			governanceConfig: runtime.governanceConfig,
			workerBoundary: workerBoundaryData(),
		},
		safeNotes,
	});
}
