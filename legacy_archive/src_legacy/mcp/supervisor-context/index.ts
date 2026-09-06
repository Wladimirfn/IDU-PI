// src/mcp/supervisor-context/index.ts
//
// PR 7 (Item 4, mcp-server god-file breakup): barrel for cluster G
// (supervisor-context). Re-exports the public surface — the 3 wrappers
// used by dispatchTool in mcp-server.ts.
export {
	handleOrchestratorProcedure,
	handleSupervisorContextPack,
	handleTaskContext,
} from "./handlers.js";
