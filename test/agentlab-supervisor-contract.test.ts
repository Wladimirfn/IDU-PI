import assert from "node:assert/strict";
import test from "node:test";
import {
	buildAgentLabReviewRequest,
	formatAgentLabReviewReport,
	formatAgentLabReviewRequestForPrompt,
	mapRiskToAgentLabSpecialties,
	summarizeAgentLabReports,
	validateAgentLabReportAgainstSupervisorContract,
	validateAgentLabReviewReport,
	validateAgentLabReviewRequest,
	type AgentLabReviewReport,
	// type AgentLabReviewRequest,
} from "../src/agentlab-supervisor-contract.js";

function validRequest() {
	return buildAgentLabReviewRequest({
		id: "lab-review-request-001",
		projectId: "pi-telegram-bridge",
		projectPath: "/workspace/pi-telegram-bridge",
		specialty: "security",
		trigger: "manual",
		objective: "Revisar seguridad del cambio de login",
		contextSummary: "Cambio toca auth/login y permisos.",
		evidence: ["src/auth.ts modificado"],
		filesToInspect: ["src/auth.ts"],
		rulesToCheck: ["no secrets"],
		constraints: ["No aplicar cambios reales"],
		maxCommands: 3,
		maxMinutes: 10,
		tokenBudgetHint: "medium",
		expectedOutputs: ["hallazgos con evidencia"],
	});
}

function validReport(
	patch: Partial<AgentLabReviewReport> = {},
): AgentLabReviewReport {
	return {
		id: "lab-review-report-001",
		requestId: "lab-review-request-001",
		projectId: "pi-telegram-bridge",
		specialty: "security",
		status: "completed",
		summary: "El cambio requiere revisar permisos.",
		qualityFindings: [],
		safetyFindings: [
			{
				title: "Auth sin prueba negativa",
				description: "Falta cubrir rechazo de token inválido.",
				evidence: "test/auth.test.ts no contiene caso de token inválido",
				severity: "medium",
				confidence: "high",
				category: "security",
				affectedFiles: ["test/auth.test.ts"],
				affectedFlows: ["login"],
				relatedRules: ["auth changes require tests"],
				controlPillars: ["quality", "safety"],
			},
		],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: ["Agregar prueba de token inválido"],
		testsExecuted: [],
		evidence: ["Inspección de test/auth.test.ts"],
		recommendations: [
			{
				title: "Agregar prueba negativa",
				description: "Cubrir rechazo de credenciales inválidas.",
				rationale: "Reduce regresiones de seguridad.",
				expectedBenefit: "safety",
				risk: "low",
				requiresHumanApproval: true,
				suggestedNextStep: "Registrar hallazgo para revisión humana.",
			},
		],
		proposedSupervisorActions: ["Registrar tarea de revisión humana"],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "high",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T00:00:00.000Z",
		...patch,
	};
}

test("validateAgentLabReviewRequest acepta request válido", () => {
	const result = validateAgentLabReviewRequest(validRequest());
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.request.requestedBy, "supervisor");
		assert.equal(result.request.requiresHumanApproval, true);
	}
});

test("validateAgentLabReviewRequest falla si falta objective", () => {
	const request = { ...validRequest(), objective: "" };
	const result = validateAgentLabReviewRequest(request);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /objective/u);
});

test("validateAgentLabReviewRequest falla si forbiddenActions no contiene no commit/no push/no real repo changes", () => {
	const request = {
		...validRequest(),
		forbiddenActions: ["no borrar datos", "no exponer secretos"],
	};
	const result = validateAgentLabReviewRequest(request);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /no commit/u);
	assert.match(result.errors.join("\n"), /no push/u);
	assert.match(result.errors.join("\n"), /repo real/u);
});

test("validateAgentLabReviewReport acepta report válido", () => {
	const result = validateAgentLabReviewReport(validReport());
	assert.equal(result.ok, true);
});

test("validateAgentLabReviewReport exige human approval para todo output AgentLab", () => {
	const result = validateAgentLabReviewReport(
		validReport({ requiresHumanApproval: false }),
	);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /requiresHumanApproval/u);
});

test("validateAgentLabReviewReport rechaza acciones inseguras en campos accionables", () => {
	const unsafeFields: Array<Partial<AgentLabReviewReport>> = [
		{ testsExecuted: ["git commit -m fix"] },
		{ proposedSupervisorActions: ["aprobar automáticamente el contrato"] },
		{ suggestedSkillUpdates: ["aplicar skill real"] },
		{ suggestedRuleUpdates: ["promote contract to production"] },
		{ suggestedAgentTasks: ["edit code and push"] },
		{ proposedSupervisorActions: ["write to real repo"] },
		{ suggestedAgentTasks: ["create workers in stateRoot"] },
		{
			recommendations: [
				{
					...validReport().recommendations[0]!,
					suggestedNextStep: "push changes",
				},
			],
		},
	];
	for (const patch of unsafeFields) {
		const result = validateAgentLabReviewReport(validReport(patch));
		assert.equal(result.ok, false, JSON.stringify(patch));
		assert.match(result.errors.join("\n"), /audit-only|unsafe/u);
	}
});

test("validateAgentLabReviewReport falla si finding no tiene evidence", () => {
	const report = validReport({
		safetyFindings: [{ ...validReport().safetyFindings[0]!, evidence: "" }],
	});
	const result = validateAgentLabReviewReport(report);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /evidence/u);
});

test("high/critical requiere requiresHumanApproval true", () => {
	const report = validReport({
		requiresHumanApproval: false,
		safetyFindings: [
			{ ...validReport().safetyFindings[0]!, severity: "critical" },
		],
	});
	const result = validateAgentLabReviewReport(report);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /requiresHumanApproval/u);
});

test("mapRiskToAgentLabSpecialties asigna señales a especialistas", () => {
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({ text: "auth login security" }),
		["security"],
	);
	assert.deepEqual(mapRiskToAgentLabSpecialties({ text: "DB schema" }), [
		"database",
	]);
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({ text: "Project Core flows architecture" }),
		["architecture"],
	);
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({ text: "UI html components" }),
		["ui_ux"],
	);
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({ text: "token cost context bloat" }),
		["token_cost"],
	);
	assert.deepEqual(mapRiskToAgentLabSpecialties({ text: "skills" }), [
		"skill_review",
	]);
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({
			text: "AgentRouter orchestration queue lab",
		}),
		["code_quality"],
	);
	assert.deepEqual(
		mapRiskToAgentLabSpecialties({
			text: "missing context project understanding",
		}),
		["project_understanding"],
	);
});

test("formatAgentLabReviewRequestForPrompt incluye objetivo contexto reglas acciones prohibidas outputs y budget", () => {
	const text = formatAgentLabReviewRequestForPrompt(validRequest());
	assert.match(text, /Objetivo/u);
	assert.match(text, /Revisar seguridad/u);
	assert.match(text, /Context budget JSON/u);
	assert.match(text, /"profile": "agentlab_request"/u);
	assert.match(text, /Contexto/u);
	assert.match(text, /Reglas/u);
	assert.match(text, /Acciones prohibidas/u);
	assert.match(text, /Outputs esperados/u);
});

test("buildAgentLabReviewRequest aplica context budget determinístico", () => {
	const request = buildAgentLabReviewRequest({
		...validRequest(),
		contextSummary: "x".repeat(2_000),
		evidence: Array.from({ length: 25 }, (_, index) =>
			`evidence-${index}-${"y".repeat(400)}`,
		),
	});

	const budget = request.contextBudget!;
	assert.equal(request.contextSummary.includes("[context truncated]"), true);
	assert.equal(request.evidence.length, 20);
	assert.equal(budget.profile, "agentlab_request");
	assert.equal(budget.truncated, true);
	assert.equal(budget.advisoryOnly, true);
	assert.equal(budget.contractPromotionAllowed, false);
	assert.equal(
		budget.omitted.some((item) => item.path === "contextSummary"),
		true,
	);
	assert.equal(
		budget.omitted.some((item) => item.reason === "max_items"),
		true,
	);
});

test("summarizeAgentLabReports agrupa findings por control pillar", () => {
	const summary = summarizeAgentLabReports([
		validReport(),
		validReport({
			id: "lab-review-report-002",
			safetyFindings: [],
			tokenCostFindings: [
				{
					...validReport().safetyFindings[0]!,
					title: "Contexto excesivo",
					category: "token_cost",
					controlPillars: ["token_cost", "resources"],
				},
			],
		}),
	]);
	assert.match(summary, /safety/u);
	assert.match(summary, /token_cost/u);
	assert.match(summary, /resources/u);
});

test("request allowedActions filtra y rechaza intenciones inseguras para toda especialidad", () => {
	const request = buildAgentLabReviewRequest({
		...validRequest(),
		specialty: "architecture",
		allowedActions: [
			"inspeccionar arquitectura",
			"commit",
			"push changes",
			"write to real repo",
			"modify real repo",
			"create workers in stateRoot",
		],
	});
	assert.deepEqual(request.allowedActions, ["inspeccionar arquitectura"]);

	const validation = validateAgentLabReviewRequest({
		...request,
		allowedActions: ["write to real repo", "create workers in stateRoot"],
	});
	assert.equal(validation.ok, false);
	assert.match(validation.errors.join("\n"), /audit-only|unsafe/u);
});

test("toda request AgentLab exige human approval", () => {
	const request = buildAgentLabReviewRequest({
		...validRequest(),
		specialty: "architecture",
		requiresHumanApproval: false,
	});
	assert.equal(request.requiresHumanApproval, true);

	const validation = validateAgentLabReviewRequest({
		...request,
		requiresHumanApproval: false,
	});
	assert.equal(validation.ok, false);
	assert.match(validation.errors.join("\n"), /human approval/u);
});

test("cross-contract rechaza testsExecuted sobre maxCommands", () => {
	const request = { ...validRequest(), maxCommands: 1 };
	const report = validReport({
		testsExecuted: ["pnpm test", "pnpm build"],
	});
	const result = validateAgentLabReportAgainstSupervisorContract(
		report,
		request,
	);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /maxCommands/u);
});

test("skill_review request no permite aplicar skills", () => {
	const request = buildAgentLabReviewRequest({
		...validRequest(),
		specialty: "skill_review",
		allowedActions: ["revisar skill drafts", "Aplicar skills reales"],
	});
	assert.ok(
		request.forbiddenActions.some((action) =>
			/modificar skills reales/u.test(action),
		),
	);
	assert.ok(
		!request.allowedActions.some((action) => /aplicar skills/iu.test(action)),
	);
	const validation = validateAgentLabReviewRequest({
		...request,
		allowedActions: ["Aplicar skills reales"],
	});
	assert.equal(validation.ok, false);
});

test("librarian request modela external source intelligence sin promover contratos", () => {
	const request = buildAgentLabReviewRequest({
		...validRequest(),
		specialty: "librarian",
		trigger: "external_source_intelligence",
		externalSourceIntelligence: {
			status: "requested",
			allowedSourceKinds: ["official_docs", "changelog", "advisory", "cve_nvd", "github_advisory", "npm_advisory", "community_signal"],
			freshness: "latest available",
			queries: ["official docs", "CVE NVD", "npm advisories"],
			relatedContracts: ["security", "data"],
			contractPromotionAllowed: false,
		},
		allowedActions: ["leer fuentes externas", "commit", "aplicar contrato"],
	});
	assert.equal(request.externalSourceIntelligence?.contractPromotionAllowed, false);
	assert.ok(!request.allowedActions.some((action) => /commit|aplicar contrato/iu.test(action)));
	assert.equal(validateAgentLabReviewRequest(request).ok, true);

	const invalid = validateAgentLabReviewRequest({
		...request,
		externalSourceIntelligence: {
			...request.externalSourceIntelligence!,
			contractPromotionAllowed: true,
		},
	});
	assert.equal(invalid.ok, false);
	assert.match(invalid.errors.join("\n"), /contractPromotionAllowed|auto-promote/u);
});

test("security/database request exige human approval", () => {
	assert.equal(
		buildAgentLabReviewRequest({ ...validRequest(), specialty: "security" })
			.requiresHumanApproval,
		true,
	);
	assert.equal(
		buildAgentLabReviewRequest({ ...validRequest(), specialty: "database" })
			.requiresHumanApproval,
		true,
	);
});

test("validateAgentLabReportAgainstSupervisorContract cruza request y report", () => {
	const request = validRequest();
	const report = validReport({ specialty: "database" });
	const result = validateAgentLabReportAgainstSupervisorContract(
		report,
		request,
	);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /specialty/u);
});

test("formatAgentLabReviewReport muestra reporte y recomendaciones", () => {
	const text = formatAgentLabReviewReport(validReport());
	assert.match(text, /AgentLab Review Report/u);
	assert.match(text, /El cambio requiere revisar permisos/u);
	assert.match(text, /Agregar prueba negativa/u);
});
