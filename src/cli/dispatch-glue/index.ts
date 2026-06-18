/**
 * index.ts — barrel for the dispatch-glue cluster (Q).
 *
 * Re-exports the public surface (4 functions) and the internal helpers
 * that the rest of `src/cli.ts` consumes.
 *
 * The cluster map (§3.0) lists the 4 exports that MUST remain
 * importable from `src/cli.ts`:
 *   - parseHygieneMigrateArgs
 *   - formatHygieneSweepResult
 *   - formatHygieneMigrateResult
 *   - helpText
 *
 * The other 6 functions (primaryIntentConcept, cliCommandFor,
 * requiredText, requiredArg, requiredDecisionParts, requiredRuleDecisionParts,
 * ok, fail) are internal helpers. They are re-exported here so
 * `src/cli.ts` can keep using them without rewriting call sites.
 */

export {
	primaryIntentConcept,
	cliCommandFor,
	requiredText,
	requiredArg,
	requiredDecisionParts,
	requiredRuleDecisionParts,
} from "./parsers.js";

export { ok, fail, helpText } from "./result.js";

export {
	parseHygieneMigrateArgs,
	formatHygieneSweepResult,
	formatHygieneMigrateResult,
} from "./hygiene.js";

export type { CliResult } from "./types.js";
