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
				requiresHumanApproval: false,
				suggestedNextStep: "Crear test antes de modificar auth.",
			},
		],
		proposedSupervisorActions: ["Crear tarea de revisión"],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "high",
		requiresHumanApproval: false,
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

test("formatAgentLabReviewRequestForPrompt incluye objetivo contexto reglas acciones prohibidas y outputs", () => {
	const text = formatAgentLabReviewRequestForPrompt(validRequest());
	assert.match(text, /Objetivo/u);
	assert.match(text, /Revisar seguridad/u);
	assert.match(text, /Contexto/u);
	assert.match(text, /Reglas/u);
	assert.match(text, /Acciones prohibidas/u);
	assert.match(text, /Outputs esperados/u);
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
