import type { AgentProfile } from "./config.js";
import type { AgentRouter } from "./agent-router.js";
import {
	type LabReportStore,
	summarizeOutput,
	type LabRunRecord,
} from "./lab-reports.js";

export const LAB_DURATIONS = [
	{
		label: "quick",
		ms: 5 * 60_000,
		maxCommands: 1,
		description: "1 verificación corta",
	},
	{
		label: "3tests",
		ms: 15 * 60_000,
		maxCommands: 3,
		description: "hasta 3 comandos",
	},
	{
		label: "5tests",
		ms: 25 * 60_000,
		maxCommands: 5,
		description: "hasta 5 comandos",
	},
	{
		label: "full",
		ms: 45 * 60_000,
		maxCommands: 12,
		description: "suite completa razonable",
	},
] as const;

export type LabDuration = (typeof LAB_DURATIONS)[number];

export function parseLabDuration(input: string): LabDuration | undefined {
	const normalized = input.trim().toLowerCase().replace(/\.$/u, "");
	const index = Number(normalized);
	if (Number.isInteger(index) && index >= 1 && index <= LAB_DURATIONS.length) {
		return LAB_DURATIONS[index - 1];
	}
	return LAB_DURATIONS.find((duration) => duration.label === normalized);
}

export function formatDurationChoices(): string {
	return LAB_DURATIONS.map(
		(duration, index) =>
			`${index + 1}. ${duration.label} - ${duration.description}`,
	).join("\n");
}

export function labPrompt(duration: LabDuration, agent: AgentProfile): string {
	return `Modo laboratorio de tests para ${agent.label}. Profundidad: ${duration.label} (${duration.description}). Límite de seguridad: ${Math.round(duration.ms / 60_000)} minutos.\n\nReglas obligatorias:\n- Trabajá solo dentro de tu workspace/clon.\n- No modifiques el repo real.\n- No hagas commit.\n- No hagas push.\n- Corré como máximo ${duration.maxCommands} comandos de test/verificación.\n- Si el proyecto usa pnpm, preferí Corepack: corepack pnpm test. No uses pnpm directo si no verificaste que está en PATH.\n- No te cortes por tiempo salvo emergencia: terminá el comando en curso y reportá.\n- Antes de verificar, detectá contexto del proyecto: scripts de test, README/docs, skills en .agents/skills o .pi/skills y MCP/tools disponibles.\n- Si existe .agents/skills/buenas-practicas-bd/SKILL.md, considerala contexto prioritario.\n- Usá MCP/tools disponibles solo si aportan evidencia; si fallan, reportalo como detalle técnico secundario.\n- Si necesitás inspeccionar código, hacelo solo para diagnosticar.\n- Reportá comandos ejecutados, resultados, fallas, evidencia, posible causa y sugerencia.\n- Si un problema ya está resuelto, indicalo como resuelto.\n\nFormato de respuesta:\nResumen corto\nTests/comandos ejecutados\nHallazgos con severidad y confianza\nSugerencias para el orquestador`;
}

export async function runTestLab(options: {
	router: AgentRouter;
	profile: AgentProfile;
	duration: LabDuration;
	projectId: string;
	projectPath: string;
	store: LabReportStore;
}): Promise<LabRunRecord> {
	const runtime = options.router.runtimeForProfile(options.profile.id);
	const startedAt = new Date().toISOString();
	const id = `${Date.now().toString(36)}-${options.profile.id}`;

	if (runtime.workspaceKind !== "clone") {
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: "skipped",
			summary: "Saltado: el agente no usa workspace clone.",
			triageStatus: "skipped",
			decisionStatus: "none",
			engramStatus: "skipped",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		options.store.append(record);
		return record;
	}

	if (runtime.session.busy) {
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: "skipped",
			summary: "Saltado: el agente ya estaba ocupado.",
			triageStatus: "skipped",
			decisionStatus: "none",
			engramStatus: "skipped",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		options.store.append(record);
		return record;
	}

	try {
		const result = await Promise.race([
			runtime.session.prompt(labPrompt(options.duration, options.profile)),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("LAB_TIMEOUT")),
					options.duration.ms,
				).unref(),
			),
		]);
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: result.ok ? "completed" : "failed",
			summary: summarizeOutput(result.output),
			rawOutput: result.output,
			triageStatus: "pending",
			decisionStatus: "none",
			engramStatus: "pending",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		options.store.append(record);
		return record;
	} catch (error) {
		const timeout = error instanceof Error && error.message === "LAB_TIMEOUT";
		if (timeout) runtime.session.cancel();
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: timeout ? "timeout" : "failed",
			summary: timeout
				? "Tiempo máximo alcanzado; agente cancelado."
				: "Ejecución falló.",
			error: error instanceof Error ? error.message : String(error),
			triageStatus: "pending",
			decisionStatus: "none",
			engramStatus: "pending",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		options.store.append(record);
		return record;
	}
}
