/**
 * plan-objective-reader.ts — small helper for the cron cadence.
 *
 * Reads the plan objective from the state root's master-plan.json.
 * Returns a stable string that the cron can use to enqueue the
 * objective-reminder injection. If the master-plan.json is missing
 * or malformed, returns a fallback string so the cron does not crash.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FALLBACK_OBJECTIVE = "<plan objective not available>";

/**
 * Read the plan objective from the state root's master-plan.json.
 * The master-plan.json is written by `idu_master_plan_create` / `approve`
 * and is the canonical source of the project's stated objective.
 *
 * Returns a stable string. Never throws.
 */
export function readPlanObjective(stateRoot: string): string {
	const filePath = join(stateRoot, "master-plan.json");
	if (!existsSync(filePath)) return FALLBACK_OBJECTIVE;
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as { objective?: unknown };
		if (typeof parsed.objective === "string" && parsed.objective.trim()) {
			return parsed.objective.trim();
		}
		return FALLBACK_OBJECTIVE;
	} catch {
		return FALLBACK_OBJECTIVE;
	}
}
