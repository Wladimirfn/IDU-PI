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
 *   - {stateRoot}/injections.jsonl (append supervisor_advisory, hygiene)
 *   - {stateRoot}/injection-telemetry.jsonl (append lifecycle events)
 *   - {stateRoot}/hygiene-sensor-last.json (last sensor snapshot)
 *   - {stateRoot}/logs/supervisor-tick.log (satisfaction line per tick)
 *   - {stateRoot}/events.jsonl (writes orchestrator_turn)
 *   - Git working directory (read; changedFiles is provided by caller)
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	runSensorImpulses,
	type SensorImpulseResult,
} from "./sensor-impulses.js";
import {
	categorizeFindings,
	type CategorizeResult,
} from "./supervisor-categorize.js";
import {
	enqueueHygieneReminder,
	enqueueObjectiveReminder,
} from "./objective-injection.js";
import { readPlanObjective } from "./plan-objective-reader.js";
import { runHygieneSensor, type SensorResult } from "./hygiene-sensor.js";
import {
	evaluateSatisfaction,
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
	/** Optional override for the repo path the sensor scans. Defaults
	 *  to `projectPath`. */
	repoPath?: string;
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

	// ===== Sub-PR B: hygiene sensor + telemetry + emission =====

	// Step 4: run the hygiene sensor against the repo. Best-effort:
	// a sensor crash must not abort the cron tick.
	let sensorResult: SensorResult | null = null;
	try {
		sensorResult = runHygieneSensor({
			stateRoot: input.stateRoot,
			repoPath: input.repoPath ?? input.projectPath,
			now: input.now,
		});
		// Snapshot the last-run result so the bridge UI / MCP can
		// introspect it later. Failures here are non-fatal.
		try {
			mkdirSync(input.stateRoot, { recursive: true });
			writeFileSync(
				join(input.stateRoot, "hygiene-sensor-last.json"),
				JSON.stringify(sensorResult, null, 2),
				"utf8",
			);
		} catch {
			// best-effort
		}
	} catch (err) {
		// best-effort: log via console; the cron wrapper can capture it
		console.error("[cron-preflight] hygiene sensor failed:", err);
	}

	// Step 5: emit a hygiene injection per finding. Each emission
	// records an "emitted" lifecycle event. Wrapped in try/catch so a
	// single failure does not poison the rest of the loop.
	if (sensorResult) {
		for (const finding of sensorResult.findings) {
			try {
				const result = enqueueHygieneReminder({
					stateRoot: input.stateRoot,
					finding,
					now: input.now,
				});
				if (result.enqueued) {
					recordLifecycleEvent({
						stateRoot: input.stateRoot,
						injectionId: result.injectionId ?? `hyg-${finding.fingerprint}`,
						phase: "emitted",
						kind: "hygiene_junk_file",
						now: input.now,
					});
				}
			} catch (err) {
				console.error("[cron-preflight] enqueueHygieneReminder failed:", err);
			}
		}
	}

	// Step 6: run the satisfaction evaluator and append a line to the
	// supervisor-tick log. This is the audit trail for the operator.
	try {
		const now = input.now ?? new Date();
		const satisfaction = evaluateSatisfaction({
			stateRoot: input.stateRoot,
			windowMs: 24 * 60 * 60 * 1000,
			now,
		});
		const logPath = join(input.stateRoot, "logs", "supervisor-tick.log");
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(
			logPath,
			`${now.toISOString()} hygiene_satisfaction emitted=${satisfaction.emitted} delivered=${satisfaction.delivered} resolved=${satisfaction.resolved} expired=${satisfaction.expired} superseded=${satisfaction.superseded}\n`,
			"utf8",
		);
	} catch (err) {
		console.error("[cron-preflight] evaluateSatisfaction failed:", err);
	}

	return {
		report: null, // postflight report is owned by the MCP/CLI caller; cron doesn't need it
		sensorImpulses,
		supervisorAdvisory,
		changedFiles: input.changedFiles,
	};
}
