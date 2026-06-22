import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
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
import type { AgentLabReviewRunResult } from "./agentlab-review-runner.js";
import { getSourceLibraryStatus } from "./source-library.js";
import { invalidateMasterPlanObjectiveCache } from "./master-plan-objective-cache.js";

export type MasterPlanStatus =
	| "draft"
	| "approved"
	| "rejected"
	| "stale"
	| "incompatible";
export type MasterPlanAutoDepthMode = "quick" | "standard" | "deep_required";
export type MasterPlanDeepStage =
	| "none"
	| "safe_scan_done"
	| "lab_requests_prepared"
	| "lab_review_done"
	| "deep_approval_required";

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

export type MasterPlanDocNotebook = {
	root: string;
	status: "created" | "loaded" | "empty";
	sources: string[];
	summary: string;
};

export type MasterPlanOperationalContract = {
	area: "frontend" | "auth" | "data" | "api" | "security" | "agent";
	title: string;
	rules: string[];
	evidence: string[];
	severity: "critical" | "high" | "medium" | "low";
	mode: "block" | "ask_human" | "warn" | "allow";
};

export type MasterPlanApprovedContract = {
	contractId: string;
	claim: string;
	severity: "info" | "warning" | "critical";
	approvedAt?: string;
	approvedBy?: string;
};

export type MasterPlanContractViolation = {
	area: MasterPlanOperationalContract["area"];
	title: string;
	evidence: string[];
	impact: string[];
	action: string[];
	severity: "critical" | "high" | "medium" | "low";
};

export type MasterPlanWorkMilestone = {
	name: string;
	goal: string;
	actions: string[];
	exitCriteria: string[];
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

export type MasterPlanClaimSource =
	| "canonical_doc"
	| "project_config"
	| "scanner_observed"
	| "scanner_inferred"
	| "user_approved"
	| "human_approved"
	| "agentlab_reviewed";

export type MasterPlanClaimStatus =
	| "confirmed"
	| "candidate"
	| "contradiction"
	| "unknown";

export type MasterPlanClaim = {
	title: string;
	statement: string;
	source: MasterPlanClaimSource;
	status: MasterPlanClaimStatus;
	confidence: number;
	evidence: string[];
};

export type MasterPlanRealityObservation = {
	area: string;
	statement: string;
	status: MasterPlanClaimStatus;
	confidence: number;
	evidence: string[];
};

export type MasterPlanDriftFinding = {
	title: string;
	declared: string;
	observed: string;
	severity: "critical" | "high" | "medium" | "low";
	recommendation: string;
	evidence: string[];
};

export type MasterPlanProjectFlow = {
	name: string;
	category:
		| "entrypoint"
		| "governance"
		| "audit"
		| "state"
		| "skill"
		| "data"
		| "module";
	purpose: string;
	entrypoints: string[];
	modules: string[];
	outputs: string[];
	rules: string[];
	source: MasterPlanClaimSource;
	evidence: string[];
};

export type MasterPlanFlowArtifact = {
	projectId: string;
	projectPath: string;
	generatedAt: string;
	status: "draft" | "approved";
	purpose: string;
	flows: MasterPlanProjectFlow[];
	detectedFlows: MasterPlanFunctionalFlow[];
};

export type MasterPlanReadinessContractCategory =
	| "objective"
	| "stack"
	| "architecture"
	| "data"
	| "security"
	| "navigation"
	| "information_sources"
	| "agentlabs"
	| "testing"
	| "delivery";

export type MasterPlanReadinessContract = {
	category: MasterPlanReadinessContractCategory;
	title: string;
	status: "confirmed" | "missing" | "recommended" | "needs_user_confirmation";
	requirement: string;
	evidence: string[];
	nextAction: string;
};

export type MasterPlanRecommendedAgentLab = {
	name: string;
	purpose: string;
	trigger: string;
	evidence: string[];
};

export type MasterPlanRevisionAntesDeZarpar = {
	status: "ready" | "needs_user_definition" | "needs_tools" | "blocked";
	confidence: number;
	projectUnderstanding: string[];
	requiredContracts: MasterPlanReadinessContract[];
	missingDefinitions: string[];
	requiredInformationSources: string[];
	recommendedExternalSources: string[];
	recommendedMcpTools: string[];
	recommendedAgentLabs: MasterPlanRecommendedAgentLab[];
	currentProblems: string[];
	repairStrategy: string[];
	questionsForUser: string[];
	beforeSailingChecklist: string[];
};

export type MasterPlanApproval = {
	approvedAt?: string;
	rejectedAt?: string;
	source?: "cli" | "pi" | "telegram" | "mcp";
	reason?: string;
};

export type MasterPlanMemoryContext = {
	provider: "engram" | "local" | "none";
	status: "available" | "unavailable" | "skipped" | "error";
	summary: string;
	evidence: string[];
};

export type MasterPlanMemoryProvider = {
	provider: "engram" | "local";
	load: (input: {
		projectId: string;
		projectPath?: string;
		stateRoot: string;
	}) => MasterPlanMemoryContext;
};

export type MasterPlanPendingAction = {
	type: "approve_master_plan";
	planPath: string;
	planStatus: MasterPlanStatus;
	createdAt: string;
	acceptedInputs: string[];
	rejectedInputs: string[];
};

export type MasterPlanNaturalDecisionResult =
	| { handled: false; reason: "no_pending_action" | "no_match" }
	| {
			handled: true;
			action: "approved" | "rejected" | "redrafted";
			result: MasterPlanDraftResult;
	  }
	| {
			handled: true;
			action: "interactive";
			review: MasterPlanReview;
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
	deepStage: MasterPlanDeepStage;
	deepReviewRecommended: boolean;
	deepReviewRequiresApproval: boolean;
	safeActionsPerformed: string[];
	memoryContext: MasterPlanMemoryContext;
	source: MasterPlanSource;
	executiveSummary: string;
	inferredObjective: string;
	problemStatement: string;
	scope: string[];
	outOfScope: string[];
	detectedModules: string[];
	detectedFlows: MasterPlanFunctionalFlow[];
	projectFlows: MasterPlanProjectFlow[];
	flowArtifact: string;
	canonicalClaims: MasterPlanClaim[];
	observedReality: MasterPlanRealityObservation[];
	driftFindings: MasterPlanDriftFinding[];
	dataStores: MasterPlanDataStore[];
	architecture: MasterPlanArchitecture;
	securityModel: MasterPlanSecurityModel;
	docNotebook: MasterPlanDocNotebook;
	operationalContracts: MasterPlanOperationalContract[];
	approvedContracts?: MasterPlanApprovedContract[];
	contractViolations: MasterPlanContractViolation[];
	workMilestones: MasterPlanWorkMilestone[];
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
	| (MasterPlanCurrent & {
			exists: true;
			staleReason?: string;
			observedGitHead?: string;
			planGitHead?: string;
	  });

export type MasterPlanReview = {
	plan: MasterPlan;
	current?: MasterPlanCurrent;
	markdown: string;
	revisionAntesDeZarpar: MasterPlanRevisionAntesDeZarpar;
	jsonPath: string;
	markdownPath?: string;
};

const MASTER_PLAN_JSON_FILE = "master-plan.json";
const MASTER_PLAN_MD_FILE = "master-plan.md";
const PROJECT_INDEX_FILE = "project-index.json";
const CURRENT_FILE = "master-plan.current.json";
const MEMORY_FILE = "master-plan.memory.json";
const PENDING_ACTION_FILE = "master-plan.pending-action.json";
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

export type MasterPlanProgressEvent = {
	stage: "scan" | "reverse_engineering" | "forge_plan" | "quarantine";
	status: "running" | "ok" | "blocked";
	message: string;
};

export function generateMasterPlanDraft(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	reason?: string;
	memoryProvider?: MasterPlanMemoryProvider;
	onProgress?: (event: MasterPlanProgressEvent) => void;
}): MasterPlanDraftResult {
	const projectPath = resolve(input.projectPath);
	const stateRoot = resolve(input.stateRoot);
	const reportsDir = join(stateRoot, "reports");
	mkdirSync(reportsDir, { recursive: true });
	mkdirSync(join(stateRoot, "agentlabs", "requests"), { recursive: true });
	mkdirSync(join(stateRoot, "agentlabs", "runs"), { recursive: true });
	mkdirSync(join(stateRoot, "agentlabs", "reports"), { recursive: true });
	mkdirSync(join(stateRoot, "agentlabs", "work"), { recursive: true });
	const generatedAt = new Date().toISOString();
	input.onProgress?.({
		stage: "scan",
		status: "running",
		message: "Escaneando repositorio completo",
	});
	let signals = collectProjectSignals(projectPath);
	signals = applyCanonicalDocumentationSignals(signals);
	input.onProgress?.({
		stage: "scan",
		status: "ok",
		message: `Escaneo completo: ${signals.fileCount} archivos, ${signals.directoryCount} carpetas`,
	});
	input.onProgress?.({
		stage: "reverse_engineering",
		status: "running",
		message: "Preparando ingeniería inversa de flujos y arquitectura",
	});
	const source = readSourceStatuses(projectPath, signals);
	const autoDepth = decideAutoDepth(signals, source);
	input.onProgress?.({
		stage: "reverse_engineering",
		status: "ok",
		message:
			"Flujos, datos, auth y arquitectura inferidos desde evidencia local",
	});
	const deepSafety = deepSafetyForAutoDepth(autoDepth);
	const memoryContext = loadExternalProjectMemory({
		projectId: input.projectId,
		projectPath,
		stateRoot,
		provider: input.memoryProvider,
	});
	input.onProgress?.({
		stage: "forge_plan",
		status: "running",
		message: "Forjando Plan Maestro A-Z y matriz de riesgos",
	});
	const inferredObjective =
		signals.canonicalDocumentation?.objective ??
		inferObjective(projectPath, signals);
	const docNotebook = loadProjectDocNotebook(stateRoot, input.projectId);
	const operationalContracts = inferOperationalContracts(signals, docNotebook);
	const contractViolations = detectContractViolations(
		projectPath,
		signals,
		operationalContracts,
	);
	const workMilestones = buildContractWorkMilestones(
		contractViolations,
		signals,
	);
	const projectFlows = buildProjectFlows(signals);
	const canonicalClaims = buildCanonicalClaims(signals, source);
	const observedReality = buildObservedReality(signals);
	const driftFindings = buildDriftFindings(
		canonicalClaims,
		observedReality,
		source,
	);
	const plan: MasterPlan = {
		version: "1.0.0",
		schemaVersion: MASTER_PLAN_SCHEMA_VERSION,
		projectId: input.projectId,
		projectPath,
		...(input.gitHead ? { gitHead: input.gitHead } : {}),
		generatedAt,
		status: "draft",
		autoDepth,
		deepStage: deepSafety.deepStage,
		deepReviewRecommended: deepSafety.deepReviewRecommended,
		deepReviewRequiresApproval: deepSafety.deepReviewRequiresApproval,
		safeActionsPerformed: deepSafety.safeActionsPerformed,
		memoryContext,
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
			"Cambios funcionales sin plan aprobado",
			"Modificar seguridad, datos o permisos sin validación explícita",
			"Agregar dependencias o integraciones no justificadas",
			"Publicar cambios sin verificación técnica previa",
		],
		detectedModules: signals.moduleCandidates,
		detectedFlows: signals.flowCandidates,
		projectFlows,
		flowArtifact: "master-plan.flows.json",
		canonicalClaims,
		observedReality,
		driftFindings,
		dataStores: signals.dataStoreCandidates,
		architecture: signals.architecture,
		securityModel: signals.securityModel,
		docNotebook,
		operationalContracts,
		contractViolations,
		workMilestones,
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
		sourceFiles: signals.sourceFiles,
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
	input.onProgress?.({
		stage: "forge_plan",
		status: "ok",
		message: "Plan Maestro A-Z preparado desde evidencia local",
	});
	input.onProgress?.({
		stage: "quarantine",
		status: "running",
		message:
			"Guardando artefactos en stateRoot y manteniendo repo real en cuarentena",
	});
	const relativeJson = MASTER_PLAN_JSON_FILE;
	const relativeMd = MASTER_PLAN_MD_FILE;
	const jsonPath = join(stateRoot, relativeJson);
	const markdownPath = join(stateRoot, relativeMd);
	writeProjectDocNotebook(stateRoot, plan);
	writeMasterPlanFlowArtifact(stateRoot, plan);
	writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	writeSupervisorProjectIndex(stateRoot, plan, signals);
	const current = writeCurrent(stateRoot, {
		currentPlanJson: relativeJson,
		currentPlanMd: relativeMd,
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: generatedAt,
	});
	writeMasterPlanPendingAction(stateRoot, current);
	const memory = writeMemory(stateRoot, plan, current);
	input.onProgress?.({
		stage: "quarantine",
		status: "ok",
		message: "Artefactos guardados; repo real sin cambios automáticos",
	});
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
	// The Plan Maestro is durable: status stays "approved" until the
	// user explicitly revises it via /idu revise or /idu redraft.
	// A git commit does NOT auto-mark the plan as stale. We surface
	// the observed vs plan git HEAD so callers can run a separate
	// drift detection (see detectContractDrift in contract-drift.ts)
	// without losing the approved contract.
	const observed = input.currentGitHead;
	const planHead = current.gitHead;
	const gitDrift =
		observed && planHead && observed !== planHead
			? { observedGitHead: observed, planGitHead: planHead }
			: {};
	return { ...current, ...gitDrift, exists: true };
}

export function recordMasterPlanLabReviewDone(input: {
	stateRoot: string;
	run: AgentLabReviewRunResult;
}): MasterPlanDraftResult | undefined {
	const stateRoot = resolve(input.stateRoot);
	const current = readCurrent(stateRoot);
	if (!current) return undefined;
	const planPath = safePlanPath(stateRoot, current.currentPlanJson);
	const plan = readPlan(planPath);
	if (!plan) return undefined;
	const generatedAt = new Date().toISOString();
	const qualityWarnings = input.run.runs.flatMap(
		(run) => run.qualityWarnings ?? [],
	);
	const highFindings = input.run.consolidatedFindings
		.filter(
			(finding) =>
				finding.severity === "high" || finding.severity === "critical",
		)
		.map((finding) => finding.title);
	const architectureFindings = input.run.consolidatedFindings
		.filter((finding) => finding.category === "architecture")
		.map((finding) => finding.title);
	const frontendStackIsContested = input.run.consolidatedFindings.some(
		(finding) => /inconsistencia de stack de frontend/i.test(finding.title),
	);
	const correctedFrontend = frontendStackIsContested
		? inferReviewedFrontendStack(plan)
		: undefined;
	const reviewedObjective = reviewedPlanObjective(plan);
	const reviewedProblem = reviewedPlanProblemStatement(plan, highFindings);
	const nextPlan: MasterPlan = {
		...plan,
		inferredObjective: reviewedObjective,
		problemStatement: reviewedProblem,
		deepStage: "lab_review_done",
		deepReviewRecommended: false,
		deepReviewRequiresApproval: false,
		safeActionsPerformed: dedupeStrings([
			...plan.safeActionsPerformed,
			"Ejecuté o reutilicé deep review AgentLab en sandbox/clone.",
			"Consolidé hallazgos AgentLab sin modificar el repo real.",
		]),
		criticalRisks: dedupeStrings([...plan.criticalRisks, ...highFindings]),
		qualityRisks: dedupeStrings([...plan.qualityRisks, ...qualityWarnings]),
		architectureRisks: dedupeStrings([
			...plan.architectureRisks,
			...architectureFindings,
		]),
		architecture: {
			...plan.architecture,
			frontend: correctedFrontend ?? plan.architecture.frontend,
			frameworks: correctedFrontend
				? dedupeStrings(
						plan.architecture.frameworks.filter(
							(framework) => framework.toLowerCase() !== "react",
						),
					)
				: plan.architecture.frameworks,
			evidence: dedupeStrings([
				...plan.architecture.evidence,
				...(correctedFrontend
					? [
							`Supervisor corrigió frontend a ${correctedFrontend} usando evidencia AgentLab y archivos HTML/JS.`,
						]
					: frontendStackIsContested
						? [
								"AgentLab detectó inconsistencia en la clasificación del stack frontend; revisar evidencia antes de aprobar.",
							]
						: []),
			]),
		},
		openQuestions: dedupeStrings([
			...plan.openQuestions,
			...(qualityWarnings.length
				? [
						"Algunos AgentLabs devolvieron reportes parciales/fallback; verificar evidencia antes de aprobar el Plan Maestro.",
					]
				: []),
		]),
		recommendedNext: dedupeStrings([
			"Revisar hallazgos AgentLab y ajustar Plan Maestro antes de aprobar.",
			"Verificar evidencia real de findings high/critical.",
			...plan.recommendedNext.filter(
				(item) => !/preparar agentlabs|deep review|no ejecutar/iu.test(item),
			),
		]),
		agentLabReviews: input.run.runs.map((run) => ({
			specialty: run.specialty,
			status: run.status === "completed" ? "selected" : "skipped",
			reason:
				run.status === "completed"
					? "Deep review ejecutado en sandbox/clone."
					: `Deep review no completado: ${run.status}.`,
			maxCommands: run.commandsExecuted.length,
		})),
	};
	writeFileSync(planPath, `${JSON.stringify(nextPlan, null, 2)}\n`, "utf8");
	const markdownPath = safePathInsideState(stateRoot, current.currentPlanMd);
	writeFileSync(
		markdownPath,
		`${formatMasterPlanMarkdown(nextPlan)}\n`,
		"utf8",
	);
	const nextCurrent = writeCurrent(stateRoot, {
		...current,
		status: nextPlan.status,
		updatedAt: generatedAt,
	});
	const memory = writeMemory(stateRoot, nextPlan, nextCurrent);
	return {
		plan: nextPlan,
		current: nextCurrent,
		memory,
		jsonPath: planPath,
		markdownPath,
	};
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
	return {
		plan,
		current,
		markdown,
		revisionAntesDeZarpar: buildRevisionAntesDeZarpar(plan, stateRoot),
		jsonPath,
		markdownPath,
	};
}

export function approveMasterPlan(input: {
	stateRoot: string;
	pathOrLatest: string;
	source: "cli" | "pi" | "telegram" | "mcp";
	reason?: string;
}): MasterPlanDraftResult {
	return updatePlanDecision(input.stateRoot, input.pathOrLatest, (plan) => ({
		...plan,
		status: "approved",
		approval: {
			approvedAt: new Date().toISOString(),
			source: input.source,
			...(input.reason ? { reason: input.reason } : {}),
		},
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
	onProgress?: (event: MasterPlanProgressEvent) => void;
}): MasterPlanDraftResult {
	return generateMasterPlanDraft(input);
}

export function ensureMasterPlanForIdu(input: {
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	onProgress?: (event: MasterPlanProgressEvent) => void;
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
		? readPlan(safePlanPath(input.stateRoot, status.currentPlanJson))
		: undefined;
	if (status.status === "draft")
		writeMasterPlanPendingAction(input.stateRoot, status);
	return { status, plan };
}

export function handleMasterPlanNaturalDecision(input: {
	text: string;
	projectId: string;
	projectPath: string;
	stateRoot: string;
	gitHead?: string;
	source: "cli" | "pi" | "telegram" | "mcp";
}): MasterPlanNaturalDecisionResult {
	const pending = readMasterPlanPendingAction(input.stateRoot);
	if (!pending) return { handled: false, reason: "no_pending_action" };
	const decision = classifyMasterPlanNaturalDecision(input.text, pending);
	if (!decision) return { handled: false, reason: "no_match" };
	if (decision === "approve") {
		const result = approveMasterPlan({
			stateRoot: input.stateRoot,
			pathOrLatest: "latest",
			source: input.source,
		});
		clearMasterPlanPendingAction(input.stateRoot);
		return { handled: true, action: "approved", result };
	}
	if (decision === "reject") {
		const result = rejectMasterPlan({
			stateRoot: input.stateRoot,
			pathOrLatest: "latest",
			reason: input.text,
		});
		clearMasterPlanPendingAction(input.stateRoot);
		return { handled: true, action: "rejected", result };
	}
	if (decision === "interactive") {
		return {
			handled: true,
			action: "interactive",
			review: reviewMasterPlan({
				stateRoot: input.stateRoot,
				pathOrLatest: "latest",
			}),
		};
	}
	const result = redraftMasterPlan({
		projectId: input.projectId,
		projectPath: input.projectPath,
		stateRoot: input.stateRoot,
		...(input.gitHead ? { gitHead: input.gitHead } : {}),
		reason: input.text,
	});
	return { handled: true, action: "redrafted", result };
}

export function formatIduSupervisorPlanReport(input: {
	bootstrap: { project: { id: string }; criticalDecisions: string[] };
	masterPlan:
		| MasterPlanDraftResult
		| { status: MasterPlanStatusResult; plan?: MasterPlan };
	reviewHandled: boolean;
}): string {
	const { bootstrap, masterPlan, reviewHandled } = input;
	const isDraftResult = "current" in masterPlan;
	const plan = masterPlan.plan;
	const status = isDraftResult
		? masterPlan.plan.status
		: masterPlan.status.status;
	const planJson = isDraftResult
		? masterPlan.jsonPath
		: masterPlan.status.exists
			? masterPlan.status.currentPlanJson
			: MASTER_PLAN_JSON_FILE;
	const planMd = isDraftResult
		? masterPlan.markdownPath
		: masterPlan.status.exists
			? masterPlan.status.currentPlanMd
			: MASTER_PLAN_MD_FILE;
	const criticalCount = plan?.criticalRisks.length ?? 0;
	const qualityCount = plan?.qualityRisks.length ?? 0;
	const architectureCount = plan?.architectureRisks.length ?? 0;
	const requiresHumanCore = bootstrap.criticalDecisions.length > 0;
	const reliable =
		status === "approved" &&
		!requiresHumanCore &&
		criticalCount === 0 &&
		qualityCount === 0;
	const filesSignal = plan ? signalValue(plan, "files") : "?";
	const dirsSignal = plan ? signalValue(plan, "dirs") : "?";
	const scanId = `scan-${filesSignal}-files-${dirsSignal}-dirs`;
	const resultLine = reliable
		? "Plan fiable y actualizado. Sin cambios requeridos."
		: "Plan preparado para firma humana. No aplico cambios al repo hasta que apruebes.";
	if (plan && productEvidenceCount(plan) === 0) {
		return [
			`[idu-pi] ⚙️  Escaneando repositorio (${filesSignal} archivos, ${dirsSignal} carpetas)... [OK]`,
			"[idu-pi] 🧭  No detecté código de producto todavía.",
			"",
			"Proyecto vacío o sólo con configuración Idu-pi.",
			`Documentos preparados: JSON=${planJson} | MD=${planMd}`,
			"",
			"¿Creamos el proyecto base?",
			"1. Sí — iniciar definición interactiva del Project Core y Plan Maestro.",
			"2. No — dejar sólo el estado aislado y no tocar el repo.",
		].join("\n");
	}
	const externalBlockers = plan ? externalContextBlockers(plan) : [];
	if (plan && externalBlockers.length > 0) {
		return [
			`[idu-pi] ⚙️  Escaneando repositorio (${filesSignal} archivos, ${dirsSignal} carpetas)... [OK]`,
			"[idu-pi] 📚  Clasificando archivos y dominios críticos... [OK]",
			"[idu-pi] 🔐  Revisando seguridad/login/session... [OK]",
			"[idu-pi] 🗄️  Revisando contexto externo obligatorio... [BLOCKED]",
			"",
			"No puedo cerrar el Plan Maestro todavía.",
			"",
			"Motivo:",
			...externalBlockers.map((blocker) => `- ${blocker}`),
			"",
			"Avance:",
			`- Repo local revisado: ${filesSignal}/${filesSignal} archivos`,
			`- Lenguajes detectados: ${formatList(plan.architecture.languages)}`,
			`- Frameworks/librerías detectadas: ${formatList(plan.architecture.frameworks)}`,
			`- Login/session: ${plan.securityModel.authDetected ? "revisado con evidencia local" : "no detectado"}`,
			`- Capa de datos local/config: ${plan.architecture.database}`,
			"- Contexto remoto/externo: pendiente por conexión o credenciales seguras",
			"",
			"Para finalizar necesito:",
			"1. Conectar el MCP/credenciales seguras del servicio externo detectado.",
			"2. O autorizar explícitamente un plan parcial marcado como PARCIAL.",
			"3. Cancelar y conservar sólo el estado aislado generado.",
			"",
			`Documentos preparados: JSON=${planJson} | MD=${planMd}`,
		].join("\n");
	}
	const lines = [
		`[idu-pi] ⚙️  Escaneando repositorio (${filesSignal} archivos, ${dirsSignal} carpetas)... [OK]`,
		"[idu-pi] 🧠  Ejecutando ingeniería inversa de flujos y arquitectura... [OK]",
		"[idu-pi] 📝  Forjando Plan Maestro A-Z y matriz de riesgos... [OK]",
		`[idu-pi] 🔒  Sistema en cuarentena. Documentos generados en ${planJson} y ${planMd}`,
		"",
		"📘 PLAN MAESTRO DE INGENIERÍA Y ARQUITECTURA (A-Z)",
		"",
		`Proyecto: ${plan?.inferredObjective ?? bootstrap.project.id} (${bootstrap.project.id})`,
		`ID de Escaneo: ${scanId}`,
		`Estado del Documento: ${status === "approved" ? "APROBADO" : "DRAFT_INTERACTIVO (Esperando firma del Ingeniero)"}`,
		"Nivel de Restricción: Máximo (Strict Invariants Enforced)",
		`Resultado: ${resultLine}`,
		`Revisión: ${reviewHandled ? "AgentLabs usados/reutilizados según riesgo/tamaño" : "Análisis determinista + señales locales"}`,
		`Riesgos integrados: críticos ${criticalCount}, arquitectura ${architectureCount}, calidad ${qualityCount}`,
		"",
		"1. COMPRENSIÓN DEL NEGOCIO Y EL PROBLEMA",
		"",
		"1.1. Planteamiento del Problema",
		plan?.problemStatement ??
			"El sistema necesita una fuente de verdad técnica antes de delegar trabajo a agentes.",
		"",
		"1.2. Objetivo Estratégico General",
		plan?.inferredObjective ??
			"Consolidar arquitectura, riesgos y flujos operativos del proyecto.",
		"",
		"2. LÍMITES DEL SISTEMA (Scope Baseline)",
		"",
		"🟢 EN ALCANCE",
		...topBullets(plan?.scope ?? [], 5),
		"",
		"🔴 FUERA DE ALCANCE",
		...topBullets(plan ? visibleOutOfScope(plan) : [], 5),
		"",
		"3. CONSTITUCIÓN ARQUITECTÓNICA (Invariants)",
		...(plan ? formatArchitectureInvariantLines(plan) : ["- por confirmar"]),
		"",
		"4. MAPA DE FLUJOS CRÍTICOS Y GATEWAYS",
		...(plan?.detectedFlows
			.slice(0, 4)
			.flatMap((flow, index) => [
				`Flujo ${index + 1}: ${flow.name} (riesgo ${flow.riskLevel})`,
				`- Entrada: ${flow.from}`,
				`- Gateway: ${flow.through.slice(0, 4).join(" → ") || "por confirmar"}`,
				`- Salida: ${flow.to}`,
			]) ?? ["- por confirmar"]),
		"",
		"5. MATRIZ DE RIESGOS Y DEUDA TÉCNICA",
		...topBullets(plan ? visibleProductRisks(plan) : [], 8),
		"",
		"6. CRITERIOS DE ACEPTACIÓN (Definition of Done)",
		"- No se agregan dependencias sin autorización explícita.",
		"- Cambios de auth/session requieren revisión de seguridad.",
		"- Cambios de datos requieren migración/rollback o justificación explícita.",
		"- Tests/linter/build deben pasar antes de cerrar tareas.",
		"- El plan aprobado cubre seguridad, datos y flujos críticos detectados.",
		"",
		"7. ORDEN DE OPERACIONES RECOMENDADO",
		"- Congelar alcance y objetivo del plan.",
		"- Validar primero seguridad/login/session y capa de datos.",
		"- Ejecutar cambios por unidades pequeñas con pruebas verificables.",
		"- Releer matriz de riesgos antes de delegar trabajo de agentes.",
		"",
		"8. CONTRATOS OPERATIVOS DEL PROYECTO",
		...(plan ? formatContractSummaryLines(plan) : ["- por confirmar"]),
		"",
		"9. VIOLACIONES ACTUALES CONTRA CONTRATOS",
		...(plan ? formatContractViolationLines(plan) : ["- por confirmar"]),
		"",
		"10. PLAN DE TRABAJO POR HITOS",
		...(plan ? formatMilestoneLines(plan) : ["- por confirmar"]),
		"",
		`Cuaderno Idu-pi: ${plan?.docNotebook.root ?? "—"}`,
		`Documentos: JSON=${planJson} | MD=${planMd}`,
	];
	if (requiresHumanCore) {
		lines.push(
			"",
			"Antes de aprobar:",
			...bootstrap.criticalDecisions.map((decision) => `- ${decision}`),
		);
	}
	lines.push(
		"",
		"Elegí una opción ejecutiva:",
		"1. Aprobar plan — fija esta fuente de verdad para ejecutar trabajo bajo reglas.",
		"2. Desaprobar plan — rechaza el análisis, conserva evidencia y aborta este draft.",
		"3. Trabajarlo interactivo — abre el Plan Maestro A-Z para lectura/edición guiada.",
		"4. Reevaluar en profundidad — fuerza AgentLabs de análisis extendido y regenera el plan.",
	);
	return lines.join("\n");
}

function formatContractSummaryLines(plan: MasterPlan): string[] {
	return plan.operationalContracts
		.slice(0, 6)
		.flatMap((contract) => [
			`- ${contract.title} (${contract.mode}/${contract.severity})`,
			...contract.rules.slice(0, 3).map((rule) => `  - ${rule}`),
		]);
}

function formatContractViolationLines(plan: MasterPlan): string[] {
	if (plan.contractViolations.length === 0)
		return [
			"- Sin violaciones automáticas detectadas; mantener revisión humana.",
		];
	return plan.contractViolations
		.slice(0, 6)
		.flatMap((violation) => [
			`- ${violation.title} (${violation.severity})`,
			`  Evidencia: ${violation.evidence.slice(0, 3).join(", ") || "—"}`,
			`  Impacto: ${violation.impact.join(" ")}`,
			`  Acción: ${violation.action.join(" ")}`,
		]);
}

function formatMilestoneLines(plan: MasterPlan): string[] {
	return plan.workMilestones
		.slice(0, 5)
		.flatMap((milestone) => [
			`- ${milestone.name}: ${milestone.goal}`,
			...milestone.actions.slice(0, 3).map((action) => `  - ${action}`),
		]);
}

function productEvidenceCount(plan: MasterPlan): number {
	return plan.sourceFiles.filter(
		(file) =>
			!file.startsWith("config/") &&
			!file.startsWith(".idu/") &&
			!file.endsWith("project-core.json") &&
			!file.endsWith("project-blueprint.json") &&
			!file.endsWith("project-flows.json") &&
			!file.endsWith("project-constitution.json"),
	).length;
}

function externalContextBlockers(plan: MasterPlan): string[] {
	const externalStores = plan.dataStores.filter((store) =>
		["supabase", "postgres"].includes(store.type),
	);
	if (externalStores.length === 0) return [];
	const localSchemaEvidence = plan.sourceFiles.some((file) =>
		/(^|\/)(supabase\/migrations|migrations?|schema\.(sql|prisma)|db\/|database\/)/iu.test(
			file,
		),
	);
	if (localSchemaEvidence) return [];
	return externalStores.map((store) => {
		const label = store.type === "supabase" ? "Supabase/Postgres" : store.name;
		return `Base de datos externa detectada (${label}), pero falta conexión MCP/credenciales o schema local para validar estructura, permisos y políticas reales.`;
	});
}

function formatArchitectureInvariantLines(plan: MasterPlan): string[] {
	return [
		`- Lenguajes: ${formatList(plan.architecture.languages)}`,
		`- Frameworks/librerías: ${formatList(plan.architecture.frameworks)}`,
		`- Frontend: ${normalizeUnknownArchitecture(plan.architecture.frontend)}`,
		`- Backend: ${normalizeUnknownArchitecture(plan.architecture.backend)}`,
		`- Capa de datos: ${normalizeUnknownArchitecture(plan.architecture.database)}`,
		`- Autenticación: ${normalizeUnknownArchitecture(plan.architecture.auth)}`,
		`- Despliegue: ${normalizeUnknownArchitecture(plan.architecture.deployment)}`,
	];
}

function normalizeUnknownArchitecture(value: string): string {
	if (value === "no claro") return "no detectado en el repo actual";
	if (value === "no detectada") return "no detectada en el repo actual";
	return value;
}

function visibleOutOfScope(plan: MasterPlan): string[] {
	const visible = plan.outOfScope.filter(
		(item) => !isSupervisorInternalRisk(item),
	);
	return visible.length > 0
		? visible
		: [
				"Cambios funcionales sin plan aprobado",
				"Modificar seguridad, datos o permisos sin validación explícita",
				"Agregar dependencias o integraciones no justificadas",
				"Publicar cambios sin verificación técnica previa",
			];
}

function visibleProductRisks(plan: MasterPlan): string[] {
	const raw = [
		...plan.criticalRisks,
		...plan.architectureRisks,
		...plan.securityRisks,
		...plan.qualityRisks,
	].filter((risk) => !isSupervisorInternalRisk(risk));
	const generated = [
		...(plan.securityModel.authDetected
			? [
					"Auth/login/session detectado; cambios en acceso, permisos o tokens requieren revisión de seguridad.",
				]
			: []),
		...(plan.dataStores.length > 0
			? [
					`Persistencia detectada (${plan.dataStores.map((store) => store.name).join(", ")}); cambios de datos requieren migración, rollback o validación equivalente.`,
				]
			: []),
		...(plan.detectedFlows.some((flow) => flow.riskLevel === "high")
			? [
					"Flujos críticos detectados; validar entrada → procesamiento → persistencia/salida antes de modificar comportamiento.",
				]
			: []),
		...(plan.qualityRisks.some((risk) => /No se detectaron tests/iu.test(risk))
			? [
					"Cobertura de tests no detectada; cambios funcionales necesitan verificación manual o pruebas nuevas.",
				]
			: []),
	];
	return dedupeStrings([...raw, ...generated]);
}

function isSupervisorInternalRisk(risk: string): boolean {
	return /supervisor|deep review|project core|project-local|plan maestro|constituci[oó]n|fuente de verdad|agentlabs|habilitar agentes|firma humana|no se pudo validar|repo real|commit|push/iu.test(
		risk,
	);
}

function formatList(values: string[]): string {
	return values.length > 0 ? values.join(", ") : "no detectado";
}

function projectDocRoot(stateRoot: string, projectId: string): string {
	return join(stateRoot, "Doc", safeDocProjectName(projectId));
}

function safeDocProjectName(projectId: string): string {
	return (
		projectId
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/gu, "_")
			.replace(/^_+|_+$/gu, "") || "project"
	);
}

function emptyDocNotebook(
	stateRoot: string,
	projectId: string,
): MasterPlanDocNotebook {
	return {
		root: projectDocRoot(stateRoot, projectId),
		status: "empty",
		sources: [],
		summary: "Sin documentos normativos cargados todavía.",
	};
}

function loadProjectDocNotebook(
	stateRoot: string,
	projectId: string,
): MasterPlanDocNotebook {
	const root = projectDocRoot(stateRoot, projectId);
	mkdirSync(root, { recursive: true });
	const sources = listMarkdownFiles(root).filter(
		(file) => !basename(file).includes(".generado."),
	);
	if (sources.length === 0) {
		return {
			root,
			status: "created",
			sources: [],
			summary:
				"Cuaderno normativo creado. Agregá aquí reglas humanas, decisiones estructurales y documentos críticos del proyecto.",
		};
	}
	const summary = sources
		.slice(0, 6)
		.map((file) => {
			const text = safeReadText(file).replace(/\s+/gu, " ").trim();
			return `${relative(root, file).replace(/\\/gu, "/")}: ${text.slice(0, 180)}`;
		})
		.join(" | ");
	return {
		root,
		status: "loaded",
		sources: sources.map((file) => relative(root, file).replace(/\\/gu, "/")),
		summary,
	};
}

function listMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...listMarkdownFiles(path));
		if (entry.isFile() && /\.md$/iu.test(entry.name)) files.push(path);
	}
	return files.sort();
}

function inferOperationalContracts(
	signals: ProjectSignals,
	docNotebook: MasterPlanDocNotebook,
): MasterPlanOperationalContract[] {
	const evidence = [
		...(docNotebook.sources.length
			? docNotebook.sources.map((source) => `Doc/${source}`)
			: ["Idu-pi base heuristics"]),
	];
	return [
		{
			area: "frontend",
			title: "Contrato Frontend / UI",
			rules: [
				"HTML debe expresar estructura y semántica; no debe concentrar lógica de negocio.",
				"JS inline, onclick/onchange inline y scripts mezclados en HTML quedan prohibidos salvo excepción documentada.",
				"Eventos deben registrarse desde módulos JS; llamadas a API/DB deben vivir en capa service/client.",
				"Render, eventos y persistencia deben separarse para que agentes no copien patrones mezclados.",
			],
			evidence,
			severity: "high",
			mode: "block",
		},
		{
			area: "auth",
			title: "Contrato Auth/Login",
			rules: [
				"Password, tokens y secretos nunca se loguean ni se exponen en URL/query string.",
				"Session/token no debe persistirse sin política explícita de expiración, limpieza y amenaza aceptada.",
				"Logout debe limpiar estado local y remoto relevante.",
				"Rutas/pantallas privadas deben validar sesión antes de mostrar datos.",
			],
			evidence: [...evidence, ...signals.securityModel.evidence.slice(0, 5)],
			severity: signals.hasAuth ? "critical" : "high",
			mode: signals.hasAuth ? "block" : "ask_human",
		},
		{
			area: "data",
			title: "Contrato Datos/DB",
			rules: [
				"Cambios de estructura deben ser migraciones versionadas con rollback o justificación explícita.",
				"Tablas críticas deben tener owner lógico, validación de tipos y reglas de integridad.",
				"RLS/permisos son obligatorios si hay datos sensibles o Supabase/Postgres externo.",
				"Reportes no deben leer estados parciales sin señalizar consistencia o corte temporal.",
				"Todo store debe declarar retención, backup/restore y verificación de recuperación antes de considerarse operativo.",
				"Datos sensibles o exportables requieren sanitización/redacción antes de logs, reportes, prompts o artefactos compartidos.",
				"SQLite/JSON/JSONL deben tener ciclo de vida explícito: owner lógico, ubicación, retención, limpieza, backup y criterios de archivo/eliminación.",
				"Migración/rollback debe cubrir tanto schema DB como compatibilidad de artefactos JSON/JSONL versionados.",
			],
			evidence: [
				...evidence,
				...signals.dataStoreCandidates
					.flatMap((store) => store.evidence)
					.slice(0, 6),
			],
			severity: signals.hasDb ? "critical" : "medium",
			mode: signals.hasDb ? "block" : "warn",
		},
		{
			area: "agent",
			title: "Contrato de ejecución para agentes",
			rules: [
				"Antes de modificar, el agente debe leer contratos del área afectada y archivos dueños.",
				"Si una tarea viola contrato block/high, debe detenerse y pedir aprobación humana.",
				"Cada cambio debe declarar evidencia, tests/verificación y riesgo residual.",
			],
			evidence,
			severity: "high",
			mode: "block",
		},
	];
}

function detectContractViolations(
	projectPath: string,
	signals: ProjectSignals,
	_contracts: MasterPlanOperationalContract[],
): MasterPlanContractViolation[] {
	const violations: MasterPlanContractViolation[] = [];
	const htmlInline = signals.sourceFiles.filter((file) => {
		if (!/\.html?$/iu.test(file)) return false;
		const content = safeReadText(join(projectPath, file));
		return (
			/<script[\s\S]*?>[\s\S]*?<\/script>/iu.test(content) ||
			/\son[a-z]+\s*=/iu.test(content)
		);
	});
	if (htmlInline.length > 0) {
		violations.push({
			area: "frontend",
			title: "HTML mezcla estructura con lógica JS/eventos inline",
			evidence: htmlInline.slice(0, 8),
			impact: [
				"Difícil de mantener y testear.",
				"Agentes futuros pueden copiar el patrón y aumentar el desorden.",
			],
			action: [
				"Separar vistas HTML de módulos JS.",
				"Registrar eventos desde controllers/modules.",
				"Mover fetch/Supabase a capa services/client.",
			],
			severity: "high",
		});
	}
	const tokenExposure = signals.hasAuth
		? signals.sourceFiles.filter((file) => {
				const lower = file.toLowerCase();
				if (!/\.(js|ts|html)$/iu.test(file)) return false;
				if (
					/^(test|tests|docs?|config|src\/master-plan|src\/project-map-scanner)/iu.test(
						lower,
					)
				)
					return false;
				const content = safeReadText(join(projectPath, file));
				return /(localStorage|sessionStorage).*?(token|jwt|session)|(token|jwt).*?(searchParams|location\.search|query)/isu.test(
					`${lower}\n${content}`,
				);
			})
		: [];
	if (tokenExposure.length > 0) {
		violations.push({
			area: "auth",
			title:
				"Token/session expuesto en cliente o URL sin política segura visible",
			evidence: tokenExposure.slice(0, 8),
			impact: [
				"Riesgo de robo/reuso de sesión.",
				"Rutas privadas pueden quedar expuestas si el token viaja en query string.",
			],
			action: [
				"Definir política de sesión y expiración.",
				"Eliminar token en query params.",
				"Centralizar auth/session en módulo seguro.",
			],
			severity: "critical",
		});
	}
	const supabaseMigrations = signals.sourceFiles.filter((file) =>
		/^supabase\/migrations\/.*\.sql$/iu.test(file),
	);
	const migrationsWithoutRls = supabaseMigrations.filter((file) => {
		const content = safeReadText(join(projectPath, file));
		return (
			/create\s+table/iu.test(content) &&
			!/row\s+level\s+security|enable\s+rls/iu.test(content)
		);
	});
	if (migrationsWithoutRls.length > 0) {
		violations.push({
			area: "data",
			title: "Migraciones crean tablas sin evidencia cercana de RLS/permisos",
			evidence: migrationsWithoutRls.slice(0, 8),
			impact: [
				"Datos sensibles pueden quedar accesibles sin política explícita.",
				"Cambios futuros de DB pueden romper seguridad o consistencia.",
			],
			action: [
				"Auditar RLS/policies por tabla crítica.",
				"Documentar owner lógico y permisos esperados.",
				"Agregar migración correctiva si falta política.",
			],
			severity: "critical",
		});
	}
	return violations;
}

function buildContractWorkMilestones(
	violations: MasterPlanContractViolation[],
	signals: ProjectSignals,
): MasterPlanWorkMilestone[] {
	return [
		{
			name: "Hito 1 — Constitución operativa vigente",
			goal: "Convertir Doc + evidencia del repo en contratos aceptados para guiar agentes.",
			actions: [
				"Revisar Doc del proyecto y completar reglas humanas faltantes.",
				"Aprobar contratos frontend/auth/datos/agentes.",
				"Marcar reglas block/warn/ask_human.",
			],
			exitCriteria: [
				"Contratos operativos guardados en Doc del stateRoot.",
				"Toda tarea nueva puede mapearse a un contrato o área explícita.",
			],
		},
		...(violations.length
			? [
					{
						name: "Hito 2 — Corrección de violaciones actuales",
						goal: "Reducir deuda arquitectónica que induce a la IA a repetir malos patrones.",
						actions: violations
							.flatMap((violation) => violation.action)
							.slice(0, 8),
						exitCriteria: [
							"Violaciones críticas/high tienen fix, plan de migración o excepción aprobada.",
							"Nuevos cambios no agregan JS inline, exposición de token ni DB sin política.",
						],
					},
				]
			: []),
		{
			name: "Hito 3 — Continuar producto bajo contratos",
			goal: "Seguir features manteniendo arquitectura, seguridad y datos dentro de márgenes aceptables.",
			actions: [
				...(signals.hasAuth
					? ["Validar login/session antes de features dependientes."]
					: []),
				...(signals.hasDb
					? ["Validar migraciones/rollback antes de tocar persistencia."]
					: []),
				"Ejecutar cambios en unidades pequeñas con tests y revisión de contrato.",
			],
			exitCriteria: [
				"Cada PR/tarea declara contrato afectado y evidencia revisada.",
				"Tests/build/lint o verificación equivalente pasan antes de cerrar.",
			],
		},
	];
}

function writeProjectDocNotebook(stateRoot: string, plan: MasterPlan): void {
	const root = projectDocRoot(stateRoot, plan.projectId);
	mkdirSync(root, { recursive: true });
	writeIfMissing(
		join(root, "00-proposito.md"),
		[
			"# Propósito del proyecto",
			"",
			plan.inferredObjective,
			"",
			"Agregá acá decisiones humanas, contexto de negocio y criterios no negociables.",
		].join("\n"),
	);
	writeIfMissing(
		join(root, "README.md"),
		[
			`# Cuaderno Idu-pi — ${plan.projectId}`,
			"",
			"Este cuaderno es estado interno/normativo de Idu-pi para guiar agentes.",
			"No es código del producto. Usalo para reglas, contratos, decisiones y documentación crítica.",
		].join("\n"),
	);
	writeFileSync(
		join(root, "01-contratos-operativos.generado.md"),
		formatContractsMarkdown(plan),
		"utf8",
	);
	writeFileSync(
		join(root, "02-violaciones-detectadas.generado.md"),
		formatViolationsMarkdown(plan),
		"utf8",
	);
	writeFileSync(
		join(root, "03-plan-de-trabajo-por-hitos.generado.md"),
		formatMilestonesMarkdown(plan),
		"utf8",
	);
}

function writeIfMissing(path: string, content: string): void {
	if (!existsSync(path)) writeFileSync(path, `${content}\n`, "utf8");
}

function formatContractsMarkdown(plan: MasterPlan): string {
	return [
		"# Contratos operativos del proyecto",
		"",
		`Fuente Doc: ${plan.docNotebook.root}`,
		"",
		...plan.operationalContracts.flatMap((contract) => [
			`## ${contract.title}`,
			`Área: ${contract.area} | Severidad: ${contract.severity} | Modo: ${contract.mode}`,
			"",
			...contract.rules.map((rule) => `- ${rule}`),
			"",
		]),
	].join("\n");
}

function formatViolationsMarkdown(plan: MasterPlan): string {
	return [
		"# Violaciones detectadas contra contratos",
		"",
		...(plan.contractViolations.length
			? plan.contractViolations.flatMap((violation) => [
					`## ${violation.title}`,
					`Área: ${violation.area} | Severidad: ${violation.severity}`,
					"",
					"Evidencia:",
					...violation.evidence.map((item) => `- ${item}`),
					"",
					"Impacto:",
					...violation.impact.map((item) => `- ${item}`),
					"",
					"Acción:",
					...violation.action.map((item) => `- ${item}`),
					"",
				])
			: ["Sin violaciones automáticas detectadas; mantener revisión humana."]),
	].join("\n");
}

function formatMilestonesMarkdown(plan: MasterPlan): string {
	return [
		"# Plan de trabajo por hitos",
		"",
		...plan.workMilestones.flatMap((milestone) => [
			`## ${milestone.name}`,
			milestone.goal,
			"",
			"Acciones:",
			...milestone.actions.map((item) => `- ${item}`),
			"",
			"Criterios de salida:",
			...milestone.exitCriteria.map((item) => `- ${item}`),
			"",
		]),
	].join("\n");
}

function signalValue(plan: MasterPlan, key: string): string {
	const prefix = `${key}=`;
	return (
		plan.autoDepth.signals
			.find((signal) => signal.startsWith(prefix))
			?.slice(prefix.length) ?? "?"
	);
}

function topBullets(values: string[], limit: number): string[] {
	const items = values.slice(0, limit);
	return items.length
		? items.map((value) => `- ${value}`)
		: ["- por confirmar"];
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
		plan ? formatAutoDepthSummary(plan) : "—",
		"",
		"Memoria:",
		plan
			? `${plan.memoryContext.provider}/${plan.memoryContext.status}`
			: "unavailable",
		"",
		"Guardado en:",
		savedPath,
		"",
		"Acción automática:",
		...(isDraftResult
			? [
					...(result.automaticNote ? [`- ${result.automaticNote}`] : []),
					...(plan?.safeActionsPerformed.length
						? plan.safeActionsPerformed.map((item) => `- ${item}`)
						: [
								"- Revisé estado aislado",
								"- Analicé estructura básica",
								"- Generé Plan Maestro draft",
								"- Guardé resumen optimizado",
							]),
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
		lines.push("", "Advertencias:");
		if (plan.deepStage === "lab_review_done") {
			lines.push(
				"- Deep review ya fue ejecutado/reutilizado; no se repite automáticamente.",
				"- El plan sigue en draft hasta que una persona revise los hallazgos.",
			);
		} else {
			lines.push(
				"- Deep review costoso requiere aprobación humana explícita.",
				"- No ejecutar AgentLabs largos automáticamente.",
			);
		}
	}
	return lines.join("\n");
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function reviewedPlanObjective(plan: MasterPlan): string {
	const flowNames = plan.detectedFlows.map((flow) => flow.name.toLowerCase());
	if (
		plan.securityModel.authDetected &&
		plan.dataStores.length > 0 &&
		flowNames.some((name) => /ingesta|carga|reporte|visualización/u.test(name))
	) {
		return "Estabilizar, asegurar y optimizar la operación industrial: autenticación segura, ingesta confiable de datos y reporting operativo como fuente de verdad.";
	}
	return plan.inferredObjective;
}

function reviewedPlanProblemStatement(
	plan: MasterPlan,
	highFindings: string[],
): string {
	const hasSessionRisk = highFindings.some((finding) =>
		/token|jwt|localstorage|sesion|sesión/iu.test(finding),
	);
	const hasDataRisk = highFindings.some((finding) =>
		/migraci[oó]n|persistid|datos|database|db/iu.test(finding),
	);
	if (hasSessionRisk || hasDataRisk) {
		return "Las operaciones del sistema dependen de autenticación, ingesta y reporting sobre datos sensibles. La revisión detectó exposición de sesión/JWT, persistencia cliente y riesgos de consistencia de datos; el supervisor debe consolidar un plan de trabajo seguro antes de habilitar agentes sobre el repo real.";
	}
	return plan.problemStatement;
}

function inferReviewedFrontendStack(plan: MasterPlan): string | undefined {
	const files = [...plan.sourceFiles, ...plan.architecture.evidence].map(
		(file) => file.replace(/\\/gu, "/").toLowerCase(),
	);
	const htmlCount = files.filter((file) => file.endsWith(".html")).length;
	const plainJsCount = files.filter(
		(file) => file.endsWith(".js") && !file.endsWith(".jsx"),
	).length;
	const reactSourceCount = files.filter(
		(file) =>
			file.endsWith(".jsx") ||
			file.endsWith(".tsx") ||
			file.includes("/src/app.") ||
			file.includes("/src/main.") ||
			file.includes("/src/index."),
	).length;
	if (htmlCount >= 3 && plainJsCount >= 3 && reactSourceCount === 0) {
		return "HTML/JavaScript plano";
	}
	return undefined;
}

function formatAutoDepthSummary(plan: MasterPlan): string {
	if (plan.autoDepth.mode === "deep_required") {
		return plan.deepStage === "lab_review_done"
			? `${plan.autoDepth.mode} — deep review ejecutado; falta revisar/ajustar antes de aprobar`
			: `${plan.autoDepth.mode} — análisis seguro etapa 1 completado; deep review requiere aprobación`;
	}
	return `${plan.autoDepth.mode} — ${plan.autoDepth.reason}`;
}

function masterPlanActionLines(
	status: MasterPlanStatus | "missing",
	plan?: MasterPlan,
): string[] {
	if (status === "draft") {
		if (plan?.deepStage === "lab_review_done") {
			return [
				"Deep review ya ejecutado. El supervisor recomienda:",
				"1. Revisar hallazgos y evidencia.",
				"2. Ajustar o rehacer Plan Maestro si hay clasificación incorrecta.",
				"3. Aprobar sólo cuando el plan sea fuente confiable.",
			];
		}
		return [
			'Responder "ok" para aprobar, "rehacer" para regenerar, o usar /idu para continuar el flujo supervisor.',
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
	return [
		formatRevisionAntesDeZarpar(review.revisionAntesDeZarpar),
		"",
		review.markdown,
	].join("\n");
}

function formatRevisionAntesDeZarpar(
	revision: MasterPlanRevisionAntesDeZarpar,
): string {
	return [
		"## Revisión antes de zarpar",
		`Estado: ${revision.status}`,
		`Confianza: ${revision.confidence}`,
		"",
		"### Entendimiento del proyecto",
		...bulletList(revision.projectUnderstanding),
		"",
		"### Contratos necesarios",
		...bulletList(
			revision.requiredContracts.map(
				(contract) =>
					`${contract.title} (${contract.category}/${contract.status}) — ${contract.requirement} Acción: ${contract.nextAction}`,
			),
		),
		"",
		"### Definiciones faltantes",
		...bulletList(revision.missingDefinitions),
		"",
		"### Fuentes de información",
		...bulletList(revision.requiredInformationSources),
		"",
		"### Fuentes externas vivas recomendadas",
		...bulletList(revision.recommendedExternalSources),
		"",
		"### MCP/herramientas necesarias",
		...bulletList(revision.recommendedMcpTools),
		"",
		"### AgentLabs recomendados",
		...bulletList(
			revision.recommendedAgentLabs.map(
				(lab) => `${lab.name}: ${lab.purpose} Disparador: ${lab.trigger}`,
			),
		),
		"",
		"### Problemas actuales",
		...bulletList(revision.currentProblems),
		"",
		"### Estrategia de arreglo",
		...bulletList(revision.repairStrategy),
		"",
		"### Preguntas para el usuario",
		...bulletList(revision.questionsForUser),
		"",
		"### Checklist antes de zarpar",
		...bulletList(revision.beforeSailingChecklist),
	].join("\n");
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

function writeMasterPlanFlowArtifact(
	stateRoot: string,
	plan: MasterPlan,
): void {
	const artifact: MasterPlanFlowArtifact = {
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		generatedAt: plan.generatedAt,
		status: plan.status === "approved" ? "approved" : "draft",
		purpose:
			"Mapa permanente de flujos del proyecto. Se actualiza junto al proyecto y no reemplaza el Plan Maestro normativo.",
		flows: plan.projectFlows,
		detectedFlows: plan.detectedFlows,
	};
	writeFileSync(
		join(stateRoot, plan.flowArtifact),
		`${JSON.stringify(artifact, null, 2)}\n`,
		"utf8",
	);
}

function formatClaim(claim: MasterPlanClaim): string {
	return `${claim.title}: ${claim.statement} [${claim.source}/${claim.status}, confianza ${claim.confidence}] evidencia=${claim.evidence.join(", ") || "—"}`;
}

function formatReality(observation: MasterPlanRealityObservation): string {
	return `${observation.area}: ${observation.statement} [${observation.status}, confianza ${observation.confidence}] evidencia=${observation.evidence.join(", ") || "—"}`;
}

function formatDrift(finding: MasterPlanDriftFinding): string {
	return `${finding.title} [${finding.severity}] declarado=${finding.declared}; observado=${finding.observed}; recomendación=${finding.recommendation}`;
}

function formatProjectFlow(flow: MasterPlanProjectFlow): string {
	return `${flow.name} (${flow.category}) — ${flow.purpose}; entradas=${flow.entrypoints.join(", ") || "—"}; módulos=${flow.modules.join(", ") || "—"}; salidas=${flow.outputs.join(", ") || "—"}; reglas=${flow.rules.join(" | ") || "—"}`;
}

function buildRevisionAntesDeZarpar(
	plan: MasterPlan,
	stateRoot: string,
): MasterPlanRevisionAntesDeZarpar {
	const sourceLibraryStatus = getSourceLibraryStatus({
		stateRoot,
		projectId: plan.projectId,
	});
	const hasReadySources = sourceLibraryStatus.state === "ready";
	const hasApprovedContract = plan.canonicalClaims.some(
		(claim) => claim.source === "user_approved",
	);
	const problems = dedupeStrings([
		...(plan.status !== "approved"
			? ["Plan Maestro sigue en draft/no aprobado."]
			: []),
		...(!hasApprovedContract ? ["Contratos aprobados todavía vacíos."] : []),
		...(plan.source.blueprintStatus !== "project-local"
			? [
					"Project Blueprint no confirmado como fuente local; no debe tratarse como ley del proyecto.",
				]
			: []),
		...(hasReadySources
			? []
			: [
					`Biblioteca local de fuentes no lista (${sourceLibraryStatus.state}); Doc/<project>/source-index.json debe tener fuentes válidas y vigentes.`,
				]),
		...plan.contractViolations.map((violation) => violation.title),
		...plan.criticalRisks,
	]);
	const requiredContracts = buildReadinessContracts(
		plan,
		hasReadySources,
		sourceLibraryStatus.state,
	);
	const missingDefinitions = dedupeStrings([
		...(plan.status !== "approved"
			? ["Aprobación humana explícita del Plan Maestro."]
			: []),
		...(!hasApprovedContract
			? [
					"Contratos aprobados por usuario: objetivo, stack, arquitectura, datos, seguridad, navegación, fuentes, AgentLabs, testing y entrega.",
				]
			: []),
	]);
	const status: MasterPlanRevisionAntesDeZarpar["status"] =
		plan.status === "incompatible" || plan.criticalRisks.length > 0
			? "blocked"
			: missingDefinitions.length > 0
				? "needs_user_definition"
				: !hasReadySources
					? "needs_tools"
					: "ready";
	return {
		status,
		confidence: readinessConfidence(plan, hasReadySources, hasApprovedContract),
		projectUnderstanding: buildProjectUnderstanding(plan),
		requiredContracts,
		missingDefinitions,
		requiredInformationSources: dedupeStrings([
			...plan.canonicalClaims
				.filter((claim) => claim.source === "canonical_doc")
				.flatMap((claim) => claim.evidence),
			"Doc/<project>/source-index.json",
			"Doc/<project>/sources/local/ para PDFs, libros, normas, leyes y documentación humana descargada.",
		]),
		recommendedExternalSources: [
			"Documentación oficial, changelogs, releases e issues de proyectos y servicios usados.",
			"GitHub advisories, npm security advisories, CVE/NVD y OWASP ASVS/Top 10 para riesgos vivos de seguridad y supply chain.",
			"Posts oficiales en X/Twitter, blogs oficiales de seguridad y noticias técnicas para detectar deprecaciones, incidentes y cambios de ecosistema.",
			"Reddit y comunidades técnicas relevantes como señales comunitarias que informan riesgos, pero no aprueban contratos por sí solas.",
		],
		recommendedMcpTools: buildRecommendedMcpTools(plan),
		recommendedAgentLabs: buildRecommendedAgentLabs(plan),
		currentProblems: problems,
		repairStrategy: buildRepairStrategy(plan, hasReadySources),
		questionsForUser: buildQuestionsForUser(plan, hasReadySources),
		beforeSailingChecklist: buildBeforeSailingChecklist(plan, hasReadySources),
	};
}

function buildReadinessContracts(
	plan: MasterPlan,
	hasReadySources: boolean,
	sourceLibraryState: string,
): MasterPlanReadinessContract[] {
	const evidence = (items: string[]): string[] =>
		items.filter(Boolean).slice(0, 6);
	return [
		{
			category: "objective",
			title: "Contrato de objetivo",
			status:
				plan.status === "approved" ? "confirmed" : "needs_user_confirmation",
			requirement:
				"Confirmar qué se construye, para quién, alcance, no-alcance y criterio de terminado.",
			evidence: evidence([plan.inferredObjective, ...plan.scope]),
			nextAction:
				"El usuario debe confirmar o ajustar el objetivo antes de ejecutar cambios grandes.",
		},
		{
			category: "stack",
			title: "Contrato de stack",
			status: plan.architecture.languages.length > 0 ? "confirmed" : "missing",
			requirement:
				"Acordar lenguajes, frameworks, base de datos, auth, deploy y servicios externos permitidos.",
			evidence: evidence([
				...plan.architecture.languages,
				...plan.architecture.frameworks,
				plan.architecture.database,
				plan.architecture.auth,
			]),
			nextAction:
				"Confirmar stack real y prohibir incorporaciones no justificadas.",
		},
		{
			category: "architecture",
			title: "Contrato de arquitectura",
			status:
				plan.architecture.projectKind !== "unknown" ? "confirmed" : "missing",
			requirement:
				"Definir core, adapters, capas, módulos dueños y límites que los agentes no deben mezclar.",
			evidence: evidence(plan.architecture.evidence),
			nextAction:
				"Revisar arquitectura declarada contra realidad construida y aprobar invariantes.",
		},
		{
			category: "data",
			title: "Contrato de datos",
			status: plan.dataStores.length > 0 ? "confirmed" : "recommended",
			requirement:
				"Definir entidades, almacenamiento, migraciones, permisos, backups y consistencia de reportes.",
			evidence: evidence(plan.dataStores.flatMap((store) => store.evidence)),
			nextAction:
				"Validar schema/localización de datos antes de modificar persistencia.",
		},
		{
			category: "security",
			title: "Contrato de seguridad",
			status: "recommended",
			requirement:
				"Acordar auth, sesiones, tokens, secretos, roles, permisos, auditoría y supply chain.",
			evidence: evidence(plan.securityModel.evidence),
			nextAction:
				"Ejecutar o planificar AgentLab de seguridad antes de aprobar cambios sensibles.",
		},
		{
			category: "navigation",
			title: "Contrato de navegación/flujos UX",
			status:
				plan.projectFlows.length > 0 || plan.detectedFlows.length > 0
					? "confirmed"
					: "recommended",
			requirement:
				"Definir pantallas, rutas, flujos principales, estados de error/carga/vacío y roles visibles.",
			evidence: evidence([
				...plan.projectFlows.map((flow) => flow.name),
				...plan.detectedFlows.map((flow) => flow.name),
			]),
			nextAction:
				"Mantener flujos permanentes en master-plan.flows.json y auditarlos contra UI/código.",
		},
		{
			category: "information_sources",
			title: "Contrato de fuentes de información",
			status: hasReadySources ? "recommended" : "missing",
			requirement:
				"Declarar fuentes válidas: documentación canónica, PDFs/normas/libros locales y MCPs/fuentes externas vivas.",
			evidence: evidence([
				...plan.canonicalClaims.flatMap((claim) => claim.evidence),
				...(hasReadySources
					? [`Doc/<project>/source-index.json (${sourceLibraryState})`]
					: []),
			]),
			nextAction: hasReadySources
				? "Mantener source-index actualizado como evidencia advisory; no promueve contratos automáticamente."
				: `Crear o refrescar Source Library (estado actual: ${sourceLibraryState}) antes de derivar contratos normativos.`,
		},
		{
			category: "agentlabs",
			title: "Contrato de AgentLabs",
			status: "recommended",
			requirement:
				"Definir auditores audit-only por especialidad, cuándo se ejecutan y qué evidencia deben devolver.",
			evidence: evidence(plan.agentLabReviews.map((lab) => lab.specialty)),
			nextAction:
				"Crear solicitudes AgentLab desde el orquestador; los labs no implementan ni hacen commit/push.",
		},
		{
			category: "testing",
			title: "Contrato de testing/confiabilidad",
			status: "recommended",
			requirement:
				"Definir pruebas mínimas, smoke tests, escenarios críticos y confiabilidad de skills/agentes.",
			evidence: evidence(plan.toolingDetected),
			nextAction:
				"Exigir evidencia de tests antes de declarar tareas finalizadas.",
		},
		{
			category: "delivery",
			title: "Contrato de entrega",
			status:
				plan.status === "approved" ? "confirmed" : "needs_user_confirmation",
			requirement:
				"Definir qué significa finalizar: Plan aprobado, tests, auditorías sin blockers, docs y revisión humana.",
			evidence: evidence([plan.status, ...plan.recommendedNext]),
			nextAction:
				"No zarpar con cambios grandes hasta cerrar checklist mínimo.",
		},
	];
}

function buildProjectUnderstanding(plan: MasterPlan): string[] {
	if (plan.architecture.projectKind === "supervisor-runtime") {
		return [
			"Idu-pi es un supervisor/auditor para proyectos guiados por un orquestador Pi.",
			"MCP es la superficie funcional para que el orquestador consulte contexto, riesgos, contratos y recomendaciones.",
			"CLI, Telegram y Pi slash son adapters del core; no reemplazan al núcleo.",
			"AgentLabs son auditores audit-only: revisan con evidencia, no implementan, no modifican repo real y no hacen commit/push.",
			"Plan Maestro, Doc/cuaderno, reportes y flujos permanentes viven en stateRoot aislado.",
		];
	}
	return dedupeStrings([
		`${plan.projectId}: ${plan.inferredObjective}`,
		`Arquitectura: ${plan.architecture.projectKind}; ${plan.architecture.backend}; ${plan.architecture.database}.`,
		`Alcance: ${plan.scope.join("; ") || "requiere confirmación humana"}.`,
	]);
}

function buildRecommendedMcpTools(plan: MasterPlan): string[] {
	return dedupeStrings([
		"idu_master_plan_review",
		"idu_task_context",
		"idu_orchestrator_procedure",
		"idu_agentlab_request_create",
		"idu_agentlab_review_run",
		...(plan.dataStores.some((store) =>
			["postgres", "supabase"].includes(store.type),
		)
			? [
					"MCP de base de datos/Supabase para validar schema, permisos y RLS reales.",
				]
			: []),
		"MCP/fuente viva de advisories npm para riesgos de supply chain.",
	]);
}

function buildRecommendedAgentLabs(
	plan: MasterPlan,
): MasterPlanRecommendedAgentLab[] {
	if (plan.architecture.projectKind === "supervisor-runtime") {
		return [
			{
				name: "AgentLab bibliotecario",
				purpose:
					"Auditor audit-only que lee documentación, noticias, advisories, posts oficiales y comunidades para mantener al orquestador informado sobre seguridad, deprecaciones, breaking changes, cambios de ecosistema y mejores prácticas.",
				trigger:
					"Antes de aprobar contratos nuevos, actualizar dependencias o declarar estable una integración externa.",
				evidence: [
					"docs/mcp-server.md",
					"Doc/<project>/source-index.json",
					"fuentes externas vivas",
				],
			},
			{
				name: "AgentLab seguridad",
				purpose:
					"Auditar secretos, supply chain, permisos, auth interna y exposición accidental de estado.",
				trigger:
					"Antes de publicar cambios de MCP, instalador, comandos o dependencias.",
				evidence: ["docs/mcp-server.md", "package.json"],
			},
			{
				name: "AgentLab persistencia/DB",
				purpose:
					"Auditar SQLite local, reportes JSON/JSONL, stateRoot y compatibilidad de artefactos.",
				trigger:
					"Antes de cambiar schemas, reportes, memoria local o reset de estado.",
				evidence: ["src/lab-db.ts", "stateRoot"],
			},
			{
				name: "AgentLab flujos funcionales",
				purpose:
					"Verificar /idu, MCP, CLI, Telegram/Pi slash y master-plan.flows.json contra el Plan Maestro.",
				trigger:
					"Antes de aprobar cambios de navegación operativa o entrypoints.",
				evidence: ["src/mcp-server.ts", "src/cli.ts"],
			},
			{
				name: "AgentLab optimización de skills",
				purpose:
					"Detectar skills/reglas que el proyecto necesita ajustar para el orquestador y sus subagentes.",
				trigger:
					"Después de consolidar contratos y antes de escalar trabajo repetitivo.",
				evidence: ["src/skill-improvement-proposals.ts"],
			},
			{
				name: "AgentLab confiabilidad/tests de skills",
				purpose:
					"Diseñar escenarios para probar que skills y contratos guían agentes de forma confiable.",
				trigger: "Antes de declarar estable un flujo de skills o gobernanza.",
				evidence: ["test/", "Doc/<project>"],
			},
		];
	}
	return [
		{
			name: "AgentLab seguridad",
			purpose: "Auditar auth, secretos, permisos y superficie de ataque.",
			trigger: "Antes de cambios en seguridad, login, dependencias o deploy.",
			evidence: plan.securityModel.evidence,
		},
		{
			name: "AgentLab datos/DB",
			purpose: "Auditar schema, migraciones, permisos, consistencia y backups.",
			trigger: "Antes de modificar persistencia o reportes críticos.",
			evidence: plan.dataStores.flatMap((store) => store.evidence).slice(0, 6),
		},
		{
			name: "AgentLab flujos funcionales",
			purpose:
				"Auditar navegación, flujos de usuario y contratos funcionales permanentes.",
			trigger: "Antes de cerrar hitos funcionales.",
			evidence: plan.detectedFlows.flatMap((flow) => flow.evidence).slice(0, 6),
		},
	];
}

function buildRepairStrategy(
	plan: MasterPlan,
	hasSourceIndex: boolean,
): string[] {
	return dedupeStrings([
		"Presentar esta revisión al usuario y pedir ajustes antes de tratar el Plan Maestro como ley.",
		...(plan.status !== "approved"
			? ["Aprobar o corregir el Plan Maestro."]
			: []),
		...(!hasSourceIndex
			? [
					"Crear biblioteca de fuentes locales en Doc/<project>/sources/local y un source-index.json.",
				]
			: []),
		"Crear solicitudes AgentLab audit-only para seguridad, datos/persistencia, flujos, skills y confiabilidad cuando apliquen.",
		"Convertir definiciones humanas en contratos aprobados antes de delegar implementación amplia.",
	]);
}

function buildQuestionsForUser(
	plan: MasterPlan,
	hasSourceIndex: boolean,
): string[] {
	return dedupeStrings([
		`¿Confirmás que el objetivo del proyecto es: ${plan.inferredObjective}?`,
		`¿Confirmás este stack/arquitectura: ${plan.architecture.languages.join(", ") || "lenguajes no detectados"}; ${plan.architecture.backend}; ${plan.architecture.database}; auth ${plan.architecture.auth}?`,
		"¿Qué fuentes humanas, PDFs, normas, leyes o libros deben mandar sobre el scanner?",
		...(!hasSourceIndex
			? [
					"¿Querés crear una biblioteca local de fuentes normativas en Doc/<project>/sources/local?",
				]
			: []),
		"¿Qué AgentLabs querés exigir antes de aprobar cambios: seguridad, DB, flujos, skills o tests/confiabilidad?",
	]);
}

function buildBeforeSailingChecklist(
	_plan: MasterPlan,
	hasSourceIndex: boolean,
): string[] {
	return dedupeStrings([
		"Aprobar Plan Maestro o corregirlo con las definiciones humanas faltantes.",
		"Confirmar contratos de objetivo, stack, arquitectura, datos, seguridad, navegación, fuentes, AgentLabs, testing y entrega.",
		...(!hasSourceIndex
			? [
					"Registrar fuentes locales/normativas mínimas o declarar que no aplican para este proyecto.",
				]
			: []),
		"Definir qué MCPs/herramientas externas son necesarias para validar la realidad del proyecto.",
		"Crear o descartar explícitamente AgentLabs recomendados con motivo.",
		"Definir pruebas mínimas y evidencia requerida antes de finalizar tareas.",
	]);
}

function readinessConfidence(
	plan: MasterPlan,
	hasSourceIndex: boolean,
	hasApprovedContract: boolean,
): number {
	let score = 0.45;
	if (plan.canonicalClaims.some((claim) => claim.source === "canonical_doc"))
		score += 0.15;
	if (plan.status === "approved") score += 0.15;
	if (hasApprovedContract) score += 0.1;
	if (hasSourceIndex) score += 0.1;
	if (plan.criticalRisks.length === 0) score += 0.05;
	return Math.min(0.95, Number(score.toFixed(2)));
}

export function formatMasterPlanMarkdown(plan: MasterPlan): string {
	return [
		`# Plan Maestro Idu-pi: ${plan.inferredObjective}`,
		"",
		"## Identidad del proyecto",
		plan.executiveSummary,
		"",
		"## Alcance del proyecto",
		...bulletList(plan.scope),
		"",
		"## Fuera de alcance",
		...bulletList(plan.outOfScope),
		"",
		"## Arquitectura detectada / correcta",
		...bulletList([
			`Tipo: ${plan.architecture.projectKind}`,
			`Interfaces/adaptadores: ${plan.architecture.frontend}`,
			`Núcleo/backend: ${plan.architecture.backend}`,
			`Persistencia: ${plan.architecture.database}`,
			`Auth de producto: ${plan.architecture.auth}`,
			`Deploy: ${plan.architecture.deployment}`,
			`Package manager: ${plan.architecture.packageManager}`,
		]),
		"",
		"## Stack/lenguajes",
		...bulletList([
			`Lenguajes reales: ${plan.architecture.languages.join(", ") || "—"}`,
			`Runtime/frameworks/interfaces: ${plan.architecture.frameworks.join(", ") || "—"}`,
			...plan.architecture.evidence.map((item) => `Evidencia: ${item}`),
		]),
		"",
		"## Documentación declarada vs realidad construida",
		"### Documentación declarada",
		...bulletList(plan.canonicalClaims.map(formatClaim)),
		"",
		"### Realidad construida",
		...bulletList(plan.observedReality.map(formatReality)),
		"",
		"### Drift / contradicciones",
		...bulletList(plan.driftFindings.map(formatDrift)),
		"",
		"## Mapa funcional",
		...bulletList(plan.detectedModules),
		"",
		"## Flujos funcionales permanentes",
		`Los flujos permanentes se mantienen fuera del documento principal en \`${plan.flowArtifact}\` para poder actualizarlos junto al proyecto sin convertir el Plan Maestro en una lista operativa.`,
		...bulletList(plan.projectFlows.map(formatProjectFlow)),
		"",
		"## Persistencia / datos",
		...bulletList(plan.dataStores.map(formatDataStoreForMarkdown)),
		"",
		"## Tooling detectado",
		...bulletList(plan.toolingDetected),
		"",
		"## Seguridad / auth",
		...bulletList([
			`Auth de producto detectado: ${plan.securityModel.authDetected ? "sí" : "no"}`,
			`Sesión de producto detectada: ${plan.securityModel.sessionDetected ? "sí" : "no"}`,
			...plan.securityModel.sensitiveFlows.map(
				(flow) => `Flujo sensible confirmado: ${flow}`,
			),
			...plan.securityModel.evidence.map((item) => `Evidencia: ${item}`),
		]),
		"",
		"## Contratos detectados",
		...bulletList(
			plan.operationalContracts.map(
				(contract) =>
					`${contract.title} (${contract.mode}/${contract.severity}) — ${contract.rules.join(" | ")}`,
			),
		),
		"",
		"## Contratos aprobados",
		...bulletList(
			plan.canonicalClaims
				.filter((claim) => claim.source === "user_approved")
				.map(formatClaim),
		),
		"",
		"## Violaciones contra contratos",
		...bulletList(
			plan.contractViolations.map(
				(violation) =>
					`${violation.title} [${violation.severity}] evidencia=${violation.evidence.join(", ")} acción=${violation.action.join(" | ")}`,
			),
		),
		"",
		"## Cuaderno Idu-pi / Doc",
		...bulletList([
			`Root: ${plan.docNotebook.root}`,
			`Status: ${plan.docNotebook.status}`,
			`Summary: ${plan.docNotebook.summary}`,
			...plan.docNotebook.sources.map((source) => `Fuente: ${source}`),
		]),
		"",
		"## Estado normativo",
		...bulletList([
			`Estado: ${plan.status}`,
			`Plan JSON: master-plan.json`,
			`Flujos permanentes: ${plan.flowArtifact}`,
		]),
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
		revisionAntesDeZarpar: buildRevisionAntesDeZarpar(
			diagnosticPlan,
			stateRoot,
		),
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
		deepStage: "none",
		deepReviewRecommended: false,
		deepReviewRequiresApproval: false,
		safeActionsPerformed: [],
		memoryContext: unavailableMemoryContext(),
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
		projectFlows: [],
		flowArtifact: "master-plan.flows.json",
		canonicalClaims: [],
		observedReality: [],
		driftFindings: [],
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
		docNotebook: emptyDocNotebook(stateRoot, current?.projectId ?? "unknown"),
		operationalContracts: [],
		contractViolations: [],
		workMilestones: [],
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
	// Invalidate the cached objective snapshot so the next read picks up
	// the new status (e.g. approved after a prior draft/incompatible cache).
	invalidateMasterPlanObjectiveCache(stateRoot);
	writeSupervisorProjectIndex(stateRoot, plan);
	const markdownPath =
		current?.currentPlanJson === relativeFromState(stateRoot, jsonPath)
			? safePathInsideState(stateRoot, current.currentPlanMd)
			: jsonPath.replace(/\.json$/u, ".md");
	writeFileSync(markdownPath, `${formatMasterPlanMarkdown(plan)}\n`, "utf8");
	writeMasterPlanFlowArtifact(stateRoot, plan);
	const nextCurrent = writeCurrent(stateRoot, {
		currentPlanJson: relativeFromState(stateRoot, jsonPath),
		currentPlanMd: relativeFromState(stateRoot, markdownPath),
		status: plan.status,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		...(plan.gitHead ? { gitHead: plan.gitHead } : {}),
		updatedAt: new Date().toISOString(),
	});
	writeMasterPlanPendingAction(stateRoot, nextCurrent);
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
	projectPath: string;
	sourceFiles: string[];
	canonicalDocumentation?: CanonicalProjectDocumentation;
};

type CanonicalProjectDocumentation = {
	path: string;
	objective?: string;
	architecture: Partial<MasterPlanArchitecture>;
	dataStores: MasterPlanDataStore[];
	securityModel?: Partial<MasterPlanSecurityModel>;
	frameworks: string[];
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
			if (shouldCollectRuntimeContentSignals(classification, rel)) {
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
				if (
					/report|dashboard|analytics|chart|export/iu.test(`${rel} ${content}`)
				)
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
		projectPath,
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
		sourceFiles: files,
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

function shouldCollectRuntimeContentSignals(
	classification: ProjectPathClassification,
	rel: string,
): boolean {
	if (["docs", "test", "documentation"].includes(classification)) return false;
	if (/(^|\/)(docs?|tests?|fixtures?|examples?|defaults?)(\/|$)/iu.test(rel))
		return false;
	return (
		isProductClassification(classification) ||
		["configuration", "data_store", "route", "auth", "service"].includes(
			classification,
		)
	);
}

function applyCanonicalDocumentationSignals(
	signals: ProjectSignals,
): ProjectSignals {
	const canonical = findCanonicalProjectDocumentation(
		signals.projectPath,
		signals.sourceFiles,
	);
	if (!canonical) return signals;
	const inheritedFrameworks =
		canonical.architecture.frontend === "HTML/CSS/JS vanilla"
			? signals.architecture.frameworks.filter(
					(framework) =>
						!["React", "Vue", "Svelte", "Next.js", "Vite"].includes(framework),
				)
			: signals.architecture.frameworks;
	const frameworkSet = new Set([
		...inheritedFrameworks,
		...canonical.frameworks,
	]);
	const architecture: MasterPlanArchitecture = {
		...signals.architecture,
		...canonical.architecture,
		frameworks: [...frameworkSet].sort(),
		evidence: unique([canonical.path, ...signals.architecture.evidence]).slice(
			0,
			12,
		),
	};
	const securityEvidence =
		canonical.securityModel?.authDetected === false
			? [canonical.path]
			: unique([canonical.path, ...signals.securityModel.evidence]).slice(
					0,
					12,
				);
	const securityModel: MasterPlanSecurityModel = {
		...signals.securityModel,
		...canonical.securityModel,
		evidence: securityEvidence,
	};
	return {
		...signals,
		canonicalDocumentation: canonical,
		dataStoreCandidates: canonical.dataStores.length
			? canonical.dataStores
			: signals.dataStoreCandidates,
		flowCandidates: signals.flowCandidates
			.filter(
				(flow) =>
					!(
						canonical.securityModel?.authDetected === false &&
						flow.type === "auth"
					),
			)
			.map((flow) => ({
				...flow,
				dataStores: resolveCanonicalFlowDataStores(flow, canonical.dataStores),
			})),
		architecture,
		securityModel,
		hasAuth: canonical.securityModel
			? securityModel.authDetected
			: signals.hasAuth || securityModel.authDetected,
		hasDb: canonical.dataStores.length > 0 || signals.hasDb,
	};
}

function resolveCanonicalFlowDataStores(
	flow: MasterPlanFunctionalFlow,
	canonicalStores: MasterPlanDataStore[],
): string[] {
	if (!canonicalStores.length) return flow.dataStores;
	const canonicalTypes = canonicalStores.map((store) => store.type);
	const compatibleExisting = flow.dataStores.filter((store) =>
		canonicalTypes.includes(store as MasterPlanDataStore["type"]),
	);
	if (compatibleExisting.length) return compatibleExisting;
	if (["data_ingest", "reporting", "api"].includes(flow.type))
		return canonicalTypes;
	return [];
}

function findCanonicalProjectDocumentation(
	projectPath: string,
	files: string[],
): CanonicalProjectDocumentation | undefined {
	const canonicalPath = files.find((file) =>
		/(^|\/)(DOCUMENTACION_TECNICA[^/]*\.md|docs\/architecture\.md|architecture\.md)$/iu.test(
			file,
		),
	);
	if (!canonicalPath) return undefined;
	const content = safeReadText(join(projectPath, canonicalPath));
	if (!content.trim()) return undefined;
	return parseCanonicalProjectDocumentation(canonicalPath, content);
}

function parseCanonicalProjectDocumentation(
	path: string,
	content: string,
): CanonicalProjectDocumentation {
	const architecture: Partial<MasterPlanArchitecture> = {};
	const frameworks: string[] = [];
	const dataStores: MasterPlanDataStore[] = [];
	let canonicalObjective: string | undefined;
	const addCanonicalStore = (type: MasterPlanDataStore["type"]): void => {
		if (!dataStores.some((store) => store.type === type))
			dataStores.push({
				name: type === "postgres" ? "PostgreSQL" : type,
				type,
				evidence: [path],
				riskLevel: ["postgres", "supabase", "prisma"].includes(type)
					? "high"
					: "medium",
			});
	};
	if (
		/Idu-pi está organizado como core de supervisi[oó]n m[aá]s adaptadores/iu.test(
			content,
		)
	) {
		architecture.projectKind = "supervisor-runtime";
		architecture.frontend = "CLI/Telegram/Pi slash adapters";
		architecture.backend = "Core Idu-pi + MCP adapter";
		architecture.database = "SQLite local + reports JSON/JSONL";
		architecture.auth = "sin auth de producto";
		canonicalObjective =
			"Idu-pi es un supervisor/auditor normativo para el orquestador Pi: convierte intención humana, documentación, fuentes y evidencia del repositorio en Plan Maestro, contratos, riesgos, AgentLabs recomendados y checklist de ejecución segura.";
		frameworks.push("MCP", "Telegram adapter", "Pi slash commands");
		addCanonicalStore("sqlite");
		addCanonicalStore("json");
	}
	if (/Node\.js\s*\+\s*Express|backend[^\n]+Express/iu.test(content)) {
		architecture.backend = "Node/Express";
		frameworks.push("Express");
	}
	if (
		/frontend estático|HTML5|JavaScript vanilla|HTML\/CSS\/JS/iu.test(content)
	) {
		architecture.frontend = "HTML/CSS/JS vanilla";
		frameworks.push("Vanilla JS");
	}
	if (/PostgreSQL/iu.test(content)) addCanonicalStore("postgres");
	if (/Prisma ORM|Prisma/iu.test(content)) addCanonicalStore("prisma");
	if (/Supabase Storage|Supabase/iu.test(content)) {
		addCanonicalStore("supabase");
		frameworks.push("Supabase Storage");
	}
	if (/PostgreSQL[^\n]+Prisma|Prisma[^\n]+PostgreSQL/iu.test(content))
		architecture.database = "PostgreSQL + Prisma";
	else if (/PostgreSQL/iu.test(content)) architecture.database = "PostgreSQL";
	if (/JWT|jsonwebtoken/iu.test(content)) architecture.auth = "JWT";
	if (/Server-Sent Events|\bSSE\b/iu.test(content)) frameworks.push("SSE");
	const titleObjective = content
		.match(/Documentaci[oó]n t[eé]cnica\s*[—-]\s*([^\n]+)/iu)?.[1]
		?.trim();
	const boldObjective = content
		.match(/\*\*([^*]+)\*\*\s+es\s+una\s+plataforma/iu)?.[1]
		?.trim();
	return {
		path,
		...(canonicalObjective || titleObjective || boldObjective
			? { objective: canonicalObjective ?? titleObjective ?? boldObjective }
			: {}),
		architecture,
		dataStores,
		frameworks: unique(frameworks),
		securityModel:
			architecture.auth === "sin auth de producto"
				? {
						authDetected: false,
						sessionDetected: false,
						sensitiveFlows: [],
					}
				: /JWT|auth|login|autenticaci[oó]n/iu.test(content)
					? {
							authDetected: true,
							sessionDetected: /JWT|token|session|sesi[oó]n/iu.test(content),
							sensitiveFlows: ["Login/acceso"],
						}
					: undefined,
	};
}

function buildCanonicalClaims(
	signals: ProjectSignals,
	source: MasterPlanSource,
): MasterPlanClaim[] {
	const claims: MasterPlanClaim[] = [];
	if (signals.canonicalDocumentation) {
		claims.push({
			title: "Documento canónico principal",
			statement: `La fuente primaria del plan es ${signals.canonicalDocumentation.path}.`,
			source: "canonical_doc",
			status: "confirmed",
			confidence: 0.95,
			evidence: [signals.canonicalDocumentation.path],
		});
	}
	claims.push({
		title: "Arquitectura declarada",
		statement: `${signals.architecture.projectKind}; ${signals.architecture.frontend}; ${signals.architecture.backend}; ${signals.architecture.database}.`,
		source: signals.canonicalDocumentation
			? "canonical_doc"
			: "scanner_inferred",
		status: signals.canonicalDocumentation ? "confirmed" : "candidate",
		confidence: signals.canonicalDocumentation ? 0.9 : 0.55,
		evidence: signals.architecture.evidence.slice(0, 6),
	});
	if (source.flowsStatus === "project-local") {
		claims.push({
			title: "Flujos de proyecto declarados",
			statement:
				"Existe config/project-flows.json y debe usarse como plano vivo de flujos junto al artefacto permanente de flujos.",
			source: "project_config",
			status: "confirmed",
			confidence: 0.85,
			evidence: ["config/project-flows.json"],
		});
	}
	return claims;
}

function buildObservedReality(
	signals: ProjectSignals,
): MasterPlanRealityObservation[] {
	return [
		{
			area: "Inventario de repositorio",
			statement: `${signals.fileCount} archivos, ${signals.directoryCount} carpetas, lenguajes ${signals.architecture.languages.join(", ") || "no detectados"}.`,
			status: "confirmed",
			confidence: 0.9,
			evidence: signals.sourceFiles.slice(0, 5),
		},
		{
			area: "Arquitectura observada",
			statement: `${signals.architecture.projectKind}; ${signals.architecture.backend}; persistencia ${signals.architecture.database}.`,
			status: signals.canonicalDocumentation ? "confirmed" : "candidate",
			confidence: signals.canonicalDocumentation ? 0.85 : 0.55,
			evidence: signals.architecture.evidence.slice(0, 6),
		},
		{
			area: "Persistencia observada",
			statement: signals.dataStoreCandidates.length
				? signals.dataStoreCandidates.map((store) => store.name).join(", ")
				: "No hay persistencia de producto confirmada por evidencia fuerte.",
			status: signals.dataStoreCandidates.length ? "confirmed" : "unknown",
			confidence: signals.dataStoreCandidates.length ? 0.8 : 0.6,
			evidence: signals.dataStoreCandidates
				.flatMap((store) => store.evidence)
				.slice(0, 6),
		},
	];
}

function buildDriftFindings(
	claims: MasterPlanClaim[],
	observed: MasterPlanRealityObservation[],
	source: MasterPlanSource,
): MasterPlanDriftFinding[] {
	const findings: MasterPlanDriftFinding[] = [];
	if (source.blueprintStatus !== "project-local") {
		findings.push({
			title: "Project Blueprint no confirmado como fuente local",
			declared: source.blueprintStatus,
			observed:
				"El Plan Maestro no debe tratar defaults como contrato aprobado.",
			severity: "medium",
			recommendation:
				"Confirmar o actualizar Project Core/Blueprint antes de usarlo como ley del proyecto.",
			evidence: ["config/project-blueprint.json"],
		});
	}
	const hasCanonical = claims.some((claim) => claim.source === "canonical_doc");
	if (!hasCanonical && observed.some((item) => item.status === "candidate")) {
		findings.push({
			title: "Plan basado en hipótesis de scanner",
			declared: "No hay documentación canónica fuerte.",
			observed:
				"La realidad observada existe, pero requiere validación humana o AgentLab.",
			severity: "high",
			recommendation:
				"Crear documentación técnica canónica o aprobar el Plan Maestro antes de gobernar cambios.",
			evidence: [],
		});
	}
	return findings;
}

function buildProjectFlows(signals: ProjectSignals): MasterPlanProjectFlow[] {
	if (signals.architecture.projectKind === "supervisor-runtime") {
		return [
			{
				name: "Flujo MCP advisory",
				category: "entrypoint",
				purpose:
					"Permitir que el orquestador consulte estado, contexto, riesgos y recomendaciones sin delegar autoridad operativa a Idu-pi.",
				entrypoints: [
					"idu_status",
					"idu_prepare",
					"idu_task_context",
					"idu_postflight",
				],
				modules: [
					"src/mcp-server.ts",
					"src/orchestrator-advisory.ts",
					"src/cli.ts",
				],
				outputs: [
					"JSON envelope MCP",
					"safeNotes",
					"recommendation",
					"evidence",
				],
				rules: [
					"MCP informa y recomienda",
					"El orquestador decide",
					"No commit/push",
				],
				source: "canonical_doc",
				evidence: ["docs/architecture.md", "docs/mcp-server.md"],
			},
			{
				name: "Flujo Plan Maestro",
				category: "governance",
				purpose:
					"Crear y revisar la fuente normativa que explica qué es el proyecto, cómo funciona y qué contratos gobiernan cambios futuros.",
				entrypoints: [
					"/idu",
					"idu_master_plan_create",
					"idu-master-plan-redraft",
				],
				modules: ["src/master-plan.ts", "src/cli.ts", "src/mcp-server.ts"],
				outputs: [
					"master-plan.json",
					"master-plan.md",
					"master-plan.flows.json",
				],
				rules: [
					"Separar docs declaradas de realidad construida",
					"No usar ruido del scanner como verdad",
				],
				source: "canonical_doc",
				evidence: ["docs/architecture.md", "src/master-plan.ts"],
			},
			{
				name: "Flujo AgentLab audit-only",
				category: "audit",
				purpose:
					"Ejecutar revisiones y pruebas de drift sin permitir que AgentLabs implementen código ni modifiquen el repo real.",
				entrypoints: [
					"idu_agentlab_request_create",
					"idu_agentlab_review_run",
					"idu_agentlab_review_status",
				],
				modules: [
					"src/agentlab-review-requests.ts",
					"src/agentlab-review-runner.ts",
				],
				outputs: [
					"agentlabs/requests/current.json",
					"agentlabs/runs/current.json",
				],
				rules: ["Audit-only", "No editar repo real", "No commit/push"],
				source: "canonical_doc",
				evidence: ["docs/architecture.md", "docs/mcp-server.md"],
			},
			{
				name: "Flujo Doc/cuaderno y skills",
				category: "skill",
				purpose:
					"Mantener memoria normativa del proyecto y proponer optimizaciones de skills adaptadas al contexto real.",
				entrypoints: [
					"/idu",
					"idu_supervisor_tick",
					"skill improvement proposals",
				],
				modules: [
					"src/master-plan.ts",
					"src/skill-improvement-proposals.ts",
					"src/skill-drafts.ts",
				],
				outputs: [
					"Doc/<project>",
					"skill-improvement-proposals",
					"skill-draft",
				],
				rules: [
					"Proponer antes de aplicar",
					"Optimizar skills al proyecto",
					"Mantener estado en stateRoot",
				],
				source: "canonical_doc",
				evidence: ["docs/architecture.md"],
			},
		];
	}
	return signals.flowCandidates.map((flow) => ({
		name: flow.name,
		category: "module" as const,
		purpose: `${flow.from} → ${flow.to}`,
		entrypoints: flow.triggers,
		modules: flow.modules,
		outputs: [flow.to],
		rules: [`Riesgo ${flow.riskLevel}`, `Tipo ${flow.type}`],
		source: "scanner_inferred" as const,
		evidence: flow.evidence,
	}));
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
	if (isRuntimeSupabaseEvidence(content))
		addDataStore(acc.dataStoreMap, "supabase", rel);
	if (isRuntimePostgresEvidence(rel, content))
		addDataStore(acc.dataStoreMap, "postgres", rel);
	if (isRuntimeSqliteEvidence(content))
		addDataStore(acc.dataStoreMap, "sqlite", rel);
	if (isRuntimeMysqlEvidence(content))
		addDataStore(acc.dataStoreMap, "mysql", rel);
	if (isRuntimeMongoEvidence(content))
		addDataStore(acc.dataStoreMap, "mongodb", rel);
	if (/\bindexedDB\s*\.\s*open\s*\(/u.test(content))
		addDataStore(acc.dataStoreMap, "indexedDB", rel);
	if (
		/\blocalStorage\s*\.\s*(getItem|setItem|removeItem|clear)\s*\(/u.test(
			content,
		)
	)
		addDataStore(acc.dataStoreMap, "localStorage", rel);
	if (/fetch\s*\(\s*["']\/api\//u.test(content))
		addDataStore(acc.dataStoreMap, "api", rel);
	if (isRuntimeReactEvidence(rel, content)) acc.frameworkSet.add("React");
	if (isRuntimeExpressEvidence(content)) acc.frameworkSet.add("Express");
	if (
		/createClient\(|@supabase\/supabase-js|\bsupabase\s*\.\s*(from|auth|storage|rpc|channel)\s*\(/iu.test(
			content,
		)
	)
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

function isRuntimeSupabaseEvidence(content: string): boolean {
	return /createClient\s*\(|@supabase\/supabase-js|\bsupabase\s*\.\s*(from|auth|storage|rpc|channel)\s*\(/iu.test(
		content,
	);
}

function isRuntimePostgresEvidence(rel: string, content: string): boolean {
	return (
		/\.sql$/iu.test(rel) ||
		/(?:from\s+["']pg["']|require\s*\(\s*["']pg["']\s*\)|\bnew\s+(?:Pool|Client)\s*\(|\bPOSTGRES(?:QL)?[_A-Z]*\b|\bDATABASE_URL\b)/u.test(
			content,
		)
	);
}

function isRuntimeSqliteEvidence(content: string): boolean {
	return /(?:from\s+["'](?:sqlite3?|better-sqlite3)["']|require\s*\(\s*["'](?:sqlite3?|better-sqlite3)["']\s*\)|\bsqlite3?\s*\.\s*(Database|open)\s*\(|\bnew\s+Database\s*\([^)]*(?:\.db|sqlite)?)/iu.test(
		content,
	);
}

function isRuntimeMysqlEvidence(content: string): boolean {
	return /(?:from\s+["']mysql2?["']|require\s*\(\s*["']mysql2?["']\s*\)|mysql2?\s*\.\s*(createPool|createConnection)\s*\(|\bMYSQL[_A-Z]*\b)/u.test(
		content,
	);
}

function isRuntimeMongoEvidence(content: string): boolean {
	return /(?:from\s+["'](?:mongodb|mongoose)["']|require\s*\(\s*["'](?:mongodb|mongoose)["']\s*\)|\bMongoClient\b|\bmongoose\s*\.\s*connect\s*\(|mongodb(?:\+srv)?:\/\/)/iu.test(
		content,
	);
}

function isRuntimeReactEvidence(rel: string, content: string): boolean {
	return (
		/\.[jt]sx$/iu.test(rel) ||
		/(?:from\s+["']react["']|require\s*\(\s*["']react["']\s*\)|React\.createElement)/u.test(
			content,
		)
	);
}

function isRuntimeExpressEvidence(content: string): boolean {
	return /(?:from\s+express\s+from\s+["']express["']|require\s*\(\s*["']express["']\s*\)|\bexpress\s*\(\s*\)|\bapp\s*\.\s*(get|post|put|patch|delete|use)\s*\()/u.test(
		content,
	);
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
			// F-Item3a: project-flows.json lives at Layout A (`.idu/config/`).
			// The previous version checked Layout B (`config/`), which is
			// empty after the migration performed by `loadProjectFlows`
			// above. Use Layout A — that matches where the canonical
			// file lives and where the loader writes.
			loadProjectFlows(projectPath);
			return existsSync(join(projectPath, ".idu", "config", "project-flows.json"))
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
	const flowNames = signals.flowCandidates.map((flow) =>
		flow.name.toLowerCase(),
	);
	if (
		signals.hasDb &&
		signals.hasAuth &&
		flowNames.some((name) => /ingesta|carga|reporte|visualización/u.test(name))
	) {
		return "Estabilizar, asegurar y optimizar la operación industrial: autenticación segura, ingesta confiable de datos y reporting operativo como fuente de verdad.";
	}
	if (signals.hasDb && signals.hasAuth)
		return "Asegurar y gobernar un sistema operativo con autenticación, datos persistentes y flujos críticos.";
	return `Entender y supervisar ${basename(projectPath)} sin aplicar cambios automáticos.`;
}

function buildExecutiveSummary(
	projectId: string,
	_autoDepth: MasterPlanAutoDepth,
	signals: ProjectSignals,
): string {
	if (signals.architecture.projectKind === "supervisor-runtime") {
		return `${projectId} es un supervisor/auditor para proyectos guiados por un orquestador Pi. Su función es leer documentación y realidad del repositorio, exponer contexto por MCP, mantener estado aislado, gobernar contratos, coordinar auditorías AgentLab audit-only y optimizar skills sin reemplazar la decisión del orquestador.`;
	}
	return `${projectId} es un proyecto que debe gobernarse por este Plan Maestro: el documento separa documentación declarada, realidad construida, arquitectura, contratos y flujos permanentes para que futuros cambios respeten sus lineamientos.`;
}

function buildProblemStatement(
	_source: MasterPlanSource,
	signals: ProjectSignals,
): string {
	const criticalFlows = signals.flowCandidates
		.filter((flow) => flow.riskLevel === "high")
		.map((flow) => flow.name.toLowerCase());
	if (signals.hasDb && signals.hasAuth && criticalFlows.length > 0) {
		return "El sistema concentra autenticación, persistencia y flujos operativos sensibles. La evidencia muestra exposición de sesión, dependencia de almacenamiento cliente y rutas de ingesta/reporting que requieren una arquitectura gobernada antes de delegar cambios a agentes.";
	}
	if (signals.hasDb || signals.hasAuth)
		return "El proyecto combina datos/autenticación y requiere guardrails explícitos antes de cambios funcionales.";
	return "Mantener alineación entre intención humana, estructura real y próximos cambios.";
}

function inferScope(signals: ProjectSignals): string[] {
	if (signals.architecture.projectKind === "supervisor-runtime") {
		return [
			"Supervisar proyectos desde MCP/CLI/Telegram/Pi slash sin convertirse en implementador por defecto.",
			"Mantener Plan Maestro, Doc/cuaderno, contratos, reportes y auditorías en stateRoot aislado.",
			"Comparar documentación declarada contra realidad construida antes de orientar al orquestador.",
			"Optimizar skills y reglas para el proyecto mediante propuestas revisables, no cambios automáticos.",
		];
	}
	return unique([
		"Definir qué es el proyecto y qué alcance debe respetar.",
		"Registrar arquitectura, stack, persistencia, seguridad y flujos permanentes.",
		"Separar documentación declarada de realidad construida y drift.",
		...(signals.hasDb ? ["Gobernar datos/schema como área sensible."] : []),
		...(signals.hasAuth
			? ["Gobernar auth/login/security como área sensible."]
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
	_autoDepth: MasterPlanAutoDepth,
	_source: MasterPlanSource,
	signals: ProjectSignals,
): string[] {
	return unique([
		...(signals.hasDb && signals.hasAuth
			? [
					"Datos persistentes y auth/login conviven; cambios en permisos, sesiones o persistencia pueden exponer información sensible.",
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

function writeSupervisorProjectIndex(
	stateRoot: string,
	plan: MasterPlan,
	signals?: ProjectSignals,
): void {
	const fileTypes = new Map<string, number>();
	for (const file of signals?.sourceFiles ?? plan.sourceFiles) {
		const extension = extname(file).toLowerCase() || "[no-extension]";
		fileTypes.set(extension, (fileTypes.get(extension) ?? 0) + 1);
	}
	const previousRevision = readSupervisorProjectIndexRevision(stateRoot);
	const index = {
		version: 1,
		projectId: plan.projectId,
		projectPath: plan.projectPath,
		stateRoot,
		masterPlanJson: MASTER_PLAN_JSON_FILE,
		masterPlanMd: MASTER_PLAN_MD_FILE,
		status: plan.status,
		revision: previousRevision + 1,
		updatedAt: new Date().toISOString(),
		gitHead: plan.gitHead,
		fileCount: signals?.fileCount ?? plan.sourceFiles.length,
		directoryCount: signals?.directoryCount ?? 0,
		fileTypes: Object.fromEntries([...fileTypes.entries()].sort()),
		functionalAreas: {
			architecture: plan.architecture.evidence.slice(0, 20),
			dataStores: plan.dataStores.map((store) => store.name),
			security: plan.securityModel.evidence.slice(0, 20),
			flows: plan.detectedFlows.map((flow) => flow.name),
			modules: plan.detectedModules.slice(0, 50),
		},
		ignoredNoise: plan.ignoredTooling,
		toolingDetected: plan.toolingDetected,
	};
	writeFileSync(
		join(stateRoot, PROJECT_INDEX_FILE),
		`${JSON.stringify(index, null, 2)}\n`,
		"utf8",
	);
}

function readSupervisorProjectIndexRevision(stateRoot: string): number {
	try {
		const path = join(stateRoot, PROJECT_INDEX_FILE);
		if (!existsSync(path)) return 0;
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			revision?: unknown;
		};
		return typeof parsed.revision === "number" &&
			Number.isFinite(parsed.revision)
			? parsed.revision
			: 0;
	} catch {
		return 0;
	}
}

function deepSafetyForAutoDepth(
	autoDepth: MasterPlanAutoDepth,
): Pick<
	MasterPlan,
	| "deepStage"
	| "deepReviewRecommended"
	| "deepReviewRequiresApproval"
	| "safeActionsPerformed"
> {
	const baseActions = [
		"Analicé estructura y señales principales.",
		"Generé Plan Maestro preliminar.",
		"Guardé resumen optimizado.",
	];
	if (autoDepth.mode !== "deep_required") {
		return {
			deepStage: "safe_scan_done",
			deepReviewRecommended: false,
			deepReviewRequiresApproval: false,
			safeActionsPerformed: baseActions,
		};
	}
	return {
		deepStage: "lab_requests_prepared",
		deepReviewRecommended: true,
		deepReviewRequiresApproval: true,
		safeActionsPerformed: [
			"Analicé estructura y señales principales.",
			"Generé Plan Maestro preliminar.",
			"Preparé recomendaciones para revisión profunda.",
			"Guardé todo en reports sin modificar el repo.",
		],
	};
}

export function loadExternalProjectMemory(input: {
	projectId: string;
	projectPath?: string;
	stateRoot: string;
	provider?: MasterPlanMemoryProvider;
}): MasterPlanMemoryContext {
	if (input.provider) {
		try {
			return limitMemoryContext(
				input.provider.load({
					projectId: input.projectId,
					projectPath: input.projectPath,
					stateRoot: input.stateRoot,
				}),
			);
		} catch {
			const local = readLocalMemoryContext(input.stateRoot);
			return local.status === "available"
				? local
				: errorMemoryContext(input.provider.provider);
		}
	}
	return readLocalMemoryContext(input.stateRoot);
}

function readLocalMemoryContext(stateRoot: string): MasterPlanMemoryContext {
	try {
		const path = join(stateRoot, MEMORY_FILE);
		if (!existsSync(path)) return unavailableMemoryContext();
		const memory = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<MasterPlanMemory>;
		return limitMemoryContext({
			provider: "local",
			status: "available",
			summary: memory.objectiveSummary ?? "Memoria local disponible.",
			evidence: [
				...(memory.topRisks ?? []).map((risk) => `risk:${risk}`),
				...(memory.currentPlanJson ? [`plan:${memory.currentPlanJson}`] : []),
			],
		});
	} catch {
		return {
			provider: "local",
			status: "error",
			summary: "No pude leer memoria local.",
			evidence: [],
		};
	}
}

function limitMemoryContext(
	context: MasterPlanMemoryContext,
): MasterPlanMemoryContext {
	return {
		provider: context.provider,
		status: context.status,
		summary: context.summary.slice(0, 500),
		evidence: context.evidence.slice(0, 8).map((item) => item.slice(0, 240)),
	};
}

function unavailableMemoryContext(): MasterPlanMemoryContext {
	return {
		provider: "none",
		status: "unavailable",
		summary: "Memoria externa no disponible; usé sólo señales locales.",
		evidence: [],
	};
}

function errorMemoryContext(
	provider: "engram" | "local",
): MasterPlanMemoryContext {
	return {
		provider,
		status: "error",
		summary:
			"Memoria externa falló; Plan Maestro continúa con señales locales.",
		evidence: [],
	};
}

function pendingActionPath(stateRoot: string): string {
	return join(stateRoot, PENDING_ACTION_FILE);
}

function writeMasterPlanPendingAction(
	stateRoot: string,
	current: Pick<MasterPlanCurrent, "currentPlanJson" | "status" | "updatedAt">,
): MasterPlanPendingAction | undefined {
	if (current.status !== "draft") {
		clearMasterPlanPendingAction(stateRoot);
		return undefined;
	}
	const action: MasterPlanPendingAction = {
		type: "approve_master_plan",
		planPath: current.currentPlanJson,
		planStatus: current.status,
		createdAt: current.updatedAt,
		acceptedInputs: [
			"ok",
			"dale",
			"sí",
			"si",
			"confirmo",
			"aprueba",
			"aprobar",
			"realizar plan",
			"ejecutar plan",
			"continuar",
		],
		rejectedInputs: [
			"no",
			"desaprobar",
			"no aprobar",
			"rechaza",
			"rechazar",
			"cancelar",
			"rehacer",
			"redraft",
		],
	};
	writeFileSync(
		pendingActionPath(stateRoot),
		`${JSON.stringify(action, null, 2)}\n`,
		"utf8",
	);
	return action;
}

export function readMasterPlanPendingAction(
	stateRoot: string,
): MasterPlanPendingAction | undefined {
	try {
		const path = pendingActionPath(stateRoot);
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as MasterPlanPendingAction;
	} catch {
		return undefined;
	}
}

function clearMasterPlanPendingAction(stateRoot: string): void {
	rmSync(pendingActionPath(stateRoot), { force: true });
}

function classifyMasterPlanNaturalDecision(
	text: string,
	pending: MasterPlanPendingAction,
): "approve" | "reject" | "redraft" | "interactive" | undefined {
	const normalized = normalizeNaturalDecisionText(text);
	if (!normalized) return undefined;
	const tokens = normalized.split(" ").filter(Boolean);
	const accepted = new Set(
		pending.acceptedInputs.map(normalizeNaturalDecisionText),
	);
	const rejected = new Set(
		pending.rejectedInputs.map(normalizeNaturalDecisionText),
	);
	if (accepted.has(normalized)) return "approve";
	if (
		tokens.length <= 3 &&
		tokens.length > 0 &&
		tokens.every((token) => accepted.has(token))
	)
		return "approve";
	if (
		["hagamoslo interactivo", "modo interactivo", "interactivo"].includes(
			normalized,
		)
	)
		return "interactive";
	if (
		[
			"rehacer",
			"redraft",
			"reevaluar",
			"reevaluar en profundidad",
			"realizar en profundidad",
			"analisis profundo",
		].includes(normalized)
	)
		return "redraft";
	if (rejected.has(normalized)) return "reject";
	return undefined;
}

function normalizeNaturalDecisionText(text: string): string {
	return text
		.toLocaleLowerCase("es")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^\p{L}\p{N} ]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
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
		path = safePlanPath(stateRoot, current.currentPlanJson);
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
		if (current) return safePlanPath(stateRoot, current.currentPlanJson);
		const canonical = join(resolve(stateRoot), MASTER_PLAN_JSON_FILE);
		if (existsSync(canonical)) return canonical;
		throw new Error("No existe master-plan.current.json");
	}
	return safePlanPath(stateRoot, pathOrLatest);
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

function safePlanPath(stateRoot: string, path: string): string {
	const resolved = safePathInsideState(stateRoot, path);
	const relativePath = relative(resolve(stateRoot), resolved).replace(
		/\\/gu,
		"/",
	);
	if (
		relativePath === MASTER_PLAN_JSON_FILE ||
		(relativePath.startsWith("reports/") && relativePath.endsWith(".json"))
	) {
		return resolved;
	}
	throw new Error(
		"Master Plan fuera de stateRoot/master-plan.json o stateRoot/reports",
	);
}

function readPlanRaw(path: string): Partial<MasterPlan> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as Partial<MasterPlan>;
	} catch {
		return undefined;
	}
}

export function readPlan(path: string): MasterPlan | undefined {
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
		"operationalContracts",
		"contractViolations",
		"workMilestones",
		"agentLabReviews",
		"toolingDetected",
		"ignoredTooling",
	] as const) {
		if (!Array.isArray(plan[key])) return `${key} faltante`;
	}
	if (!isMasterPlanStatus(plan.status)) return "status inválido";
	if (!isCompatibleAutoDepth(plan.autoDepth)) return "autoDepth incompleto";
	if (!isCompatibleDeepSafety(plan)) return "deep safety incompleto";
	if (!isCompatibleMemoryContext(plan.memoryContext))
		return "memoryContext incompleto";
	if (!isCompatibleSource(plan.source)) return "source incompleto";
	if (!isCompatibleArchitecture(plan.architecture))
		return "architecture incompleta";
	if (!Array.isArray(plan.dataStores)) return "dataStores faltante";
	if (!plan.dataStores.every(isCompatibleDataStore))
		return "dataStores sin estructura completa";
	if (!isCompatibleSecurityModel(plan.securityModel))
		return "securityModel incompleto";
	if (!isCompatibleDocNotebook(plan.docNotebook))
		return "docNotebook incompleto";
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

function isCompatibleDeepSafety(plan: Partial<MasterPlan>): boolean {
	return Boolean(
		[
			"none",
			"safe_scan_done",
			"lab_requests_prepared",
			"lab_review_done",
			"deep_approval_required",
		].includes(String(plan.deepStage)) &&
			typeof plan.deepReviewRecommended === "boolean" &&
			typeof plan.deepReviewRequiresApproval === "boolean" &&
			Array.isArray(plan.safeActionsPerformed),
	);
}

function isCompatibleMemoryContext(
	memoryContext: Partial<MasterPlanMemoryContext> | undefined,
): memoryContext is MasterPlanMemoryContext {
	return Boolean(
		memoryContext &&
			["engram", "local", "none"].includes(String(memoryContext.provider)) &&
			["available", "unavailable", "skipped", "error"].includes(
				String(memoryContext.status),
			) &&
			typeof memoryContext.summary === "string" &&
			Array.isArray(memoryContext.evidence),
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

function isCompatibleDocNotebook(
	docNotebook: Partial<MasterPlanDocNotebook> | undefined,
): docNotebook is MasterPlanDocNotebook {
	return Boolean(
		docNotebook &&
			hasText(docNotebook.root) &&
			["created", "loaded", "empty"].includes(String(docNotebook.status)) &&
			Array.isArray(docNotebook.sources) &&
			typeof docNotebook.summary === "string",
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
		deepStage: raw.deepStage ?? "none",
		deepReviewRecommended: raw.deepReviewRecommended ?? false,
		deepReviewRequiresApproval: raw.deepReviewRequiresApproval ?? false,
		safeActionsPerformed: raw.safeActionsPerformed ?? [],
		memoryContext: raw.memoryContext ?? unavailableMemoryContext(),
		detectedModules: raw.detectedModules ?? [],
		detectedFlows: normalizePlanFlows(
			raw.detectedFlows,
			raw.detectedModules ?? [],
			dataStores,
		),
		projectFlows: raw.projectFlows ?? [],
		flowArtifact: raw.flowArtifact ?? "master-plan.flows.json",
		canonicalClaims: normalizePlanClaims(raw.canonicalClaims),
		observedReality: raw.observedReality ?? [],
		driftFindings: raw.driftFindings ?? [],
		dataStores,
		architecture,
		securityModel,
		docNotebook:
			raw.docNotebook ??
			emptyDocNotebook(raw.projectPath ?? "", raw.projectId ?? "unknown"),
		operationalContracts: raw.operationalContracts ?? [],
		contractViolations: raw.contractViolations ?? [],
		workMilestones: raw.workMilestones ?? [],
		toolingDetected: raw.toolingDetected ?? [],
		ignoredTooling: raw.ignoredTooling ?? [],
		sourceFiles: raw.sourceFiles ?? [],
		agentLabReviews: raw.agentLabReviews ?? [],
	};
}

function normalizePlanClaims(
	claims: MasterPlan["canonicalClaims"] | undefined,
): MasterPlanClaim[] {
	if (!Array.isArray(claims)) return [];
	return claims.map((claim) => ({
		...claim,
		source: claim.source === "human_approved" ? "user_approved" : claim.source,
	}));
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
