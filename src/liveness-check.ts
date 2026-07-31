/**
 * src/liveness-check.ts — pure liveness check over the supervisor tick log
 * and role-rails file.
 *
 * Three oracles map to four states (plus trigger_disabled):
 *
 *   log mtime      → did the scheduler fire?           (task liveness)
 *   last outcome   → worked, skipped, or failed?        (loop liveness)
 *   rails mtime    → was a model consulted?             (work liveness)
 *
 * States:
 *   alive             — tick ran recently, healthy
 *   dead              — scheduler hasn't fired in 3×interval
 *   error             — last tick failed (tsc, preflight, etc.)
 *   work_gap          — tick worked with changed_files>0 but rails stale >2×interval
 *   trigger_disabled  — operator opted out via supervisor-trigger.json
 *
 * The function reads files from disk but has no side effects (no writes).
 * Tests create temp files and pass the paths.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LivenessState =
	| "alive"
	| "dead"
	| "error"
	| "work_gap"
	| "trigger_disabled";

export type TickOutcome = "skip" | "worked" | "idle";

export type LivenessResult = {
	state: LivenessState;
	/** Present when state === "alive". */
	outcome?: TickOutcome;
	/** Human-readable detail (skip reason, changed_files count, etc.). */
	detail?: string;
	/** ISO timestamp of the last log write. */
	lastTickAt?: string;
	/** Minutes since last log write (dead / work_gap). */
	staleMinutes?: number;
	/** Threshold that was breached (dead / work_gap). */
	thresholdMinutes?: number;
	/** changed_files from the last worked tick (work_gap). */
	changedFiles?: number;
	/** Minutes since rails were last written (work_gap). */
	railsStaleMinutes?: number;
	/** The failing log line (error). */
	errorLine?: string;
};

export type LivenessInput = {
	/** Path to logs/supervisor-tick.log (repo root /logs/). */
	logPath: string;
	/** Path to role-rails.json (stateRoot/role-rails.json). */
	railsPath: string;
	/** Path to supervisor-trigger.json (stateRoot/supervisor-trigger.json). */
	triggerPath?: string;
	/** Tick interval in minutes (default 60, from IDU_PI_TICK_INTERVAL_MINUTES). */
	intervalMinutes?: number;
	/** Injectable for testing. */
	now?: Date;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Multiplier for the task-liveness threshold. The scheduler is declared dead
 * when the log mtime exceeds intervalMinutes × this factor.
 *
 * Verified on 48h of real log history (Jul 29-31 2026): the only gap > 60min
 * was a 5h machine-sleep gap that fired at 03:38 (overnight, invisible to
 * the operator) and self-cleared at 05:38 when the machine woke. Zero
 * operator-visible false positives.
 *
 * At 3× the threshold tolerates one missed tick (scheduler jitter) without
 * firing, and catches a genuinely dead scheduler within 3 intervals.
 */
export const DEAD_THRESHOLD_MULTIPLIER = 3;

/**
 * Multiplier for the work-liveness threshold. When the last tick had
 * changed_files > 0, the rails mtime should be fresh within 2 intervals.
 * If it's stale beyond that, something between sensor and AgentLab broke.
 */
export const WORK_GAP_THRESHOLD_MULTIPLIER = 2;

/**
 * Number of lines to read from the end of the log to classify the last
 * tick outcome. A single tick produces ~4-15 log lines, so 50 is generous.
 */
const LOG_TAIL_LINES = 50;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Check whether the supervisor pipeline is alive by reading external signals
 * (log mtime, log content, rails mtime, trigger state). No side effects.
 */
export function checkLiveness(input: LivenessInput): LivenessResult {
	const now = input.now ?? new Date();
	const interval = input.intervalMinutes ?? 60;

	// 1. Trigger opt-out: if the operator disabled the trigger, the tick's
	//    silence is expected. Report it distinctly — NOT dead. This is the
	//    "apagado a propósito ≠ apagado" distinction. Note: we cannot tell
	//    whether the disable was deliberate or drift (the blind spot the
	//    owner named); the state name is neutral about intent.
	if (input.triggerPath && existsSync(input.triggerPath)) {
		try {
			const raw = JSON.parse(
				readFileSync(input.triggerPath, "utf8"),
			) as { enabled?: boolean };
			if (raw.enabled === false) {
				return {
					state: "trigger_disabled",
					detail:
						"supervisor trigger opted out — silence is expected",
				};
			}
		} catch {
			// Corrupt trigger file — don't let it mask a real dead state.
			// Fall through to the normal checks.
		}
	}

	// 2. Task liveness: log mtime.
	if (!existsSync(input.logPath)) {
		return {
			state: "dead",
			detail: "log file not found — scheduler never ran or log deleted",
			staleMinutes: undefined,
			thresholdMinutes: interval * DEAD_THRESHOLD_MULTIPLIER,
		};
	}

	const logStat = statSync(input.logPath);
	const logAgeMin = (now.getTime() - logStat.mtimeMs) / 60_000;
	const deadThreshold = interval * DEAD_THRESHOLD_MULTIPLIER;

	if (logAgeMin > deadThreshold) {
		return {
			state: "dead",
			lastTickAt: logStat.mtime.toISOString(),
			staleMinutes: Math.round(logAgeMin),
			thresholdMinutes: deadThreshold,
			detail: `no tick in ${Math.round(logAgeMin)}min (last ${logStat.mtime.toISOString()}, expected every ${interval}min)`,
		};
	}

	// 3. Loop liveness: classify the last tick outcome from log content.
	const outcome = classifyLastOutcome(input.logPath);

	if (outcome.kind === "error") {
		return {
			state: "error",
			lastTickAt: logStat.mtime.toISOString(),
			errorLine: outcome.line,
			detail: `last tick failed — ${outcome.line}`,
		};
	}

	// 4. Work liveness: if the tick worked with changed_files > 0, check
	//    whether a model was actually consulted (rails mtime).
	if (outcome.kind === "worked" && outcome.changedFiles > 0) {
		const workGapThreshold = interval * WORK_GAP_THRESHOLD_MULTIPLIER;
		const railsAgeMin = computeRailsAge(input.railsPath, now);

		if (railsAgeMin !== null && railsAgeMin > workGapThreshold) {
			const railsStat = statSync(input.railsPath);
			return {
				state: "work_gap",
				lastTickAt: logStat.mtime.toISOString(),
				changedFiles: outcome.changedFiles,
				railsStaleMinutes: Math.round(railsAgeMin),
				thresholdMinutes: workGapThreshold,
				detail: `${outcome.changedFiles} changed files but no model consulted in ${Math.round(railsAgeMin)}min (rails stale since ${railsStat.mtime.toISOString()})`,
			};
		}
	}

	// 5. Healthy.
	const outcomeLabel: TickOutcome =
		outcome.kind === "worked"
			? outcome.changedFiles > 0
				? "worked"
				: "idle"
			: "skip";

	return {
		state: "alive",
		outcome: outcomeLabel,
		lastTickAt: logStat.mtime.toISOString(),
		detail: outcome.detail,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LastOutcome =
	| { kind: "skip"; detail: string }
	| { kind: "worked"; changedFiles: number; detail: string }
	| { kind: "error"; line: string }
	| { kind: "unknown"; detail: string };

/**
 * Read the tail of the log and classify the last tick's outcome.
 * Scans backwards from the last `trigger_opt_in` line (tick boundary).
 */
function classifyLastOutcome(logPath: string): LastOutcome {
	const content = readFileSync(logPath, "utf8");
	const lines = content.split("\n").filter((l) => l.trim().length > 0);
	const tail = lines.slice(-LOG_TAIL_LINES);

	// Find the last tick boundary (trigger_opt_in appears once per tick).
	let tickStart = -1;
	for (let i = tail.length - 1; i >= 0; i--) {
		if (tail[i].includes("trigger_opt_in:")) {
			tickStart = i;
			break;
		}
	}

	// If no boundary found, scan all tail lines for any outcome marker.
	const scanStart = tickStart >= 0 ? tickStart : 0;
	const tickLines = tail.slice(scanStart);

	// Scan the tick lines for outcome markers. Priority: error > skip > worked.
	const errorLine = tickLines.find((l) =>
		l.match(/(?:tsc_failed|automaticov1_failed|cron_preflight_failed)/),
	);
	if (errorLine) {
		const msg = errorLine.replace(
			/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:\d{2}|Z)\s*/,
			"",
		);
		return { kind: "error", line: msg };
	}

	const skipLine = tickLines.find((l) => l.includes("skipped:"));
	if (skipLine) {
		const msg = skipLine.replace(
			/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:\d{2}|Z)\s*/,
			"",
		);
		return { kind: "skip", detail: msg };
	}

	const preflightLine = tickLines.find((l) =>
		l.match(/cron_preflight_exit=(\d+)\s+changed_files=(\d+)/),
	);
	if (preflightLine) {
		const match = preflightLine.match(
			/cron_preflight_exit=(\d+)\s+changed_files=(\d+)/,
		);
		if (match) {
			const exitCode = parseInt(match[1], 10);
			const changedFiles = parseInt(match[2], 10);
			if (exitCode !== 0) {
				const msg = preflightLine.replace(
					/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:\d{2}|Z)\s*/,
					"",
				);
				return { kind: "error", line: msg };
			}
			return {
				kind: "worked",
				changedFiles,
				detail: `cron_preflight_exit=0 changed_files=${changedFiles}`,
			};
		}
	}

	return {
		kind: "unknown",
		detail: "tick ran but no outcome marker found in log tail",
	};
}

/**
 * Compute the age of role-rails.json in minutes. Returns null if the file
 * doesn't exist (no rails = no model ever consulted, but we can't compute
 * an age from a non-existent mtime).
 */
function computeRailsAge(railsPath: string, now: Date): number | null {
	if (!existsSync(railsPath)) return null;
	const stat = statSync(railsPath);
	return (now.getTime() - stat.mtimeMs) / 60_000;
}

// ---------------------------------------------------------------------------
// Formatting (CLI output)
// ---------------------------------------------------------------------------

/**
 * Format a LivenessResult as a single line for CLI/log output.
 * Names the state explicitly — never just "algo anda mal".
 */
export function formatLiveness(result: LivenessResult): string {
	switch (result.state) {
		case "alive":
			return `LIVENESS alive: last tick ${result.lastTickAt ?? "?"}, outcome=${result.outcome ?? "?"} (${result.detail ?? "ok"})`;
		case "dead":
			return `LIVENESS dead: ${result.detail ?? "no tick detected"}`;
		case "error":
			return `LIVENESS error: ${result.detail ?? result.errorLine ?? "unknown error"}`;
		case "work_gap":
			return `LIVENESS work_gap: ${result.detail ?? "changed files but no model consulted"}`;
		case "trigger_disabled":
			return `LIVENESS trigger_disabled: ${result.detail ?? "trigger opted out"}`;
	}
}
