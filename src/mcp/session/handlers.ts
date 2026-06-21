// src/mcp/session/handlers.ts
//
// PR 3 (Item 4, mcp-server god-file breakup): cluster B (session)
// wrappers for the dispatchTool switch.
//
// 4 wrappers, one per case group (single label, no fall-through):
//   - handleStatus (idu_status)
//   - handleActivate (idu_activate)
//   - handleDeactivate (idu_deactivate)
//   - handleProjectResetState (idu_project_reset_state)
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
//
// Byte-identity contract: each wrapper body matches the corresponding
// case body modulo the function signature.

import type { CliRuntime } from "../../cli.js";
import {
	activateIduSession,
	deactivateIduSession,
	getIduSessionStatus,
} from "../../idu-session.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import { envelope, booleanArg } from "../_shared/index.js";
import { getTriggerEngineConfigStatus } from "../../trigger-engine-config.js";

/**
 * idu_status — read-only MCP mirror of the runtime connection + session state.
 * Body verbatim from src/mcp-server.ts L1903-L1930.
 */
export async function handleStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const connection = runtime.inspectConnection();
	const session = getIduSessionStatus(runtime.projectId);
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const triggerEngine = getTriggerEngineConfigStatus(stateRoot);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `${session.active ? "Activo" : "Inactivo"}; config=${connection.configStatus}; alignment=${connection.alignmentStatus}`,
		data: {
			resolutionStatus: resolution.status,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			active: session.active,
			configStatus: connection.configStatus,
			alignmentStatus: connection.alignmentStatus,
			sessionStatePath: session.sessionStatePath,
			recommendedNext: connection.recommendedNext,
			triggerEngine,
			connection,
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_activate — activate Idu-pi guardrails for the resolved project.
 * Body verbatim from src/mcp-server.ts L1931-L1952.
 */
export async function handleActivate(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const session = activateIduSession(runtime.projectId);
	const roleEngineBinding = runtime.rebindRoleEngine?.();
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary:
				"Guardrails automáticos activados sin scan pesado ni AgentLabs.",
		data: {
			...(session as unknown as JsonObject),
			...(roleEngineBinding ? { roleEngineBinding } : {}),
		},
		safeNotes: [
			...resolution.safeNotes,
			"No ejecuté scan pesado.",
			"No ejecuté AgentLabs.",
		],
	});
}

/**
 * idu_deactivate — deactivate Idu-pi guardrails for the resolved project.
 * Body verbatim from src/mcp-server.ts L1954-L1970.
 */
export async function handleDeactivate(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const session = deactivateIduSession(runtime.projectId);
	const roleEngineBinding = runtime.unbindRoleEngine?.();
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: "Guardrails automáticos desactivados.",
		data: {
			...(session as unknown as JsonObject),
			...(roleEngineBinding ? { roleEngineBinding } : {}),
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_project_reset_state — wipe isolated stateRoot (requires confirm=true).
 * Body verbatim from src/mcp-server.ts L1972-L2004.
 */
export async function handleProjectResetState(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const confirmed = booleanArg(args, "confirm", false);
	if (!confirmed) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Reset cancelado: falta confirm=true.",
			data: { requiresConfirmation: true },
			safeNotes: [
				...resolution.safeNotes,
				"No borré nada porque falta confirmación explícita.",
			],
			errors: ["Para borrar stateRoot enviá confirm=true."],
		});
	}
	const result = runtime.projectStateReset(true);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `StateRoot limpiado: ${result.stateRoot}`,
		data: result as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Borré sólo estado aislado de Idu-pi.",
			"No desregistré el proyecto ni toqué el repo real.",
		],
	});
}
