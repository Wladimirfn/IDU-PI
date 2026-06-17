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
import { enqueueObjectiveReminder } from "./objective-injection.js";
import { readPlanObjective } from "./plan-objective-reader.js";
import { defaultPredicateForKind, evaluatePredicate } from "./satisfaction-predicate.js";
import {
	readMcpUsageLog,
	readPendingAdvisories,
	recordLifecycleEvent,
} from "./telemetry-lifecycle.js";
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

	// PR-B: enqueue the objective reminder on cadence. The cron is
	// the canonical source of objective reminders: every cron tick
	// re-evaluates the dedup/escalation logic and either dedups
	// (recent un-acked reminder exists), escalates (1h un-acked),
	// or enqueues fresh (past dedup or no recent).
	enqueueObjectiveReminder({
		stateRoot: input.stateRoot,
		planObjective: readPlanObjective(input.stateRoot),
		now: input.now,
	});

	// STEP 3b: satisfaction-predicate evaluator (#2467). For each pending
	// advisory (one whose latest phase is "delivered"), evaluate its
	// predicate and either write "resolved" (if satisfied) or "expired"
	// (if past the window without satisfaction). Runs in the cron tick
	// so silent-ignore is visible even if the orchestrator never pulls
	// again.
	try {
		evaluateSatisfactionPredicates({
			stateRoot: input.stateRoot,
			now: input.now ?? new Date(),
		});
	} catch (err) {
		// Telemetry is non-fatal; log + continue.
	}

return {
		report: null, // postflight report is owned by the MCP/CLI caller; cron doesn't need it
		sensorImpulses,
		supervisorAdvisory,
		changedFiles: input.changedFiles,
	};
}

/**
 * Iterate over pending advisories (last phase = delivered) and evaluate
 * each one's satisfaction predicate. Write "resolved" or "expired"
 * lifecycle events accordingly.
 */
export function evaluateSatisfactionPredicates(input: {
	stateRoot: string;
	now: Date;
	projectPath?: string;
}): void {
const pending = readPendingAdvisories(input.stateRoot);
	const usageLog = readMcpUsageLog(input.stateRoot);
	for (const advisory of pending) {
		// Get the predicate (default by kind, or read from the advisory's
		// own envelope — for now we only support the default per-kind).
		const predicate = defaultPredicateForKind(advisory.kind ?? "");
		if (!predicate) continue;
		const evaluation = evaluatePredicate({
			predicate,
			deliveredAt: advisory.ts,
			now: input.now,
			usageLog,
		});
		if (evaluation.outcome === "satisfied") {
			recordLifecycleEvent({
				stateRoot: input.stateRoot,
				injectionId: advisory.injectionId,
				phase: "resolved",
				kind: advisory.kind,
				reason: evaluation.reason,
				now: input.now,
			});
		} else if (evaluation.outcome === "delivered-not-resolved") {
			// Only mark expired if we're PAST the window. Within window
			// + no call yet = keep waiting (silent wait, no event).
			const deliveredMs = Date.parse(advisory.ts);
			const pastWindow = (() => {
				if (predicate.kind === "tool-called") {
			return input.now.getTime() > deliveredMs + predicate.windowMs;
				}
				if (predicate.kind === "path-absent") {
			// path-absent: no time window — satisfied if the file is gone
			return false;
				}
				// state-key: reserved for future
				return false;
			})();
			if (pastWindow) {
				recordLifecycleEvent({
			stateRoot: input.stateRoot,
			injectionId: advisory.injectionId,
			phase: "expired",
			kind: advisory.kind,
			reason: "window passed without satisfaction",
			now: input.now,
				});
			}
			// Within window but no call yet → silent wait. The cron tick will
			// re-evaluate on the next run. If the orchestrator never pulls
			// again, the advisory stays "delivered" until window expires.
		}
		// "dismissed" is NOT here — only the idu_ack_advisory escape hatch writes dismissed.
	}
}
