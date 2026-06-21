// src/mcp/role/handlers.ts
//
// PR 6 (Item 4, mcp-server god-file breakup): cluster E (role-engine)
// wrappers for the dispatchTool switch.
//
// 2 wrappers, one per case group (single label, no fall-through):
//   - handleRoleEngineControl  (idu_role_engine_control)
//   - handleRoleEngineStatus   (idu_role_engine_status)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import type { CliRuntime } from "../../cli.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	activeMcpProjectId,
	invalidMcpInput,
	roleEngineControlActionArg,
	roleEngineRoleArg,
} from "../../mcp-server.js";
import {
	DEFAULT_ROLE_ENGINE_CONFIG,
	disableRoleEngineConfig,
	enableRoleEngineConfig,
	formatRoleEngineConfigResult,
	getRoleEngineConfigStatus,
} from "../../role-engine-config.js";
import { envelope } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_role_engine_control — enable/disable the role engine config.
 * Body verbatim from src/mcp-server.ts L2080-L2132.
 */
export async function handleRoleEngineControl(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const projectId = activeMcpProjectId(runtime, resolution);
	if (!projectId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"project id must be non-empty",
		);
	const action = roleEngineControlActionArg(args);
	if (!action) {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"action must be one of: enable, disable",
		);
	}
	const role = roleEngineRoleArg(args);
	if (role === "invalid") {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			`role must be one of: ${Object.keys(DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled).join(", ")}`,
		);
	}
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const result =
		action === "enable"
			? enableRoleEngineConfig(stateRoot, role)
			: disableRoleEngineConfig(stateRoot, role);
	const roleEngineBinding = runtime.rebindRoleEngine?.();
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Role engine ${role ? `role ${role} ` : ""}${action}d.`,
		data: {
			action,
			role,
			result,
			...(roleEngineBinding ? { roleEngineBinding } : {}),
			output: formatRoleEngineConfigResult(result),
		},
		safeNotes: [
			...resolution.safeNotes,
			"No invoqué modelos; sólo actualicé el opt-in persistente.",
		],
	});
}

/**
 * idu_role_engine_status — read role engine config status.
 * Body verbatim from src/mcp-server.ts L2134-L2188.
 */
export async function handleRoleEngineStatus(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const projectId = activeMcpProjectId(runtime, resolution);
	if (!projectId)
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			"project id must be non-empty",
		);
	const role = roleEngineRoleArg(args);
	if (role === "invalid") {
		return invalidMcpInput(
			name,
			runtime,
			resolution,
			`role must be one of: ${Object.keys(DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled).join(", ")}`,
		);
	}
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const status = getRoleEngineConfigStatus(stateRoot);
	const runtimeStatus = runtime.getRoleEngineStatus?.();
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId,
		projectPath: runtime.projectPath,
		summary: `Role engine is ${status.enabled ? "enabled" : "disabled"}.`,
		data: {
			role,
			status,
			...(role ? { roleEnabled: status.roleEnabled[role] } : {}),
			...(runtimeStatus ? { runtimeStatus } : {}),
		},
		safeNotes: [
			...resolution.safeNotes,
			"Consulta de estado: no invoqué modelos.",
		],
	});
}
