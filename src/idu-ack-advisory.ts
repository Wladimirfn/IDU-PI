/**
 * idu-ack-advisory.ts — the explicit dismissal escape hatch.
 *
 * Why this exists: PR #153's audit left forward obligation #2: "hoy el
 * dismissal explícito va por ack:true en el pull; el tool dedicado de
 * dismissal sigue pendiente." This module is that tool.
 *
 * Behavior (post-#156-audit-fix):
 *   - Calls `markInjectionAcked(stateRoot, injectionId)` and gets back
 *     an `AckOutcome`:
 *       - "acked"         : real transition (acked:false → true)
 *       - "already-acked" : no-op (line exists, was acked:true)
 *       - "not-found"     : no-op (no line with this id)
 *   - Only writes the `dismissed` lifecycle event when the outcome is
 *     "acked" — the other two cases are no-ops and must NOT generate
 *     lifecycle noise.
 *   - Returns the result with the outcome so the caller knows whether
 *     a real transition happened.
 *
 * The "only write lifecycle event on real transition" rule is the key
 * fix from the #156 audit. The prior implementation always wrote a
 * `dismissed` event regardless of the markInjectionAcked result,
 * which meant a routine `idu-ack-advisory` against a ghost-id
 * ("not-found") or an already-acked injection would still emit a
 * `dismissed` event with the same injectionId. That's a phantom
 * dismissal — the audit log shows a `dismissed` event for an
 * injection that never transitioned.
 *
 * Usage:
 *   - MCP: idu_ack_advisory({ injectionId, reason? })
 *   - CLI: idu-ack-advisory <injectionId> [reason...]
 *
 * Note: the inline `ack:true` flag on idu_pending_injections still
 * works (it's documented behavior). That gemelo path was fixed in
 * the same audit to apply the same guard.
 */

import { markInjectionAcked, type AckOutcome } from "./injection-store.js";
import { recordLifecycleEvent } from "./telemetry-lifecycle.js";

export type AckAdvisoryInput = {
	stateRoot: string;
	injectionId: string;
	reason?: string;
	now?: Date;
};

export type AckAdvisoryResult =
	| {
			injectionId: string;
			acked: true;
			phase: "dismissed";
			status: "acked";
			reason: string;
			ts: string;
	  }
	| {
			injectionId: string;
			acked: false;
			phase: "dismissed";
			status: "already-acked" | "not-found";
			reason: string;
			ts: string;
	  };

export function ackAdvisory(input: AckAdvisoryInput): AckAdvisoryResult {
	const reason = input.reason ?? "idu_ack_advisory";
	const now = input.now ?? new Date();

	// Mark the injection as acked (state change in injections.jsonl).
	// Get the outcome so we can decide whether to write the lifecycle
	// event. The fix from the #156 audit: only write the `dismissed`
	// event when the outcome is "acked" — phantom dismissals are gone.
	const outcome: AckOutcome = markInjectionAcked(input.stateRoot, input.injectionId);

	if (outcome === "acked") {
		// Real transition. Write the `dismissed` lifecycle event.
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
			status: "acked",
			reason,
			ts: now.toISOString(),
		};
	}

	// No transition. Do NOT write a lifecycle event. The audit log
	// already shows the prior dismissal (if any) from the real ack.
	// A no-op call must not generate new noise.
	return {
		injectionId: input.injectionId,
		acked: false,
		phase: "dismissed",
		status: outcome,
		reason,
		ts: now.toISOString(),
	};
}
