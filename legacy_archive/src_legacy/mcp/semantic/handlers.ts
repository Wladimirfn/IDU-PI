// src/mcp/semantic/handlers.ts
//
// PR 11 (Item 4, mcp-server god-file breakup): cluster Q (semantic)
// wrappers for the dispatchTool switch.
//
// 1 wrapper:
//   - handleSemanticAuditStatus (idu_semantic_audit_status)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param, unused here)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import type { CliRuntime } from "../../cli.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import { envelope } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_semantic_audit_status — read semantic audit state/checkpoint.
 * Body verbatim from src/mcp-server.ts L4257-L4280.
 */
export async function handleSemanticAuditStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const report = runtime.semanticAuditStatus();
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `shouldRun=${String(report.decision.shouldRun)} trigger=${report.decision.triggerReason}`,
		data: {
			stats: report.stats,
			checkpoint: report.checkpoint,
			shouldRun: report.decision.shouldRun,
			triggerReason: report.decision.triggerReason,
			report,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Solo leí estado de auditoría semántica.",
		],
	});
}
