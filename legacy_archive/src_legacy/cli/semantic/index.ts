/**
 * index.ts — barrel for the semantic cluster (J).
 *
 * PR 7g of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports the 6 case wrappers from handlers.ts. No internal
 * helpers — the semantic cluster is pure dispatch (calls runtime
 * methods, no async, no side-effects beyond telemetry-free runtime
 * calls).
 */

export {
	handleSemanticAuditStatus,
	handleSemanticAuditRun,
	handleSemanticCompactDraft,
	handleSemanticCompactReview,
	handleSemanticAgentTasksReview,
	handleSemanticAgentTasksCreate,
} from "./handlers.js";