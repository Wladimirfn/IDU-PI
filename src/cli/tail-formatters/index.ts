/**
 * index.ts — barrel for the tail-formatters cluster (P).
 *
 * PR 3 of 7 (Item 4). Move + re-export PURO. Internal-only (no public
 * surface exports). The internal helpers are re-exported so `src/cli.ts`
 * can keep calling them without rewriting call sites.
 */

export {
	formatPendingInjections,
	formatTriggerSubscription,
} from "./helpers.js";
