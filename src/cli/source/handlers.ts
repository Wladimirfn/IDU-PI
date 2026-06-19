/**
 * handlers.ts — source cluster (F) case wrappers for the dispatch switch.
 *
 * PR 7d of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 15 cases that belong to the source
 * cluster:
 *
 *   - idu-source-status | source-status
 *   - idu-source-add | source-add
 *   - idu-source-remove | source-remove
 *   - idu-source-read | source-read
 *   - idu-source-extract | source-extract
 *   - idu-source-report | source-report
 *   - idu-source-research | source-research
 *   - idu-source-digest | source-digest
 *   - idu-source-digest-status | source-digest-status
 *   - idu-source-chunk-read | source-chunk-read
 *   - idu-source-recommend | source-recommend
 *   - idu-source-required-actions | source-required-actions
 *   - idu-source-skill-candidates-create | source-skill-candidates-create
 *   - idu-source-skill-candidates-review | source-skill-candidates-review
 *   - idu-source-refresh | source-refresh
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import { requiredText, requiredArg } from "../dispatch-glue/parsers.js";
import { ok } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";

export function handleSourceStatus(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSourceLibraryStatus(
			runtime.sourceLibraryStatus(),
		),
	);
}

export function handleSourceAdd(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceLibraryAddResult(
			runtime.sourceLibraryAdd(requiredText(rest)),
		),
	);
}

export function handleSourceRemove(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceLibraryRemoveResult(
			runtime.sourceLibraryRemove(requiredText(rest)),
		),
	);
}

export function handleSourceRead(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceLibraryReadResult(
			runtime.sourceLibraryRead(requiredText(rest)),
		),
	);
}

export function handleSourceExtract(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceLibraryExtractResult(
			runtime.sourceLibraryExtract(requiredText(rest)),
		),
	);
}

export function handleSourceReport(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceLibraryItemReport(
			runtime.sourceLibraryReport(requiredText(rest)),
		),
	);
}

export function handleSourceResearch(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceResearchReport(
			runtime.sourceLibraryResearch(requiredText(rest)),
		),
	);
}

export function handleSourceDigest(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceDigest(
			runtime.sourceDigest(requiredText(rest)),
		),
	);
}

export function handleSourceDigestStatus(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSourceDigestStatus(
			runtime.sourceDigestStatus(),
		),
	);
}

export function handleSourceChunkRead(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceChunkRead(
			runtime.sourceChunkRead(
				requiredArg(rest, 0, "sourceId"),
				requiredArg(rest, 1, "chunkId"),
			),
		),
	);
}

export function handleSourceRecommend(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceRecommendationReport(
			runtime.sourceRecommend(requiredText(rest)),
		),
	);
}

export function handleSourceRequiredActions(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSourceRequiredActionsReport(
			runtime.sourceRequiredActions(),
		),
	);
}

export function handleSourceSkillCandidatesCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceSkillCandidateCreationResult(
			runtime.sourceSkillCandidatesCreate(
				rest.join(" ").trim() || "all",
			),
		),
	);
}

export function handleSourceSkillCandidatesReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSourceSkillCandidateReview(
			runtime.sourceSkillCandidatesReview(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleSourceRefresh(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSourceLibraryRefreshResult(
			runtime.sourceLibraryRefresh(),
		),
	);
}