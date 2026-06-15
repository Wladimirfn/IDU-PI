import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoleProfile } from "./roles/profile-loader.js";

export type ObjectiveReminderInput = {
	stateRoot: string;
	now: Date;
};

/**
 * Build the objective reminder text the supervisor pushes to the
 * orchestrator when its master-plan-objective cache is older than an
 * hour. The reminder has three blocks:
 *
 *   1. The project objective (from master-plan.json or fallback).
 *   2. The role and routine (from the orchestrator profile).
 *   3. A cadence hint based on the active model — models with
 *      tool-use weakness need a more frequent reminder.
 *
 * This is the "anti-drift" re-anchoring the orchestrator profile
 * describes. The reminder itself is advisory; the orchestrator
 * decides what to do with it.
 */
export function buildObjectiveReminderText(
	input: ObjectiveReminderInput,
	options: { activeModelId?: string } = {},
): string {
	const objective = readObjectiveFallback(input.stateRoot);
	const role = loadRoleProfile("orchestrator");
	const routineMatch = /Rutina obligatoria[^\n]*\n([\s\S]*?)(?=\n##\s|$)/u.exec(
		role.body,
	);
	const routine = routineMatch ? routineMatch[1]?.trim() : "";
	const cadence = cadenceHint(options.activeModelId);
	return [
		"# Recordatorio de objetivo (objective_reminder_hourly)",
		"",
		"## Objetivo vigente",
		objective,
		"",
		"## Tu rol y rutina",
		`Eres: ${role.nombre} (${role.rolId})`,
		"Tipo: " + role.tipo,
		"",
		routine,
		"",
		"## Cadencia sugerida",
		cadence,
	].join("\n");
}

function readObjectiveFallback(stateRoot: string): string {
	// Best-effort: read master-plan.json. If absent, return a
	// neutral default that still reminds the orchestrator to check
	// the master plan.
	try {
		const path = join(stateRoot, "master-plan.json");
		if (!existsSync(path)) {
			return "(objetivo no disponible — revisá el master-plan antes de seguir)";
		}
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as { objective?: string };
		if (typeof parsed.objective === "string" && parsed.objective.length > 0) {
			return parsed.objective;
		}
	} catch {
		// Lenient parse-or-default
	}
	return "(objetivo no disponible — revisá el master-plan antes de seguir)";
}

function cadenceHint(activeModelId?: string): string {
	// The "Nota por modelo" guidance in the orchestrator profile.
	// Default: every 10 tasks. Models known to have weaker tool-use
	// get a tighter cadence.
	if (!activeModelId) {
		return "Modelo desconocido. Refrescá contexto cada ~10 tareas o cada ~1h, lo que llegue primero.";
	}
	const weak = /minimax|haiku|small|lite|nano/u.test(activeModelId);
	return weak
		? `Modelo detectado: ${activeModelId}. Refrescá contexto cada ~5 tareas. Si dudás sobre qué tool usar, consultá el skill antes de improvisar.`
		: `Modelo detectado: ${activeModelId}. Refrescá contexto cada ~10 tareas o cada ~1h.`;
}
