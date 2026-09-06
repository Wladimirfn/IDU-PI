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
	// Issue #427: the perception layer (humanIntent) computes a judgment
	// about whether the system understood the request. Until this fix that
	// judgment lived in `report.humanIntent.shouldAskClarification` but
	// never reached the verdict — an absurd input with low risk would still
	// produce `allow`. We wire the perception signal into the verdict so
	// the envelope (and the orchestrator reading it) reflect the doubt.
	// Issue #445: extend the perception signal so the summary also
	// surfaces the human state (emotion + urgency + recommendedHandling)
	// when it has something to say. v1 stays inform-only: the recommendation
	// and severity logic above is intact; the perception state only flows
	// into the summary text and evidenceRefs. Raising severity from a
	// detected emotion is more powerful and more risky — a false positive
	// stops legitimate work — and belongs to a future change with
	// calibration evidence.
	//
	// Deferred follow-ups:
	//   - Q3: registering the classification in the turn event for later
	//     measurement (paired events from #425 already provide a slot in
	//     role-events.ts:148; we don't change the event schema here).
	//   - Q4: connecting recommendedHandling:"needs_confirmation" to the
	//     confirmation gate from #430 (separate issue).
	//
	// Recorded design decision (operator audit, v1):
	//   When `requiresHuman` is true and `perceptionUnclear` is false
	//   (the risk-driven confirmation path), the perception phrase is
	//   dropped from the summary. A human with a detected emotion who
	//   triggers a high-risk request sees only "Supervisor detectó
	//   riesgo antes de ejecutar." — the perception state is not
	//   surfaced. The trade-off: the risk verdict already carries the
	//   human-confirmation ask; raising the perception's visibility on
	//   the risk path is a separate decision with calibration
	//   implications. Surfacing the phrase on this path is the natural
	//   extension once we have calibration data — recorded here so the
	//   asymmetry is explicit, not a silent omission.
	const perceptionUnclear = report.humanIntent?.shouldAskClarification === true;
	const perceptionAmbiguity = report.humanIntent?.ambiguity ?? [];
	const perceptionEmotion = report.humanIntent?.emotion ?? "neutral";
	const perceptionUrgency = report.humanIntent?.urgency ?? 1;
	const perceptionHandling = report.humanIntent?.recommendedHandling;

	// The neutral + low-urgency path is the default and must remain silent;
	// surfacing the perception on every preflight would pollute the summary
	// for the common case where the human state is unremarkable. The ||
	// here is the binding rule — tested with the mixed edge in
	// `alignmentAdvisory.summary mentions human state when emotion is
	// non-neutral but urgency is low` (issue #445 follow-up).
	const perceptionHasSomethingToSay =
		perceptionEmotion !== "neutral" || perceptionUrgency >= 4;

	const perceptionPhrase = perceptionHasSomethingToSay
		? `Estado del humano detectado: ${perceptionEmotion} (urgency ${perceptionUrgency}/5).`
		: null;

	const requiresHuman =
		report.requiresHumanConfirmation ||
		report.risk === "blocker" ||
		perceptionUnclear;

	const baseRecommendation = recommendationFromPreflight(report);
	// Don't downgrade a stricter verdict. Only escalate `allow` to
	// `ask_human` when the perception layer flagged the request as
	// unclear; `warn` / `needs_deeper_audit` / `block` already carry
	// more weight than `ask_human` would.
	const recommendation: OrchestratorRecommendation =
		perceptionUnclear && baseRecommendation === "allow"
			? "ask_human"
			: baseRecommendation;

	// When perception flags uncertainty, cap confidence well below 0.5 so
	// the envelope is visibly different from a clean `allow` (which lands
	// at 0.7). A low confidence on `ask_human` tells the agent "I am
	// asking you to clarify" rather than "I am uncertain and you can
	// proceed".
	const confidence = perceptionUnclear
		? Math.min(confidenceFromRisk(report.risk), 0.4)
		: confidenceFromRisk(report.risk);

	// The perception phrase is appended only on the "no requiere humano"
	// branch. On the "requires human" branch the phrase is dropped by
	// design (see the recorded decision above): the perceptionUnclear path
	// already calls out the perception explicitly, and the risk-driven
	// path keeps the perception out of v1. Surfacing the phrase on the
	// risk path is the natural extension once there is calibration data.
	const summary = requiresHuman
		? perceptionUnclear
			? "Perception no entendió la intención; pedir aclaración antes de ejecutar."
			: "Supervisor detectó riesgo antes de ejecutar."
		: perceptionPhrase
			? `Supervisor no detectó bloqueo para esta intención. ${perceptionPhrase}`
			: "Supervisor no detectó bloqueo para esta intención.";

	// Non-default recommendedHandling values appear in evidenceRefs so the
	// consumer can distinguish "the classifier recommended handling" from
	// "the risk analyzer escalated". The default values (record_only /
	// preflight / safe_to_execute) are silently equivalent to no-handling.
	const perceptionHandlingRef =
		perceptionHandling &&
		perceptionHandling !== "record_only" &&
		perceptionHandling !== "preflight" &&
		perceptionHandling !== "safe_to_execute"
			? [`handling:${perceptionHandling}`]
			: [];

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
		confidence,
		summary,
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
			...(perceptionUnclear
				? perceptionAmbiguity.map((reason) => `ambiguity:${reason}`)
				: []),
			...perceptionHandlingRef,
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
		orchestratorGuidance: perceptionUnclear
			? compactActions([
					...orchestratorGuidance(recommendation),
					...perceptionAmbiguity.map(
						(reason) => `Perception flagged: ${reason}`,
					),
				])
			: orchestratorGuidance(recommendation),
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
