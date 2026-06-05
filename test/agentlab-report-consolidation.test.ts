import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	consolidateAgentLabReviewRun,
	formatAgentLabConsolidationResult,
	formatAgentLabConsolidationStatus,
	getAgentLabConsolidationStatus,
} from "../src/agentlab-report-consolidation.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-consolidation-"));
}

function reportsRoot(): string {
	const reports = join(root(), "reports");
	mkdirSync(reports, { recursive: true });
	return reports;
}

function finding(overrides: Record<string, unknown> = {}) {
	return {
		title: "Auth login sin prueba negativa",
		description: "Falta cubrir token inválido en login.",
		evidence: "test/auth.test.ts no cubre token inválido",
		severity: "high",
		confidence: "high",
		category: "security auth login",
		affectedFiles: ["test/auth.test.ts"],
		affectedFlows: ["login"],
		relatedRules: ["auth requires tests"],
		controlPillars: ["safety", "quality"],
		...overrides,
	};
}

function recommendation(overrides: Record<string, unknown> = {}) {
	return {
		title: "Agregar prueba negativa login",
		description: "Cubrir token inválido antes de tocar auth.",
		rationale: "Evita regresiones de seguridad.",
		expectedBenefit: "safety",
		risk: "low",
		requiresHumanApproval: false,
		suggestedNextStep: "Crear test de token inválido.",
		...overrides,
	};
}

function parsedReport(overrides: Record<string, unknown> = {}) {
	return {
		id: "report-001",
		requestId: "request-security",
		projectId: "pi-telegram-bridge",
		specialty: "security",
		status: "completed",
		summary: "Revisión completa.",
		qualityFindings: [],
		safetyFindings: [finding()],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: ["Agregar test token inválido"],
		testsExecuted: [],
		evidence: ["Inspección estática"],
		recommendations: [recommendation()],
		proposedSupervisorActions: ["Ajustar workflow de revisión security"],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: ["Revisar login auth"],
		confidence: "high",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T00:00:00.000Z",
		...overrides,
	};
}

function reviewRun(overrides: Record<string, unknown> = {}) {
	return {
		generatedAt: "2026-05-25T00:00:00.000Z",
		sourceRequestFile: "agentlab-review-request-20260525-000000.json",
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "pi-telegram-bridge",
		runs: [
			{
				requestId: "request-security",
				specialty: "security",
				status: "completed",
				commandsExecuted: [],
				rawSummary: "Revisión completa.",
				parsedReport: parsedReport(),
				contractValidation: { valid: true, errors: [] },
				findings: [finding()],
				recommendations: [recommendation(), recommendation()],
				testsSuggested: ["Agregar test token inválido"],
				requiresHumanApproval: true,
			},
			{
				requestId: "request-skip",
				specialty: "general",
				status: "skipped",
				commandsExecuted: [],
				rawSummary: "Sin agente compatible.",
				contractValidation: { valid: false, errors: [] },
				findings: [],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: false,
			},
		],
		consolidatedSummary: "Resumen previo.",
		consolidatedFindings: [finding()],
		recommendedNext: "Revisar reporte.",
		requiresHumanApproval: true,
		safeNotes: ["No aplica cambios"],
		...overrides,
	};
}

function writeRun(
	reports: string,
	name = "agentlab-review-run-20260525-000000.json",
	data = reviewRun(),
): string {
	const path = join(reports, name);
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	return path;
}

test("consolidate latest rechaza run current.json directorio sin EISDIR crudo", () => {
	const reports = reportsRoot();
	mkdirSync(join(reports, "..", "agentlabs", "runs", "current.json"), {
		recursive: true,
	});
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.valid, false);
	assert.match(result.errors.join("\n"), /archivo|file|directorio|directory/iu);
	assert.doesNotMatch(result.errors.join("\n"), /EISDIR/u);
});

test("lee latest agentlab-review-run válido y guarda consolidación", () => {
	const reports = reportsRoot();
	const source = writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports, {
		now: () => new Date("2026-05-25T01:02:03.000Z"),
	});
	assert.equal(result.valid, true);
	assert.equal(result.sourceReviewRun, source);
	assert.equal(result.projectId, "pi-telegram-bridge");
	assert.match(
		result.path ?? "",
		/agentlabs[\\/]reports[\\/]consolidated-current\.json$/u,
	);
	assert.equal(existsSync(result.path ?? ""), true);
	assert.equal(result.warning, "Consolidación AgentLab. No aplica cambios.");
});

test("ruta fuera de reports falla", () => {
	const reports = reportsRoot();
	const outside = join(root(), "agentlab-review-run-20260525-000000.json");
	writeFileSync(outside, "{}\n", "utf8");
	const result = consolidateAgentLabReviewRun(outside, reports);
	assert.equal(result.valid, false);
	assert.match(result.errors.join("\n"), /reports/u);
});

test("nombre inválido falla", () => {
	const reports = reportsRoot();
	writeFileSync(join(reports, "agentlab-other.json"), "{}\n", "utf8");
	const result = consolidateAgentLabReviewRun("agentlab-other.json", reports);
	assert.equal(result.valid, false);
	assert.match(result.errors.join("\n"), /agentlab-review-run/u);
});

test("JSON inválido falla", () => {
	const reports = reportsRoot();
	writeFileSync(
		join(reports, "agentlab-review-run-20260525-000000.json"),
		"{",
		"utf8",
	);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.valid, false);
	assert.match(result.errors.join("\n"), /JSON/u);
});

test("consolida findings y recommendations repetidas", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.consolidatedFindings.length, 1);
	assert.deepEqual(result.consolidatedFindings[0]?.evidence, [
		"test/auth.test.ts no cubre token inválido",
	]);
	assert.equal(result.consolidatedRecommendations.length, 1);
});

test("high critical fuerza requiresHumanApproval", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.requiresHumanApproval, true);
	assert.equal(
		result.risks.some((risk) => risk.includes("high")),
		true,
	);
});

test("skill_review produce skillImprovementCandidate", () => {
	const reports = reportsRoot();
	writeRun(
		reports,
		"agentlab-review-run-20260525-000000.json",
		reviewRun({
			runs: [
				{
					requestId: "request-skill",
					specialty: "skill_review",
					status: "completed",
					commandsExecuted: [],
					rawSummary: "Skill necesita mejora.",
					parsedReport: parsedReport({
						requestId: "request-skill",
						specialty: "skill_review",
						suggestedSkillUpdates: ["Mejorar skill bug-hunter"],
						safetyFindings: [
							finding({
								title: "Skill incompleta",
								category: "skill_review",
								severity: "medium",
								controlPillars: ["learning"],
							}),
						],
					}),
					contractValidation: { valid: true, errors: [] },
					findings: [
						finding({
							title: "Skill incompleta",
							category: "skill_review",
							severity: "medium",
							controlPillars: ["learning"],
						}),
					],
					recommendations: [],
					testsSuggested: [],
					requiresHumanApproval: false,
				},
			],
		}),
	);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.skillImprovementCandidates.length, 1);
});

test("security produce supervisorImprovementCandidate y agentTaskCandidate", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(result.supervisorImprovementCandidates.length > 0, true);
	assert.equal(
		result.agentTaskCandidates.some(
			(candidate) => candidate.type === "security",
		),
		true,
	);
});

test("database produce agentTaskCandidate database", () => {
	const reports = reportsRoot();
	writeRun(
		reports,
		"agentlab-review-run-20260525-000000.json",
		reviewRun({
			runs: [
				{
					requestId: "request-db",
					specialty: "database",
					status: "partial",
					commandsExecuted: [],
					rawSummary: "Schema sin índice.",
					contractValidation: { valid: true, errors: [] },
					findings: [
						finding({
							title: "Schema sin índice",
							category: "database schema",
							severity: "medium",
							affectedFiles: ["db/schema.sql"],
							controlPillars: ["quality"],
						}),
					],
					recommendations: [],
					testsSuggested: [],
					requiresHumanApproval: false,
				},
			],
		}),
	);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(
		result.agentTaskCandidates.some(
			(candidate) => candidate.type === "database",
		),
		true,
	);
});

test("token_cost produce candidate de optimización", () => {
	const reports = reportsRoot();
	writeRun(
		reports,
		"agentlab-review-run-20260525-000000.json",
		reviewRun({
			runs: [
				{
					requestId: "request-token",
					specialty: "token_cost",
					status: "completed",
					commandsExecuted: [],
					rawSummary: "Contexto excesivo.",
					contractValidation: { valid: true, errors: [] },
					findings: [
						finding({
							title: "Contexto excesivo",
							category: "token_cost context",
							severity: "low",
							controlPillars: ["token_cost"],
						}),
					],
					recommendations: [],
					testsSuggested: [],
					requiresHumanApproval: false,
				},
			],
		}),
	);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.equal(
		result.supervisorImprovementCandidates.some(
			(candidate) => candidate.type === "workflow_improvement",
		),
		true,
	);
});

test("testsSuggested se preservan y skipped sin evidencia no genera finding", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports);
	assert.deepEqual(result.testsSuggested, ["Agregar test token inválido"]);
	assert.match(result.summary, /skipped: 1/u);
	assert.equal(result.consolidatedFindings.length, 1);
});

test("status latest muestra resumen", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const created = consolidateAgentLabReviewRun("latest", reports, {
		now: () => new Date("2026-05-25T01:02:03.000Z"),
	});
	const status = getAgentLabConsolidationStatus("latest", reports);
	assert.equal(status.valid, true);
	assert.equal(status.result?.sourceReviewRun, created.sourceReviewRun);
	const text = formatAgentLabConsolidationStatus(status);
	assert.match(text, /total findings: 1/u);
	assert.match(text, /supervisor improvements: 1/u);
	assert.match(text, /Recommended next:/u);
});

test("status latest ignora runs legacy al buscar consolidaciones", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const created = consolidateAgentLabReviewRun("latest", reports, {
		now: () => new Date("2026-05-25T01:02:03.000Z"),
	});
	writeRun(reports, "agentlab-review-run-20260525-020000.json");
	const status = getAgentLabConsolidationStatus("latest", reports);
	assert.equal(status.valid, true);
	assert.equal(status.result?.path, created.path);
});

test("status ruta legacy relativa busca en reports", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const created = consolidateAgentLabReviewRun("latest", reports, {
		now: () => new Date("2026-05-25T01:02:03.000Z"),
	});
	const legacyName = "agentlab-consolidation-20260525-010203.json";
	writeFileSync(
		join(reports, legacyName),
		readFileSync(created.path ?? "", "utf8"),
		"utf8",
	);
	const status = getAgentLabConsolidationStatus(legacyName, reports);
	assert.equal(status.valid, true);
	assert.equal(status.result?.sourceReviewRun, created.sourceReviewRun);
});

test("format consolidate muestra nota segura", () => {
	const reports = reportsRoot();
	writeRun(reports);
	const result = consolidateAgentLabReviewRun("latest", reports);
	const text = formatAgentLabConsolidationResult(result);
	assert.match(text, /AgentLab Report Consolidation/u);
	assert.match(text, /No apliqué cambios/u);
	assert.match(text, /no ejecuté AgentLabs/u);
});
