import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentProfile } from "./config.js";
import type { AgentRouter } from "./agent-router.js";
import { loadLabProjectContext } from "./lab-context.js";
import type { ModelInvocationRecord } from "./model-invocation-log.js";
import {
	buildAgentLabWorkloadEnvelope,
	formatAgentLabReviewRequestForPrompt,
	validateAgentLabReportAgainstSupervisorContract,
	validateAgentLabReviewRequest,
	type AgentLabFinding,
	type AgentLabRecommendation,
	type AgentLabReviewReport,
	type AgentLabReviewRequest,
	type AgentLabSpecialty,
	type AgentLabWorkloadEnvelope,
} from "./agentlab-supervisor-contract.js";
import {
	reviewAgentLabReviewRequest,
	type AgentLabReviewRequestPlan,
} from "./agentlab-review-requests.js";
import { cleanAgentOutput, summarizeOutput } from "./lab-reports.js";
import {
	profileForModelRole,
	type IduModelRoleId,
	type ModelAssignments,
} from "./model-assignments.js";

export type AgentLabReviewRunStatus =
	| "completed"
	| "partial"
	| "timed_out"
	| "skipped"
	| "failed"
	| "security_violation";

export type AgentLabReviewRunSummary = {
	requestId: string;
	specialty: AgentLabSpecialty;
	status: AgentLabReviewRunStatus;
	agentId?: string;
	workspace?: string;
	commandsExecuted: string[];
	rawSummary: string;
	parsedReport?: AgentLabReviewReport;
	contractValidation: {
		valid: boolean;
		errors: string[];
	};
	findings: AgentLabFinding[];
	recommendations: AgentLabRecommendation[];
	testsSuggested: string[];
	requiresHumanApproval: boolean;
	realRepoChangedFiles?: string[];
	securityWarnings?: string[];
	qualityWarnings?: string[];
	workloadEnvelope?: AgentLabWorkloadEnvelope;
};

export type AgentLabReviewRunResult = {
	generatedAt: string;
	sourceRequestFile: string;
	warning: "Revisión AgentLab. No aplica cambios.";
	projectId: string;
	runs: AgentLabReviewRunSummary[];
	consolidatedSummary: string;
	consolidatedFindings: AgentLabFinding[];
	recommendedNext: string;
	requiresHumanApproval: boolean;
	safeNotes: string[];
	workloadEnvelope?: AgentLabWorkloadEnvelope;
	path?: string;
};

export type AgentLabReviewStatus = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	result?: AgentLabReviewRunResult;
	workloadEnvelope?: AgentLabWorkloadEnvelope;
};

export type RunAgentLabReviewRequestFileInput = {
	pathOrLatest: string;
	reportsPath: string;
	projectId: string;
	projectPath: string;
	router: AgentRouter;
	profileId?: string;
	modelAssignments?: ModelAssignments;
	now?: () => Date;
	stateRoot?: string;
	invocationSink?: (record: ModelInvocationRecord) => void;
};

export type RunAgentLabReviewRequestInput = {
	request: AgentLabReviewRequest;
	projectPath: string;
	router: AgentRouter;
	profile?: AgentProfile;
	modelAssignments?: ModelAssignments;
	now?: () => Date;
	/**
	 * B5 PR2: when provided (along with `invocationSink`) the runner
	 * routes through `router.promptForRole` instead of the profile's
	 * session, so the request's `model` field is honored and a record
	 * is appended to the invocation sink.
	 */
	stateRoot?: string;
	invocationSink?: (record: ModelInvocationRecord) => void;
	role?: import("./model-assignments.js").IduModelRoleId;
};

export type RealRepoSnapshot = {
	ok: boolean;
	projectPath: string;
	head: string;
	branch: string;
	status: string;
	trackedDiff: string;
	stagedDiff: string;
	untracked: Record<string, string>;
	files: string[];
	fileStates: Record<string, string>;
	warnings: string[];
	error?: string;
};

export type RealRepoDiff = {
	changed: boolean;
	changedFiles: string[];
	errors: string[];
};

const WARNING = "Revisión AgentLab. No aplica cambios." as const;
const RUN_CURRENT_FILE = "current.json";
const RUN_RE = /^(?:current|agentlab-review-run-\d{8}-\d{6})\.json$/u;

export async function runAgentLabReviewRequestFile(
	input: RunAgentLabReviewRequestFileInput,
): Promise<AgentLabReviewRunResult> {
	const requestReview = reviewAgentLabReviewRequest(
		input.pathOrLatest,
		input.reportsPath,
	);
	const now = input.now?.() ?? new Date();
	const generatedAt = now.toISOString();
	const sourceRequestFile = requestReview.path;
	let runs: AgentLabReviewRunSummary[] = [];
	if (!requestReview.valid || !requestReview.plan) {
		runs = [
			{
				requestId: "invalid-request-file",
				specialty: "general",
				status: "failed",
				commandsExecuted: [],
				rawSummary: "Request file inválido; no ejecuté AgentLabs.",
				contractValidation: {
					valid: false,
					errors: requestReview.errors,
				},
				findings: [],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: true,
				workloadEnvelope: buildAgentLabWorkloadEnvelope({
					status: "failed",
					statusReason:
						"AgentLab request file was invalid; no labs were executed.",
					generatedAt,
					source: "run",
					requestIds: ["invalid-request-file"],
					runs: [
						{
							requestId: "invalid-request-file",
							status: "failed",
							requiresHumanApproval: true,
						},
					],
				}),
			},
		];
	} else {
		runs = await runPlanRequests({
			plan: requestReview.plan,
			projectPath: input.projectPath,
			router: input.router,
			profileId: input.profileId,
			modelAssignments: input.modelAssignments,
			now: input.now,
			stateRoot: input.stateRoot,
			invocationSink: input.invocationSink,
		});
	}
	const result = buildRunResult({
		generatedAt,
		sourceRequestFile,
		projectId: input.projectId,
		runs,
	});
	const directory = runArtifactsDir(input.reportsPath);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, RUN_CURRENT_FILE);
	writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	return { ...result, path };
}

export async function runAgentLabReviewRequest(
	input: RunAgentLabReviewRequestInput,
): Promise<AgentLabReviewRunSummary> {
	const requestValidation = validateAgentLabReviewRequest(input.request);
	if (!requestValidation.ok) {
		return skippedRun(
			input.request,
			"Request inválido; no ejecuté AgentLab.",
			requestValidation.errors,
		);
	}
	const profile =
		input.profile ??
		selectAgentLabProfile(
			input.router,
			input.request.specialty,
			input.modelAssignments,
		);
	if (!profile) {
		return skippedRun(
			input.request,
			`No hay AgentLab compatible para ${input.request.specialty}.`,
			[],
		);
	}
	const runtime = input.router.profiles.some(
		(candidate) => candidate.id === profile.id,
	)
		? input.router.runtimeForProfile(profile.id)
		: input.router.runtimeForAdHocProfile(profile);
	if (runtime.workspaceKind !== "clone") {
		return skippedRun(
			input.request,
			"Saltado: el agente no usa workspace clone.",
			[],
			profile,
			runtime.cwd,
		);
	}
	if (runtime.session.busy) {
		return skippedRun(
			input.request,
			"Saltado: el agente ya estaba ocupado.",
			[],
			profile,
			runtime.cwd,
		);
	}
	const before = snapshotRealRepoState(input.projectPath);
	if (!before.ok) {
		return failedRun(
			input.request,
			profile,
			runtime.cwd,
			before.error ?? "No pude leer estado git del repo real.",
			[
				`security_violation: no pude tomar snapshot inicial del repo real: ${before.error ?? "error desconocido"}`,
			],
		);
	}
	const timeoutMs = Math.max(1, input.request.maxMinutes) * 60_000;
	let run: AgentLabReviewRunSummary;
	try {
		const prompt = buildReviewPrompt(
			input.request,
			profile,
			input.projectPath,
			input.stateRoot ?? input.projectPath,
		);
		// B5 PR2 wiring: when the caller passes stateRoot + invocationSink,
		// honor request.model by routing through router.promptForRole. This
		// spawns a session with --provider/--model and feeds the invocation
		// sink. Otherwise we keep the existing profile path.
		const usePromptForRole =
			Boolean(input.request.model) &&
			Boolean(input.stateRoot) &&
			Boolean(input.invocationSink);
		const result = usePromptForRole
			? await Promise.race([
					input.router.promptForRole(
						input.role ?? mapSpecialtyToRole(input.request.specialty),
						prompt,
						{
							projectId: input.request.projectId,
							stateRoot: input.stateRoot!,
							invocationSink: input.invocationSink,
						},
					),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("LAB_TIMEOUT")),
							timeoutMs,
						).unref(),
					),
				])
			: await Promise.race([
					runtime.session.prompt(prompt),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("LAB_TIMEOUT")),
							timeoutMs,
						).unref(),
					),
				]);
		const parsed = extractAgentLabReviewReportFromOutput(
			result.output,
			input.request,
		);
		if (!result.ok) {
			run = failedRun(input.request, profile, runtime.cwd, result.output, [
				"AgentLab retornó status failed.",
				...parsed.errors,
			]);
		} else if (!parsed.report) {
			// FIX 1 (fail-loud): invalid JSON or no parseable report must NOT
			// become a bogus "completed"/"partial" run. Propagate the first
			// parser error as the visible reason via contractValidation.errors.
			const reason =
				parsed.errors[0] ?? "AgentLab output no produjo AgentLabReviewReport.";
			run = failedRun(input.request, profile, runtime.cwd, result.output, [
				`invalid-json: ${reason}`,
			]);
		} else {
			run = completedRun(
				input.request,
				profile,
				runtime.cwd,
				result.output,
				parsed,
			);
		}
	} catch (error) {
		const timeout = error instanceof Error && error.message === "LAB_TIMEOUT";
		if (timeout) runtime.session.cancel();
		run = failedRun(
			input.request,
			profile,
			runtime.cwd,
			timeout
				? "Tiempo máximo alcanzado; agente cancelado."
				: "Ejecución falló.",
			[error instanceof Error ? error.message : String(error)],
			timeout ? "timed_out" : "failed",
		);
	} finally {
		runtime.session.stop("AgentLab review-only finalizado.");
	}
	const after = snapshotRealRepoState(input.projectPath);
	const realRepoDiff = diffRealRepoState(before, after);
	return realRepoDiff.changed
		? securityViolationRun(
				input.request,
				profile,
				runtime.cwd,
				run,
				realRepoDiff,
			)
		: run;
}

export function getAgentLabReviewStatus(
	pathOrLatest: string,
	reportsPath: string,
): AgentLabReviewStatus {
	const resolved = resolveRunPath(pathOrLatest, reportsPath);
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
		const result = normalizeRunResult(raw);
		const bindingErrors = currentRequestBindingErrors(
			pathOrLatest,
			reportsPath,
			result,
		);
		if (bindingErrors.length > 0) {
			return {
				path: resolved.path,
				name: basename(resolved.path),
				valid: false,
				errors: bindingErrors,
				workloadEnvelope: buildAgentLabWorkloadEnvelope({
					status: "stale",
					statusReason: bindingErrors[0] ?? "AgentLab run stale.",
					generatedAt: result.generatedAt,
					source: "status",
					runs: result.runs,
				}),
			};
		}
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: true,
			errors: [],
			result,
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

function currentRequestBindingErrors(
	pathOrLatest: string,
	reportsPath: string,
	result: AgentLabReviewRunResult,
): string[] {
	const selector = pathOrLatest.trim();
	if (
		selector &&
		selector !== "latest" &&
		basename(selector) !== RUN_CURRENT_FILE
	) {
		return [];
	}
	const requestReview = reviewAgentLabReviewRequest("latest", reportsPath);
	if (!requestReview.valid || !requestReview.plan) return [];
	const currentRequestIds = new Set(
		requestReview.plan.requests.map((request) => request.id),
	);
	const runRequestIds = result.runs.map((run) => run.requestId);
	const missingCurrentRequestIds = [...currentRequestIds].filter(
		(id) => !runRequestIds.includes(id),
	);
	const runGeneratedAt = Date.parse(result.generatedAt);
	const requestGeneratedAt = Date.parse(requestReview.plan.generatedAt);
	const runIsOlderThanCurrentRequest =
		Number.isFinite(runGeneratedAt) &&
		Number.isFinite(requestGeneratedAt) &&
		runGeneratedAt < requestGeneratedAt;
	if (!runIsOlderThanCurrentRequest && missingCurrentRequestIds.length === 0) {
		return [];
	}
	return [
		"AgentLab run stale: el request actual todavía no tiene una revisión AgentLab válida.",
		`Request actual: ${requestReview.name}`,
		`Run leído: ${result.generatedAt}`,
		...(missingCurrentRequestIds.length > 0
			? [`Requests pendientes sin run: ${missingCurrentRequestIds.join(", ")}`]
			: []),
	];
}

export function formatAgentLabReviewRunResult(
	result: AgentLabReviewRunResult,
): string {
	const counts = countRuns(result.runs);
	return [
		"AgentLab Review Run",
		"",
		"Ruta:",
		result.path ?? "- no escrita",
		"",
		"Requests:",
		String(result.runs.length),
		"Completed:",
		String(counts.completed),
		"Skipped:",
		String(counts.skipped),
		"Failed:",
		String(counts.failed),
		"Security violations:",
		String(counts.security_violation),
		"",
		"Specialties:",
		formatList([...new Set(result.runs.map((run) => run.specialty))]),
		"",
		"Findings high/critical:",
		String(highCriticalFindings(result.consolidatedFindings).length),
		"",
		"Requires human approval:",
		String(result.requiresHumanApproval),
		"",
		"Quality warnings:",
		formatList(result.runs.flatMap((run) => run.qualityWarnings ?? [])),
		"",
		"Recommended next:",
		result.recommendedNext,
		"",
		"Notas seguras:",
		formatList(result.safeNotes),
	].join("\n");
}

export function formatAgentLabReviewStatus(
	status: AgentLabReviewStatus,
): string {
	if (!status.valid || !status.result) {
		return [
			"AgentLab Review Status",
			"",
			"Archivo:",
			status.name || status.path,
			"",
			"Válido:",
			"no",
			"",
			"Errores:",
			formatList(status.errors),
		].join("\n");
	}
	return [
		"AgentLab Review Status",
		"",
		"Source request:",
		status.result.sourceRequestFile,
		"",
		"Estado por specialty:",
		formatList(
			status.result.runs.map(
				(run) =>
					`${run.specialty}: ${run.status} (${sanitizeAgentLabSummary(run.rawSummary)})`,
			),
		),
		"",
		"Security warnings:",
		formatList(status.result.runs.flatMap((run) => run.securityWarnings ?? [])),
		"",
		"Quality warnings:",
		formatList(status.result.runs.flatMap((run) => run.qualityWarnings ?? [])),
		"",
		"Findings:",
		formatList(
			status.result.consolidatedFindings.map((finding) => finding.title),
		),
		"",
		"Recommendations:",
		formatList(
			status.result.runs.flatMap((run) =>
				run.recommendations.map((recommendation) => recommendation.title),
			),
		),
		"",
		"Tests suggested:",
		formatList(status.result.runs.flatMap((run) => run.testsSuggested)),
		"",
		"Next steps:",
		status.result.recommendedNext,
	].join("\n");
}

export function parseAgentLabReviewReportFromOutput(
	output: string,
	request: AgentLabReviewRequest,
): {
	report?: AgentLabReviewReport;
	errors: string[];
	qualityWarnings?: string[];
} {
	return extractAgentLabReviewReportFromOutput(output, request);
}

export function extractAgentLabReviewReportFromOutput(
	output: string,
	request: AgentLabReviewRequest,
): {
	report?: AgentLabReviewReport;
	errors: string[];
	qualityWarnings?: string[];
} {
	const errors: string[] = [];
	for (const candidate of jsonCandidates(output)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			const result = validateAgentLabReportAgainstSupervisorContract(
				parsed,
				request,
			);
			if (result.ok) return { report: result.report, errors: [] };
			if (looksLikeReviewReport(parsed)) {
				const repaired = repairAgentLabReviewReport(parsed, request, output);
				const repairedResult = validateAgentLabReportAgainstSupervisorContract(
					repaired,
					request,
				);
				if (repairedResult.ok)
					return {
						report: repairedResult.report,
						errors: [],
						qualityWarnings: [
							"AgentLab devolvió un reporte parcial; Idu-pi lo reparó antes de consolidar.",
						],
					};
				errors.push(...result.errors);
			}
		} catch (error) {
			if (looksLikeReviewReportJson(candidate)) {
				errors.push(error instanceof Error ? error.message : String(error));
			}
		}
	}
	return {
		errors: errors.length
			? dedupe(errors)
			: ["No encontré AgentLabReviewReport JSON válido."],
	};
}

function repairAgentLabReviewReport(
	value: unknown,
	request: AgentLabReviewRequest,
	output: string,
): AgentLabReviewReport {
	const source = isRecord(value) ? value : {};
	return {
		...fallbackAgentLabReviewReport(request, legacySummary(output)),
		id: stringValue(source.id) ?? `report-${request.id}`,
		requestId: request.id,
		projectId: request.projectId,
		specialty: request.specialty,
		status: statusValue(source.status),
		summary: stringValue(source.summary) ?? legacySummary(output),
		qualityFindings: repairFindings(source.qualityFindings, request, "quality"),
		safetyFindings: repairFindings(source.safetyFindings, request, "safety"),
		architectureFindings: repairFindings(
			source.architectureFindings,
			request,
			"architecture",
		),
		tokenCostFindings: repairFindings(
			source.tokenCostFindings,
			request,
			"token_cost",
		),
		timeFindings: repairFindings(source.timeFindings, request, "time"),
		resourceFindings: repairFindings(
			source.resourceFindings,
			request,
			"resources",
		),
		testsSuggested: nonEmptyStringArray(source.testsSuggested),
		testsExecuted: nonEmptyStringArray(source.testsExecuted),
		evidence: nonEmptyStringArray(source.evidence, fallbackEvidence(request)),
		recommendations: repairRecommendations(source.recommendations, request),
		proposedSupervisorActions: nonEmptyStringArray(
			source.proposedSupervisorActions,
		),
		suggestedSkillUpdates: nonEmptyStringArray(source.suggestedSkillUpdates),
		suggestedRuleUpdates: nonEmptyStringArray(source.suggestedRuleUpdates),
		suggestedAgentTasks: nonEmptyStringArray(source.suggestedAgentTasks),
		confidence: confidenceValue(source.confidence),
		requiresHumanApproval:
			typeof source.requiresHumanApproval === "boolean"
				? source.requiresHumanApproval
				: request.requiresHumanApproval,
		createdAt: stringValue(source.createdAt) ?? new Date().toISOString(),
	};
}

function fallbackAgentLabReviewReport(
	request: AgentLabReviewRequest,
	summary: string,
): AgentLabReviewReport {
	return {
		id: `report-${request.id}`,
		requestId: request.id,
		projectId: request.projectId,
		specialty: request.specialty,
		status: "completed",
		summary:
			summary && summary !== "(sin salida)"
				? summary
				: "Sin hallazgos reportados por AgentLab.",
		qualityFindings: [],
		safetyFindings: [],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: [],
		testsExecuted: [],
		evidence: fallbackEvidence(request),
		recommendations: [],
		proposedSupervisorActions: [],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "medium",
		requiresHumanApproval: request.requiresHumanApproval,
		createdAt: new Date().toISOString(),
	};
}

function repairFindings(
	value: unknown,
	request: AgentLabReviewRequest,
	category: string,
): AgentLabFinding[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item, index): AgentLabFinding[] => {
		const source = isRecord(item) ? item : { title: String(item) };
		const title = stringValue(source.title) ?? `Hallazgo ${index + 1}`;
		const description = stringValue(source.description) ?? title;
		return [
			{
				title,
				description,
				evidence: stringValue(source.evidence) ?? fallbackEvidence(request)[0]!,
				severity: severityValue(source.severity),
				confidence: confidenceValue(source.confidence),
				category: stringValue(source.category) ?? category,
				affectedFiles: nonEmptyStringArray(
					source.affectedFiles,
					request.filesToInspect.slice(0, 3),
				),
				affectedFlows: nonEmptyStringArray(source.affectedFlows),
				relatedRules: nonEmptyStringArray(source.relatedRules),
				controlPillars: repairControlPillars(source.controlPillars, category),
			},
		];
	});
}

function repairRecommendations(
	value: unknown,
	request: AgentLabReviewRequest,
): AgentLabRecommendation[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item, index): AgentLabRecommendation[] => {
		const source = isRecord(item) ? item : { title: String(item) };
		const title = stringValue(source.title) ?? `Recomendación ${index + 1}`;
		const description = stringValue(source.description) ?? title;
		return [
			{
				title,
				description,
				rationale: stringValue(source.rationale) ?? description,
				expectedBenefit: benefitValue(source.expectedBenefit),
				risk: stringValue(source.risk) ?? "review_required",
				requiresHumanApproval:
					typeof source.requiresHumanApproval === "boolean"
						? source.requiresHumanApproval
						: request.requiresHumanApproval,
				suggestedNextStep:
					stringValue(source.suggestedNextStep) ?? "Revisar manualmente.",
			},
		];
	});
}

function fallbackEvidence(request: AgentLabReviewRequest): string[] {
	return (
		nonEmptyStringArray(request.evidence) ??
		nonEmptyStringArray(request.filesToInspect) ?? [request.objective]
	);
}

function nonEmptyStringArray(
	value: unknown,
	fallback: string[] = [],
): string[] {
	if (!Array.isArray(value)) return fallback;
	const values = value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
	return values.length ? values : fallback;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function statusValue(value: unknown): AgentLabReviewReport["status"] {
	return value === "skipped" || value === "failed" ? value : "completed";
}

function severityValue(value: unknown): AgentLabFinding["severity"] {
	return value === "critical" ||
		value === "high" ||
		value === "medium" ||
		value === "low" ||
		value === "info"
		? value
		: "medium";
}

function confidenceValue(value: unknown): AgentLabReviewReport["confidence"] {
	return value === "low" || value === "high" ? value : "medium";
}

function benefitValue(
	value: unknown,
): AgentLabRecommendation["expectedBenefit"] {
	return value === "quality" ||
		value === "time" ||
		value === "token_cost" ||
		value === "safety" ||
		value === "architecture_consistency" ||
		value === "learning"
		? value
		: "quality";
}

function repairControlPillars(
	value: unknown,
	category: string,
): AgentLabFinding["controlPillars"] {
	const allowed = new Set<AgentLabFinding["controlPillars"][number]>([
		"quality",
		"time",
		"token_cost",
		"safety",
		"reporting",
		"resources",
		"architecture_consistency",
		"learning",
	]);
	if (Array.isArray(value)) {
		const values = value.filter(
			(item): item is AgentLabFinding["controlPillars"][number] =>
				typeof item === "string" &&
				allowed.has(item as AgentLabFinding["controlPillars"][number]),
		);
		if (values.length) return values;
	}
	if (category === "safety") return ["safety"];
	if (category === "architecture") return ["architecture_consistency"];
	if (category === "token_cost") return ["token_cost"];
	if (category === "time") return ["time"];
	if (category === "resources") return ["resources"];
	return ["quality"];
}

function buildReviewPrompt(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	projectPath: string,
	stateRoot: string,
): string {
	const context = loadLabProjectContext(projectPath, stateRoot);
	return [
		`Modo AgentLab review-only para ${profile.label}.`,
		"",
		"Reglas obligatorias:",
		"- Trabajá solo dentro de tu workspace/clon.",
		"- No modifiques el repo real.",
		"- No hagas commit.",
		"- No hagas push.",
		"- No apliques skills, reglas, Project Core, Constitution ni flows.",
		"- No modifiques schema ni migraciones.",
		"- No modifiques labPrompt ni infraestructura de ejecución AgentLab.",
		"- No borres memoria ni datos.",
		`- Corré como máximo ${request.maxCommands} comandos de test/verificación.`,
		`- Límite de tiempo solicitado: ${request.maxMinutes} minutos.`,
		"- Si no hay evidencia, devolvé findings vacíos.",
		"- Devolvé JSON AgentLabReviewReport válido; si no podés, texto legacy será guardado como partial sin findings.",
		"",
		...(context
			? [
					"Project context budget JSON:",
					JSON.stringify(context.contextBudget, null, 2),
					"",
					"Contexto del proyecto real:",
					context.text,
					"",
				]
			: []),
		formatAgentLabReviewRequestForPrompt(request),
		"",
		"SALIDA OBLIGATORIA: devolvé sólo un JSON AgentLabReviewReport válido, sin markdown, sin comentarios y sin texto antes/después.",
		"Todos los arrays deben existir aunque estén vacíos. Si no encontrás hallazgos, usá arrays vacíos pero mantené evidencia de archivos revisados.",
		`requestId debe ser ${request.id}; projectId debe ser ${request.projectId}; specialty debe ser ${request.specialty}.`,
		"Plantilla exacta mínima:",
		JSON.stringify(
			{
				id: `report-${request.id}`,
				requestId: request.id,
				projectId: request.projectId,
				specialty: request.specialty,
				status: "completed",
				summary: "Resumen breve de la revisión.",
				qualityFindings: [],
				safetyFindings: [],
				architectureFindings: [],
				tokenCostFindings: [],
				timeFindings: [],
				resourceFindings: [],
				testsSuggested: [],
				testsExecuted: [],
				evidence: ["master-plan.json revisado"],
				recommendations: [],
				proposedSupervisorActions: [],
				suggestedSkillUpdates: [],
				suggestedRuleUpdates: [],
				suggestedAgentTasks: [],
				confidence: "medium",
				requiresHumanApproval: request.requiresHumanApproval,
				createdAt: new Date().toISOString(),
			},
			null,
			2,
		),
	].join("\n");
}

export function selectAgentLabProfile(
	router: AgentRouter,
	specialty: AgentLabSpecialty,
	modelAssignments?: ModelAssignments,
): AgentProfile | undefined {
	const profiles = router.labProfiles();
	const assigned = modelAssignments
		? profileForModelRole(
				modelAssignments,
				agentLabRoleForSpecialty(specialty),
				router.profiles,
			)
		: undefined;
	if (assigned?.source === "direct-model") return assigned.profile;
	if (
		assigned?.source === "assigned" &&
		profiles.some((profile) => profile.id === assigned.profile.id)
	) {
		return assigned.profile;
	}
	const patterns = specialtyPatterns(specialty);
	return (
		profiles.find((profile) =>
			patterns.some((pattern) => profileMatches(profile, pattern)),
		) ??
		profiles.find((profile) => profileMatches(profile, /general/iu)) ??
		profiles[0]
	);
}

function agentLabRoleForSpecialty(
	specialty: AgentLabSpecialty,
): IduModelRoleId {
	switch (specialty) {
		case "security":
			return "agentlab-security";
		case "project_understanding":
			return "agentlab-project-understanding";
		case "architecture":
			return "agentlab-architecture";
		case "database":
			return "agentlab-database";
		case "ui_ux":
			return "agentlab-ui-ux";
		case "performance":
		case "token_cost":
			return "agentlab-performance";
		case "code_quality":
		case "skill_review":
			return "agentlab-code-quality";
		case "docs":
			return "agentlab-docs";
		case "librarian":
			return "agentlab-librarian";
		case "general":
			return "agentlab-general";
	}
}

function specialtyPatterns(specialty: AgentLabSpecialty): RegExp[] {
	switch (specialty) {
		case "security":
			return [/security|seguridad/iu, /general/iu];
		case "database":
			return [/database|db|datos/iu, /general/iu];
		case "architecture":
			return [/architecture|arquitectura|code[_ -]?quality/iu, /general/iu];
		case "ui_ux":
			return [/ui|ux|frontend/iu, /general/iu];
		case "performance":
		case "token_cost":
			return [/performance|perf/iu, /general/iu];
		case "skill_review":
			return [/skill[_ -]?review|code[_ -]?quality/iu, /general/iu];
		case "project_understanding":
			return [/architecture|project[_ -]?understanding/iu, /general/iu];
		case "docs":
			return [/docs?|documentation/iu, /general/iu];
		case "librarian":
			return [/librarian|bibliotecario|docs?|advisory|security/iu, /general/iu];
		case "code_quality":
			return [/code[_ -]?quality|quality/iu, /general/iu];
		case "general":
			return [/general/iu];
	}
}

function profileMatches(profile: AgentProfile, pattern: RegExp): boolean {
	return pattern.test(`${profile.id}\n${profile.label}`);
}

async function runPlanRequests(input: {
	plan: AgentLabReviewRequestPlan;
	projectPath: string;
	router: AgentRouter;
	profileId?: string;
	modelAssignments?: ModelAssignments;
	now?: () => Date;
	stateRoot?: string;
	invocationSink?: (record: ModelInvocationRecord) => void;
}): Promise<AgentLabReviewRunSummary[]> {
	const forcedProfile = input.profileId
		? input.router
				.labProfiles()
				.find((profile) => profile.id === input.profileId)
		: undefined;
	const runs: AgentLabReviewRunSummary[] = [];
	for (const request of input.plan.requests) {
		runs.push(
			await runAgentLabReviewRequest({
				request,
				projectPath: input.projectPath,
				router: input.router,
				profile: forcedProfile,
				modelAssignments: input.modelAssignments,
				now: input.now,
				stateRoot: input.stateRoot,
				invocationSink: input.invocationSink,
			}),
		);
	}
	return runs;
}

function workloadForRequestRun(
	request: AgentLabReviewRequest,
	status: AgentLabReviewRunStatus,
	statusReason: string,
): AgentLabWorkloadEnvelope {
	return buildAgentLabWorkloadEnvelope({
		status,
		statusReason,
		generatedAt: new Date().toISOString(),
		source: "run",
		requests: [request],
		runs: [
			{
				requestId: request.id,
				status,
				requiresHumanApproval: request.requiresHumanApproval,
			},
		],
	});
}

function completedRun(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	workspace: string,
	output: string,
	parsed: {
		report?: AgentLabReviewReport;
		errors: string[];
		qualityWarnings?: string[];
	},
): AgentLabReviewRunSummary {
	const reportFindings = parsed.report ? allFindings(parsed.report) : [];
	const status: AgentLabReviewRunStatus = parsed.qualityWarnings?.length
		? "partial"
		: "completed";
	return {
		requestId: request.id,
		specialty: request.specialty,
		status,
		agentId: profile.id,
		workspace,
		commandsExecuted: parsed.report?.testsExecuted ?? [],
		rawSummary: parsed.report?.summary ?? legacySummary(output),
		...(parsed.report ? { parsedReport: parsed.report } : {}),
		contractValidation: {
			valid: Boolean(parsed.report),
			errors: parsed.report ? [] : parsed.errors,
		},
		findings: reportFindings,
		recommendations: parsed.report?.recommendations ?? [],
		testsSuggested: parsed.report?.testsSuggested ?? [],
		...(parsed.qualityWarnings?.length
			? { qualityWarnings: parsed.qualityWarnings }
			: {}),
		requiresHumanApproval:
			parsed.report?.requiresHumanApproval ?? request.requiresHumanApproval,
		workloadEnvelope: workloadForRequestRun(
			request,
			status,
			status === "partial"
				? "AgentLab output required fallback/repair; evidence is partial."
				: "AgentLab completed with valid report.",
		),
	};
}

function failedRun(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	workspace: string,
	summary: string,
	errors: string[],
	status: Extract<AgentLabReviewRunStatus, "failed" | "timed_out"> = "failed",
): AgentLabReviewRunSummary {
	return {
		requestId: request.id,
		specialty: request.specialty,
		status,
		agentId: profile.id,
		workspace,
		commandsExecuted: [],
		rawSummary: legacySummary(summary),
		contractValidation: { valid: false, errors },
		findings: [],
		recommendations: [],
		testsSuggested: [],
		requiresHumanApproval: request.requiresHumanApproval,
		workloadEnvelope: workloadForRequestRun(
			request,
			status,
			status === "timed_out"
				? "AgentLab reached the explicit time limit."
				: "AgentLab run failed.",
		),
	};
}

function skippedRun(
	request: AgentLabReviewRequest,
	summary: string,
	errors: string[],
	profile?: AgentProfile,
	workspace?: string,
): AgentLabReviewRunSummary {
	return {
		requestId: request.id,
		specialty: request.specialty,
		status: "skipped",
		...(profile ? { agentId: profile.id } : {}),
		...(workspace ? { workspace } : {}),
		commandsExecuted: [],
		rawSummary: summary,
		contractValidation: { valid: false, errors },
		findings: [],
		recommendations: [],
		testsSuggested: [],
		requiresHumanApproval: request.requiresHumanApproval,
		workloadEnvelope: workloadForRequestRun(
			request,
			"skipped",
			"AgentLab request was skipped before execution.",
		),
	};
}

function securityViolationRun(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	workspace: string,
	previousRun: AgentLabReviewRunSummary,
	diff: RealRepoDiff,
): AgentLabReviewRunSummary {
	const warnings = [
		"AgentLab intentó o causó cambios en repo real.",
		...diff.changedFiles.map(
			(file) => `Cambio detectado en repo real: ${file}`,
		),
		...diff.errors,
	];
	return {
		requestId: request.id,
		specialty: request.specialty,
		status: "security_violation",
		agentId: profile.id,
		workspace,
		commandsExecuted: previousRun.commandsExecuted,
		rawSummary: "security_violation: AgentLab causó cambios en repo real.",
		contractValidation: {
			valid: false,
			errors: [
				"security_violation: cambios detectados en repo real",
				...warnings,
			],
		},
		findings: [],
		recommendations: [],
		testsSuggested: previousRun.testsSuggested,
		requiresHumanApproval: true,
		realRepoChangedFiles: diff.changedFiles,
		securityWarnings: warnings,
		workloadEnvelope: workloadForRequestRun(
			request,
			"security_violation",
			"AgentLab caused or attempted changes in the real repository.",
		),
	};
}

function buildRunResult(input: {
	generatedAt: string;
	sourceRequestFile: string;
	projectId: string;
	runs: AgentLabReviewRunSummary[];
}): AgentLabReviewRunResult {
	const consolidatedFindings = input.runs.flatMap((run) => run.findings);
	const requiresHumanApproval =
		input.runs.some((run) => run.requiresHumanApproval) ||
		highCriticalFindings(consolidatedFindings).length > 0;
	const aggregateStatus = aggregateWorkloadStatus(input.runs);
	return {
		generatedAt: input.generatedAt,
		sourceRequestFile: input.sourceRequestFile,
		warning: WARNING,
		projectId: input.projectId,
		runs: input.runs,
		consolidatedSummary: summaryForRuns(input.runs),
		consolidatedFindings,
		recommendedNext: requiresHumanApproval
			? "Revisar hallazgos y decidir manualmente; no apliqué cambios."
			: "Revisar reporte y decidir siguiente paso; no apliqué cambios.",
		requiresHumanApproval,
		safeNotes: [
			"AgentLabs se ejecutan sólo en workspace clone.",
			"No modifiqué repo real.",
			"No hice commit ni push.",
			"No apliqué skills, reglas, Project Core, Constitution ni flows.",
			...(input.runs.some((run) => run.status === "security_violation")
				? ["AgentLab intentó o causó cambios en repo real."]
				: []),
		],
		workloadEnvelope: buildAgentLabWorkloadEnvelope({
			status: aggregateStatus,
			statusReason: `AgentLab run aggregate status: ${aggregateStatus}.`,
			generatedAt: input.generatedAt,
			source: "run",
			runs: input.runs,
		}),
	};
}

function aggregateWorkloadStatus(
	runs: AgentLabReviewRunSummary[],
): AgentLabReviewRunStatus {
	const statuses = runs.map((run) => run.status);
	if (statuses.includes("security_violation")) return "security_violation";
	if (statuses.includes("timed_out")) return "timed_out";
	if (statuses.includes("failed")) return "failed";
	if (statuses.includes("partial")) return "partial";
	if (statuses.includes("completed")) return "completed";
	return "skipped";
}

export function snapshotRealRepoState(projectPath: string): RealRepoSnapshot {
	try {
		const head = runGit(projectPath, ["rev-parse", "HEAD"]).trim();
		const branch = runGit(projectPath, [
			"rev-parse",
			"--abbrev-ref",
			"HEAD",
		]).trim();
		const status = runGit(projectPath, ["status", "--porcelain=v1"]);
		const trackedDiff = runGit(projectPath, ["diff", "--binary"]);
		const stagedDiff = runGit(projectPath, ["diff", "--cached", "--binary"]);
		const untrackedFiles = runGit(projectPath, [
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
		])
			.split("\0")
			.filter(Boolean)
			.sort();
		const warnings: string[] = [];
		const untracked = Object.fromEntries(
			untrackedFiles.map((file) => [
				file,
				safePathState(projectPath, file, warnings),
			]),
		);
		const files = snapshotFiles(
			status,
			trackedDiff,
			stagedDiff,
			untrackedFiles,
		);
		return {
			ok: true,
			projectPath,
			head,
			branch,
			status,
			trackedDiff,
			stagedDiff,
			untracked,
			files,
			fileStates: snapshotFileStates(projectPath, files, warnings),
			warnings,
		};
	} catch (error) {
		return {
			ok: false,
			projectPath,
			head: "",
			branch: "",
			status: "",
			trackedDiff: "",
			stagedDiff: "",
			untracked: {},
			files: [],
			fileStates: {},
			warnings: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function diffRealRepoState(
	before: RealRepoSnapshot,
	after: RealRepoSnapshot,
): RealRepoDiff {
	const errors = [before, after]
		.filter((snapshot) => !snapshot.ok)
		.map(
			(snapshot) => snapshot.error ?? "No pude leer estado git del repo real.",
		);
	if (errors.length) return { changed: true, changedFiles: [], errors };
	const beforeSignature = snapshotSignature(before);
	const afterSignature = snapshotSignature(after);
	if (beforeSignature === afterSignature) {
		return { changed: false, changedFiles: [], errors: [] };
	}
	const files = [...new Set([...before.files, ...after.files])].sort();
	const changedFiles = files.filter(
		(file) => before.fileStates[file] !== after.fileStates[file],
	);
	if (before.head !== after.head) changedFiles.unshift("HEAD");
	if (before.branch !== after.branch) changedFiles.unshift("BRANCH");
	const dedupedChangedFiles = [...new Set(changedFiles)].sort();

	return {
		changed: true,
		changedFiles: dedupedChangedFiles,
		errors: [],
	};
}

export function assertRealRepoUnchanged(
	before: RealRepoSnapshot,
	after: RealRepoSnapshot,
): void {
	const diff = diffRealRepoState(before, after);
	if (diff.changed) {
		throw new Error(
			`security_violation: cambios detectados en repo real: ${diff.changedFiles.join(", ") || diff.errors.join("; ")}`,
		);
	}
}

function gitEnv(): NodeJS.ProcessEnv {
	return process.platform === "win32"
		? {
				...process.env,
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "core.longpaths",
				GIT_CONFIG_VALUE_0: "true",
			}
		: process.env;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: gitEnv(),
	});
}

function fileHash(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function snapshotSignature(snapshot: RealRepoSnapshot): string {
	return JSON.stringify({
		head: snapshot.head,
		branch: snapshot.branch,
		fileStates: snapshot.fileStates,
	});
}

function snapshotFileStates(
	projectPath: string,
	files: string[],
	warnings: string[],
): Record<string, string> {
	return Object.fromEntries(
		files.map((file) => [file, fileState(projectPath, file, warnings)]),
	);
}

function fileState(
	projectPath: string,
	file: string,
	warnings: string[],
): string {
	const content = safePathState(projectPath, file, warnings);
	return [
		content,
		runGit(projectPath, ["status", "--porcelain=v1", "--", file]),
		runGit(projectPath, ["diff", "--binary", "--", file]),
		runGit(projectPath, ["diff", "--cached", "--binary", "--", file]),
	].join("\n---\n");
}

function safePathState(
	projectPath: string,
	file: string,
	warnings: string[],
): string {
	const path = join(projectPath, file);
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			if (!existsSync(path))
				warnings.push(`snapshot_warning:broken_symlink:${file}`);
			return `symlink:${safeReadlink(path, file, warnings)}`;
		}
		if (stat.isDirectory()) {
			return `dir:mode=${stat.mode}:size=${stat.size}`;
		}
		if (!stat.isFile()) {
			return `other:mode=${stat.mode}:size=${stat.size}`;
		}
		return `file:${fileHash(path)}`;
	} catch (error) {
		const code = errorCode(error);
		if (isToleratedFsCode(code)) {
			warnings.push(`snapshot_warning:${code ?? "UNKNOWN"}:${file}`);
			return code === "ENOENT" ? "missing" : `unreadable:${code ?? "UNKNOWN"}`;
		}
		warnings.push(`snapshot_warning:${errorMessage(error)}:${file}`);
		return `unreadable:${errorMessage(error)}`;
	}
}

function safeReadlink(path: string, file: string, warnings: string[]): string {
	try {
		return readlinkSync(path);
	} catch (error) {
		warnings.push(
			`snapshot_warning:${errorCode(error) ?? errorMessage(error)}:${file}`,
		);
		return "unreadable";
	}
}

function isToleratedFsCode(code: string | undefined): boolean {
	return Boolean(
		code && ["EACCES", "EPERM", "ENOENT", "EISDIR"].includes(code),
	);
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function snapshotFiles(
	status: string,
	trackedDiff: string,
	stagedDiff: string,
	untrackedFiles: string[],
): string[] {
	const files = new Set(untrackedFiles);
	for (const line of status.split(/\r?\n/u).filter(Boolean)) {
		const file = line
			.slice(3)
			.replace(/^.* -> /u, "")
			.trim();
		if (file) files.add(file);
	}
	for (const diff of [trackedDiff, stagedDiff]) {
		for (const match of diff.matchAll(/^diff --git a\/(.*?) b\/(.*?)$/gmu)) {
			if (match[2]) files.add(match[2]);
		}
	}
	return [...files].sort();
}

function resolveRunPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestRunFile(reports);
		if (!latest) {
			return {
				valid: false,
				path: reports,
				errors: ["No encontré runs AgentLab en agentlabs/runs ni reports."],
			};
		}
		const fileCheck = validateAgentLabArtifactFile(latest);
		return fileCheck.valid
			? { valid: true, path: latest, errors: [] }
			: { valid: false, path: latest, errors: fileCheck.errors };
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed)
		return { valid: false, path: reports, errors: ["Falta ruta de run."] };
	const runDir = runArtifactsDir(reportsPath);
	const candidate = resolveRunCandidate(reports, runDir, trimmed);
	if (
		!isInsideDirectory(candidate, runDir) &&
		!isInsideDirectory(candidate, reports)
	) {
		return {
			valid: false,
			path: candidate,
			errors: [
				"La ruta debe estar dentro de stateRoot/agentlabs/runs o reports legacy.",
			],
		};
	}
	if (!RUN_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: [
				"El archivo debe llamarse current.json o agentlab-review-run-*.json.",
			],
		};
	}
	const fileCheck = validateAgentLabArtifactFile(candidate);
	return fileCheck.valid
		? { valid: true, path: candidate, errors: [] }
		: { valid: false, path: candidate, errors: fileCheck.errors };
}

function resolveRunCandidate(
	reports: string,
	runDir: string,
	requested: string,
): string {
	const normalized = requested === "current" ? RUN_CURRENT_FILE : requested;
	if (isAbsolute(normalized)) return resolve(normalized);
	if (normalized.startsWith("reports/"))
		return resolve(join(reports, normalized.slice("reports/".length)));
	const canonical = resolve(join(runDir, normalized));
	const legacy = resolve(join(reports, normalized));
	return existsSync(canonical) || !existsSync(legacy) ? canonical : legacy;
}

function latestRunFile(reportsPath: string): string | undefined {
	const runDir = runArtifactsDir(reportsPath);
	const current = join(runDir, RUN_CURRENT_FILE);
	if (existsSync(current)) return current;
	if (existsSync(runDir)) {
		const latest = safeReadDirNames(runDir)
			.filter((file) => RUN_RE.test(file))
			.sort()
			.at(-1);
		if (latest) return join(runDir, latest);
	}
	if (!existsSync(reportsPath)) return undefined;
	const legacy = safeReadDirNames(reportsPath)
		.filter((file) => /^agentlab-review-run-\d{8}-\d{6}\.json$/u.test(file))
		.sort()
		.at(-1);
	return legacy ? join(reportsPath, legacy) : undefined;
}

function runArtifactsDir(reportsPath: string): string {
	return join(resolve(reportsPath), "..", "agentlabs", "runs");
}

function validateAgentLabArtifactFile(
	path: string,
): { valid: true } | { valid: false; errors: string[] } {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			return {
				valid: false,
				errors: [
					"El artifact AgentLab debe ser un archivo regular; symlinks/junctions no están permitidos.",
				],
			};
		}
		if (!stat.isFile()) {
			return {
				valid: false,
				errors: [
					"El artifact AgentLab debe ser un archivo regular; directorios u otros tipos no están permitidos.",
				],
			};
		}
		return { valid: true };
	} catch (error) {
		const code = fsErrorCode(error);
		if (code === "ENOENT")
			return { valid: false, errors: [`No existe archivo: ${path}`] };
		if (isToleratedArtifactFsCode(code)) {
			return {
				valid: false,
				errors: [`No puedo acceder al artifact AgentLab (${code}).`],
			};
		}
		return {
			valid: false,
			errors: [
				`No puedo validar el artifact AgentLab: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

function safeReadDirNames(dirPath: string): string[] {
	try {
		return readdirSync(dirPath);
	} catch (error) {
		const code = fsErrorCode(error);
		if (isToleratedArtifactFsCode(code)) return [];
		throw error;
	}
}

function fsErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function isToleratedArtifactFsCode(code: string | undefined): boolean {
	return Boolean(
		code && ["EACCES", "EPERM", "ENOENT", "EISDIR", "ENOTDIR"].includes(code),
	);
}

function isInsideDirectory(path: string, directory: string): boolean {
	const relativePath = relative(resolve(directory), resolve(path));
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath)
	);
}

function normalizeRunResult(value: unknown): AgentLabReviewRunResult {
	if (!isRecord(value)) throw new Error("AgentLab review run inválido.");
	if (value.warning !== WARNING) throw new Error("Warning de run inválido.");
	if (typeof value.generatedAt !== "string")
		throw new Error("generatedAt inválido.");
	if (typeof value.sourceRequestFile !== "string")
		throw new Error("sourceRequestFile inválido.");
	if (typeof value.projectId !== "string")
		throw new Error("projectId inválido.");
	if (!Array.isArray(value.runs)) throw new Error("runs[] inválido.");
	return value as AgentLabReviewRunResult;
}

function jsonCandidates(output: string): string[] {
	const candidates: string[] = [];
	for (const match of output.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) {
		if (match[1]?.trim()) candidates.push(match[1].trim());
	}
	const starts = [...output.matchAll(/\{/gu)].map((match) => match.index ?? 0);
	for (const start of starts) {
		const end = balancedJsonObjectEnd(output, start);
		if (end > start) candidates.push(output.slice(start, end + 1).trim());
	}
	return dedupe(candidates);
}

function balancedJsonObjectEnd(output: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < output.length; index++) {
		const char = output[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = inString;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{") depth++;
		if (char === "}") depth--;
		if (depth === 0) return index;
	}
	return -1;
}

function looksLikeReviewReport(value: unknown): boolean {
	const root = isRecord(value) ? value : undefined;
	return Boolean(
		root &&
			("requestId" in root || "specialty" in root) &&
			("qualityFindings" in root ||
				"safetyFindings" in root ||
				"summary" in root),
	);
}

function looksLikeReviewReportJson(candidate: string): boolean {
	return /"requestId"\s*:|"specialty"\s*:|"qualityFindings"\s*:|"safetyFindings"\s*:/u.test(
		candidate,
	);
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

function highCriticalFindings(findings: AgentLabFinding[]): AgentLabFinding[] {
	return findings.filter(
		(finding) => finding.severity === "high" || finding.severity === "critical",
	);
}

function summaryForRuns(runs: AgentLabReviewRunSummary[]): string {
	const counts = countRuns(runs);
	return `${runs.length} requests: ${counts.completed} completed, ${counts.partial} partial, ${counts.timed_out} timed_out, ${counts.skipped} skipped, ${counts.failed} failed, ${counts.security_violation} security_violation.`;
}

function countRuns(
	runs: AgentLabReviewRunSummary[],
): Record<AgentLabReviewRunStatus, number> {
	return {
		completed: runs.filter((run) => run.status === "completed").length,
		partial: runs.filter((run) => run.status === "partial").length,
		timed_out: runs.filter((run) => run.status === "timed_out").length,
		skipped: runs.filter((run) => run.status === "skipped").length,
		failed: runs.filter((run) => run.status === "failed").length,
		security_violation: runs.filter(
			(run) => run.status === "security_violation",
		).length,
	};
}

export function sanitizeAgentLabSummary(output: string): string {
	return summarizeOutput(cleanAgentOutput(output), 300);
}

/**
 * Map an AgentLab review specialty to the corresponding `IduModelRoleId`
 * for B5 PR2 wiring. Defaults to `agentlab-general` for unknown
 * specialties so the runner never blocks on missing mappings.
 */
function mapSpecialtyToRole(
	specialty: AgentLabReviewRequest["specialty"],
): import("./model-assignments.js").IduModelRoleId {
	switch (specialty) {
		case "security":
			return "agentlab-security";
		case "database":
			return "agentlab-database";
		case "architecture":
			return "agentlab-architecture";
		case "code_quality":
			return "agentlab-code-quality";
		case "ui_ux":
			return "agentlab-ui-ux";
		case "performance":
			return "agentlab-performance";
		case "project_understanding":
			return "agentlab-project-understanding";
		case "docs":
			return "agentlab-docs";
		case "librarian":
			return "agentlab-librarian";
		case "general":
		case "skill_review":
		case "token_cost":
		default:
			return "agentlab-general";
	}
}

function legacySummary(output: string): string {
	return sanitizeAgentLabSummary(output) || "Sin resumen.";
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}
