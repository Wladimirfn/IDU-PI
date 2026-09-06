// src/mcp/agentlab/index.ts
//
// PR 12 (Item 4, mcp-server god-file breakup): barrel for cluster S
// (agentlab). Re-exports the public surface — the 3 wrappers used by
// dispatchTool in mcp-server.ts.
export {
	handleAgentLabRequestCreate,
	handleAgentLabReviewRun,
	handleAgentLabReviewStatus,
} from "./handlers.js";
