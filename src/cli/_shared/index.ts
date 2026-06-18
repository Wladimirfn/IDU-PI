/**
 * _shared/index.ts — cross-cluster shared helpers.
 *
 * Created as a precondition of PR 2 (Item 4, cluster C). The C cluster
 * (master-plan + automaticov1 + execution-director) depends on
 * `buildCliSelfMaintenanceReport`, which lives in cluster B (alerts).
 *
 * Without this module, the C cluster module would need a circular
 * import from `src/cli.ts` (where `buildCliSelfMaintenanceReport`
 * currently lives). The shared module breaks the cycle and keeps both
 * clusters importable as leaves.
 *
 * The function is part of the 20-function public surface (snapshot
 * test pins it). `src/cli.ts` re-exports it after importing from
 * here.
 */

import {
	filterRecentSupervisorActivityEvents,
	summarizeSupervisorActivityEvents,
} from "../../supervisor-activity-events.js";
import {
	filterRecentIduUsageEvents,
	readIduUsageEvents,
	buildIduUsageReport,
} from "../../usage-events.js";
import {
	buildAgentLabEffectivenessReport,
	readAgentLabEffectivenessEvents,
} from "../../agentlab-effectiveness-events.js";
import { buildSupervisorSelfMaintenanceAdvisory } from "../../supervisor-self-maintenance-advisory.js";
import { readSupervisorActivityEvents } from "../../supervisor-activity-events.js";
import type { CliRuntime } from "../../cli.js";
import type { StructuredTask } from "../../structured-task-queue.js";
import type { SupervisorSelfMaintenanceAdvisory } from "../../supervisor-self-maintenance-advisory.js";

// Re-imported from cli.ts (was a local const in src/cli.ts; the constant
// is small, so we hardcode the value here to avoid pulling another
// cross-cluster dep).
const SELF_MAINTENANCE_PRESSURE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Build the supervisor self-maintenance report for the current
 * runtime. Used by both cluster B (alerts) and cluster C
 * (master-plan). The function is exported from `src/cli.ts` as one
 * of the 20 public functions.
 */
export function buildCliSelfMaintenanceReport(
	runtime: CliRuntime,
	stateRoot: string,
): { tasks: StructuredTask[]; report: SupervisorSelfMaintenanceAdvisory } {
	const tasks = runtime.listTasks?.() ?? [];
	const now = new Date();
	const supervisorActivity = summarizeSupervisorActivityEvents(
		filterRecentSupervisorActivityEvents(
			readSupervisorActivityEvents(stateRoot),
			now,
			SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
		),
	);
	const usageReport = buildIduUsageReport(
		filterRecentIduUsageEvents(
			readIduUsageEvents(stateRoot),
			now,
			SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
		),
		{ now },
	);
	const agentLabEffectiveness = buildAgentLabEffectivenessReport(
		readAgentLabEffectivenessEvents(stateRoot),
	);
	let semanticNewEvents = 0;
	try {
		const semanticDelta = runtime.semanticAuditStatus().newEvents;
		semanticNewEvents =
			semanticDelta.labRuns +
			semanticDelta.findings +
			semanticDelta.proposals +
			semanticDelta.tasks +
			semanticDelta.userSignals +
			semanticDelta.memoryItems;
	} catch {
		semanticNewEvents = 0;
	}
	return {
		tasks,
		report: buildSupervisorSelfMaintenanceAdvisory({
			projectId: runtime.projectId,
			now,
			tasks,
			supervisorEvents: supervisorActivity.totalEvents,
			supervisorActivitySkipped:
				(supervisorActivity.byReason.idu_inactive ?? 0) +
				(supervisorActivity.byReason.no_new_events ?? 0) +
				(supervisorActivity.byReason.not_enough_data ?? 0),
			supervisorActivityThrottled: supervisorActivity.byReason.throttled ?? 0,
			usageFailures: usageReport.unresolvedFailures,
			usageNotAllowed: usageReport.notAllowed,
			usageRequiresHuman: usageReport.requiresHuman,
			agentLabStaleRequests: agentLabEffectiveness.staleRequests,
			semanticNewEvents,
		}),
	};
}
