export type AgentLabSpecialty =
	| "security"
	| "database"
	| "architecture"
	| "code_quality"
	| "ui_ux"
	| "performance"
	| "skill_review"
	| "project_understanding"
	| "docs"
	| "token_cost"
	| "librarian"
	| "general";

export type SupervisorControlPillar =
	| "quality"
	| "time"
	| "token_cost"
	| "safety"
	| "reporting"
	| "resources"
	| "architecture_consistency"
	| "learning";

export type AgentLabReviewTrigger =
	| "preflight"
	| "postflight"
	| "semantic_audit"
	| "skill_draft"
	| "master_plan"
	| "project_core_review"
	| "constitution_gate"
	| "recurring_bug"
	| "external_source_intelligence"
	| "manual";

export type AgentLabExternalSourceKind =
	| "official_docs"
	| "changelog"
	| "advisory"
	| "cve_nvd"
	| "github_advisory"
	| "npm_advisory"
	| "community_signal";

export type AgentLabExternalSourceIntelligence = {
	status: "requested" | "queued" | "running" | "reported" | "reviewed" | "deferred" | "rejected";
	allowedSourceKinds: AgentLabExternalSourceKind[];
	freshness: string;
	queries: string[];
	relatedContracts: string[];
	contractPromotionAllowed: false;
};

export type AgentLabReviewRequest = {
	id: string;
	projectId: string;
	projectPath: string;
	requestedBy: "supervisor";
	specialty: AgentLabSpecialty;
	trigger: AgentLabReviewTrigger;
	objective: string;
	contextSummary: string;
	evidence: string[];
	filesToInspect: string[];
	flowsToCheck: string[];
	rulesToCheck: string[];
	projectCoreSummary?: string;
	constitutionSummary?: string;
	sourceSkillDraftPath?: string;
	externalSourceIntelligence?: AgentLabExternalSourceIntelligence;
	constraints: string[];
	allowedActions: string[];
	forbiddenActions: string[];
	maxCommands: number;
	maxMinutes: number;
	tokenBudgetHint: string;
	expectedOutputs: string[];
	requiresHumanApproval: boolean;
	createdAt: string;
};

export type AgentLabReviewStatus = "completed" | "skipped" | "failed";
export type AgentLabFindingSeverity =
	| "info"
	| "low"
	| "medium"
	| "high"
	| "critical";
export type AgentLabConfidence = "low" | "medium" | "high";
export type AgentLabRecommendationBenefit =
	| "quality"
	| "time"
	| "token_cost"
	| "safety"
	| "architecture_consistency"
	| "learning";

export type AgentLabFinding = {
	title: string;
	description: string;
	evidence: string;
	severity: AgentLabFindingSeverity;
	confidence: AgentLabConfidence;
	category: string;
	affectedFiles: string[];
	affectedFlows: string[];
	relatedRules: string[];
	controlPillars: SupervisorControlPillar[];
};

export type AgentLabRecommendation = {
	title: string;
	description: string;
	rationale: string;
	expectedBenefit: AgentLabRecommendationBenefit;
	risk: string;
	requiresHumanApproval: boolean;
	suggestedNextStep: string;
};

export type AgentLabReviewReport = {
	id: string;
	requestId: string;
	projectId: string;
	specialty: AgentLabSpecialty;
	status: AgentLabReviewStatus;
	summary: string;
	qualityFindings: AgentLabFinding[];
	safetyFindings: AgentLabFinding[];
	architectureFindings: AgentLabFinding[];
	tokenCostFindings: AgentLabFinding[];
	timeFindings: AgentLabFinding[];
	resourceFindings: AgentLabFinding[];
	testsSuggested: string[];
	testsExecuted: string[];
	evidence: string[];
	recommendations: AgentLabRecommendation[];
	proposedSupervisorActions: string[];
	suggestedSkillUpdates: string[];
	suggestedRuleUpdates: string[];
	suggestedAgentTasks: string[];
	confidence: AgentLabConfidence;
	requiresHumanApproval: boolean;
	createdAt: string;
};

export type AgentLabReviewRequestValidationResult =
	| { ok: true; request: AgentLabReviewRequest; errors: [] }
	| { ok: false; errors: string[] };

export type AgentLabReviewReportValidationResult =
	| { ok: true; report: AgentLabReviewReport; errors: [] }
	| { ok: false; errors: string[] };

export type AgentLabSupervisorContractValidationResult =
	| {
			ok: true;
			report: AgentLabReviewReport;
			request: AgentLabReviewRequest;
			errors: [];
	  }
	| { ok: false; errors: string[] };

export type BuildAgentLabReviewRequestInput = {
	id?: string;
	projectId: string;
	projectPath: string;
	specialty: AgentLabSpecialty;
	trigger: AgentLabReviewTrigger;
	objective: string;
	contextSummary: string;
	evidence?: string[];
	filesToInspect?: string[];
	flowsToCheck?: string[];
	rulesToCheck?: string[];
	projectCoreSummary?: string;
	constitutionSummary?: string;
	sourceSkillDraftPath?: string;
	externalSourceIntelligence?: AgentLabExternalSourceIntelligence;
	constraints?: string[];
	allowedActions?: string[];
	forbiddenActions?: string[];
	maxCommands?: number;
	maxMinutes?: number;
	tokenBudgetHint?: string;
	expectedOutputs?: string[];
	requiresHumanApproval?: boolean;
	createdAt?: string;
};

export type AgentLabSpecialtyMappingInput = {
	text?: string;
	affectedAreas?: string[];
	changedFiles?: string[];
	warnings?: string[];
	rules?: string[];
};

const SPECIALTIES = new Set<AgentLabSpecialty>([
	"security",
	"database",
	"architecture",
	"code_quality",
	"ui_ux",
	"performance",
	"skill_review",
	"project_understanding",
	"docs",
	"token_cost",
	"librarian",
	"general",
]);
const PILLARS = new Set<SupervisorControlPillar>([
	"quality",
	"time",
	"token_cost",
	"safety",
	"reporting",
	"resources",
	"architecture_consistency",
	"learning",
]);
const TRIGGERS = new Set<AgentLabReviewTrigger>([
	"preflight",
	"postflight",
	"semantic_audit",
	"skill_draft",
	"master_plan",
	"project_core_review",
	"constitution_gate",
	"recurring_bug",
	"external_source_intelligence",
	"manual",
]);
const STATUSES = new Set<AgentLabReviewStatus>([
	"completed",
	"skipped",
	"failed",
]);
const SEVERITIES = new Set<AgentLabFindingSeverity>([
	"info",
	"low",
	"medium",
	"high",
	"critical",
]);
const CONFIDENCES = new Set<AgentLabConfidence>(["low", "medium", "high"]);
const SOURCE_KINDS = new Set<AgentLabExternalSourceKind>([
	"official_docs",
	"changelog",
	"advisory",
	"cve_nvd",
	"github_advisory",
	"npm_advisory",
	"community_signal",
]);
const SOURCE_STATUSES = new Set<AgentLabExternalSourceIntelligence["status"]>([
	"requested",
	"queued",
	"running",
	"reported",
	"reviewed",
	"deferred",
	"rejected",
]);

const BENEFITS = new Set<AgentLabRecommendationBenefit>([
	"quality",
	"time",
	"token_cost",
	"safety",
	"architecture_consistency",
	"learning",
]);

const MANDATORY_FORBIDDEN_ACTIONS = [
	"no modificar repo real",
	"no escribir en repo real",
	"no commit",
	"no push",
	"no merge",
	"no rebase",
	"no aplicar cambios",
	"no auto-ejecutar AgentLabs",
	"no auto-aprobar recomendaciones",
	"no promover contratos",
	"no modificar Project Core",
	"no modificar Constitution",
	"no modificar flows",
	"no modificar skills reales",
	"no crear workers ni workspaces en stateRoot",
	"no borrar datos",
	"no exponer secretos",
];

const UNSAFE_AGENTLAB_ACTION_PATTERN =
	/\b(?:commit|push|merge|rebase)\b|git\s+(?:commit|push|merge|rebase)|\bforce\s+push\b|\b(?:apply|edit|delete|promote|approve)\b|(?:write|modify)\s+(?:to\s+)?(?:the\s+)?real\s+repo|create\s+workers?\s+in\s+stateroot|create\s+workspaces?\s+in\s+stateroot|aplicar\s+(?:cambios|contratos?|skills?|reglas)|aprobar|auto[-\s]?aprobar|promover|editar\s+c[oó]digo|modificar\s+repo\s+real|escribir\s+en\s+repo\s+real|crear\s+workers?\s+en\s+stateroot|crear\s+workspaces?\s+en\s+stateroot|borrar|eliminar/iu;

export function buildAgentLabReviewRequest(
	input: BuildAgentLabReviewRequestInput,
): AgentLabReviewRequest {
	const forbiddenActions = dedupe([
		...(input.forbiddenActions ?? []),
		...MANDATORY_FORBIDDEN_ACTIONS,
	]);
	const allowedActions = sanitizeAllowedActions(
		input.allowedActions ?? defaultAllowedActions(input.specialty),
		input.specialty,
	);
	return {
		id: input.id ?? `agentlab-review-${compactTimestamp(new Date())}`,
		projectId: input.projectId,
		projectPath: input.projectPath,
		requestedBy: "supervisor",
		specialty: input.specialty,
		trigger: input.trigger,
		objective: input.objective,
		contextSummary: input.contextSummary,
		evidence: cleanArray(input.evidence ?? []),
		filesToInspect: cleanArray(input.filesToInspect ?? []),
		flowsToCheck: cleanArray(input.flowsToCheck ?? []),
		rulesToCheck: cleanArray(input.rulesToCheck ?? []),
		...(input.projectCoreSummary
			? { projectCoreSummary: input.projectCoreSummary.trim() }
			: {}),
		...(input.constitutionSummary
			? { constitutionSummary: input.constitutionSummary.trim() }
			: {}),
		...(input.sourceSkillDraftPath
			? { sourceSkillDraftPath: input.sourceSkillDraftPath.trim() }
			: {}),
		...(input.externalSourceIntelligence
			? { externalSourceIntelligence: input.externalSourceIntelligence }
			: {}),
		constraints: dedupe([
			...(input.constraints ?? []),
			"AgentLab inspecciona y reporta; Idu-pi consolida; humano decide.",
		]),
		allowedActions,
		forbiddenActions,
		maxCommands: input.maxCommands ?? 5,
		maxMinutes: input.maxMinutes ?? 15,
		tokenBudgetHint: input.tokenBudgetHint ?? "bounded",
		expectedOutputs: dedupe([
			...(input.expectedOutputs ?? []),
			"evidence-backed findings",
			"tests suggested/executed",
			"recommendations with human approval flag",
		]),
		requiresHumanApproval: true,
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
}

export function validateAgentLabReviewRequest(
	value: unknown,
): AgentLabReviewRequestValidationResult {
	const errors: string[] = [];
	const request = asRecord(value);
	if (!request) return { ok: false, errors: ["request must be an object"] };

	const id = requiredString(request.id, "id", errors);
	const projectId = requiredString(request.projectId, "projectId", errors);
	const projectPath = requiredString(
		request.projectPath,
		"projectPath",
		errors,
	);
	const requestedBy = requiredString(
		request.requestedBy,
		"requestedBy",
		errors,
	);
	if (requestedBy && requestedBy !== "supervisor") {
		errors.push("requestedBy must be supervisor");
	}
	const specialty = enumValue(
		request.specialty,
		"specialty",
		SPECIALTIES,
		errors,
	);
	const trigger = enumValue(request.trigger, "trigger", TRIGGERS, errors);
	const objective = requiredString(request.objective, "objective", errors);
	const contextSummary = requiredString(
		request.contextSummary,
		"contextSummary",
		errors,
	);
	const evidence = stringArray(request.evidence, "evidence", errors);
	const filesToInspect = stringArray(
		request.filesToInspect,
		"filesToInspect",
		errors,
	);
	const flowsToCheck = stringArray(
		request.flowsToCheck,
		"flowsToCheck",
		errors,
	);
	const rulesToCheck = stringArray(
		request.rulesToCheck,
		"rulesToCheck",
		errors,
	);
	const projectCoreSummary = optionalString(
		request.projectCoreSummary,
		"projectCoreSummary",
		errors,
	);
	const constitutionSummary = optionalString(
		request.constitutionSummary,
		"constitutionSummary",
		errors,
	);
	const sourceSkillDraftPath = optionalString(
		request.sourceSkillDraftPath,
		"sourceSkillDraftPath",
		errors,
	);
	const externalSourceIntelligence = optionalExternalSourceIntelligence(
		request.externalSourceIntelligence,
		errors,
	);
	const constraints = stringArray(request.constraints, "constraints", errors);
	const allowedActions = stringArray(
		request.allowedActions,
		"allowedActions",
		errors,
	);
	const forbiddenActions = stringArray(
		request.forbiddenActions,
		"forbiddenActions",
		errors,
	);
	const maxCommands = positiveNumber(
		request.maxCommands,
		"maxCommands",
		errors,
	);
	const maxMinutes = positiveNumber(request.maxMinutes, "maxMinutes", errors);
	const tokenBudgetHint = requiredString(
		request.tokenBudgetHint,
		"tokenBudgetHint",
		errors,
	);
	const expectedOutputs = stringArray(
		request.expectedOutputs,
		"expectedOutputs",
		errors,
	);
	const requiresHumanApproval = booleanValue(
		request.requiresHumanApproval,
		"requiresHumanApproval",
		errors,
	);
	const createdAt = requiredString(request.createdAt, "createdAt", errors);

	if (forbiddenActions) validateForbiddenActions(forbiddenActions, errors);
	if (allowedActions) {
		validateAuditOnlyTextArray(allowedActions, "allowedActions", errors);
	}
	if (specialty === "librarian" || trigger === "external_source_intelligence") {
		if (!externalSourceIntelligence) {
			errors.push("librarian requests require externalSourceIntelligence");
		}
		if (externalSourceIntelligence?.contractPromotionAllowed !== false) {
			errors.push("external source intelligence must not auto-promote contracts");
		}
		if (
			allowedActions?.some((action) =>
				/apply\s+contract|aplicar\s+contrato|edit\s+code|commit|push/iu.test(
					action,
				),
			)
		) {
			errors.push("librarian allowedActions must stay audit-only");
		}
	}
	if (specialty === "skill_review") {
		if (allowedActions?.some((action) => /aplicar\s+skills/iu.test(action))) {
			errors.push("skill_review allowedActions must not apply skills");
		}
		if (
			!forbiddenActions?.some((action) =>
				/modificar\s+skills\s+reales/u.test(action),
			)
		) {
			errors.push("skill_review must forbid modifying real skills");
		}
	}
	if (requiresHumanApproval === false) {
		errors.push("AgentLab requests require human approval");
	}

	if (
		errors.length > 0 ||
		!id ||
		!projectId ||
		!projectPath ||
		!specialty ||
		!trigger ||
		!objective ||
		!contextSummary ||
		!evidence ||
		!filesToInspect ||
		!flowsToCheck ||
		!rulesToCheck ||
		!constraints ||
		(externalSourceIntelligence === undefined &&
			(request.externalSourceIntelligence !== undefined ||
				specialty === "librarian" ||
				trigger === "external_source_intelligence")) ||
		!allowedActions ||
		!forbiddenActions ||
		maxCommands === undefined ||
		maxMinutes === undefined ||
		!tokenBudgetHint ||
		!expectedOutputs ||
		requiresHumanApproval === undefined ||
		!createdAt
	) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		errors: [],
		request: {
			id,
			projectId,
			projectPath,
			requestedBy: "supervisor",
			specialty,
			trigger,
			objective,
			contextSummary,
			evidence,
			filesToInspect,
			flowsToCheck,
			rulesToCheck,
			...(projectCoreSummary ? { projectCoreSummary } : {}),
			...(constitutionSummary ? { constitutionSummary } : {}),
			...(sourceSkillDraftPath ? { sourceSkillDraftPath } : {}),
			...(externalSourceIntelligence ? { externalSourceIntelligence } : {}),
			constraints,
			allowedActions,
			forbiddenActions,
			maxCommands,
			maxMinutes,
			tokenBudgetHint,
			expectedOutputs,
			requiresHumanApproval,
			createdAt,
		},
	};
}

export function validateAgentLabReviewReport(
	value: unknown,
): AgentLabReviewReportValidationResult {
	const errors: string[] = [];
	const report = asRecord(value);
	if (!report) return { ok: false, errors: ["report must be an object"] };

	const id = requiredString(report.id, "id", errors);
	const requestId = requiredString(report.requestId, "requestId", errors);
	const projectId = requiredString(report.projectId, "projectId", errors);
	const specialty = enumValue(
		report.specialty,
		"specialty",
		SPECIALTIES,
		errors,
	);
	const status = enumValue(report.status, "status", STATUSES, errors);
	const summary = requiredString(report.summary, "summary", errors);
	const qualityFindings = findingsArray(
		report.qualityFindings,
		"qualityFindings",
		errors,
	);
	const safetyFindings = findingsArray(
		report.safetyFindings,
		"safetyFindings",
		errors,
	);
	const architectureFindings = findingsArray(
		report.architectureFindings,
		"architectureFindings",
		errors,
	);
	const tokenCostFindings = findingsArray(
		report.tokenCostFindings,
		"tokenCostFindings",
		errors,
	);
	const timeFindings = findingsArray(
		report.timeFindings,
		"timeFindings",
		errors,
	);
	const resourceFindings = findingsArray(
		report.resourceFindings,
		"resourceFindings",
		errors,
	);
	const testsSuggested = stringArray(
		report.testsSuggested,
		"testsSuggested",
		errors,
	);
	const testsExecuted = stringArray(
		report.testsExecuted,
		"testsExecuted",
		errors,
	);
	const evidence = stringArray(report.evidence, "evidence", errors);
	const recommendations = recommendationsArray(
		report.recommendations,
		"recommendations",
		errors,
	);
	const proposedSupervisorActions = stringArray(
		report.proposedSupervisorActions,
		"proposedSupervisorActions",
		errors,
	);
	const suggestedSkillUpdates = stringArray(
		report.suggestedSkillUpdates,
		"suggestedSkillUpdates",
		errors,
	);
	const suggestedRuleUpdates = stringArray(
		report.suggestedRuleUpdates,
		"suggestedRuleUpdates",
		errors,
	);
	const suggestedAgentTasks = stringArray(
		report.suggestedAgentTasks,
		"suggestedAgentTasks",
		errors,
	);
	const confidence = enumValue(
		report.confidence,
		"confidence",
		CONFIDENCES,
		errors,
	);
	const requiresHumanApproval = booleanValue(
		report.requiresHumanApproval,
		"requiresHumanApproval",
		errors,
	);
	const createdAt = requiredString(report.createdAt, "createdAt", errors);

	if (summary === undefined || summary.length === 0) {
		errors.push("summary is required for completed reports");
	}
	if (evidence && status === "completed" && evidence.length === 0) {
		errors.push("evidence is required for completed reports");
	}
	if (requiresHumanApproval === false) {
		errors.push("AgentLab reports require requiresHumanApproval true");
	}
	if (testsExecuted) {
		validateAuditOnlyTextArray(testsExecuted, "testsExecuted", errors);
	}
	if (proposedSupervisorActions) {
		validateAuditOnlyTextArray(
			proposedSupervisorActions,
			"proposedSupervisorActions",
			errors,
		);
	}
	if (suggestedSkillUpdates) {
		validateAuditOnlyTextArray(
			suggestedSkillUpdates,
			"suggestedSkillUpdates",
			errors,
		);
	}
	if (suggestedRuleUpdates) {
		validateAuditOnlyTextArray(
			suggestedRuleUpdates,
			"suggestedRuleUpdates",
			errors,
		);
	}
	if (suggestedAgentTasks) {
		validateAuditOnlyTextArray(
			suggestedAgentTasks,
			"suggestedAgentTasks",
			errors,
		);
	}
	const allFindings = [
		...(qualityFindings ?? []),
		...(safetyFindings ?? []),
		...(architectureFindings ?? []),
		...(tokenCostFindings ?? []),
		...(timeFindings ?? []),
		...(resourceFindings ?? []),
	];
	if (
		allFindings.some(
			(finding) =>
				finding.severity === "high" || finding.severity === "critical",
		) &&
		requiresHumanApproval === false
	) {
		errors.push(
			"requiresHumanApproval must be true for high/critical findings",
		);
	}

	if (
		errors.length > 0 ||
		!id ||
		!requestId ||
		!projectId ||
		!specialty ||
		!status ||
		!summary ||
		!qualityFindings ||
		!safetyFindings ||
		!architectureFindings ||
		!tokenCostFindings ||
		!timeFindings ||
		!resourceFindings ||
		!testsSuggested ||
		!testsExecuted ||
		!evidence ||
		!recommendations ||
		!proposedSupervisorActions ||
		!suggestedSkillUpdates ||
		!suggestedRuleUpdates ||
		!suggestedAgentTasks ||
		!confidence ||
		requiresHumanApproval === undefined ||
		!createdAt
	) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		errors: [],
		report: {
			id,
			requestId,
			projectId,
			specialty,
			status,
			summary,
			qualityFindings,
			safetyFindings,
			architectureFindings,
			tokenCostFindings,
			timeFindings,
			resourceFindings,
			testsSuggested,
			testsExecuted,
			evidence,
			recommendations,
			proposedSupervisorActions,
			suggestedSkillUpdates,
			suggestedRuleUpdates,
			suggestedAgentTasks,
			confidence,
			requiresHumanApproval,
			createdAt,
		},
	};
}

export function validateAgentLabReportAgainstSupervisorContract(
	reportValue: unknown,
	requestValue: unknown,
): AgentLabSupervisorContractValidationResult {
	const requestResult = validateAgentLabReviewRequest(requestValue);
	const reportResult = validateAgentLabReviewReport(reportValue);
	const errors = [
		...(requestResult.ok ? [] : requestResult.errors),
		...(reportResult.ok ? [] : reportResult.errors),
	];
	if (!requestResult.ok || !reportResult.ok) return { ok: false, errors };
	if (reportResult.report.requestId !== requestResult.request.id) {
		errors.push("report.requestId must match request.id");
	}
	if (reportResult.report.projectId !== requestResult.request.projectId) {
		errors.push("report.projectId must match request.projectId");
	}
	if (reportResult.report.specialty !== requestResult.request.specialty) {
		errors.push("report.specialty must match request.specialty");
	}
	if (
		requestResult.request.requiresHumanApproval &&
		!reportResult.report.requiresHumanApproval
	) {
		errors.push(
			"report.requiresHumanApproval must be true when request requires it",
		);
	}
	if (
		reportResult.report.testsExecuted.length > requestResult.request.maxCommands
	) {
		errors.push("report.testsExecuted must not exceed request.maxCommands");
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		request: requestResult.request,
		report: reportResult.report,
	};
}

export function mapRiskToAgentLabSpecialties(
	input: AgentLabSpecialtyMappingInput,
): AgentLabSpecialty[] {
	const text = [
		input.text ?? "",
		...(input.affectedAreas ?? []),
		...(input.changedFiles ?? []),
		...(input.warnings ?? []),
		...(input.rules ?? []),
	]
		.join("\n")
		.toLowerCase();
	const specialties: AgentLabSpecialty[] = [];
	if (/auth|login|security|secret|permission|permiso|bearer/u.test(text)) {
		specialties.push("security");
	}
	if (
		/\bdb\b|database|schema|sqlite|postgres|migration|tabla|base de datos/u.test(
			text,
		)
	) {
		specialties.push("database");
	}
	if (
		/project core|flows?|architecture|arquitectura|constitution|blueprint|module|m[oó]dulo/u.test(
			text,
		)
	) {
		specialties.push("architecture");
	}
	if (/\bui\b|html|components?|interfaz|screen|page|css/u.test(text)) {
		specialties.push("ui_ux");
	}
	if (
		/token cost|cost|context bloat|contexto excesivo|compact|memoria|prompt/u.test(
			text,
		)
	) {
		specialties.push("token_cost");
	}
	if (/skills?|skill[_ -]?draft|\.agents|\.atl/u.test(text)) {
		specialties.push("skill_review");
	}
	if (
		/agentrouter|orchestration|orquestaci[oó]n|queue|lab|rule-validator|code quality/u.test(
			text,
		)
	) {
		specialties.push("code_quality");
	}
	if (
		/project understanding|project map|project context|missing context|contexto faltante/u.test(
			text,
		)
	) {
		specialties.push("project_understanding");
	}
	if (/performance|slow|latency|build time|timeout|tiempo/u.test(text)) {
		specialties.push("performance");
	}
	if (/docs?|readme|documentaci[oó]n/u.test(text)) specialties.push("docs");
	if (/librarian|bibliotecario|external source|changelog|advisory|cve|nvd|github advisory|npm advisory|fuentes externas/u.test(text)) {
		specialties.push("librarian");
	}
	return dedupe(specialties).length ? dedupe(specialties) : ["general"];
}

export function formatAgentLabReviewRequestForPrompt(
	request: AgentLabReviewRequest,
): string {
	return [
		"AgentLab Supervisor Review Request",
		"",
		"Flujo obligatorio: Humano/Orquestador → Idu-pi Supervisor → AgentLab → Idu-pi Supervisor → reporte consolidado.",
		"El AgentLab inspecciona y reporta; no decide por el humano.",
		"",
		"Objetivo:",
		request.objective,
		"",
		"Especialidad:",
		request.specialty,
		"",
		"Trigger:",
		request.trigger,
		"",
		"Contexto:",
		request.contextSummary,
		"",
		"Evidencia:",
		formatList(request.evidence),
		"",
		"Archivos a inspeccionar:",
		formatList(request.filesToInspect),
		"",
		"Flows a revisar:",
		formatList(request.flowsToCheck),
		"",
		...(request.sourceSkillDraftPath
			? ["Skill draft source:", request.sourceSkillDraftPath, ""]
			: []),
		...(request.externalSourceIntelligence
			? [
				"External source intelligence:",
				`- status: ${request.externalSourceIntelligence.status}`,
				`- allowedSourceKinds: ${request.externalSourceIntelligence.allowedSourceKinds.join(", ")}`,
				`- freshness: ${request.externalSourceIntelligence.freshness}`,
				`- queries: ${request.externalSourceIntelligence.queries.join("; ")}`,
				`- relatedContracts: ${request.externalSourceIntelligence.relatedContracts.join(", ")}`,
				`- contractPromotionAllowed: ${String(request.externalSourceIntelligence.contractPromotionAllowed)}`,
				"",
			]
			: []),
		...(request.trigger === "skill_draft"
			? [
					"Instrucción skill_draft:",
					"No busques SKILL.md real; todavía no existe. Revisa el JSON de draft.",
					"No apliques skills reales ni modifiques .agents/.atl.",
					"",
				]
			: []),
		"Reglas:",
		formatList(request.rulesToCheck),
		"",
		"Restricciones:",
		formatList(request.constraints),
		"",
		"Acciones permitidas:",
		formatList(request.allowedActions),
		"",
		"Acciones prohibidas:",
		formatList(request.forbiddenActions),
		"",
		"Límites:",
		`- maxCommands: ${request.maxCommands}`,
		`- maxMinutes: ${request.maxMinutes}`,
		`- tokenBudgetHint: ${request.tokenBudgetHint}`,
		"",
		"Outputs esperados:",
		formatList(request.expectedOutputs),
		"",
		"Aprobación humana requerida:",
		String(request.requiresHumanApproval),
	].join("\n");
}

export function formatAgentLabReviewReport(
	report: AgentLabReviewReport,
): string {
	const findings = allFindings(report);
	return [
		"AgentLab Review Report",
		"",
		"Estado:",
		report.status,
		"",
		"Especialidad:",
		report.specialty,
		"",
		"Resumen:",
		report.summary,
		"",
		"Hallazgos:",
		findings.length
			? findings
					.map(
						(finding) =>
							`- [${finding.severity}/${finding.confidence}] ${finding.title}: ${finding.evidence}`,
					)
					.join("\n")
			: "- ninguno",
		"",
		"Pruebas sugeridas:",
		formatList(report.testsSuggested),
		"",
		"Pruebas ejecutadas:",
		formatList(report.testsExecuted),
		"",
		"Recomendaciones:",
		report.recommendations.length
			? report.recommendations
					.map(
						(recommendation) =>
							`- ${recommendation.title}: ${recommendation.suggestedNextStep}`,
					)
					.join("\n")
			: "- ninguna",
		"",
		"Requiere aprobación humana:",
		String(report.requiresHumanApproval),
	].join("\n");
}

export function summarizeAgentLabReports(
	reports: AgentLabReviewReport[],
): string {
	const counts = new Map<SupervisorControlPillar, number>();
	for (const report of reports) {
		for (const finding of allFindings(report)) {
			for (const pillar of finding.controlPillars) {
				counts.set(pillar, (counts.get(pillar) ?? 0) + 1);
			}
		}
	}
	return [
		"AgentLab Reports Summary",
		"",
		"Reportes:",
		String(reports.length),
		"",
		"Hallazgos por pilar de control:",
		PILLARS_ORDER.map(
			(pillar) => `- ${pillar}: ${counts.get(pillar) ?? 0}`,
		).join("\n"),
		"",
		"Requiere aprobación humana:",
		String(reports.some((report) => report.requiresHumanApproval)),
	].join("\n");
}

const PILLARS_ORDER: SupervisorControlPillar[] = [
	"quality",
	"time",
	"token_cost",
	"safety",
	"reporting",
	"resources",
	"architecture_consistency",
	"learning",
];

function findingsArray(
	value: unknown,
	path: string,
	errors: string[],
): AgentLabFinding[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return undefined;
	}
	const findings: AgentLabFinding[] = [];
	value.forEach((item, index) => {
		const finding = asRecord(item);
		const itemPath = `${path}[${index}]`;
		if (!finding) {
			errors.push(`${itemPath} must be an object`);
			return;
		}
		const title = requiredString(finding.title, `${itemPath}.title`, errors);
		const description = requiredString(
			finding.description,
			`${itemPath}.description`,
			errors,
		);
		const evidence = requiredString(
			finding.evidence,
			`${itemPath}.evidence`,
			errors,
		);
		const severity = enumValue(
			finding.severity,
			`${itemPath}.severity`,
			SEVERITIES,
			errors,
		);
		const confidence = enumValue(
			finding.confidence,
			`${itemPath}.confidence`,
			CONFIDENCES,
			errors,
		);
		const category = requiredString(
			finding.category,
			`${itemPath}.category`,
			errors,
		);
		const affectedFiles = stringArray(
			finding.affectedFiles,
			`${itemPath}.affectedFiles`,
			errors,
		);
		const affectedFlows = stringArray(
			finding.affectedFlows,
			`${itemPath}.affectedFlows`,
			errors,
		);
		const relatedRules = stringArray(
			finding.relatedRules,
			`${itemPath}.relatedRules`,
			errors,
		);
		const controlPillars = enumArray(
			finding.controlPillars,
			`${itemPath}.controlPillars`,
			PILLARS,
			errors,
		);
		if (
			title &&
			description &&
			evidence &&
			severity &&
			confidence &&
			category &&
			affectedFiles &&
			affectedFlows &&
			relatedRules &&
			controlPillars
		) {
			findings.push({
				title,
				description,
				evidence,
				severity,
				confidence,
				category,
				affectedFiles,
				affectedFlows,
				relatedRules,
				controlPillars,
			});
		}
	});
	return errors.length > 0 ? undefined : findings;
}

function recommendationsArray(
	value: unknown,
	path: string,
	errors: string[],
): AgentLabRecommendation[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return undefined;
	}
	const recommendations: AgentLabRecommendation[] = [];
	value.forEach((item, index) => {
		const recommendation = asRecord(item);
		const itemPath = `${path}[${index}]`;
		if (!recommendation) {
			errors.push(`${itemPath} must be an object`);
			return;
		}
		const title = requiredString(
			recommendation.title,
			`${itemPath}.title`,
			errors,
		);
		const description = requiredString(
			recommendation.description,
			`${itemPath}.description`,
			errors,
		);
		const rationale = requiredString(
			recommendation.rationale,
			`${itemPath}.rationale`,
			errors,
		);
		const expectedBenefit = enumValue(
			recommendation.expectedBenefit,
			`${itemPath}.expectedBenefit`,
			BENEFITS,
			errors,
		);
		const risk = requiredString(
			recommendation.risk,
			`${itemPath}.risk`,
			errors,
		);
		const requiresHumanApproval = booleanValue(
			recommendation.requiresHumanApproval,
			`${itemPath}.requiresHumanApproval`,
			errors,
		);
		const suggestedNextStep = requiredString(
			recommendation.suggestedNextStep,
			`${itemPath}.suggestedNextStep`,
			errors,
		);
		if (requiresHumanApproval === false) {
			errors.push(`${itemPath}.requiresHumanApproval must be true`);
		}
		if (suggestedNextStep && isUnsafeAgentLabAction(suggestedNextStep)) {
			errors.push(
				`${itemPath}.suggestedNextStep contains unsafe non audit-only action`,
			);
		}
		if (
			title &&
			description &&
			rationale &&
			expectedBenefit &&
			risk &&
			requiresHumanApproval !== undefined &&
			suggestedNextStep
		) {
			recommendations.push({
				title,
				description,
				rationale,
				expectedBenefit,
				risk,
				requiresHumanApproval,
				suggestedNextStep,
			});
		}
	});
	return errors.length > 0 ? undefined : recommendations;
}

function optionalExternalSourceIntelligence(
	value: unknown,
	errors: string[],
): AgentLabExternalSourceIntelligence | undefined {
	if (value === undefined) return undefined;
	const record = asRecord(value);
	if (!record) {
		errors.push("externalSourceIntelligence must be an object");
		return undefined;
	}
	const status = enumValue(
		record.status,
		"externalSourceIntelligence.status",
		SOURCE_STATUSES,
		errors,
	);
	const allowedSourceKinds = enumArray(
		record.allowedSourceKinds,
		"externalSourceIntelligence.allowedSourceKinds",
		SOURCE_KINDS,
		errors,
	);
	const freshness = requiredString(
		record.freshness,
		"externalSourceIntelligence.freshness",
		errors,
	);
	const queries = stringArray(
		record.queries,
		"externalSourceIntelligence.queries",
		errors,
	);
	const relatedContracts = stringArray(
		record.relatedContracts,
		"externalSourceIntelligence.relatedContracts",
		errors,
	);
	const contractPromotionAllowed = booleanValue(
		record.contractPromotionAllowed,
		"externalSourceIntelligence.contractPromotionAllowed",
		errors,
	);
	if (contractPromotionAllowed !== false) {
		errors.push("externalSourceIntelligence.contractPromotionAllowed must be false");
	}
	if (!status || !allowedSourceKinds || !freshness || !queries || !relatedContracts || contractPromotionAllowed !== false) {
		return undefined;
	}
	return { status, allowedSourceKinds, freshness, queries, relatedContracts, contractPromotionAllowed };
}

function allFindings(report: AgentLabReviewReport): AgentLabFinding[] {
	return [
		...report.qualityFindings,
		...report.safetyFindings,
		...report.architectureFindings,
		...report.tokenCostFindings,
		...report.timeFindings,
		...report.resourceFindings,
	];
}

function validateForbiddenActions(actions: string[], errors: string[]): void {
	const normalized = actions.join("\n").toLowerCase();
	const required = [
		{
			label: "no modificar repo real",
			pattern: /no modificar repo real|no real repo changes/u,
		},
		{
			label: "no escribir en repo real",
			pattern: /no escribir en repo real|no real repo writes/u,
		},
		{ label: "no commit", pattern: /no commit/u },
		{ label: "no push", pattern: /no push/u },
		{ label: "no merge", pattern: /no merge/u },
		{ label: "no rebase", pattern: /no rebase/u },
		{ label: "no aplicar cambios", pattern: /no aplicar cambios/u },
		{
			label: "no auto-ejecutar AgentLabs",
			pattern: /no auto-ejecutar agentlabs|no auto-run agentlabs/u,
		},
		{
			label: "no auto-aprobar recomendaciones",
			pattern: /no auto-aprobar recomendaciones|no auto-approve/u,
		},
		{
			label: "no promover contratos",
			pattern: /no promover contratos|no contract promotion/u,
		},
		{
			label: "no modificar Project Core",
			pattern: /no modificar project core/u,
		},
		{
			label: "no modificar Constitution",
			pattern: /no modificar constitution/u,
		},
		{ label: "no modificar flows", pattern: /no modificar flows/u },
		{
			label: "no modificar skills reales",
			pattern: /no modificar skills reales/u,
		},
		{
			label: "no crear workers ni workspaces en stateRoot",
			pattern:
				/no crear workers ni workspaces en stateroot|no stateRoot workspace creation/iu,
		},
		{ label: "no borrar datos", pattern: /no borrar datos/u },
		{ label: "no exponer secretos", pattern: /no exponer secretos/u },
	];
	for (const item of required) {
		if (!item.pattern.test(normalized)) {
			errors.push(`forbiddenActions must include ${item.label}`);
		}
	}
}

function defaultAllowedActions(specialty: AgentLabSpecialty): string[] {
	const base = [
		"inspeccionar evidencia provista",
		"crear pruebas sugeridas",
		"criticar y validar",
		"proponer acciones del supervisor",
		"reportar aprendizajes",
	];
	if (specialty === "skill_review") {
		return [...base, "revisar skill drafts sin aplicar skills"];
	}
	if (specialty === "librarian") {
		return [
			...base,
			"leer fuentes externas permitidas",
			"reportar señales con URL y confianza",
			"recomendar revisión humana de contratos sin aplicarlos",
		];
	}
	return base;
}

function sanitizeAllowedActions(
	actions: string[],
	_specialty: AgentLabSpecialty,
): string[] {
	return cleanArray(actions).filter((action) => !isUnsafeAgentLabAction(action));
}

function isUnsafeAgentLabAction(value: string): boolean {
	return UNSAFE_AGENTLAB_ACTION_PATTERN.test(value);
}

function validateAuditOnlyTextArray(
	values: string[],
	path: string,
	errors: string[],
): void {
	values.forEach((value, index) => {
		if (isUnsafeAgentLabAction(value)) {
			errors.push(`${path}[${index}] contains unsafe non audit-only action`);
		}
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function requiredString(
	value: unknown,
	path: string,
	errors: string[],
): string | undefined {
	if (typeof value !== "string" || value.trim().length === 0) {
		errors.push(`${path} is required`);
		return undefined;
	}
	return value.trim();
}

function optionalString(
	value: unknown,
	path: string,
	errors: string[],
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		errors.push(`${path} must be a string`);
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function stringArray(
	value: unknown,
	path: string,
	errors: string[],
): string[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return undefined;
	}
	const strings: string[] = [];
	value.forEach((item, index) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			errors.push(`${path}[${index}] must be a non-empty string`);
			return;
		}
		strings.push(item.trim());
	});
	return errors.length > 0 ? undefined : strings;
}

function enumArray<T extends string>(
	value: unknown,
	path: string,
	allowed: Set<T>,
	errors: string[],
): T[] | undefined {
	const strings = stringArray(value, path, errors);
	if (!strings) return undefined;
	const values: T[] = [];
	for (const item of strings) {
		if (!allowed.has(item as T)) {
			errors.push(`${path} contains invalid value ${item}`);
		} else {
			values.push(item as T);
		}
	}
	return errors.length > 0 ? undefined : values;
}

function enumValue<T extends string>(
	value: unknown,
	path: string,
	allowed: Set<T>,
	errors: string[],
): T | undefined {
	if (typeof value !== "string" || !allowed.has(value as T)) {
		errors.push(`${path} must be one of ${[...allowed].join(", ")}`);
		return undefined;
	}
	return value as T;
}

function booleanValue(
	value: unknown,
	path: string,
	errors: string[],
): boolean | undefined {
	if (typeof value !== "boolean") {
		errors.push(`${path} must be a boolean`);
		return undefined;
	}
	return value;
}

function positiveNumber(
	value: unknown,
	path: string,
	errors: string[],
): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		errors.push(`${path} must be a positive number`);
		return undefined;
	}
	return value;
}

function cleanArray(values: string[]): string[] {
	return values.map((value) => value.trim()).filter(Boolean);
}

function dedupe<T extends string>(values: T[]): T[] {
	return [
		...new Set(values.map((value) => value.trim()).filter(Boolean) as T[]),
	];
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}

function compactTimestamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/\.\d{3}Z$/u, "Z");
}
