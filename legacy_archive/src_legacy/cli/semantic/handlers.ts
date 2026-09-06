/**
 * handlers.ts — semantic cluster (J) case wrappers for the dispatch
 * switch.
 *
 * PR 7g of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 6 cases that belong to the semantic
 * cluster:
 *
 *   - idu-semantic-audit-status | semantic-audit-status
 *   - idu-semantic-audit-run | semantic-audit-run
 *   - idu-semantic-compact-draft | semantic-compact-draft
 *   - idu-semantic-compact-review | semantic-compact-review
 *   - idu-semantic-agent-tasks-review | semantic-agent-tasks-review
 *   - idu-semantic-agent-tasks-create | semantic-agent-tasks-create
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import { requiredText } from "../dispatch-glue/parsers.js";
import { ok } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";

export function handleSemanticAuditStatus(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSemanticAuditStatus(
			runtime.semanticAuditStatus(),
		),
	);
}

export function handleSemanticAuditRun(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSemanticAuditRun(
			runtime.semanticAuditRun(),
		),
	);
}

export function handleSemanticCompactDraft(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSemanticCompactionDraft(
			runtime.semanticCompactionDraft(),
		),
	);
}

export function handleSemanticCompactReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSemanticCompactionReview(
			runtime.semanticCompactionReview(requiredText(rest)),
		),
	);
}

export function handleSemanticAgentTasksReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSemanticAgentTaskPlan(
			runtime.semanticAgentTaskPlan(requiredText(rest)),
		),
	);
}

export function handleSemanticAgentTasksCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSemanticAgentTaskCreationResult(
			runtime.semanticAgentTasksCreate(requiredText(rest)),
		),
	);
}