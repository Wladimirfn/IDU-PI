import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentProfile } from "./config.js";
import type { AgentRouter } from "./agent-router.js";
import { loadLabProjectContext } from "./lab-context.js";
import {
	formatAgentLabReviewRequestForPrompt,
	validateAgentLabReportAgainstSupervisorContract,
	validateAgentLabReviewRequest,
	type AgentLabFinding,
	type AgentLabRecommendation,
	type AgentLabReviewReport,
	type AgentLabReviewRequest,
	type AgentLabSpecialty,
} from "./agentlab-supervisor-contract.js";
import {
	reviewAgentLabReviewRequest,
	type AgentLabReviewRequestPlan,
} from "./agentlab-review-requests.js";

export type AgentLabReviewRunStatus = "completed" | "skipped" | "failed";

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
	path?: string;
};

export type AgentLabReviewStatus = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	result?: AgentLabReviewRunResult;
};

export type RunAgentLabReviewRequestFileInput = {
	pathOrLatest: string;
	reportsPath: string;
	projectId: string;
	projectPath: string;
	router: AgentRouter;
	profileId?: string;
	now?: () => Date;
};

export type RunAgentLabReviewRequestInput = {
	request: AgentLabReviewRequest;
	projectPath: string;
	router: AgentRouter;
	profile?: AgentProfile;
	now?: () => Date;
};

const WARNING = "Revisión AgentLab. No aplica cambios." as const;
const RUN_RE = /^agentlab-review-run-\d{8}-\d{6}\.json$/u;

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
			},
		];
	} else {
		runs = await runPlanRequests({
			plan: requestReview.plan,
			projectPath: input.projectPath,
			router: input.router,
			profileId: input.profileId,
			now: input.now,
		});
	}
	const result = buildRunResult({
		generatedAt,
		sourceRequestFile,
		projectId: input.projectId,
		runs,
	});
	mkdirSync(input.reportsPath, { recursive: true });
	const path = join(
		input.reportsPath,
		`agentlab-review-run-${timestamp(now)}.json`,
	);
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
		selectAgentLabProfile(input.router, input.request.specialty);
	if (!profile) {
		return skippedRun(
			input.request,
			`No hay AgentLab compatible para ${input.request.specialty}.`,
			[],
		);
	}
	const runtime = input.router.runtimeForProfile(profile.id);
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
	const timeoutMs = Math.max(1, input.request.maxMinutes) * 60_000;
	try {
		const prompt = buildReviewPrompt(input.request, profile, input.projectPath);
		const result = await Promise.race([
			runtime.session.prompt(prompt),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("LAB_TIMEOUT")), timeoutMs).unref(),
			),
		]);
		const parsed = parseAgentLabReviewReportFromOutput(
			result.output,
			input.request,
		);
		if (!result.ok) {
			return failedRun(input.request, profile, runtime.cwd, result.output, [
				"AgentLab retornó status failed.",
				...parsed.errors,
			]);
		}
		return completedRun(
			input.request,
			profile,
			runtime.cwd,
			result.output,
			parsed,
		);
	} catch (error) {
		const timeout = error instanceof Error && error.message === "LAB_TIMEOUT";
		if (timeout) runtime.session.cancel();
		return failedRun(
			input.request,
			profile,
			runtime.cwd,
			timeout
				? "Tiempo máximo alcanzado; agente cancelado."
				: "Ejecución falló.",
			[error instanceof Error ? error.message : String(error)],
		);
	}
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
				(run) => `${run.specialty}: ${run.status} (${run.rawSummary})`,
			),
		),
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
): { report?: AgentLabReviewReport; errors: string[] } {
	const errors: string[] = [];
	for (const candidate of jsonCandidates(output)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			const result = validateAgentLabReportAgainstSupervisorContract(
				parsed,
				request,
			);
			if (result.ok) return { report: result.report, errors: [] };
			errors.push(...result.errors);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	return {
		errors: errors.length
			? dedupe(errors)
			: ["No encontré AgentLabReviewReport JSON válido."],
	};
}

function buildReviewPrompt(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	projectPath: string,
): string {
	const context = loadLabProjectContext(projectPath);
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
		...(context ? ["Contexto del proyecto real:", context.text, ""] : []),
		formatAgentLabReviewRequestForPrompt(request),
		"",
		"Formato obligatorio preferido: AgentLabReviewReport JSON con arrays presentes aunque estén vacíos.",
		`requestId debe ser ${request.id}; projectId debe ser ${request.projectId}; specialty debe ser ${request.specialty}.`,
	].join("\n");
}

function selectAgentLabProfile(
	router: AgentRouter,
	specialty: AgentLabSpecialty,
): AgentProfile | undefined {
	const profiles = router.labProfiles();
	const patterns = specialtyPatterns(specialty);
	return (
		profiles.find((profile) =>
			patterns.some((pattern) => profileMatches(profile, pattern)),
		) ??
		profiles.find((profile) => profileMatches(profile, /general/iu)) ??
		profiles[0]
	);
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
	now?: () => Date;
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
				now: input.now,
			}),
		);
	}
	return runs;
}

function completedRun(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	workspace: string,
	output: string,
	parsed: { report?: AgentLabReviewReport; errors: string[] },
): AgentLabReviewRunSummary {
	const reportFindings = parsed.report ? allFindings(parsed.report) : [];
	return {
		requestId: request.id,
		specialty: request.specialty,
		status: "completed",
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
		requiresHumanApproval:
			parsed.report?.requiresHumanApproval ?? request.requiresHumanApproval,
	};
}

function failedRun(
	request: AgentLabReviewRequest,
	profile: AgentProfile,
	workspace: string,
	summary: string,
	errors: string[],
): AgentLabReviewRunSummary {
	return {
		requestId: request.id,
		specialty: request.specialty,
		status: "failed",
		agentId: profile.id,
		workspace,
		commandsExecuted: [],
		rawSummary: legacySummary(summary),
		contractValidation: { valid: false, errors },
		findings: [],
		recommendations: [],
		testsSuggested: [],
		requiresHumanApproval: request.requiresHumanApproval,
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
		],
	};
}

function resolveRunPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestRunFile(reports);
		return latest
			? { valid: true, path: latest, errors: [] }
			: {
					valid: false,
					path: reports,
					errors: [
						"No encontré archivos agentlab-review-run-*.json en reports.",
					],
				};
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed)
		return { valid: false, path: reports, errors: ["Falta ruta de run."] };
	const candidate = resolve(
		isAbsolute(trimmed) ? trimmed : join(reports, trimmed),
	);
	const relativeToReports = relative(reports, candidate);
	if (
		relativeToReports === "" ||
		relativeToReports.startsWith("..") ||
		isAbsolute(relativeToReports)
	) {
		return {
			valid: false,
			path: candidate,
			errors: ["La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports."],
		};
	}
	if (!RUN_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: ["El archivo debe llamarse agentlab-review-run-*.json."],
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

function latestRunFile(reportsPath: string): string | undefined {
	if (!existsSync(reportsPath)) return undefined;
	const latest = readdirSync(reportsPath)
		.filter((file) => RUN_RE.test(file))
		.sort()
		.at(-1);
	return latest ? join(reportsPath, latest) : undefined;
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
	const first = output.indexOf("{");
	const last = output.lastIndexOf("}");
	if (first >= 0 && last > first)
		candidates.push(output.slice(first, last + 1));
	return candidates;
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
	return `${runs.length} requests: ${counts.completed} completed, ${counts.skipped} skipped, ${counts.failed} failed.`;
}

function countRuns(
	runs: AgentLabReviewRunSummary[],
): Record<AgentLabReviewRunStatus, number> {
	return {
		completed: runs.filter((run) => run.status === "completed").length,
		skipped: runs.filter((run) => run.status === "skipped").length,
		failed: runs.filter((run) => run.status === "failed").length,
	};
}

function legacySummary(output: string): string {
	return (
		output.trim().split(/\r?\n/u).filter(Boolean).slice(0, 5).join("\n") ||
		"Sin resumen."
	);
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}
