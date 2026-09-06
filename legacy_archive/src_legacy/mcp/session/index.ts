// src/mcp/session/index.ts
//
// PR 3 (Item 4, mcp-server god-file breakup): barrel for the session
// cluster (B). Re-exports the public surface — the 4 wrappers used by
// the dispatchTool in mcp-server.ts.
export {
	handleActivate,
	handleDeactivate,
	handleProjectResetState,
	handleStatus,
	resolveSkillsDirPath,
} from "./handlers.js";
