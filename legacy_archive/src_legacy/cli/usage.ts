/**
 * usage.ts — shared CLI usage telemetry helper.
 *
 * PR 7b follow-up: extract `recordCliUsage` from src/cli.ts (it was
 * duplicated in src/cli/master-plan/handlers.ts during PR 7b). This
 * module owns the single, canonical definition. Both src/cli.ts and
 * src/cli/master-plan/handlers.ts import from here.
 *
 * Per auditor's contract for PR 7b+:
 *   Any helper internal to cli.ts (not exported) that a case body
 *   calls MUST be extracted to a shared module and imported — NEVER
 *   duplicated per-handler-file. A refactor whose goal is
 *   de-duplication cannot add duplication.
 *
 * verify-case-extraction.mjs enforces this by failing if any function
 * name is defined in more than one handler file (or in cli.ts and a
 * handler file).
 */

import { getIduSessionStatus } from "../idu-session.js";
import { recordIduUsageEventDeferred } from "../usage-events.js";
import type { CliRuntime } from "../cli.js";

export function recordCliUsage(
	runtime: CliRuntime,
	action: string,
	fields: {
		risk?: string;
		recommendation?: string;
		allowedToProceed?: boolean;
		requiresHuman?: boolean;
		durationMs?: number;
		ok?: boolean;
	} = {},
): void {
	recordIduUsageEventDeferred(runtime.workspaceRoot, {
		projectId: runtime.projectId,
		surface: "cli",
		action,
		active: getIduSessionStatus(runtime.projectId).active,
		...fields,
	});
}