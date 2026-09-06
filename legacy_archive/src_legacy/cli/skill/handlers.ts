/**
 * handlers.ts — skill cluster (H) case wrappers for the dispatch switch.
 *
 * PR 7f of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 9 cases that belong to the skill
 * cluster:
 *
 *   - idu-skill-improvements-review | skill-improvements-review
 *   - idu-skill-improvements-create | skill-improvements-create
 *   - idu-skill-improvements-status | skill-improvements-status
 *   - idu-skill-improvements-approve | skill-improvements-approve
 *   - idu-skill-improvements-reject | skill-improvements-reject
 *   - idu-skill-improvements-defer | skill-improvements-defer
 *   - idu-skill-drafts-create | skill-drafts-create
 *   - idu-skill-drafts-review | skill-drafts-review
 *   - idu-skill-rating | skill-rating
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import { requiredText, requiredDecisionParts } from "../dispatch-glue/parsers.js";
import { ok } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import { runSkillRating, formatSkillRating } from "../../cli-skill-rating.js";

export function handleSkillImprovementsReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSkillImprovementPlan(
			runtime.skillImprovementPlan(requiredText(rest)),
		),
	);
}

export function handleSkillImprovementsCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSkillImprovementCreationResult(
			runtime.skillImprovementCreate(requiredText(rest)),
		),
	);
}

export function handleSkillImprovementsStatus(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSkillImprovementStatus(
			runtime.skillImprovementStatus(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleSkillImprovementsApprove(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSkillImprovementDecisionResult(
			runtime.skillImprovementApprove(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSkillImprovementsReject(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSkillImprovementDecisionResult(
			runtime.skillImprovementReject(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSkillImprovementsDefer(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSkillImprovementDecisionResult(
			runtime.skillImprovementDefer(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSkillDraftsCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSkillDraftCreationResult(
			runtime.skillDraftsCreate(rest.join(" ").trim() || "latest"),
		),
	);
}

export function handleSkillDraftsReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSkillDraftReview(
			runtime.skillDraftReview(rest.join(" ").trim() || "latest"),
		),
	);
}

export function handleSkillRating(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const result = runSkillRating(rest, {
		stateRoot: runtime.workspaceRoot,
	});
	if (!result.ok) {
		return {
			exitCode: result.exitCode,
			stdout: "",
			stderr: formatSkillRating(result),
		};
	}
	return ok(formatSkillRating(result));
}