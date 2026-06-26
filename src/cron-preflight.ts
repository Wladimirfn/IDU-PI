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
import { markInjectionAcked } from "./injection-store.js";
import { runHygieneSensor } from "./hygiene-sensor.js";
import {
	DEFAULT_HYGIENE_CAP,
	emitHygieneInjections,
} from "./hygiene-injection.js";
import { readPlanObjective } from "./plan-objective-reader.js";
import {
	defaultPredicateForKind,
	evaluatePredicate,
} from "./satisfaction-predicate.js";
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
	/**
	 * Cap on the number of `hygiene_junk_file` injections alive at any
	 * time. Default 20. See hygiene-injection.ts for the algorithm.
	 */
	hygieneCap?: number;
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
	const reminderResult = enqueueObjectiveReminder({
		stateRoot: input.stateRoot,
		planObjective: readPlanObjective(input.stateRoot),
		now: input.now,
	});
	// A.1: telemetry is wired automatically inside the central
	// `appendInjection` writer — every injection creation emits
	// `emitted` structurally, so this cron preflight does NOT need
	// (and MUST NOT) call `recordInjectionEmitted` manually.
	void reminderResult;

	// STEP 3a: hygiene emission (forward obligation #1 from PR #153 audit).
	// Run the hygiene sensor against the project's repo and emit
	// `hygiene_junk_file` injections with dedup + cap. The invariant
	// (every hygiene injection has its emitted event) is guaranteed by
	// the hygiene-injection module.
	try {
		const sensorOutput = runHygieneSensor({
			stateRoot: input.stateRoot,
			repoPath: input.projectPath,
		});
		emitHygieneInjections({
			stateRoot: input.stateRoot,
			findings: sensorOutput.findings.map((f) => ({
				path: f.path,
				pattern: f.pattern,
			})),
			cap: input.hygieneCap ?? DEFAULT_HYGIENE_CAP,
			now: input.now,
		});
	} catch (err) {
		// Non-fatal: telemetry / injection write is best-effort.
	}

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
 * Escalation policy per advisory kind. Determines whether `expired`
 * also calls `markInjectionAcked`. The default is no-ack (forced-pull
 * semantics: Item 5's universal escalation handles surfacing the
 * ignored advisory). Hygiene advisories are advisory-only and ack on
 * expired.
 */
export function expiredAckPolicy(
	kind: string,
): "ack-on-expired" | "no-ack-on-expired" {
	switch (kind) {
		case "hygiene_junk_file":
			// Hygiene advisories are advisory-only — they don't have
			// forced-pull semantics. Ack-on-expired is the right policy.
			return "ack-on-expired";
		case "supervisor_advisory":
			// F-W2-2: supervisor_advisory is also advisory-only.
			// It's surfaced via idu_pending_injections pull, but
			// there's no forced-pull semantics (no universal escalation
			// hooks for it). Ack-on-expired prevents the leak that
			// happened when the kind had no predicate at all (the
			// pre-fix `if (!predicate) continue;` skip looped forever).
			return "ack-on-expired";
		default:
			// Default: forced-pull (e.g. objective_reminder). Item 5's
			// universal escalation handles the surfacing of ignored
			// advisories. ack-on-expired here would defeat it (sees
			// acked=true, doesn't escalate).
			return "no-ack-on-expired";
	}
}

/**
 * Default-expiry window for kinds whose `defaultPredicateForKind` returns
 * null (no built-in satisfaction predicate). After the window passes
 * past the deliveredAt, the cron evaluator marks the advisory `expired`
 * and applies `expiredAckPolicy` to decide whether to ack.
 *
 * Pre-fix (F-W2-2): such kinds were silently skipped via
 * `if (!predicate) continue;` and accumulated as pending forever.
 * 24h is the default: long enough for the orchestrator to see + ack
 * via `idu_ack_advisory`, short enough to bound pending-list growth.
 */
export const DEFAULT_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Iterate over pending advisories (last phase = delivered) and evaluate
 * each one's satisfaction predicate. Write "resolved" or "expired"
 * lifecycle events. Mark acked on `resolved` (orchestrator complied
 * — clear the PISO gate). Mark acked on `expired` ONLY for kinds with
 * `expiredAckPolicy === "ack-on-expired"` (currently: hygiene). For
 * forced-pull kinds (e.g. objective_reminder), do NOT mark acked on
 * expired — let Item 5's universal escalation continue.
 */
export function evaluateSatisfactionPredicates(input: {
	stateRoot: string;
	now: Date;
	projectPath?: string;
}): void {
	const pending = readPendingAdvisories(input.stateRoot);
	const usageLog = readMcpUsageLog(input.stateRoot);
	for (const advisory of pending) {
		// Get the predicate (default by kind). The hygiene emission
		// path writes the path into the lifecycle event so the
		// `path-absent` predicate can be constructed without
		// re-discovering the file.
		const predicate = defaultPredicateForKind(
			advisory.kind ?? "",
			advisory.path ? { path: advisory.path } : undefined,
		);
		// F-W2-2: kinds without a built-in predicate (e.g. supervisor_advisory)
		// used to be silently skipped here, accumulating as pending forever.
		// Apply the default-expiry window so they still resolve out of pending
		// (via `expired` + per-kind ack policy).
		if (!predicate) {
			const deliveredMs = Date.parse(advisory.ts);
			const pastDefaultWindow =
				input.now.getTime() > deliveredMs + DEFAULT_EXPIRY_WINDOW_MS;
			if (pastDefaultWindow) {
				recordLifecycleEvent({
					stateRoot: input.stateRoot,
					injectionId: advisory.injectionId,
					phase: "expired",
					kind: advisory.kind,
					reason: "default-expiry window passed (no predicate for kind)",
					now: input.now,
				});
				const policy = expiredAckPolicy(advisory.kind ?? "");
				if (policy === "ack-on-expired") {
					try {
						markInjectionAcked(input.stateRoot, advisory.injectionId);
					} catch {
						// Non-fatal
					}
				}
			}
			// Within default-expiry window: silent wait (same as the
			// tool-called path's "within window, no call yet" case).
			continue;
		}
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
			// Always ack on resolved — the orchestrator complied. Clear
			// the PISO gate so the advisory stops blocking.
			try {
				markInjectionAcked(input.stateRoot, advisory.injectionId);
			} catch {
				// Non-fatal: injection may have been ack'd elsewhere
			}
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
				// Per-kind policy on expired → ack. forced-pull (default):
				// NO ack (let Item 5 escalate). hygiene: ack (advisory-only).
				const policy = expiredAckPolicy(advisory.kind ?? "");
				if (policy === "ack-on-expired") {
					try {
						markInjectionAcked(input.stateRoot, advisory.injectionId);
					} catch {
						// Non-fatal
					}
				}
			}
			// Within window but no call yet → silent wait. The cron tick will
			// re-evaluate on the next run. If the orchestrator never pulls
			// again, the advisory stays "delivered" until window expires.
		}
		// "dismissed" is NOT here — only the idu_ack_advisory escape hatch writes dismissed.
	}
}
