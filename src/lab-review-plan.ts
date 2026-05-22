import type {
	ProjectPostflightReport,
	ProjectPostflightRisk,
} from "./project-postflight.js";
import type {
	ProjectPreflightReport,
	ProjectPreflightRisk,
} from "./project-preflight.js";
import type { StructuredTaskInput } from "./structured-task-queue.js";

export type LabReviewRisk = ProjectPostflightRisk | ProjectPreflightRisk;

export type LabReviewPlanInput = {
	postflightReport?: ProjectPostflightReport;
	preflightReport?: ProjectPreflightReport;
	projectId?: string;
	requestText?: string;
};

export type LabReviewPlan = {
	shouldReview: boolean;
	risk: LabReviewRisk;
	affectedAreas: string[];
	suggestedAgentLabs: string[];
	structuredTaskInput?: StructuredTaskInput;
	warnings: string[];
	recommendedNext: string;
};

export function buildLabReviewPlan(input: LabReviewPlanInput): LabReviewPlan {
	const risk =
		input.postflightReport?.risk ?? input.preflightReport?.risk ?? "low";
	const affectedAreas = affectedAreasFor(input);
	const warnings = warningsFor(input);
	const suggestedAgentLabs = dedupe([
		...labsFromAreas(affectedAreas),
		...labsFromWarnings(warnings),
		...normalizePostflightLabs(
			input.postflightReport?.suggestedAgentLabs ?? [],
		),
	]);
	const shouldReview =
		risk === "medium" || risk === "high" || risk === "blocker";
	const recommendedNext = shouldReview
		? "Crear tarea de revisión y esperar confirmación humana antes de ejecutar AgentLabs."
		: "No se requiere revisión AgentLab para este riesgo.";
	return {
		shouldReview,
		risk,
		affectedAreas,
		suggestedAgentLabs,
		...(shouldReview
			? {
					structuredTaskInput: structuredTaskInput(
						input,
						risk,
						affectedAreas,
						suggestedAgentLabs,
					),
				}
			: {}),
		warnings,
		recommendedNext,
	};
}

export function formatLabReviewPlan(plan: LabReviewPlan): string {
	return [
		"Lab Review Plan Idu-pi",
		"",
		"Riesgo:",
		plan.risk,
		"",
		"Revisión requerida:",
		String(plan.shouldReview),
		"",
		"Áreas afectadas:",
		formatList(plan.affectedAreas),
		"",
		"AgentLabs sugeridos:",
		formatList(plan.suggestedAgentLabs),
		"",
		"Warnings:",
		formatList(plan.warnings),
		"",
		"Comandos sugeridos:",
		formatList(commands(plan)),
		"",
		"Tarea estructurada:",
		plan.structuredTaskInput
			? `${plan.structuredTaskInput.category} | ${plan.structuredTaskInput.text}`
			: "- no creada",
		"",
		"Recomendación:",
		plan.recommendedNext,
		"",
		"Nota segura:",
		"No ejecuté AgentLabs; solo preparé el plan para decisión humana/orquestador.",
	].join("\n");
}

function affectedAreasFor(input: LabReviewPlanInput): string[] {
	return dedupe([
		...(input.postflightReport?.impactedAreas ?? []),
		...(input.preflightReport?.affectedAreas ?? []),
	]);
}

function warningsFor(input: LabReviewPlanInput): string[] {
	return dedupe([
		...(input.postflightReport?.warnings ?? []),
		...(input.preflightReport?.missingContext ?? []),
		...(input.preflightReport?.warnings ?? []),
	]);
}

function labsFromAreas(areas: string[]): string[] {
	const labs: string[] = [];
	for (const area of areas.map((value) => value.toLowerCase())) {
		if (/db|storage|datos/u.test(area)) labs.push("database");
		if (/seguridad|auth|security|env|secret/u.test(area)) labs.push("security");
		if (
			/project-flows|blueprint|\bmap\b|mapa|arquitectura|módulo|modulo|flujos/u.test(
				area,
			)
		) {
			labs.push("architecture");
		}
		if (/orquestaci|orchestration|index|agentrouter|lab|queue/u.test(area))
			labs.push("code_quality");
		if (/ui|html|components|pages|interfaz/u.test(area)) labs.push("ui_ux");
		if (/performance|build|test/u.test(area)) labs.push("performance");
	}
	return labs;
}

function labsFromWarnings(warnings: string[]): string[] {
	return labsFromAreas(warnings);
}

function normalizePostflightLabs(labs: string[]): string[] {
	return labs.map((lab) => {
		switch (lab) {
			case "db-storage":
				return "database";
			case "seguridad":
				return "security";
			case "project-understanding":
			case "arquitectura":
				return "architecture";
			default:
				return lab;
		}
	});
}

function structuredTaskInput(
	input: LabReviewPlanInput,
	risk: LabReviewRisk,
	affectedAreas: string[],
	suggestedAgentLabs: string[],
): StructuredTaskInput {
	const request =
		input.requestText ?? input.preflightReport?.request ?? "postflight actual";
	return {
		text: [
			`Revisar riesgo ${risk}: ${request}`,
			`Áreas: ${affectedAreas.join(", ") || "ninguna"}`,
			`AgentLabs sugeridos: ${suggestedAgentLabs.join(", ") || "ninguno"}`,
		].join("\n"),
		category: "review",
		priority: risk === "blocker" ? 1 : risk === "high" ? 2 : 3,
		source: "lab_review_plan",
		...(input.projectId ? { projectId: input.projectId } : {}),
	};
}

function commands(plan: LabReviewPlan): string[] {
	if (!plan.shouldReview) return ["/postflight"];
	return [
		"/postflight",
		"/preflight <solicitud>",
		"confirmar ejecución AgentLab manualmente",
	];
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}
