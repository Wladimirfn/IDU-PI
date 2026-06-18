/**
 * context.ts — runtime context type for the dispatch.
 *
 * `RuntimeContext` was previously defined in `src/cli.ts` (line 906)
 * as an internal type. It is used by cluster O (setup, `inspectConnection`
 * and `runPrepare`) and the dispatch infrastructure. It moves here as a
 * precondition of moving cluster O.
 *
 * The public surface at `src/cli.ts` continues to use this type. The
 * typecheck guard (npx tsc --noEmit) protects any consumer.
 *
 * Note: `RuntimeContext` is NOT in the 9-type public surface
 * (snapshotted in PR 1). It is a structural helper for the dispatch
 * infrastructure. The snapshot test does not change.
 */

import type { BridgeConfig } from "../../config.js";
import type { ProjectEntry, ProjectRegistry } from "../../projects.js";
import type { StructuredTaskQueue } from "../../structured-task-queue.js";

export type RuntimeContext = {
	config: BridgeConfig;
	registry: ProjectRegistry;
	activeProject: ProjectEntry;
	structuredTaskQueue: StructuredTaskQueue;
	runtimeWorkspaceRoot: string;
	reportsPath: string;
	labDbPath: string;
};
