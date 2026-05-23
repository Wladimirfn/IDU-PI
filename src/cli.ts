#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig, type BridgeConfig } from "./config.js";
import { initProjectConfig, inspectProjectMap } from "./config-wizard.js";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	formatIduSessionStatus,
	getIduSessionStatus,
} from "./idu-session.js";
import {
	formatIduPrepareResult,
	runIduPrepare,
	type IduPrepareResult,
} from "./idu-prepare.js";
import {
	formatIduProjectDashboard,
	type IduProjectDashboardReport,
} from "./idu-project-dashboard.js";
import {
	buildLabReviewPlan,
	formatLabReviewPlan,
	type LabReviewPlan,
} from "./lab-review-plan.js";
import { LabDbRepository } from "./lab-db-repository.js";
import {
	buildProjectAdvisory,
	formatProjectAdvisory,
	type ProjectAdvisory,
} from "./project-advisory.js";
import { loadProjectBlueprint } from "./project-blueprint.js";
import {
	formatProjectConnectionReport,
	inspectProjectConnection,
	type ProjectConnectionReport,
} from "./project-connection.js";
import { loadProjectCore } from "./project-core.js";
import {
	deriveConstitutionFromProjectCore,
	loadProjectConstitution,
} from "./project-constitution.js";
import { loadProjectFlows } from "./project-flows.js";
import {
	reviewProjectFlowsDraft,
	saveProjectFlowsDraft,
	scanProjectMap,
	suggestProjectFlowsFromScan,
} from "./project-map-scanner.js";
import {
	analyzeProjectPostflight,
	formatProjectPostflightReport,
	readProjectPostflightGitState,
	type ProjectPostflightReport,
} from "./project-postflight.js";
import {
	analyzeProjectPreflight,
	formatProjectPreflightReport,
	type ProjectPreflightReport,
} from "./project-preflight.js";
import {
	getActiveProject,
	loadRegistry,
	type ProjectEntry,
	type ProjectRegistry,
} from "./projects.js";
import {
	buildSemanticAuditStatus,
	formatSemanticAuditRunResult,
	formatSemanticAuditStatus,
	runManualSemanticAudit,
	type SemanticAuditRunResult,
	type SemanticAuditStatusReport,
} from "./semantic-audit-command.js";
import { StructuredTaskQueue } from "./structured-task-queue.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type CliRuntime = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	inspectConnection: () => ProjectConnectionReport;
	formatConnection: (report: ProjectConnectionReport) => string;
	formatDashboard: (report: ProjectConnectionReport) => string;
	preflight: (request: string) => ProjectPreflightReport;
	formatPreflight: (report: ProjectPreflightReport) => string;
	advisory: (request: string) => ProjectAdvisory;
	formatAdvisory: (advisory: ProjectAdvisory) => string;
	postflight: () => ProjectPostflightReport;
	formatPostflight: (report: ProjectPostflightReport) => string;
	prepare: () => IduPrepareResult;
	formatPrepare: (result: IduPrepareResult) => string;
	labReviewPlan: (mode: "postflight") => LabReviewPlan;
	formatLabReviewPlan: (plan: LabReviewPlan) => string;
	semanticAuditStatus: () => SemanticAuditStatusReport;
	formatSemanticAuditStatus: (report: SemanticAuditStatusReport) => string;
	semanticAuditRun: () => SemanticAuditRunResult;
	formatSemanticAuditRun: (result: SemanticAuditRunResult) => string;
};

type RuntimeContext = {
	config: BridgeConfig;
	registry: ProjectRegistry;
	activeProject: ProjectEntry;
	structuredTaskQueue: StructuredTaskQueue;
};

export function createCliRuntime(): CliRuntime {
	const config = loadConfig();
	configureIduSessionStore({ workspaceRoot: config.agentWorkspaceRoot });
	const registry = loadRegistry(config.defaultCwd, config.allowedRoots);
	const activeProject = getActiveProject(registry);
	if (!activeProject) {
		throw new Error(
			"No hay proyecto activo. Usá /addproject <id> <ruta> en Telegram o configurá DEFAULT_CWD.",
		);
	}
	const structuredTaskQueue = new StructuredTaskQueue({
		workspaceRoot: config.agentWorkspaceRoot,
	});
	const labDbRepository = new LabDbRepository(
		join(config.agentWorkspaceRoot, "reports", "lab.db"),
	);
	const context = { config, registry, activeProject, structuredTaskQueue };
	return {
		projectId: activeProject.id,
		projectPath: activeProject.path,
		workspaceRoot: config.agentWorkspaceRoot,
		inspectConnection: () => inspectConnection(context),
		formatConnection: formatProjectConnectionReport,
		formatDashboard: (report) => formatDashboard(report),
		preflight: (request) => buildPreflightReport(request, context),
		formatPreflight: formatProjectPreflightReport,
		advisory: (request) =>
			buildProjectAdvisory(buildPreflightReport(request, context)),
		formatAdvisory: formatProjectAdvisory,
		postflight: () => buildPostflightReport(context),
		formatPostflight: formatProjectPostflightReport,
		prepare: () => runPrepare(context),
		formatPrepare: formatIduPrepareResult,
		labReviewPlan: () =>
			buildLabReviewPlan({
				postflightReport: buildPostflightReport(context),
				projectId: activeProject.id,
			}),
		formatLabReviewPlan,
		semanticAuditStatus: () =>
			buildSemanticAuditStatus({
				projectId: activeProject.id,
				repository: labDbRepository,
			}),
		formatSemanticAuditStatus,
		semanticAuditRun: () =>
			runManualSemanticAudit({
				projectId: activeProject.id,
				repository: labDbRepository,
			}),
		formatSemanticAuditRun: formatSemanticAuditRunResult,
	};
}

export async function runCliCommand(
	args: string[],
	runtime?: CliRuntime,
): Promise<CliResult> {
	const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
	const [command, ...rest] = normalizedArgs;
	try {
		if (
			command === "help" ||
			command === "--help" ||
			command === "-h" ||
			command === undefined
		) {
			return ok(helpText());
		}
		const activeRuntime = runtime ?? createCliRuntime();
		configureIduSessionStore({ workspaceRoot: activeRuntime.workspaceRoot });
		switch (command) {
			case "status":
				return ok(
					activeRuntime.formatConnection(activeRuntime.inspectConnection()),
				);
			case "idu": {
				activateIduSession(activeRuntime.projectId);
				return ok(
					[
						"Guardrails automáticos activados para el proyecto activo.",
						"",
						activeRuntime.formatDashboard(activeRuntime.inspectConnection()),
					].join("\n"),
				);
			}
			case "idu-off":
				return ok(
					formatIduSessionStatus(deactivateIduSession(activeRuntime.projectId)),
				);
			case "idu-status":
				return ok(
					formatIduSessionStatus(getIduSessionStatus(activeRuntime.projectId)),
				);
			case "prepare":
				return ok(activeRuntime.formatPrepare(activeRuntime.prepare()));
			case "preflight":
				return ok(
					activeRuntime.formatPreflight(
						activeRuntime.preflight(requiredText(rest)),
					),
				);
			case "advisory":
				return ok(
					activeRuntime.formatAdvisory(
						activeRuntime.advisory(requiredText(rest)),
					),
				);
			case "postflight":
				return ok(activeRuntime.formatPostflight(activeRuntime.postflight()));
			case "lab-review-plan": {
				const mode = rest[0] ?? "postflight";
				if (mode !== "postflight") {
					return fail(`Modo no soportado para lab-review-plan: ${mode}`);
				}
				return ok(
					activeRuntime.formatLabReviewPlan(
						activeRuntime.labReviewPlan("postflight"),
					),
				);
			}
			case "semantic-audit-status":
				return ok(
					activeRuntime.formatSemanticAuditStatus(
						activeRuntime.semanticAuditStatus(),
					),
				);
			case "semantic-audit-run":
				return ok(
					activeRuntime.formatSemanticAuditRun(
						activeRuntime.semanticAuditRun(),
					),
				);
			default:
				return {
					exitCode: 1,
					stdout: helpText(),
					stderr: `Comando desconocido: ${command}`,
				};
		}
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}

function inspectConnection(context: RuntimeContext): ProjectConnectionReport {
	return inspectProjectConnection({
		registry: context.registry,
		defaultCwd: context.config.defaultCwd,
		allowedRoots: context.config.allowedRoots,
		workspaceRoot: context.config.agentWorkspaceRoot,
	});
}

function formatDashboard(report: ProjectConnectionReport): string {
	return formatIduProjectDashboard({
		projectId: report.projectId,
		configStatus: report.configStatus,
		alignmentStatus: report.alignmentStatus,
		readiness: report.readiness,
		reason: report.alignmentReason,
		recommendedNext: cliCommandFor(report.recommendedNext),
	} satisfies IduProjectDashboardReport);
}

function buildPreflightReport(
	request: string,
	context: RuntimeContext,
): ProjectPreflightReport {
	const connection = inspectConnection(context);
	const blueprint =
		connection.projectPath &&
		connection.blueprint?.source === "project-local" &&
		connection.blueprint.valid
			? loadProjectBlueprint(connection.projectPath)
			: undefined;
	const flows =
		connection.projectPath &&
		connection.flows?.source === "project-local" &&
		connection.flows.valid
			? loadProjectFlows(connection.projectPath)
			: undefined;
	const constitution = loadConfirmedProjectConstitution(connection.projectPath);
	return analyzeProjectPreflight(request, {
		connection,
		blueprint,
		flows,
		constitution,
		projectId: connection.projectId,
		projectPath: connection.projectPath,
	});
}

function buildPostflightReport(
	context: RuntimeContext,
): ProjectPostflightReport {
	const connection = inspectConnection(context);
	const projectPath = connection.projectPath ?? context.activeProject.path;
	const flows =
		connection.projectPath &&
		connection.flows?.source === "project-local" &&
		connection.flows.valid
			? loadProjectFlows(connection.projectPath)
			: undefined;
	const gitState = readProjectPostflightGitState(projectPath);
	const constitution = loadConfirmedProjectConstitution(connection.projectPath);
	const report = analyzeProjectPostflight({
		projectPath,
		connectionReport: connection,
		projectFlows: flows,
		constitution,
		changedFiles: gitState.changedFiles,
		diffSummary: gitState.diffSummary,
	});
	return {
		...report,
		warnings: [...gitState.warnings, ...report.warnings],
	};
}

function runPrepare(context: RuntimeContext): IduPrepareResult {
	const reportsPath = join(context.config.agentWorkspaceRoot, "reports");
	const projectId = context.activeProject.id;
	const projectPath = context.activeProject.path;
	return runIduPrepare({
		projectId,
		projectPath,
		reportsPath,
		inspectConnection: () => inspectConnection(context),
		initProjectConfig: () => initProjectConfig(projectPath, projectId),
		inspectProjectMap: () =>
			inspectProjectMap(projectPath, {
				activeProjectId: projectId,
				activeProjectName: context.activeProject.name,
			}),
		loadProjectFlows: () => loadProjectFlows(projectPath),
		scanProjectMap: (flows) => scanProjectMap(projectPath, flows),
		suggestProjectFlows: (flows) =>
			suggestProjectFlowsFromScan(projectPath, flows),
		draftProjectFlows: (flows) =>
			saveProjectFlowsDraft(projectPath, flows, reportsPath),
		reviewProjectFlowsDraft: (draftPathOrLatest, flows) =>
			reviewProjectFlowsDraft(draftPathOrLatest, flows, reportsPath),
		postflight: () => buildPostflightReport(context),
		createStructuredTask: (input) =>
			context.structuredTaskQueue.enqueueTask(input),
	});
}

function loadConfirmedProjectConstitution(projectPath: string | undefined) {
	if (!projectPath) return undefined;
	const corePath = join(projectPath, "config", "project-core.json");
	if (!existsSync(corePath)) return undefined;
	try {
		const core = loadProjectCore(projectPath);
		if (core.status !== "confirmed") return undefined;
		const constitutionPath = join(
			projectPath,
			"config",
			"project-constitution.json",
		);
		return existsSync(constitutionPath)
			? loadProjectConstitution(projectPath)
			: deriveConstitutionFromProjectCore(core);
	} catch {
		return undefined;
	}
}

function cliCommandFor(telegramCommand: string): string {
	return telegramCommand
		.replace(/^\/idu_prepare\b/u, "idu-pi prepare")
		.replace(
			/^\/config init_project_config\b/u,
			"Telegram: /config init_project_config",
		)
		.replace(/^\/addproject\b/u, "Telegram: /addproject")
		.replace(/^\/useproject\b/u, "Telegram: /useproject");
}

function requiredText(parts: string[]): string {
	const text = parts.join(" ").trim();
	if (!text)
		throw new Error("Falta solicitud. Usá comillas si tiene espacios.");
	return text;
}

function ok(stdout: string): CliResult {
	return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): CliResult {
	return { exitCode: 1, stdout: helpText(), stderr };
}

export function helpText(): string {
	return [
		"Uso: idu-pi <comando> [args]",
		"",
		"Comandos:",
		"  idu-pi status",
		"  idu-pi idu                 (Telegram: /idu)",
		"  idu-pi idu-off             (Telegram: /idu_off)",
		"  idu-pi idu-status          (Telegram: /idu_status)",
		"  idu-pi prepare             (Telegram: /idu_prepare)",
		'  idu-pi preflight "solicitud"',
		'  idu-pi advisory "solicitud"',
		"  idu-pi postflight",
		"  idu-pi lab-review-plan postflight",
		"  idu-pi semantic-audit-status (Telegram: /semantic_audit_status)",
		"  idu-pi semantic-audit-run    (Telegram: /semantic_audit_run)",
		"",
		"Notas:",
		"- Usa AGENT_WORKSPACE_ROOT y el registro de proyectos del bridge.",
		"- No usa IA, no ejecuta AgentLabs y no aplica project-flows.",
	].join("\n");
}

async function main(): Promise<void> {
	const result = await runCliCommand(process.argv.slice(2));
	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	process.exitCode = result.exitCode;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	void main();
}
