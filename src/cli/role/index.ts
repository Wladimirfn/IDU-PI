/**
 * index.ts — barrel for the role cluster (M).
 *
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports all 6 helpers + 2 private types.
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