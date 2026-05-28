import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
	type Stats,
} from "node:fs";
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { loadProjectBlueprint } from "./project-blueprint.js";
import { loadProjectConstitution } from "./project-constitution.js";
import { loadProjectCore } from "./project-core.js";
import { loadProjectFlows } from "./project-flows.js";
import type { AgentLabSpecialty } from "./agentlab-supervisor-contract.js";

export type MasterPlanStatus =
	| "draft"
	| "approved"
	| "rejected"
	| "stale"
	| "incompatible";
export type MasterPlanAutoDepthMode = "quick" | "standard" | "deep_required";

export type MasterPlanAutoDepth = {
	mode: MasterPlanAutoDepthMode;
	reason: string;
	signals: string[];
	agentLabsSelected: AgentLabSpecialty[];
	skippedAgentLabs: AgentLabSpecialty[];
	tokenCostHint: string;
};

export type MasterPlanSource = {
	projectCoreStatus: string;
	constitutionStatus: string;
	blueprintStatus: string;
	flowsStatus: string;
	scanStatus: string;
};

export type ProjectPathClassification =
	| "app_module"
	| "route"
	| "component"
	| "service"
	| "data_store"
	| "auth"
	| "ui"
	| "docs"
	| "test"
	| "tooling"
	| "agent_metadata"
	| "generated"
	| "ignored"
	| "product_code"
	| "business_module"
	| "api_route"
	| "data_layer"
	| "auth_security"
	| "configuration"
	| "documentation"
	| "vendor"
	| "runtime_state"
	| "unknown";

export type MasterPlanArchitecture = {
	projectKind: string;
	frontend: string;
	backend: string;
	database: string;
	auth: string;
	deployment: string;
	packageManager: string;
	languages: string[];
	frameworks: string[];
	evidence: string[];
};

export type MasterPlanDataStore = {
	name: string;
	type:
		| "supabase"
		| "postgres"
		| "sqlite"
		| "mysql"
		| "mongodb"
		| "prisma"
		| "localStorage"
		| "indexedDB"
		| "json"
		| "api"
		| "unknown";
	evidence: string[];
	riskLevel: "low" | "medium" | "high";
};

export type MasterPlanSecurityModel = {
	authDetected: boolean;
	sessionDetected: boolean;
	sensitiveFlows: string[];
	evidence: string[];
};

export type MasterPlanFunctionalFlow = {
	name: string;
	type:
		| "auth"
		| "data_ingest"
		| "reporting"
		| "api"
		| "ui_action"
		| "data_flow"
		| "unknown";
	from: string;
	through: string[];
	to: string;
	modules: string[];
	dataStores: string[];
	triggers: string[];
	evidence: string[];
	riskLevel: "low" | "medium" | "high";
};

export type MasterPlanApproval = {
	approvedAt?: string;
	rejectedAt?: string;
	source?: "cli" | "pi" | "telegram" | "mcp";
	reason?: string;
};

export type MasterPlan = {
	version: string;
	schemaVersion: number;
	projectId: string;
	projectPath: string;
	gitHead?: string;
	generatedAt: string;
	status: MasterPlanStatus;
	autoDepth: MasterPlanAutoDepth;
	source: MasterPlanSource;
	executiveSummary: string;
	inferredObjective: string;
	problemStatement: string;
	scope: string[];
	outOfScope: string[];
	detectedModules: string[];
	detectedFlows: MasterPlanFunctionalFlow[];
	dataStores: MasterPlanDataStore[];
	architecture: MasterPlanArchitecture;
	securityModel: MasterPlanSecurityModel;
	toolingDetected: string[];
	ignoredTooling: string[];
	userRoles: string[];
	criticalRisks: string[];
	qualityRisks: string[];
	securityRisks: string[];
	architectureRisks: string[];
	openQuestions: string[];
	assumptions: string[];
	recommendedNext: string[];
	approval?: MasterPlanApproval;
	sourceFiles: string[];
	agentLabReviews: Array<{
		specialty: AgentLabSpecialty;
		status: "selected" | "skipped" | "not_run";
		reason: string;
		maxCommands: number;
	}>;
};

export type MasterPlanCurrent = {
	currentPlanJson: string;
	currentPlanMd: string;
	status: MasterPlanStatus;
	projectId: string;
	projectPath: string;
	gitHead?: string;
	updatedAt: string;
};

export type MasterPlanMemory = {
	projectId: string;
	status: MasterPlanStatus;
	currentPlanJson: string;
	objectiveSummary: string;
	topRisks: string[];
	openQuestionsCount: number;
	gitHead?: string;
	updatedAt: string;
};

export type MasterPlanDraftResult = {
	plan: MasterPlan;
	current: MasterPlanCurrent;
	memory: MasterPlanMemory;
	jsonPath: string;
	markdownPath: string;
	automaticNote?: string;
};

export type MasterPlanStatusResult =
	| { status: "missing"; exists: false; recommendedNext: string }
	| {
			status: "incompatible";
			exists: true;
			current?: MasterPlanCurrent;
			currentPlanJson?: string;
			currentPlanMd?: string;
			projectId?: string;
			projectPath?: string;
			updatedAt?: string;
			incompatibleReason: string;
			recommendedNext: string;
	  }
	| (MasterPlanCurrent & { exists: true; staleReason?: string });

export type MasterPlanReview = {
	plan: MasterPlan;
	current?: MasterPlanCurrent;
	markdown: string;
	jsonPath: string;
	markdownPath?: string;
};

const CURRENT_FILE = "master-plan.current.json";
const MEMORY_FILE = "master-plan.memory.json";
const MASTER_PLAN_SCHEMA_VERSION = 2;
const SKIPPED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	"reports",
	"workspaces",
	".pi-lens",
]);
const AGENT_METADATA_DIRS = new Set([
	".adal",
	".agents",
	".aider-desk",
	".atl",
	".augment",
	".bob",
	".claude",
	".codeartsdoer",
	".codebuddy",
	".codemaker",
	".codestudio",
	".commandcode",
	".continue",
	".cortex",
	".crush",
	".devin",
	".factory",
	".forge",
	".goose",
	".iflow",
	".windsurf",
]);
const TOOLING_DIRS = new Set([
	".cursor",
	".github",
	".vscode",
	".idea",
	".husky",
	".mcp",
]);
const GENERATED_DIRS = new Set(["dist", "build", "coverage", ".next", "out"]);
const VENDOR_DIRS = new Set(["node_modules", "vendor"]);
const RUNTIME_STATE_DIRS = new Set([
	"reports",
	"workspaces",
	".pi-lens",
	".pi",
]);
const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".html",
	".htm",
	".css",
	".json",
	".md",
	".sql",
	".prisma",
	".py",
	".php",
]);

export function generateMasterPlanDraft(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	reason?: string;
}): MasterPlanDraftResult {
	const projectPath = resolve(input.projectPath);
	const stateRoot = resolve(input.stateRoot);
	const reportsDir = join(stateRoot, "reports");
	mkdirSync(reportsDir, { recursive: true });
	const generatedAt = new Date().toISOString();
	const signals = collectProjectSignals(projectPath);
	const source = readSourceStatuses(projectPath, signals);
	const autoDepth = decideAutoDepth(signals, source);
	const inferredObjective = inferObjective(projectPath, signals);
	const plan: MasterPlan = {
		version: "1.0.0",
		schemaVersion: MASTER_PLAN_SCHEMA_VERSION,
		projectId: input.projectId,
		projectPath,
		...(input.gitHead ? { gitHead: input.gitHead } : {}),
		generatedAt,
		status: "draft",
		autoDepth,
		source,
		executiveSummary: buildExecutiveSummary(
			input.projectId,
			autoDepth,
			signals,
		),
		inferredObjective,
		problemStatement: buildProblemStatement(source, signals),
		scope: inferScope(signals),
		outOfScope: [
			"Aplicar flows automáticamente",
			"Confirmar Project Core o Constitution sin decisión humana",
			"Ejecutar cambios de AgentLabs sobre el repo real",
			"Hacer commit/push",
		],
		detectedModules: signals.moduleCandidates,
		detectedFlows: signals.flowCandidates,
		dataStores: signals.dataStoreCandidates,
		architecture: signals.architecture,
		securityModel: signals.securityModel,
		toolingDetected: signals.toolingDetected,
		ignoredTooling: signals.ignoredTooling,
		userRoles: inferUserRoles(signals),
		criticalRisks: inferCriticalRisks(autoDepth, source, signals),
		qualityRisks: inferQualityRisks(signals),
		securityRisks: inferSecurityRisks(signals),
		architectureRisks: inferArchitectureRisks(source, signals),
		openQuestions: inferOpenQuestions(source, signals),
		assumptions: inferAssumptions(signals, input.reason),
		recommendedNext: recommendedNext(autoDepth),
		sourceFiles: signals.sourceFiles.slice(0, 50),
		agentLabReviews: [
			...autoDepth.agentLabsSelected.map((specialty) => ({
				specialty,
				status: "not_run" as const,
				reason:
					"Seleccionado como metadata por AutoDepth; MASTER-PLAN-1 no ejecuta AgentLabs automáticamente.",
				maxCommands: autoDepth.mode === "quick" ? 3 : 3,
			})),
			...autoDepth.skippedAgentLabs.map((specialty) => ({
				specialty,
				status: "skipped" as const,
				reason:
					"Deep review requiere aprobación humana antes de gastar más contexto/comandos.",
				maxCommands: 0,
			})),
		],
	};
	const baseName = uniqueMasterPlanBaseName(reportsDir, generatedAt);
	const relativeJson = `reports/${baseName}.json`;
	const relativeMd = `reports/${baseName}.md`;
	const jsonPath = join(stateRoot, relativeJson);
	const markdownPath = join(stateRoot, relativeMd);
	writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	const current = writeCurrent(stateRoot, {
		currentPlanJson: relativeJson,
		currentPlanMd: relativeMd,
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: generatedAt,
	});
	const memory = writeMemory(stateRoot, plan, current);
	return { plan, current, memory, jsonPath, markdownPath };
}

export function getMasterPlanStatus(input: {
	stateRoot: string;
	currentGitHead?: string;
}): MasterPlanStatusResult {
	const stateRoot = resolve(input.stateRoot);
	const current = readCurrent(stateRoot);
	if (!current) {
		return {
			status: "missing",
			exists: false,
			recommendedNext: "Ejecutar idu-pi idu para generar Plan Maestro draft.",
		};
	}
	const compatibility = currentPlanCompatibility(stateRoot, current);
	if (!compatibility.compatible) {
		return incompatibleStatus(current, compatibility.reason);
	}
	if (
		current.status === "approved" &&
		input.currentGitHead &&
		current.gitHead &&
		input.currentGitHead !== current.gitHead
	) {
		const stale = writeCurrent(stateRoot, {
			...current,
			status: "stale",
			gitHead: input.currentGitHead,
			updatedAt: new Date().toISOString(),
		});
		const plan = readPlan(
			safePlanPathInsideReports(stateRoot, stale.currentPlanJson),
		);
		if (plan)
			writeMemory(
				stateRoot,
				{ ...plan, status: "stale", gitHead: input.currentGitHead },
				stale,
			);
		return {
			...stale,
			exists: true,
			staleReason:
				"Git HEAD cambió desde la aprobación; se recomienda redraft.",
		};
	}
	return { ...current, exists: true };
}

export function reviewMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
}): MasterPlanReview {
	const stateRoot = resolve(input.stateRoot);
	const current = readCurrent(stateRoot);
	const pathResolution = resolvePlanPathForReview(
		stateRoot,
		input.pathOrLatest,
		current,
	);
	if (!pathResolution.ok) {
		if (input.pathOrLatest !== "latest") throw new Error(pathResolution.reason);
		return incompatibleReview(stateRoot, current, pathResolution.reason);
	}
	const jsonPath = pathResolution.path;
	const raw = readPlanRaw(jsonPath);
	if (!raw)
		return incompatibleReview(stateRoot, current, "JSON inválido o ilegible");
	if (!isMasterPlanCompatible(raw)) {
		return incompatibleReview(
			stateRoot,
			current,
			masterPlanCompatibilityReason(raw),
			jsonPath,
		);
	}
	const plan = normalizeMasterPlan(raw);
	const markdownPath =
		current?.currentPlanJson === relativeFromState(stateRoot, jsonPath)
			? safePathInsideState(stateRoot, current.currentPlanMd)
			: jsonPath.replace(/\.json$/u, ".md");
	const markdown = existsSync(markdownPath)
		? readFileSync(markdownPath, "utf8")
		: formatMasterPlanMarkdown(plan);
	return { plan, current, markdown, jsonPath, markdownPath };
}

export function approveMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
	source: "cli" | "pi" | "telegram" | "mcp";
}): MasterPlanDraftResult {
	return updatePlanDecision(input.stateRoot, input.pathOrLatest, (plan) => ({
		...plan,
		status: "approved",
		approval: { approvedAt: new Date().toISOString(), source: input.source },
	}));
}

export function rejectMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
	reason?: string;
}): MasterPlanDraftResult {
	return updatePlanDecision(input.stateRoot, input.pathOrLatest, (plan) => ({
		...plan,
		status: "rejected",
		approval: {
			rejectedAt: new Date().toISOString(),
			...(input.reason ? { reason: input.reason } : {}),
		},
	}));
}

export function redraftMasterPlan(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	reason?: string;
}): MasterPlanDraftResult {
	return generateMasterPlanDraft(input);
}

export function ensureMasterPlanForIdu(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
}):
	| MasterPlanDraftResult
	| { status: MasterPlanStatusResult; plan?: MasterPlan } {
	const status = getMasterPlanStatus({
		stateRoot: input.stateRoot,
		currentGitHead: input.gitHead,
	});
	if (!status.exists || status.status === "rejected") {
		return generateMasterPlanDraft(input);
	}
	if ("incompatibleReason" in status) {
		return {
			...generateMasterPlanDraft({
				...input,
				reason: `Plan Maestro anterior incompatible: ${status.incompatibleReason}`,
			}),
			automaticNote:
				"Plan Maestro anterior incompatible con esquema actual; generé nuevo draft",
		};
	}
	const plan = status.currentPlanJson
		? readPlan(
				safePlanPathInsideReports(input.stateRoot, status.currentPlanJson),
			)
		: undefined;
	return { status, plan };
}

export function formatMasterPlanSummaryForIdu(
	result:
		| MasterPlanDraftResult
		| { status: MasterPlanStatusResult; plan?: MasterPlan },
): string {
	const isDraftResult = "plan" in result && "current" in result;
	const plan = result.plan;
	const status = isDraftResult ? result.plan.status : result.status.status;
	const savedPath = isDraftResult
		? result.jsonPath
		: result.status.exists
			? result.status.currentPlanJson
			: "—";
	const lines = [
		"Plan Maestro:",
		status,
		"",
		"Objetivo:",
		plan?.inferredObjective ?? "—",
		"",
		"Arquitectura:",
		plan ? shortArchitectureLine(plan) : "—",
		"",
		"Datos:",
		plan ? shortDataLine(plan) : "—",
		"",
		"Auth:",
		plan
			? plan.securityModel.authDetected
				? "detectado"
				: "no detectado"
			: "—",
		"",
		"Flujos principales:",
		...(plan ? topFlowLines(plan) : ["- —"]),
		"",
		"AutoDepth:",
		plan ? `${plan.autoDepth.mode} — ${plan.autoDepth.reason}` : "—",
		"",
		"Guardado en:",
		savedPath,
		"",
		"Acción automática:",
		...(isDraftResult
			? [
					...(result.automaticNote ? [`- ${result.automaticNote}`] : []),
					"- Revisé estado aislado",
					"- Analicé estructura básica",
					"- Generé Plan Maestro draft",
					"- Guardé resumen optimizado",
				]
			: ["- Reutilicé Plan Maestro existente"]),
		"",
		"Acción principal:",
		...masterPlanActionLines(status, plan),
		"",
		"CLI interactivo:",
		"Usá idu-pi y elegí Proyecto actual / Plan Maestro. Si falta esa pantalla, queda como siguiente etapa CLI-UX-PLAN-1.",
	];
	if (plan?.autoDepth.mode === "deep_required") {
		lines.push(
			"",
			"Advertencias:",
			"- Requiere aprobación humana antes de deep review.",
			"- No ejecutar deep review automáticamente.",
		);
	}
	return lines.join("\n");
}

function masterPlanActionLines(
	status: MasterPlanStatus | "missing",
	plan?: MasterPlan,
): string[] {
	if (status === "draft") {
		return [
			"1. Ver detalles: idu-pi master-plan-review latest",
			"2. Aprobar: idu-pi master-plan-approve latest",
			"3. Rehacer: idu-pi master-plan-redraft latest",
		];
	}
	if (status === "approved") {
		return [
			"1. Continuar con prepare/flows según corresponda: idu-pi idu-prepare",
			"2. Ver detalles: idu-pi master-plan-review latest",
		];
	}
	if (status === "stale") {
		return ["1. Rehacer: idu-pi master-plan-redraft latest"];
	}
	if (status === "rejected") {
		return ["1. Rehacer: idu-pi master-plan-redraft latest"];
	}
	if (status === "incompatible") {
		return ["1. Rehacer: idu-pi master-plan-redraft latest"];
	}
	return plan ? ["1. Ver detalles: idu-pi master-plan-review latest"] : [];
}

function shortArchitectureLine(plan: MasterPlan): string {
	return (
		[
			plan.architecture.frontend,
			plan.architecture.backend,
			plan.architecture.database !== "no detectada"
				? plan.architecture.database
				: undefined,
		]
			.filter((value): value is string => !!value && value !== "no claro")
			.join(" + ") || plan.architecture.projectKind
	);
}

function shortDataLine(plan: MasterPlan): string {
	return plan.dataStores.length
		? plan.dataStores.map((store) => store.name).join(" / ")
		: "no detectada";
}

function topFlowLines(plan: MasterPlan): string[] {
	return plan.detectedFlows.length
		? plan.detectedFlows
				.slice(0, 3)
				.map((flow, index) => `${index + 1}. ${flow.name}`)
		: ["- —"];
}

export function formatMasterPlanStatus(result: MasterPlanStatusResult): string {
	if (!result.exists) {
		return [
			"Master Plan Status",
			"",
			"Estado:",
			"missing",
			"",
			"Siguiente:",
			result.recommendedNext,
		].join("\n");
	}
	if ("incompatibleReason" in result) {
		return [
			"Master Plan Status",
			"",
			"Estado:",
			"incompatible",
			"",
			"Motivo:",
			result.incompatibleReason,
			"",
			"Siguiente:",
			result.recommendedNext,
		].join("\n");
	}
	return [
		"Master Plan Status",
		"",
		"Estado:",
		result.status,
		"",
		"JSON:",
		result.currentPlanJson,
		"",
		"Markdown:",
		result.currentPlanMd,
		...(result.staleReason ? ["", "Stale:", result.staleReason] : []),
	].join("\n");
}

export function formatMasterPlanReview(review: MasterPlanReview): string {
	return review.markdown;
}

export function formatMasterPlanOperation(
	result: MasterPlanDraftResult,
): string {
	return [
		"Master Plan",
		"",
		"Estado:",
		result.plan.status,
		"",
		"JSON:",
		result.jsonPath,
		"",
		"Markdown:",
		result.markdownPath,
		"",
		"No apliqué flows, no confirmé Project Core/Constitution, no ejecuté AgentLabs y no hice commit/push.",
	].join("\n");
}

export function formatMasterPlanMarkdown(plan: MasterPlan): string {
	return [
		"# Plan Maestro Idu-pi",
		"",
		"## Resumen ejecutivo",
		plan.executiveSummary,
		"",
		"## Modo de análisis automático",
		`${plan.autoDepth.mode} — ${plan.autoDepth.reason}`,
		"",
		"Señales:",
		...bulletList(plan.autoDepth.signals),
		"",
		"## Objetivo inferido",
		plan.inferredObjective,
		"",
		"## Alcance",
		...bulletList(plan.scope),
		"",
		"## Fuera de alcance",
		...bulletList(plan.outOfScope),
		"",
		"## Arquitectura detectada",
		...bulletList([
			`Tipo: ${plan.architecture.projectKind}`,
			`Frontend: ${plan.architecture.frontend}`,
			`Backend: ${plan.architecture.backend}`,
			`Base de datos: ${plan.architecture.database}`,
			`Auth: ${plan.architecture.auth}`,
			`Deploy: ${plan.architecture.deployment}`,
			`Package manager: ${plan.architecture.packageManager}`,
		]),
		"",
		"## Stack/lenguajes",
		...bulletList([
			`Lenguajes: ${plan.architecture.languages.join(", ") || "—"}`,
			`Frameworks: ${plan.architecture.frameworks.join(", ") || "—"}`,
			...plan.architecture.evidence.map((item) => `Evidencia: ${item}`),
		]),
		"",
		"## Persistencia / datos",
		...bulletList(plan.dataStores.map(formatDataStoreForMarkdown)),
		"",
		"## Seguridad / auth",
		...bulletList([
			`Auth detectado: ${plan.securityModel.authDetected ? "sí" : "no"}`,
			`Sesión detectada: ${plan.securityModel.sessionDetected ? "sí" : "no"}`,
			...plan.securityModel.sensitiveFlows.map(
				(flow) => `Flujo sensible: ${flow}`,
			),
			...plan.securityModel.evidence.map((item) => `Evidencia: ${item}`),
		]),
		"",
		"## Módulos detectados",
		...bulletList(plan.detectedModules),
		"",
		"## Flujos funcionales",
		...bulletList(plan.detectedFlows.map(formatFlowForMarkdown)),
		"",
		"## Tooling detectado",
		...bulletList(plan.toolingDetected),
		"",
		"## Riesgos",
		...bulletList([
			...plan.criticalRisks,
			...plan.securityRisks,
			...plan.architectureRisks,
			...plan.qualityRisks,
		]),
		"",
		"## Preguntas abiertas",
		...bulletList(plan.openQuestions),
		"",
		"## Próximos pasos",
		...bulletList(plan.recommendedNext),
		"",
		"## Estado de aprobación",
		plan.status,
	].join("\n");
}

function formatDataStoreForMarkdown(store: MasterPlanDataStore): string {
	return `${store.name} (${store.type}, riesgo ${store.riskLevel}) — ${store.evidence.slice(0, 3).join(", ")}`;
}

function incompatibleReview(
	stateRoot: string,
	current: MasterPlanCurrent | undefined,
	reason: string,
	jsonPath = "",
): MasterPlanReview {
	const diagnosticPlan = diagnosticMasterPlan(stateRoot, current, reason);
	return {
		plan: diagnosticPlan,
		current,
		jsonPath,
		markdown: [
			"# Plan Maestro incompatible",
			"",
			"El Plan Maestro actual no es compatible con el esquema vigente.",
			"",
			"Motivo:",
			`- ${reason}`,
			"",
			"Acción recomendada:",
			"- idu-pi master-plan-redraft latest",
			"",
			"No regeneré automáticamente desde review; `/idu` sí puede generar un nuevo draft compatible.",
		].join("\n"),
	};
}

function diagnosticMasterPlan(
	stateRoot: string,
	current: MasterPlanCurrent | undefined,
	reason: string,
): MasterPlan {
	return {
		version: "1.0.0",
		schemaVersion: MASTER_PLAN_SCHEMA_VERSION,
		projectId: current?.projectId ?? "unknown",
		projectPath: current?.projectPath ?? stateRoot,
		generatedAt: new Date().toISOString(),
		status: "incompatible",
		autoDepth: {
			mode: "quick",
			reason: "plan incompatible",
			signals: [reason],
			agentLabsSelected: [],
			skippedAgentLabs: [],
			tokenCostHint: "low",
		},
		source: {
			projectCoreStatus: "unknown",
			constitutionStatus: "unknown",
			blueprintStatus: "unknown",
			flowsStatus: "unknown",
			scanStatus: "incompatible",
		},
		executiveSummary: "Plan Maestro incompatible con el esquema actual.",
		inferredObjective: "Rehacer Plan Maestro compatible.",
		problemStatement: reason,
		scope: [],
		outOfScope: [],
		detectedModules: [],
		detectedFlows: [],
		dataStores: [],
		architecture: {
			projectKind: "unknown",
			frontend: "no claro",
			backend: "no claro",
			database: "no detectada",
			auth: "no detectado",
			deployment: "no detectado",
			packageManager: "unknown",
			languages: [],
			frameworks: [],
			evidence: [],
		},
		securityModel: {
			authDetected: false,
			sessionDetected: false,
			sensitiveFlows: [],
			evidence: [],
		},
		toolingDetected: [],
		ignoredTooling: [],
		userRoles: [],
		criticalRisks: [reason],
		qualityRisks: [],
		securityRisks: [],
		architectureRisks: [],
		openQuestions: [],
		assumptions: [],
		recommendedNext: ["Rehacer: idu-pi master-plan-redraft latest"],
		sourceFiles: [],
		agentLabReviews: [],
	};
}

function formatFlowForMarkdown(flow: MasterPlanFunctionalFlow): string {
	return `${flow.name} [${flow.type}, riesgo ${flow.riskLevel}]: ${flow.from} → ${flow.through.join(" → ") || "proceso detectado"} → ${flow.to}; módulos=${flow.modules.join(", ") || "—"}; datos=${flow.dataStores.join(", ") || "—"}; evidencia=${flow.evidence.slice(0, 3).join(", ")}`;
}

function updatePlanDecision(
	stateRootInput: string,
	pathOrLatest: string,
	update: (plan: MasterPlan) => MasterPlan,
): MasterPlanDraftResult {
	const stateRoot = resolve(stateRootInput);
	const current = readCurrent(stateRoot);
	const jsonPath = resolvePlanPath(stateRoot, pathOrLatest, current);
	const plan = update(requirePlan(jsonPath));
	writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	const markdownPath =
		current?.currentPlanJson === relativeFromState(stateRoot, jsonPath)
			? safePathInsideState(stateRoot, current.currentPlanMd)
			: jsonPath.replace(/\.json$/u, ".md");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	const nextCurrent = writeCurrent(stateRoot, {
		currentPlanJson: relativeFromState(stateRoot, jsonPath),
		currentPlanMd: relativeFromState(stateRoot, markdownPath),
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: new Date().toISOString(),
	});
	const memory = writeMemory(stateRoot, plan, nextCurrent);
	return { plan, current: nextCurrent, memory, jsonPath, markdownPath };
}

type ProjectSignals = {
	fileCount: number;
	directoryCount: number;
	docsBytes: number;
	approxRelevantBytes: number;
	hasPackageJson: boolean;
	dependencyCount: number;
	hasTests: boolean;
	hasDb: boolean;
	hasAuth: boolean;
	routeCount: number;
	moduleCandidates: string[];
	flowCandidates: MasterPlanFunctionalFlow[];
	dataStoreCandidates: MasterPlanDataStore[];
	architecture: MasterPlanArchitecture;
	securityModel: MasterPlanSecurityModel;
	toolingDetected: string[];
	ignoredTooling: string[];
	sourceFiles: string[];
};

type PackageMetadata = {
	dependencyCount: number;
	packageManager: string;
	dependencies: string[];
};

export function classifyProjectPath(path: string): ProjectPathClassification {
	const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "");
	const segments = normalized.split("/").filter(Boolean);
	const first = segments[0] ?? normalized;
	const lower = normalized.toLowerCase();
	const firstLower = first.toLowerCase();
	if (!normalized) return "unknown";
	if (VENDOR_DIRS.has(firstLower)) return "vendor";
	if (GENERATED_DIRS.has(firstLower)) return "generated";
	if (RUNTIME_STATE_DIRS.has(firstLower)) return "runtime_state";
	if (AGENT_METADATA_DIRS.has(firstLower)) return "agent_metadata";
	if (TOOLING_DIRS.has(firstLower)) return "tooling";
	if (
		first.startsWith(".") &&
		(/agent|ai|aider|codex|claude|cursor|augment|windsurf|goose|mcp/u.test(
			firstLower,
		) ||
			/skills?|prompts?|cache|state|workflows?/u.test(lower))
	)
		return "agent_metadata";
	if (first.startsWith(".")) return "tooling";
	if (
		/\.(test|spec)\.[jt]sx?$/iu.test(lower) ||
		/(^|\/)(__tests__|test|tests)(\/|$)/u.test(lower)
	)
		return "test";
	if (
		/^(docs?|readme\.md|architecture\.md)/iu.test(lower) ||
		/\.md$/iu.test(lower)
	)
		return "docs";
	if (
		/^(supabase|prisma|database|db|migrations?)(\/|$)/u.test(lower) ||
		/schema\.(prisma|sql)$/u.test(lower)
	)
		return "data_store";
	if (
		/(^|\/)(components?|widgets?)(\/|$)/u.test(lower) ||
		/\.[jt]sx$/u.test(lower)
	)
		return "component";
	if (/auth|login|session|token|middleware|password|jwt/u.test(lower))
		return "auth";
	if (/^(routes?|api|server\/routes?|app\/api)(\/|$)/u.test(lower))
		return "route";
	if (/(^|\/)(services?|controllers?)(\/|$)/u.test(lower)) return "service";
	if (
		/^(public|views?|pages?|app|screens?)(\/|$)/u.test(lower) ||
		/\.html?$/u.test(lower)
	)
		return "ui";
	if (/^(src|lib|server|models?|modules?)(\/|$)/u.test(lower))
		return "app_module";
	if (
		/^(package\.json|[^/]+lock\.(json|yaml)|pnpm-lock\.yaml|vite\.config|next\.config|tailwind\.config|tsconfig\.json)/u.test(
			lower,
		)
	)
		return "configuration";
	return "unknown";
}

function collectProjectSignals(projectPath: string): ProjectSignals {
	const files: string[] = [];
	const directories = new Set<string>();
	let docsBytes = 0;
	let approxRelevantBytes = 0;
	let hasTests = false;
	let hasDb = false;
	let hasAuth = false;
	let routeCount = 0;
	const moduleCandidates = new Set<string>();
	const dataStoreMap = new Map<string, MasterPlanDataStore>();
	const toolingDetected = new Set<string>();
	const ignoredTooling = new Set<string>();
	const languageSet = new Set<string>();
	const frameworkSet = new Set<string>();
	const architectureEvidence = new Set<string>();
	const securityEvidence = new Set<string>();
	const authFiles: string[] = [];
	const uploadFiles: string[] = [];
	const reportFiles: string[] = [];
	const apiFiles: string[] = [];
	walkProject(projectPath, (path, stats) => {
		const rel = relative(projectPath, path).replace(/\\/gu, "/");
		const classification = classifyProjectPath(rel);
		const top = rel.split("/")[0] ?? rel;
		if (classification === "tooling" || classification === "agent_metadata") {
			toolingDetected.add(top);
			ignoredTooling.add(top);
			return;
		}
		if (stats.isDirectory()) {
			directories.add(rel);
			if (isProductClassification(classification) && rel.split("/").length <= 2)
				moduleCandidates.add(top);
			return;
		}
		if (isIgnoredClassification(classification)) return;
		files.push(rel);
		const ext = extname(rel).toLowerCase();
		addLanguageForExtension(languageSet, ext);
		if (TEXT_EXTENSIONS.has(ext)) {
			approxRelevantBytes += Math.min(Number(stats.size), 512_000);
			const content = safeReadText(path);
			collectContentSignals(rel, content, {
				dataStoreMap,
				frameworkSet,
				architectureEvidence,
				securityEvidence,
			});
			if (
				/upload|storage|preview|normalize|bpi|formData|multipart/iu.test(
					`${rel} ${content}`,
				)
			)
				uploadFiles.push(rel);
			if (/report|dashboard|analytics|chart|export/iu.test(`${rel} ${content}`))
				reportFiles.push(rel);
			if (
				/auth|login|session|token|password|jwt|middleware/iu.test(
					`${rel} ${content}`,
				)
			) {
				hasAuth = true;
				authFiles.push(rel);
				securityEvidence.add(rel);
			}
		}
		if (ext === ".md") docsBytes += Number(stats.size);
		if (classification === "test") hasTests = true;
		if (classification === "data_store") {
			hasDb = true;
			addDataStore(dataStoreMap, dataStoreFromPath(rel), rel);
		}
		if (classification === "auth") {
			hasAuth = true;
			authFiles.push(rel);
			securityEvidence.add(rel);
		}
		if (
			classification === "route" ||
			classification === "ui" ||
			classification === "component"
		)
			routeCount += 1;
		if (classification === "route") apiFiles.push(rel);
	});
	const packagePath = join(projectPath, "package.json");
	const packageMetadata = readPackageMetadata(packagePath);
	for (const dependency of packageMetadata.dependencies) {
		addFrameworkFromDependency(frameworkSet, dependency);
		addDataStoreFromDependency(dataStoreMap, dependency, "package.json");
		if (/auth|jwt|passport|bcrypt/iu.test(dependency)) {
			hasAuth = true;
			securityEvidence.add(`package:${dependency}`);
		}
	}
	if (existsSync(join(projectPath, "pnpm-lock.yaml")))
		packageMetadata.packageManager = "pnpm";
	if (existsSync(join(projectPath, "package-lock.json")))
		packageMetadata.packageManager = "npm";
	if (existsSync(join(projectPath, "yarn.lock")))
		packageMetadata.packageManager = "yarn";
	if (
		existsSync(join(projectPath, "vite.config.ts")) ||
		existsSync(join(projectPath, "vite.config.js"))
	)
		frameworkSet.add("Vite");
	if (
		existsSync(join(projectPath, "next.config.ts")) ||
		existsSync(join(projectPath, "next.config.js"))
	)
		frameworkSet.add("Next.js");
	const dataStores = [...dataStoreMap.values()].slice(0, 20);
	hasDb = hasDb || dataStores.length > 0;
	const modules = [...moduleCandidates].slice(0, 20);
	const architecture = buildArchitecture({
		packageManager: packageMetadata.packageManager,
		languages: [...languageSet],
		frameworks: [...frameworkSet],
		dataStores,
		hasAuth,
		evidence: [...architectureEvidence],
		files,
	});
	const securityModel: MasterPlanSecurityModel = {
		authDetected: hasAuth,
		sessionDetected: [...securityEvidence].some((item) =>
			/session|token|jwt|localStorage/iu.test(item),
		),
		sensitiveFlows: hasAuth ? ["Login/acceso"] : [],
		evidence: [...securityEvidence].slice(0, 12),
	};
	return {
		fileCount: files.length,
		directoryCount: directories.size,
		docsBytes,
		approxRelevantBytes,
		hasPackageJson: existsSync(packagePath),
		dependencyCount: packageMetadata.dependencyCount,
		hasTests,
		hasDb,
		hasAuth,
		routeCount,
		moduleCandidates: modules,
		flowCandidates: inferFunctionalFlows({
			modules,
			dataStores,
			authFiles,
			uploadFiles,
			reportFiles,
			apiFiles,
		}),
		dataStoreCandidates: dataStores,
		architecture,
		securityModel,
		toolingDetected: [...toolingDetected].sort().slice(0, 20),
		ignoredTooling: [...ignoredTooling].sort().slice(0, 20),
		sourceFiles: files.slice(0, 200),
	};
}

function walkProject(
	root: string,
	visit: (path: string, stats: Stats) => void,
): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue;
		const path = join(root, entry.name);
		let stats: Stats;
		try {
			stats = statSync(path);
		} catch {
			continue;
		}
		visit(path, stats);
		if (stats.isDirectory() && !shouldSkipRecursion(entry.name))
			walkProject(path, visit);
	}
}

function isProductClassification(
	classification: ProjectPathClassification,
): boolean {
	return [
		"app_module",
		"route",
		"component",
		"service",
		"data_store",
		"auth",
		"ui",
		"product_code",
		"business_module",
		"api_route",
		"data_layer",
		"auth_security",
	].includes(classification);
}

function isIgnoredClassification(
	classification: ProjectPathClassification,
): boolean {
	return [
		"generated",
		"vendor",
		"runtime_state",
		"ignored",
		"tooling",
		"agent_metadata",
	].includes(classification);
}

function shouldSkipRecursion(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		SKIPPED_DIRS.has(name) ||
		AGENT_METADATA_DIRS.has(lower) ||
		TOOLING_DIRS.has(lower) ||
		GENERATED_DIRS.has(lower) ||
		VENDOR_DIRS.has(lower) ||
		RUNTIME_STATE_DIRS.has(lower) ||
		(lower.startsWith(".") &&
			/agent|ai|aider|codex|claude|cursor|augment|windsurf|goose|mcp/u.test(
				lower,
			))
	);
}

function safeReadText(path: string): string {
	try {
		return readFileSync(path, "utf8").slice(0, 512_000);
	} catch {
		return "";
	}
}

function addLanguageForExtension(languages: Set<string>, ext: string): void {
	if ([".ts", ".tsx"].includes(ext)) languages.add("TypeScript");
	if ([".js", ".jsx"].includes(ext)) languages.add("JavaScript");
	if ([".html", ".htm"].includes(ext)) languages.add("HTML");
	if (ext === ".css") languages.add("CSS");
	if (ext === ".py") languages.add("Python");
	if (ext === ".php") languages.add("PHP");
	if (ext === ".sql") languages.add("SQL");
}

function collectContentSignals(
	rel: string,
	content: string,
	acc: {
		dataStoreMap: Map<string, MasterPlanDataStore>;
		frameworkSet: Set<string>;
		architectureEvidence: Set<string>;
		securityEvidence: Set<string>;
	},
): void {
	if (/supabase/iu.test(`${rel} ${content}`))
		addDataStore(acc.dataStoreMap, "supabase", rel);
	if (/postgres|pg\b|create table/iu.test(content))
		addDataStore(acc.dataStoreMap, "postgres", rel);
	if (/sqlite|\.sqlite|\.db/iu.test(`${rel} ${content}`))
		addDataStore(acc.dataStoreMap, "sqlite", rel);
	if (/mysql/iu.test(`${rel} ${content}`))
		addDataStore(acc.dataStoreMap, "mysql", rel);
	if (/mongo(db|ose)?/iu.test(`${rel} ${content}`))
		addDataStore(acc.dataStoreMap, "mongodb", rel);
	if (/indexedDB/iu.test(content))
		addDataStore(acc.dataStoreMap, "indexedDB", rel);
	if (/localStorage/iu.test(content))
		addDataStore(acc.dataStoreMap, "localStorage", rel);
	if (/fetch\s*\(\s*["']\/api\//u.test(content))
		addDataStore(acc.dataStoreMap, "api", rel);
	if (/react/iu.test(content)) acc.frameworkSet.add("React");
	if (/express/iu.test(content)) acc.frameworkSet.add("Express");
	if (/createClient\(|@supabase\/supabase-js/iu.test(content))
		acc.frameworkSet.add("Supabase");
	if (/auth|login|password|jwt|middleware/iu.test(`${rel} ${content}`))
		acc.securityEvidence.add(rel);
	if (/session|token|localStorage/iu.test(content))
		acc.securityEvidence.add(`session:${rel}`);
	if (
		/server|route|api|component|page|vite|next|tailwind/iu.test(
			`${rel} ${content}`,
		)
	)
		acc.architectureEvidence.add(rel);
}

function dataStoreFromPath(rel: string): MasterPlanDataStore["type"] {
	if (/supabase/iu.test(rel)) return "supabase";
	if (/prisma/iu.test(rel)) return "prisma";
	if (/postgres|\.sql|migration/iu.test(rel)) return "postgres";
	if (/sqlite|\.db/iu.test(rel)) return "sqlite";
	if (/mysql/iu.test(rel)) return "mysql";
	if (/mongo/iu.test(rel)) return "mongodb";
	if (/\.json$/iu.test(rel)) return "json";
	return "unknown";
}

function addDataStore(
	stores: Map<string, MasterPlanDataStore>,
	type: MasterPlanDataStore["type"],
	evidence: string,
): void {
	const name = type === "postgres" ? "Postgres" : type;
	const existing = stores.get(type);
	const riskLevel = [
		"supabase",
		"postgres",
		"mysql",
		"mongodb",
		"prisma",
	].includes(type)
		? "high"
		: type === "localStorage" || type === "indexedDB"
			? "medium"
			: "low";
	if (existing) {
		if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
		return;
	}
	stores.set(type, { name, type, evidence: [evidence], riskLevel });
}

function readPackageMetadata(packagePath: string): PackageMetadata {
	try {
		if (!existsSync(packagePath))
			return {
				dependencyCount: 0,
				packageManager: "unknown",
				dependencies: [],
			};
		const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
			packageManager?: string;
			dependencies?: Record<string, unknown>;
			devDependencies?: Record<string, unknown>;
		};
		const dependencies = [
			...Object.keys(parsed.dependencies ?? {}),
			...Object.keys(parsed.devDependencies ?? {}),
		];
		return {
			dependencyCount: dependencies.length,
			packageManager: parsed.packageManager?.split("@")[0] ?? "npm",
			dependencies,
		};
	} catch {
		return { dependencyCount: 0, packageManager: "unknown", dependencies: [] };
	}
}

function addFrameworkFromDependency(
	frameworks: Set<string>,
	dependency: string,
): void {
	if (dependency === "react") frameworks.add("React");
	if (dependency === "vue") frameworks.add("Vue");
	if (dependency === "svelte") frameworks.add("Svelte");
	if (dependency === "next") frameworks.add("Next.js");
	if (dependency === "vite") frameworks.add("Vite");
	if (dependency === "express") frameworks.add("Express");
	if (dependency.includes("supabase")) frameworks.add("Supabase");
}

function addDataStoreFromDependency(
	stores: Map<string, MasterPlanDataStore>,
	dependency: string,
	evidence: string,
): void {
	if (dependency.includes("supabase"))
		addDataStore(stores, "supabase", evidence);
	if (/pg|postgres/iu.test(dependency))
		addDataStore(stores, "postgres", evidence);
	if (/sqlite/iu.test(dependency)) addDataStore(stores, "sqlite", evidence);
	if (/mysql/iu.test(dependency)) addDataStore(stores, "mysql", evidence);
	if (/mongo/iu.test(dependency)) addDataStore(stores, "mongodb", evidence);
	if (/prisma/iu.test(dependency)) addDataStore(stores, "prisma", evidence);
}

function buildArchitecture(input: {
	packageManager: string;
	languages: string[];
	frameworks: string[];
	dataStores: MasterPlanDataStore[];
	hasAuth: boolean;
	evidence: string[];
	files: string[];
}): MasterPlanArchitecture {
	const hasFrontend =
		input.languages.some((language) => ["HTML", "CSS"].includes(language)) ||
		input.frameworks.some((framework) =>
			["React", "Vue", "Svelte", "Next.js", "Vite"].includes(framework),
		);
	const hasBackend =
		input.frameworks.includes("Express") ||
		input.files.some((file) => /^(server|routes?|api)\//u.test(file));
	const database = databaseSummary(input.dataStores);
	return {
		projectKind:
			hasFrontend && hasBackend
				? "full-stack"
				: hasFrontend
					? "frontend"
					: hasBackend
						? "backend"
						: "unknown",
		frontend: hasFrontend
			? frontendSummary(input.frameworks, input.languages)
			: "no claro",
		backend: hasBackend ? backendSummary(input.frameworks) : "no claro",
		database,
		auth: input.hasAuth ? "auth/login detectado" : "no detectado",
		deployment: input.files.some((file) =>
			/dockerfile|vercel|netlify|render|fly\.toml/iu.test(file),
		)
			? "config detectada"
			: "no detectado",
		packageManager: input.packageManager,
		languages: unique(input.languages).sort(),
		frameworks: unique(input.frameworks).sort(),
		evidence: input.evidence.slice(0, 12),
	};
}

function frontendSummary(frameworks: string[], languages: string[]): string {
	const frontend = frameworks.filter((framework) =>
		["React", "Vue", "Svelte", "Next.js", "Vite"].includes(framework),
	);
	if (frontend.length) return frontend.join(" + ");
	return languages.includes("HTML") ? "HTML/JS" : "no claro";
}

function backendSummary(frameworks: string[]): string {
	if (frameworks.includes("Express")) return "Node/Express";
	return "Node/backend routes";
}

function databaseSummary(dataStores: MasterPlanDataStore[]): string {
	const types = new Set(dataStores.map((store) => store.type));
	if (types.has("supabase")) return "Supabase/Postgres";
	if (types.has("postgres")) return "Postgres";
	if (types.has("prisma")) return "Prisma";
	if (types.has("sqlite")) return "SQLite";
	if (types.has("mysql")) return "MySQL";
	if (types.has("mongodb")) return "MongoDB";
	if (types.has("localStorage")) return "localStorage";
	if (types.has("json")) return "JSON files";
	return "no detectada";
}

function inferFunctionalFlows(input: {
	modules: string[];
	dataStores: MasterPlanDataStore[];
	authFiles: string[];
	uploadFiles: string[];
	reportFiles: string[];
	apiFiles: string[];
}): MasterPlanFunctionalFlow[] {
	const flows: MasterPlanFunctionalFlow[] = [];
	const dataStoreNames = input.dataStores.map((store) => store.type);
	if (input.authFiles.length) {
		const authEvidence = rankedEvidence(input.authFiles, [
			/login/iu,
			/auth/iu,
			/session|token|jwt/iu,
			/middleware/iu,
		]);
		flows.push({
			name: "Login/acceso",
			type: "auth",
			from: "usuario en pantalla login",
			through: authEvidence.slice(0, 5),
			to: "sesión/dashboard",
			modules: modulesForEvidence(input.modules, authEvidence),
			dataStores: dataStoreNames.filter((store) =>
				["supabase", "localStorage", "api"].includes(store),
			),
			triggers: ["login", "auth", "session"],
			evidence: authEvidence.slice(0, 8),
			riskLevel: "high",
		});
	}
	if (input.uploadFiles.length) {
		const uploadEvidence = rankedEvidence(input.uploadFiles, [
			/upload|bpi/iu,
			/preview/iu,
			/normalize/iu,
			/storage|supabase/iu,
		]);
		flows.push({
			name: "Carga/ingesta de archivos",
			type: "data_ingest",
			from: "usuario carga archivo",
			through: uploadEvidence.slice(0, 6),
			to: dataStoreNames[0] ?? "persistencia por confirmar",
			modules: modulesForEvidence(input.modules, uploadEvidence),
			dataStores: dataStoreNames,
			triggers: ["upload", "preview", "normalize", "storage"],
			evidence: uploadEvidence.slice(0, 8),
			riskLevel: dataStoreNames.length ? "high" : "medium",
		});
	}
	if (input.reportFiles.length) {
		const reportEvidence = rankedEvidence(input.reportFiles, [
			/report/iu,
			/dashboard/iu,
			/analytics|chart/iu,
			/export/iu,
		]);
		flows.push({
			name: "Reportes/visualización operativa",
			type: "reporting",
			from: "usuario solicita reporte",
			through: reportEvidence.slice(0, 6),
			to: "dashboard/reporte",
			modules: modulesForEvidence(input.modules, reportEvidence),
			dataStores: dataStoreNames,
			triggers: ["report", "dashboard", "export"],
			evidence: reportEvidence.slice(0, 8),
			riskLevel: dataStoreNames.length ? "medium" : "low",
		});
	}
	if (!flows.length && input.apiFiles.length) {
		flows.push({
			name: "API / rutas funcionales",
			type: "api",
			from: "usuario o cliente",
			through: input.apiFiles.slice(0, 6),
			to: dataStoreNames[0] ?? "respuesta API",
			modules: modulesForEvidence(input.modules, input.apiFiles),
			dataStores: dataStoreNames,
			triggers: ["request", "route"],
			evidence: input.apiFiles.slice(0, 8),
			riskLevel: dataStoreNames.length ? "medium" : "low",
		});
	}
	return flows.slice(0, 10);
}

function rankedEvidence(files: string[], patterns: RegExp[]): string[] {
	return unique(files).sort((left, right) => {
		const rightScore = evidenceScore(right, patterns);
		const leftScore = evidenceScore(left, patterns);
		return rightScore - leftScore || left.localeCompare(right);
	});
}

function evidenceScore(file: string, patterns: RegExp[]): number {
	return patterns.reduce(
		(score, pattern, index) =>
			score + (pattern.test(file) ? patterns.length - index : 0),
		0,
	);
}

function modulesForEvidence(modules: string[], evidence: string[]): string[] {
	const matched = modules.filter((module) =>
		evidence.some((file) => file === module || file.startsWith(`${module}/`)),
	);
	return matched.length ? matched : modules.slice(0, 3);
}

function decideAutoDepth(
	signals: ProjectSignals,
	source: MasterPlanSource,
): MasterPlanAutoDepth {
	const signalLines = [
		`files=${signals.fileCount}`,
		`dirs=${signals.directoryCount}`,
		`deps=${signals.dependencyCount}`,
		`tests=${signals.hasTests ? "yes" : "no"}`,
		`db=${signals.hasDb ? "yes" : "no"}`,
		`auth=${signals.hasAuth ? "yes" : "no"}`,
		`routes=${signals.routeCount}`,
		`core=${source.projectCoreStatus}`,
		`constitution=${source.constitutionStatus}`,
		`flows=${source.flowsStatus}`,
	];
	const selected = selectAgentLabs(signals, source);
	const complexityScore =
		signals.fileCount +
		signals.directoryCount * 2 +
		signals.dependencyCount * 3 +
		(signals.hasDb ? 25 : 0) +
		(signals.hasAuth ? 25 : 0) +
		(source.projectCoreStatus === "missing" ? 15 : 0) +
		(source.flowsStatus === "missing" ? 15 : 0);
	if (
		signals.fileCount > 100 ||
		complexityScore >= 170 ||
		(signals.hasAuth &&
			signals.hasDb &&
			source.projectCoreStatus !== "confirmed" &&
			signals.fileCount > 60)
	) {
		return {
			mode: "deep_required",
			reason:
				"proyecto grande/crítico; requiere aprobación humana antes de deep review",
			signals: signalLines,
			agentLabsSelected: [],
			skippedAgentLabs: selected.length ? selected : ["project_understanding"],
			tokenCostHint: "high — no ejecutar análisis profundo automáticamente",
		};
	}
	if (
		complexityScore >= 45 ||
		signals.hasDb ||
		signals.hasAuth ||
		signals.routeCount >= 3 ||
		signals.fileCount >= 15
	) {
		return {
			mode: "standard",
			reason:
				"proyecto mediano con señales de DB/UI/auth o estructura suficiente",
			signals: signalLines,
			agentLabsSelected: selected.slice(0, 3),
			skippedAgentLabs: selected.slice(3),
			tokenCostHint: "medium — máximo 3 AgentLabs como metadata/request",
		};
	}
	return {
		mode: "quick",
		reason: "proyecto pequeño; escaneo determinista barato suficiente",
		signals: signalLines,
		agentLabsSelected: selected.slice(0, 1),
		skippedAgentLabs: selected.slice(1),
		tokenCostHint: "low — 0 a 1 AgentLab como metadata/request",
	};
}

function selectAgentLabs(
	signals: ProjectSignals,
	source: MasterPlanSource,
): AgentLabSpecialty[] {
	const labs: AgentLabSpecialty[] = [];
	if (signals.hasAuth) labs.push("security");
	if (signals.hasDb) labs.push("database");
	if (
		source.projectCoreStatus !== "confirmed" ||
		source.flowsStatus !== "project-local"
	)
		labs.push("architecture");
	if (signals.routeCount > 0) labs.push("ui_ux");
	if (signals.approxRelevantBytes > 1_000_000 || signals.docsBytes > 80_000)
		labs.push("token_cost");
	if (signals.fileCount > 50) labs.push("project_understanding");
	if (!signals.hasTests && signals.fileCount > 5) labs.push("code_quality");
	return unique(labs);
}

function readSourceStatuses(
	projectPath: string,
	signals: ProjectSignals,
): MasterPlanSource {
	return {
		projectCoreStatus: safeStatus(() => loadProjectCore(projectPath).status),
		constitutionStatus: safeStatus(
			() => loadProjectConstitution(projectPath).status,
		),
		blueprintStatus: safeStatus(() =>
			loadProjectBlueprint(projectPath) ? "available" : "missing",
		),
		flowsStatus: safeStatus(() => {
			loadProjectFlows(projectPath);
			return existsSync(join(projectPath, "config", "project-flows.json"))
				? "project-local"
				: "default";
		}),
		scanStatus: `deterministic:${signals.fileCount}:files`,
	};
}

function safeStatus(read: () => string): string {
	try {
		return read();
	} catch {
		return "missing";
	}
}

function inferObjective(projectPath: string, signals: ProjectSignals): string {
	const readme = ["README.md", "readme.md"]
		.map((name) => join(projectPath, name))
		.find((path) => existsSync(path));
	if (readme) {
		const firstLine = readFileSync(readme, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.replace(/^#+\s*/u, "").trim())
			.find(Boolean);
		if (firstLine) return firstLine;
	}
	if (signals.hasDb && signals.hasAuth)
		return "Sistema con autenticación, datos persistentes y flujos operativos por confirmar.";
	return `Entender y supervisar ${basename(projectPath)} sin aplicar cambios automáticos.`;
}

function buildExecutiveSummary(
	projectId: string,
	autoDepth: MasterPlanAutoDepth,
	signals: ProjectSignals,
): string {
	return `Idu-pi generó un Plan Maestro draft para ${projectId} en modo ${autoDepth.mode}. Se revisaron ${signals.fileCount} archivos y ${signals.directoryCount} carpetas con escaneo determinista; AgentLabs quedan sólo como selección/recomendación.`;
}

function buildProblemStatement(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string {
	if (source.projectCoreStatus !== "confirmed")
		return "El proyecto necesita un Plan Maestro revisable antes de tratar Project Core/Constitution como fuente de verdad.";
	if (signals.hasDb || signals.hasAuth)
		return "El proyecto combina datos/autenticación y requiere guardrails explícitos antes de cambios funcionales.";
	return "Mantener alineación entre intención humana, estructura real y próximos cambios.";
}

function inferScope(signals: ProjectSignals): string[] {
	return unique([
		"Reconocer estructura del proyecto",
		"Consolidar objetivo, riesgos y próximos pasos en un draft revisable",
		...(signals.hasDb ? ["Revisar datos/schema como área sensible"] : []),
		...(signals.hasAuth
			? ["Revisar auth/login/security como área sensible"]
			: []),
	]);
}

function inferUserRoles(signals: ProjectSignals): string[] {
	if (signals.hasAuth)
		return [
			"usuario autenticado",
			"administrador/operador pendiente de confirmar",
		];
	return ["usuario final pendiente de confirmar"];
}

function inferCriticalRisks(
	autoDepth: MasterPlanAutoDepth,
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(autoDepth.mode === "deep_required"
			? ["Proyecto requiere deep review aprobado antes de gastar más contexto."]
			: []),
		...(source.projectCoreStatus !== "confirmed"
			? ["Project Core no confirmado; no es fuente de verdad."]
			: []),
		...(signals.hasDb && signals.hasAuth
			? [
					"DB + auth detectados; cambios high-risk requieren confirmación humana.",
				]
			: []),
	]);
}

function inferQualityRisks(signals: ProjectSignals): string[] {
	return unique([
		...(signals.hasTests
			? []
			: ["No se detectaron tests; validar antes de cambios funcionales."]),
		...(signals.fileCount > 80
			? ["Proyecto grande; riesgo de omitir módulos en revisión rápida."]
			: []),
	]);
}

function inferSecurityRisks(signals: ProjectSignals): string[] {
	return signals.hasAuth
		? [
				"Auth/login/session detectado; revisar secretos, permisos y flujos de acceso.",
			]
		: [];
}

function inferArchitectureRisks(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(source.flowsStatus !== "project-local"
			? [
					"Flows project-local ausentes o default; mapa funcional puede estar incompleto.",
				]
			: []),
		...(signals.moduleCandidates.length > 8
			? ["Muchos módulos/carpetas; conviene revisión de arquitectura."]
			: []),
	]);
}

function inferOpenQuestions(
	source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(source.projectCoreStatus !== "confirmed"
			? ["¿El objetivo inferido representa la intención humana actual?"]
			: []),
		...(signals.hasDb
			? [
					"¿Qué tablas/datos son críticos y requieren aprobación antes de tocarse?",
				]
			: []),
		...(signals.hasAuth
			? ["¿Qué reglas de seguridad/login son no negociables?"]
			: []),
	]);
}

function inferAssumptions(signals: ProjectSignals, reason?: string): string[] {
	return unique([
		"El plan es draft y requiere aprobación humana.",
		"No se usó IA externa para generar este plan.",
		"AgentLabs no se ejecutaron automáticamente.",
		...(reason ? [`Motivo de redraft: ${reason}`] : []),
		...(signals.hasPackageJson
			? ["package.json indica proyecto Node/JS o frontend/backend relacionado."]
			: []),
	]);
}

function recommendedNext(autoDepth: MasterPlanAutoDepth): string[] {
	if (autoDepth.mode === "deep_required") {
		return [
			"Aprobar o ajustar objetivo antes de deep review.",
			"Usar idu-pi master-plan-review latest para ver detalle.",
			"Preparar AgentLabs recomendados como requests; no ejecutar sin aprobación.",
		];
	}
	return [
		"Revisar: idu-pi master-plan-review latest",
		"Aprobar si representa el proyecto: idu-pi master-plan-approve latest",
		"Rehacer si falta contexto: idu-pi master-plan-redraft latest",
	];
}

function uniqueMasterPlanBaseName(reportsDir: string, iso: string): string {
	const stamp = iso
		.replace(/[-:]/gu, "")
		.replace(/T/u, "-")
		.replace(/\.\d+Z$/u, "");
	const base = `master-plan-${stamp}`;
	let candidate = base;
	let counter = 2;
	while (
		existsSync(join(reportsDir, `${candidate}.json`)) ||
		existsSync(join(reportsDir, `${candidate}.md`))
	) {
		candidate = `${base}-${counter}`;
		counter += 1;
	}
	return candidate;
}

function writeCurrent(
	stateRoot: string,
	current: MasterPlanCurrent,
): MasterPlanCurrent {
	mkdirSync(stateRoot, { recursive: true });
	writeFileSync(
		join(stateRoot, CURRENT_FILE),
		`${JSON.stringify(current, null, 2)}\n`,
		"utf8",
	);
	return current;
}

function writeMemory(
	stateRoot: string,
	plan: MasterPlan,
	current: MasterPlanCurrent,
): MasterPlanMemory {
	const memory: MasterPlanMemory = {
		projectId: plan.projectId,
		status: plan.status,
		currentPlanJson: current.currentPlanJson,
		objectiveSummary: plan.inferredObjective.slice(0, 240),
		topRisks: [
			...plan.criticalRisks,
			...plan.securityRisks,
			...plan.architectureRisks,
		].slice(0, 5),
		openQuestionsCount: plan.openQuestions.length,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: current.updatedAt,
	};
	writeFileSync(
		join(stateRoot, MEMORY_FILE),
		`${JSON.stringify(memory, null, 2)}\n`,
		"utf8",
	);
	return memory;
}

function readCurrent(stateRoot: string): MasterPlanCurrent | undefined {
	try {
		const path = join(stateRoot, CURRENT_FILE);
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as MasterPlanCurrent;
	} catch {
		return undefined;
	}
}

function incompatibleStatus(
	current: MasterPlanCurrent,
	reason: string,
): MasterPlanStatusResult {
	return {
		status: "incompatible",
		exists: true,
		current,
		currentPlanJson: current.currentPlanJson,
		currentPlanMd: current.currentPlanMd,
		projectId: current.projectId,
		projectPath: current.projectPath,
		updatedAt: current.updatedAt,
		incompatibleReason: reason,
		recommendedNext: "Rehacer: idu-pi master-plan-redraft latest",
	};
}

function currentPlanCompatibility(
	stateRoot: string,
	current: MasterPlanCurrent,
): { compatible: true } | { compatible: false; reason: string } {
	let path: string;
	try {
		path = safePlanPathInsideReports(stateRoot, current.currentPlanJson);
	} catch (error) {
		return {
			compatible: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	const raw = readPlanRaw(path);
	if (!raw)
		return { compatible: false, reason: "archivo inexistente o JSON inválido" };
	if (!isMasterPlanCompatible(raw)) {
		return { compatible: false, reason: masterPlanCompatibilityReason(raw) };
	}
	return { compatible: true };
}

function resolvePlanPath(
	stateRoot: string,
	pathOrLatest: string,
	current?: MasterPlanCurrent,
): string {
	if (pathOrLatest === "latest") {
		if (!current) throw new Error("No existe master-plan.current.json");
		return safePlanPathInsideReports(stateRoot, current.currentPlanJson);
	}
	return safePlanPathInsideReports(stateRoot, pathOrLatest);
}

function resolvePlanPathForReview(
	stateRoot: string,
	pathOrLatest: string,
	current?: MasterPlanCurrent,
): { ok: true; path: string } | { ok: false; reason: string } {
	try {
		return {
			ok: true,
			path: resolvePlanPath(stateRoot, pathOrLatest, current),
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

function safePathInsideState(stateRoot: string, path: string): string {
	const resolvedStateRoot = resolve(stateRoot);
	const resolved = isAbsolute(path)
		? resolve(path)
		: resolve(resolvedStateRoot, path);
	const relativePath = relative(resolvedStateRoot, resolved);
	if (relativePath.startsWith("..") || isAbsolute(relativePath))
		throw new Error("Master Plan fuera de stateRoot");
	return resolved;
}

function safePlanPathInsideReports(stateRoot: string, path: string): string {
	const resolved = safePathInsideState(stateRoot, path);
	const relativePath = relative(stateRoot, resolved).replace(/\\/gu, "/");
	if (!relativePath.startsWith("reports/") || !relativePath.endsWith(".json")) {
		throw new Error("Master Plan fuera de stateRoot/reports");
	}
	return resolved;
}

function readPlanRaw(path: string): Partial<MasterPlan> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as Partial<MasterPlan>;
	} catch {
		return undefined;
	}
}

function readPlan(path: string): MasterPlan | undefined {
	const raw = readPlanRaw(path);
	return raw && isMasterPlanCompatible(raw)
		? normalizeMasterPlan(raw)
		: undefined;
}

export function isMasterPlanCompatible(plan: unknown): plan is MasterPlan {
	if (!plan || typeof plan !== "object") return false;
	return (
		masterPlanCompatibilityReason(plan as Partial<MasterPlan>) === "compatible"
	);
}

function masterPlanCompatibilityReason(plan: Partial<MasterPlan>): string {
	if ((plan.schemaVersion ?? 0) < MASTER_PLAN_SCHEMA_VERSION)
		return "schemaVersion menor que 2";
	for (const key of [
		"version",
		"projectId",
		"projectPath",
		"generatedAt",
		"status",
		"executiveSummary",
		"inferredObjective",
		"problemStatement",
	] as const) {
		if (!hasText(plan[key])) return `${key} faltante`;
	}
	for (const key of [
		"scope",
		"outOfScope",
		"detectedModules",
		"userRoles",
		"criticalRisks",
		"qualityRisks",
		"securityRisks",
		"architectureRisks",
		"openQuestions",
		"assumptions",
		"recommendedNext",
		"sourceFiles",
		"agentLabReviews",
		"toolingDetected",
		"ignoredTooling",
	] as const) {
		if (!Array.isArray(plan[key])) return `${key} faltante`;
	}
	if (!isMasterPlanStatus(plan.status)) return "status inválido";
	if (!isCompatibleAutoDepth(plan.autoDepth)) return "autoDepth incompleto";
	if (!isCompatibleSource(plan.source)) return "source incompleto";
	if (!isCompatibleArchitecture(plan.architecture))
		return "architecture incompleta";
	if (!Array.isArray(plan.dataStores)) return "dataStores faltante";
	if (!plan.dataStores.every(isCompatibleDataStore))
		return "dataStores sin estructura completa";
	if (!isCompatibleSecurityModel(plan.securityModel))
		return "securityModel incompleto";
	if (!Array.isArray(plan.detectedFlows)) return "detectedFlows faltante";
	if (plan.detectedFlows.some((flow) => typeof flow === "string"))
		return "detectedFlows usa strings legacy";
	if (!plan.detectedFlows.every(isCompatibleFunctionalFlow))
		return "detectedFlows sin estructura funcional completa";
	return "compatible";
}

function hasText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isMasterPlanStatus(status: unknown): status is MasterPlanStatus {
	return ["draft", "approved", "rejected", "stale", "incompatible"].includes(
		String(status),
	);
}

function isCompatibleAutoDepth(
	autoDepth: Partial<MasterPlanAutoDepth> | undefined,
): autoDepth is MasterPlanAutoDepth {
	return Boolean(
		autoDepth &&
			["quick", "standard", "deep_required"].includes(String(autoDepth.mode)) &&
			hasText(autoDepth.reason) &&
			Array.isArray(autoDepth.signals) &&
			Array.isArray(autoDepth.agentLabsSelected) &&
			Array.isArray(autoDepth.skippedAgentLabs) &&
			hasText(autoDepth.tokenCostHint),
	);
}

function isCompatibleSource(
	source: Partial<MasterPlanSource> | undefined,
): source is MasterPlanSource {
	return Boolean(
		source &&
			hasText(source.projectCoreStatus) &&
			hasText(source.constitutionStatus) &&
			hasText(source.blueprintStatus) &&
			hasText(source.flowsStatus) &&
			hasText(source.scanStatus),
	);
}

function isCompatibleArchitecture(
	architecture: Partial<MasterPlanArchitecture> | undefined,
): architecture is MasterPlanArchitecture {
	return Boolean(
		architecture &&
			hasText(architecture.projectKind) &&
			hasText(architecture.frontend) &&
			hasText(architecture.backend) &&
			hasText(architecture.database) &&
			hasText(architecture.auth) &&
			hasText(architecture.deployment) &&
			hasText(architecture.packageManager) &&
			Array.isArray(architecture.languages) &&
			Array.isArray(architecture.frameworks) &&
			Array.isArray(architecture.evidence),
	);
}

function isCompatibleDataStore(store: unknown): store is MasterPlanDataStore {
	return Boolean(
		store &&
			typeof store === "object" &&
			hasText((store as Partial<MasterPlanDataStore>).name) &&
			hasText((store as Partial<MasterPlanDataStore>).type) &&
			Array.isArray((store as Partial<MasterPlanDataStore>).evidence) &&
			["low", "medium", "high"].includes(
				String((store as Partial<MasterPlanDataStore>).riskLevel),
			),
	);
}

function isCompatibleSecurityModel(
	securityModel: Partial<MasterPlanSecurityModel> | undefined,
): securityModel is MasterPlanSecurityModel {
	return Boolean(
		securityModel &&
			typeof securityModel.authDetected === "boolean" &&
			typeof securityModel.sessionDetected === "boolean" &&
			Array.isArray(securityModel.sensitiveFlows) &&
			Array.isArray(securityModel.evidence),
	);
}

function isCompatibleFunctionalFlow(
	flow: unknown,
): flow is MasterPlanFunctionalFlow {
	return Boolean(
		flow &&
			typeof flow === "object" &&
			hasText((flow as Partial<MasterPlanFunctionalFlow>).name) &&
			hasText((flow as Partial<MasterPlanFunctionalFlow>).type) &&
			hasText((flow as Partial<MasterPlanFunctionalFlow>).from) &&
			hasText((flow as Partial<MasterPlanFunctionalFlow>).to) &&
			Array.isArray((flow as Partial<MasterPlanFunctionalFlow>).through) &&
			Array.isArray((flow as Partial<MasterPlanFunctionalFlow>).modules) &&
			Array.isArray((flow as Partial<MasterPlanFunctionalFlow>).dataStores) &&
			Array.isArray((flow as Partial<MasterPlanFunctionalFlow>).triggers) &&
			Array.isArray((flow as Partial<MasterPlanFunctionalFlow>).evidence) &&
			["low", "medium", "high"].includes(
				String((flow as Partial<MasterPlanFunctionalFlow>).riskLevel),
			),
	);
}

function normalizeMasterPlan(raw: Partial<MasterPlan>): MasterPlan {
	const dataStores = normalizePlanDataStores(raw.dataStores);
	const architecture =
		raw.architecture ??
		buildArchitecture({
			packageManager: "unknown",
			languages: [],
			frameworks: [],
			dataStores,
			hasAuth: false,
			evidence: [],
			files: raw.sourceFiles ?? [],
		});
	const securityModel = raw.securityModel ?? {
		authDetected: false,
		sessionDetected: false,
		sensitiveFlows: [],
		evidence: [],
	};
	return {
		...(raw as MasterPlan),
		schemaVersion: raw.schemaVersion ?? MASTER_PLAN_SCHEMA_VERSION,
		detectedModules: raw.detectedModules ?? [],
		detectedFlows: normalizePlanFlows(
			raw.detectedFlows,
			raw.detectedModules ?? [],
			dataStores,
		),
		dataStores,
		architecture,
		securityModel,
		toolingDetected: raw.toolingDetected ?? [],
		ignoredTooling: raw.ignoredTooling ?? [],
		sourceFiles: raw.sourceFiles ?? [],
		agentLabReviews: raw.agentLabReviews ?? [],
	};
}

function normalizePlanDataStores(
	stores: MasterPlan["dataStores"] | string[] | undefined,
): MasterPlanDataStore[] {
	if (!Array.isArray(stores)) return [];
	const normalized = new Map<string, MasterPlanDataStore>();
	for (const store of stores) {
		if (typeof store === "string") {
			addDataStore(normalized, dataStoreFromPath(store), store);
		} else if (store?.type) {
			normalized.set(store.type, {
				name: store.name,
				type: store.type,
				evidence: Array.isArray(store.evidence) ? store.evidence : [],
				riskLevel: store.riskLevel,
			});
		}
	}
	return [...normalized.values()];
}

function normalizePlanFlows(
	flows: MasterPlan["detectedFlows"] | string[] | undefined,
	modules: string[],
	dataStores: MasterPlanDataStore[],
): MasterPlanFunctionalFlow[] {
	if (!Array.isArray(flows)) return [];
	return flows.map((flow) => {
		if (typeof flow !== "string") return flow;
		return {
			name: flowNameFromEvidence(flow),
			type: /auth|login|session|token/iu.test(flow) ? "auth" : "unknown",
			from: flow,
			through: [],
			to: "resultado por confirmar",
			modules: modulesForEvidence(modules, [flow]),
			dataStores: dataStores.map((store) => store.type),
			triggers: [],
			evidence: [flow],
			riskLevel: /auth|login|session|token/iu.test(flow) ? "high" : "low",
		};
	});
}

function flowNameFromEvidence(evidence: string): string {
	if (/auth|login|session|token/iu.test(evidence)) return "Login/acceso";
	if (/upload|import|storage/iu.test(evidence))
		return "Carga/ingesta de archivos";
	if (/report|dashboard|analytics/iu.test(evidence))
		return "Reportes/visualización operativa";
	return basename(evidence).replace(/\.[^.]+$/u, "") || "Flujo funcional";
}

function requirePlan(path: string): MasterPlan {
	const plan = readPlan(path);
	if (!plan) throw new Error(`No pude leer Plan Maestro: ${path}`);
	return plan;
}

function relativeFromState(stateRoot: string, path: string): string {
	return relative(stateRoot, path).replace(/\\/gu, "/");
}

function bulletList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- —"];
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

export function readGitHead(projectPath: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}
