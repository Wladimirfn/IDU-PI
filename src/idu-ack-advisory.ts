/**
 * idu-ack-advisory.ts — the explicit dismissal escape hatch.
 *
 * Why this exists: PR #153's audit left forward obligation #2: "hoy el
 * dismissal explícito va por ack:true en el pull; el tool dedicado de
 * dismissal sigue pendiente." This module is that tool.
 *
 * Behavior:
 *   - Calls `markInjectionAcked(stateRoot, injectionId)` (state change).
 *   - Writes a `dismissed` lifecycle event to <stateRoot>/injection-telemetry.jsonl.
 *   - Returns the result.
 *
 * Usage:
 *   - MCP: idu_ack_advisory({ injectionId, reason? })
 *   - CLI: idu-ack-advisory <injectionId> [reason...]
 *
 * Note: the inline `ack:true` flag on idu_pending_injections still works
 * (it's documented behavior). This tool is the cleaner surface for
 * explicit dismissal — the orchestrator says "I'm dismissing this
 * advisory, with reason: <why>". The audit trail is clearer.
 */

import { markInjectionAcked } from "./injection-store.js";
import { recordLifecycleEvent } from "./telemetry-lifecycle.js";

export type AckAdvisoryInput = {
	stateRoot: string;
	injectionId: string;
	reason?: string;
	now?: Date;
};

export type AckAdvisoryResult = {
	injectionId: string;
	acked: true;
	phase: "dismissed";
	reason: string;
	ts: string;
};

export function ackAdvisory(input: AckAdvisoryInput): AckAdvisoryResult {
	const reason = input.reason ?? "idu_ack_advisory";
	const now = input.now ?? new Date();

	// Mark the injection as acked (state change in injections.jsonl).
	markInjectionAcked(input.stateRoot, input.injectionId);

	// Write the `dismissed` lifecycle event.
	recordLifecycleEvent({
		stateRoot: input.stateRoot,
		injectionId: input.injectionId,
		phase: "dismissed",
		reason,
		now,
	});

	return {
		injectionId: input.injectionId,
		acked: true,
		phase: "dismissed",
		reason,
		ts: now.toISOString(),
	};
}
