import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDbFile } from "./evidence-gateways.js";
import type { PhysicalGateEvidence } from "./physical-gates.js";
import type { ProjectConnectionReport } from "./project-connection.js";
import {
	evaluateConstitutionGates,
	type ConstitutionGateResult,
	type LoadConfirmedConstitutionResult,
} from "./project-constitution.js";
import type { ProjectFlows } from "./project-flows.js";

export type ProjectPostflightRisk = "low" | "medium" | "high" | "blocker";
export type ProjectChangeMode = "no-op" | "docs" | "tests" | "code" | "stateRoot";

// ============================================================================
// R5.2 — fail-loud discriminated union for the constitution gate execution
// ----------------------------------------------------------------------------
// Source: design obs-2704 (architecture/r5-runtime-enforcement-design) §R5.2.
// The original R5 bug was a silent `ok: true` skip when the constitution gate
// could not run (the postflight report set `constitutionGate: undefined`, and a
// consumer checking `gates?.ok !== false` read it as "passed"). R5.1 fixed
// the loader to surface skip reasons; R5.2 ensures the report never lies.
//
// Two branches:
//   - kind: "ran"     — gate executed and produced a result. `result` carries
//                       the existing ConstitutionGateResult shape, plus a
//                       `message` summary suitable for human display.
//   - kind: "skipped" — gate could NOT run (loader skipped for some reason).
//                       `severity` is ALWAYS "blocker" on skip because a silent
//                       skip is itself a hard-stop: we cannot trust any other
//                       signal in the report without enforcement verification.
//                       `skippedReason` is the human-readable explanation.
//
// Distinguishability (Caveat 1 in the audit): the `message` on a skipped run
// explicitly says "SKIPPED — not ran —" so the human does not confuse a
// skip-blocker with a real `rejected_stack` rejection. Both reach
// `risk: blocker` and `requiresHumanConfirmation: true`, but the message
// wording is the diagnostic.
// ============================================================================

export type GateExecutionStatus =
	| {
			kind: "ran";
			result: ConstitutionGateResult & {
				message: string;
			};
	  }
	| {
			kind: "skipped";
			reason:
				| "no-constitution-provided"
				| "no-stateRoot"
				| "core-not-confirmed"
				| "core-loaded-default"
				| "read-failed"
				| string;
			severity: "blocker";
			ran: false;
			detail?: string;
			skippedReason: string;
		};

export type ProjectPostflightContext = {
	projectPath: string;
	connectionReport: ProjectConnectionReport;
	projectFlows?: ProjectFlows;
	// R5.2: callers pass the discriminated union from `loadConfirmedProjectConstitution`
	// (or `undefined` if they did not load at all — e.g. early-fail paths). The postflight
	// builder always produces a `GateExecutionStatus` — either `kind: "ran"` (constitution
	// loaded, gate executed) or `kind: "skipped"` (loader skipped, gate did not run).
	constitutionStatus?: LoadConfirmedConstitutionResult;
	changedFiles: string[];
	diffSummary?: string;
};

export type ProjectPostflightReport = {
	risk: ProjectPostflightRisk;
	changedFiles: string[];
	ignoredFiles?: string[];
	observedChangeMode?: ProjectChangeMode;
	impactedAreas: string[];
	warnings: string[];
	recommendedNext: string;
	shouldRunAgentLab: boolean;
	suggestedAgentLabs: string[];
	requiresHumanConfirmation: boolean;
	diffSummary?: string;
	// R5.2: always present on a postflight run that reached the gate builder.
	// `kind: "ran"` when enforcement ran, `kind: "skipped"` when it could not
	// run (with severity blocker). Never undefined when analyzeProjectPostflight
	// ran end-to-end — that was the original R5 bug (silent ok:true skip).
	constitutionGate?: GateExecutionStatus;
	physicalGates?: PhysicalGateEvidence[];
};

export type ProjectPostflightGitState = {
	changedFiles: string[];
	diffSummary?: string;
	warnings: string[];
};

export type PostflightGitRunner = (command: string, args: string[]) => string;

export function readProjectPostflightGitState(
	projectPath: string,
	run: PostflightGitRunner = defaultGitRunner(projectPath),
): ProjectPostflightGitState {
	const warnings: string[] = [];
	const status = runGit(run, ["status", "--porcelain"]);
	const diffNames = runGit(run, ["diff", "--name-only"]);
	const diffStat = runGit(run, ["diff", "--stat"]);
	const changedFiles = dedupe([
		...parsePorcelainFiles(status.output),
		...lines(diffNames.output),
	]);
	if (status.error) warnings.push(`No pude leer git status: ${status.output}`);
	if (diffNames.error)
		warnings.push(`No pude leer git diff --name-only: ${diffNames.output}`);
	if (diffStat.error)
		warnings.push(`No pude leer git diff --stat: ${diffStat.output}`);
	return {
		changedFiles,
		diffSummary: diffStat.output,
		warnings,
	};
}

export function analyzeProjectPostflight(
	context: ProjectPostflightContext,
): ProjectPostflightReport {
	const changedFiles = dedupe(context.changedFiles.map(normalizePath));
	const impactedAreas: string[] = [];
	const warnings: string[] = [];
	const suggestedAgentLabs: string[] = [];
	let risk: ProjectPostflightRisk = "low";

	const ignoredFiles = changedFiles.filter(isIgnorablePostflightFile);
	const functionalChangedFiles = changedFiles.filter(
		(file) => !isIgnorablePostflightFile(file),
	);
	const observedChangeMode = inferObservedChangeMode(functionalChangedFiles);

	if (functionalChangedFiles.length === 0) {
		return {
			risk: "low",
			changedFiles: [],
			ignoredFiles,
			observedChangeMode,
			impactedAreas: [],
			warnings: [],
			recommendedNext: "Sin cambios locales detectados.",
			shouldRunAgentLab: false,
			suggestedAgentLabs: [],
			requiresHumanConfirmation: false,
			diffSummary: context.diffSummary,
		};
	}

	for (const file of functionalChangedFiles) {
		const categories = classifyFile(file);
		for (const area of categories.areas) impactedAreas.push(area);
		for (const warning of categories.warnings) warnings.push(warning);
		risk = maxRisk(risk, categories.risk);
	}

	if (impactedAreas.includes("DB/storage")) {
		suggestedAgentLabs.push("db-storage");
	}
	if (impactedAreas.includes("orquestación")) {
		suggestedAgentLabs.push("arquitectura");
	}
	if (impactedAreas.includes("seguridad")) {
		suggestedAgentLabs.push("seguridad");
	}
	if (impactedAreas.includes("flujos/mapa")) {
		suggestedAgentLabs.push("project-understanding");
	}

	const constitutionGate = buildGateExecutionStatus({
		constitutionStatus: context.constitutionStatus,
		changedFiles: functionalChangedFiles,
		projectPath: context.projectPath,
	});
	if (constitutionGate.kind === "ran") {
		risk = maxRisk(risk, constitutionGate.result.risk);
		for (const failure of constitutionGate.result.failures) {
			warnings.push(`${failure.gateId}: ${failure.message}`);
		}
		for (const warning of constitutionGate.result.warnings) {
			warnings.push(`${warning.gateId}: ${warning.message}`);
		}
		warnings.push(constitutionGate.result.message);
	} else {
		// R5.2 fail-loud: a skipped gate is a hard-stop. The original R5 bug was
		// the gate silently skipping and the report reading as "passed" because
		// `constitutionGate` was `undefined`. Now we always emit a status, and on
		// skip the report risk escalates to blocker, requires human confirmation,
		// and surfaces the skip reason in the warnings list.
		risk = maxRisk(risk, "blocker");
		warnings.push(
			`constitution_skipped: SKIPPED — not ran — reason: ${constitutionGate.reason}. Enforcement could not verify. Human review required.`,
		);
	}

	return {
		risk,
		changedFiles: functionalChangedFiles,
		ignoredFiles,
		observedChangeMode,
		impactedAreas: dedupe(impactedAreas),
		warnings: dedupe(warnings),
		recommendedNext: recommendedNext(risk, dedupe(impactedAreas)),
		shouldRunAgentLab: risk === "high" || risk === "blocker",
		suggestedAgentLabs: dedupe(suggestedAgentLabs),
		requiresHumanConfirmation:
			risk === "high" ||
			risk === "blocker" ||
			constitutionGate.kind === "skipped" ||
			Boolean(constitutionGate.result?.requiresHumanConfirmation),
		diffSummary: context.diffSummary,
		constitutionGate,
	};
}

/**
 * R5.2: builds the discriminated `GateExecutionStatus` from the loader's
 * `constitutionStatus` (a `LoadConfirmedConstitutionResult` or undefined).
 *
 *  - constitutionStatus === undefined → caller did not load. We treat this as a
 *    skip with `reason: "no-constitution-provided"` so the field is never
 *    undefined on a postflight run that reached the gate builder.
 *  - kind: "ok" → run the gate and wrap the result in a `kind: "ran"` branch.
 *  - kind: "skipped" → preserve the loader's reason and surface a blocker.
 *
 * The skip branch is the architectural fix for the original R5 bug: previously
 * a skipped loader meant `constitutionGate === undefined`, and a consumer
 * reading `gates?.ok !== false` saw "passed". Now a skip is loud.
 */
function buildGateExecutionStatus(input: {
	constitutionStatus: ProjectPostflightContext["constitutionStatus"];
	changedFiles: string[];
	projectPath: string;
}): GateExecutionStatus {
	if (!input.constitutionStatus) {
		return {
			kind: "skipped",
			reason: "no-constitution-provided",
			severity: "blocker",
			ran: false,
			skippedReason:
				"Constitution gate SKIPPED — not ran — reason: no-constitution-provided. Caller did not load a constitution. Enforcement could not verify. Human review required.",
		};
	}
	if (input.constitutionStatus.kind === "skipped") {
		const { reason, detail } = input.constitutionStatus;
		return {
			kind: "skipped",
			reason,
			severity: "blocker",
			ran: false,
			detail,
			skippedReason: `Constitution gate SKIPPED — not ran — reason: ${reason}${
				detail ? `. detail: ${detail}` : ""
			}. Enforcement could not verify. Human review required.`,
		};
	}
	const result = evaluateConstitutionGates({
		changedFiles: input.changedFiles,
		// R3.2: feed `package.json` deps into the gate so depPattern rules
		// in `rejectedStack` can fire on real dependency artifacts. The
		// helper never throws on a missing file (returns `undefined`);
		// the `?? undefined` keeps the field absent (NOT `null`) so the
		// depPattern branch in `hasRejection` short-circuits cleanly.
		deps: readPackageJsonDeps(input.projectPath) ?? undefined,
		constitution: input.constitutionStatus.constitution,
	});
	const failureCount = result.failures.length;
	const warningCount = result.warnings.length;
	const message = `Constitution gate RAN — ${failureCount} failure(s), ${warningCount} warning(s).`;
	return {
		kind: "ran",
		result: { ...result, message },
	};
}

export function formatProjectPostflightReport(
	report: ProjectPostflightReport,
): string {
	return [
		"Postflight Idu-pi",
		"",
		"Riesgo:",
		report.risk,
		"",
		"Cambios detectados:",
		formatList(report.changedFiles),
		"",
		"Archivos ignorados:",
		formatList(report.ignoredFiles ?? []),
		"",
		"Modo observado:",
		report.observedChangeMode ?? "code",
		"",
		"Impacto:",
		formatList(report.impactedAreas),
		"",
		"Advertencias:",
		formatList(report.warnings),
		"",
		...(report.constitutionGate
			? [
					"Constitution gate execution:",
					report.constitutionGate.kind === "ran"
						? report.constitutionGate.result.message
						: report.constitutionGate.skippedReason,
					"",
					"Reglas determinísticas:",
					formatList(
						report.constitutionGate.kind === "ran"
							? report.constitutionGate.result.affectedRules
							: [],
					),
					"",
				]
			: []),
		"Recomendación:",
		report.recommendedNext,
		"",
		"shouldRunAgentLab:",
		String(report.shouldRunAgentLab),
		"",
		"suggestedAgentLabs:",
		formatList(report.suggestedAgentLabs),
		"",
		"requiresHumanConfirmation:",
		String(report.requiresHumanConfirmation),
	].join("\n");
}

function defaultGitRunner(projectPath: string): PostflightGitRunner {
	return (command, args) =>
		execFileSync(command, args, {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
}

// R3.2: lazy `package.json` reader for `ConstitutionGateInput.deps`. Only
// postflight populates the gate's `deps` field; preflight does not (non-
// breaking). The helper NEVER throws on a missing or malformed file — it
// returns `undefined` and the gate's depPattern predicate short-circuits.
// A present but malformed `package.json` (no `dependencies`/`devDependencies`
// keys) returns an empty shape so the gate sees "no matching deps" cleanly.
export function readPackageJsonDeps(
	workspaceRoot: string,
):
	| { dependencies: Record<string, string>; devDependencies: Record<string, string> }
	| undefined {
	if (!workspaceRoot) return undefined;
	const pkgPath = join(workspaceRoot, "package.json");
	if (!existsSync(pkgPath)) return undefined;
	try {
		const raw = readFileSync(pkgPath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const dependencies = isStringRecord(parsed.dependencies)
			? parsed.dependencies
			: {};
		const devDependencies = isStringRecord(parsed.devDependencies)
			? parsed.devDependencies
			: {};
		return { dependencies, devDependencies };
	} catch {
		return undefined;
	}
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value as Record<string, unknown>).every(
			(v) => typeof v === "string",
		)
	);
}

function runGit(
	run: PostflightGitRunner,
	args: string[],
): { output: string; error: boolean } {
	try {
		return { output: run("git", args).trim(), error: false };
	} catch (error) {
		return {
			output: error instanceof Error ? error.message : String(error),
			error: true,
		};
	}
}

function parsePorcelainFiles(output: string): string[] {
	return lines(output).map((line) => {
		const match = /^(?:[ MADRCU?!]{1,2})\s+(.+)$/u.exec(line);
		const path = (match?.[1] ?? line).trim();
		const rename = path.split(" -> ").at(-1);
		return rename ?? path;
	});
}

function isIgnorablePostflightFile(file: string): boolean {
	const lower = normalizePath(file).toLowerCase();
	return (
		lower === "subagent-artifacts" ||
		lower.startsWith("subagent-artifacts/") ||
		lower.includes("/.pi/agent/sessions/") ||
		lower.includes("/subagent-artifacts/")
	);
}

function inferObservedChangeMode(files: string[]): ProjectChangeMode {
	if (files.length === 0) return "no-op";
	if (files.every((file) => isStateRootFile(file))) return "stateRoot";
	if (files.every((file) => isDocsFile(file.toLowerCase()))) return "docs";
	if (files.every((file) => isTestFile(file.toLowerCase()))) return "tests";
	return "code";
}

function isStateRootFile(file: string): boolean {
	const lower = normalizePath(file).toLowerCase();
	return (
		lower.includes("/bridge-agents/projects/") ||
		lower.startsWith("reports/") ||
		lower.startsWith("agentlabs/") ||
		lower.startsWith("doc/") ||
		lower.startsWith("master-plan")
	);
}

function classifyFile(file: string): {
	areas: string[];
	warnings: string[];
	risk: ProjectPostflightRisk;
} {
	const lower = file.toLowerCase();
	const areas: string[] = [];
	const warnings: string[] = [];
	let risk: ProjectPostflightRisk = "low";

	if (lower === ".env" || lower.endsWith("/.env")) {
		areas.push("seguridad");
		warnings.push("Archivo .env cambiado o trackeado; posible secreto.");
		return { areas, warnings, risk: "blocker" };
	}
	if (/^reports\/(.*\.(db|sqlite|sqlite3|jsonl)|lab\.db)$/u.test(lower)) {
		areas.push("runtime/tracked-artifacts");
		warnings.push("Archivo runtime en reports trackeado o cambiado.");
		return { areas, warnings, risk: "blocker" };
	}
	if (isStateRootFile(lower)) {
		areas.push("stateRoot");
		return { areas, warnings, risk: "low" };
	}
	if (isDocsFile(lower)) areas.push("docs");
	if (isTestFile(lower)) areas.push("tests");
	if (isCodeFile(lower)) {
		areas.push("code");
		risk = maxRisk(risk, "medium");
	}
	if (isConfigFile(lower)) {
		areas.push("configuración");
		risk = maxRisk(risk, "medium");
	}
	if (isSecurityFile(lower)) {
		areas.push("seguridad");
		warnings.push(`Cambio toca seguridad/auth/env: ${file}`);
		risk = maxRisk(risk, lower.includes(".env.example") ? "high" : "high");
	}
	if (isDbFile(lower)) {
		areas.push("DB/storage");
		warnings.push(`Cambio toca DB/storage: ${file}`);
		risk = maxRisk(risk, "high");
	}
	if (isFlowFile(lower)) {
		areas.push("flujos/mapa");
		warnings.push(`Cambio toca mapa funcional/reglas: ${file}`);
		risk = maxRisk(risk, "high");
	}
	if (isUiFile(lower)) {
		areas.push("UI");
		risk = maxRisk(risk, "medium");
	}
	if (!isTestFile(lower) && isOrchestrationFile(lower)) {
		areas.push("orquestación");
		warnings.push(`Cambio toca orquestación/handler principal: ${file}`);
		risk = maxRisk(risk, lower === "src/index.ts" ? "high" : "medium");
	}

	if (areas.every((area) => area === "docs" || area === "tests")) {
		risk = "low";
	}
	return { areas, warnings, risk };
}

function isDocsFile(file: string): boolean {
	return file.endsWith(".md") || file.startsWith("docs/");
}

function isCodeFile(file: string): boolean {
	return /\.(js|jsx|ts|tsx|mjs|cjs)$/u.test(file) && !isTestFile(file);
}

function isTestFile(file: string): boolean {
	return file.startsWith("test/") || file.includes(".test.");
}

function isConfigFile(file: string): boolean {
	return /(^|\/)(package\.json|tsconfig[^/]*\.json|\.env\.example|\.gitignore)$/u.test(
		file,
	);
}

function isSecurityFile(file: string): boolean {
	return /(^|[/._-])(permissions?|auth|login|token|secret|env)([/._-]|$)|\.env\.example/u.test(
		file,
	);
}

function isFlowFile(file: string): boolean {
	return /(project-flows|project-blueprint|project-map|rule-validator)/u.test(
		file,
	);
}

function isUiFile(file: string): boolean {
	return /(\.html$|\.css$|components\/|pages\/|app\/|screens\/|views\/)/u.test(file);
}

function isOrchestrationFile(file: string): boolean {
	return /(mcp-server|orchestrator|governance|master-plan|project-postflight|^src\/index\.ts$|agent-router|(^|\/)lab[^/]*|queue|telegram-command-registry)/u.test(
		file,
	);
}

function recommendedNext(risk: ProjectPostflightRisk, areas: string[]): string {
	if (risk === "blocker") {
		return "Detener merge y revisar archivos sensibles/runtime antes de continuar.";
	}
	if (risk === "high") {
		return "Ejecutar AgentLab de arquitectura y tests antes de merge.";
	}
	if (risk === "medium") {
		return areas.includes("flujos/mapa")
			? "Revisar project-flows/project-blueprint antes de merge."
			: "Revisar impacto y confirmar alcance antes de merge.";
	}
	return "Sin señales de riesgo estructural; revisar diff normalmente.";
}

function maxRisk(
	current: ProjectPostflightRisk,
	candidate: ProjectPostflightRisk,
): ProjectPostflightRisk {
	const order: ProjectPostflightRisk[] = ["low", "medium", "high", "blocker"];
	return order.indexOf(candidate) > order.indexOf(current)
		? candidate
		: current;
}

function normalizePath(path: string): string {
	return path.replace(/\\/gu, "/").trim();
}

function lines(output: string): string[] {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}
