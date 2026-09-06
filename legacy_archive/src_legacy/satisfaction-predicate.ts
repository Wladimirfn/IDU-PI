/**
 * satisfaction-predicate.ts — fixed-vocabulary satisfaction predicate evaluator (#2467).
 *
 * Every advisory carries a structured predicate in its envelope that the
 * evaluator checks against the timestamped log / filesystem / state keys.
 * Outcomes: "satisfied" (predicate met), "dismissed" (explicit ack via
 * idu_ack_advisory), or "delivered-not-resolved" (past window or no satisfying event).
 *
 * Vocabulary is FIXED — three kinds. New advisory reusing an existing kind =
 * zero core change. New KIND = bounded PR (scope-creep guard).
 */

import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Fixed vocabulary (#2467)
// ---------------------------------------------------------------------------

/**
 * `tool-called`: predicate satisfied when a specific tool is called within
 * `windowMs` of the deliveredAt timestamp. The orchestrator's act of calling
 * the right tool proves it acted on the advisory.
 *
 * Use case: objective reminders satisfied by `idu_supervisor_context_pack`
 *           within 1h.
 */
export type ToolCalledPredicate = {
	kind: "tool-called";
	tool: string;
	windowMs: number;
};

/**
 * `path-absent`: predicate satisfied when the path no longer exists on disk.
 *
 * Use case: hygiene_junk_file satisfied when the orchestrator (or human)
 *           deletes the file.
 */
export type PathAbsentPredicate = {
	kind: "path-absent";
	path: string;
};

/**
 * `state-key`: predicate satisfied when a state file has a specific key
 * with the expected value. Reads the JSON file at `<stateRoot>/<key>` and
 * checks if the top-level key `expected` matches.
 *
 * Use case: future advisories that depend on a state transition.
 */
export type StateKeyPredicate = {
	kind: "state-key";
	key: string;
	expected: unknown;
};

export type SatisfactionPredicate =
	| ToolCalledPredicate
	| PathAbsentPredicate
	| StateKeyPredicate;

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type SatisfactionOutcome = "satisfied" | "dismissed" | "delivered-not-resolved";

export type SatisfactionEvaluation =
	| { outcome: "satisfied"; reason: string }
	| { outcome: "dismissed"; reason: string }
	| { outcome: "delivered-not-resolved" };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A row from the MCP usage log. The cron tick reads this from
 * `<stateRoot>/logs/mcp-usage.jsonl` (or wherever recordMcpUsage writes).
 */
export type McpUsageEntry = {
	tool: string;
	ts: string;
	args?: Record<string, unknown>;
};

/**
 * Inputs for `evaluatePredicate`. `deliveredAt` is the timestamp of the
 * `delivered` lifecycle event. `now` is the current timestamp.
 */
export type EvaluatePredicateInput = {
	predicate: SatisfactionPredicate;
	deliveredAt: string;
	now: Date;
	usageLog: McpUsageEntry[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default predicate for a given injection kind. Returns null if the kind
 * doesn't have a default (the advisory carries its own predicate in the envelope).
 */
export function defaultPredicateForKind(
	injectionKind: string,
	injectionContext?: { path?: string },
): SatisfactionPredicate | null {
	switch (injectionKind) {
		case "objective_reminder":
			// Satisfied when the orchestrator refreshes the objective
			// via idu_supervisor_context_pack within 1h.
			return {
				kind: "tool-called",
				tool: "idu_supervisor_context_pack",
				windowMs: 60 * 60 * 1000, // 1h
			};
		case "hygiene_junk_file":
			// Satisfied when the file is deleted (path absent).
			if (injectionContext?.path) {
				return {
					kind: "path-absent",
					path: injectionContext.path,
				};
			}
			return null;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a satisfaction predicate. Returns one of:
 * - "satisfied" if the predicate is met (with a reason)
 * - "dismissed" only via `idu_ack_advisory` (escape hatch) — NOT here
 * - "delivered-not-resolved" if past window and no satisfying event
 *
 * Vocabulary is fixed (3 kinds). Adding a new kind requires a code change
 * to this function (intentional friction).
 */
export function evaluatePredicate(input: EvaluatePredicateInput): SatisfactionEvaluation {
	const { predicate, deliveredAt, now, usageLog } = input;
	const deliveredMs = Date.parse(deliveredAt);
	const nowMs = now.getTime();

	if (predicate.kind === "tool-called") {
		return evaluateToolCalled({
			predicate,
			deliveredMs,
			nowMs,
			usageLog,
		});
	}

	if (predicate.kind === "path-absent") {
		return evaluatePathAbsent({
			predicate,
			nowMs,
		});
	}

	if (predicate.kind === "state-key") {
		return evaluateStateKey({
			predicate,
			stateRoot: input.predicate.kind === "state-key" ? input.predicate.key.split("/")[0] : "",
			nowMs,
		});
	}

	// Exhaustiveness — unreachable with current vocabulary
	return { outcome: "delivered-not-resolved" };
}

function evaluateToolCalled(input: {
	predicate: ToolCalledPredicate;
	deliveredMs: number;
	nowMs: number;
	usageLog: McpUsageEntry[];
}): SatisfactionEvaluation {
	const { predicate, deliveredMs, nowMs: _nowMs, usageLog } = input;
	const windowEnd = deliveredMs + predicate.windowMs;

	// Always check the log for satisfying events. Even if now is past window,
	// a call that happened WITHIN the window still satisfies. (Late ticks
	// stay correct — see #2467.)
	for (const entry of usageLog) {
		if (entry.tool !== predicate.tool) continue;
		const entryMs = Date.parse(entry.ts);
		if (entryMs >= deliveredMs && entryMs <= windowEnd) {
			return {
				outcome: "satisfied",
				reason: `tool ${predicate.tool} called at ${entry.ts}`,
			};
		}
	}

	// No satisfying event in window
	return { outcome: "delivered-not-resolved" };
}

function evaluatePathAbsent(input: {
	predicate: PathAbsentPredicate;
	nowMs: number;
}): SatisfactionEvaluation {
	const { predicate } = input;
	if (!existsSync(predicate.path)) {
		return {
			outcome: "satisfied",
			reason: `path ${predicate.path} no longer exists`,
		};
	}
	return { outcome: "delivered-not-resolved" };
}

function evaluateStateKey(_input: {
	predicate: StateKeyPredicate;
	stateRoot: string;
	nowMs: number;
}): SatisfactionEvaluation {
	// Reserved for future use. Reads <stateRoot>/<key> and checks the value.
	// Currently returns delivered-not-resolved (no implementation yet).
	return { outcome: "delivered-not-resolved" };
}