/**
 * index.ts — barrel for the agentlab cluster (E).
 *
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *
 * Only the 2 loose helpers that live outside the giant switch.
 * The case bodies (idu-agentlab-*) stay inline in cli.ts (PR 7+).
 */

export {
	runMasterPlanDeepReview,
	runOrReuseMasterPlanDeepReview,
} from "./helpers.js";