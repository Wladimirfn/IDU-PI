// src/mcp/objective/index.ts
//
// PR 14 (Item 4, mcp-server god-file breakup): barrel for cluster J
// (objective-alerts). Re-exports the public surface — the 5 wrappers
// used by dispatchTool in mcp-server.ts.
export {
	handleAutonomousAlertsControl,
	handleAutonomousAlertsStatus,
	handleAutonomousAlertsTick,
	handleAutomaticov1Cycle,
	handleObjectiveStatus,
} from "./handlers.js";
