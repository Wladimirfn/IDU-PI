// src/mcp/bibliotecario/index.ts
//
// PR 4 (Item 4, mcp-server god-file breakup): barrel for cluster C
// (bibliotecario-prepare). Re-exports the public surface — the 5
// wrappers used by dispatchTool in mcp-server.ts.
export {
	handleBibliotecarioInit,
	handleBibliotecarioProactiveAdvisory,
	handleModelInvocationStatus,
	handlePrepare,
	handleSkillRating,
} from "./handlers.js";
