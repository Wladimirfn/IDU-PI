import { execFileSync } from "node:child_process";
import type { ProjectConnectionReport } from "./project-connection.js";
import type { ProjectFlows } from "./project-flows.js";

export type ProjectPostflightRisk = "low" | "medium" | "high" | "blocker";

export type ProjectPostflightContext = {
	projectPath: string;
	connectionReport: ProjectConnectionReport;
	projectFlows?: ProjectFlows;
	changedFiles: string[];
	diffSummary?: string;
};

export type ProjectPostflightReport = {
	risk: ProjectPostflightRisk;
	changedFiles: string[];
	impactedAreas: string[];
	warnings: string[];
	recommendedNext: string;
	shouldRunAgentLab: boolean;
	suggestedAgentLabs: string[];
	requiresHumanConfirmation: boolean;
	diffSummary?: string;
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

	if (changedFiles.length === 0) {
		return {
			risk: "low",
			changedFiles: [],
			impactedAreas: [],
			warnings: [],
			recommendedNext: "Sin cambios locales detectados.",
			shouldRunAgentLab: false,
			suggestedAgentLabs: [],
			requiresHumanConfirmation: false,
			diffSummary: context.diffSummary,
		};
	}

	for (const file of changedFiles) {
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

	return {
		risk,
		changedFiles,
		impactedAreas: dedupe(impactedAreas),
		warnings: dedupe(warnings),
		recommendedNext: recommendedNext(risk, dedupe(impactedAreas)),
		shouldRunAgentLab: risk === "high" || risk === "blocker",
		suggestedAgentLabs: dedupe(suggestedAgentLabs),
		requiresHumanConfirmation: risk === "high" || risk === "blocker",
		diffSummary: context.diffSummary,
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
		"Impacto:",
		formatList(report.impactedAreas),
		"",
		"Advertencias:",
		formatList(report.warnings),
		"",
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
		const path = line.slice(3).trim();
		const rename = path.split(" -> ").at(-1);
		return rename ?? path;
	});
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
	if (/^reports\/(lab\.db|.*\.jsonl)$/u.test(lower)) {
		areas.push("runtime/tracked-artifacts");
		warnings.push("Archivo runtime en reports trackeado o cambiado.");
		return { areas, warnings, risk: "blocker" };
	}
	if (isDocsFile(lower)) areas.push("docs");
	if (isTestFile(lower)) areas.push("tests");
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
	if (isOrchestrationFile(lower)) {
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

function isTestFile(file: string): boolean {
	return file.startsWith("test/") || file.includes(".test.");
}

function isConfigFile(file: string): boolean {
	return /(^|\/)(package\.json|tsconfig[^/]*\.json|\.env\.example|\.gitignore)$/u.test(
		file,
	);
}

function isSecurityFile(file: string): boolean {
	return /(auth|login|token|secret|\.env\.example|env)/u.test(file);
}

function isDbFile(file: string): boolean {
	return /(prisma|supabase|sqlite|lab-db|migration|migrations|schema)/u.test(
		file,
	);
}

function isFlowFile(file: string): boolean {
	return /(project-flows|project-blueprint|project-map|rule-validator)/u.test(
		file,
	);
}

function isUiFile(file: string): boolean {
	return /(\.html$|components\/|pages\/|app\/)/u.test(file);
}

function isOrchestrationFile(file: string): boolean {
	return /(^src\/index\.ts$|agent-router|(^|\/)lab[^/]*|queue|telegram-command-registry)/u.test(
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
