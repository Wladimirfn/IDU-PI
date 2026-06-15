import { appendEvent, type Event } from "./event-bus.js";

/**
 * role-events — PR-7.
 *
 * Emits the event kinds that the supervisor-main and
 * supervisor-semantic role modules subscribe to but which had no
 * emitter until this PR. Before this PR, those subscriptions were
 * dead — the role-engine saw the kinds in the registry but nothing
 * ever produced them. Now:
 *
 *   - `orchestrator_turn` is emitted at the start of every MCP tool
 *     call. The orchestrator's "I am working on something" event.
 *   - `alerts_scheduled_tick` is emitted by the scheduled-tick
 *     script (or by the supervisor cron on each tick). The "the
 *     periodic check ran" event.
 *
 * Both events include a `ts` timestamp, a `kind`, a `source`
 * (`server`, `cron`, `manual`), and a small payload with the
 * `toolName` or `cronExpr` for context.
 */

export type OrchestratorTurnInput = {
	stateRoot: string;
	projectId: string;
	toolName: string;
	source?: "mcp-server" | "manual" | "test";
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
): Event {
	return {
		ts: (input.now ?? new Date()).toISOString(),
		kind,
		projectId: input.projectId,
		payload,
		sourceRef: input.source ?? "manual",
		evidenceRefs: [],
	};
}

export function emitOrchestratorTurn(input: OrchestratorTurnInput): void {
	const event = makeBaseEvent(input, "orchestrator_turn", {
		toolName: input.toolName,
	});
	appendEvent(input.stateRoot, event);
}

export function emitAlertsScheduledTick(input: AlertsScheduledTickInput): void {
	const event = makeBaseEvent(input, "alerts_scheduled_tick", {
		cronExpr: input.cronExpr,
	});
	appendEvent(input.stateRoot, event);
}
