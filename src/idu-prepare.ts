import type { InitProjectConfigResult } from "./config-wizard.js";
import { buildLabReviewPlan } from "./lab-review-plan.js";
import type {
	ProjectAlignmentStatus,
	ProjectConfigStatus,
	ProjectConnectionReport,
	ProjectReadiness,
} from "./project-connection.js";
import type { ProjectFlows } from "./project-flows.js";
import type { ProjectFlowDraftReview } from "./project-map-scanner.js";
import type { ProjectPostflightReport } from "./project-postflight.js";
import type { StructuredTaskInput } from "./structured-task-queue.js";

export type IduPrepareStepStatus = "skipped" | "completed" | "failed";

export type IduPrepareStep = {
	id:
		| "inspect_connection"
		| "init_project_config"
		| "inspect_project_map"
		| "scan_project_map"
		| "suggest_project_flows"
		| "draft_project_flows"
		| "review_project_flows_draft"
		| "postflight"
		| "lab_review_plan";
	status: IduPrepareStepStatus;
	summary: string;
	error?: string;
};

export type ProjectAlignmentDiffCounts = {
	screens: number;
	uiElements: number;
	dataStores: number;
	flows: number;
};

export type IduPrepareResult = {
	projectId: string;
	projectPath: string;
	initialStatus: string;
	configStatus: ProjectConfigStatus;
	alignmentStatus: ProjectAlignmentStatus;
	readiness: ProjectReadiness;
	differencesDetected: ProjectAlignmentDiffCounts;
	steps: IduPrepareStep[];
	errors: string[];
	finalRisk: ProjectPostflightReport["risk"];
	draftPath?: string;
	labReviewTaskId?: string;
	labReviewTaskInput?: StructuredTaskInput;
	recommendedNext: string;
	suggestedActions: string[];
};

type StepId = IduPrepareStep["id"];

type IduPrepareDependencies = {
	projectId: string;
	projectPath: string;
	reportsPath: string;
	inspectConnection: () => ProjectConnectionReport;
	initProjectConfig: () => InitProjectConfigResult;
	inspectProjectMap: () => unknown;
	loadProjectFlows: () => ProjectFlows;
	scanProjectMap: (flows: ProjectFlows) => unknown;
	suggestProjectFlows: (flows: ProjectFlows) => unknown;
	draftProjectFlows: (flows: ProjectFlows) => {
		path: string;
		suggestions?: unknown;
	};
	reviewProjectFlowsDraft: (
		draftPathOrLatest: string,
		flows: ProjectFlows,
	) => ProjectFlowDraftReview | { valid?: boolean; errors?: string[] };
	postflight: () => ProjectPostflightReport;
	createStructuredTask: (input: StructuredTaskInput) => { id: string };
};

export function runIduPrepare(
	options: IduPrepareDependencies,
): IduPrepareResult {
	const steps: IduPrepareStep[] = [];
	const errors: string[] = [];
	let connection: ProjectConnectionReport | undefined;
	let flows: ProjectFlows | undefined;
	let draftPath: string | undefined;
	let postflightReport: ProjectPostflightReport | undefined;
	let labReviewTaskId: string | undefined;
	let labReviewTaskInput: StructuredTaskInput | undefined;
	let differencesDetected: ProjectAlignmentDiffCounts = emptyDifferences();
	let suggestionsWereCalculated = false;
	let scanCompleted = false;
	let initCompleted = false;

	function record(step: IduPrepareStep): void {
		steps.push(step);
		if (step.status === "failed" && step.error)
			errors.push(`${step.id}: ${step.error}`);
	}

	connection = safeStep(
		record,
		"inspect_connection",
		() => options.inspectConnection(),
		(report) => `${report.status}`,
	);

	const initialStatus = connection?.status ?? "unknown";
	const canUseProject = Boolean(
		connection?.projectPath &&
			connection.status !== "not_connected" &&
			connection.status !== "unknown_project" &&
			connection.status !== "broken_connection",
	);
	const missingLocalConfig = Boolean(
		canUseProject &&
			connection &&
			(!connection.blueprint?.exists ||
				!connection.flows?.exists ||
				connection.status === "needs_understanding"),
	);

	if (missingLocalConfig) {
		safeStep(
			record,
			"init_project_config",
			options.initProjectConfig,
			(result) => {
				initCompleted = true;
				const created = result.created.length
					? result.created.join(", ")
					: "ninguno";
				const existing = result.existing.length
					? result.existing.join(", ")
					: "ninguno";
				return `creados: ${created}; existentes: ${existing}`;
			},
		);
	} else {
		record({
			id: "init_project_config",
			status: "skipped",
			summary: canUseProject
				? "config project-local existente o conexión no requiere inicialización"
				: "sin proyecto válido para inicializar",
		});
	}

	if (canUseProject) {
		safeStep(
			record,
			"inspect_project_map",
			options.inspectProjectMap,
			() => "mapa inspeccionado",
		);
		flows = safeStep(
			record,
			"scan_project_map",
			() => {
				const currentFlows = options.loadProjectFlows();
				options.scanProjectMap(currentFlows);
				scanCompleted = true;
				return currentFlows;
			},
			() => "escaneo completado",
		);

		const flowsForSuggestions =
			flows ?? safeLoadFlows(options.loadProjectFlows);
		if (flowsForSuggestions) {
			safeStep(
				record,
				"suggest_project_flows",
				() => options.suggestProjectFlows(flowsForSuggestions),
				(result) => {
					suggestionsWereCalculated = true;
					differencesDetected = countDifferences(result);
					return "sugerencias calculadas";
				},
			);
			const draft = safeStep(
				record,
				"draft_project_flows",
				() => options.draftProjectFlows(flowsForSuggestions),
				(result) => {
					draftPath = result.path;
					return `draft: ${result.path}`;
				},
			);
			const reviewFlows = flows ?? flowsForSuggestions;
			safeStep(
				record,
				"review_project_flows_draft",
				() =>
					options.reviewProjectFlowsDraft(draft?.path ?? "latest", reviewFlows),
				(result) =>
					`valid: ${String(result.valid ?? false)}${result.errors?.length ? `; errores: ${result.errors.join("; ")}` : ""}`,
			);
		} else {
			record({
				id: "suggest_project_flows",
				status: "skipped",
				summary: "sin flows válidos para sugerir",
			});
			record({
				id: "draft_project_flows",
				status: "skipped",
				summary: "sin sugerencias disponibles",
			});
			record({
				id: "review_project_flows_draft",
				status: "skipped",
				summary: "sin draft disponible",
			});
		}
	} else {
		for (const id of [
			"inspect_project_map",
			"scan_project_map",
			"suggest_project_flows",
			"draft_project_flows",
			"review_project_flows_draft",
		] as StepId[]) {
			record({ id, status: "skipped", summary: "sin proyecto válido" });
		}
	}

	if (canUseProject) {
		postflightReport = safeStep(
			record,
			"postflight",
			options.postflight,
			(report) => `riesgo ${report.risk}`,
		);
	} else {
		record({
			id: "postflight",
			status: "skipped",
			summary: "sin proyecto conectado válido",
		});
	}

	if (postflightReport && isReviewRisk(postflightReport.risk)) {
		safeStep(
			record,
			"lab_review_plan",
			() => {
				const plan = buildLabReviewPlan({
					postflightReport,
					projectId: options.projectId,
				});
				if (!plan.structuredTaskInput) return { plan, task: undefined };
				const task = options.createStructuredTask(plan.structuredTaskInput);
				labReviewTaskId = task.id;
				labReviewTaskInput = plan.structuredTaskInput;
				return { plan, task };
			},
			(result) =>
				result.task ? `preparado: ${result.task.id}` : "no requerido",
		);
	} else {
		record({
			id: "lab_review_plan",
			status: "skipped",
			summary: postflightReport
				? "postflight low; no requiere revisión AgentLab"
				: "sin postflight válido",
		});
	}

	const finalRisk = postflightReport?.risk ?? "low";
	const configStatus = finalConfigStatus(connection, initCompleted);
	const alignmentStatus = determineAlignmentStatus({
		canUseProject,
		configStatus,
		scanCompleted,
		suggestionsWereCalculated,
		differencesDetected,
		postflightReport,
	});
	const readiness = determineReadiness(configStatus, alignmentStatus);
	return {
		projectId: options.projectId,
		projectPath: options.projectPath,
		initialStatus,
		configStatus,
		alignmentStatus,
		readiness,
		differencesDetected,
		steps,
		errors,
		finalRisk,
		...(draftPath ? { draftPath } : {}),
		...(labReviewTaskId ? { labReviewTaskId } : {}),
		...(labReviewTaskInput ? { labReviewTaskInput } : {}),
		recommendedNext: recommendedNext(finalRisk, differencesDetected),
		suggestedActions: suggestedActions(finalRisk, differencesDetected),
	};
}

export function formatIduPrepareResult(result: IduPrepareResult): string {
	return [
		"Idu-pi Prepare",
		"",
		"Proyecto:",
		result.projectId,
		"",
		"Ruta:",
		result.projectPath,
		"",
		"Estado inicial:",
		result.initialStatus,
		"",
		"configStatus final:",
		result.configStatus,
		"",
		"alignmentStatus final:",
		result.alignmentStatus,
		"",
		"readiness final:",
		result.readiness,
		"",
		"Diferencias detectadas:",
		`- screens sugeridas: ${result.differencesDetected.screens}`,
		`- uiElements sugeridos: ${result.differencesDetected.uiElements}`,
		`- dataStores sugeridos: ${result.differencesDetected.dataStores}`,
		`- flows sugeridos: ${result.differencesDetected.flows}`,
		"",
		"Resultado:",
		...result.steps.map(formatStep),
		"",
		"Errores:",
		formatList(result.errors),
		"",
		"Riesgo final:",
		result.finalRisk,
		"",
		"Draft generado:",
		result.draftPath ?? "- ninguno",
		"",
		"Tarea AgentLab:",
		result.labReviewTaskId
			? `${result.labReviewTaskId} | review`
			: "- no creada",
		"",
		"Siguiente recomendado:",
		result.recommendedNext,
		"",
		"Acciones:",
		...result.suggestedActions.map(
			(action, index) => `${index + 1}. ${action}`,
		),
		"",
		"Nota segura:",
		"No ejecuté AgentLabs, no apliqué project-flows, no usé IA y no ejecuté código del proyecto.",
	].join("\n");
}

function emptyDifferences(): ProjectAlignmentDiffCounts {
	return { screens: 0, uiElements: 0, dataStores: 0, flows: 0 };
}

function countDifferences(value: unknown): ProjectAlignmentDiffCounts {
	if (!isRecord(value)) return emptyDifferences();
	return {
		screens: arrayLength(value.screens),
		uiElements: arrayLength(value.uiElements),
		dataStores: arrayLength(value.dataStores),
		flows: arrayLength(value.flows),
	};
}

function totalDifferences(differences: ProjectAlignmentDiffCounts): number {
	return (
		differences.screens +
		differences.uiElements +
		differences.dataStores +
		differences.flows
	);
}

function determineAlignmentStatus(options: {
	canUseProject: boolean;
	configStatus: ProjectConfigStatus;
	scanCompleted: boolean;
	suggestionsWereCalculated: boolean;
	differencesDetected: ProjectAlignmentDiffCounts;
	postflightReport: ProjectPostflightReport | undefined;
}): ProjectAlignmentStatus {
	if (
		!options.canUseProject ||
		options.configStatus !== "project_local_valid"
	) {
		return "unknown";
	}
	if (!options.scanCompleted || !options.suggestionsWereCalculated) {
		return "pending_scan";
	}
	if (totalDifferences(options.differencesDetected) > 0) {
		return "needs_review";
	}
	if ((options.postflightReport?.changedFiles.length ?? 0) > 0) {
		return "stale";
	}
	if (options.postflightReport?.risk === "low") {
		return "aligned";
	}
	return "needs_review";
}

function determineReadiness(
	configStatus: ProjectConfigStatus,
	alignmentStatus: ProjectAlignmentStatus,
): ProjectReadiness {
	if (configStatus !== "project_local_valid") return "not_ready";
	if (alignmentStatus === "aligned") return "aligned_ready";
	return "config_ready";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function safeStep<T>(
	record: (step: IduPrepareStep) => void,
	id: StepId,
	action: () => T,
	summary: (value: T) => string,
): T | undefined {
	try {
		const value = action();
		record({ id, status: "completed", summary: summary(value) });
		return value;
	} catch (error) {
		record({
			id,
			status: "failed",
			summary: "falló",
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

function safeLoadFlows(
	loadProjectFlows: () => ProjectFlows,
): ProjectFlows | undefined {
	try {
		return loadProjectFlows();
	} catch {
		return undefined;
	}
}

function finalConfigStatus(
	connection: ProjectConnectionReport | undefined,
	initCompleted: boolean,
): ProjectConfigStatus {
	if (connection?.configStatus === "project_local_valid")
		return "project_local_valid";
	if (initCompleted) return "project_local_valid";
	return connection?.configStatus ?? "missing";
}

function isReviewRisk(risk: ProjectPostflightReport["risk"]): boolean {
	return risk === "medium" || risk === "high" || risk === "blocker";
}

function recommendedNext(
	risk: ProjectPostflightReport["risk"],
	differences: ProjectAlignmentDiffCounts,
): string {
	if (totalDifferences(differences) > 0)
		return "Revisar draft antes de aplicar.";
	if (isReviewRisk(risk)) return "Revisar lab_review_plan antes de continuar.";
	return "Proyecto preparado; continuar bajo riesgo low.";
}

function suggestedActions(
	risk: ProjectPostflightReport["risk"],
	differences: ProjectAlignmentDiffCounts,
): string[] {
	const actions: string[] = [];
	if (totalDifferences(differences) > 0) {
		actions.push("/config review_project_flows_draft latest");
	}
	if (isReviewRisk(risk)) actions.push("/lab_review_plan postflight");
	actions.push("continuar bajo riesgo");
	return actions;
}

function formatStep(step: IduPrepareStep): string {
	if (step.id === "postflight" && step.status === "completed") {
		return `- ${step.id}: ${step.summary}`;
	}
	if (step.id === "lab_review_plan" && step.status === "completed") {
		return `- ${step.id}: preparado`;
	}
	return `- ${step.id}: ${statusLabel(step.status)}${step.error ? ` (${step.error})` : ""}`;
}

function statusLabel(status: IduPrepareStepStatus): string {
	switch (status) {
		case "completed":
			return "completado";
		case "failed":
			return "falló";
		case "skipped":
			return "omitido";
	}
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}
