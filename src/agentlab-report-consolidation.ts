import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	AgentLabConfidence,
	AgentLabFindingSeverity,
	AgentLabSpecialty,
	SupervisorControlPillar,
} from "./agentlab-supervisor-contract.js";
import type {
	SupervisorImprovementBenefit,
	SupervisorImprovementProposalType,
	SupervisorImprovementRisk,
} from "./supervisor-improvement-proposals.js";
import type {
	SkillImprovementProposalType,
	SkillImprovementRisk,
} from "./skill-improvement-proposals.js";
import type { SemanticAgentTaskType } from "./semantic-agent-tasks.js";

export type AgentLabConsolidatedFinding = {
	title: string;
	description: string;
	evidence: string[];
	severity: AgentLabFindingSeverity;
	confidence: AgentLabConfidence;
	specialty: AgentLabSpecialty;
	affectedFiles: string[];
	affectedFlows: string[];
	relatedRules: string[];
	controlPillars: SupervisorControlPillar[];
	sourceRunId: string;
	sourceRequestId: string;
};

export type AgentLabConsolidatedRecommendation = {
	title: string;
	description: string;
	rationale: string;
	expectedBenefit: string;
	risk: string;
	requiresHumanApproval: boolean;
	suggestedNextStep: string;
	sourceRequestIds: string[];
};

export type AgentLabSupervisorImprovementCandidate = {
	id: string;
	type: SupervisorImprovementProposalType;
	title: string;
	description: string;
	evidence: string[];
	riskLevel: SupervisorImprovementRisk;
	expectedBenefit: SupervisorImprovementBenefit[];
	requiresHumanApproval: true;
	suggestedAction: "approve_for_agent_review" | "defer";
	sourceRequestIds: string[];
};

export type AgentLabSkillImprovementCandidate = {
	id: string;
	type: SkillImprovementProposalType;
	skillName: string;
	title: string;
	description: string;
	evidence: string[];
	riskLevel: SkillImprovementRisk;
	requiresHumanApproval: true;
	suggestedAction: "approve_for_agent_review" | "defer";
	sourceRequestIds: string[];
};

export type AgentLabSemanticMemoryCandidate = {
	id: string;
	importance: "critical" | "high" | "medium" | "low";
	title: string;
	summary: string;
	tags: string[];
	sourceRequestIds: string[];
};

export type AgentLabAgentTaskCandidate = {
	id: string;
	type: SemanticAgentTaskType;
	category: "review";
	title: string;
	priority: number;
	reason: string;
	recommendation: string;
	evidence: string;
	requiresHumanApproval: boolean;
	dedupeKey: string;
	sourceRequestIds: string[];
};

export type AgentLabConsolidationResult = {
	valid: boolean;
	errors: string[];
	path?: string;
	generatedAt: string;
	sourceReviewRun: string;
	projectId: string;
	warning: "Consolidación AgentLab. No aplica cambios.";
	summary: string;
	consolidatedFindings: AgentLabConsolidatedFinding[];
	consolidatedRecommendations: AgentLabConsolidatedRecommendation[];
	testsSuggested: string[];
	supervisorImprovementCandidates: AgentLabSupervisorImprovementCandidate[];
	skillImprovementCandidates: AgentLabSkillImprovementCandidate[];
	semanticMemoryCandidates: AgentLabSemanticMemoryCandidate[];
	agentTaskCandidates: AgentLabAgentTaskCandidate[];
	risks: string[];
	requiresHumanApproval: boolean;
	recommendedNext: string[];
};

export type AgentLabConsolidationStatus = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	result?: AgentLabConsolidationResult;
};

type ConsolidateOptions = { now?: () => Date };
type RunLike = {
	generatedAt?: unknown;
	sourceRequestFile?: unknown;
	warning?: unknown;
	projectId?: unknown;
	runs?: unknown;
};
type RunSummaryLike = {
	requestId?: unknown;
	specialty?: unknown;
	status?: unknown;
	rawSummary?: unknown;
	parsedReport?: unknown;
	findings?: unknown;
	recommendations?: unknown;
	testsSuggested?: unknown;
	requiresHumanApproval?: unknown;
};

const WARNING = "Consolidación AgentLab. No aplica cambios." as const;
const RUN_RE = /^agentlab-review-run-\d{8}-\d{6}\.json$/u;
const CONSOLIDATION_RE = /^agentlab-consolidation-\d{8}-\d{6}\.json$/u;
const SEVERITY_ORDER: AgentLabFindingSeverity[] = [
	"info",
	"low",
	"medium",
	"high",
	"critical",
];
const CONFIDENCE_ORDER: AgentLabConfidence[] = ["low", "medium", "high"];

export function consolidateAgentLabReviewRun(
	pathOrLatest: string,
	reportsPath: string,
	options: ConsolidateOptions = {},
): AgentLabConsolidationResult {
	const now = options.now?.() ?? new Date();
	const generatedAt = now.toISOString();
	const resolved = resolveReportPath(
		pathOrLatest,
		reportsPath,
		RUN_RE,
		"agentlab-review-run",
	);
	if (!resolved.valid)
		return invalidResult(generatedAt, resolved.path, resolved.errors);
	const read = readJson(resolved.path);
	if (!read.valid)
		return invalidResult(generatedAt, resolved.path, read.errors);
	const normalized = normalizeReviewRun(read.value);
	if (!normalized.valid)
		return invalidResult(generatedAt, resolved.path, normalized.errors);
	const run = normalized.run;
	const completedOrPartialRuns = run.runs.filter((item) =>
		["completed", "partial"].includes(item.status),
	);
	const skipped = run.runs.filter((item) => item.status === "skipped").length;
	const failed = run.runs.filter((item) => item.status === "failed").length;
	const findings = groupFindings(flattenFindings(completedOrPartialRuns));
	const recommendations = groupRecommendations(
		flattenRecommendations(completedOrPartialRuns),
	);
	const testsSuggested = unique(
		completedOrPartialRuns.flatMap((item) => [
			...item.testsSuggested,
			...arrayOfStrings(record(item.parsedReport).testsSuggested),
		]),
	);
	const supervisorImprovementCandidates = buildSupervisorCandidates(
		findings,
		recommendations,
	);
	const skillImprovementCandidates = buildSkillCandidates(
		findings,
		completedOrPartialRuns,
	);
	const semanticMemoryCandidates = buildSemanticMemoryCandidates(
		findings,
		recommendations,
	);
	const agentTaskCandidates = buildAgentTaskCandidates(
		findings,
		completedOrPartialRuns,
	);
	const risks = buildRisks(findings, failed);
	const requiresHumanApproval =
		run.requiresHumanApproval ||
		findings.some((finding) => ["high", "critical"].includes(finding.severity));
	const result: AgentLabConsolidationResult = {
		valid: true,
		errors: [],
		generatedAt,
		sourceReviewRun: resolved.path,
		projectId: run.projectId,
		warning: WARNING,
		summary: `runs: ${run.runs.length}; completed/partial: ${completedOrPartialRuns.length}; skipped: ${skipped}; failed: ${failed}; findings: ${findings.length}; recommendations: ${recommendations.length}`,
		consolidatedFindings: findings,
		consolidatedRecommendations: recommendations,
		testsSuggested,
		supervisorImprovementCandidates,
		skillImprovementCandidates,
		semanticMemoryCandidates,
		agentTaskCandidates,
		risks,
		requiresHumanApproval,
		recommendedNext: [
			"revisar consolidación",
			"crear propuestas si corresponde",
			"no aplicar cambios sin aprobación humana",
		],
	};
	mkdirSync(reportsPath, { recursive: true });
	const path = join(
		reportsPath,
		`agentlab-consolidation-${timestamp(now)}.json`,
	);
	writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	return { ...result, path };
}

export function getAgentLabConsolidationStatus(
	pathOrLatest: string,
	reportsPath: string,
): AgentLabConsolidationStatus {
	const resolved = resolveReportPath(
		pathOrLatest,
		reportsPath,
		CONSOLIDATION_RE,
		"agentlab-consolidation",
	);
	if (!resolved.valid) {
		return {
			path: resolved.path,
			name: basename(resolved.path || pathOrLatest),
			valid: false,
			errors: resolved.errors,
		};
	}
	const read = readJson(resolved.path);
	if (!read.valid) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: read.errors,
		};
	}
	const normalized = normalizeConsolidation(read.value, resolved.path);
	return {
		path: resolved.path,
		name: basename(resolved.path),
		valid: normalized.valid,
		errors: normalized.errors,
		...(normalized.result ? { result: normalized.result } : {}),
	};
}

export function formatAgentLabConsolidationResult(
	result: AgentLabConsolidationResult,
): string {
	if (!result.valid)
		return formatInvalid("AgentLab Report Consolidation", result);
	return [
		"AgentLab Report Consolidation",
		"",
		"Source:",
		basename(result.sourceReviewRun),
		"",
		"Findings:",
		...formatFindingCounts(result.consolidatedFindings),
		"",
		"Candidates:",
		`- supervisor improvements: ${result.supervisorImprovementCandidates.length}`,
		`- skill improvements: ${result.skillImprovementCandidates.length}`,
		`- semantic memory: ${result.semanticMemoryCandidates.length}`,
		`- agent tasks: ${result.agentTaskCandidates.length}`,
		"",
		"Recommended next:",
		...result.recommendedNext.map((item) => `- ${item}`),
		"",
		"Nota segura:",
		"No apliqué cambios, no ejecuté AgentLabs, no modifiqué skills/Core/Constitution.",
	].join("\n");
}

export function formatAgentLabConsolidationStatus(
	status: AgentLabConsolidationStatus,
): string {
	if (!status.valid || !status.result) {
		return [
			"AgentLab Report Consolidation Status",
			"",
			"Archivo:",
			status.name,
			"",
			"Válido:",
			"no",
			"",
			"Errores:",
			...formatList(status.errors),
		].join("\n");
	}
	const result = status.result;
	const highCritical = result.consolidatedFindings.filter((finding) =>
		["high", "critical"].includes(finding.severity),
	).length;
	return [
		"AgentLab Report Consolidation Status",
		"",
		"Archivo fuente:",
		basename(result.sourceReviewRun),
		"",
		`total findings: ${result.consolidatedFindings.length}`,
		`findings high/critical: ${highCritical}`,
		`recommendations: ${result.consolidatedRecommendations.length}`,
		`tests suggested: ${result.testsSuggested.length}`,
		"",
		"Candidates:",
		`- supervisor improvements: ${result.supervisorImprovementCandidates.length}`,
		`- skill improvements: ${result.skillImprovementCandidates.length}`,
		`- semantic memory: ${result.semanticMemoryCandidates.length}`,
		`- agent tasks: ${result.agentTaskCandidates.length}`,
		"",
		"Recommended next:",
		...result.recommendedNext.map((item) => `- ${item}`),
	].join("\n");
}

function flattenFindings(
	runs: NormalizedRunSummary[],
): AgentLabConsolidatedFinding[] {
	return runs.flatMap((run) => {
		const direct = run.findings;
		const parsed = record(run.parsedReport);
		const parsedFindings = [
			...arrayOfRecords(parsed.qualityFindings),
			...arrayOfRecords(parsed.safetyFindings),
			...arrayOfRecords(parsed.architectureFindings),
			...arrayOfRecords(parsed.tokenCostFindings),
			...arrayOfRecords(parsed.timeFindings),
			...arrayOfRecords(parsed.resourceFindings),
		];
		return [...direct, ...parsedFindings]
			.map((finding) => normalizeFinding(finding, run))
			.filter((finding): finding is AgentLabConsolidatedFinding =>
				Boolean(finding),
			);
	});
}

function flattenRecommendations(
	runs: NormalizedRunSummary[],
): AgentLabConsolidatedRecommendation[] {
	return runs.flatMap((run) => {
		const parsed = record(run.parsedReport);
		return [...run.recommendations, ...arrayOfRecords(parsed.recommendations)]
			.map((recommendation) =>
				normalizeRecommendation(recommendation, run.requestId),
			)
			.filter((item): item is AgentLabConsolidatedRecommendation =>
				Boolean(item),
			);
	});
}

function groupFindings(
	findings: AgentLabConsolidatedFinding[],
): AgentLabConsolidatedFinding[] {
	const grouped = new Map<string, AgentLabConsolidatedFinding>();
	for (const finding of findings) {
		const key = [
			normalizeText(finding.title),
			finding.specialty,
			finding.affectedFiles.join("|"),
			finding.controlPillars.join("|"),
		].join("::");
		const existing = grouped.get(key);
		if (!existing) {
			grouped.set(key, { ...finding, evidence: unique(finding.evidence) });
			continue;
		}
		existing.evidence = unique([...existing.evidence, ...finding.evidence]);
		existing.severity = maxSeverity(existing.severity, finding.severity);
		existing.confidence = maxConfidence(
			existing.confidence,
			finding.confidence,
		);
		existing.affectedFlows = unique([
			...existing.affectedFlows,
			...finding.affectedFlows,
		]);
		existing.relatedRules = unique([
			...existing.relatedRules,
			...finding.relatedRules,
		]);
	}
	return [...grouped.values()].sort(compareFindings);
}

function groupRecommendations(
	recommendations: AgentLabConsolidatedRecommendation[],
): AgentLabConsolidatedRecommendation[] {
	const grouped = new Map<string, AgentLabConsolidatedRecommendation>();
	for (const recommendation of recommendations) {
		const key = [
			normalizeText(recommendation.title),
			normalizeText(recommendation.description),
			recommendation.expectedBenefit,
		].join("::");
		const existing = grouped.get(key);
		if (!existing) {
			grouped.set(key, {
				...recommendation,
				sourceRequestIds: unique(recommendation.sourceRequestIds),
			});
			continue;
		}
		existing.sourceRequestIds = unique([
			...existing.sourceRequestIds,
			...recommendation.sourceRequestIds,
		]);
		existing.requiresHumanApproval ||= recommendation.requiresHumanApproval;
	}
	return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function buildSupervisorCandidates(
	findings: AgentLabConsolidatedFinding[],
	recommendations: AgentLabConsolidatedRecommendation[],
): AgentLabSupervisorImprovementCandidate[] {
	const candidates: AgentLabSupervisorImprovementCandidate[] = [];
	for (const finding of findings) {
		const type = supervisorTypeForFinding(finding);
		if (!type) continue;
		candidates.push({
			id: `agentlab-supervisor-${String(candidates.length + 1).padStart(3, "0")}`,
			type,
			title: finding.title,
			description: finding.description,
			evidence: finding.evidence,
			riskLevel: riskForSeverity(finding.severity),
			expectedBenefit: benefitsFromPillars(finding.controlPillars),
			requiresHumanApproval: true,
			suggestedAction: "approve_for_agent_review",
			sourceRequestIds: [finding.sourceRequestId],
		});
	}
	for (const recommendation of recommendations.filter((item) =>
		["token_cost", "time"].includes(item.expectedBenefit),
	)) {
		candidates.push({
			id: `agentlab-supervisor-${String(candidates.length + 1).padStart(3, "0")}`,
			type: "workflow_improvement",
			title: recommendation.title,
			description: recommendation.description,
			evidence: [recommendation.rationale],
			riskLevel: "low",
			expectedBenefit: [
				benefitForRecommendation(recommendation.expectedBenefit),
			],
			requiresHumanApproval: true,
			suggestedAction: "defer",
			sourceRequestIds: recommendation.sourceRequestIds,
		});
	}
	return dedupeBy(
		candidates,
		(item) => `${item.type}:${normalizeText(item.title)}`,
	).map((item, index) => ({
		...item,
		id: `agentlab-supervisor-${String(index + 1).padStart(3, "0")}`,
	}));
}

function buildSkillCandidates(
	findings: AgentLabConsolidatedFinding[],
	runs: NormalizedRunSummary[],
): AgentLabSkillImprovementCandidate[] {
	const candidates = findings
		.filter(
			(finding) =>
				finding.specialty === "skill_review" ||
				textFor(finding).includes("skill"),
		)
		.map((finding, index) => ({
			id: `agentlab-skill-${String(index + 1).padStart(3, "0")}`,
			type: "improve_skill" as const,
			skillName: skillNameFromText(textFor(finding)),
			title: finding.title,
			description: finding.description,
			evidence: finding.evidence,
			riskLevel: riskForSeverity(finding.severity),
			requiresHumanApproval: true as const,
			suggestedAction: "approve_for_agent_review" as const,
			sourceRequestIds: [finding.sourceRequestId],
		}));
	for (const run of runs) {
		if (
			candidates.some((candidate) =>
				candidate.sourceRequestIds.includes(run.requestId),
			)
		)
			continue;
		for (const update of arrayOfStrings(
			record(run.parsedReport).suggestedSkillUpdates,
		)) {
			candidates.push({
				id: `agentlab-skill-${String(candidates.length + 1).padStart(3, "0")}`,
				type: "improve_skill",
				skillName: skillNameFromText(update),
				title: update,
				description: update,
				evidence: [run.rawSummary].filter(Boolean),
				riskLevel: "medium",
				requiresHumanApproval: true,
				suggestedAction: "approve_for_agent_review",
				sourceRequestIds: [run.requestId],
			});
		}
	}
	return dedupeBy(
		candidates,
		(item) => `${item.skillName}:${normalizeText(item.title)}`,
	).map((item, index) => ({
		...item,
		id: `agentlab-skill-${String(index + 1).padStart(3, "0")}`,
	}));
}

function buildSemanticMemoryCandidates(
	findings: AgentLabConsolidatedFinding[],
	recommendations: AgentLabConsolidatedRecommendation[],
): AgentLabSemanticMemoryCandidate[] {
	const findingCandidates = findings.map((finding, index) => ({
		id: `agentlab-memory-${String(index + 1).padStart(3, "0")}`,
		importance: memoryImportanceForSeverity(finding.severity),
		title: finding.title,
		summary: finding.description,
		tags: unique([
			finding.specialty,
			...finding.controlPillars,
			...finding.relatedRules,
		]),
		sourceRequestIds: [finding.sourceRequestId],
	}));
	const recommendationCandidates = recommendations.map(
		(recommendation, index) => ({
			id: `agentlab-memory-${String(findingCandidates.length + index + 1).padStart(3, "0")}`,
			importance: recommendation.requiresHumanApproval
				? ("high" as const)
				: ("medium" as const),
			title: recommendation.title,
			summary: recommendation.description,
			tags: unique([recommendation.expectedBenefit]),
			sourceRequestIds: recommendation.sourceRequestIds,
		}),
	);
	return dedupeBy([...findingCandidates, ...recommendationCandidates], (item) =>
		normalizeText(item.title),
	).map((item, index) => ({
		...item,
		id: `agentlab-memory-${String(index + 1).padStart(3, "0")}`,
	}));
}

function buildAgentTaskCandidates(
	findings: AgentLabConsolidatedFinding[],
	runs: NormalizedRunSummary[],
): AgentLabAgentTaskCandidate[] {
	const candidates = findings.flatMap((finding) => {
		const type = taskTypeForFinding(finding);
		if (!type) return [];
		return [
			{
				id: "",
				type,
				category: "review" as const,
				title: finding.title,
				priority: priorityForSeverity(finding.severity),
				reason: finding.description,
				recommendation:
					"Revisar y convertir en tarea sólo si el humano lo aprueba.",
				evidence: finding.evidence.join("; "),
				requiresHumanApproval: ["high", "critical"].includes(finding.severity),
				dedupeKey: `agentlab:${type}:${normalizeText(finding.title)}`,
				sourceRequestIds: [finding.sourceRequestId],
			},
		];
	});
	for (const run of runs) {
		if (
			[
				"security",
				"database",
				"skill_review",
				"architecture",
				"code_quality",
				"ui_ux",
			].includes(run.specialty) &&
			!candidates.some((candidate) =>
				candidate.sourceRequestIds.includes(run.requestId),
			)
		) {
			const type = taskTypeFromText(
				run.rawSummary || run.specialty,
				run.specialty,
			);
			candidates.push({
				id: "",
				type,
				category: "review",
				title: run.rawSummary || `Revisar ${run.specialty}`,
				priority: 60,
				reason: run.rawSummary || `AgentLab ${run.specialty}`,
				recommendation: "Revisar tarea candidata antes de encolarla.",
				evidence: run.rawSummary,
				requiresHumanApproval: run.requiresHumanApproval,
				dedupeKey: `agentlab:${type}:${normalizeText(run.rawSummary || run.requestId)}`,
				sourceRequestIds: [run.requestId],
			});
		}
		for (const task of arrayOfStrings(
			record(run.parsedReport).suggestedAgentTasks,
		)) {
			const type = taskTypeFromText(task, run.specialty);
			candidates.push({
				id: "",
				type,
				category: "review",
				title: task,
				priority: 70,
				reason: task,
				recommendation: "Revisar tarea candidata antes de encolarla.",
				evidence: run.rawSummary,
				requiresHumanApproval: true,
				dedupeKey: `agentlab:${type}:${normalizeText(task)}`,
				sourceRequestIds: [run.requestId],
			});
		}
	}
	return dedupeBy(candidates, (item) => item.dedupeKey).map((item, index) => ({
		...item,
		id: `agentlab-task-${String(index + 1).padStart(3, "0")}`,
	}));
}

function buildRisks(
	findings: AgentLabConsolidatedFinding[],
	failed: number,
): string[] {
	const risks = findings
		.filter((finding) => ["high", "critical"].includes(finding.severity))
		.map((finding) => `${finding.severity}: ${finding.title}`);
	if (failed > 0) risks.push(`failed runs: ${failed}`);
	return unique(risks);
}

function normalizeFinding(
	value: unknown,
	run: NormalizedRunSummary,
): AgentLabConsolidatedFinding | undefined {
	const item = record(value);
	const title = stringValue(item.title);
	const evidence = stringValue(item.evidence);
	if (!title || !evidence) return undefined;
	return {
		title,
		description: stringValue(item.description) || title,
		evidence: [evidence],
		severity: severityValue(item.severity),
		confidence: confidenceValue(item.confidence),
		specialty: run.specialty,
		affectedFiles: unique(arrayOfStrings(item.affectedFiles)),
		affectedFlows: unique(arrayOfStrings(item.affectedFlows)),
		relatedRules: unique(arrayOfStrings(item.relatedRules)),
		controlPillars: unique(arrayOfStrings(item.controlPillars)).filter(
			isControlPillar,
		),
		sourceRunId: `${run.requestId}:${run.specialty}`,
		sourceRequestId: run.requestId,
	};
}

function normalizeRecommendation(
	value: unknown,
	requestId: string,
): AgentLabConsolidatedRecommendation | undefined {
	const item = record(value);
	const title = stringValue(item.title);
	if (!title) return undefined;
	return {
		title,
		description: stringValue(item.description) || title,
		rationale: stringValue(item.rationale),
		expectedBenefit: stringValue(item.expectedBenefit) || "quality",
		risk: stringValue(item.risk),
		requiresHumanApproval: item.requiresHumanApproval === true,
		suggestedNextStep: stringValue(item.suggestedNextStep),
		sourceRequestIds: [requestId],
	};
}

function normalizeReviewRun(
	value: unknown,
): { valid: true; run: NormalizedRun } | { valid: false; errors: string[] } {
	const item = record(value) as RunLike;
	const errors: string[] = [];
	if (item.warning !== "Revisión AgentLab. No aplica cambios.") {
		errors.push("El archivo no parece un agentlab-review-run válido.");
	}
	const projectId = stringValue(item.projectId);
	if (!projectId) errors.push("Falta projectId.");
	if (!Array.isArray(item.runs)) errors.push("Falta runs[].");
	if (errors.length) return { valid: false, errors };
	return {
		valid: true,
		run: {
			projectId,
			requiresHumanApproval: record(value).requiresHumanApproval === true,
			runs: (item.runs as unknown[]).map(normalizeRunSummary),
		},
	};
}

function normalizeRunSummary(value: unknown): NormalizedRunSummary {
	const item = record(value) as RunSummaryLike;
	return {
		requestId: stringValue(item.requestId) || "unknown-request",
		specialty: specialtyValue(item.specialty),
		status: stringValue(item.status) || "failed",
		rawSummary: stringValue(item.rawSummary),
		parsedReport: item.parsedReport,
		findings: arrayOfRecords(item.findings),
		recommendations: arrayOfRecords(item.recommendations),
		testsSuggested: arrayOfStrings(item.testsSuggested),
		requiresHumanApproval: item.requiresHumanApproval === true,
	};
}

function normalizeConsolidation(
	value: unknown,
	path: string,
):
	| { valid: true; result: AgentLabConsolidationResult; errors: [] }
	| { valid: false; errors: string[]; result?: undefined } {
	const item = record(value);
	const errors: string[] = [];
	if (item.warning !== WARNING)
		errors.push("El archivo no es una consolidación AgentLab válida.");
	if (!Array.isArray(item.consolidatedFindings))
		errors.push("Falta consolidatedFindings[].");
	if (!Array.isArray(item.consolidatedRecommendations))
		errors.push("Falta consolidatedRecommendations[].");
	if (errors.length) return { valid: false, errors };
	return {
		valid: true,
		result: {
			...(item as unknown as AgentLabConsolidationResult),
			path,
			valid: true,
			errors: [],
		},
		errors: [],
	};
}

type NormalizedRun = {
	projectId: string;
	requiresHumanApproval: boolean;
	runs: NormalizedRunSummary[];
};

type NormalizedRunSummary = {
	requestId: string;
	specialty: AgentLabSpecialty;
	status: string;
	rawSummary: string;
	parsedReport?: unknown;
	findings: Record<string, unknown>[];
	recommendations: Record<string, unknown>[];
	testsSuggested: string[];
	requiresHumanApproval: boolean;
};

function resolveReportPath(
	pathOrLatest: string,
	reportsPath: string,
	fileRe: RegExp,
	label: string,
):
	| { valid: true; path: string; errors: [] }
	| { valid: false; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	const requested = pathOrLatest.trim() || "latest";
	const path =
		requested === "latest"
			? latestFile(reports, fileRe)
			: resolveCandidate(reports, requested);
	if (!path) {
		return {
			valid: false,
			path: "",
			errors: [`No encontré archivos ${label}-*.json en reports.`],
		};
	}
	const rel = relative(reports, path);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		return {
			valid: false,
			path,
			errors: ["El archivo debe estar dentro de reports."],
		};
	}
	if (!fileRe.test(basename(path))) {
		return {
			valid: false,
			path,
			errors: [`El archivo debe llamarse ${label}-YYYYMMDD-HHMMSS.json.`],
		};
	}
	if (!existsSync(path))
		return { valid: false, path, errors: ["El archivo no existe."] };
	return { valid: true, path, errors: [] };
}

function resolveCandidate(reports: string, requested: string): string {
	if (isAbsolute(requested)) return resolve(requested);
	if (requested.startsWith("reports/"))
		return resolve(join(reports, requested.slice("reports/".length)));
	return resolve(join(reports, requested));
}

function latestFile(reports: string, fileRe: RegExp): string | undefined {
	if (!existsSync(reports)) return undefined;
	const latest = readdirSync(reports)
		.filter((file) => fileRe.test(file))
		.sort()
		.at(-1);
	return latest ? join(reports, latest) : undefined;
}

function readJson(
	path: string,
): { valid: true; value: unknown } | { valid: false; errors: string[] } {
	try {
		return {
			valid: true,
			value: JSON.parse(readFileSync(path, "utf8")) as unknown,
		};
	} catch (error) {
		return {
			valid: false,
			errors: [
				`JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

function invalidResult(
	generatedAt: string,
	sourceReviewRun: string,
	errors: string[],
): AgentLabConsolidationResult {
	return {
		valid: false,
		errors,
		generatedAt,
		sourceReviewRun,
		projectId: "",
		warning: WARNING,
		summary: "No pude consolidar el reporte AgentLab.",
		consolidatedFindings: [],
		consolidatedRecommendations: [],
		testsSuggested: [],
		supervisorImprovementCandidates: [],
		skillImprovementCandidates: [],
		semanticMemoryCandidates: [],
		agentTaskCandidates: [],
		risks: [],
		requiresHumanApproval: true,
		recommendedNext: ["corregir el reporte fuente", "volver a consolidar"],
	};
}

function formatInvalid(
	title: string,
	result: AgentLabConsolidationResult,
): string {
	return [
		title,
		"",
		"Válido:",
		"no",
		"",
		"Errores:",
		...formatList(result.errors),
		"",
		"Nota segura:",
		"No apliqué cambios ni ejecuté AgentLabs.",
	].join("\n");
}

function formatFindingCounts(
	findings: AgentLabConsolidatedFinding[],
): string[] {
	return ["high", "medium", "low"].map(
		(severity) =>
			`- ${severity}: ${findings.filter((finding) => finding.severity === severity).length}`,
	);
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(record) : [];
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items)];
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): T[] {
	const seen = new Set<string>();
	const result: T[] = [];
	for (const item of items) {
		const key = keyFor(item);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}
	return result;
}

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^a-z0-9]+/gu, " ")
		.trim();
}

function textFor(finding: AgentLabConsolidatedFinding): string {
	return normalizeText(
		`${finding.title} ${finding.description} ${finding.specialty} ${finding.controlPillars.join(" ")}`,
	);
}

function severityValue(value: unknown): AgentLabFindingSeverity {
	return SEVERITY_ORDER.includes(value as AgentLabFindingSeverity)
		? (value as AgentLabFindingSeverity)
		: "medium";
}

function confidenceValue(value: unknown): AgentLabConfidence {
	return CONFIDENCE_ORDER.includes(value as AgentLabConfidence)
		? (value as AgentLabConfidence)
		: "medium";
}

function maxSeverity(
	a: AgentLabFindingSeverity,
	b: AgentLabFindingSeverity,
): AgentLabFindingSeverity {
	return SEVERITY_ORDER.indexOf(a) > SEVERITY_ORDER.indexOf(b) ? a : b;
}

function maxConfidence(
	a: AgentLabConfidence,
	b: AgentLabConfidence,
): AgentLabConfidence {
	return CONFIDENCE_ORDER.indexOf(a) > CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

function specialtyValue(value: unknown): AgentLabSpecialty {
	const specialties: AgentLabSpecialty[] = [
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
		"general",
	];
	return specialties.includes(value as AgentLabSpecialty)
		? (value as AgentLabSpecialty)
		: "general";
}

function isControlPillar(value: string): value is SupervisorControlPillar {
	return [
		"quality",
		"time",
		"token_cost",
		"safety",
		"reporting",
		"resources",
		"architecture_consistency",
		"learning",
	].includes(value);
}

function compareFindings(
	a: AgentLabConsolidatedFinding,
	b: AgentLabConsolidatedFinding,
): number {
	return (
		SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) ||
		a.title.localeCompare(b.title)
	);
}

function supervisorTypeForFinding(
	finding: AgentLabConsolidatedFinding,
): SupervisorImprovementProposalType | undefined {
	const text = textFor(finding);
	if (
		finding.specialty === "token_cost" ||
		text.includes("token") ||
		text.includes("context")
	)
		return "workflow_improvement";
	if (
		text.includes("project core") ||
		text.includes("constitution") ||
		text.includes("flow") ||
		finding.specialty === "project_understanding" ||
		finding.specialty === "architecture"
	)
		return "project_core_review";
	if (
		finding.specialty === "security" ||
		text.includes("security") ||
		text.includes("auth") ||
		text.includes("login")
	)
		return "workflow_improvement";
	return undefined;
}

function taskTypeForFinding(
	finding: AgentLabConsolidatedFinding,
): SemanticAgentTaskType | undefined {
	const text = textFor(finding);
	if (finding.specialty === "database") return "database";
	if (finding.specialty === "security") return "security";
	if (finding.specialty === "skill_review") return "skill_review";
	if (finding.specialty === "architecture") return "architecture";
	if (text.includes("database") || text.includes("schema")) return "database";
	if (
		text.includes("security") ||
		text.includes("auth") ||
		text.includes("login")
	)
		return "security";
	if (text.includes("skill")) return "skill_review";
	if (
		text.includes("project core") ||
		text.includes("constitution") ||
		text.includes("flow")
	)
		return "architecture";
	if (finding.specialty === "code_quality") return "code_quality";
	if (finding.specialty === "ui_ux") return "ui_ux";
	return undefined;
}

function taskTypeFromText(
	text: string,
	specialty: AgentLabSpecialty,
): SemanticAgentTaskType {
	return (
		taskTypeForFinding({
			title: text,
			description: text,
			evidence: [text],
			severity: "medium",
			confidence: "medium",
			specialty,
			affectedFiles: [],
			affectedFlows: [],
			relatedRules: [],
			controlPillars: [],
			sourceRunId: "",
			sourceRequestId: "",
		}) ?? "code_quality"
	);
}

function riskForSeverity(
	severity: AgentLabFindingSeverity,
): SupervisorImprovementRisk & SkillImprovementRisk {
	if (severity === "critical") return "critical";
	if (severity === "high") return "high";
	if (severity === "medium") return "medium";
	return "low";
}

function benefitsFromPillars(
	pillars: SupervisorControlPillar[],
): SupervisorImprovementBenefit[] {
	const benefits = pillars.map((pillar) => {
		if (pillar === "token_cost") return "token_cost";
		if (pillar === "time") return "time";
		if (pillar === "safety") return "safety";
		if (pillar === "architecture_consistency")
			return "architecture_consistency";
		return "quality";
	});
	return unique(benefits as SupervisorImprovementBenefit[]);
}

function benefitForRecommendation(
	benefit: string,
): SupervisorImprovementBenefit {
	if (
		["time", "token_cost", "safety", "architecture_consistency"].includes(
			benefit,
		)
	)
		return benefit as SupervisorImprovementBenefit;
	return "quality";
}

function memoryImportanceForSeverity(
	severity: AgentLabFindingSeverity,
): "critical" | "high" | "medium" | "low" {
	if (severity === "critical") return "critical";
	if (severity === "high") return "high";
	if (severity === "medium") return "medium";
	return "low";
}

function priorityForSeverity(severity: AgentLabFindingSeverity): number {
	if (severity === "critical") return 100;
	if (severity === "high") return 90;
	if (severity === "medium") return 70;
	return 50;
}

function skillNameFromText(text: string): string {
	const match = /skill\s+([a-z0-9_-]+)/iu.exec(text);
	return match?.[1] ?? "unknown-skill";
}
