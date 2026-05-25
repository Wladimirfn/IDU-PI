import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	reviewSemanticCompactionDraft,
	type SemanticCompactionDraft,
	type SemanticCompactionReview,
} from "./semantic-compaction.js";

export type SupervisorImprovementProposalType =
	| "intent_rule_update"
	| "skill_update"
	| "constitution_suggestion"
	| "project_core_review"
	| "classifier_review"
	| "workflow_improvement";

export type SupervisorImprovementRisk = "low" | "medium" | "high" | "critical";
export type SupervisorImprovementBenefit =
	| "quality"
	| "time"
	| "token_cost"
	| "safety"
	| "architecture_consistency";
export type SupervisorImprovementAction =
	| "approve_for_agent_review"
	| "approve_for_manual_apply"
	| "reject"
	| "defer";
export type SupervisorImprovementStatus =
	| "proposed"
	| "approved"
	| "rejected"
	| "deferred";

export type SupervisorImprovementProposal = {
	id: string;
	type: SupervisorImprovementProposalType;
	title: string;
	description: string;
	evidence: string[];
	sourceDraftPath: string;
	riskLevel: SupervisorImprovementRisk;
	expectedBenefit: SupervisorImprovementBenefit[];
	requiresHumanApproval: true;
	suggestedAction: SupervisorImprovementAction;
	status: SupervisorImprovementStatus;
	createdAt: string;
};

export type SupervisorImprovementPlan = {
	draftPath: string;
	sourceDraftPath: string;
	draftName: string;
	projectId: string;
	validDraft: boolean;
	errors: string[];
	proposals: SupervisorImprovementProposal[];
};

export type SupervisorImprovementCreationResult = {
	plan: SupervisorImprovementPlan;
	path?: string;
	created: SupervisorImprovementProposal[];
};

type BuildOptions = {
	maxProposals?: number;
	now?: () => Date;
};

const MAX_PROPOSALS = 10;

export function buildSupervisorImprovementPlan(
	pathOrLatest: string,
	reportsPath: string,
	options: BuildOptions = {},
): SupervisorImprovementPlan {
	const review = reviewSemanticCompactionDraft(pathOrLatest, reportsPath);
	if (!review.validDraft || !review.draft) {
		return {
			draftPath: review.path,
			sourceDraftPath: review.path,
			draftName: basename(review.path || pathOrLatest),
			projectId: review.draft?.projectId ?? "",
			validDraft: false,
			errors: review.errors,
			proposals: [],
		};
	}
	const draft = review.draft;
	const createdAt = (options.now?.() ?? new Date()).toISOString();
	const proposals = buildProposals({ ...review, draft }, createdAt)
		.sort(compareProposal)
		.slice(0, options.maxProposals ?? MAX_PROPOSALS)
		.map((proposal, index) => ({
			...proposal,
			id: `improvement-${String(index + 1).padStart(3, "0")}`,
		}));
	return {
		draftPath: review.path,
		sourceDraftPath: review.path,
		draftName: basename(review.path),
		projectId: review.draft.projectId,
		validDraft: true,
		errors: [],
		proposals,
	};
}

export function createSupervisorImprovementProposals(
	pathOrLatest: string,
	reportsPath: string,
	options: BuildOptions = {},
): SupervisorImprovementCreationResult {
	const plan = buildSupervisorImprovementPlan(
		pathOrLatest,
		reportsPath,
		options,
	);
	if (!plan.validDraft || plan.proposals.length === 0) {
		return { plan, created: [] };
	}
	const now = options.now?.() ?? new Date();
	const path = join(
		reportsPath,
		`supervisor-improvement-proposals-${timestamp(now)}.json`,
	);
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				warning: "Propuestas revisables. No aplicar sin aprobación humana.",
				createdAt: now.toISOString(),
				sourceDraftPath: plan.draftPath,
				projectId: plan.projectId,
				proposals: plan.proposals,
			},
			null,
			2,
		)}\n`,
	);
	return { plan, path, created: plan.proposals };
}

export function formatSupervisorImprovementPlan(
	plan: SupervisorImprovementPlan,
): string {
	if (!plan.validDraft) {
		return [
			"Supervisor Improvement Proposals",
			"",
			"Draft válido:",
			"no",
			"",
			"Errores:",
			...formatList(plan.errors),
			"",
			"Nota segura:",
			"No apliqué reglas, no modifiqué skills y no ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"Supervisor Improvement Proposals",
		"",
		"Draft:",
		plan.draftName,
		"",
		"Propuestas:",
		...formatProposals(plan.proposals),
		"",
		"Acción:",
		"Crear propuestas:",
		" /supervisor_improvements_create latest",
		" idu-pi supervisor-improvements-create latest",
		"",
		"Nota segura:",
		"No apliqué reglas, no modifiqué skills y no ejecuté AgentLabs.",
	].join("\n");
}

export function formatSupervisorImprovementCreationResult(
	result: SupervisorImprovementCreationResult,
): string {
	if (!result.plan.validDraft)
		return formatSupervisorImprovementPlan(result.plan);
	return [
		"Supervisor Improvement Proposals Created",
		"",
		"Ruta:",
		result.path ?? "-",
		"",
		"Creadas:",
		...(result.created.length
			? result.created.map(
					(proposal) => `- ${proposal.type} ${proposal.riskLevel}`,
				)
			: ["- ninguna"]),
		"",
		"Nota segura:",
		"Sólo guardé propuestas revisables. No apliqué cambios.",
	].join("\n");
}

function buildProposals(
	review: SemanticCompactionReview & { draft: SemanticCompactionDraft },
	createdAt: string,
): SupervisorImprovementProposal[] {
	const draft = review.draft;
	const proposals: SupervisorImprovementProposal[] = [];
	for (const group of groupByDomain(draft.suggestedRuleUpdates)) {
		proposals.push(
			proposal({
				type: "intent_rule_update",
				title: titleForRule(group.items),
				description:
					"Propuesta para ajustar reglas determinísticas de human-intent después de revisión humana.",
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel:
					/auth|db|database|base de datos|schema|security|seguridad/iu.test(
						group.key,
					)
						? "high"
						: "medium",
				expectedBenefit: ["quality", "safety", "token_cost"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	for (const group of groupByDomain(draft.suggestedSkillUpdates)) {
		proposals.push(
			proposal({
				type: "skill_update",
				title: titleForSkill(group.items),
				description:
					"Propuesta para revisar o mejorar skills; no modifica archivos de skills automáticamente.",
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel: "medium",
				expectedBenefit: ["quality", "safety"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	const classifierEvidence = [
		...draft.classifierQualityReview.falsePositives,
		...draft.classifierQualityReview.falseNegatives,
		...draft.classifierQualityReview.errorPatterns,
		...draft.classifierQualityReview.recommendedRules,
		...draft.misclassifiedExamples.map((item) => {
			const record = item as unknown as Record<string, unknown>;
			return [record.originalText, record.actual, record.expected]
				.filter(Boolean)
				.join(" -> ");
		}),
	].filter(Boolean);
	if (
		classifierEvidence.length > 0 ||
		[
			draft.classifierQualityReview.emotionCorrect,
			draft.classifierQualityReview.categoryCorrect,
			draft.classifierQualityReview.priorityCorrect,
			draft.classifierQualityReview.intentCorrect,
			draft.classifierQualityReview.guardrailCorrect,
		].includes("needs_review")
	) {
		proposals.push(
			proposal({
				type: "classifier_review",
				title: "Revisar clasificador human-intent",
				description:
					"Revisar falsos positivos, falsos negativos y patrones de error del classifier human-intent.",
				evidence: classifierEvidence.slice(0, 8),
				sourceDraftPath: review.path,
				riskLevel: "high",
				expectedBenefit: ["quality", "safety", "token_cost"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	for (const group of groupByDomain(draft.preservedRules)) {
		if (
			!/auth|db|database|schema|confirmaci|constitution|regla/iu.test(group.key)
		)
			continue;
		proposals.push(
			proposal({
				type: "constitution_suggestion",
				title: "Revisar regla de Constitution",
				description:
					"Evaluar si una regla preservada debe formalizarse o reforzarse en Constitution; no se aplica automáticamente.",
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel: "high",
				expectedBenefit: ["safety", "architecture_consistency"],
				suggestedAction: "approve_for_manual_apply",
				createdAt,
			}),
		);
	}
	if (
		draft.architecturalRisks.length ||
		/Project Core/iu.test(draft.suggestedAgentTasks.join(" "))
	) {
		proposals.push(
			proposal({
				type: "project_core_review",
				title: "Revisar Project Core vs código real",
				description:
					"Validar consistencia entre Project Core, Constitution y comportamiento real antes de actualizar verdad del proyecto.",
				evidence: [
					...draft.architecturalRisks,
					...draft.suggestedAgentTasks.filter((item) =>
						/project core|constitution|arquitect/iu.test(item),
					),
				],
				sourceDraftPath: review.path,
				riskLevel: "medium",
				expectedBenefit: ["architecture_consistency", "quality"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	for (const group of groupByDomain([
		...draft.criticalBugs.map(recordTitle),
		...draft.reusableLessons,
	])) {
		if (
			!/sí|si|no|queue|cola|prompt|stop|parada|cancel|ui|workflow|flujo/iu.test(
				group.key,
			)
		)
			continue;
		proposals.push(
			proposal({
				type: "workflow_improvement",
				title: titleForWorkflow(group.items),
				description:
					"Propuesta para revisar un flujo operativo que causó ruido, cola incorrecta o pérdida de control humano.",
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel: /critical|crítico|critico/iu.test(group.items.join(" "))
					? "critical"
					: "high",
				expectedBenefit: ["quality", "time", "safety"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	return dedupeProposals(proposals);
}

function proposal(
	input: Omit<
		SupervisorImprovementProposal,
		"id" | "requiresHumanApproval" | "status"
	>,
): SupervisorImprovementProposal {
	return {
		id: "pending",
		...input,
		evidence: input.evidence.map(short).filter(Boolean).slice(0, 8),
		requiresHumanApproval: true,
		status: "proposed",
	};
}

function groupByDomain(
	items: string[],
): Array<{ key: string; items: string[] }> {
	const groups = new Map<string, string[]>();
	for (const item of items.map((value) => value.trim()).filter(Boolean)) {
		const key = domainKey(item);
		const current = groups.get(key) ?? [];
		if (!current.some((existing) => normalize(existing) === normalize(item))) {
			current.push(item);
		}
		groups.set(key, current);
	}
	return [...groups.entries()].map(([key, groupItems]) => ({
		key,
		items: groupItems,
	}));
}

function dedupeProposals(
	proposals: SupervisorImprovementProposal[],
): SupervisorImprovementProposal[] {
	const seen = new Set<string>();
	return proposals.filter((proposalItem) => {
		const key = `${proposalItem.type}:${domainKey(`${proposalItem.title} ${proposalItem.evidence.join(" ")}`)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function compareProposal(
	left: SupervisorImprovementProposal,
	right: SupervisorImprovementProposal,
): number {
	const riskOrder: Record<SupervisorImprovementRisk, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
	};
	return riskOrder[left.riskLevel] - riskOrder[right.riskLevel];
}

function titleForRule(items: string[]): string {
	const text = items.join(" ");
	if (/db|database|base de datos|schema/iu.test(text))
		return "Clasificar fallas de base de datos como bug/database/high";
	if (/auth|login|loggin|session|entrar/iu.test(text))
		return "Clasificar fallas auth/login como high risk";
	return `Revisar regla de intención: ${short(items[0] ?? "regla")}`;
}

function titleForSkill(items: string[]): string {
	const text = items.join(" ");
	if (/auth|login|security|seguridad/iu.test(text))
		return "Mejorar skill de seguridad auth/login";
	if (/db|database|schema|sql/iu.test(text)) return "Mejorar skill DB/schema";
	return `Revisar skill sugerida: ${short(items[0] ?? "skill")}`;
}

function titleForWorkflow(items: string[]): string {
	const text = items.join(" ");
	if (/sí|si|no/iu.test(text))
		return "Evitar que respuestas Sí/No se encolen como prompts";
	if (/stop|parada|cancel/iu.test(text))
		return "Evitar que comandos de parada se transformen en tareas";
	return `Revisar mejora de workflow: ${short(items[0] ?? "flujo")}`;
}

function domainKey(text: string): string {
	if (/auth|login|loggin|session|token|seguridad|security/iu.test(text))
		return "auth-login";
	if (/db|database|base de datos|schema|sql|sqlite|postgres/iu.test(text))
		return "database-schema";
	if (
		/classifier|clasificador|intent|intenci|false positive|false negative|loggin/iu.test(
			text,
		)
	)
		return "classifier";
	if (/skill|habilidad/iu.test(text)) return "skill";
	if (/project core|constitution|blueprint|flow|arquitect/iu.test(text))
		return "project-core";
	if (
		/sí|si|no|queue|cola|prompt|stop|parada|cancel|ui|workflow|flujo/iu.test(
			text,
		)
	)
		return "workflow";
	return normalize(text).slice(0, 80);
}

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function recordTitle(record: Record<string, unknown>): string {
	return [record.title, record.severity, record.evidence]
		.map((value) => (typeof value === "string" ? value : ""))
		.filter(Boolean)
		.join(" — ");
}

function short(text: string): string {
	const compact = text.replace(/\s+/gu, " ").trim();
	return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function formatProposals(proposals: SupervisorImprovementProposal[]): string[] {
	if (!proposals.length) return ["- ninguna"];
	return proposals.flatMap((proposalItem, index) => [
		`${index + 1}. ${proposalItem.type} — ${proposalItem.riskLevel}`,
		`   Título: ${proposalItem.title}`,
		`   Beneficio: ${proposalItem.expectedBenefit.join(", ")}`,
		"   Evidencia:",
		...(proposalItem.evidence.length
			? proposalItem.evidence.slice(0, 3).map((item) => `   - ${item}`)
			: ["   - sin evidencia detallada"]),
		`   Acción recomendada: ${proposalItem.suggestedAction}`,
		"   Requiere aprobación humana: sí",
	]);
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function timestamp(date: Date): string {
	const compact = date
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14);
	return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
}
