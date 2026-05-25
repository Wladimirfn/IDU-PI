#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig, type BridgeConfig } from "./config.js";
import { formatCommandCatalog } from "./command-catalog.js";
import { initProjectConfig, inspectProjectMap } from "./config-wizard.js";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	formatIduSessionStatus,
	getIduSessionStatus,
	shouldUseAutomaticGuardrails,
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
import { formatProjectCoreForPrompt, loadProjectCore } from "./project-core.js";
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
import {
	formatSemanticCompactionDraft,
	formatSemanticCompactionReview,
	reviewSemanticCompactionDraft,
	saveSemanticCompactionDraft,
	type SaveSemanticCompactionDraftResult,
	type SemanticCompactionReview,
} from "./semantic-compaction.js";
import {
	buildSemanticAgentTaskPlan,
	createSemanticAgentTasks,
	formatSemanticAgentTaskCreationResult,
	formatSemanticAgentTaskPlan,
	type SemanticAgentTaskCreationResult,
	type SemanticAgentTaskPlan,
} from "./semantic-agent-tasks.js";
import {
	formatIduSupervisorLoopResult,
	runIduSupervisorLoop,
	type IduSupervisorLoopResult,
} from "./idu-supervisor-loop.js";
import {
	maybeRunSupervisorAfterPostflight,
	maybeRunSupervisorAfterSemanticTrigger,
	maybeRunSupervisorAfterTask,
	maybeRunSupervisorOnIduActivation,
} from "./idu-supervisor-hooks.js";
import {
	buildSupervisorImprovementPlan,
	createSupervisorImprovementProposals,
	formatSupervisorImprovementCreationResult,
	formatSupervisorImprovementPlan,
	type SupervisorImprovementCreationResult,
	type SupervisorImprovementPlan,
} from "./supervisor-improvement-proposals.js";
import {
	analyzeStructuredTaskSignal,
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	structuredTaskInputForText,
	type StructuredTask,
} from "./structured-task-queue.js";
import {
	buildTaskPrompt,
	formatTaskTemplateHelp,
	inferTaskTemplateKind,
	type TaskTemplateKind,
} from "./task-templates.js";
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
	semanticCompactionDraft: () => SaveSemanticCompactionDraftResult;
	formatSemanticCompactionDraft: (
		result: SaveSemanticCompactionDraftResult,
	) => string;
	semanticCompactionReview: (pathOrLatest: string) => SemanticCompactionReview;
	formatSemanticCompactionReview: (review: SemanticCompactionReview) => string;
	semanticAgentTaskPlan: (pathOrLatest: string) => SemanticAgentTaskPlan;
	formatSemanticAgentTaskPlan: (plan: SemanticAgentTaskPlan) => string;
	semanticAgentTasksCreate: (
		pathOrLatest: string,
	) => SemanticAgentTaskCreationResult;
	formatSemanticAgentTaskCreationResult: (
		result: SemanticAgentTaskCreationResult,
	) => string;
	supervisorTick: () => IduSupervisorLoopResult;
	formatSupervisorTick: (result: IduSupervisorLoopResult) => string;
	supervisorOnIduActivation: () => void;
	supervisorImprovementPlan: (
		pathOrLatest: string,
	) => SupervisorImprovementPlan;
	formatSupervisorImprovementPlan: (plan: SupervisorImprovementPlan) => string;
	supervisorImprovementCreate: (
		pathOrLatest: string,
	) => SupervisorImprovementCreationResult;
	formatSupervisorImprovementCreationResult: (
		result: SupervisorImprovementCreationResult,
	) => string;
	createTask: (kind: TaskTemplateKind, details: string) => StructuredTask;
	formatTask: (task: StructuredTask) => string;
	queueDetail: () => string;
	queueClearStructured: () => number;
	queueApprove: (idOrPrefix: string) => StructuredTask | undefined;
	queueReject: (idOrPrefix: string) => StructuredTask | undefined;
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
		{
			enableSemanticAuditTrigger: true,
			onSemanticAuditTrigger: (semanticTrigger) => {
				maybeRunSupervisorAfterSemanticTrigger({
					projectId: activeProject.id,
					projectPath: activeProject.path,
					workspaceRoot: config.agentWorkspaceRoot,
					repository: labDbRepository,
					queue: structuredTaskQueue,
					semanticTrigger,
				});
			},
		},
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
		postflight: () => {
			const report = buildPostflightReport(context);
			maybeRunSupervisorAfterPostflight({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: config.agentWorkspaceRoot,
				repository: labDbRepository,
				queue: structuredTaskQueue,
				risk: report.risk,
			});
			return report;
		},
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
		semanticCompactionDraft: () =>
			saveSemanticCompactionDraft({
				projectId: activeProject.id,
				dbPath: join(config.agentWorkspaceRoot, "reports", "lab.db"),
				reportsPath: join(config.agentWorkspaceRoot, "reports"),
				workspaceRoot: config.agentWorkspaceRoot,
				...semanticCompactionProjectContext(activeProject.path),
			}),
		formatSemanticCompactionDraft,
		semanticCompactionReview: (pathOrLatest) =>
			reviewSemanticCompactionDraft(
				pathOrLatest,
				join(config.agentWorkspaceRoot, "reports"),
			),
		formatSemanticCompactionReview,
		semanticAgentTaskPlan: (pathOrLatest) =>
			buildSemanticAgentTaskPlan(
				pathOrLatest,
				join(config.agentWorkspaceRoot, "reports"),
			),
		formatSemanticAgentTaskPlan,
		semanticAgentTasksCreate: (pathOrLatest) =>
			createSemanticAgentTasks({
				pathOrLatest,
				reportsPath: join(config.agentWorkspaceRoot, "reports"),
				queue: structuredTaskQueue,
				projectId: activeProject.id,
			}),
		formatSemanticAgentTaskCreationResult,
		supervisorTick: () =>
			runIduSupervisorLoop({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: config.agentWorkspaceRoot,
				trigger: "manual",
				options: {
					allowSemanticDraft: true,
					allowAgentTaskPlan: true,
					dryRun: false,
				},
				repository: labDbRepository,
				queue: structuredTaskQueue,
			}),
		formatSupervisorTick: formatIduSupervisorLoopResult,
		supervisorOnIduActivation: () => {
			maybeRunSupervisorOnIduActivation({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: config.agentWorkspaceRoot,
				repository: labDbRepository,
				queue: structuredTaskQueue,
			});
		},
		supervisorImprovementPlan: (pathOrLatest) =>
			buildSupervisorImprovementPlan(
				pathOrLatest,
				join(config.agentWorkspaceRoot, "reports"),
			),
		formatSupervisorImprovementPlan,
		supervisorImprovementCreate: (pathOrLatest) =>
			createSupervisorImprovementProposals(
				pathOrLatest,
				join(config.agentWorkspaceRoot, "reports"),
			),
		formatSupervisorImprovementCreationResult,
		createTask: (kind, details) =>
			createCliTask(kind, details, {
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: config.agentWorkspaceRoot,
				structuredTaskQueue,
				labDbRepository,
				preflight: (request) => buildPreflightReport(request, context),
			}),
		formatTask: formatCliTaskResult,
		queueDetail: () =>
			formatStructuredTaskQueueDetail(structuredTaskQueue.listTasks(), {
				approveCommand: (id) => `idu-pi idu-queue-approve ${id}`,
				rejectCommand: (id) => `idu-pi idu-queue-reject ${id}`,
			}),
		queueClearStructured: () => structuredTaskQueue.clearPersisted(),
		queueApprove: (id) => approveStructuredTaskById(structuredTaskQueue, id),
		queueReject: (id) => rejectStructuredTaskById(structuredTaskQueue, id),
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
		if (command === "comandos") return ok(formatCommandCatalog());
		const activeRuntime = runtime ?? createCliRuntime();
		configureIduSessionStore({ workspaceRoot: activeRuntime.workspaceRoot });
		switch (command) {
			case "status":
				return ok(
					activeRuntime.formatConnection(activeRuntime.inspectConnection()),
				);
			case "idu": {
				activateIduSession(activeRuntime.projectId);
				activeRuntime.supervisorOnIduActivation();
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
			case "idu-semantic-audit-status":
			case "semantic-audit-status":
				return ok(
					activeRuntime.formatSemanticAuditStatus(
						activeRuntime.semanticAuditStatus(),
					),
				);
			case "idu-semantic-audit-run":
			case "semantic-audit-run":
				return ok(
					activeRuntime.formatSemanticAuditRun(
						activeRuntime.semanticAuditRun(),
					),
				);
			case "idu-semantic-compact-draft":
			case "semantic-compact-draft":
				return ok(
					activeRuntime.formatSemanticCompactionDraft(
						activeRuntime.semanticCompactionDraft(),
					),
				);
			case "idu-semantic-compact-review":
			case "semantic-compact-review":
				return ok(
					activeRuntime.formatSemanticCompactionReview(
						activeRuntime.semanticCompactionReview(requiredText(rest)),
					),
				);
			case "idu-semantic-agent-tasks-review":
			case "semantic-agent-tasks-review":
				return ok(
					activeRuntime.formatSemanticAgentTaskPlan(
						activeRuntime.semanticAgentTaskPlan(requiredText(rest)),
					),
				);
			case "idu-semantic-agent-tasks-create":
			case "semantic-agent-tasks-create":
				return ok(
					activeRuntime.formatSemanticAgentTaskCreationResult(
						activeRuntime.semanticAgentTasksCreate(requiredText(rest)),
					),
				);
			case "idu-supervisor-tick":
			case "supervisor-tick":
				return ok(
					activeRuntime.formatSupervisorTick(activeRuntime.supervisorTick()),
				);
			case "idu-supervisor-improvements-review":
			case "supervisor-improvements-review":
				return ok(
					activeRuntime.formatSupervisorImprovementPlan(
						activeRuntime.supervisorImprovementPlan(requiredText(rest)),
					),
				);
			case "idu-supervisor-improvements-create":
			case "supervisor-improvements-create":
				return ok(
					activeRuntime.formatSupervisorImprovementCreationResult(
						activeRuntime.supervisorImprovementCreate(requiredText(rest)),
					),
				);
			case "idu-task":
			case "task": {
				if (!rest.length) return ok(formatTaskTemplateHelp());
				const first = rest[0] as TaskTemplateKind;
				const knownKinds: TaskTemplateKind[] = [
					"bug",
					"feature",
					"refactor",
					"docs",
					"review",
				];
				const hasExplicitKind = knownKinds.includes(first);
				const details = (hasExplicitKind ? rest.slice(1) : rest)
					.join(" ")
					.trim();
				const kind = hasExplicitKind ? first : inferTaskTemplateKind(details);
				const task = activeRuntime.createTask(kind, details);
				return ok(activeRuntime.formatTask(task));
			}
			case "idu-queue":
			case "queue":
			case "idu-queue-detail":
			case "queue-detail":
				return ok(activeRuntime.queueDetail());
			case "idu-queue-clear-structured":
			case "queue-clear-structured": {
				const count = activeRuntime.queueClearStructured();
				return ok(`Cola estructurada limpiada: ${count} tarea(s).`);
			}
			case "idu-queue-approve":
			case "queue-approve":
			case "queue_approve": {
				const id = requiredText(rest);
				const task = activeRuntime.queueApprove(id);
				if (!task) return fail("Uso: idu-pi queue-approve <id>");
				return ok(`Tarea aprobada: ${task.id}. No ejecuté IA ni AgentLabs.`);
			}
			case "idu-queue-reject":
			case "queue-reject":
			case "queue_reject": {
				const id = requiredText(rest);
				const task = activeRuntime.queueReject(id);
				if (!task) return fail("Uso: idu-pi queue-reject <id>");
				return ok(`Tarea rechazada: ${task.id}.`);
			}
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

export function createCliTask(
	kind: TaskTemplateKind,
	details: string,
	context: {
		projectId: string;
		projectPath: string;
		workspaceRoot: string;
		structuredTaskQueue: StructuredTaskQueue;
		labDbRepository: LabDbRepository;
		preflight: (request: string) => ProjectPreflightReport;
	},
): StructuredTask {
	const prompt = buildTaskPrompt(kind, details);
	if (!prompt) {
		throw new Error(formatTaskTemplateHelp());
	}
	const signal = analyzeStructuredTaskSignal(details || prompt);
	let task = context.structuredTaskQueue.enqueueTask(
		structuredTaskInputForText(prompt, {
			source: "cli",
			projectId: context.projectId,
			category: kind,
			originalText: details,
			analyzer: () => signal,
		}),
	);
	if (shouldUseAutomaticGuardrails(context.projectId)) {
		const report = context.preflight(prompt);
		const guardRisk = strongestGuardRisk(report.risk, task.intentRiskHint);
		const reason = [
			`preflight ${report.risk}`,
			task.intentRiskHint ? `intent ${task.intentRiskHint}` : undefined,
			task.intentConcepts?.length
				? `intención: ${task.intentKind}/${task.intentConcepts.join("+")}`
				: undefined,
			...report.affectedAreas.map((area) => `área: ${area}`),
			...report.warnings,
		]
			.filter(Boolean)
			.join("; ");
		task =
			guardRisk === "high" || guardRisk === "blocker"
				? (context.structuredTaskQueue.markNeedsConfirmation(task.id, {
						guardRisk,
						guardReason: reason,
					}) ?? task)
				: (context.structuredTaskQueue.markGuardClear(
						task.id,
						guardRisk,
						reason,
					) ?? task);
	}
	try {
		context.labDbRepository.recordUserSignal({
			id: randomUUID(),
			projectId: context.projectId,
			source: "cli-task",
			rawText: details || prompt,
			detectedEmotion: signal.emotion,
			urgency: signal.urgency,
			confidence: signal.confidence,
			matchedKeywords: signal.matchedKeywords,
		});
	} catch {
		// SQLite/semantic trigger is secondary; CLI task creation remains the source of truth.
	}
	maybeRunSupervisorAfterTask({
		projectId: context.projectId,
		projectPath: context.projectPath,
		workspaceRoot: context.workspaceRoot,
		repository: context.labDbRepository,
		queue: context.structuredTaskQueue,
		task,
	});
	return task;
}

function semanticCompactionProjectContext(projectPath: string): {
	projectCore?: string;
	constitution?: string;
} {
	try {
		const core = loadProjectCore(projectPath);
		if (core.status !== "confirmed") return {};
		const constitution = existsSync(
			join(projectPath, "config", "project-constitution.json"),
		)
			? loadProjectConstitution(projectPath)
			: deriveConstitutionFromProjectCore(core);
		return {
			projectCore: formatProjectCoreForPrompt(core),
			constitution: JSON.stringify(
				{
					status: constitution.status,
					principles: constitution.principles,
					requiredPractices: constitution.requiredPractices,
					forbiddenPractices: constitution.forbiddenPractices,
					approvalRules: constitution.approvalRules,
					validationGates: constitution.validationGates,
				},
				null,
				2,
			),
		};
	} catch {
		return {};
	}
}

function strongestGuardRisk(
	preflightRisk: ProjectPreflightReport["risk"],
	intentRisk: StructuredTask["intentRiskHint"],
): ProjectPreflightReport["risk"] {
	const order: ProjectPreflightReport["risk"][] = [
		"low",
		"medium",
		"high",
		"blocker",
	];
	if (!intentRisk) return preflightRisk;
	return order.indexOf(intentRisk) > order.indexOf(preflightRisk)
		? intentRisk
		: preflightRisk;
}

export function approveStructuredTaskById(
	queue: StructuredTaskQueue,
	id: string,
): StructuredTask | undefined {
	const task = queue.getTask(id);
	return task ? queue.markGuardApproved(task.id) : undefined;
}

export function rejectStructuredTaskById(
	queue: StructuredTaskQueue,
	id: string,
): StructuredTask | undefined {
	const task = queue.getTask(id);
	return task
		? queue.markGuardRejected(task.id, "Rechazada por confirmación humana.")
		: undefined;
}

export function formatCliTaskResult(task: StructuredTask): string {
	const paused = task.guardStatus === "needs_confirmation";
	return [
		"Idu-pi Task",
		"",
		"Estado:",
		paused ? "Tarea pausada: requiere confirmación humana" : "queued",
		"",
		"ID:",
		task.id,
		"",
		"Categoría:",
		task.category,
		"",
		"Prioridad:",
		String(task.priority),
		"",
		"Emoción:",
		task.emotion ?? "neutral",
		...(task.intentKind
			? [
					"",
					"Intención:",
					`${task.intentKind}/${primaryIntentConcept(task.intentConcepts)}/${task.intentRiskHint ?? "low"}`,
				]
			: []),
		...(task.guardStatus
			? [
					"",
					"Guard:",
					`${task.guardStatus}${task.guardRisk ? `/${task.guardRisk}` : ""}`,
				]
			: []),
		...(paused
			? [
					"",
					"Aprobar:",
					`idu-pi idu-queue-approve ${task.id}`,
					"Rechazar:",
					`idu-pi idu-queue-reject ${task.id}`,
				]
			: []),
		"",
		"Nota segura:",
		"Registré la tarea y la señal localmente; no ejecuté IA ni AgentLabs.",
	].join("\n");
}

function primaryIntentConcept(concepts: string[] | undefined): string {
	return (
		concepts?.find((concept) => concept !== "task" && concept !== "queue") ??
		concepts?.[0] ??
		"unknown"
	);
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
		"  idu-pi idu-supervisor-tick (Telegram: /idu_supervisor_tick)",
		"  idu-pi idu-supervisor-improvements-review latest",
		"  idu-pi idu-supervisor-improvements-create latest",
		'  idu-pi preflight "solicitud"',
		'  idu-pi advisory "solicitud"',
		"  idu-pi postflight",
		"  idu-pi lab-review-plan postflight",
		"  idu-pi idu-semantic-audit-status (Telegram: /semantic_audit_status)",
		"  idu-pi idu-semantic-audit-run    (Telegram: /semantic_audit_run)",
		"  idu-pi idu-semantic-compact-draft (Telegram: /semantic_compact_draft)",
		"  idu-pi idu-semantic-compact-review latest",
		"  idu-pi idu-semantic-agent-tasks-review latest",
		"  idu-pi idu-semantic-agent-tasks-create latest",
		'  idu-pi idu-task [tipo] "detalle" (Telegram: /task bug <detalle>)',
		"  idu-pi idu-queue-detail          (Telegram: /queue_detail)",
		"  idu-pi idu-queue-clear-structured (Telegram: /queue_clear_structured)",
		"  idu-pi idu-queue-approve <id>    (Telegram: /queue_approve <id>)",
		"  idu-pi idu-queue-reject <id>     (Telegram: /queue_reject <id>)",
		"",
		"Notas:",
		"- Usa AGENT_WORKSPACE_ROOT y el registro de proyectos del bridge.",
		"- No usa IA, no ejecuta AgentLabs y no aplica project-flows.",
		"- Las mejoras del supervisor son propuestas de revisión; no aplican reglas ni skills.",
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
