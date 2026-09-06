/**
 * types.ts — types for the dispatch-glue cluster (Q).
 *
 * `CliResult` was previously defined in `src/cli.ts` (line 556). It is
 * the result shape of `ok` and `fail` (the Q cluster's helpers), so it
 * moves here as a precondition of moving those helpers.
 *
 * The public surface at `src/cli.ts` re-exports it via the Q cluster's
 * index. The 9-type surface is preserved (the typecheck guard catches
 * any missed consumer).
 */

export type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};
