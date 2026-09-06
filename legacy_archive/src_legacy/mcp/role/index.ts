// src/mcp/role/index.ts
//
// PR 6 (Item 4, mcp-server god-file breakup): barrel for cluster E
// (role-engine). Re-exports the public surface — the 2 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleRoleEngineControl,
	handleRoleEngineStatus,
} from "./handlers.js";
