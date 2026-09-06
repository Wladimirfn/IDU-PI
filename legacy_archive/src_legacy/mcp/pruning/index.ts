// src/mcp/pruning/index.ts
//
// PR 20 (Item 4, mcp-server god-file breakup): barrel for cluster
// pruning. Re-exports the public surface — the 2 wrappers used by
// dispatchTool in mcp-server.ts.
export {
	handleArchitecturalPruningPlan,
	handleContextPruningAdvisory,
} from "./handlers.js";
