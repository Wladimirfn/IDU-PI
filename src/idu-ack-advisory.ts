/**
 * idu-ack-advisory.ts — the explicit dismissal escape hatch.
 *
 * Why this exists: PR #153's audit left forward obligation #2: "hoy el
 * dismissal explícito va por ack:true en el pull; el tool dedicado de
 * dismissal sigue pendiente." This module is that tool.
 *
 * Behavior (post-#156-audit-fix, A.2-coupled):
 *   - Calls `markInjectionAcked(stateRoot, injectionId, { phase, reason })`
 *     and gets back an `AckOutcome`:
 *       - "acked"         : real transition (acked:false → true) + a
 *                            `dismissed` lifecycle event was auto-emitted
 *                            structurally inside the same call (A.2).
 *       - "already-acked" : no-op (line exists, was acked:true) — NO event
 *       - "not-found"     : no-op (no line with this id) — NO event
 *   - The phantom-dismissal guard from the #156 audit is preserved: only
 *     real transitions produce a `dismissed` event. After A.2, that guard
 *     lives INSIDE `markInjectionAcked` (conditional auto-emit on
 *     `outcome === "acked"`), so it cannot be bypassed by a caller that
 *     forgets to gate its emit on the outcome.
 *   - Returns the result with the outcome so the caller knows whether
 *     a real transition happened.
 *
 * Usage:
 *   - MCP: idu_ack_advisory({ injectionId, reason? })
 *   - CLI: idu-ack-advisory <injectionId> [reason...]
 *
 * Note: the inline `ack:true` flag on idu_pending_injections still
 * works (it's documented behavior). That gemelo path was updated in
 * A.2 to pass `phase: "dismissed"` so the auto-emit fires from the
 * central writer too.
 */

import { markInjectionAcked, type AckOutcome } from "./injection-store.js";

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

	// A.2: ack-side coupling. Pass `phase: "dismissed"` so the central
	// markInjectionAcked auto-emits the terminal event in the same atomic
	// call. The phantom-dismissal guard from the #156 audit is preserved
	// INSIDE markInjectionAcked (auto-emit only on `outcome === "acked"`),
	// so we still get the correct behavior for already-acked / not-found.
	const outcome: AckOutcome = markInjectionAcked(
		input.stateRoot,
		input.injectionId,
		{ phase: "dismissed", reason, now },
	);

	if (outcome === "acked") {
		return {
			injectionId: input.injectionId,
			acked: true,
			phase: "dismissed",
			status: "acked",
			reason,
			ts: now.toISOString(),
		};
	}

	// No transition. The auto-emit did NOT fire (phantom-dismissal guard).
	// A no-op call must not generate new noise; the audit log already shows
	// the prior dismissal (if any) from the real ack.
	return {
		injectionId: input.injectionId,
		acked: false,
		phase: "dismissed",
		status: outcome,
		reason,
		ts: now.toISOString(),
	};
}
