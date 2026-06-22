// src/mcp/birth/index.ts
//
// PR 17 (Item 4, mcp-server god-file breakup): barrel for cluster K
// (birth). Re-exports the public surface — the 8 wrappers used by
// dispatchTool in mcp-server.ts.
export {
	handleBirthBibliotecarioDiscovery,
	handleBirthExistingScan,
	handleBirthGeneralSpec,
	handleBirthGeneralSpecDerive,
	handleBirthPrototypeMaster,
	handleBirthRepoPlan,
	handleBirthStatus,
	handleBirthValidate,
} from "./handlers.js";
