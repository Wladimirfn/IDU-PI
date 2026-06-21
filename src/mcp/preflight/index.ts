// src/mcp/preflight/index.ts
//
// PR 8 (Item 4, mcp-server god-file breakup): barrel for cluster H
// (preflight). Re-exports the public surface — the 3 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleAdvisory,
	handlePostflight,
	handlePreflight,
} from "./handlers.js";
