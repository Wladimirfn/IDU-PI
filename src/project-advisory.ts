import type {
	ProjectPreflightReport,
	ProjectPreflightRisk,
} from "./project-preflight.js";
import type { GateExecutionStatus } from "./project-postflight.js";

export type ProjectAdvisoryLevel = "info" | "warning" | "risk" | "blocker";

export type ProjectAdvisory = {
	level: ProjectAdvisoryLevel;
	title: string;
	request: string;
	affectedAreas: string[];
	missingContext: string[];
	warnings: string[];
	availableContext: string[];
	recommendation: string;
	actions: string[];
	requiresHumanConfirmation: boolean;
	okToProceed: boolean;
	// R5.2: when present, the discriminated union. The `format` helper reads
	// `affectedRules` from `.result` when `kind === "ran"`, else renders the
	// skip message so the advisory never lies about enforcement status.
	constitutionGate?: GateExecutionStatus;
};

export function buildProjectAdvisory(
	preflightReport: ProjectPreflightReport,
): ProjectAdvisory {
	const level = advisoryLevel(preflightReport.risk);
	return {
		level,
		title: advisoryTitle(level),
		request: preflightReport.request,
		affectedAreas: simplifyAreas(preflightReport.affectedAreas),
		missingContext: preflightReport.missingContext,
		warnings: preflightReport.warnings,
		availableContext: preflightReport.availableContext ?? [],
		recommendation: shortRecommendation(preflightReport),
		actions: suggestedActions(preflightReport),
		requiresHumanConfirmation: preflightReport.requiresHumanConfirmation,
		okToProceed: preflightReport.okToProceed,
		constitutionGate: preflightReport.constitutionGate,
	};
}

export function formatProjectAdvisory(advisory: ProjectAdvisory): string {
	return [
		advisory.title,
		"",
		"Solicitud:",
		advisory.request || "—",
		"",
		"Detecté impacto en:",
		formatLimitedList(advisory.affectedAreas),
		"",
		"Contexto faltante:",
		formatLimitedList(advisory.missingContext),
		"",
		"Contexto disponible:",
		formatLimitedList(advisory.availableContext),
		"",
		"Alertas:",
		formatLimitedList(advisory.warnings),
		"",
		...(advisory.constitutionGate
			? [
					advisory.constitutionGate.kind === "ran"
						? "Reglas afectadas:"
						: "Constitution gate execution:",
					advisory.constitutionGate.kind === "ran"
						? formatLimitedList(advisory.constitutionGate.result.affectedRules)
						: advisory.constitutionGate.skippedReason,
					"",
				]
			: []),
		"Recomendación:",
		advisory.recommendation,
		"",
		"Acciones sugeridas:",
		formatNumberedLimitedList(advisory.actions),
		"",
		"Nota segura:",
		"No ejecuté scan, IA ni AgentLabs; esto es solo advisory manual.",
	].join("\n");
}

function advisoryLevel(risk: ProjectPreflightRisk): ProjectAdvisoryLevel {
	switch (risk) {
		case "low":
			return "info";
		case "medium":
			return "warning";
		case "high":
			return "risk";
		case "blocker":
			return "blocker";
	}
}

function advisoryTitle(level: ProjectAdvisoryLevel): string {
	switch (level) {
		case "info":
			return "Idu-pi Advisory — Info";
		case "warning":
			return "Idu-pi Advisory — Advertencia";
		case "risk":
			return "Idu-pi Advisory — Riesgo alto";
		case "blocker":
			return "Idu-pi Advisory — Bloqueado";
	}
}

function simplifyAreas(areas: string[]): string[] {
	return areas.map((area) => (area === "módulo nuevo" ? "módulos" : area));
}

function shortRecommendation(report: ProjectPreflightReport): string {
	if (report.risk === "blocker") return report.recommendedNext;
	if (report.missingContext.length > 0) {
		return "Crear o corregir config project-local antes de implementar.";
	}
	if (report.warnings.some((warning) => /project-flows/u.test(warning))) {
		return "Confirmar project-flows antes de implementar.";
	}
	return report.recommendedNext;
}

function suggestedActions(report: ProjectPreflightReport): string[] {
	const actions = [`Ejecutar /preflight ${report.request || "<solicitud>"}`];
	if (report.missingContext.length > 0 || report.warnings.length > 0) {
		actions.push("Ejecutar /config inspect_project_map");
	}
	if (report.requiresHumanConfirmation)
		actions.push("Pedir confirmación humana");
	if (report.shouldRunAgentLab) {
		actions.push("Preparar AgentLab arquitectura; no lanzarlo automáticamente");
	}
	if (report.okToProceed) actions.push("Continuar con alcance acotado");
	return actions;
}

function formatLimitedList(items: string[]): string {
	const cleanItems = dedupe(items);
	if (cleanItems.length === 0) return "- ninguno";
	const shown = cleanItems.slice(0, 5).map((item) => `- ${item}`);
	const hiddenCount = cleanItems.length - shown.length;
	if (hiddenCount > 0) shown.push(`- +${hiddenCount} más`);
	return shown.join("\n");
}

function formatNumberedLimitedList(items: string[]): string {
	const cleanItems = dedupe(items);
	if (cleanItems.length === 0) return "1. ninguna";
	const shown = cleanItems
		.slice(0, 5)
		.map((item, index) => `${index + 1}. ${item}`);
	const hiddenCount = cleanItems.length - shown.length;
	if (hiddenCount > 0) shown.push(`${shown.length + 1}. +${hiddenCount} más`);
	return shown.join("\n");
}

function dedupe(items: string[]): string[] {
	return [...new Set(items.filter((item) => item.trim().length > 0))];
}
