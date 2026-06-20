/**
 * handlers.ts — alerts cluster (B) case wrappers for the dispatch switch.
 *
 * PR 7i of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 4 cases that belong to the alerts
 * cluster:
 *
 *   - alerts | idu-alerts
 *   - idu-alerts-status | alerts-status
 *   - idu-alerts-tick | alerts-tick
 *   - idu-alerts-scheduled-tick | alerts-scheduled-tick
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 *
 * Note: the helpers `handleCliAlertCommand`,
 * `buildCliAutonomousAlertStatus`, `runCliAutonomousAlertTick`,
 * `runCliAutonomousAlertScheduledTick`, `formatCliAutonomousAlertReport`,
 * and `formatCliAutonomousAlertScheduledTick` were already exported
 * from `./helpers.js` in PR 4. We import them here (no duplication).
 */

import { ok } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import {
	handleCliAlertCommand,
	buildCliAutonomousAlertStatus,
	runCliAutonomousAlertTick,
	runCliAutonomousAlertScheduledTick,
	formatCliAutonomousAlertReport,
	formatCliAutonomousAlertScheduledTick,
} from "./helpers.js";

export function handleAlerts(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return handleCliAlertCommand(runtime, rest);
}

export function handleAlertsStatus(runtime: CliRuntime): CliResult {
	return ok(
		formatCliAutonomousAlertReport(
			buildCliAutonomousAlertStatus(runtime),
		),
	);
}

export function handleAlertsTick(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		formatCliAutonomousAlertReport(
			runCliAutonomousAlertTick(runtime, {
				allowTaskCreation: rest.includes("--allow-task-creation"),
			}),
		),
	);
}

export function handleAlertsScheduledTick(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		formatCliAutonomousAlertScheduledTick(
			runCliAutonomousAlertScheduledTick(runtime, {
				allowTaskCreation: rest.includes("--allow-task-creation"),
			}),
		),
	);
}