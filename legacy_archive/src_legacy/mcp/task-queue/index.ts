// src/mcp/task-queue/index.ts
//
// PR 10 (Item 4, mcp-server god-file breakup): barrel for cluster P
// (task-queue). Re-exports the public surface — the 3 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleQueueComplete,
	handleQueueDetail,
	handleTask,
} from "./handlers.js";
