// src/mcp/supervisor-tick/index.ts
//
// PR 13 (Item 4, mcp-server god-file breakup): barrel for cluster I
// (supervisor-tick). Re-exports the public surface — the 7 wrappers
// used by dispatchTool in mcp-server.ts.
export {
	handleExecutionDirectorTick,
	handleProposalDetail,
	handleProposalOutbox,
	handleSupervisorConsult,
	handleSupervisorCronPlan,
	handleSupervisorResponses,
	handleSupervisorTick,
} from "./handlers.js";
