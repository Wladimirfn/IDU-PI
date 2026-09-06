// src/mcp/envelope-advisory/truncation-notice.ts
//
// REQ-EI-3 (P4): top-level truncation notice for the supervisor context
// pack. Builds a single human-readable line that surfaces how many
// contracts were dropped by the context budget and, when possible,
// points at the source path that lost the most content.
//
// The notice lives on `safeNotes` (top-level, visible to the orchestrator
// before scrolling) and coexists with the existing `contextBudget.truncated`
// bool — consumers that already read the bool keep working unchanged.
//
// The sentinel `path === "contextBudget.total"` that
// `mergeContextBudgetUsage` injects when the aggregate usage exceeds
// `maxTotalChars` is filtered out of the count and out of the unique
// paths set. It is an artifact of the merge pass, not a real omission.

import type { ContextBudgetUsage } from "../../context-budget.js";

/**
 * Sentinel path that `mergeContextBudgetUsage` adds when the merged
 * `usedChars` exceed `maxTotalChars`. It is not a real per-section
 * omission; filter it out before counting or surfacing sources.
 */
const TOTAL_OVERFLOW_SENTINEL = "contextBudget.total";

/**
 * Build a one-line truncation notice for the supervisor context pack.
 *
 * Returns `null` when the budget was not actually truncated. When it
 * was, the format is fixed by REQ-EI-3 P4:
 *
 *   - One unique source path: `"${N} contratos truncados por context
 *     budget, fuente en ${path}"`.
 *   - Two or more unique source paths (including the special case
 *     where several reasons hit the same path): `"${N} contratos
 *     truncados por context budget, fuente en mixed"`.
 *
 * `N` is the number of real omission entries — the
 * `contextBudget.total` overflow sentinel does NOT count.
 */
export function buildTruncationNotice(
	budget: ContextBudgetUsage,
): string | null {
	if (budget.truncated !== true) return null;

	const realOmissions = budget.omitted.filter(
		(entry) => entry.path !== TOTAL_OVERFLOW_SENTINEL,
	);
	const uniquePaths = new Set(realOmissions.map((entry) => entry.path));
	const n = realOmissions.length;

	if (uniquePaths.size === 1) {
		const onlyPath = [...uniquePaths][0] ?? "mixed";
		return `${n} contratos truncados por context budget, fuente en ${onlyPath}`;
	}

	return `${n} contratos truncados por context budget, fuente en mixed`;
}