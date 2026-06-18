/**
 * context.ts — runtime context type for the dispatch.
 *
 * `RuntimeContext` was previously defined in `src/cli.ts` (line 906)
 * as an internal type. It is used by both cluster O (setup, `inspectConnection`
 * and `runPrepare`) and the dispatch infrastructure. It moves here as a
 * precondition of moving cluster O.
 *
 * Re-exported from `index.ts` (the dispatch-glue barrel) and from
 * `src/cli.ts` to preserve compatibility.
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
