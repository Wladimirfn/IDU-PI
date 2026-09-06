/**
 * handlers.ts — master-plan cluster (C) case wrappers for the dispatch switch.
 *
 * PR 7b of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 10 cases that belong to the master-plan
 * cluster:
 *
 *   - idu-automaticov1 | automaticov1
 *   - idu-events | events
 *   - idu-master-plan-status | master-plan-status
 *   - idu-master-plan-review | master-plan-review
 *   - idu-master-plan-approve | master-plan-approve
 *   - idu-master-plan-reject | master-plan-reject
 *   - idu-master-plan-redraft | master-plan-redraft
 *   - idu-execution-director-tick | execution-director-tick
 *   - idu-proposal-outbox | proposal-outbox
 *   - idu-proposal-detail | proposal-detail
 *
 * Each wrapper takes `(runtime: CliRuntime, command?: string, rest?: string[])`
 * and contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename, since the wrapper takes `runtime`
 * as a parameter; the case body used `activeRuntime` as a closure var).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import {
	getIduSessionStatus,
} from "../../idu-session.js";
import { recordSupervisorActivityEventDeferred } from "../../supervisor-activity-events.js";
import { recordCliUsage } from "../usage.js";
import { requiredText } from "../dispatch-glue/parsers.js";
import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import {
	runCliAutomaticov1Cycle,
	formatCliAutomaticov1Cycle,
	handleCliEventsInspectCommand,
} from "./helpers.js";

export async function handleAutomaticov1(
	runtime: CliRuntime,
	command: string,
	rest: string[] = [],
): Promise<CliResult> {
	const result = await runCliAutomaticov1Cycle(runtime, rest);
	recordCliUsage(runtime, command, {
		recommendation: "warn",
		allowedToProceed: result.allowedToProceed,
		requiresHuman: true,
		ok: true,
	});
	recordSupervisorActivityEventDeferred(runtime.workspaceRoot, {
		projectId: runtime.projectId,
		eventType: "supervisor_tick",
		origin: "orchestrator_requested",
		trigger: "cron_planning",
		status: result.status === "ran" ? "completed" : "skipped",
		active: getIduSessionStatus(runtime.projectId).active,
		createdTasks: result.alertScheduledTick.tasksCreated.length,
		ok: result.status === "ran",
	});
	return ok(formatCliAutomaticov1Cycle(result));
}

export function handleEvents(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return handleCliEventsInspectCommand(runtime, rest);
}

export function handleMasterPlanStatus(runtime: CliRuntime): CliResult {
	if (
		!runtime.masterPlanStatus ||
		!runtime.formatMasterPlanStatus
	)
		return fail("Master Plan no disponible en este runtime.");
	return ok(
		runtime.formatMasterPlanStatus(
			runtime.masterPlanStatus(),
		),
	);
}

export function handleMasterPlanReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (
		!runtime.masterPlanReview ||
		!runtime.formatMasterPlanReview
	)
		return fail("Master Plan no disponible en este runtime.");
	return ok(
		runtime.formatMasterPlanReview(
			runtime.masterPlanReview(rest.join(" ").trim() || "latest"),
		),
	);
}

export function handleMasterPlanApprove(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (
		!runtime.masterPlanApprove ||
		!runtime.formatMasterPlanOperation
	)
		return fail("Master Plan no disponible en este runtime.");
	return ok(
		runtime.formatMasterPlanOperation(
			runtime.masterPlanApprove(rest.join(" ").trim() || "latest"),
		),
	);
}

export function handleMasterPlanReject(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (
		!runtime.masterPlanReject ||
		!runtime.formatMasterPlanOperation
	)
		return fail("Master Plan no disponible en este runtime.");
	const pathOrLatest = rest[0] ?? "latest";
	const reason = rest.slice(1).join(" ").trim() || undefined;
	return ok(
		runtime.formatMasterPlanOperation(
			runtime.masterPlanReject(pathOrLatest, reason),
		),
	);
}

export function handleMasterPlanRedraft(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (
		!runtime.masterPlanRedraft ||
		!runtime.formatMasterPlanOperation
	)
		return fail("Master Plan no disponible en este runtime.");
	const reasonParts = rest[0] === "latest" ? rest.slice(1) : rest;
	return ok(
		runtime.formatMasterPlanOperation(
			runtime.masterPlanRedraft(
				reasonParts.join(" ").trim() || undefined,
			),
		),
	);
}

export function handleExecutionDirectorTick(runtime: CliRuntime): CliResult {
	if (
		!runtime.executionDirectorTick ||
		!runtime.formatExecutionDirectorTick
	) {
		return fail("Execution director no disponible en este runtime.");
	}
	return ok(
		runtime.formatExecutionDirectorTick(
			runtime.executionDirectorTick(),
		),
	);
}

export function handleProposalOutbox(runtime: CliRuntime): CliResult {
	if (
		!runtime.proposalOutbox ||
		!runtime.formatProposalOutbox
	) {
		return fail("Proposal outbox no disponible en este runtime.");
	}
	return ok(
		runtime.formatProposalOutbox(runtime.proposalOutbox()),
	);
}

export function handleProposalDetail(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (
		!runtime.proposalDetail ||
		!runtime.formatProposalDetail
	) {
		return fail("Proposal outbox no disponible en este runtime.");
	}
	const id = requiredText(rest);
	return ok(
		runtime.formatProposalDetail(
			runtime.proposalDetail(id),
			id,
		),
	);
}