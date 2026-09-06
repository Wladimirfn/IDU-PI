// src/mcp/supervisor-trigger/index.ts
//
// PR 5 (Item 4, mcp-server god-file breakup): barrel for cluster D
// (supervisor-trigger). Re-exports the public surface — the 3 wrappers
// used by dispatchTool in mcp-server.ts.
export {
	handleSupervisorSelfMaintenanceAdvisory,
	handleSupervisorTrigger,
	handleTriggerEngine,
} from "./handlers.js";
