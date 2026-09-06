/**
 * index.ts — barrel for the master-plan cluster (C).
 *
 * PR 2 of 7 (Item 4). Move + re-export PURO. No exports in the public
 * surface (cluster C is internal-only). The internal helpers are
 * re-exported so `src/cli.ts` can keep calling them without rewriting
 * call sites.
 */

export type { ExecutionDirectorCliResult } from "./types.js";

export {
	loadAutomaticov1Plan,
	loadCliExecutionReadiness,
	safeProjectCoreStatus,
	safeProjectConstitutionStatus,
	runCliExecutionDirectorTick,
	formatExecutionDirectorTick,
	formatProposalOutbox,
	formatProposalDetail,
	runCliAutomaticov1Cycle,
	formatCliAutomaticov1Cycle,
	handleCliEventsInspectCommand,
} from "./helpers.js";

export {
	handleAutomaticov1,
	handleEvents,
	handleMasterPlanStatus,
	handleMasterPlanReview,
	handleMasterPlanApprove,
	handleMasterPlanReject,
	handleMasterPlanRedraft,
	handleExecutionDirectorTick,
	handleProposalOutbox,
	handleProposalDetail,
} from "./handlers.js";
