/**
 * prompt-helpers — T1.6+PR-3.
 *
 * Reusable helpers for building prompts to the LLM.
 * Currently used by supervisor-main; will be reused by supervisor-semantic
 * and supervisor-compaction in PR2.
 */

import type { RoleAdvisory } from "./index.js";
import type { Event } from "../event-bus.js";
import { loadRoleProfile, type RoleProfile } from "./profile-loader.js";

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

/**
 * Load the role's profile and return a short identity string suitable
 * for the top of a system prompt: the role name, the type, the
 * default model, and the prohibitions (so the LLM is reminded of
 * the contract on every invocation). This is the shim that the
 * existing role modules use without rewriting their call sites.
 */
export function buildRoleIdentity(roleId: string): string {
	const profile: RoleProfile = loadRoleProfile(roleId);
	const prohibitions = profile.prohibitions.map((p) => `  - ${p}`).join("\n");
	return [
		`# Role: ${profile.nombre} (${profile.rolId})`,
		`type: ${profile.tipo}`,
		`default model: ${profile.modeloDefecto || "(unassigned)"}`,
		"",
		"## Prohibitions (must not violate)",
		prohibitions,
	].join("\n");
}
