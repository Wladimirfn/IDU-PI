/**
 * prompt-helpers — T1.6.
 *
 * Reusable helpers for building prompts to the LLM.
 * Currently used by supervisor-main; will be reused by supervisor-semantic
 * and supervisor-compaction in PR2.
 */

import type { RoleAdvisory } from "./index.js";
import type { Event } from "../event-bus.js";

/**
 * Build a deterministic summary of recent state for the LLM prompt.
 * Includes the last 5 advisories, last alerts tick timestamp, and last lab_write timestamp.
 *
 * The output is deterministic: same inputs always produce the same output.
 */
export function buildStateSummary(
	advisories: RoleAdvisory[],
	lastAlertsTick: Event | undefined,
	lastLabWrite: Event | undefined,
): string {
	const lines: string[] = [];

	// Last 5 advisories (most recent first)
	lines.push("Recent Advisories (last 5):");
	const lastFive = advisories.slice(-5).reverse();
	for (const adv of lastFive) {
		lines.push(
			`  - [${adv.ts}] ${adv.roleId} (priority ${adv.priority}): ${adv.advisory}`,
		);
	}
	if (lastFive.length === 0) {
		lines.push("  (none)");
	}

	// Last alerts tick
	lines.push("\nLast Alerts Tick:");
	if (lastAlertsTick) {
		lines.push(`  Timestamp: ${lastAlertsTick.ts}`);
		lines.push(`  Payload: ${JSON.stringify(lastAlertsTick.payload)}`);
	} else {
		lines.push("  (none)");
	}

	// Last lab_write
	lines.push("\nLast Lab Write:");
	if (lastLabWrite) {
		lines.push(`  Timestamp: ${lastLabWrite.ts}`);
		lines.push(`  Payload: ${JSON.stringify(lastLabWrite.payload)}`);
	} else {
		lines.push("  (none)");
	}

	return lines.join("\n");
}
