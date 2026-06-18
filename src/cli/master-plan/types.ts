/**
 * types.ts — types for the master-plan cluster (C).
 *
 * `ExecutionDirectorCliResult` was previously defined in `src/cli.ts`
 * (line 573, header section). It is the return type of
 * `runCliExecutionDirectorTick` (in cluster C), so it moves here as a
 * precondition of moving the cluster's helpers.
 *
 * The public surface at `src/cli.ts` re-exports it via the master-plan
 * barrel. The 9-type surface is preserved (the typecheck guard catches
 * any missed consumer).
 */

import type { ExecutionDirectorTickResult } from "../../execution-director-tick.js";
import type { FlowBoundProposal } from "../../proposal-outbox.js";

export type ExecutionDirectorCliResult = ExecutionDirectorTickResult & {
	savedProposals: FlowBoundProposal[];
};
