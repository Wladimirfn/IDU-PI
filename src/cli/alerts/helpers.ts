/**
 * helpers.ts — alerts cluster (B).
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 */

import { createHash } from "node:crypto";

import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";

import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertDecision,
	type AutonomousAlertEngineReport,
} from "../../autonomous-alert-engine.js";
import {
	appendAutonomousAlertDecision,
	readAutonomousAlertEngineState,
	type AutonomousAlertEngineState,
} from "../../autonomous-alert-engine-state.js";
import {
	runAutonomousAlertScheduledTick,
	type AutonomousAlertScheduledTickResult,
} from "../../autonomous-alert-scheduler.js";
import {
	classifyInterrupt,
	appendDigestQueueEntry,
	type DigestSignal,
	maybeFlushDigest,
} from "../../digest.js";
import { appendInjection, type Injection } from "../../injection-store.js";
import { ok, fail, requiredArg } from "../dispatch-glue/index.js";
import { buildCliSelfMaintenanceReport } from "../_shared/index.js";
import { inferTaskTemplateKind } from "../../task-templates.js";
import { getIduSessionStatus } from "../../idu-session.js";
import type { MasterPlanProgressEvent } from "../../master-plan.js";
import { runMcpContextPackAutoRefreshTick } from "../../mcp-context-pack-auto-refresh-invocation.js";
import { emitAlertsScheduledTick } from "../../role-events.js";
import { runTriggerEngineTickOptIn } from "../../trigger-engine-invocation.js";
import { formatScheduledTickSkippedDetail } from "../../alerts-scheduled-tick-skipped-detail.js";
import { emitStuckTaskEventsFromAlertReport } from "../../autonomous-alert-engine-event-bridge.js";
import { updateAutonomousAlertControlState } from "../../autonomous-alert-engine-state.js";

export type CliAutonomousAlertTickResult = {
	report: AutonomousAlertEngineReport;
	allowTaskCreation: boolean;
	taskCreationStatus: "enabled" | "disabled";
};

export type CliAutonomousAlertControlResult = {
	action: string;
	state: AutonomousAlertEngineState;
};

export function handleCliAlertCommand(
	runtime: CliRuntime,
	parts: string[],
): CliResult {
	const [subcommand = "status", ...rest] = parts;
	if (subcommand === "status") {
		return ok(
			formatCliAutonomousAlertReport(buildCliAutonomousAlertStatus(runtime)),
		);
	}
	if (subcommand === "tick") {
		return ok(
			formatCliAutonomousAlertReport(
				runCliAutonomousAlertTick(runtime, {
					allowTaskCreation: rest.includes("--allow-task-creation"),
				}),
			),
		);
	}
	if (subcommand === "scheduled-tick") {
		return ok(
			formatCliAutonomousAlertScheduledTick(
				runCliAutonomousAlertScheduledTick(runtime, {
					allowTaskCreation: rest.includes("--allow-task-creation"),
				}),
			),
		);
	}
	if (subcommand === "control") {
		const [action = "", ...controlRest] = rest;
		return ok(
			formatCliAutonomousAlertControl(
				runCliAutonomousAlertControl(runtime, action, controlRest),
			),
		);
	}
	return fail(
		"Uso: idu-pi alerts status|tick|scheduled-tick|control <enable|disable|pause|resume|disable-domain|enable-domain>",
	);
}

export function buildCliAutonomousAlertStatus(
	runtime: CliRuntime,
): AutonomousAlertEngineReport {
	const state = readAutonomousAlertEngineState(runtime.workspaceRoot);
	const selfMaintenance = buildCliSelfMaintenanceReport(
		runtime,
		runtime.workspaceRoot,
	);
	return buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: selfMaintenance.tasks,
		selfMaintenanceSignals: selfMaintenance.report.signals,
		allowTaskCreation: false,
		cooldowns: state.cooldowns,
	});
}

export function runCliAutonomousAlertTick(
	runtime: CliRuntime,
	options: { allowTaskCreation?: boolean } = {},
): CliAutonomousAlertTickResult {
	const stateRoot = runtime.workspaceRoot;
	const projectId = runtime.projectId;
	// Emit alerts_scheduled_tick so the role engine subscriptions
	// (supervisor-main, supervisor-semantic) receive a stimulus at
	// the start of every tick. Best-effort: a failure to append
	// the event must not block the tick.
	try {
		emitAlertsScheduledTick({
			stateRoot,
			projectId,
			cronExpr: "*/15 * * * *",
			source: "cron",
			now: new Date(),
		});
	} catch {
		// best-effort; do not block the tick
	}
	const state = readAutonomousAlertEngineState(runtime.workspaceRoot);
	const selfMaintenance = buildCliSelfMaintenanceReport(
		runtime,
		runtime.workspaceRoot,
	);
	const allowTaskCreation = options.allowTaskCreation === true;
	const report = buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: selfMaintenance.tasks,
		selfMaintenanceSignals: selfMaintenance.report.signals,
		allowTaskCreation,
		cooldowns: state.cooldowns,
	});
	const tasksCreated: AutonomousAlertEngineReport["tasksCreated"] = [];
	const taskCreationBlockedByHumanEscalation = report.humanEscalations.some(
		(decision) => ["repeated_bug", "security", "db"].includes(decision.domain),
	);
	for (const decision of report.decisions) {
		if (
			decision.recommendedAction === "create_task" &&
			decision.taskDraft &&
			allowTaskCreation &&
			!taskCreationBlockedByHumanEscalation &&
			tasksCreated.length < 3
		) {
			const task = runtime.createTask(
				inferTaskTemplateKind(decision.taskDraft.text),
				decision.taskDraft.text,
			);
			tasksCreated.push({
				taskId: task.id,
				alertId: decision.id,
				evidenceRefs: decision.evidenceRefs,
			});
			appendAutonomousAlertDecision(runtime.workspaceRoot, decision);
		} else if (
			decision.recommendedAction === "ask_human" &&
			allowTaskCreation
		) {
			appendAutonomousAlertDecision(runtime.workspaceRoot, decision);
		}
	}
	return {
		report: { ...report, tasksCreated },
		allowTaskCreation,
		taskCreationStatus: allowTaskCreation ? "enabled" : "disabled",
	};
}

export type DigestAlertRoutingResult = {
	processedCount: number;
	immediateCount: number;
	digestCount: number;
};

export function routeAlertDecisionsForDigest(input: {
	stateRoot: string;
	now: Date;
	decisions: readonly AutonomousAlertDecision[];
}): DigestAlertRoutingResult {
	let immediateCount = 0;
	let digestCount = 0;
	for (const decision of input.decisions) {
		const signal = digestSignalFromAlertDecision(decision);
		if (classifyInterrupt(signal) === "immediate") {
			appendInjection(
				input.stateRoot,
				buildAlertRouteInjection(decision, signal, input.now, "immediate"),
			);
			immediateCount += 1;
			continue;
		}
		appendDigestQueueEntry(input.stateRoot, signal);
		appendInjection(
			input.stateRoot,
			buildAlertRouteInjection(decision, signal, input.now, "digest"),
		);
		digestCount += 1;
	}
	return {
		processedCount: input.decisions.length,
		immediateCount,
		digestCount,
	};
}

export function digestSignalFromAlertDecision(
	decision: AutonomousAlertDecision,
): DigestSignal {
	const truth = decision.uncomfortableTruths[0];
	return {
		id: decision.id,
		kind: "autonomous_alert",
		domain: decision.domain,
		severity: decision.severity,
		riskLevel: decision.severity === "high" ? "high" : undefined,
		guardRisk: decision.taskDraft?.guardRisk,
		summary: truth?.claim ?? `${decision.domain} alert decision`,
		requiredAction: truth?.requiredNext ?? decision.recommendedAction,
		recommendedAction: decision.recommendedAction,
		evidenceRefs: decision.evidenceRefs,
		generatedAt: decision.generatedAt,
	};
}

export function buildAlertRouteInjection(
	decision: AutonomousAlertDecision,
	signal: DigestSignal,
	now: Date,
	route: "immediate" | "digest",
): Injection {
	const triggerId =
		route === "immediate"
			? "autonomous_alert_immediate"
			: "autonomous_alert_digest_queued";
	const ts = now.toISOString();
	const evidenceRefs = [...new Set(signal.evidenceRefs ?? [])];
	return {
		ts,
		triggerId,
		decisionEnvelope: {
			severity:
				route === "immediate"
					? decision.severity === "high"
						? "critical"
						: "warning"
					: "info",
			summary: `${route === "immediate" ? "Immediate alert" : "Digest-queued alert"}: ${signal.summary ?? decision.id}`,
			options:
				route === "immediate"
					? [
							"Review alert before continuing",
							signal.requiredAction ?? "Review required",
						]
					: ["Queued for scheduled digest", "No immediate interrupt required"],
			evidenceRefs,
			orchestratorDecisionRequired:
				route === "immediate" &&
				(decision.requiresHuman || decision.recommendedAction === "ask_human"),
		},
		injectionId: createHash("sha1")
			.update(
				JSON.stringify({
					triggerId,
					ts,
					decisionId: decision.id,
					route,
				}),
			)
			.digest("hex"),
		acked: false,
	};
}

export function runCliAutonomousAlertScheduledTick(
	runtime: CliRuntime,
	options: { allowTaskCreation?: boolean } = {},
): AutonomousAlertScheduledTickResult {
	let selfMaintenance:
		| ReturnType<typeof buildCliSelfMaintenanceReport>
		| undefined;
	const loadSelfMaintenance = () => {
		selfMaintenance ??= buildCliSelfMaintenanceReport(
			runtime,
			runtime.workspaceRoot,
		);
		return selfMaintenance;
	};
	const now = new Date();
	const alertTickResult = runAutonomousAlertScheduledTick({
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		stateRoot: runtime.workspaceRoot,
		iduActive: getIduSessionStatus(runtime.projectId).active,
		now,
		allowTaskCreation: options.allowTaskCreation === true,
		loadPlan: () => {
			if (!runtime.masterPlanReview) {
				return {
					status: "draft",
					inferredObjective:
						"Master Plan no disponible en este runtime; scheduled tick bloqueado para evitar desorientación del objetivo Idu-pi.",
					executiveSummary:
						"Master Plan no disponible; no se crean tareas autónomas.",
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
						"Master Plan no disponible o ilegible; scheduled tick bloqueado para evitar desorientación del objetivo Idu-pi.",
					executiveSummary: String(
						error instanceof Error ? error.message : error,
					),
					criticalRisks: ["Master Plan no disponible"],
				};
			}
		},
		loadTasks: () => loadSelfMaintenance().tasks,
		loadSelfMaintenanceSignals: () => loadSelfMaintenance().report.signals,
		createTask: (draft) => {
			const task = runtime.createTask(
				inferTaskTemplateKind(draft.text),
				draft.text,
			);
			return { id: task.id };
		},
	});
	if (alertTickResult.report) {
		emitStuckTaskEventsFromAlertReport({
			stateRoot: runtime.workspaceRoot,
			projectId: runtime.projectId,
			now,
			report: alertTickResult.report,
		});
		const digestRouting = routeAlertDecisionsForDigest({
			stateRoot: runtime.workspaceRoot,
			now,
			decisions: alertTickResult.report.decisions,
		});
		(
			alertTickResult as unknown as { digestRouting?: DigestAlertRoutingResult }
		).digestRouting = digestRouting;
	}
	// Trigger engine integration: opt-in via IDU_PI_TRIGGER_ENGINE=1
	runTriggerEngineTickOptIn({
		stateRoot: runtime.workspaceRoot,
		projectId: runtime.projectId,
		isProjectActive: () => getIduSessionStatus(runtime.projectId).active,
	});
	const digestFlush = maybeFlushDigest({
		stateRoot: runtime.workspaceRoot,
		now,
		notify: runtime.digestNotify,
	});
	(alertTickResult as unknown as { digestFlush?: unknown }).digestFlush =
		digestFlush;
	// MCP context pack auto-refresh: if staleness != fresh and we are ready,
	// emit a regeneration event and write a fresh pack snapshot.
	const mcpContextPackAutoRefresh = runMcpContextPackAutoRefreshTick({
		stateRoot: runtime.workspaceRoot,
		projectId: runtime.projectId,
		iduActive: getIduSessionStatus(runtime.projectId).active,
		now,
	});
	(
		alertTickResult as unknown as { mcpContextPackAutoRefresh?: unknown }
	).mcpContextPackAutoRefresh = mcpContextPackAutoRefresh;
	(alertTickResult as unknown as { _stateRoot?: string })._stateRoot =
		runtime.workspaceRoot;
	return alertTickResult;
}

export function runCliAutonomousAlertControl(
	runtime: CliRuntime,
	action: string,
	parts: string[],
): CliAutonomousAlertControlResult {
	const current = readAutonomousAlertEngineState(runtime.workspaceRoot);
	const now = new Date();
	let disabledDomains = current.control.disabledDomains;
	if (action === "disable-domain") {
		disabledDomains = [
			...new Set([...disabledDomains, requiredArg(parts, 0, "domain")]),
		];
	}
	if (action === "enable-domain") {
		const domain = requiredArg(parts, 0, "domain");
		disabledDomains = disabledDomains.filter((item) => item !== domain);
	}
	const pauseMinutes =
		action === "pause" ? positiveIntegerText(parts[0], 60) : undefined;
	const state = updateAutonomousAlertControlState(
		runtime.workspaceRoot,
		{
			active:
				action === "enable"
					? true
					: action === "disable"
						? false
						: current.control.active,
			pausedUntil:
				action === "pause"
					? new Date(
							now.getTime() + (pauseMinutes ?? 60) * 60 * 1000,
						).toISOString()
					: action === "resume"
						? "1970-01-01T00:00:00.000Z"
						: current.control.pausedUntil,
			disabledDomains,
			reason:
				parts
					.slice(action === "pause" ? 1 : 0)
					.join(" ")
					.trim() || action,
		},
		now,
	);
	return { action, state };
}

export function formatCliAutonomousAlertReport(
	result: AutonomousAlertEngineReport | CliAutonomousAlertTickResult,
): string {
	const report = "report" in result ? result.report : result;
	const allowTaskCreation =
		"allowTaskCreation" in result ? result.allowTaskCreation : false;
	const topTruth = report.uncomfortableTruths[0];
	return [
		"Autonomous Alerts",
		"",
		`active: ${report.active}`,
		`paused: ${report.paused}`,
		`rawHonesty: ${report.rawHonesty}`,
		`Decisiones: ${report.decisions.length}`,
		`Escalaciones humanas: ${report.humanEscalations.length}`,
		`Tareas creadas: ${report.tasksCreated.length}`,
		`allowTaskCreation: ${allowTaskCreation}`,
		"",
		"Honestidad cruda:",
		topTruth?.claim ?? "Sin verdades incómodas nuevas con la evidencia actual.",
		"",
		"Nota segura:",
		"No implementé código, no ejecuté AgentLabs, no actualicé dependencias y no modifiqué reglas, skills ni contratos.",
	].join("\n");
}

export function formatCliAutonomousAlertScheduledTick(
	result: AutonomousAlertScheduledTickResult,
): string {
	const topTruth = result.report?.uncomfortableTruths[0];
	const refresh = (
		result as unknown as {
			mcpContextPackAutoRefresh?: {
				ran: boolean;
				shouldRefresh: boolean;
				reason: string;
				elapsedMs?: number;
				cooldownRemainingMs?: number;
				packPath?: string;
			};
		}
	).mcpContextPackAutoRefresh;
	const refreshLine = refresh
		? `mcpContextPackAutoRefresh: ran=${refresh.ran} shouldRefresh=${refresh.shouldRefresh} reason=${refresh.reason}${
				refresh.elapsedMs !== undefined
					? ` elapsedMs=${Math.round(refresh.elapsedMs / 60_000)}min`
					: ""
			}${
				refresh.cooldownRemainingMs !== undefined
					? ` cooldownRemainingMs=${Math.round(refresh.cooldownRemainingMs / 60_000)}min`
					: ""
			}`
		: "mcpContextPackAutoRefresh: not run";
	const skippedDetail =
		result.status === "skipped_locked" || result.status === "skipped_inactive"
			? formatScheduledTickSkippedDetail({
					stateRoot:
						(result as unknown as { _stateRoot?: string })._stateRoot ?? "",
					now: new Date(result.generatedAt),
				})
			: "";
	return [
		"Autonomous Alerts Scheduled Tick",
		"",
		`status: ${result.status}`,
		`planApproved: ${result.objective.planApproved}`,
		`planStatus: ${result.objective.planStatus}`,
		`allowTaskCreation: ${result.allowTaskCreation}`,
		`Tareas creadas: ${result.tasksCreated.length}`,
		refreshLine,
		skippedDetail,
		"",
		"Objetivo Idu-pi:",
		result.objective.objective,
		"",
		"Honestidad cruda:",
		topTruth?.claim ??
			result.objective.blockReason ??
			"Sin verdades incómodas nuevas con la evidencia actual.",
		"",
		"Nota segura:",
		[
			...result.safeNotes,
			"Telegram no es requerido para este scheduled tick; es sólo una superficie remota opcional.",
		].join(" "),
	].join("\n");
}

export function formatCliAutonomousAlertControl(
	result: CliAutonomousAlertControlResult,
): string {
	return [
		"Alert control updated",
		"",
		`action: ${result.action}`,
		`active: ${result.state.control.active}`,
		`pausedUntil: ${result.state.control.pausedUntil ?? "—"}`,
		`disabledDomains: ${result.state.control.disabledDomains.join(", ") || "—"}`,
		"",
		"Nota segura:",
		"Escritura stateRoot-only; no toqué repo, AgentLabs, dependencias, reglas, skills ni contratos.",
	].join("\n");
}

export function positiveIntegerText(
	value: string | undefined,
	fallback: number,
): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function emitIduProgress(event: MasterPlanProgressEvent): void {
	if (process.env.IDU_PI_PROGRESS !== "1") return;
	process.stderr.write(`__IDU_PROGRESS__${JSON.stringify(event)}\n`);
}

