import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
	buildAgentLabReviewRequest,
	buildAgentLabWorkloadEnvelope,
	mapRiskToAgentLabSpecialties,
	validateAgentLabReviewRequest,
	type AgentLabReviewRequest,
	type AgentLabSpecialty,
	type AgentLabWorkloadEnvelope,
} from "./agentlab-supervisor-contract.js";
import type { ProjectPostflightReport } from "./project-postflight.js";
import {
	buildSemanticAgentTaskPlan,
	type SemanticAgentTaskCandidate,
	type SemanticAgentTaskPlan,
} from "./semantic-agent-tasks.js";
import {
	reviewMasterPlan,
	type MasterPlan,
	type MasterPlanReview,
} from "./master-plan.js";
import { reviewSkillDraft, type SkillDraftPlan } from "./skill-drafts.js";

export type AgentLabReviewRequestSource =
	| "postflight"
	| "skill_draft"
	| "master_plan"
	| "semantic_agent_tasks"
	| "supervisor_improvements"
	| "project_core_constitution"
	| "external_source_intelligence"
	| "manual";

export type AgentLabReviewRequestPlan = {
	generatedAt: string;
	projectId: string;
	source: AgentLabReviewRequestSource;
	warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.";
	workloadEnvelope?: AgentLabWorkloadEnvelope;
	requests: AgentLabReviewRequest[];
	errors: string[];
	path?: string;
};

export type AgentLabReviewRequestReview = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	plan?: AgentLabReviewRequestPlan;
};

export type CreateAgentLabReviewRequestsInput = {
	source: AgentLabReviewRequestSource;
	reportsPath: string;
	projectId: string;
	projectPath: string;
	postflightReport?: ProjectPostflightReport;
	skillDraftPathOrLatest?: string;
	masterPlanPathOrLatest?: string;
	semanticAgentTaskPathOrLatest?: string;
	semanticAgentTaskPlan?: SemanticAgentTaskPlan;
	manualObjective?: string;
	manualContext?: string;
	externalSourceQueries?: string[];
	externalSourceRelatedContracts?: string[];
	externalSourceFreshness?: string;
	now?: () => Date;
};

const WARNING = "Solicitud AgentLab. No ejecuta revisión por sí sola." as const;
const REQUEST_CURRENT_FILE = "current.json";
const REQUEST_RE = /^(?:current|agentlab-review-request-\d{8}-\d{6})\.json$/u;
const HIGH_RISKS = new Set(["high", "blocker"]);

export function createAgentLabReviewRequests(
	input: CreateAgentLabReviewRequestsInput,
): AgentLabReviewRequestPlan {
	const now = input.now?.() ?? new Date();
	const generatedAt = now.toISOString();
	const requests = buildRequests(input, generatedAt);
	const errors = [
		...emptyRequestErrors(input, requests),
		...validateRequests(requests),
	];
	const plan: AgentLabReviewRequestPlan = {
		generatedAt,
		projectId: input.projectId,
		source: input.source,
		warning: WARNING,
		workloadEnvelope: buildAgentLabWorkloadEnvelope({
			status: "requested",
			statusReason:
				"Solicitud AgentLab creada; no ejecuta revisión automáticamente.",
			generatedAt,
			source: "request",
			requests,
		}),
		requests,
		errors,
	};
	const directory = requestArtifactsDir(input.reportsPath);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, REQUEST_CURRENT_FILE);
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	return { ...plan, path };
}

export function reviewAgentLabReviewRequest(
	pathOrLatest: string,
	reportsPath: string,
): AgentLabReviewRequestReview {
	const resolved = resolveRequestPath(pathOrLatest, reportsPath);
	if (!resolved.valid) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: resolved.errors,
		};
	}
	try {
		const raw = JSON.parse(readFileSync(resolved.path, "utf8")) as unknown;
		const plan = normalizePlan(raw);
		const errors = validateRequests(plan.requests);
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: errors.length === 0,
			errors,
			plan,
		};
	} catch (error) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

export function formatAgentLabReviewRequestPlan(
	plan: AgentLabReviewRequestPlan,
): string {
	return [
		"AgentLab Review Requests Created",
		"",
		"Fuente:",
		plan.source,
		"",
		"Ruta:",
		plan.path ?? "- no escrita",
		"",
		"Requests:",
		...formatRequests(plan.requests),
		"",
		"Errores:",
		...formatList(plan.errors),
		"",
		"Nota segura:",
		"Solo creé solicitudes de revisión. No ejecuté AgentLabs, no apliqué skills ni reglas.",
	].join("\n");
}

export function formatAgentLabReviewRequestReview(
	review: AgentLabReviewRequestReview,
): string {
	if (!review.valid || !review.plan) {
		return [
			"AgentLab Review Request Review",
			"",
			"Archivo:",
			review.name || review.path,
			"",
			"Válido:",
			"no",
			"",
			"Errores:",
			...formatList(review.errors),
			"",
			"Nota segura:",
			"No ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"AgentLab Review Request Review",
		"",
		"Archivo:",
		review.name,
		"",
		"Válido:",
		"sí",
		"",
		"Specialties:",
		...formatList([
			...new Set(review.plan.requests.map((request) => request.specialty)),
		]),
		"",
		"Requests:",
		...review.plan.requests.flatMap(formatRequestDetail),
		"",
		"Nota segura:",
		"Solicitud AgentLab solamente. No ejecuté AgentLabs ni modifiqué el repo real.",
	].join("\n");
}

function emptyRequestErrors(
	input: CreateAgentLabReviewRequestsInput,
	requests: AgentLabReviewRequest[],
): string[] {
	if (requests.length > 0) return [];
	if (input.source === "skill_draft") {
		const selector = input.skillDraftPathOrLatest ?? "latest";
		const review = reviewSkillDraft(selector, input.reportsPath);
		return [
			`No encontré skill draft válido para AgentLab (${selector}): ${review.errors.join("; ") || "sin drafts revisables"}.`,
		];
	}
	if (input.source === "master_plan") {
		const selector = input.masterPlanPathOrLatest ?? "latest";
		const review = reviewMasterPlan({
			stateRoot: resolve(input.reportsPath, ".."),
			pathOrLatest: selector,
		});
		if (
			review.plan.schemaVersion < 2 ||
			review.plan.status === "incompatible"
		) {
			return [
				`Plan Maestro incompatible para AgentLab (${selector}); regenerá /idu antes de crear requests.`,
			];
		}
		return [
			`Plan Maestro ${selector} no produjo requests AgentLab; revisá AutoDepth/riesgos antes de ejecutar AgentLabs.`,
		];
	}
	return [];
}

function buildRequests(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	switch (input.source) {
		case "postflight":
			return requestsFromPostflight(input, createdAt);
		case "skill_draft":
			return requestsFromSkillDraft(input, createdAt);
		case "master_plan":
			return requestsFromMasterPlan(input, createdAt);
		case "semantic_agent_tasks":
			return requestsFromSemanticTasks(input, createdAt);
		case "external_source_intelligence":
			return requestsFromExternalSourceIntelligence(input, createdAt);
		case "manual":
			return requestsFromManual(input, createdAt);
		case "supervisor_improvements":
		case "project_core_constitution":
			return requestsFromManual(
				{
					...input,
					manualObjective:
						input.manualObjective ??
						`Revisar fuente ${input.source} con contrato Supervisor ↔ AgentLabs`,
					manualContext:
						input.manualContext ??
						"Solicitud de revisión formal sin ejecución automática.",
				},
				createdAt,
			);
	}
}

function requestsFromPostflight(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const report = input.postflightReport;
	if (!report || !HIGH_RISKS.has(report.risk)) return [];
	const specialties = mapRiskToAgentLabSpecialties({
		text: [report.risk, report.recommendedNext, report.diffSummary ?? ""].join(
			"\n",
		),
		affectedAreas: report.impactedAreas,
		changedFiles: report.changedFiles,
		warnings: report.warnings,
		rules: report.constitutionGate?.affectedRules,
	});
	return specialties.map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "postflight", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "postflight",
			objective: `Revisar postflight ${report.risk} para ${specialty}`,
			contextSummary: [
				`Riesgo: ${report.risk}`,
				`Impacto: ${report.impactedAreas.join(", ") || "ninguno"}`,
				`Recomendación: ${report.recommendedNext}`,
			].join("\n"),
			evidence: [
				...report.changedFiles.map((file) => `changed file: ${file}`),
				...report.warnings.map((warning) => `warning: ${warning}`),
			],
			filesToInspect: report.changedFiles,
			flowsToCheck: report.impactedAreas.filter((area) =>
				/flow|flujo|mapa/u.test(area),
			),
			rulesToCheck: report.constitutionGate?.affectedRules ?? [],
			constraints: ["Revisar sin modificar el repo real."],
			maxCommands: 5,
			maxMinutes: 15,
			tokenBudgetHint: "bounded-postflight",
			expectedOutputs: [
				"hallazgos con evidencia",
				"pruebas sugeridas",
				"recomendaciones para Idu-pi Supervisor",
			],
			createdAt,
		}),
	);
}

function requestsFromSkillDraft(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const review = reviewSkillDraft(
		input.skillDraftPathOrLatest ?? "latest",
		input.reportsPath,
	);
	if (!review.valid || !review.plan) return [];
	return [
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "skill-draft", "skill_review", 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty: "skill_review",
			trigger: "skill_draft",
			objective: "Revisar skill drafts aprobados sin aplicar skills reales",
			contextSummary: skillDraftContext(review),
			evidence: skillDraftEvidence(review),
			filesToInspect: [review.path],
			flowsToCheck: [],
			rulesToCheck: [
				"No aplicar skills reales",
				"Revisar borrador JSON solamente",
			],
			sourceSkillDraftPath: review.path,
			constraints: [
				"Puede revisar el JSON de skill draft pero no aplicar skills.",
				"No buscar .agents/skills/<skill>/SKILL.md; la skill real todavía no existe.",
			],
			allowedActions: ["revisar skill drafts", "proponer correcciones"],
			forbiddenActions: ["no modificar .agents", "no modificar .atl"],
			maxCommands: 3,
			maxMinutes: 10,
			tokenBudgetHint: "bounded-skill-review",
			expectedOutputs: [
				"observaciones sobre calidad del skill draft",
				"riesgos de aplicación",
				"pruebas sugeridas antes de aplicar",
			],
			createdAt,
			requiresHumanApproval: true,
		}),
	];
}

function requestsFromMasterPlan(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const review = reviewMasterPlan({
		stateRoot: resolve(input.reportsPath, ".."),
		pathOrLatest: input.masterPlanPathOrLatest ?? "latest",
	});
	if (
		!review.plan ||
		review.plan.schemaVersion < 2 ||
		review.plan.status === "incompatible"
	)
		return [];
	const plan = review.plan;
	if (plan.autoDepth.mode === "quick" && !hasClearMasterPlanRisk(plan))
		return [];
	const specialties = masterPlanSpecialties(plan);
	return specialties.map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "master-plan", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "master_plan",
			objective: masterPlanObjective(plan, specialty),
			contextSummary: masterPlanContext(review, plan),
			evidence: masterPlanEvidence(plan, specialty),
			filesToInspect: [review.jsonPath, ...plan.sourceFiles.slice(0, 8)],
			flowsToCheck: plan.detectedFlows.map((flow) => flow.name).slice(0, 8),
			rulesToCheck: [
				...plan.criticalRisks,
				...plan.securityRisks,
				...plan.architectureRisks,
			].slice(0, 8),
			constraints: [
				"Revisar sólo el Plan Maestro y evidencia referenciada.",
				"No aplicar flujos, Project Core, Constitution ni cambios de código.",
				"Reportar hallazgos con evidencia y recomendaciones accionables.",
			],
			allowedActions: [
				"leer Plan Maestro",
				"inspeccionar archivos de evidencia",
				"proponer hallazgos review-only",
			],
			forbiddenActions: [
				"no ejecutar cambios del Plan Maestro",
				"no preparar commits",
				"no modificar artefactos de proyecto",
			],
			maxCommands: plan.autoDepth.mode === "deep_required" ? 4 : 3,
			maxMinutes: plan.autoDepth.mode === "deep_required" ? 12 : 8,
			tokenBudgetHint: "bounded-master-plan-review",
			expectedOutputs: [
				"hallazgos del Plan Maestro con evidencia",
				"riesgos confirmados o descartados",
				"siguiente acción segura para Idu-pi",
			],
			createdAt,
			requiresHumanApproval:
				plan.autoDepth.mode === "deep_required" ||
				specialty === "security" ||
				specialty === "database",
		}),
	);
}

function requestsFromSemanticTasks(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const plan =
		input.semanticAgentTaskPlan ??
		buildSemanticAgentTaskPlan(
			input.semanticAgentTaskPathOrLatest ?? "latest",
			input.reportsPath,
		);
	if (!plan.validDraft) return [];
	const grouped = groupSemanticCandidates(plan.candidates);
	return [...grouped.entries()].map(([specialty, candidates], index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "semantic", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "semantic_audit",
			objective: `Revisar hallazgos semánticos agrupados para ${specialty}`,
			contextSummary: `Draft: ${plan.draftName}\nCandidatos: ${candidates.length}`,
			evidence: candidates.map((candidate) => candidate.evidence),
			filesToInspect: [],
			flowsToCheck: [],
			rulesToCheck: candidates.map((candidate) => candidate.dedupeKey),
			constraints: ["Crear solicitud; no ejecutar AgentLabs todavía."],
			maxCommands: 4,
			maxMinutes: 12,
			tokenBudgetHint: "bounded-semantic-audit",
			expectedOutputs: candidates.map((candidate) => candidate.recommendation),
			createdAt,
			requiresHumanApproval: candidates.some(
				(candidate) => candidate.requiresHumanApproval,
			),
		}),
	);
}

function requestsFromExternalSourceIntelligence(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const objective =
		input.manualObjective ??
		"Auditar fuentes externas vivas sin promover contratos automáticamente";
	const relatedContracts = input.externalSourceRelatedContracts ?? [
		"security",
		"data",
		"agent",
	];
	const queries = input.externalSourceQueries ?? [
		"official documentation breaking changes",
		"security advisories CVE NVD",
		"GitHub npm advisories changelog releases",
		"community signals ecosystem reports",
	];
	return [
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "external-source", "librarian", 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty: "librarian",
			trigger: "external_source_intelligence",
			objective,
			contextSummary:
				input.manualContext ??
				"AgentLab bibliotecario audit-only: recopilar señales externas, clasificarlas por fuente/confianza y recomendar revisión humana sin modificar contratos.",
			evidence: [
				"external_source_intelligence request",
				`queries: ${queries.join("; ")}`,
				`relatedContracts: ${relatedContracts.join(", ")}`,
			],
			filesToInspect: [],
			flowsToCheck: ["AgentLab audit-only", "Plan Maestro governance"],
			rulesToCheck: [
				"external signals are evidence, not approved contracts",
				"community signals require lower confidence than official advisories",
				"contract promotion requires explicit orchestrator/user review",
			],
			externalSourceIntelligence: {
				status: "requested",
				allowedSourceKinds: [
					"official_docs",
					"changelog",
					"advisory",
					"cve_nvd",
					"github_advisory",
					"npm_advisory",
					"community_signal",
				],
				freshness:
					input.externalSourceFreshness ?? "latest available at review time",
				queries,
				relatedContracts,
				contractPromotionAllowed: false,
			},
			constraints: [
				"Audit-only: no scraping side effects, repo writes, contracts, skills, commits or push.",
				"URLs and claims must be reported with source kind, confidence and freshness.",
				"Signals can only recommend human/orchestrator review; they never become contracts automatically.",
			],
			allowedActions: [
				"leer fuentes externas permitidas",
				"reportar señales con URL, severidad, confianza y frescura",
				"recomendar revisión humana de contratos sin aplicarlos",
			],
			forbiddenActions: [
				"no aplicar contratos",
				"no editar código",
				"no ejecutar cambios del Plan Maestro",
			],
			maxCommands: 4,
			maxMinutes: 12,
			tokenBudgetHint: "bounded-source-intelligence",
			expectedOutputs: [
				"señales externas con URL/evidencia",
				"clasificación por fuente, severidad, confianza y frescura",
				"recomendaciones que requieran revisión humana antes de tocar contratos",
			],
			createdAt,
			requiresHumanApproval: true,
		}),
	];
}

function requestsFromManual(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const objective = input.manualObjective ?? "Revisión manual AgentLab";
	const context = input.manualContext ?? objective;
	const specialties = mapRiskToAgentLabSpecialties({
		text: `${objective}\n${context}`,
	});
	return specialties.map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "manual", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "manual",
			objective,
			contextSummary: context,
			evidence: [context],
			filesToInspect: [],
			flowsToCheck: [],
			rulesToCheck: [],
			constraints: ["Solicitud manual sin ejecución automática."],
			maxCommands: 3,
			maxMinutes: 10,
			tokenBudgetHint: "bounded-manual",
			expectedOutputs: ["reporte de revisión con evidencia"],
			createdAt,
		}),
	);
}

function masterPlanSpecialties(plan: MasterPlan): AgentLabSpecialty[] {
	if (plan.autoDepth.mode === "deep_required") {
		return dedupeSpecialties([
			"project_understanding",
			"architecture",
			...(plan.dataStores.length ? (["database"] as AgentLabSpecialty[]) : []),
			...(plan.securityModel.authDetected
				? (["security"] as AgentLabSpecialty[])
				: []),
			...(plan.detectedFlows.length || hasUiEvidence(plan)
				? (["ui_ux"] as AgentLabSpecialty[])
				: []),
		]);
	}
	if (plan.autoDepth.mode === "standard") {
		return dedupeSpecialties(plan.autoDepth.agentLabsSelected).slice(0, 3);
	}
	return dedupeSpecialties(plan.autoDepth.agentLabsSelected).slice(0, 1);
}

function hasClearMasterPlanRisk(plan: MasterPlan): boolean {
	return (
		plan.criticalRisks.length > 0 ||
		plan.securityRisks.length > 0 ||
		plan.dataStores.some((store) => store.riskLevel === "high") ||
		plan.detectedFlows.some((flow) => flow.riskLevel === "high")
	);
}

function hasUiEvidence(plan: MasterPlan): boolean {
	return [
		...plan.detectedModules,
		...plan.sourceFiles,
		...plan.architecture.evidence,
	].some((item) =>
		/ui|component|screen|page|html|react|vue|svelte|frontend/u.test(item),
	);
}

function masterPlanObjective(
	plan: MasterPlan,
	specialty: AgentLabSpecialty,
): string {
	const suffix =
		plan.autoDepth.mode === "deep_required"
			? "deep_required"
			: plan.autoDepth.mode;
	switch (specialty) {
		case "project_understanding":
			return `Validar entendimiento del proyecto desde Plan Maestro ${suffix}`;
		case "architecture":
			return `Revisar arquitectura detectada en Plan Maestro ${suffix}`;
		case "database":
			return `Revisar data stores y riesgos de persistencia del Plan Maestro ${suffix}`;
		case "security":
			return `Revisar auth/session/security detectado en Plan Maestro ${suffix}`;
		case "ui_ux":
			return `Revisar flujos UI/UX detectados en Plan Maestro ${suffix}`;
		default:
			return `Revisar Plan Maestro ${suffix} para ${specialty}`;
	}
}

function masterPlanContext(review: MasterPlanReview, plan: MasterPlan): string {
	return [
		`Plan path: ${review.jsonPath}`,
		`AutoDepth: ${plan.autoDepth.mode} — ${plan.autoDepth.reason}`,
		`Objective: ${plan.inferredObjective}`,
		`Executive summary: ${plan.executiveSummary}`,
		`Architecture: frontend=${plan.architecture.frontend}; backend=${plan.architecture.backend}; database=${plan.architecture.database}; auth=${plan.architecture.auth}`,
		`Data stores: ${plan.dataStores.map((store) => `${store.name}:${store.type}:${store.riskLevel}`).join(", ") || "none"}`,
		`Security: auth=${String(plan.securityModel.authDetected)} session=${String(plan.securityModel.sessionDetected)}`,
		`Flows: ${plan.detectedFlows.map((flow) => `${flow.name}:${flow.type}:${flow.riskLevel}`).join(", ") || "none"}`,
		`Recommended next: ${plan.recommendedNext.join("; ") || "none"}`,
	].join("\n");
}

function masterPlanEvidence(
	plan: MasterPlan,
	specialty: AgentLabSpecialty,
): string[] {
	const common = [
		...plan.architecture.evidence.map((item) => `architecture: ${item}`),
		...plan.dataStores.flatMap((store) =>
			store.evidence.map((item) => `dataStore ${store.name}: ${item}`),
		),
		...plan.securityModel.evidence.map((item) => `security: ${item}`),
		...plan.detectedFlows.flatMap((flow) =>
			flow.evidence.map((item) => `flow ${flow.name}: ${item}`),
		),
		...plan.criticalRisks.map((risk) => `criticalRisk: ${risk}`),
		...plan.architectureRisks.map((risk) => `architectureRisk: ${risk}`),
		...plan.securityRisks.map((risk) => `securityRisk: ${risk}`),
	];
	if (specialty === "database") {
		return common.filter((item) =>
			/data|database|store|db|sql|supabase|postgres|sqlite/u.test(item),
		);
	}
	if (specialty === "security") {
		return common.filter((item) =>
			/auth|session|security|token|login|sensitive/u.test(item),
		);
	}
	if (specialty === "ui_ux") {
		return common.filter((item) =>
			/flow|ui|screen|html|frontend|component/u.test(item),
		);
	}
	return common.slice(0, 20);
}

function dedupeSpecialties(values: AgentLabSpecialty[]): AgentLabSpecialty[] {
	return [...new Set(values)];
}

function groupSemanticCandidates(
	candidates: SemanticAgentTaskCandidate[],
): Map<AgentLabSpecialty, SemanticAgentTaskCandidate[]> {
	const grouped = new Map<AgentLabSpecialty, SemanticAgentTaskCandidate[]>();
	for (const candidate of candidates) {
		const specialty = semanticTypeToSpecialty(candidate.type);
		grouped.set(specialty, [...(grouped.get(specialty) ?? []), candidate]);
	}
	return grouped;
}

function semanticTypeToSpecialty(type: string): AgentLabSpecialty {
	switch (type) {
		case "security":
		case "database":
		case "architecture":
		case "skill_review":
		case "ui_ux":
		case "code_quality":
			return type;
		case "classifier_review":
			return "code_quality";
		default:
			return "general";
	}
}

function validateRequests(requests: AgentLabReviewRequest[]): string[] {
	return requests.flatMap((request, index) => {
		const result = validateAgentLabReviewRequest(request);
		return result.ok
			? []
			: result.errors.map((error) => `requests[${index}].${error}`);
	});
}

function resolveRequestPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestRequestFile(reports);
		return latest
			? { valid: true, path: latest, errors: [] }
			: {
					valid: false,
					path: reports,
					errors: [
						"No encontré solicitudes AgentLab en agentlabs/requests ni reports.",
					],
				};
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed) {
		return { valid: false, path: reports, errors: ["Falta ruta de request."] };
	}
	const requestDir = requestArtifactsDir(reportsPath);
	const candidate = resolveRequestCandidate(reports, requestDir, trimmed);
	if (
		!isInsideDirectory(candidate, requestDir) &&
		!isInsideDirectory(candidate, reports)
	) {
		return {
			valid: false,
			path: candidate,
			errors: [
				"La ruta debe estar dentro de stateRoot/agentlabs/requests o reports legacy.",
			],
		};
	}
	if (!REQUEST_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: [
				"El archivo debe llamarse current.json o agentlab-review-request-*.json.",
			],
		};
	}
	if (!existsSync(candidate)) {
		return {
			valid: false,
			path: candidate,
			errors: [`No existe archivo: ${candidate}`],
		};
	}
	return { valid: true, path: candidate, errors: [] };
}

function resolveRequestCandidate(
	reports: string,
	requestDir: string,
	requested: string,
): string {
	if (isAbsolute(requested)) return resolve(requested);
	if (requested.startsWith("reports/"))
		return resolve(join(reports, requested.slice("reports/".length)));
	const canonical = resolve(join(requestDir, requested));
	const legacy = resolve(join(reports, requested));
	return existsSync(canonical) || !existsSync(legacy) ? canonical : legacy;
}

function latestRequestFile(reportsPath: string): string | undefined {
	const requestDir = requestArtifactsDir(reportsPath);
	const current = join(requestDir, REQUEST_CURRENT_FILE);
	if (existsSync(current)) return current;
	if (existsSync(requestDir)) {
		const latest = readdirSync(requestDir)
			.filter((file) => REQUEST_RE.test(file))
			.sort()
			.at(-1);
		if (latest) return join(requestDir, latest);
	}
	if (!existsSync(reportsPath)) return undefined;
	const legacy = readdirSync(reportsPath)
		.filter((file) => /^agentlab-review-request-\d{8}-\d{6}\.json$/u.test(file))
		.sort()
		.at(-1);
	return legacy ? join(reportsPath, legacy) : undefined;
}

function requestArtifactsDir(reportsPath: string): string {
	return join(resolve(reportsPath), "..", "agentlabs", "requests");
}

function isInsideDirectory(path: string, directory: string): boolean {
	const relativePath = relative(resolve(directory), resolve(path));
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath)
	);
}

function normalizePlan(value: unknown): AgentLabReviewRequestPlan {
	if (!isRecord(value)) throw new Error("AgentLab request inválido.");
	if (value.warning !== WARNING)
		throw new Error("Warning de request inválido.");
	if (typeof value.generatedAt !== "string")
		throw new Error("generatedAt inválido.");
	if (typeof value.projectId !== "string")
		throw new Error("projectId inválido.");
	if (!isSource(value.source)) throw new Error("source inválido.");
	if (!Array.isArray(value.requests)) throw new Error("requests[] inválido.");
	const requests: AgentLabReviewRequest[] = [];
	for (const request of value.requests) {
		const result = validateAgentLabReviewRequest(request);
		if (!result.ok) throw new Error(result.errors.join("; "));
		requests.push(result.request);
	}
	return {
		generatedAt: value.generatedAt,
		projectId: value.projectId,
		source: value.source,
		warning: WARNING,
		workloadEnvelope: buildAgentLabWorkloadEnvelope({
			status: "requested",
			statusReason:
				"Solicitud AgentLab normalizada; no ejecuta revisión automáticamente.",
			generatedAt: value.generatedAt,
			source: "request",
			requests,
		}),
		requests,
		errors: Array.isArray(value.errors)
			? value.errors.filter(
					(error): error is string => typeof error === "string",
				)
			: [],
	};
}

function isSource(value: unknown): value is AgentLabReviewRequestSource {
	return (
		value === "postflight" ||
		value === "skill_draft" ||
		value === "master_plan" ||
		value === "semantic_agent_tasks" ||
		value === "supervisor_improvements" ||
		value === "project_core_constitution" ||
		value === "external_source_intelligence" ||
		value === "manual"
	);
}

function skillDraftContext(review: {
	path: string;
	plan?: SkillDraftPlan;
}): string {
	const plan = review.plan!;
	return [
		`Source skill draft path: ${review.path}`,
		`Source proposal file: ${plan.sourceProposalFile}`,
		`Skill drafts: ${plan.skillDrafts.length}`,
		...plan.skillDrafts.flatMap((draft, index) => [
			`Draft ${index + 1}:`,
			`- Proposal: ${draft.proposalId}`,
			`- Skill: ${draft.skillName}`,
			`- Action: ${draft.action}`,
			`- Target path (future only, do not inspect as real file): ${draft.targetPath ?? "none"}`,
			`- Purpose: ${draft.purpose}`,
			`- When to use: ${draft.whenToUse}`,
			`- Safety rules: ${draft.safetyRules.join("; ") || "none"}`,
			`- Tests suggested: ${draft.testsSuggested.join("; ") || "none"}`,
			`- Content preview:\n${draft.contentPreview}`,
		]),
		`Omitidas: ${plan.omittedProposals.length}`,
	].join("\n");
}

function skillDraftEvidence(review: {
	path: string;
	plan?: SkillDraftPlan;
}): string[] {
	const plan = review.plan!;
	return [
		`sourceSkillDraftPath: ${review.path}`,
		...plan.skillDrafts.flatMap((draft) => [
			`${draft.proposalId}: ${draft.title}`,
			`skillName: ${draft.skillName}`,
			`action: ${draft.action}`,
			`purpose: ${draft.purpose}`,
			`whenToUse: ${draft.whenToUse}`,
			`safetyRules: ${draft.safetyRules.join("; ") || "none"}`,
			`testsSuggested: ${draft.testsSuggested.join("; ") || "none"}`,
			`contentPreview:\n${draft.contentPreview}`,
		]),
	];
}

function formatRequests(requests: AgentLabReviewRequest[]): string[] {
	return requests.length
		? requests.map(
				(request) =>
					`- ${request.specialty}: ${request.objective} | humanApproval=${request.requiresHumanApproval}`,
			)
		: ["- ninguna"];
}

function formatRequestDetail(request: AgentLabReviewRequest): string[] {
	return [
		`- specialty: ${request.specialty}`,
		`  objective: ${request.objective}`,
		...(request.sourceSkillDraftPath
			? [`  sourceSkillDraftPath: ${request.sourceSkillDraftPath}`]
			: []),
		...(request.externalSourceIntelligence
			? [
					`  externalSourceStatus: ${request.externalSourceIntelligence.status}`,
					`  contractPromotionAllowed: ${String(request.externalSourceIntelligence.contractPromotionAllowed)}`,
				]
			: []),
		`  forbiddenActions: ${request.forbiddenActions.join("; ")}`,
		`  maxCommands: ${request.maxCommands}`,
		`  maxMinutes: ${request.maxMinutes}`,
		`  tokenBudgetHint: ${request.tokenBudgetHint}`,
		`  expectedOutputs: ${request.expectedOutputs.join("; ")}`,
		`  requiresHumanApproval: ${request.requiresHumanApproval}`,
	];
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function requestId(
	projectId: string,
	source: string,
	specialty: string,
	index: number,
): string {
	return `agentlab-${slug(projectId)}-${slug(source)}-${slug(specialty)}-${String(index).padStart(2, "0")}`;
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-|-$/gu, "") || "unknown"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}
