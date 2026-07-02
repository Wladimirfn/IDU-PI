/**
 * handlers.ts — agentlab cluster (E) case wrappers for the dispatch switch.
 *
 * PR 7c of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 9 cases that belong to the agentlab
 * cluster:
 *
 *   - idu-usage-status | usage-status
 *   - idu-lab-review-plan | lab-review-plan
 *   - idu-review | review | revisar
 *   - idu-agentlab-request-create | agentlab-request-create
 *   - idu-agentlab-request-review | agentlab-request-review
 *   - idu-agentlab-review-run | agentlab-review-run
 *   - idu-agentlab-review-status | agentlab-review-status
 *   - idu-agentlab-report-consolidate | agentlab-report-consolidate
 *   - idu-agentlab-report-consolidation-status | agentlab-report-consolidation-status
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename, since the wrapper takes
 * `runtime` as a parameter; the case body used `activeRuntime` as a
 * closure var).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import {
	flushIduUsageEvents,
	formatIduUsageSummary,
	summarizeIduUsageEvents,
	readIduUsageEvents,
} from "../../usage-events.js";
import { parseAgentLabRequestCreateArgs } from "../../cli.js";
import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import { runMasterPlanDeepReview } from "./helpers.js";

export async function handleUsageStatus(runtime: CliRuntime): Promise<CliResult> {
	await flushIduUsageEvents();
	return ok(
		formatIduUsageSummary(
			summarizeIduUsageEvents(
				readIduUsageEvents(runtime.workspaceRoot),
			),
		),
	);
}

export function handleLabReviewPlan(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const mode = rest[0] ?? "postflight";
	if (mode !== "postflight") {
		return fail(`Modo no soportado para lab-review-plan: ${mode}`);
	}
	return ok(
		runtime.formatLabReviewPlan(
			runtime.labReviewPlan("postflight"),
		),
	);
}

export async function handleReview(runtime: CliRuntime): Promise<CliResult> {
	return ok(await runMasterPlanDeepReview(runtime, "simple"));
}

export function handleAgentLabRequestCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const { source, selector, model, stateRoot } =
		parseAgentLabRequestCreateArgs(rest);
	return ok(
		runtime.formatAgentLabReviewRequestPlan(
			runtime.agentLabRequestCreate(source, selector, {
				...(model !== undefined ? { model } : {}),
				...(stateRoot !== undefined ? { stateRoot } : {}),
			}),
		),
	);
}

export function handleAgentLabRequestReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatAgentLabReviewRequestReview(
			runtime.agentLabRequestReview(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export async function handleAgentLabReviewRun(
	runtime: CliRuntime,
	rest: string[] = [],
): Promise<CliResult> {
	const result = await runtime.agentLabReviewRun(
		rest.join(" ").trim() || "latest",
	);
	// PR3 (Fix 2 — async dispatch): dispatched sentinel renders as a
	// one-liner ack with `runId` + pointer to `agentlab_review_status`.
	// Sync-blocking callers (Fix 1 tests, in-process harnesses) keep the
	// existing consolidated-summary format.
	const dispatchedMatch = /^AgentLab review run dispatched: (\S+)\s*$/u.exec(
		result.consolidatedSummary,
	);
	if (dispatchedMatch && result.runs.length === 0) {
		const runId = dispatchedMatch[1]!;
		return ok(
			`AgentLab review run dispatched: ${runId}\n` +
				`  dispatch: ${result.path ?? ""}\n` +
				`  poll with: agentlab_review_status ${runId}\n`,
		);
	}
	return ok(runtime.formatAgentLabReviewRunResult(result));
}

export function handleAgentLabReviewStatus(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatAgentLabReviewStatus(
			runtime.agentLabReviewStatus(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleAgentLabReportConsolidate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatAgentLabConsolidationResult(
			runtime.agentLabReportConsolidate(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleAgentLabReportConsolidationStatus(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatAgentLabConsolidationStatus(
			runtime.agentLabReportConsolidationStatus(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}