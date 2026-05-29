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

export type OrchestratorAdvisory = {
	audience: OrchestratorAdvisoryAudience;
	severity: OrchestratorAdvisorySeverity;
	summary: string;
	alignment: string;
	recommendedNext: string[];
	requiresHuman: boolean;
	evidenceRefs: string[];
};

export function buildPreflightOrchestratorAdvisory(
	report: ProjectPreflightReport,
): OrchestratorAdvisory {
	const requiresHuman = report.requiresHumanConfirmation || report.risk === "blocker";
	return {
		audience: "orchestrator",
		severity: report.risk === "blocker" ? "needs_approval" : requiresHuman ? "needs_approval" : report.risk === "medium" ? "warning" : "info",
		summary: requiresHuman
			? "Supervisor detectó riesgo antes de ejecutar."
			: "Supervisor no detectó bloqueo para esta intención.",
		alignment: alignmentFromAreas(report.affectedAreas),
		recommendedNext: compactActions([
			report.recommendedNext,
			...(report.shouldRunAgentLab ? ["Pedir revisión AgentLab antes de aplicar."] : []),
		]),
		requiresHuman,
		evidenceRefs: compactActions([
			`risk:${report.risk}`,
			`connection:${report.connectionStatus}`,
			...report.affectedAreas.map((area) => `area:${area}`),
			...(report.constitutionGate?.affectedRules ?? []).map(
				(rule) => `rule:${rule}`,
			),
		]),
	};
}

export function buildProjectAdvisoryForOrchestrator(
	advisory: ProjectAdvisory,
): OrchestratorAdvisory {
	const requiresHuman = advisory.requiresHumanConfirmation || advisory.level === "blocker";
	return {
		audience: "orchestrator",
		severity: advisory.level === "blocker" ? "needs_approval" : requiresHuman ? "needs_approval" : advisory.level === "warning" || advisory.level === "risk" ? "warning" : "info",
		summary: advisory.title,
		alignment: alignmentFromAreas(advisory.affectedAreas),
		recommendedNext: compactActions([advisory.recommendation, ...advisory.actions]),
		requiresHuman,
		evidenceRefs: compactActions([
			`level:${advisory.level}`,
			...advisory.affectedAreas.map((area) => `area:${area}`),
			...(advisory.constitutionGate?.affectedRules ?? []).map(
				(rule) => `rule:${rule}`,
			),
		]),
	};
}

export function buildSupervisorLoopOrchestratorAdvisory(
	result: IduSupervisorLoopResult,
): OrchestratorAdvisory {
	return {
		audience: "orchestrator",
		severity: result.status === "warning" ? "grave_failure" : result.reason === "idu_inactive" ? "warning" : "info",
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
	};
}

export function buildSupervisorHookOrchestratorAdvisory(
	result: IduSupervisorHookResult,
): OrchestratorAdvisory {
	return {
		audience: result.reason === "supervisor_failed" ? "human" : "orchestrator",
		severity: result.reason === "supervisor_failed" ? "grave_failure" : result.status === "warning" ? "warning" : "info",
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
	};
}

function alignmentFromAreas(areas: string[]): string {
	const relevant = areas.filter(Boolean);
	if (!relevant.length) return "Sin desalineación visible contra el plan.";
	return `La intención impacta: ${relevant.slice(0, 4).join(", ")}.`;
}

function compactActions(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
