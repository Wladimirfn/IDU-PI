/**
 * helpers.ts — small standalone formatters.
 *
 * Internal-only. Re-exported by `index.ts`. Used by `src/cli.ts` for
 * the `idu-pending-injections` (formatter) and the trigger-subscription
 * formatter.
 */

import type { Injection } from "../../injection-store.js";
import { TRIGGER_DEFINITIONS } from "../../trigger-engine.js";

export function formatPendingInjections(
	pending: Injection[],
	ack: boolean,
): string {
	const lines: string[] = [];
	lines.push(`Pending Injections — count=${pending.length} ack=${ack}`);
	if (pending.length > 0) {
		for (const inj of pending) {
			lines.push(
				`- ${inj.triggerId} severity=${inj.decisionEnvelope.severity} summary="${inj.decisionEnvelope.summary}"`,
			);
		}
	}
	return lines.join("\n");
}

export function formatTriggerSubscription(): string {
	const lines: string[] = [];
	lines.push(
		`Trigger Subscription — ${TRIGGER_DEFINITIONS.length} disparadores`,
	);
	for (const def of TRIGGER_DEFINITIONS) {
		lines.push(
			`  - ${def.id} severity=${def.contract.severity} decisionRequired=${def.contract.decisionRequired} kinds=[${def.kinds.join(",")}]`,
		);
	}
	return lines.join("\n");
}
