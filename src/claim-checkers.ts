/**
 * claim-checkers.ts — registry of claim-based drift checkers.
 *
 * Each checker answers: "given the actual state under stateRoot, is
 * the claim from the approved contract still satisfied?"
 *
 *   - Returns `null` when the claim is satisfied.
 *   - Returns a non-empty `evidence` string when the claim is violated.
 *
 * To add a new checker:
 *
 *   1. Pick a stable `contractId` (kebab-case, descriptive).
 *   2. Implement the function: ({ stateRoot, claim }) => null | string.
 *   3. Register it under the same `contractId` in CLAIM_CHECKERS.
 *
 * When the user adds a contract to `master-plan.json.approvedContracts`
 * with that `contractId`, the next postflight or cron auto-refresh
 * tick will run this checker automatically.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContractClaim } from "./contract-drift.js";

export type ClaimCheckInput = {
	stateRoot: string;
	claim: ContractClaim;
};

export type ClaimCheck = (input: ClaimCheckInput) => string | null;

/**
 * data-retention — the project must declare a retention policy
 * via `retention.json` at the stateRoot. SQLite / JSON / JSONL stores
 * without an explicit retention window violate the "Datos/DB"
 * contract from the canonical plan.
 *
 * retention.json shape (minimal):
 *
 *   {
 *     "version": 1,
 *     "stores": {
 *       "events.jsonl":        { "maxAgeDays": 30, "maxLines": 10000 },
 *       "injections.jsonl":    { "maxAgeDays": 30, "maxLines": 1000 },
 *       "lab.db":              { "maxAgeDays": 90, "vacuumOnStartup": true }
 *     }
 *   }
 */
const checkDataRetention: ClaimCheck = ({ stateRoot }) => {
	const path = join(stateRoot, "retention.json");
	if (!existsSync(path)) {
		return `Missing retention.json at ${path}. SQLite/JSON/JSONL stores must declare retention, backup, and cleanup policy. Create the file with at least: {"version":1,"stores":{}}`;
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as {
			version?: unknown;
			stores?: unknown;
		};
		if (typeof parsed.version !== "number") {
			return "retention.json: missing or invalid 'version' field";
		}
		if (
			parsed.stores === undefined ||
			parsed.stores === null ||
			typeof parsed.stores !== "object"
		) {
			return "retention.json: 'stores' must be a non-empty object";
		}
		const stores = parsed.stores as Record<string, unknown>;
		const storeKeys = Object.keys(stores);
		if (storeKeys.length === 0) {
			return "retention.json: 'stores' is empty; declare at least one store with retention policy";
		}
		return null;
	} catch (error) {
		return `retention.json: parse error (${error instanceof Error ? error.message : String(error)})`;
	}
};

export const claimCheckers: Record<string, ClaimCheck> = {
	"data-retention": checkDataRetention,
};
