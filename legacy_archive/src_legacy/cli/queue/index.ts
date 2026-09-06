/**
 * index.ts — barrel for the queue cluster (I).
 *
 * PR 5 of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports all 8 helpers + 2 types from helpers.ts.
 * 6 functions are in the 20-function public surface (snapshot test
 * pins them): `dispatchTaskQueuePanelChoice`, `createCliTask`,
 * `approveStructuredTaskById`, `rejectStructuredTaskById`,
 * `completeStructuredTaskById`, `formatCliTaskResult`.
 *
 * PR 7h of 7 (Item 4). Switch decomposition.
 *
 * Re-exports the 6 case wrappers from handlers.ts (the 7 inline
 * cases for `idu-queue*` and `idu-task` move here).
 */

export {
	createCliTask,
	semanticCompactionProjectContext,
	strongestGuardRisk,
	approveStructuredTaskById,
	rejectStructuredTaskById,
	completeStructuredTaskById,
	formatCliTaskResult,
	dispatchTaskQueuePanelChoice,
} from "./helpers.js";

export type {
	TaskQueuePanelDispatchRuntime,
	TaskQueuePanelDispatchResult,
} from "./helpers.js";

export {
	handleQueueDetail,
	handleQueueClearStructured,
	handleQueueApprove,
	handleQueueReject,
	handleQueueComplete,
	handleTask,
} from "./handlers.js";