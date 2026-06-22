// src/mcp/semantic/index.ts
//
// PR 11 (Item 4, mcp-server god-file breakup): barrel for cluster Q
// (semantic). Re-exports the public surface — the 1 wrapper used by
// dispatchTool in mcp-server.ts.
export { handleSemanticAuditStatus } from "./handlers.js";
