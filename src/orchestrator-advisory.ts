import type { IduSupervisorHookResult } from "./idu-supervisor-hooks.js";
import type { IduSupervisorLoopResult } from "./idu-supervisor-loop.js";
import type { ProjectAdvisory } from "./project-advisory.js";
import type { ProjectPreflightReport } from "./project-preflight.js";

export type OrchestratorAdvisoryAudience = "orchestrator" | "human";
export type OrchestratorAdvisorySeverity =
	| "info"
	| "warning"
	| "needs_approval"
	| "grave_failure";
export type OrchestratorRecommendation =
	| "allow"
	| "warn"
	| "ask_human"
	| "needs_deeper_audit"
	| "block";

export type OrchestratorAdvisory = {
	audience: OrchestratorAdvisoryAudience;
	severity: OrchestratorAdvisorySeverity;
	recommendation: OrchestratorRecommendation;
	confidence: number;
	summary: string;
	alignment: string;
	recommendedNext: string[];
	requiresHuman: boolean;
	evidenceRefs: string[];
	contractsAffected: string[];
	requiredReads: string[];
	suggestedAgentLabs: string[];
	orchestratorGuidance: string[];
};

export function buildPreflightOrchestratorAdvisory(
	report: ProjectPreflightReport,
): OrchestratorAdvisory {
	const requiresHuman =
		report.requiresHumanConfirmation || report.risk === "blocker";
	const recommendation = recommendationFromPreflight(report);
	return {
		audience: "orchestrator",
		severity:
			report.risk === "blocker"
				? "needs_approval"
				: requiresHuman
					? "needs_approval"
					: report.risk === "medium" || report.risk === "high"
						? "warning"
						: "info",
		recommendation,
		confidence: confidenceFromRisk(report.risk),
		summary: requiresHuman
			? "Supervisor detectó riesgo antes de ejecutar."
			: "Supervisor no detectó bloqueo para esta intención.",
		alignment: alignmentFromAreas(report.affectedAreas),
		recommendedNext: compactActions([
			report.recommendedNext,
			...(report.shouldRunAgentLab
				? ["Pedir revisión AgentLab audit-only antes de aplicar."]
				: []),
			"El orquestador debe revalidar esta recomendación con sus subagentes antes de implementar.",
		]),
		requiresHuman,
		evidenceRefs: compactActions([
			`risk:${report.risk}`,
			`connection:${report.connectionStatus}`,
			...report.affectedAreas.map((area) => `area:${area}`),
			...(report.constitutionGate?.kind === "ran"
				? report.constitutionGate.result.affectedRules
				: []
			).map((rule) => `rule:${rule}`),
			...(report.constitutionGate?.kind === "skipped"
				? [`gate-skipped:${report.constitutionGate.reason}`]
				: []),
		]),
		contractsAffected: contractAreasFromImpact(report.affectedAreas),
		requiredReads: requiredReadsFromImpact(report.affectedAreas),
		suggestedAgentLabs: suggestedLabsFromImpact(report.affectedAreas),
		orchestratorGuidance: orchestratorGuidance(recommendation),
	};
}

export function buildProjectAdvisoryForOrchestrator(
	advisory: ProjectAdvisory,
): OrchestratorAdvisory {
	const requiresHuman =
		advisory.requiresHumanConfirmation || advisory.level === "blocker";
	const recommendation = recommendationFromAdvisoryLevel(advisory.level);
	return {
		audience: "orchestrator",
		severity:
			advisory.level === "blocker"
				? "needs_approval"
				: requiresHuman
					? "needs_approval"
					: advisory.level === "warning" || advisory.level === "risk"
						? "warning"
						: "info",
		recommendation,
		confidence: advisory.level === "info" ? 0.7 : 0.85,
		summary: advisory.title,
		alignment: alignmentFromAreas(advisory.affectedAreas),
		recommendedNext: compactActions([
			advisory.recommendation,
			...advisory.actions,
		]),
		requiresHuman,
		evidenceRefs: compactActions([
			`level:${advisory.level}`,
			...advisory.affectedAreas.map((area) => `area:${area}`),
			...(advisory.constitutionGate?.kind === "ran"
				? advisory.constitutionGate.result.affectedRules
				: []
			).map((rule) => `rule:${rule}`),
			...(advisory.constitutionGate?.kind === "skipped"
				? [`gate-skipped:${advisory.constitutionGate.reason}`]
				: []),
		]),
		contractsAffected: contractAreasFromImpact(advisory.affectedAreas),
		requiredReads: requiredReadsFromImpact(advisory.affectedAreas),
		suggestedAgentLabs: suggestedLabsFromImpact(advisory.affectedAreas),
		orchestratorGuidance: orchestratorGuidance(recommendation),
	};
}

export function buildSupervisorLoopOrchestratorAdvisory(
	result: IduSupervisorLoopResult,
): OrchestratorAdvisory {
	const recommendation = result.status === "warning" ? "ask_human" : "warn";
	return {
		audience: "orchestrator",
		severity:
			result.status === "warning"
				? "grave_failure"
				: result.reason === "idu_inactive"
					? "warning"
					: "info",
		recommendation,
		confidence: 0.75,
		summary: result.summary,
		alignment:
			result.reason === "idu_inactive"
				? "Supervisor inactivo: el orquestador no tiene guardrails automáticos."
				: "Supervisor mantuvo vigilancia sin aplicar cambios críticos.",
		recommendedNext: compactActions(result.recommendedNext),
		requiresHuman: result.status === "warning",
		evidenceRefs: compactActions([
			`trigger:${result.trigger}`,
			`status:${result.status}`,
			...(result.reason ? [`reason:${result.reason}`] : []),
			...result.steps.map((step) => `${step.name}:${step.status}`),
		]),
		contractsAffected: [],
		requiredReads: [],
		suggestedAgentLabs: [],
		orchestratorGuidance: orchestratorGuidance(recommendation),
	};
}

export function buildSupervisorHookOrchestratorAdvisory(
	result: IduSupervisorHookResult,
): OrchestratorAdvisory {
	const recommendation =
		result.reason === "supervisor_failed" ? "ask_human" : "warn";
	return {
		audience: result.reason === "supervisor_failed" ? "human" : "orchestrator",
		severity:
			result.reason === "supervisor_failed"
				? "grave_failure"
				: result.status === "warning"
					? "warning"
					: "info",
		recommendation,
		confidence: result.reason === "supervisor_failed" ? 0.9 : 0.75,
		summary: result.summary,
		alignment:
			result.reason === "supervisor_failed"
				? "El supervisor falló: el orquestador debe pausar y revisar antes de seguir en automático."
				: "Evento supervisado; no se aplicaron cambios críticos.",
		recommendedNext: compactActions([
			...(result.supervisor?.recommendedNext ?? []),
			...(result.warning ? [result.warning] : []),
		]),
		requiresHuman: result.reason === "supervisor_failed",
		evidenceRefs: compactActions([
			`trigger:${result.trigger}`,
			`status:${result.status}`,
			...(result.reason ? [`reason:${result.reason}`] : []),
		]),
		contractsAffected: [],
		requiredReads: [],
		suggestedAgentLabs: [],
		orchestratorGuidance: orchestratorGuidance(recommendation),
	};
}

function alignmentFromAreas(areas: string[]): string {
	const relevant = areas.filter(Boolean);
	if (!relevant.length) return "Sin desalineación visible contra el plan.";
	return `La intención impacta: ${relevant.slice(0, 4).join(", ")}.`;
}

function recommendationFromPreflight(
	report: ProjectPreflightReport,
): OrchestratorRecommendation {
	if (report.risk === "blocker") return "block";
	if (report.requiresHumanConfirmation) return "ask_human";
	if (report.shouldRunAgentLab) return "needs_deeper_audit";
	if (report.risk === "high") return "needs_deeper_audit";
	if (report.risk === "medium") return "warn";
	return "allow";
}

function recommendationFromAdvisoryLevel(
	level: ProjectAdvisory["level"],
): OrchestratorRecommendation {
	if (level === "blocker") return "block";
	if (level === "risk") return "needs_deeper_audit";
	if (level === "warning") return "warn";
	return "allow";
}

function confidenceFromRisk(risk: ProjectPreflightReport["risk"]): number {
	if (risk === "blocker") return 0.95;
	if (risk === "high") return 0.85;
	if (risk === "medium") return 0.75;
	return 0.7;
}

function contractAreasFromImpact(areas: string[]): string[] {
	const joined = areas.join(" ").toLowerCase();
	return compactActions([
		...(joined.match(/auth|login|session|token|security|seguridad/u)
			? ["auth", "security"]
			: []),
		...(joined.match(/db|database|datos|schema|migraci|supabase|postgres/u)
			? ["data"]
			: []),
		...(joined.match(/ui|frontend|html|css|button|form/u) ? ["frontend"] : []),
		...(joined.match(/api|route|endpoint|backend/u) ? ["api"] : []),
		...(areas.length ? ["agent"] : []),
	]);
}

function requiredReadsFromImpact(areas: string[]): string[] {
	const contracts = contractAreasFromImpact(areas);
	return compactActions([
		"Plan Maestro vigente",
		"Doc/<project>/01-contratos-operativos.generado.md",
		...(contracts.includes("auth")
			? [
					"Archivos de login/auth/session detectados",
					"Políticas de sesión y permisos",
				]
			: []),
		...(contracts.includes("data")
			? ["Migraciones/schema/base de datos", "Contratos Datos/DB"]
			: []),
		...(contracts.includes("frontend")
			? ["HTML/JS/CSS afectados", "Contrato Frontend/UI"]
			: []),
	]);
}

function suggestedLabsFromImpact(areas: string[]): string[] {
	const contracts = contractAreasFromImpact(areas);
	return compactActions([
		...(contracts.includes("auth") || contracts.includes("security")
			? ["security"]
			: []),
		...(contracts.includes("data") ? ["database"] : []),
		...(contracts.includes("frontend") || contracts.includes("api")
			? ["architecture"]
			: []),
		...(contracts.length ? ["code_quality"] : []),
	]);
}

function orchestratorGuidance(
	recommendation: OrchestratorRecommendation,
): string[] {
	return compactActions([
		"Idu-pi informa; el orquestador decide tras revalidar con sus subagentes.",
		"No uses AgentLabs para implementar; sólo para auditoría, pruebas y drift contra Plan Maestro.",
		...(recommendation === "allow"
			? ["Podés continuar con subagentes normales si el alcance es claro."]
			: []),
		...(recommendation === "warn"
			? ["Continuá con cautela y registra contrato afectado en la tarea."]
			: []),
		...(recommendation === "needs_deeper_audit"
			? [
					"Revalida con subagente especializado o AgentLab audit-only antes de escribir.",
				]
			: []),
		...(recommendation === "ask_human"
			? ["Pedí decisión humana antes de cambios de alto impacto."]
			: []),
		...(recommendation === "block"
			? [
					"Pausá ejecución hasta resolver el bloqueo explícito o recibir excepción humana.",
				]
			: []),
	]);
}

function compactActions(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
