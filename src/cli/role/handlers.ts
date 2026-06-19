/**
 * handlers.ts — role cluster (M) case wrappers for the dispatch switch.
 *
 * PR 7a of 7 (Item 4, god-files breakup). Phase 2: switch decomposition.
 * Contains the wrapper functions for the 4 case groups that belong to
 * the role cluster:
 *
 *   - idu-model-invocation-status | model-invocation-status
 *   - idu-orchestrator-advisory | orchestrator-advisory
 *   - idu-role-engine | role-engine
 *   - idu-role-engine-status | role-engine-status
 *
 * Each wrapper takes `(runtime: CliRuntime, rest: string[]) => CliResult`
 * and contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename, since the wrapper takes `runtime`
 * as a parameter; the case body used `activeRuntime` as a closure var).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import { join } from "node:path";

import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import {
	buildModelInvocationStatusOrError,
	parseModelInvocationStatusArgs,
} from "../../cli-model-invocation-status.js";
import {
	runIdOrchestratorAdvisoryCommand,
	runIdRoleEngineCommand,
	runIdRoleEngineStatusCommand,
} from "../../cli-role-engine.js";

export function handleModelInvocationStatus(
	runtime: CliRuntime,
	rest: string[],
): CliResult {
	const { role, limit } = parseModelInvocationStatusArgs(rest);
	// REQ-SF-2: use the runtime's labDbPath directly. Reconstructing
	// the path from workspaceRoot + projects + projectId + lab.db
	// produced a nested duplicate (projects/idu-pi/projects/idu-pi/lab.db).
	// The runtime already exposes the correct canonical path.
	const labDbPath =
		runtime.labDbPath ??
		join(
			runtime.workspaceRoot,
			"projects",
			runtime.projectId,
			"lab.db",
		);
	const result = buildModelInvocationStatusOrError({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		labDbPath,
		options: { role, limit },
	});
	if (!result.ok) {
		return fail(result.error);
	}
	return ok(
		`lab.db path: ${labDbPath}\n` +
			runtime.formatModelInvocationStatus(result.report),
	);
}

export function handleOrchestratorAdvisory(
	runtime: CliRuntime,
	rest: string[],
): CliResult {
	return ok(runIdOrchestratorAdvisoryCommand(rest, runtime));
}

export function handleRoleEngine(
	runtime: CliRuntime,
	rest: string[],
): CliResult {
	return ok(runIdRoleEngineCommand(rest, runtime));
}

export function handleRoleEngineStatus(
	runtime: CliRuntime,
	rest: string[],
): CliResult {
	return ok(runIdRoleEngineStatusCommand(rest, runtime));
}