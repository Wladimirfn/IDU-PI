/**
 * helpers.ts — agentlab cluster (E).
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *
 * Only the 2 loose helpers that live outside the giant switch.
 * The case bodies stay inline (PR 7+ refactor).
 */

import type { CliRuntime } from "../../cli.js";
import { recordMasterPlanLabReviewDone } from "../../master-plan.js";

export async function runMasterPlanDeepReview(
	runtime: CliRuntime,
	mode: "simple" | "advanced",
	selector = "latest",
): Promise<string> {
	const plan = runtime.agentLabRequestCreate("master-plan", selector);
	if (plan.errors.length > 0)
		return runtime.formatAgentLabReviewRequestPlan(plan);
	const run = await runtime.agentLabReviewRun("latest");
	recordMasterPlanLabReviewDone({
		stateRoot: runtime.workspaceRoot,
		run,
	});
	if (mode === "simple") {
		return [
			"Revisión del supervisor",
			"",
			`Requests: ${plan.requests.length}`,
			"Deep review: ejecutado en sandbox/clone.",
			"Repo real: sin modificar.",
			"",
			runtime.formatAgentLabReviewRunResult(run),
		].join("\n");
	}
	return [
		runtime.formatAgentLabReviewRequestPlan(plan),
		"",
		"Deep review ejecutado automáticamente desde Plan Maestro:",
		"",
		runtime.formatAgentLabReviewRunResult(run),
	].join("\n");
}

export async function runOrReuseMasterPlanDeepReview(
	runtime: CliRuntime,
): Promise<string> {
	const status = runtime.agentLabReviewStatus("latest");
	if (status.valid && status.result && status.result.runs.length > 0) {
		recordMasterPlanLabReviewDone({
			stateRoot: runtime.workspaceRoot,
			run: status.result,
		});
		return [
			"Revisión del supervisor",
			"",
			"Estado: ya existe deep review vigente; no lo repetí.",
			"",
			runtime.formatAgentLabReviewStatus(status),
		].join("\n");
	}
	return runMasterPlanDeepReview(runtime, "simple");
}

