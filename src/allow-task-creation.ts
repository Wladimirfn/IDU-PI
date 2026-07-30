/**
 * allow-task-creation.ts — bypass-by-capas (rails) for
 * \`automaticov1-cycle\`.
 *
 * The original logic was a flat AND of all blocks:
 *
 *   allowTaskCreation && !systemicBlock && !taskTreeBlock && !readinessBlock
 *
 * This created a deadlock: the system detects it's broken
 * (systemicBlock=true), but because it's broken, it can't create
 * the task to fix itself.
 *
 * The user mandated: "Bypass al allowTaskCreation en automaticov1
 * va pero por capas". Three layers:
 *
 *   Layer 1 (normal): respect systemicBlock / taskTreeBlock /
 *            readinessBlock. Self-repair tasks are NOT
 *            bypassed here.
 *   Layer 2 (self-repair bypass): if the task is a self-repair
 *            task AND the role-rails have tokens available,
 *            allow the task through. Token budget is the
 *            primary control (NOT time, per user design).
 *   Layer 3 (hard cap): if the cycle has been running for more
 *            than 10 minutes (emergency cap), block everything.
 *            This is the only time-based control, and it only
 *            fires after extensive time has passed.
 *
 * Order of evaluation:
 *   1. Layer 3 wins over everything (emergency cap beats self-repair)
 *   2. Layer 2 wins over Layer 1 (self-repair bypasses normal blocks)
 *   3. Layer 1 is the default
 *
 * This module is the pure-function decision core. The actual
 * wiring (checking rail tokens, tracking emergency cap time) is
 * in automaticov1-cycle.ts which calls this function.
 */

export type AllowTaskCreationLayer = "layer1" | "layer2" | "layer3";

export type AllowTaskCreationReason =
	| "ok"
	| "user_opt_out"
	| "blocked"
	| "self_repair_bypass"
	| "no_rail_tokens"
	| "no_repairable_signal"
	| "protected_domain_floor"
	| "emergency_cap_reached";

export type AllowTaskCreationInput = {
	allowTaskCreation: boolean;
	isSelfRepairDomain: boolean;
	railTokensAvailable: boolean;
	emergencyCapReached: boolean;
	systemicBlock: boolean;
	taskTreeBlock: boolean;
	readinessBlock: boolean;
	// Layer 2 gate inputs, derived from the systemic self-maintenance
	// signals by the caller (see systemicBypassEligibility). Both are
	// OPTIONAL for backward-compat with older callers/tests, but the
	// fail-closed default below means an absent field does NOT grant
	// the bypass. Pass them explicitly to opt into the bypass.
	//   anySystemicSignalCanCreateTask: at least one systemic signal
	//     would produce a concrete create_task (a repair to queue).
	//   anySystemicSignalProtected: true when AT LEAST ONE systemic
	//     signal is in a protected domain (security / db). False means
	//     none is. Absent defaults to true, so an old caller is denied.
	anySystemicSignalCanCreateTask?: boolean;
	anySystemicSignalProtected?: boolean;
};

export type AllowTaskCreationDecision = {
	allow: boolean;
	reason: AllowTaskCreationReason;
	layer: AllowTaskCreationLayer;
};

export function decideAllowTaskCreation(
	input: AllowTaskCreationInput,
): AllowTaskCreationDecision {
	// Layer 1: user opt-out wins immediately (no bypass allowed)
	if (!input.allowTaskCreation) {
		return { allow: false, reason: "user_opt_out", layer: "layer1" };
	}

	// Layer 3: emergency cap beats everything
	if (input.emergencyCapReached) {
		return {
			allow: false,
			reason: "emergency_cap_reached",
			layer: "layer3",
		};
	}

	// Layer 2: self-repair bypass via rails (gated).
	// The bypass is NO LONGER category-blind. It fires only when the
	// systemic signals would actually queue a repair AND none of them
	// is in a protected domain. This prevents the bypass from silently
	// suppressing a hard stop for signals that map to ask_human /
	// unmapped domains (repeated_failure_patterns, hard supervisor
	// pressure) or protected domains (security, db) — those produce
	// ZERO repair tasks, so bypassing them only drops the hard stop
	// without any remediation.
	//
	// Fail-closed defaults: an absent canCreateTask is treated as
	// false and an absent protected is treated as TRUE, so an old
	// caller that does not pass these fields does NOT get the bypass.
	if (input.isSelfRepairDomain) {
		// Budget gate first: no tokens to spend → bypass unavailable,
		// regardless of signal task-ability or protection.
		if (!input.railTokensAvailable) {
			return {
				allow: false,
				reason: "no_rail_tokens",
				layer: "layer2",
			};
		}
		// Fail-closed: undefined protected defaults to true (block),
		// undefined canCreateTask defaults to false (block).
		const protectedDomainPresent =
			input.anySystemicSignalProtected !== false;
		const canCreateTask = input.anySystemicSignalCanCreateTask === true;
		// Protected-domain floor (intentionally redundant with
		// canCreateTask): a protected domain never bypasses, even if a
		// future change made its signal task-able.
		if (protectedDomainPresent) {
			return {
				allow: false,
				reason: "protected_domain_floor",
				layer: "layer2",
			};
		}
		// Task-ability gate: there is a systemic block but nothing
		// concrete to queue (signals map to ask_human / unmapped).
		if (!canCreateTask) {
			return {
				allow: false,
				reason: "no_repairable_signal",
				layer: "layer2",
			};
		}
		return {
			allow: true,
			reason: "self_repair_bypass",
			layer: "layer2",
		};
	}

	// Layer 1: normal rules
	if (input.systemicBlock || input.taskTreeBlock || input.readinessBlock) {
		return { allow: false, reason: "blocked", layer: "layer1" };
	}

	return { allow: true, reason: "ok", layer: "layer1" };
}
