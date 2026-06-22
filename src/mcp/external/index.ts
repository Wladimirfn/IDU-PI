// src/mcp/external/index.ts
//
// PR 9 (Item 4, mcp-server god-file breakup): barrel for cluster O
// (external). Re-exports the public surface — the 2 wrappers used by
// dispatchTool in mcp-server.ts.
export {
	handleExternalIntelligenceReport,
	handleExternalSourceRecommend,
} from "./handlers.js";
