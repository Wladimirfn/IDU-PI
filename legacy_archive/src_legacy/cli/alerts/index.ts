/**
 * index.ts — barrel for the alerts cluster (B).
 *
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports all 13 helper functions + 3 types from helpers.ts.
 * `routeAlertDecisionsForDigest` is in the public surface (snapshot test
 * pins it); all other exports are internal-only.
 *
 * PR 7i of 7 (Item 4). Switch decomposition.
 *
 * Re-exports the 4 case wrappers from handlers.ts. The 4 inline cases
 * for `idu-alerts*` and `alerts` move here.
 */

export {
	handleCliAlertCommand,
	buildCliAutonomousAlertStatus,
	runCliAutonomousAlertTick,
	routeAlertDecisionsForDigest,
	digestSignalFromAlertDecision,
	buildAlertRouteInjection,
	runCliAutonomousAlertScheduledTick,
	runCliAutonomousAlertControl,
	formatCliAutonomousAlertReport,
	formatCliAutonomousAlertScheduledTick,
	formatCliAutonomousAlertControl,
	positiveIntegerText,
	emitIduProgress,
} from "./helpers.js";

export type {
	CliAutonomousAlertTickResult,
	CliAutonomousAlertControlResult,
	DigestAlertRoutingResult,
} from "./helpers.js";

export {
	handleAlerts,
	handleAlertsStatus,
	handleAlertsTick,
	handleAlertsScheduledTick,
} from "./handlers.js";