/**
 * handlers.ts — queue cluster (I) case wrappers for the dispatch switch.
 *
 * PR 7h of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 6 cases that belong to the queue
 * cluster:
 *
 *   - idu-queue | queue | idu-queue-detail | queue-detail
 *   - idu-queue-clear-structured | queue-clear-structured
 *   - idu-queue-approve | queue-approve | queue_approve
 *   - idu-queue-reject | queue-reject | queue_reject
 *   - idu-queue-complete | queue-complete | queue_complete
 *   - idu-task | task
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import { requiredText } from "../dispatch-glue/parsers.js";
import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import {
	type TaskTemplateKind,
	inferTaskTemplateKind,
	formatTaskTemplateHelp,
} from "../../task-templates.js";

export function handleQueueDetail(runtime: CliRuntime): CliResult {
	return ok(runtime.queueDetail());
}

export function handleQueueClearStructured(runtime: CliRuntime): CliResult {
	const count = runtime.queueClearStructured();
	return ok(`Cola estructurada limpiada: ${count} tarea(s).`);
}

export function handleQueueApprove(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const id = requiredText(rest);
	const task = runtime.queueApprove(id);
	if (!task) return fail(`task not found: ${id}`);
	return ok(`Tarea aprobada: ${task.id}. No ejecuté IA ni AgentLabs.`);
}

export function handleQueueReject(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const id = requiredText(rest);
	const task = runtime.queueReject(id);
	if (!task) return fail(`task not found: ${id}`);
	return ok(`Tarea rechazada: ${task.id}.`);
}

export function handleQueueComplete(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const id = requiredText(rest.slice(0, 1));
	const evidence = requiredText(rest.slice(1));
	const task = runtime.queueComplete?.(id, evidence);
	if (!task) return fail("Uso: idu-pi queue-complete <id> <evidence>");
	return ok(`Tarea completada: ${task.id}. Evidencia registrada.`);
}

export function handleTask(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	if (!rest.length) return ok(formatTaskTemplateHelp());
	const first = rest[0] as TaskTemplateKind;
	const knownKinds: TaskTemplateKind[] = [
		"bug",
		"feature",
		"refactor",
		"docs",
		"review",
	];
	const hasExplicitKind = knownKinds.includes(first);
	const details = (hasExplicitKind ? rest.slice(1) : rest)
		.join(" ")
		.trim();
	const kind = hasExplicitKind ? first : inferTaskTemplateKind(details);
	const task = runtime.createTask(kind, details);
	return ok(runtime.formatTask(task));
}