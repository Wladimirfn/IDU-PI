import { appendEvent, type Event } from "./event-bus.js";

/**
 * role-events — PR-7 (extend for #425).
 *
 * Emits the event kinds that the supervisor-main and supervisor-semantic
 * role modules subscribe to plus the response and ack events that
 * #425 requires:
 *
 *   - `orchestrator_turn` is emitted at the start of every MCP tool
 *     call. The orchestrator's "I am working on something" event.
 *   - `orchestrator_turn_completed` is emitted at the end of every
 *     MCP tool call, paired with the start event via payload.followsUp.
 *     Persists the response (verdict, evidenceRefs, autonomyGateTraces).
 *     Emitted on success AND failure so start/end stay 1:1.
 *   - `tool_received` is emitted by the orchestrator (not the MCP server)
 *     when it processes the response. Carries the decision (follow,
 *     modify, ignore, ask_human) and whether the verdict was honored.
 *     The absence of this event after a complete pair is the natural
 *     state — distinct from an explicit "ignore" decision.
 *   - `alerts_scheduled_tick` is emitted by the scheduled-tick script
 *     (or by the supervisor cron on each tick).
 */

export type OrchestratorTurnInput = {
	stateRoot: string;
	projectId: string;
	toolName: string;
	source?: "mcp-server" | "manual" | "test";
	now?: Date;
};

/**
 * Outcome of an MCP tool call. Distinguishes the success path from
 * each early-return path so the audit can pair start/end events
 * even when the tool never ran.
 *   - "ok": the tool ran and returned a result.
 *   - "unregistered_project": resolution rejected args.projectPath.
 *   - "invalid_project": resolution rejected the project context.
 *   - "unknown_tool": the tool name was not registered.
 *   - "lifecycle": the tool is a project lifecycle tool (handled
 *     separately and bypasses the dispatch).
 *   - "throw": the dispatch threw before returning a result.
 *   - "no_start": the start event itself failed to emit; the end
 *     event is skipped (no start to pair with).
 */
export type OrchestratorTurnOutcome =
	| "ok"
	| "unregistered_project"
	| "invalid_project"
	| "unknown_tool"
	| "lifecycle"
	| "throw";

export type OrchestratorTurnCompletedInput = {
	stateRoot: string;
	projectId: string;
	toolName: string;
	// id of the start event (orchestrator_turn) this completed event
	// pairs with. MUST be set whenever emitOrchestratorTurnCompleted
	// is called from the dispatcher — the pair invariant is what makes
	// the audit ratio 1:1.
	startEventId: string;
	outcome: OrchestratorTurnOutcome;
	// Verdict and response data, populated when available. Even on
	// failure paths, the dispatcher should pass what it has so the
	// end event carries the same context as the start event would
	// have produced.
	ok?: boolean;
	summary?: string;
	evidenceRefs: string[];
	autonomyGateTraces?: unknown[];
	errors?: string[];
	source?: "mcp-server" | "manual" | "test";
	now?: Date;
};

/**
 * tool_received — emitted by the orchestrator when it processes the
 * end event. The MCP server NEVER emits this kind; it's the actor
 * that has to honor the verdict signing the ack.
 *
 * The audit distinguishes:
 *   - end event with no follow-up ack: "no ack" (the natural state)
 *   - end event with ack and decision: "ignore": orchestrator saw
 *     verdict and disobeyed
 *   - end event with ack and decision: "follow": respected
 *   - end event with ack and decision: "modify": changed behavior
 *   - end event with ack and decision: "ask_human": escalated
 */
export type ToolReceivedInput = {
	stateRoot: string;
	projectId: string;
	toolName: string;
	// id of the end event (orchestrator_turn_completed) this ack pairs with.
	endEventId: string;
	decision: "follow" | "modify" | "ignore" | "ask_human";
	verdictAcknowledged: boolean;
	evidenceRefs: string[];
	rationale?: string;
	source?: "orchestrator" | "manual" | "test";
	now?: Date;
};

export type AlertsScheduledTickInput = {
	stateRoot: string;
	projectId: string;
	cronExpr: string;
	source?: "cron" | "manual" | "test";
	now?: Date;
};

function makeBaseEvent(
	input: { stateRoot: string; projectId: string; source?: string; now?: Date },
	kind: Event["kind"],
	payload: Record<string, unknown>,
	evidenceRefs: string[] = [],
): Event {
	return {
		ts: (input.now ?? new Date()).toISOString(),
		kind,
		projectId: input.projectId,
		payload,
		sourceRef: input.source ?? "manual",
		evidenceRefs,
	};
}

/**
 * Emit the start event. Returns the event id so the caller can link
 * the end event via payload.followsUp. Returns undefined if the event
 * was deduplicated (already seen this process for this stateRoot).
 */
export function emitOrchestratorTurn(
	input: OrchestratorTurnInput,
): string | undefined {
	const event = makeBaseEvent(input, "orchestrator_turn", {
		toolName: input.toolName,
	});
	return appendEvent(input.stateRoot, event);
}

/**
 * Emit the end event paired with the start event. The pair invariant
 * is what makes the audit ratio 1:1 by construction — start and end
 * always come together when the start event itself succeeded.
 */
export function emitOrchestratorTurnCompleted(
	input: OrchestratorTurnCompletedInput,
): string | undefined {
	const payload: Record<string, unknown> = {
		toolName: input.toolName,
		followsUp: input.startEventId,
		outcome: input.outcome,
	};
	if (input.ok !== undefined) payload.ok = input.ok;
	if (input.summary !== undefined) payload.summary = input.summary;
	if (input.autonomyGateTraces !== undefined) {
		payload.autonomyGateTraces = input.autonomyGateTraces;
	}
	if (input.errors !== undefined) payload.errors = input.errors;
	const event = makeBaseEvent(
		input,
		"orchestrator_turn_completed",
		payload,
		input.evidenceRefs,
	);
	return appendEvent(input.stateRoot, event);
}

/**
 * Emit the ack event. Always emitted by the orchestrator (not the
 * MCP server). The audit looks for end events without a follow-up
 * ack to distinguish "no ack" from explicit "ignore".
 */
export function emitToolReceived(input: ToolReceivedInput): string | undefined {
	const payload: Record<string, unknown> = {
		toolName: input.toolName,
		followsUp: input.endEventId,
		decision: input.decision,
		verdictAcknowledged: input.verdictAcknowledged,
	};
	if (input.rationale !== undefined) payload.rationale = input.rationale;
	const event = makeBaseEvent(
		input,
		"tool_received",
		payload,
		input.evidenceRefs,
	);
	return appendEvent(input.stateRoot, event);
}

export function emitAlertsScheduledTick(input: AlertsScheduledTickInput): void {
	const event = makeBaseEvent(input, "alerts_scheduled_tick", {
		cronExpr: input.cronExpr,
	});
	appendEvent(input.stateRoot, event);
}
