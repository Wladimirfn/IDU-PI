// src/mcp/injections/index.ts
//
// PR 16 (Item 4, mcp-server god-file breakup): barrel for cluster N
// (injections-hygiene). Re-exports the public surface — the 6 wrappers
// used by dispatchTool in mcp-server.ts.
export {
	handleAckAdvisory,
	handleHygieneMigrate,
	handleHygieneSweep,
	handleOutboxPrune,
	handlePendingInjections,
	handleSubscribeTriggers,
} from "./handlers.js";
