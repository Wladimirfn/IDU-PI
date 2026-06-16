/**
 * cron-preflight.ts — entry point for the cron tick (PR-105a).
 *
 * Wraps the postflight → sensor → AgentLab → supervisor chain for
 * the cron path. Reuses the existing modules (runSensorImpulses,
 * categorizeFindings) so the behavior matches the MCP path.
 *
 * Differences from the MCP `idu_postflight` handler:
 *   - No taskTrace / decisionEnvelope / supervisorConsultation
 *     (those are MCP-specific orchestration artifacts).
 *   - No `--actionId` / `--taskPackageId` / `--expectedContracts`
 *     args (those are MCP task-tracking args).
 *   - Result is a simpler shape: { report, sensorImpulses, supervisorAdvisory, changedFiles }.
 *
 * State files read/written:
 *   - {stateRoot}/role-engine-config.json (read)
 *   - {stateRoot}/role-rails.json (read + write)
 *   - {stateRoot}/injections.jsonl (append supervisor_advisory)
 *   - {stateRoot}/events.jsonl (writes orchestrator_turn)
 *   - Git working directory (read; changedFiles is provided by caller)
 */

import {
	runSensorImpulses,
	type SensorImpulseResult,
} from "./sensor-impulses.js";
import {
	categorizeFindings,
	type CategorizeResult,
} from "./supervisor-categorize.js";
import type { IduModelRoleId } from "./model-assignments.js";
import type { PromptForRoleResult } from "./agent-router.js";
import type { ProjectPostflightReport } from "./project-postflight.js";

export type CronPreflightInput = {
	projectPath: string;
	stateRoot: string;
	changedFiles: readonly string[];
	promptForRole: (
		role: IduModelRoleId,
		message: string,
		options: { projectId: string; stateRoot: string },
	) => Promise<PromptForRoleResult>;
	now?: Date;
};

export type CronPreflightResult = {
	report: ProjectPostflightReport | null;
	sensorImpulses: SensorImpulseResult[];
	supervisorAdvisory: CategorizeResult | null;
	changedFiles: readonly string[];
};

/**
 * Run the postflight → sensor → AgentLab → supervisor chain from
 * the cron path. Caller is expected to provide:
 *   - `projectPath`: where the repo is on disk (for reading file
 *     content for sensor impulses)
 *   - `stateRoot`: the isolated state root for the project (for
 *     role-rails, role-engine-config, injections.jsonl)
 *   - `changedFiles`: list of files changed since last tick
 *     (the caller — typically the PS1 script or a wrapper — is
 *     responsible for detecting changes)
 *   - `promptForRole`: how to invoke role models (the cli runtime
 *     provides this)
 *
 * Returns a simplified shape (no taskTrace / decisionEnvelope /
 * supervisorConsultation). Those are MCP-only and not needed for
 * the cron path.
 */
export async function runCronPreflight(
	input: CronPreflightInput,
): Promise<CronPreflightResult> {
	// Step 1: sensor impulses
	const sensorImpulses = await runSensorImpulses({
		stateRoot: input.stateRoot,
		projectRoot: input.projectPath,
		changedFiles: input.changedFiles,
		promptForRole: input.promptForRole,
	});

	// Step 2: supervisor categorizes the findings
	const findings = sensorImpulses
		.filter((s) => s.consult.ok)
		.map((s) => ({
			match: s.match,
			ok: s.consult.ok,
			response: s.consult.response.slice(0, 500),
		}));
	const supervisorAdvisory = await categorizeFindings({
		stateRoot: input.stateRoot,
		findings,
		promptForRole: input.promptForRole,
		now: input.now,
	});

	return {
		report: null, // postflight report is owned by the MCP/CLI caller; cron doesn't need it
		sensorImpulses,
		supervisorAdvisory,
		changedFiles: input.changedFiles,
	};
}
