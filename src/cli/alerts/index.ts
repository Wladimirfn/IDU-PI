/**
 * index.ts — barrel for the alerts cluster (B).
 *
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports all 13 helper functions + 3 types from helpers.ts.
 * `routeAlertDecisionsForDigest` is in the public surface (snapshot test
 * pins it); all other exports are internal-only.
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