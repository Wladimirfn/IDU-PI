// src/mcp/master-plan/index.ts
//
// PR 18 (Item 4, mcp-server god-file breakup): barrel for cluster F
// (master-plan). Re-exports the public surface — the 9 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleContinuationProposal,
	handleMasterPlanApprove,
	handleMasterPlanCreate,
	handleMasterPlanReject,
	handleMasterPlanReview,
	handleMasterPlanStatus,
	handleNextAdvisoryAction,
	handlePlanSnapshot,
	handleTaskPackageCreate,
} from "./handlers.js";
