/**
 * types.ts — private types for the role cluster (M).
 *
 * `ModelAssignmentMenuOption` and `ModelAssignmentMenuGroups` were
 * previously defined inline in `src/cli.ts` (lines 5550-5567). They
 * are used only by the M cluster's `modelAssignmentOptions` and
 * `modelAssignmentOptionGroups` helpers, so they move here.
 *
 * These types are NOT in the 9-type public surface (pinned by tsc
 * of consumers). They are internal helpers.
 */

export type ModelAssignmentMenuOption = {
	value: string;
	label: string;
	source: "profile" | "model" | "custom";
	providerKey?: string;
	providerLabel?: string;
};

export type ModelAssignmentMenuGroups = {
	profiles: ModelAssignmentMenuOption[];
	providerGroups: Array<{
		key: string;
		label: string;
		providers: string[];
		models: ModelAssignmentMenuOption[];
	}>;
	custom?: ModelAssignmentMenuOption;
};