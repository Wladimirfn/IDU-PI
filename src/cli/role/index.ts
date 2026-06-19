/**
 * index.ts — barrel for the role cluster (M).
 *
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *   - Re-exports all 6 helpers + 2 private types from helpers.ts.
 *
 * PR 7a of 7 (Item 4). Phase 2: switch decomposition.
 *   - Re-exports 4 case wrappers from handlers.ts (model-invocation-status,
 *     orchestrator-advisory, role-engine, role-engine-status).
 *
 * The dispatcher in src/cli.ts calls the helpers directly (for the
 * role TUI menu) and the handlers directly (for the CLI dispatch).
 */

export {
	modelAssignmentOptions,
	modelAssignmentOptionGroups,
	formatModelAssignmentOptionLabel,
	resolveRoleSelection,
	resolveAssignmentSelection,
	validateAgentProfiles,
} from "./helpers.js";

export type {
	ModelAssignmentMenuOption,
	ModelAssignmentMenuGroups,
} from "./types.js";

export {
	handleModelInvocationStatus,
	handleOrchestratorAdvisory,
	handleRoleEngine,
	handleRoleEngineStatus,
} from "./handlers.js";