import type { CliRuntime } from "../../src/cli.js";
import type { IduMcpProjectResolution } from "../../src/mcp-server.js";

/**
 * Shared setup for BUCKET-D "unregistered" state-root tests.
 *
 * BUCKET-D covers tools that guard on an unregistered project (no stateRoot).
 * These tests pin the current behavior where handlers return either:
 * - `null` (via envelope truthy-coercion of `""`)
 * - `""` literal (for tools that don't use envelope())
 *
 * This module provides the resolution, runtime factory, and tool site definitions
 * needed to test these 9 sites deterministically.
 *
 * Issue #258, Phase 1A (type:chore).
 */

/**
 * Project ID used for BUCKET-D unregistered probe tests.
 * This simulates a project that was never enrolled.
 */
export const UNREGISTERED_PROJECT_ID = "bucket-d-unregistered-probe";

/**
 * Project ID for role-engine-subscription probe tests.
 * These sites return their own shape (not envelope), so the literal "" is preserved.
 */
export const ROLE_ENGINE_PROBE = "bucket-d-role-engine-probe";

/**
 * Build an IduMcpProjectResolution representing an unregistered project.
 * The stateRoot is intentionally absent — upstream `?? ""` resolves to the literal "".
 */
export function unregisteredResolution(): IduMcpProjectResolution {
	return {
		status: "unregistered_project",
		projectId: UNREGISTERED_PROJECT_ID,
		projectPath: "fake-repo-root",
		// stateRoot intentionally absent — simulates a project that was never
		// enrolled. Upstream `?? ""` resolves the literal "" the sites use.
		recommendedNext: "enroll",
		safeNotes: [],
		errors: [],
	};
}

/**
 * Minimal CliRuntime stub for BUCKET-D tests.
 * All unregistered sites return at their first guard (before touching capabilities),
 * so only the identity fields matter.
 */
export function makeRuntime(): CliRuntime {
	return {
		projectId: UNREGISTERED_PROJECT_ID,
		projectPath: "fake-repo-root",
		workspaceRoot: "",
		labDbPath: "fake-lab.db",
	} as unknown as CliRuntime;
}

/**
 * Tool sites that use envelope() and thus truthy-coerce "" → null.
 * These are the 7 sites that guard on unregistered status and return envelope({ stateRoot: "" }).
 */
export const ENVELOPE_SITES = [
	{ tool: "idu_birth_general_spec", args: {} },
	{ tool: "idu_birth_general_spec_derive", args: {} },
	{ tool: "idu_genesis_mission_draft", args: {} },
	{ tool: "idu_genesis_mission_confirm", args: {} },
	{ tool: "idu_skill_for_task", args: {} },
	{ tool: "idu_autonomous_alerts_control", args: {} },
	{ tool: "idu_external_intelligence_report", args: {} },
] as const;
