// src/mcp/task-queue/handlers.ts
//
// PR 10 (Item 4, mcp-server god-file breakup): cluster P (task-queue)
// wrappers for the dispatchTool switch.
//
// 3 wrappers, one per case group (single label, no fall-through):
//   - handleTask         (idu_task)
//   - handleQueueDetail  (idu_queue_detail)
//   - handleQueueComplete (idu_queue_complete)
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
import { parseTaskList } from "../../mcp-server.js";
import type { StructuredTask } from "../../structured-task-queue.js";
import { inferTaskTemplateKind } from "../../task-templates.js";
import { envelope, requiredText } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_task — interpret human intent and register a structured task.
 * Body verbatim from src/mcp-server.ts L4246-L4263.
 */
export async function handleTask(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const text = requiredText(args, "text");
	const kind = inferTaskTemplateKind(text);
	const task = runtime.createTask(kind, text);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Tarea registrada: ${task.id}; guard=${task.guardStatus ?? "clear"}`,
		data: task as unknown as JsonObject,
		safeNotes: [
			...resolution.safeNotes,
			"Registré tarea estructurada; no ejecuté IA ni AgentLabs.",
		],
	});
}

/**
 * idu_queue_detail — return structured task queue.
 * Body verbatim from src/mcp-server.ts L4265-L4302.
 */
export async function handleQueueDetail(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const runtimeWithList = runtime as CliRuntime & {
		listTasks?: () => StructuredTask[];
	};
	const tasks = runtimeWithList.listTasks
		? runtimeWithList.listTasks()
		: parseTaskList(runtime.queueDetail());
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `${tasks.length} tarea(s) en cola estructurada.`,
		data: {
			tasks: tasks.map((task) => ({
				id: task.id,
				text: task.text,
				priority: task.priority,
				semanticPriority: task.semanticPriority,
				status: task.status,
				completionEvidence: task.completionEvidence,
				guardStatus: task.guardStatus ?? "clear",
				guardRisk: task.guardRisk,
				guardReason: task.guardReason,
			})),
			guardStatus: tasks.some(
				(task) =>
					task.status !== "done" &&
					task.guardStatus === "needs_confirmation",
			)
				? "needs_confirmation"
				: "clear",
		},
		safeNotes: resolution.safeNotes,
	});
}

/**
 * idu_queue_complete — mark a task complete with explicit evidence.
 * Body verbatim from src/mcp-server.ts L4304-L4353.
 */
export async function handleQueueComplete(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const taskId = requiredText(args, "taskId");
	const evidence = requiredText(args, "evidence");
	const runtimeWithComplete = runtime as CliRuntime & {
		queueComplete?: (
			idOrPrefix: string,
			evidence: string,
		) => StructuredTask | undefined;
	};
	const task = runtimeWithComplete.queueComplete?.(taskId, evidence);
	if (!task) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Tarea no encontrada para completar.",
			data: { taskId },
			safeNotes: resolution.safeNotes,
			errors: ["Tarea no encontrada para completar."],
		});
	}
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Tarea completada: ${task.id}`,
		data: {
			taskId: task.id,
			status: task.status,
			task: task as unknown as JsonObject,
		},
		safeNotes: [
			...resolution.safeNotes,
			"Marqué tarea como completada con evidencia explícita.",
			"No ejecuté IA ni AgentLabs.",
		],
	});
}
