// src/mcp/lifecycle/helpers.ts
//
// PR 2 (Item 4, mcp-server god-file breakup): helpers used by the
// lifecycle cluster wrappers. These were top-level functions in
// src/mcp-server.ts that are only used by the 4 lifecycle wrappers.
//
// Moved verbatim (behavior-preserving pure move, no logic change).
// Each function is private to the lifecycle cluster — not exported
// from the cluster's public surface.

import type { JsonObject } from "../_shared/index.js";
import { resolveMcpProjectContext } from "../../mcp-server.js";
import type { IduMcpToolName } from "../_shared/index.js";
import type { ProjectEnrollResult } from "../../idu-installer.js";
import { configureIduSessionStore } from "../../idu-session.js";

/**
 * Body verbatim from src/mcp-server.ts L1790-L1807.
 * Compacts a supervisor startup report into the public-safe shape
 * exposed in idu_start's envelope.
 */
export function compactSupervisorStartup(
	startup:
		| {
				status: string;
				trigger: string;
				reason?: string;
				summary: string;
				safety: JsonObject;
		  }
		| undefined,
): JsonObject | null {
	if (!startup) return null;
	return {
		status: startup.status,
		trigger: startup.trigger,
		reason: startup.reason,
		summary: startup.summary,
		safety: startup.safety,
	};
}

/**
 * Body verbatim from src/mcp-server.ts L1934-L1956.
 * Wraps a projectEnroll result into the envelope input shape.
 */
export function projectEnrollEnvelope(
	name: IduMcpToolName,
	result: ProjectEnrollResult,
): Parameters<typeof import("../_shared/index.js").envelope>[0] {
	return {
		ok: true,
		tool: name,
		projectId: result.project.id,
		projectPath: result.project.path,
		summary:
			"Proyecto enrolado con estado aislado; no creé drafts ni ejecuté scans.",
		data: {
			project: result.project,
			statePaths: result.statePaths,
			created: result.created,
		},
		safeNotes: [
			...result.safeNotes,
			"No creé Project Core ni Constitution.",
			"No ejecuté scan ni AgentLabs.",
		],
	};
}

/**
 * Body verbatim from src/mcp-server.ts L1925-L1932.
 * Wrapper around configureIduSessionStore that maps the enroll result's
 * statePaths shape to the session store API.
 */
export function configureProjectSessionStore(
	statePaths: ProjectEnrollResult["statePaths"],
): void {
	configureIduSessionStore({
		workspaceRoot: statePaths.stateRoot,
		filePath: statePaths.sessionStatePath,
	});
}

/**
 * Body verbatim from src/mcp-server.ts L1958-L1963.
 * Resolves the project path for a lifecycle tool call.
 */
export function resolveLifecycleProjectPath(
	inputProjectPath?: string,
): string {
	if (inputProjectPath?.trim()) return inputProjectPath.trim();
	const resolution = resolveMcpProjectContext();
	return resolution.projectPath;
}