// src/mcp/lifecycle/index.ts
//
// PR 2 (Item 4, mcp-server god-file breakup): barrel for the lifecycle
// cluster (A). Re-exports the public surface — the 4 wrappers used by
// the dispatch in mcp-server.ts.
export {
	handleBootstrapProject,
	handleProjectEnroll,
	handleProjectStatus,
	handleStart,
} from "./handlers.js";