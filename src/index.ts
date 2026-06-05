import { Bot, type Context } from "grammy";
import { existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AgentRouter,
	formatAgentProfiles,
	type AgentRuntime,
} from "./agent-router.js";
import { chunkTelegramText } from "./chunk.js";
import {
	formatCommandCatalog,
	formatHelpText,
	telegramCommandsForApi,
} from "./command-catalog.js";
import { canonicalDirectory, isAllowedCwd, loadConfig } from "./config.js";
import {
	formatConfigDoctor,
	formatConfigOverview,
	formatInitAssetsResult,
	formatInitProjectConfigResult,
	formatInitWorkspaceResult,
	formatProjectMapInspection,
	formatSkillsSyncResult,
	initProjectAssets,
	initProjectConfig,
	initWorkspaceRoot,
	inspectProjectConfig,
	inspectProjectMap,
	syncNecessarySkills,
} from "./config-wizard.js";
import { detectAgents, formatAgents, formatDoctor } from "./doctor.js";
import {
	createAiProjectBlueprintDraft,
	createAiProjectFlowsDraft,
	formatAiProjectDraftResult,
	formatAiProjectDraftReview,
	reviewAiProjectBlueprintDraft,
	reviewAiProjectFlowsDraft,
} from "./project-ai-drafts.js";
import {
	formatDurationChoices,
	parseLabDuration,
	type LabDuration,
} from "./lab.js";
import {
	applyProjectFlowsDraft,
	formatProjectFlowDraftResult,
	formatProjectFlowDraftReview,
	formatProjectFlowSuggestions,
	formatProjectFlowsDraftApplyResult,
	formatProjectMapScan,
	reviewProjectFlowsDraft,
	saveProjectFlowsDraft,
	scanProjectMap,
	suggestProjectFlowsFromScan,
} from "./project-map-scanner.js";
import {
	buildProjectAdvisory,
	formatProjectAdvisory,
} from "./project-advisory.js";
import {
	formatIduPrepareResult,
	runIduPrepare,
	type IduPrepareResult,
} from "./idu-prepare.js";
import { formatIduProjectDashboard } from "./idu-project-dashboard.js";
import {
	approveMasterPlan,
	ensureMasterPlanForIdu,
	formatIduSupervisorPlanReport,
	formatMasterPlanOperation,
	formatMasterPlanReview,
	formatMasterPlanStatus,
	getMasterPlanStatus,
	handleMasterPlanNaturalDecision,
	readGitHead,
	recordMasterPlanLabReviewDone,
	redraftMasterPlan,
	rejectMasterPlan,
	reviewMasterPlan,
} from "./master-plan.js";
import { resolveProjectStatePaths } from "./project-state.js";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	formatIduSessionStatus,
	getIduSessionStatus,
	shouldUseAutomaticGuardrails,
} from "./idu-session.js";
import { buildLabReviewPlan, formatLabReviewPlan } from "./lab-review-plan.js";
import { loadProjectBlueprint } from "./project-blueprint.js";
import {
	answerProjectCoreWizard,
	getProjectCoreWizardStatus,
	startProjectCoreWizard,
} from "./project-core-wizard.js";
import {
	confirmProjectCore,
	diffProjectCore,
	formatProjectCoreConfirmationResult,
	formatProjectCoreDiff,
	rejectProjectCore,
} from "./project-core-confirmation.js";
import {
	deriveConstitutionFromProjectCore,
	loadProjectConstitution,
} from "./project-constitution.js";
import { formatProjectCoreForPrompt, loadProjectCore } from "./project-core.js";
import {
	formatProjectCoreResearchDraft,
	formatProjectCoreResearchReview,
	reviewProjectCoreResearchDraft,
	saveProjectCoreResearchDraft,
} from "./project-core-research.js";
import { buildPostflightPhysicalGates } from "./physical-gates.js";
import { inspectProjectConnection } from "./project-connection.js";
import {
	analyzeProjectPreflight,
	formatProjectPreflightReport,
	type ProjectPreflightReport,
} from "./project-preflight.js";
import {
	analyzeProjectPostflight,
	formatProjectPostflightReport,
	readProjectPostflightGitState,
	type ProjectPostflightReport,
} from "./project-postflight.js";
import { loadProjectFlows } from "./project-flows.js";
import { decidePromptQueueAction } from "./prompt-queue-policy.js";
import {
	formatLabRunResultLines,
	labProfilesForIndexes,
	runLabForProfiles as runLabForProfilesService,
	syncPendingReportsToEngram,
	triagePendingReports,
} from "./lab-service.js";
import {
	cleanAgentOutput,
	LabReportStore,
	stripEngramNoise,
	summarizeOutput,
} from "./lab-reports.js";
import { formatInitLabDbResult, initLabDb } from "./lab-db.js";
import { LabDbRepository } from "./lab-db-repository.js";
import {
	buildSemanticAuditStatus,
	formatSemanticAuditRunResult,
	formatSemanticAuditStatus,
	runManualSemanticAudit,
} from "./semantic-audit-command.js";
import {
	formatSemanticCompactionDraft,
	formatSemanticCompactionReview,
	reviewSemanticCompactionDraft,
	saveSemanticCompactionDraft,
} from "./semantic-compaction.js";
import {
	buildSemanticAgentTaskPlan,
	createSemanticAgentTasks,
	formatSemanticAgentTaskCreationResult,
	formatSemanticAgentTaskPlan,
} from "./semantic-agent-tasks.js";
import {
	formatIduSupervisorLoopResult,
	runIduSupervisorLoop,
} from "./idu-supervisor-loop.js";
import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertEngineReport,
} from "./autonomous-alert-engine.js";
import {
	readAutonomousAlertEngineState,
	updateAutonomousAlertControlState,
	type AutonomousAlertEngineState,
} from "./autonomous-alert-engine-state.js";
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
} from "./supervisor-improvement-proposals.js";
import {
	approveSupervisorImprovement,
	deferSupervisorImprovement,
	formatSupervisorImprovementDecisionResult,
	formatSupervisorImprovementStatus,
	getSupervisorImprovementStatus,
	rejectSupervisorImprovement,
} from "./supervisor-improvement-decisions.js";
import {
	buildSkillImprovementPlan,
	createSkillImprovementProposals,
	formatSkillImprovementCreationResult,
	formatSkillImprovementPlan,
	formatSkillImprovementStatus,
	getSkillImprovementStatus,
} from "./skill-improvement-proposals.js";
import {
	approveSkillImprovementProposal,
	deferSkillImprovementProposal,
	formatSkillImprovementDecisionResult,
	rejectSkillImprovementProposal,
} from "./skill-improvement-decisions.js";
import {
	createAgentLabReviewRequests,
	formatAgentLabReviewRequestPlan,
	formatAgentLabReviewRequestReview,
	reviewAgentLabReviewRequest,
} from "./agentlab-review-requests.js";
import {
	formatAgentLabReviewRunResult,
	formatAgentLabReviewStatus,
	getAgentLabReviewStatus,
	runAgentLabReviewRequestFile,
} from "./agentlab-review-runner.js";
import {
	consolidateAgentLabReviewRun,
	formatAgentLabConsolidationResult,
	formatAgentLabConsolidationStatus,
	getAgentLabConsolidationStatus,
} from "./agentlab-report-consolidation.js";
import {
	createSkillDraftsFromApprovedProposals,
	formatSkillDraftCreationResult,
	formatSkillDraftReview,
	reviewSkillDraft,
} from "./skill-drafts.js";
import {
	applySupervisorLearningRules,
	disableSupervisorLearningRule,
	enableSupervisorLearningRule,
	formatSupervisorLearningRuleDecision,
	formatSupervisorLearningRulesApplyResult,
	formatSupervisorLearningRulesRollback,
	formatSupervisorLearningRulesStatus,
	formatSupervisorLearningRulesTest,
	getSupervisorLearningRulesStatus,
	rollbackSupervisorLearningRules,
	testSupervisorLearningRules,
} from "./supervisor-learning-rules.js";
import { findPiProcesses } from "./processes.js";
import {
	addProject,
	getActiveProject,
	loadRegistry,
	parseAddProjectArgs,
	saveRegistry,
	setActiveProject,
} from "./projects.js";
import {
	buildDashboardText,
	buildQuickCommandPrompt,
} from "./quick-commands.js";
import { buildSafePushReport } from "./safe-push.js";
import {
	LEGACY_SESSION_COMMANDS,
	PATH_SESSION_COMMANDS,
	PUBLIC_TELEGRAM_HANDLER_COMMANDS,
	QUICK_PROMPT_COMMANDS,
	WORK_SESSION_COMMANDS,
} from "./telegram-command-registry.js";
import {
	buildTaskPrompt,
	formatTaskTemplateHelp,
	parseTaskTemplateCommand,
} from "./task-templates.js";
import {
	getSessionName,
	loadSessionNames,
	saveSessionNames,
	setSessionName,
} from "./session-names.js";
import type { PiRpcProgressEvent, PiRpcUiRequest } from "./pi-rpc.js";
import { oneLine, summarizeSessionFile } from "./session-summary.js";
import {
	findRecentSessionsForCwd,
	formatAge,
	isActiveSessionChoice,
	resolveSessionPick,
	type SessionPick,
} from "./sessions.js";
import {
	formatUiRequestForTelegram,
	inlineKeyboardForUiRequest,
	isBlockingUiRequest,
	parseServerCommand,
	parseUiCallbackData,
	parseUiRequestAnswer,
} from "./telegram-ui.js";
import {
	bridgeLifecycleReply,
	launchBridgeLifecycle,
} from "./bridge-lifecycle.js";
import {
	bridgeControlIntentPath,
	consumeBridgeControlIntent,
	formatBridgeStartupStatus,
	launchBridgeControlSafely,
	writeBridgeControlIntent,
} from "./bridge-control.js";
import {
	formatBridgeEnvStatus,
	packageEnvPath,
	readEnvDraft,
	tailTextFile,
} from "./env-config.js";
import {
	buildIduRemoteMenuKeyboard,
	buildIduRemoteMenuText,
	buildIduRemoteProjectKeyboard,
	type IduRemoteCommand,
	formatIduRemoteProjectList,
	parseIduRemoteCallback,
} from "./remote-menu.js";
import { TaskQueue } from "./task-queue.js";
import {
	analyzeStructuredTaskSignal,
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	structuredTaskInputForText,
	type StructuredTask,
} from "./structured-task-queue.js";
import {
	buildSupervisorSelfMaintenanceAdvisory,
	type SupervisorSelfMaintenanceAdvisory,
} from "./supervisor-self-maintenance-advisory.js";
import {
	readSupervisorActivityEvents,
	summarizeSupervisorActivityEvents,
} from "./supervisor-activity-events.js";
import {
	buildIduUsageReport,
	readIduUsageEvents,
} from "./usage-events.js";
import {
	buildAgentLabEffectivenessReport,
	readAgentLabEffectivenessEvents,
} from "./agentlab-effectiveness-events.js";

const config = loadConfig();
process.env.AGENT_WORKSPACE_ROOT ??= config.agentWorkspaceRoot;
configureIduSessionStore({ workspaceRoot: config.agentWorkspaceRoot });
const bot = new Bot(config.telegramBotToken);
const registry = loadRegistry(config.defaultCwd, config.allowedRoots);
let sessionNames = loadSessionNames();
const activeProject = getActiveProject(registry);

let currentCwd = activeProject?.path ?? config.defaultCwd;
const agentRouter = new AgentRouter({
	piBin: config.piBin,
	basePiArgs: config.piArgs,
	profiles: config.agentProfiles,
	defaultProjectId: activeProject?.id ?? "default",
	defaultCwd: currentCwd,
	workspaceRoot: config.agentWorkspaceRoot,
	workspaceMode: config.agentWorkspaceMode,
});
const labReportStore = new LabReportStore(config.agentWorkspaceRoot);
const labDbRepository = new LabDbRepository(labDbPath(), {
	enableSemanticAuditTrigger: true,
	onSemanticAuditTrigger: (semanticTrigger) => {
		maybeRunSupervisorAfterSemanticTrigger({
			projectId: currentProjectId(),
			projectPath: activeProjectPath(),
			workspaceRoot: config.agentWorkspaceRoot,
			supervisorActivityStateRoot: activeProjectStateRoot(),
			repository: labDbRepository,
			queue: structuredTaskQueue,
			semanticTrigger,
		});
	},
});
const taskQueue = new TaskQueue();
const lastIduPrepareByProject = new Map<string, IduPrepareResult>();
const structuredTaskQueue = new StructuredTaskQueue({
	workspaceRoot: config.agentWorkspaceRoot,
});
let taskQueueGeneration = 0;
let activePromptInFlight = false;
let pendingLabRequest: { profileIndexes: number[] } | null = null;
let pendingUiRequest: PiRpcUiRequest | null = null;
let pendingUiRuntime: AgentRuntime | null = null;
let pendingUiToken: string | null = null;
let pendingUiCounter = 0;
let pendingAction:
	| "addproject-path"
	| "useproject-id"
	| "select-session"
	| "select-agent"
	| "extension-ui"
	| "select-lab-agent"
	| "select-lab-duration"
	| "project-core-wizard"
	| null = null;
let lastProjectChoices: string[] = [];
let lastSessionPicks: SessionPick[] = [];

function clearPendingUiRequest(): void {
	pendingUiRequest = null;
	pendingUiRuntime = null;
	pendingUiToken = null;
	if (pendingAction === "extension-ui") pendingAction = null;
}

function projectIdForCwd(path: string): string {
	return registry.projects.find((project) => project.path === path)?.id ?? path;
}

function switchProjectContext(path: string, sessionPath?: string): void {
	currentCwd = path;
	lastSessionPicks = [];
	agentRouter.switchProject(projectIdForCwd(path), path);
	if (sessionPath) agentRouter.resetActiveSession(sessionPath);
}

function activeProjectLabel(): string {
	const project = getActiveProject(registry);
	return project
		? `${project.id} (${project.path})`
		: `sin proyecto (${currentCwd})`;
}

async function replyIduRemoteMenu(ctx: Context): Promise<void> {
	await ctx.reply(buildIduRemoteMenuText(activeProjectLabel()), {
		reply_markup: buildIduRemoteMenuKeyboard(),
	});
}

async function replyIduRemoteProjects(ctx: Context): Promise<void> {
	await ctx.reply(formatIduRemoteProjectList(registry), {
		reply_markup: buildIduRemoteProjectKeyboard(registry),
	});
}

async function activateRemoteProject(
	ctx: Context,
	projectId: string,
): Promise<void> {
	const project = setActiveProject(registry, projectId, config.allowedRoots);
	saveRegistry(registry);
	switchProjectContext(project.path);
	await ctx.reply(
		`Proyecto activo actualizado:\n${project.id}\n${project.path}`,
		{
			reply_markup: buildIduRemoteMenuKeyboard(),
		},
	);
}

async function runIduRemoteCommand(
	ctx: Context,
	command: IduRemoteCommand,
): Promise<void> {
	const packageRoot = resolvePackageRootForTelegram();
	if (command === "remote_status") {
		const envPath = packageEnvPath(packageRoot);
		const logPath = join(packageRoot, "logs", "bridge.log");
		await replyLong(
			ctx,
			formatBridgeEnvStatus({
				envPath,
				exists: existsSync(envPath),
				values: readEnvDraft(envPath).values,
				packageRoot,
				startScriptExists: existsSync(
					join(packageRoot, "scripts", "start-bridge.ps1"),
				),
				stopScriptExists: existsSync(
					join(packageRoot, "scripts", "stop-bridge.ps1"),
				),
				logPath,
				logExists: existsSync(logPath),
				bridgeStatus: "activo (este bot está respondiendo)",
			}),
		);
		return;
	}
	if (command === "remote_logs") {
		await replyLong(
			ctx,
			tailTextFile(join(packageRoot, "logs", "bridge.log"), 80),
		);
		return;
	}
	if (command === "sync_commands") {
		const commands = telegramCommandsForApi();
		await bot.api.setMyCommands(commands);
		await ctx.reply(`Comandos remotos sincronizados: ${commands.length}.`);
		return;
	}
	if (
		command === "bridge_start" ||
		command === "bridge_restart" ||
		command === "bridge_stop"
	) {
		const action =
			command === "bridge_stop"
				? "off"
				: command === "bridge_restart"
					? "restart"
					: "run";
		await ctx.reply(bridgeLifecycleReply(action));
		launchBridgeLifecycle(action, packageRoot);
		return;
	}
	if (command === "idu") {
		const projectId = currentProjectId();
		activateIduSession(projectId);
		maybeRunSupervisorOnIduActivation({
			projectId,
			projectPath: activeProjectPath(),
			workspaceRoot: config.agentWorkspaceRoot,
			supervisorActivityStateRoot: activeProjectStateRoot(),
			repository: labDbRepository,
			queue: structuredTaskQueue,
		});
		const report = inspectProjectConnection({
			registry,
			defaultCwd: config.defaultCwd,
			allowedRoots: config.allowedRoots,
			workspaceRoot: config.agentWorkspaceRoot,
		});
		await replyLong(
			ctx,
			[
				"Guardrails automáticos activados para el proyecto activo.",
				"",
				iduProjectDashboardText(report),
			].join("\n"),
		);
		return;
	}
	if (command === "idu_status") {
		await replyLong(
			ctx,
			formatIduSessionStatus(getIduSessionStatus(currentProjectId())),
		);
		return;
	}
	if (command === "idu_prepare") {
		await ctx.reply(
			"Atajo remoto seguro: escribí /idu_prepare para confirmar la preparación del proyecto activo.",
		);
		return;
	}
	if (command === "queue_detail") {
		await replyLong(
			ctx,
			formatStructuredTaskQueueDetail(structuredTaskQueue.listTasks()),
		);
		return;
	}
	if (command === "dashboard") {
		await ctx.reply(buildDashboardText(dashboardState()));
		return;
	}
	if (command === "doctor") {
		await replyLong(ctx, await formatDoctor(config, currentCwd));
		return;
	}
	pendingAction = "useproject-id";
	await replyLong(
		ctx,
		`Proyectos registrados:\n\n${formatProjectChoices() || "(ninguno)"}\n\nRespondé con número o id para activar un proyecto, o /cancel para salir.`,
	);
}

function resolvePackageRootForTelegram(): string {
	return dirname(fileURLToPath(import.meta.url)).replace(
		/[\\/]dist[\\/]src$/u,
		"",
	);
}

function currentProjectId(): string {
	return getActiveProject(registry)?.id ?? projectIdForCwd(currentCwd);
}

function sessionPicksForActiveProject(
	limit = 8,
	includeAuxiliary = false,
): SessionPick[] {
	const picks = findRecentSessionsForCwd(homedir(), currentCwd, 120)
		.filter((session) => isAllowedCwd(session.cwd, config.allowedRoots))
		.map((session) => {
			const summary = summarizeSessionFile(session.file);
			const titleSource =
				getSessionName(sessionNames, session.id) ||
				summary.titleHint ||
				summary.lastUserText ||
				summary.firstUserText ||
				session.id;
			const firstText = summary.firstUserText || titleSource;
			const isAuxiliary =
				session.file.includes("subagent-") ||
				/^(Task: Fresh review|Task: |Orquestación obligatoria|Modo laboratorio)/u.test(
					firstText,
				) ||
				/^(Task: Fresh review|Task: |Orquestación obligatoria|Modo laboratorio)/u.test(
					titleSource,
				);
			return {
				...session,
				index: 0,
				title: oneLine(titleSource, 80),
				preview:
					summary.lastAssistantText ||
					summary.lastUserText ||
					summary.firstUserText ||
					"(sin preview)",
				messageCount: summary.messageCount,
				subagentCount: summary.subagentCount,
				isAuxiliary,
			};
		})
		.filter((pick) => includeAuxiliary || !pick.isAuxiliary)
		.slice(0, limit);

	return picks.map((pick, offset) => ({ ...pick, index: offset + 1 }));
}

function formatSessionPicks(picks: SessionPick[]): string {
	return picks
		.map(
			(pick) =>
				`T${pick.index}. ${pick.title}\n   ${pick.messageCount} mensajes · ${formatAge(pick.mtimeMs)} · ${pick.id.slice(0, 8)}${pick.subagentCount ? ` · subagents ${pick.subagentCount}` : ""}\n   Última respuesta: ${oneLine(pick.preview, 120)}`,
		)
		.join("\n\n");
}

function getSessionPick(indexText: string): SessionPick | undefined {
	return resolveSessionPick(lastSessionPicks, indexText);
}

function formatProjectChoices(): string {
	lastProjectChoices = registry.projects.map((project) => project.id);
	return registry.projects
		.map((project, index) => {
			const marker = project.id === registry.activeProjectId ? " ✅" : "";
			return `${index + 1}. ${project.id}${marker}\n   ${project.path}`;
		})
		.join("\n\n");
}

function resolveProjectChoice(input: string): string {
	const normalized = input.trim().replace(/\.$/u, "");
	const choices = lastProjectChoices.length
		? lastProjectChoices
		: registry.projects.map((project) => project.id);
	const index = Number(normalized);
	if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
		return choices[index - 1];
	}
	return input;
}

async function showSessionPreview(
	ctx: Context,
	pick: SessionPick,
): Promise<void> {
	await replyLong(
		ctx,
		`Trabajo T${pick.index}: ${pick.title}\n${pick.cwd}\n${pick.id.slice(0, 8)} · ${pick.messageCount} mensajes · hace ${formatAge(pick.mtimeMs)}\n\nÚltima respuesta útil:\n${pick.preview}`,
	);
}

async function resumeSessionPick(
	ctx: Context,
	pick: SessionPick,
): Promise<void> {
	switchProjectContext(pick.cwd, pick.file);
	pendingAction = null;
	await showSessionPreview(ctx, pick);
	await ctx.reply(
		`Elegiste T${pick.index}: ${pick.title}. Mandá tu próximo mensaje para continuar ahí, o /cancel.`,
	);
}

function isAllowedUser(ctx: Context): boolean {
	return ctx.from?.id === config.allowedUserId;
}

async function replyLong(ctx: Context, text: string): Promise<void> {
	for (const chunk of chunkTelegramText(text)) {
		await ctx.reply(chunk);
	}
}

async function guard(ctx: Context): Promise<boolean> {
	if (isAllowedUser(ctx)) return true;
	await ctx.reply("No autorizado.");
	return false;
}

function commandArg(text: string): string {
	return text.replace(/^\/\w+(?:@\w+)?\s*/u, "").trim();
}

function parseSupervisorImprovementDecisionArgs(match: string | undefined): {
	pathOrLatest: string;
	proposalIdOrAll: string;
	reason?: string;
} {
	const [pathOrLatest = "", proposalIdOrAll = "", ...reasonParts] = (
		match ?? ""
	)
		.trim()
		.split(/\s+/u)
		.filter(Boolean);
	if (!pathOrLatest || !proposalIdOrAll) {
		throw new Error("Uso: latest <proposalId|all> [motivo]");
	}
	const reason = reasonParts.join(" ").trim();
	return {
		pathOrLatest,
		proposalIdOrAll,
		...(reason ? { reason } : {}),
	};
}

function parseSupervisorLearningRuleDecisionArgs(match: string | undefined): {
	ruleId: string;
	reason?: string;
} {
	const [ruleId = "", ...reasonParts] = (match ?? "")
		.trim()
		.split(/\s+/u)
		.filter(Boolean);
	if (!ruleId) throw new Error("Uso: <ruleId> [motivo]");
	const reason = reasonParts.join(" ").trim();
	return { ruleId, ...(reason ? { reason } : {}) };
}

function buildPreflightReport(request: string): ProjectPreflightReport {
	const connection = inspectProjectConnection({
		registry,
		defaultCwd: config.defaultCwd,
		allowedRoots: config.allowedRoots,
		workspaceRoot: config.agentWorkspaceRoot,
	});
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

async function runOrReuseTelegramMasterPlanDeepReview(): Promise<void> {
	const currentStatus = getAgentLabReviewStatus("latest", reportsPath());
	if (
		currentStatus.valid &&
		currentStatus.result &&
		currentStatus.result.runs.length > 0
	) {
		recordMasterPlanLabReviewDone({
			stateRoot: activeProjectStateRoot(),
			run: currentStatus.result,
		});
		return;
	}
	const requestPlan = createAgentLabReviewRequests({
		source: "master_plan",
		reportsPath: reportsPath(),
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
		masterPlanPathOrLatest: "latest",
	});
	if (requestPlan.errors.length > 0) return;
	const run = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath: reportsPath(),
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
		router: agentRouter,
	});
	recordMasterPlanLabReviewDone({
		stateRoot: activeProjectStateRoot(),
		run,
	});
}

function iduProjectDashboardText(
	report: ReturnType<typeof inspectProjectConnection>,
): string {
	const lastPrepare = report.projectId
		? lastIduPrepareByProject.get(report.projectId)
		: undefined;
	return formatIduProjectDashboard({
		projectId: report.projectId,
		configStatus: report.configStatus,
		alignmentStatus: lastPrepare?.alignmentStatus ?? report.alignmentStatus,
		readiness: lastPrepare?.readiness ?? report.readiness,
		reason: lastPrepare
			? prepareAlignmentReason(lastPrepare)
			: report.alignmentReason,
		recommendedNext: report.recommendedNext,
	});
}

function prepareAlignmentReason(result: IduPrepareResult): string[] {
	const differences = result.differencesDetected;
	const reasons: string[] = [];
	if (differences.screens > 0) {
		reasons.push(
			`último prepare detectó ${differences.screens} screens sugeridas`,
		);
	}
	if (differences.uiElements > 0) {
		reasons.push(
			`último prepare detectó ${differences.uiElements} uiElements sugeridos`,
		);
	}
	if (differences.dataStores > 0) {
		reasons.push(
			`último prepare detectó ${differences.dataStores} dataStores sugeridos`,
		);
	}
	if (differences.flows > 0) {
		reasons.push(`último prepare detectó ${differences.flows} flows sugeridos`);
	}
	if (result.alignmentStatus === "stale") {
		reasons.push("hubo cambios locales después del prepare");
	}
	if (!reasons.length && result.alignmentStatus === "aligned") {
		reasons.push("último prepare no detectó diferencias relevantes");
	}
	return reasons.length ? reasons : ["último prepare no dejó motivo detallado"];
}

function buildPostflightReport(): ProjectPostflightReport {
	const connection = inspectProjectConnection({
		registry,
		defaultCwd: config.defaultCwd,
		allowedRoots: config.allowedRoots,
		workspaceRoot: config.agentWorkspaceRoot,
	});
	const projectPath = connection.projectPath ?? currentCwd;
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
	const reportWithWarnings = {
		...report,
		warnings: [...gitState.warnings, ...report.warnings],
	};
	return {
		...reportWithWarnings,
		physicalGates: buildPostflightPhysicalGates({
			projectPath,
			gitState,
			report: reportWithWarnings,
		}),
	};
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

function looksLikePath(text: string): boolean {
	return /^[a-zA-Z]:[\\/]/u.test(text.trim()) || text.trim().startsWith("/");
}

function isNaturalCancelRequest(text: string): boolean {
	const normalized = text
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "");
	return /^(para|parate|detente|detenete|stop|cancel|cancela|cancelar|frena|frenate)\b/u.test(
		normalized,
	);
}

function addProjectFromPath(pathInput: string) {
	const candidate = canonicalDirectory(resolve(pathInput));
	const id = candidate.split(/[/\\]/u).pop() || "project";
	const project = addProject(registry, id, candidate, config.allowedRoots);
	registry.activeProjectId = project.id;
	saveRegistry(registry);
	switchProjectContext(project.path);
	return project;
}

function formatLabAgentChoices(): string {
	return agentRouter.profiles
		.map((profile, index) => ({ profile, index: index + 1 }))
		.filter(({ profile }) => profile.id !== agentRouter.profiles[0].id)
		.map(
			({ profile, index }) =>
				`${index}. ${profile.label}\n   id: ${profile.id}`,
		)
		.join("\n\n");
}

function parseLabAgentIndex(input: string): number | undefined {
	const normalized = input.trim().replace(/\.$/u, "").toLowerCase();
	const index = Number(normalized);
	if (
		Number.isInteger(index) &&
		index >= 2 &&
		index <= agentRouter.profiles.length
	) {
		return index;
	}
	const foundIndex = agentRouter.profiles.findIndex(
		(profile) =>
			profile.id.toLowerCase() === normalized ||
			profile.label.toLowerCase() === normalized,
	);
	return foundIndex >= 1 ? foundIndex + 1 : undefined;
}

async function runLabForProfiles(
	ctx: Context,
	profileIndexes: number[],
	duration: LabDuration,
): Promise<void> {
	const profiles = labProfilesForIndexes(agentRouter.profiles, profileIndexes);
	if (!profiles.length) {
		await ctx.reply(
			"No hay agentes lab para ejecutar. El agente 1/default queda excluido.",
		);
		return;
	}
	await ctx.reply(
		`Iniciando test lab ${duration.label}:\n${profiles.map((profile) => `- ${profile.label}`).join("\n")}`,
	);
	const { results } = await runLabForProfilesService({
		router: agentRouter,
		profileIndexes,
		duration,
		projectId: currentProjectId(),
		projectPath: currentCwd,
		store: labReportStore,
		labRunRecorder: labDbRepository,
	});
	const lines = formatLabRunResultLines(profiles, results);
	await replyLong(ctx, `Test lab terminado:\n\n${lines.join("\n\n")}`);
	const triageLines = await triagePendingReports({
		router: agentRouter,
		store: labReportStore,
		limit: profiles.length,
	});
	if (triageLines.length) {
		await replyLong(
			ctx,
			`Triage listo. Usá /reports para ver resumen y /report <id> para detalle.\n\n${triageLines.join("\n")}`,
		);
	}
}

async function handleTestLabCommand(
	ctx: Context,
	profileIndexes: number[],
	arg: string,
): Promise<void> {
	const duration = parseLabDuration(arg);
	if (!duration) {
		pendingAction = "select-lab-duration";
		pendingLabRequest = { profileIndexes };
		await ctx.reply(
			`Elegí profundidad para test lab:\n\n${formatDurationChoices()}`,
		);
		return;
	}
	await runLabForProfiles(ctx, profileIndexes, duration);
}

async function drainTaskQueue(ctx: Context, generation: number): Promise<void> {
	while (taskQueue.size && generation === taskQueueGeneration) {
		if (agentRouter.activeRuntime().session.busy) {
			await ctx.reply(
				"Cola pausada: Pi sigue ocupado; no reencolé ni descarté tareas.",
			);
			return;
		}
		const queuedPrompt = taskQueue.peek();
		if (!queuedPrompt) return;
		if (!(await guardQueuedPrompt(ctx, queuedPrompt))) {
			taskQueue.dequeue();
			return;
		}
		taskQueue.dequeue();
		await ctx.reply(
			`Ejecutando tarea en cola. Restantes después de esta: ${taskQueue.size}.`,
		);
		await runPrompt(ctx, queuedPrompt, {
			fromQueue: true,
			preserveActivePromptInFlight: true,
		});
	}
	if (generation !== taskQueueGeneration) {
		await ctx.reply("Cola detenida por cancelación.");
	}
}

async function guardQueuedPrompt(
	ctx: Context,
	prompt: string,
): Promise<boolean> {
	return guardTaskPrompt(ctx, prompt, {
		blockTitle: "⛔ Tarea en cola pausada: requiere confirmación humana.",
		source: "queue-guard",
	});
}

async function guardTaskPrompt(
	ctx: Context,
	prompt: string,
	options: {
		structuredTaskCategory?: string;
		originalText?: string;
		source: string;
		blockTitle: string;
		enqueueLegacyOnBlock?: boolean;
	},
): Promise<boolean> {
	if (!shouldUseAutomaticGuardrails(currentProjectId())) return true;

	const existingTask = structuredTaskQueue.findByText(prompt);
	if (existingTask?.guardStatus === "approved") return true;
	if (existingTask?.guardStatus === "needs_confirmation") {
		await replyLong(
			ctx,
			[
				options.blockTitle,
				`ID: ${existingTask.id}`,
				"",
				`Aprobar: /queue_approve ${existingTask.id}`,
				`Rechazar: /queue_reject ${existingTask.id}`,
			].join("\n"),
		);
		return false;
	}
	if (existingTask?.guardStatus === "rejected") return false;

	let report: ProjectPreflightReport;
	try {
		report = buildPreflightReport(prompt);
	} catch (error) {
		const task =
			existingTask ??
			structuredTaskQueue.enqueueTask(
				structuredTaskInputForText(prompt, {
					source: options.source,
					projectId: currentProjectId(),
					category: options.structuredTaskCategory,
					originalText: options.originalText,
				}),
			);
		const reason =
			error instanceof Error ? error.message : "preflight interno falló";
		const guardedTask =
			structuredTaskQueue.markNeedsConfirmation(task.id, {
				guardRisk: "blocker",
				guardReason: `preflight falló: ${reason}`,
			}) ?? task;
		runSupervisorAfterStructuredTask(guardedTask);
		if (options.enqueueLegacyOnBlock && !existingTask)
			taskQueue.enqueue(prompt);
		await replyLong(
			ctx,
			[
				"No pude completar preflight; tarea pausada por seguridad",
				`ID: ${task.id}`,
				"Guard: needs_confirmation/blocker",
				`Motivo: ${reason}`,
				"",
				`Aprobar: /queue_approve ${task.id}`,
				`Rechazar: /queue_reject ${task.id}`,
			].join("\n"),
		);
		return false;
	}
	const taskInput = structuredTaskInputForText(prompt, {
		source: options.source,
		projectId: currentProjectId(),
		category: options.structuredTaskCategory,
		originalText: options.originalText,
	});
	const guardRisk = strongestGuardRisk(
		report.risk,
		existingTask?.intentRiskHint ?? taskInput.intentRiskHint,
	);
	const reason = [
		`preflight ${report.risk}`,
		(existingTask?.intentRiskHint ?? taskInput.intentRiskHint)
			? `intent ${existingTask?.intentRiskHint ?? taskInput.intentRiskHint}`
			: undefined,
		(existingTask?.intentConcepts ?? taskInput.intentConcepts)?.length
			? `intención: ${existingTask?.intentKind ?? taskInput.intentKind}/${(existingTask?.intentConcepts ?? taskInput.intentConcepts ?? []).join("+")}`
			: undefined,
		report.affectedAreas.length
			? `áreas: ${report.affectedAreas.join(", ")}`
			: undefined,
	]
		.filter(Boolean)
		.join("; ");
	if (guardRisk === "high" || guardRisk === "blocker") {
		const task = existingTask ?? structuredTaskQueue.enqueueTask(taskInput);
		const guardedTask =
			structuredTaskQueue.markNeedsConfirmation(task.id, {
				guardRisk,
				guardReason: reason,
			}) ?? task;
		runSupervisorAfterStructuredTask(guardedTask);
		if (options.enqueueLegacyOnBlock && !existingTask)
			taskQueue.enqueue(prompt);
		await replyLong(
			ctx,
			[
				options.blockTitle,
				`ID: ${task.id}`,
				"",
				formatProjectAdvisory(buildProjectAdvisory(report)),
				"",
				`Aprobar: /queue_approve ${task.id}`,
				`Rechazar: /queue_reject ${task.id}`,
			].join("\n"),
		);
		return false;
	}
	if (existingTask)
		structuredTaskQueue.markGuardClear(existingTask.id, guardRisk, reason);
	return true;
}

function runSupervisorAfterStructuredTask(task: {
	guardRisk?: ProjectPreflightReport["risk"];
}): void {
	maybeRunSupervisorAfterTask({
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
		workspaceRoot: config.agentWorkspaceRoot,
		supervisorActivityStateRoot: activeProjectStateRoot(),
		repository: labDbRepository,
		queue: structuredTaskQueue,
		task,
	});
}

function strongestGuardRisk(
	preflightRisk: ProjectPreflightReport["risk"],
	intentRisk: "low" | "medium" | "high" | "blocker" | undefined,
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

async function generateAiProjectDraft(prompt: string): Promise<string> {
	const result = await agentRouter.prompt(prompt);
	if (!result.ok) throw new Error(result.output);
	return result.output;
}

async function runPrompt(
	ctx: Context,
	prompt: string,
	options: {
		fromQueue?: boolean;
		structuredTaskCategory?: string;
		preserveActivePromptInFlight?: boolean;
	} = {},
): Promise<void> {
	const runtime = agentRouter.activeRuntime();
	const queueDecision = decidePromptQueueAction({
		activePromptInFlight,
		runtimeBusy: runtime.session.busy,
		fromQueue: Boolean(options.fromQueue),
		cancelRequest: isNaturalCancelRequest(prompt),
	});
	if (queueDecision === "cancel") {
		pendingAction = null;
		pendingLabRequest = null;
		clearPendingUiRequest();
		const queued = taskQueue.clear();
		taskQueueGeneration++;
		activePromptInFlight = false;
		const cancelled = agentRouter.cancelActive();
		await ctx.reply(
			cancelled
				? `Cancelé la tarea activa y limpié ${queued} tarea(s) en cola.`
				: `No había tarea activa. Limpié ${queued} tarea(s) en cola.`,
		);
		return;
	}
	if (queueDecision === "defer") {
		if (taskQueue.enqueue(prompt)) {
			await ctx.reply(
				"Cola pausada: Pi sigue ocupado; la tarea vuelve a quedar en cola.",
			);
		} else {
			await ctx.reply("Cola pausada: la tarea en cola estaba vacía.");
		}
		return;
	}
	if (queueDecision === "enqueue") {
		if (taskQueue.enqueue(prompt)) {
			const projectId = currentProjectId();
			const signal = analyzeStructuredTaskSignal(prompt);
			try {
				const task = structuredTaskQueue.enqueueTask(
					structuredTaskInputForText(prompt, {
						source: "telegram",
						projectId,
						category: options.structuredTaskCategory,
						analyzer: () => signal,
					}),
				);
				runSupervisorAfterStructuredTask(task);
			} catch {
				// La cola estructurada es secundaria; /queue legacy sigue siendo fuente visible.
			}
			try {
				labDbRepository.recordUserSignal({
					id: randomUUID(),
					projectId,
					source: "telegram-queue",
					rawText: prompt,
					detectedEmotion: signal.emotion,
					urgency: signal.urgency,
					confidence: signal.confidence,
					matchedKeywords: signal.matchedKeywords,
				});
			} catch {
				// SQLite es complementario; no debe romper Telegram ni la cola legacy.
			}
			await ctx.reply(
				`Ya hay una tarea Pi corriendo. Guardé tu mensaje en cola como Q${taskQueue.size}. Usá /queue para verla.`,
			);
		} else {
			await ctx.reply("La tarea está vacía; no la agregué a la cola.");
		}
		return;
	}

	activePromptInFlight = true;
	const generation = taskQueueGeneration;
	await ctx.reply(
		`Orquestador trabajando: ${runtime.profile.label}\nProyecto target:\n${currentCwd}\nWorkspace:\n${runtime.cwd}\nModo workspace: ${runtime.workspaceKind}`,
	);
	if (generation !== taskQueueGeneration) {
		activePromptInFlight = false;
		return;
	}

	let lastProgressAt = 0;
	const progress = (event: PiRpcProgressEvent): void => {
		if (event.type === "tool") {
			const now = Date.now();
			if (now - lastProgressAt > 1500) {
				lastProgressAt = now;
				void ctx.reply(`Subtrabajo: usando ${event.toolName}...`);
			}
			return;
		}
		if (event.type === "ui_request") {
			if (isBlockingUiRequest(event.request)) {
				pendingUiRequest = event.request;
				pendingUiRuntime = runtime;
				pendingUiToken = String(++pendingUiCounter);
				pendingAction = "extension-ui";
				void ctx.reply(formatUiRequestForTelegram(event.request), {
					reply_markup: inlineKeyboardForUiRequest(
						event.request,
						pendingUiToken,
					),
				});
				return;
			}
			if (event.request.method === "notify") {
				void ctx.reply(formatUiRequestForTelegram(event.request));
			}
			return;
		}
		if (event.type === "ended") {
			void ctx.reply(
				"Orquestador: cerrando respuesta y preparando resumen final...",
			);
		}
	};

	try {
		const result = await agentRouter.prompt(prompt, progress);
		clearPendingUiRequest();
		const prefix = result.ok ? "✅ Pi terminó" : "⚠️ Pi terminó con error";
		await replyLong(ctx, `${prefix}\n\n${result.output}`);
		if (!options.fromQueue && taskQueue.size) {
			await drainTaskQueue(ctx, taskQueueGeneration);
		}
	} catch (error) {
		clearPendingUiRequest();
		const message = error instanceof Error ? error.message : String(error);
		if (/Cancelado por el usuario/u.test(message)) {
			await ctx.reply("Tarea cancelada.");
		} else if (/Ya hay una tarea Pi corriendo/u.test(message)) {
			await ctx.reply(
				"Ya hay una tarea Pi corriendo. No inicié otra instancia; usá /cancel para detenerla o /queue para ver la cola.",
			);
		} else {
			await ctx.reply(`Error inesperado: ${message}`);
		}
	} finally {
		if (!options.preserveActivePromptInFlight) {
			activePromptInFlight = false;
		}
	}
}

function dashboardState() {
	const runtime = agentRouter.activeRuntime();
	return {
		bridgePid: process.pid,
		projectLabel: activeProjectLabel(),
		currentCwd,
		agentLabel: runtime.profile.label,
		agentId: runtime.profile.id,
		workspace: runtime.cwd,
		workspaceKind: runtime.workspaceKind,
		rpcRunning: runtime.session.running,
		busy: activePromptInFlight || runtime.session.busy,
		modePrefix: runtime.modePrefix,
		lastSessionCount: lastSessionPicks.length,
	};
}

function formatServerStatus(): string {
	const state = dashboardState();
	return `Estado agente activo: ${state.busy ? "ocupado" : "libre"}\nRPC agente activo: ${state.rpcRunning ? "iniciado" : "en espera"}\nPID bridge: ${state.bridgePid}\nProyecto: ${state.projectLabel}\nAgente: ${state.agentLabel} (${state.agentId})\nProyecto target: ${state.currentCwd}\nWorkspace: ${state.workspace}\nModo workspace: ${state.workspaceKind}\nModo agente activo: ${state.modePrefix || "default"}`;
}

async function notifyBridgeStartupFromIntent(): Promise<void> {
	const packageRoot = resolvePackageRootForTelegram();
	const intent = consumeBridgeControlIntent(
		bridgeControlIntentPath(packageRoot),
	);
	if (
		intent?.type !== "restart" ||
		!intent.notifyOnStartup ||
		intent.chatId === undefined
	) {
		return;
	}

	const runtime = agentRouter.activeRuntime();
	try {
		await bot.api.sendMessage(
			intent.chatId,
			formatBridgeStartupStatus({
				origin: intent.origin,
				pid: process.pid,
				projectLabel: activeProjectLabel(),
				currentCwd,
				agentLabel: runtime.profile.label,
				rpcRunning: runtime.session.running,
				iduActive: getIduSessionStatus(currentProjectId()).active,
				telegramCommandCount: PUBLIC_TELEGRAM_HANDLER_COMMANDS.length,
				now: new Date(),
			}),
		);
	} catch (error) {
		console.error("Failed to send bridge startup notification", error);
	}
}

function labDbPath(): string {
	return join(config.agentWorkspaceRoot, "reports", "lab.db");
}

function reportsPath(): string {
	return join(config.agentWorkspaceRoot, "reports");
}

function activeProjectPath(): string {
	return getActiveProject(registry)?.path ?? currentCwd;
}

function activeProjectStateRoot(): string {
	const project = getActiveProject(registry);
	if (project?.stateRoot) return project.stateRoot;
	return resolveProjectStatePaths({
		workspaceRoot: config.agentWorkspaceRoot,
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
	}).stateRoot;
}

type TelegramAutonomousAlertTickResult = {
	report: AutonomousAlertEngineReport;
	allowTaskCreation: false;
	taskCreationStatus: "disabled";
};

type TelegramAutonomousAlertControlResult = {
	action: string;
	state: AutonomousAlertEngineState;
};

function buildTelegramSelfMaintenanceReport(stateRoot: string): {
	tasks: StructuredTask[];
	report: SupervisorSelfMaintenanceAdvisory;
} {
	const tasks = structuredTaskQueue.listTasks();
	const supervisorActivity = summarizeSupervisorActivityEvents(
		readSupervisorActivityEvents(stateRoot),
	);
	const usageReport = buildIduUsageReport(readIduUsageEvents(stateRoot));
	const agentLabEffectiveness = buildAgentLabEffectivenessReport(
		readAgentLabEffectivenessEvents(stateRoot),
	);
	let semanticNewEvents = 0;
	try {
		const semanticDelta = buildSemanticAuditStatus({
			projectId: currentProjectId(),
			repository: labDbRepository,
		}).newEvents;
		semanticNewEvents =
			semanticDelta.labRuns +
			semanticDelta.findings +
			semanticDelta.proposals +
			semanticDelta.tasks +
			semanticDelta.userSignals +
			semanticDelta.memoryItems;
	} catch {
		semanticNewEvents = 0;
	}
	return {
		tasks,
		report: buildSupervisorSelfMaintenanceAdvisory({
			projectId: currentProjectId(),
			now: new Date(),
			tasks,
			supervisorEvents: supervisorActivity.totalEvents,
			supervisorActivitySkipped:
				(supervisorActivity.byReason.throttled ?? 0) +
				(supervisorActivity.byReason.idu_inactive ?? 0) +
				(supervisorActivity.byReason.no_new_events ?? 0) +
				(supervisorActivity.byReason.not_enough_data ?? 0),
			supervisorActivityThrottled:
				supervisorActivity.byReason.throttled ?? 0,
			usageFailures:
				usageReport.failed +
				usageReport.notAllowed +
				usageReport.requiresHuman,
			agentLabStaleRequests: agentLabEffectiveness.staleRequests,
			semanticNewEvents,
		}),
	};
}

function buildTelegramAutonomousAlertStatus(): AutonomousAlertEngineReport {
	const stateRoot = activeProjectStateRoot();
	const state = readAutonomousAlertEngineState(stateRoot);
	const selfMaintenance = buildTelegramSelfMaintenanceReport(stateRoot);
	return buildAutonomousAlertEngineReport({
		projectId: currentProjectId(),
		control: state.control,
		tasks: selfMaintenance.tasks,
		selfMaintenanceSignals: selfMaintenance.report.signals,
		allowTaskCreation: false,
		cooldowns: state.cooldowns,
	});
}

function runTelegramAutonomousAlertTick(options: {
	allowTaskCreation: false;
}): TelegramAutonomousAlertTickResult {
	return {
		report: buildTelegramAutonomousAlertStatus(),
		allowTaskCreation: options.allowTaskCreation,
		taskCreationStatus: "disabled",
	};
}

function runTelegramAutonomousAlertControl(
	action: "enable" | "disable" | "pause" | "resume",
	pauseMinutes?: number,
): TelegramAutonomousAlertControlResult {
	const stateRoot = activeProjectStateRoot();
	const current = readAutonomousAlertEngineState(stateRoot);
	const now = new Date();
	const state = updateAutonomousAlertControlState(
		stateRoot,
		{
			active:
				action === "enable"
					? true
					: action === "disable"
						? false
						: current.control.active,
			pausedUntil:
				action === "pause"
					? new Date(
							now.getTime() + (pauseMinutes ?? 60) * 60 * 1000,
						).toISOString()
					: action === "resume"
						? "1970-01-01T00:00:00.000Z"
						: current.control.pausedUntil,
			disabledDomains: current.control.disabledDomains,
			reason: action,
		},
		now,
	);
	return { action, state };
}

function formatTelegramAutonomousAlertReport(
	result: AutonomousAlertEngineReport | TelegramAutonomousAlertTickResult,
): string {
	const report = "report" in result ? result.report : result;
	const allowTaskCreation =
		"allowTaskCreation" in result ? result.allowTaskCreation : false;
	const topTruth = report.uncomfortableTruths[0]?.claim;
	return [
		"Alertas Idu-pi",
		`Estado: ${report.active ? (report.paused ? "paused" : "active") : "off"}`,
		`Decisiones: ${report.decisions.length}`,
		`Escalaciones humanas: ${report.humanEscalations.length}`,
		`Tareas creadas: ${report.tasksCreated.length}`,
		`allowTaskCreation: ${allowTaskCreation}`,
		"",
		"Honestidad cruda:",
		topTruth ?? "Sin verdades incómodas nuevas con la evidencia actual.",
		"",
		"Seguro: no implementé código, no ejecuté AgentLabs, no actualicé dependencias y no modifiqué reglas, skills ni contratos.",
	].join("\n");
}

function formatTelegramAutonomousAlertControl(
	result: TelegramAutonomousAlertControlResult,
): string {
	return [
		"Control de alertas actualizado",
		`Acción: ${result.action}`,
		`Activo: ${result.state.control.active}`,
		`Pausado hasta: ${result.state.control.pausedUntil ?? "no"}`,
		`Dominios desactivados: ${result.state.control.disabledDomains.join(", ") || "ninguno"}`,
		"",
		"Seguro: sólo escribí estado de control bajo stateRoot/reports.",
	].join("\n");
}

function parsePauseMinutes(text: string | undefined): number {
	const parsed = Number.parseInt((text ?? "").trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
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

function sourceSkillsDir(): string | undefined {
	const sourceProject = registry.projects.find(
		(project) => project.id === "sistema_de_mantencion",
	);
	return sourceProject
		? join(sourceProject.path, ".agents", "skills")
		: undefined;
}

function currentConfigReport() {
	return inspectProjectConfig({
		projectId: currentProjectId(),
		projectPath: currentCwd,
		allowedRoots: config.allowedRoots,
		agentProfiles: agentRouter.profiles,
		activeProfileId: agentRouter.activeProfile().id,
		workspaceMode: config.agentWorkspaceMode,
		workspaceRoot: config.agentWorkspaceRoot,
		piArgs: config.piArgs,
	});
}

bot.command("help", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(ctx, formatHelpText());
});

bot.command("comandos", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(ctx, formatCommandCatalog());
});

bot.command("status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply(formatServerStatus());
});

bot.command("dashboard", async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply(buildDashboardText(dashboardState()));
});

bot.command("idu_menu", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyIduRemoteMenu(ctx);
});

bot.command("idu_projects", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyIduRemoteProjects(ctx);
});

bot.command("idu", async (ctx) => {
	if (!(await guard(ctx))) return;
	const projectId = currentProjectId();
	const projectPath = activeProjectPath();
	const stateRoot = activeProjectStateRoot();
	activateIduSession(projectId);
	maybeRunSupervisorOnIduActivation({
		projectId,
		projectPath,
		workspaceRoot: config.agentWorkspaceRoot,
		supervisorActivityStateRoot: stateRoot,
		repository: labDbRepository,
		queue: structuredTaskQueue,
	});
	let masterPlan = ensureMasterPlanForIdu({
		projectId,
		projectPath,
		stateRoot,
		gitHead: readGitHead(projectPath),
	});
	let reviewHandled = false;
	if (masterPlan.plan?.autoDepth.mode === "deep_required") {
		await runOrReuseTelegramMasterPlanDeepReview();
		reviewHandled = true;
		masterPlan = ensureMasterPlanForIdu({
			projectId,
			projectPath,
			stateRoot,
			gitHead: readGitHead(projectPath),
		});
	}
	await replyLong(
		ctx,
		formatIduSupervisorPlanReport({
			bootstrap: {
				project: { id: projectId },
				criticalDecisions: [],
			},
			masterPlan,
			reviewHandled,
		}),
	);
});

bot.command("idu_off", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatIduSessionStatus(deactivateIduSession(currentProjectId())),
	);
});

bot.command("idu_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatIduSessionStatus(getIduSessionStatus(currentProjectId())),
	);
});

bot.command("idu_master_plan_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatMasterPlanStatus(
			getMasterPlanStatus({
				stateRoot: activeProjectStateRoot(),
				currentGitHead: readGitHead(activeProjectPath()),
			}),
		),
	);
});

bot.command("idu_master_plan_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatMasterPlanReview(
			reviewMasterPlan({
				stateRoot: activeProjectStateRoot(),
				pathOrLatest: commandArg(ctx.message?.text ?? "") || "latest",
			}),
		),
	);
});

bot.command("idu_master_plan_approve", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatMasterPlanOperation(
			approveMasterPlan({
				stateRoot: activeProjectStateRoot(),
				pathOrLatest: commandArg(ctx.message?.text ?? "") || "latest",
				source: "telegram",
			}),
		),
	);
});

bot.command("idu_master_plan_reject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const args = commandArg(ctx.message?.text ?? "");
	const [pathOrLatest = "latest", ...reasonParts] = args
		.split(/\s+/u)
		.filter(Boolean);
	await replyLong(
		ctx,
		formatMasterPlanOperation(
			rejectMasterPlan({
				stateRoot: activeProjectStateRoot(),
				pathOrLatest,
				reason: reasonParts.join(" ").trim() || undefined,
			}),
		),
	);
});

bot.command("idu_master_plan_redraft", async (ctx) => {
	if (!(await guard(ctx))) return;
	const args = commandArg(ctx.message?.text ?? "");
	const reason = args === "latest" ? "" : args;
	await replyLong(
		ctx,
		formatMasterPlanOperation(
			redraftMasterPlan({
				projectId: currentProjectId(),
				projectPath: activeProjectPath(),
				stateRoot: activeProjectStateRoot(),
				gitHead: readGitHead(activeProjectPath()),
				reason: reason || undefined,
			}),
		),
	);
});

bot.command("idu_supervisor_tick", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatIduSupervisorLoopResult(
			runIduSupervisorLoop({
				projectId: currentProjectId(),
				projectPath: activeProjectPath(),
				workspaceRoot: config.agentWorkspaceRoot,
				trigger: "manual",
				options: {
					allowSemanticDraft: false,
					allowAgentTaskPlan: false,
					dryRun: false,
				},
				repository: labDbRepository,
				queue: structuredTaskQueue,
			}),
		),
	);
});

bot.command("idu_alerts_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertReport(
			buildTelegramAutonomousAlertStatus(),
		),
	);
});

bot.command("idu_alerts_tick", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertReport(
			runTelegramAutonomousAlertTick({ allowTaskCreation: false }),
		),
	);
});

bot.command("idu_alerts_pause", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertControl(
			runTelegramAutonomousAlertControl(
				"pause",
				parsePauseMinutes(ctx.match),
			),
		),
	);
});

bot.command("idu_alerts_resume", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertControl(
			runTelegramAutonomousAlertControl("resume"),
		),
	);
});

bot.command("idu_alerts_off", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertControl(
			runTelegramAutonomousAlertControl("disable"),
		),
	);
});

bot.command("idu_alerts_on", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatTelegramAutonomousAlertControl(
			runTelegramAutonomousAlertControl("enable"),
		),
	);
});

bot.command("agentlab_request_create", async (ctx) => {
	if (!(await guard(ctx))) return;
	const args = ctx.match?.trim().split(/\s+/u).filter(Boolean) ?? [];
	const source = args[0] ?? "postflight";
	if (
		source !== "postflight" &&
		source !== "skill-draft" &&
		source !== "master-plan"
	) {
		await replyLong(ctx, `Fuente no soportada: ${source}`);
		return;
	}
	await replyLong(
		ctx,
		formatAgentLabReviewRequestPlan(
			createAgentLabReviewRequests({
				source:
					source === "postflight"
						? "postflight"
						: source === "skill-draft"
							? "skill_draft"
							: "master_plan",
				reportsPath: reportsPath(),
				projectId: currentProjectId(),
				projectPath: activeProjectPath(),
				postflightReport:
					source === "postflight" ? buildPostflightReport() : undefined,
				skillDraftPathOrLatest:
					source === "skill-draft"
						? args.slice(1).join(" ").trim() || "latest"
						: undefined,
				masterPlanPathOrLatest:
					source === "master-plan"
						? args.slice(1).join(" ").trim() || "latest"
						: undefined,
			}),
		),
	);
});

bot.command("agentlab_request_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatAgentLabReviewRequestReview(
			reviewAgentLabReviewRequest(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("agentlab_review_run", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatAgentLabReviewRunResult(
			await runAgentLabReviewRequestFile({
				pathOrLatest,
				reportsPath: reportsPath(),
				projectId: currentProjectId(),
				projectPath: activeProjectPath(),
				router: agentRouter,
			}),
		),
	);
});

bot.command("agentlab_review_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatAgentLabReviewStatus(
			getAgentLabReviewStatus(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("agentlab_report_consolidate", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatAgentLabConsolidationResult(
			consolidateAgentLabReviewRun(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("agentlab_report_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatAgentLabConsolidationStatus(
			getAgentLabConsolidationStatus(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("semantic_audit_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatSemanticAuditStatus(
			buildSemanticAuditStatus({
				projectId: currentProjectId(),
				repository: labDbRepository,
			}),
		),
	);
});

bot.command("semantic_audit_run", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatSemanticAuditRunResult(
			runManualSemanticAudit({
				projectId: currentProjectId(),
				repository: labDbRepository,
			}),
		),
	);
});

bot.command("semantic_compact_draft", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatSemanticCompactionDraft(
			saveSemanticCompactionDraft({
				projectId: currentProjectId(),
				dbPath: labDbPath(),
				reportsPath: reportsPath(),
				workspaceRoot: config.agentWorkspaceRoot,
				...semanticCompactionProjectContext(activeProjectPath()),
			}),
		),
	);
});

bot.command("semantic_compact_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSemanticCompactionReview(
			reviewSemanticCompactionDraft(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("semantic_agent_tasks_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSemanticAgentTaskPlan(
			buildSemanticAgentTaskPlan(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("semantic_agent_tasks_create", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSemanticAgentTaskCreationResult(
			createSemanticAgentTasks({
				pathOrLatest,
				reportsPath: reportsPath(),
				queue: structuredTaskQueue,
				projectId: currentProjectId(),
			}),
		),
	);
});

bot.command("supervisor_improvements_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSupervisorImprovementPlan(
			buildSupervisorImprovementPlan(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("supervisor_improvements_create", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSupervisorImprovementCreationResult(
			createSupervisorImprovementProposals(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("supervisor_improvements_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSupervisorImprovementStatus(
			getSupervisorImprovementStatus(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("supervisor_improvements_approve", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSupervisorImprovementDecisionResult(
			approveSupervisorImprovement(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("supervisor_improvements_reject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSupervisorImprovementDecisionResult(
			rejectSupervisorImprovement(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("supervisor_improvements_defer", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSupervisorImprovementDecisionResult(
			deferSupervisorImprovement(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("supervisor_improvements_apply", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSupervisorLearningRulesApplyResult(
			applySupervisorLearningRules(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("skill_improvements_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSkillImprovementPlan(
			buildSkillImprovementPlan(pathOrLatest, reportsPath(), {
				workspaceRoot: activeProjectPath(),
				dbPath: labDbPath(),
			}),
		),
	);
});

bot.command("skill_improvements_create", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSkillImprovementCreationResult(
			createSkillImprovementProposals(pathOrLatest, reportsPath(), {
				workspaceRoot: activeProjectPath(),
				dbPath: labDbPath(),
			}),
		),
	);
});

bot.command("skill_improvements_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSkillImprovementStatus(
			getSkillImprovementStatus(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("skill_improvements_approve", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSkillImprovementDecisionResult(
			approveSkillImprovementProposal(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("skill_improvements_reject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSkillImprovementDecisionResult(
			rejectSkillImprovementProposal(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("skill_improvements_defer", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorImprovementDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSkillImprovementDecisionResult(
			deferSkillImprovementProposal(
				parsed.pathOrLatest,
				parsed.proposalIdOrAll,
				reportsPath(),
				{ source: "telegram", reason: parsed.reason },
			),
		),
	);
});

bot.command("skill_drafts_create", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSkillDraftCreationResult(
			createSkillDraftsFromApprovedProposals(pathOrLatest, reportsPath()),
		),
	);
});

bot.command("skill_drafts_review", async (ctx) => {
	if (!(await guard(ctx))) return;
	const pathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSkillDraftReview(reviewSkillDraft(pathOrLatest, reportsPath())),
	);
});

bot.command("supervisor_learning_rules_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatSupervisorLearningRulesStatus(
			getSupervisorLearningRulesStatus(reportsPath()),
		),
	);
});

bot.command("supervisor_learning_rules_test", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatSupervisorLearningRulesTest(
			testSupervisorLearningRules(reportsPath()),
		),
	);
});

bot.command("supervisor_rules_disable", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorLearningRuleDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSupervisorLearningRuleDecision(
			disableSupervisorLearningRule(parsed.ruleId, reportsPath(), {
				source: "telegram",
				reason: parsed.reason,
			}),
		),
	);
});

bot.command("supervisor_learning_rules_enable", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseSupervisorLearningRuleDecisionArgs(ctx.match);
	await replyLong(
		ctx,
		formatSupervisorLearningRuleDecision(
			enableSupervisorLearningRule(parsed.ruleId, reportsPath(), {
				source: "telegram",
				reason: parsed.reason,
			}),
		),
	);
});

bot.command("supervisor_rules_rollback", async (ctx) => {
	if (!(await guard(ctx))) return;
	const backupPathOrLatest = ctx.match?.trim() || "latest";
	await replyLong(
		ctx,
		formatSupervisorLearningRulesRollback(
			rollbackSupervisorLearningRules(backupPathOrLatest, reportsPath()),
		),
	);
});

bot.command("idu_prepare", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	const projectId = activeProject?.id ?? currentProjectId();
	const projectPath = activeProject?.path ?? currentCwd;
	const reportsPath = join(config.agentWorkspaceRoot, "reports");
	const result = runIduPrepare({
		projectId,
		projectPath,
		reportsPath,
		inspectConnection: () =>
			inspectProjectConnection({
				registry,
				defaultCwd: config.defaultCwd,
				allowedRoots: config.allowedRoots,
				workspaceRoot: config.agentWorkspaceRoot,
			}),
		initProjectConfig: () => initProjectConfig(projectPath, projectId),
		inspectProjectMap: () =>
			inspectProjectMap(projectPath, {
				activeProjectId: projectId,
				activeProjectName: activeProject?.name,
			}),
		loadProjectFlows: () => loadProjectFlows(projectPath),
		scanProjectMap: (flows) => scanProjectMap(projectPath, flows),
		suggestProjectFlows: (flows) =>
			suggestProjectFlowsFromScan(projectPath, flows),
		draftProjectFlows: (flows) =>
			saveProjectFlowsDraft(projectPath, flows, reportsPath),
		reviewProjectFlowsDraft: (draftPathOrLatest, flows) =>
			reviewProjectFlowsDraft(draftPathOrLatest, flows, reportsPath),
		postflight: () => buildPostflightReport(),
		createStructuredTask: (input) => structuredTaskQueue.enqueueTask(input),
	});
	lastIduPrepareByProject.set(projectId, result);
	await replyLong(ctx, formatIduPrepareResult(result));
});

bot.command("idu_define_project", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	const result = startProjectCoreWizard({
		projectId: activeProject?.id ?? currentProjectId(),
		projectPath: activeProject?.path ?? currentCwd,
		workspaceRoot: config.agentWorkspaceRoot,
		projectName: activeProject?.name ?? activeProject?.id,
	});
	pendingAction = "project-core-wizard";
	await replyLong(ctx, result.message);
});

bot.command("idu_core_status", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	const status = getProjectCoreWizardStatus({
		projectId: activeProject?.id ?? currentProjectId(),
		projectPath: activeProject?.path ?? currentCwd,
		workspaceRoot: config.agentWorkspaceRoot,
		projectName: activeProject?.name ?? activeProject?.id,
	});
	await replyLong(ctx, status.text);
});

bot.command("idu_research_core", async (ctx) => {
	if (!(await guard(ctx))) return;
	if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
		await ctx.reply(
			"No puedo generar research Project Core: el proyecto activo está fuera de ALLOWED_ROOTS.",
		);
		return;
	}
	await replyLong(
		ctx,
		formatProjectCoreResearchDraft(
			await saveProjectCoreResearchDraft({
				projectPath: currentCwd,
				reportsDir: join(config.agentWorkspaceRoot, "reports"),
				generate: generateAiProjectDraft,
			}),
		),
	);
});

bot.command("idu_review_core_research", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatProjectCoreResearchReview(
			reviewProjectCoreResearchDraft(
				commandArg(ctx.message?.text ?? "") || "latest",
				join(config.agentWorkspaceRoot, "reports"),
			),
		),
	);
});

bot.command("idu_confirm_core", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	await replyLong(
		ctx,
		formatProjectCoreConfirmationResult(
			confirmProjectCore({
				projectPath: activeProject?.path ?? currentCwd,
				reportsDir: join(config.agentWorkspaceRoot, "reports"),
				research: commandArg(ctx.message?.text ?? "") || undefined,
			}),
		),
	);
});

bot.command("idu_reject_core", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	await replyLong(
		ctx,
		formatProjectCoreConfirmationResult(
			rejectProjectCore({
				projectPath: activeProject?.path ?? currentCwd,
				reportsDir: join(config.agentWorkspaceRoot, "reports"),
				reason: commandArg(ctx.message?.text ?? "") || undefined,
			}),
		),
	);
});

bot.command("idu_core_diff", async (ctx) => {
	if (!(await guard(ctx))) return;
	const activeProject = getActiveProject(registry);
	await replyLong(
		ctx,
		formatProjectCoreDiff(
			diffProjectCore({
				projectPath: activeProject?.path ?? currentCwd,
				reportsDir: join(config.agentWorkspaceRoot, "reports"),
			}),
		),
	);
});

bot.command("preflight", async (ctx) => {
	if (!(await guard(ctx))) return;
	const request = commandArg(ctx.message?.text ?? "");
	const report = buildPreflightReport(request);
	await replyLong(ctx, formatProjectPreflightReport(report));
});

bot.command("advisory", async (ctx) => {
	if (!(await guard(ctx))) return;
	const request = commandArg(ctx.message?.text ?? "");
	const report = buildPreflightReport(request);
	await replyLong(ctx, formatProjectAdvisory(buildProjectAdvisory(report)));
});

bot.command("postflight", async (ctx) => {
	if (!(await guard(ctx))) return;
	const report = buildPostflightReport();
	maybeRunSupervisorAfterPostflight({
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
		workspaceRoot: config.agentWorkspaceRoot,
		supervisorActivityStateRoot: activeProjectStateRoot(),
		repository: labDbRepository,
		queue: structuredTaskQueue,
		risk: report.risk,
	});
	await replyLong(ctx, formatProjectPostflightReport(report));
});

bot.command("lab_review_plan", async (ctx) => {
	if (!(await guard(ctx))) return;
	const args = commandArg(ctx.message?.text ?? "");
	const preflightMatch = /^preflight\s+(.+)/u.exec(args);
	const input = preflightMatch
		? {
				preflightReport: buildPreflightReport(preflightMatch[1]),
				requestText: preflightMatch[1],
				projectId: currentProjectId(),
			}
		: {
				postflightReport: buildPostflightReport(),
				projectId: currentProjectId(),
			};
	const plan = buildLabReviewPlan(input);
	const task = plan.structuredTaskInput
		? structuredTaskQueue.enqueueTask(plan.structuredTaskInput)
		: undefined;
	await replyLong(
		ctx,
		[
			formatLabReviewPlan(plan),
			"",
			"Tarea creada:",
			task ? `${task.id} | ${task.category} | P${task.priority}` : "- ninguna",
		].join("\n"),
	);
});

bot.command(QUICK_PROMPT_COMMANDS, async (ctx) => {
	if (!(await guard(ctx))) return;
	const command = ctx.message?.text.split(/\s+/u)[0]?.replace(/^\//u, "") ?? "";
	const prompt = buildQuickCommandPrompt(command);
	if (!prompt) {
		await ctx.reply("Comando rápido no reconocido.");
		return;
	}
	void runPrompt(ctx, prompt);
});

bot.command("safe_push", async (ctx) => {
	if (!(await guard(ctx))) return;
	const report = buildSafePushReport({ cwd: currentCwd });
	await replyLong(ctx, report.text);
});

bot.command("task", async (ctx) => {
	if (!(await guard(ctx))) return;
	const parsed = parseTaskTemplateCommand(ctx.message?.text ?? "");
	if (!parsed) {
		await ctx.reply(formatTaskTemplateHelp());
		return;
	}
	const prompt = buildTaskPrompt(parsed.kind, parsed.details);
	if (!prompt) {
		await ctx.reply(formatTaskTemplateHelp());
		return;
	}
	if (
		!(await guardTaskPrompt(ctx, prompt, {
			structuredTaskCategory: parsed.kind,
			originalText: parsed.details,
			source: "task-direct-guard",
			blockTitle: "⛔ Tarea pausada: requiere confirmación humana.",
			enqueueLegacyOnBlock: true,
		}))
	) {
		return;
	}
	void runPrompt(ctx, prompt, { structuredTaskCategory: parsed.kind });
});

function cleanupBridgeControlIntent(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// best effort cleanup only
	}
}

function formatBridgeControlLaunchFailure(action: "restart" | "stop", error: Error): string {
	const label = action === "restart" ? "reinicio" : "apagado";
	return [
		`No pude iniciar el helper de ${label} del bridge.`,
		"El bridge y la sesión Pi activa quedan corriendo.",
		`Error: ${error.message}`,
	].join("\n");
}

async function requestBridgeRestart(
	ctx: Context,
	reason: string,
): Promise<void> {
	const packageRoot = resolvePackageRootForTelegram();
	const chatId = ctx.chat?.id;
	if (chatId === undefined) {
		await ctx.reply("No pude identificar el chat para avisar el arranque.");
		return;
	}
	const intentPath = bridgeControlIntentPath(packageRoot);
	writeBridgeControlIntent(intentPath, {
		type: "restart",
		origin: "telegram",
		chatId,
		reason,
		notifyOnStartup: true,
		requestedAt: new Date().toISOString(),
	});
	const launch = await launchBridgeControlSafely("restart", packageRoot);
	if (!launch.ok) {
		cleanupBridgeControlIntent(intentPath);
		await ctx.reply(formatBridgeControlLaunchFailure("restart", launch.error));
		return;
	}
	await ctx.reply(
		"Reinicio completo del bridge solicitado. Si todo sale bien, voy a volver con un status de arranque.",
	);
	clearPendingUiRequest();
	agentRouter.stopActive("Bridge reiniciándose.");
}

bot.command("reset", async (ctx) => {
	if (!(await guard(ctx))) return;
	await requestBridgeRestart(ctx, "/reset");
});

bot.command("server", async (ctx) => {
	if (!(await guard(ctx))) return;
	const command = parseServerCommand(ctx.message?.text ?? "");
	if (!command) {
		await ctx.reply("Uso: /server status | run | restart | reset | off");
		return;
	}
	if (command === "status") {
		await ctx.reply(formatServerStatus());
		return;
	}
	if (command === "run") {
		const runtime = agentRouter.startActive();
		await ctx.reply(
			`Bridge ya está activo; /server run sólo prepara la sesión Pi interna.\nAgente: ${runtime.profile.label}\nWorkspace: ${runtime.cwd}\nSi el bridge estuviera apagado, Telegram no podría recibir este comando.`,
		);
		return;
	}
	if (command === "restart") {
		await requestBridgeRestart(ctx, "/server restart");
		return;
	}
	const packageRoot = resolvePackageRootForTelegram();
	const launch = await launchBridgeControlSafely("stop", packageRoot);
	if (!launch.ok) {
		await ctx.reply(formatBridgeControlLaunchFailure("stop", launch.error));
		return;
	}
	await ctx.reply(
		"Apagando bridge completo. Telegram no puede volver a iniciarlo salvo que uses start-pi-telegram-bridge.bat, scheduled task o watchdog.",
	);
	clearPendingUiRequest();
	agentRouter.stopActive("Bridge detenido.");
});

bot.command("agents", async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "");
	if (arg) {
		const selected = agentRouter.select(arg);
		if (!selected) {
			await ctx.reply(
				"No encontré ese agente/modelo. Usá /agents para ver opciones.",
			);
			return;
		}
		pendingAction = null;
		const runtime = agentRouter.activeRuntime();
		await ctx.reply(
			`Agente activo:\n${selected.label}\nid: ${selected.id}\nWorkspace: ${runtime.cwd}\nModo workspace: ${runtime.workspaceKind}`,
		);
		return;
	}
	pendingAction = "select-agent";
	await replyLong(
		ctx,
		`Agentes/modelos del proyecto activo:\n\n${formatAgentProfiles(agentRouter)}\n\nDetección local:\n${formatAgents(await detectAgents(config))}\n\nRespondé con número o id para elegir agente.`,
	);
});

bot.command("config", async (ctx) => {
	if (!(await guard(ctx))) return;
	const rawArg = commandArg(ctx.message?.text ?? "");
	const [subcommand = "", ...restArgs] = rawArg.split(/\s+/u).filter(Boolean);
	const arg = subcommand.toLowerCase();
	if (!arg) {
		await replyLong(ctx, formatConfigOverview(currentConfigReport()));
		return;
	}
	if (arg === "doctor") {
		await replyLong(ctx, formatConfigDoctor(currentConfigReport()));
		return;
	}
	if (arg === "init_workspace") {
		await replyLong(
			ctx,
			formatInitWorkspaceResult(initWorkspaceRoot(config.agentWorkspaceRoot)),
		);
		return;
	}
	if (arg === "init_assets") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo inicializar assets: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(ctx, formatInitAssetsResult(initProjectAssets(currentCwd)));
		return;
	}
	if (arg === "init_project_config") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo inicializar config: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatInitProjectConfigResult(
				initProjectConfig(currentCwd, currentProjectId()),
			),
		);
		return;
	}
	if (arg === "inspect_project_map") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo inspeccionar mapa: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		const activeProject = getActiveProject(registry);
		await replyLong(
			ctx,
			formatProjectMapInspection(
				inspectProjectMap(currentCwd, {
					activeProjectId: activeProject?.id ?? currentProjectId(),
					activeProjectName: activeProject?.name,
				}),
			),
		);
		return;
	}
	if (arg === "scan_project_map") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo escanear mapa: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatProjectMapScan(
				scanProjectMap(currentCwd, loadProjectFlows(currentCwd)),
			),
		);
		return;
	}
	if (arg === "suggest_project_flows") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo sugerir project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatProjectFlowSuggestions(
				suggestProjectFlowsFromScan(currentCwd, loadProjectFlows(currentCwd)),
			),
		);
		return;
	}
	if (arg === "draft_project_flows") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo guardar borrador project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatProjectFlowDraftResult(
				saveProjectFlowsDraft(
					currentCwd,
					loadProjectFlows(currentCwd),
					join(config.agentWorkspaceRoot, "reports"),
				),
			),
		);
		return;
	}
	if (arg === "review_project_flows_draft") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo revisar borrador project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatProjectFlowDraftReview(
				reviewProjectFlowsDraft(
					restArgs.join(" ") || "latest",
					loadProjectFlows(currentCwd),
					join(config.agentWorkspaceRoot, "reports"),
				),
			),
		);
		return;
	}
	if (arg === "apply_project_flows_draft") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo aplicar borrador project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatProjectFlowsDraftApplyResult(
				applyProjectFlowsDraft(currentCwd, restArgs.join(" ")),
			),
		);
		return;
	}
	if (arg === "ai_draft_project_blueprint") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo generar borrador IA de blueprint: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatAiProjectDraftResult(
				await createAiProjectBlueprintDraft({
					projectPath: currentCwd,
					reportsDir: join(config.agentWorkspaceRoot, "reports"),
					generate: generateAiProjectDraft,
				}),
			),
		);
		return;
	}
	if (arg === "ai_draft_project_flows") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo generar borrador IA de project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatAiProjectDraftResult(
				await createAiProjectFlowsDraft({
					projectPath: currentCwd,
					reportsDir: join(config.agentWorkspaceRoot, "reports"),
					generate: generateAiProjectDraft,
				}),
			),
		);
		return;
	}
	if (arg === "review_ai_blueprint_draft") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo revisar borrador IA de blueprint: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatAiProjectDraftReview(
				reviewAiProjectBlueprintDraft(
					restArgs.join(" ") || "latest",
					currentCwd,
					join(config.agentWorkspaceRoot, "reports"),
				),
			),
		);
		return;
	}
	if (arg === "review_ai_flows_draft") {
		if (!isAllowedCwd(currentCwd, config.allowedRoots)) {
			await ctx.reply(
				"No puedo revisar borrador IA de project-flows: el proyecto activo está fuera de ALLOWED_ROOTS.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatAiProjectDraftReview(
				reviewAiProjectFlowsDraft(
					restArgs.join(" ") || "latest",
					currentCwd,
					join(config.agentWorkspaceRoot, "reports"),
				),
			),
		);
		return;
	}
	if (arg === "db_init") {
		await replyLong(ctx, formatInitLabDbResult(initLabDb(labDbPath())));
		return;
	}
	if (arg === "sync_commands") {
		const commands = telegramCommandsForApi();
		await bot.api.setMyCommands(commands);
		await ctx.reply(
			`Comandos de Telegram actualizados: ${commands.length}. Abrí el menú de comandos del chat para verlos.`,
		);
		return;
	}
	if (arg === "skills_sync") {
		const source = sourceSkillsDir();
		if (!source) {
			await ctx.reply(
				"No encontré el proyecto fuente sistema_de_mantencion para sincronizar skills.",
			);
			return;
		}
		await replyLong(
			ctx,
			formatSkillsSyncResult(syncNecessarySkills(source, currentCwd)),
		);
		return;
	}
	await ctx.reply(
		"Uso: /config | /config doctor | /config init_workspace | /config init_assets | /config init_project_config | /config inspect_project_map | /config scan_project_map | /config suggest_project_flows | /config draft_project_flows | /config review_project_flows_draft [latest|ruta] | /config apply_project_flows_draft <ruta> | /config ai_draft_project_blueprint | /config ai_draft_project_flows | /config review_ai_blueprint_draft [latest|ruta] | /config review_ai_flows_draft [latest|ruta] | /config skills_sync | /config db_init | /config sync_commands",
	);
});

bot.command("doctor", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(ctx, await formatDoctor(config, currentCwd));
});

bot.command("testlab", async (ctx) => {
	if (!(await guard(ctx))) return;
	await handleTestLabCommand(
		ctx,
		agentRouter.profiles.map((_, index) => index + 1).slice(1),
		commandArg(ctx.message?.text ?? ""),
	);
});

bot.command("testlab1", async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply(
		"El agente 1/default no usa laboratorio porque trabaja directo en el repo real. Usá /testlab2, /testlab3 o /testlab.",
	);
});

bot.command("testlab2", async (ctx) => {
	if (!(await guard(ctx))) return;
	await handleTestLabCommand(ctx, [2], commandArg(ctx.message?.text ?? ""));
});

bot.command("testlab3", async (ctx) => {
	if (!(await guard(ctx))) return;
	await handleTestLabCommand(ctx, [3], commandArg(ctx.message?.text ?? ""));
});

bot.command("gentest_model_lab", async (ctx) => {
	if (!(await guard(ctx))) return;
	pendingAction = "select-lab-agent";
	pendingLabRequest = null;
	await replyLong(
		ctx,
		`Elegí agente de laboratorio:\n\n${formatLabAgentChoices()}\n\nRespondé con número o id.`,
	);
});

bot.command("triagereports", async (ctx) => {
	if (!(await guard(ctx))) return;
	const lines = await triagePendingReports({
		router: agentRouter,
		store: labReportStore,
		limit: 10,
	});
	await replyLong(
		ctx,
		lines.length
			? `Triage listo:\n\n${lines.join("\n")}`
			: "No hay reportes pendientes de triage.",
	);
});

bot.command("syncreports", async (ctx) => {
	if (!(await guard(ctx))) return;
	const lines = await syncPendingReportsToEngram({
		router: agentRouter,
		store: labReportStore,
		limit: 10,
	});
	await replyLong(
		ctx,
		lines.length
			? `Sync Engram:\n\n${lines.join("\n")}`
			: "No hay reportes aprobados para Engram. Primero usá /report <id> work|defer|save o /report <id> ignore.",
	);
});

bot.command("reports", async (ctx) => {
	if (!(await guard(ctx))) return;
	const reports = labReportStore.list(10);
	if (!reports.length) {
		await ctx.reply("No hay reportes lab todavía.");
		return;
	}
	await replyLong(
		ctx,
		`Reportes lab recientes:\n\n${reports
			.map((report) => {
				const visibleSummary = summarizeOutput(
					report.triageSummary || report.triageRaw || report.summary,
					140,
				);
				return `${report.id} · ${report.agentLabel} · ${report.status} · ${report.durationLabel}\nTriage: ${report.triageStatus ?? "pending"} · Decisión: ${report.decisionStatus ?? "none"} · Engram: ${report.engramStatus ?? "pending"}\n${visibleSummary}`;
			})
			.join("\n\n")}`,
	);
});

bot.command("report", async (ctx) => {
	if (!(await guard(ctx))) return;
	const [id = "", decision = ""] = commandArg(ctx.message?.text ?? "").split(
		/\s+/u,
	);
	if (!id) {
		await ctx.reply("Uso: /report <id> [work|defer|ignore|save]");
		return;
	}
	const report = labReportStore.get(id);
	if (!report) {
		await ctx.reply("No encontré ese reporte.");
		return;
	}
	if (decision) {
		const decisionMap: Record<
			string,
			"work_now" | "defer" | "ignore" | "save"
		> = {
			work: "work_now",
			defer: "defer",
			ignore: "ignore",
			save: "save",
		};
		const decisionStatus = decisionMap[decision.toLowerCase()];
		if (!decisionStatus) {
			await ctx.reply("Decisión inválida. Usá work, defer, ignore o save.");
			return;
		}
		const updated = labReportStore.update(id, {
			decisionStatus,
			decidedAt: new Date().toISOString(),
			engramStatus: decisionStatus === "ignore" ? "skipped" : "approved",
		});
		await ctx.reply(
			`Decisión registrada para ${id}: ${updated?.decisionStatus}. ${decisionStatus === "ignore" ? "No se sincroniza con Engram." : "Queda aprobado para /syncreports."}`,
		);
		return;
	}
	await replyLong(
		ctx,
		`Reporte ${report.id}\nAgente: ${report.agentLabel}\nEstado: ${report.status}\nTriage: ${report.triageStatus ?? "pending"}\nDecisión: ${report.decisionStatus ?? "none"}\nEngram: ${report.engramStatus ?? "pending"}\nDuración: ${report.durationLabel}\nWorkspace: ${report.workspace}\nInicio: ${report.startedAt}\nFin: ${report.finishedAt}\n\nTriage corto:\n${stripEngramNoise(report.triageSummary || "") || "(sin triage)"}\n\nResumen raw:\n${report.summary}\n\nTriage completo:\n${report.triageRaw || "(sin triage completo)"}\n\nSalida raw:\n${cleanAgentOutput(report.rawOutput || report.error || "(sin salida)")}`,
	);
});

bot.command("projects", async (ctx) => {
	if (!(await guard(ctx))) return;
	pendingAction = "useproject-id";
	await replyLong(
		ctx,
		`Proyectos registrados:\n\n${formatProjectChoices() || "(ninguno)"}\n\nRespondé con número o id para activar un proyecto, o /cancel para salir.`,
	);
});

bot.command("where", async (ctx) => {
	if (!(await guard(ctx))) return;
	const runtime = agentRouter.activeRuntime();
	await ctx.reply(
		`Proyecto activo:\n${activeProjectLabel()}\n\nAgente activo: ${runtime.profile.label}\nWorkspace: ${runtime.cwd}\nRPC: ${runtime.session.running ? "iniciado" : "en espera"}`,
	);
});

bot.command("addproject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "");
	if (!arg) {
		pendingAction = "addproject-path";
		await ctx.reply(
			"Mandame ahora la ruta del proyecto. Ejemplo:\nC:\\Users\\tu-usuario\\mi-proyecto",
		);
		return;
	}
	try {
		const { id, path } = parseAddProjectArgs(arg);
		const project = addProject(registry, id, path, config.allowedRoots);
		saveRegistry(registry);
		await ctx.reply(`Proyecto agregado:\n${project.id}\n${project.path}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.reply(message);
	}
});

bot.command("useproject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "");
	if (!arg) {
		pendingAction = "useproject-id";
		await replyLong(
			ctx,
			`Mandame ahora el número o id del proyecto:\n\n${formatProjectChoices() || "(ninguno)"}`,
		);
		return;
	}
	try {
		const project = setActiveProject(
			registry,
			resolveProjectChoice(arg),
			config.allowedRoots,
		);
		saveRegistry(registry);
		switchProjectContext(project.path);
		await ctx.reply(
			`Proyecto activo actualizado:\n${project.id}\n${project.path}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.reply(message);
	}
});

bot.command(WORK_SESSION_COMMANDS, async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "").toLowerCase();
	const includeAuxiliary = arg === "all";
	const liveProcesses = await findPiProcesses(process.pid);
	const externalPi = liveProcesses.filter(
		(processInfo) => processInfo.kind === "external-pi",
	);
	lastSessionPicks = sessionPicksForActiveProject(8, includeAuxiliary);
	pendingAction = "select-session";
	const recentText = formatSessionPicks(lastSessionPicks);
	const runtime = agentRouter.activeRuntime();
	await replyLong(
		ctx,
		`Trabajos abiertos:\n\nA. ${runtime.session.running ? "✅" : "○"} Agente activo\n   Proyecto: ${activeProjectLabel()}\n   Agente: ${runtime.profile.label}\n   Workspace: ${runtime.cwd}\n   Estado: ${runtime.session.busy ? "ocupado" : "libre"}\n\nPi CLI externos detectados: ${externalPi.length}\n${externalPi.length ? "Nota: para continuar, elegí un trabajo reciente de abajo; el PID no trae contexto." : ""}\n\nTrabajos recientes retomables del proyecto activo${includeAuxiliary ? " (incluye subagents)" : ""}:\n\n${recentText || "(no encontré sesiones recientes para este proyecto)"}\n\n${lastSessionPicks.length ? "Respondé T1, T2... para ver y retomar. Para seguir con el agente activo, respondé A, activo o esta sesión. También sirven /ver T1, /nametrabajo T1 <nombre>, /resume T1, /last o /trabajos all." : "No encontré trabajos recientes para elegir, pero podés responder A, activo o esta sesión para seguir con el agente activo."}`,
	);
});

bot.command("ver", async (ctx) => {
	if (!(await guard(ctx))) return;
	if (!lastSessionPicks.length)
		lastSessionPicks = sessionPicksForActiveProject(8);
	const pick = getSessionPick(commandArg(ctx.message?.text ?? ""));
	if (!pick) {
		await ctx.reply(
			`Uso: /ver T<n>\nPrimero corré /trabajos. Disponibles: ${lastSessionPicks.length}`,
		);
		return;
	}
	await showSessionPreview(ctx, pick);
});

bot.command("nametrabajo", async (ctx) => {
	if (!(await guard(ctx))) return;
	if (!lastSessionPicks.length)
		lastSessionPicks = sessionPicksForActiveProject(8);
	const arg = commandArg(ctx.message?.text ?? "");
	const match = arg.match(/^(?:t)?(\d+)\s+(.+)$/iu);
	if (!match) {
		await ctx.reply(
			`Uso: /nametrabajo T<n> <nombre>\nEjemplo: /nametrabajo T6 mantencion RCM\nDisponibles: ${lastSessionPicks.length}`,
		);
		return;
	}
	const pick = getSessionPick(match[1]);
	if (!pick) {
		await ctx.reply(
			`No encontré ese trabajo. Disponibles: ${lastSessionPicks.length}`,
		);
		return;
	}
	try {
		sessionNames = setSessionName(sessionNames, pick.id, match[2]);
		saveSessionNames(sessionNames);
		lastSessionPicks = sessionPicksForActiveProject(8);
		await ctx.reply(`Trabajo nombrado:\n${match[2]}\n${pick.id.slice(0, 8)}`);
	} catch (error) {
		await ctx.reply(error instanceof Error ? error.message : String(error));
	}
});

bot.command("resume", async (ctx) => {
	if (!(await guard(ctx))) return;
	if (!lastSessionPicks.length)
		lastSessionPicks = sessionPicksForActiveProject(8);
	const pick = getSessionPick(commandArg(ctx.message?.text ?? ""));
	if (!pick) {
		await ctx.reply(
			`Uso: /resume T<n>\nPrimero corré /trabajos. Disponibles: ${lastSessionPicks.length}`,
		);
		return;
	}
	await resumeSessionPick(ctx, pick);
});

bot.command("last", async (ctx) => {
	if (!(await guard(ctx))) return;
	lastSessionPicks = sessionPicksForActiveProject(1);
	if (!lastSessionPicks.length) {
		await ctx.reply("No encontré sesiones recientes para el proyecto activo.");
		return;
	}
	const pick = lastSessionPicks[0];
	await resumeSessionPick(ctx, pick);
});

bot.command(PATH_SESSION_COMMANDS, async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "");
	if (!arg) {
		await ctx.reply(`Uso: /cwd C:\\ruta\\proyecto\nActual: ${currentCwd}`);
		return;
	}

	let candidate: string;
	try {
		candidate = canonicalDirectory(resolve(arg));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.reply(`Carpeta inválida:\n${message}`);
		return;
	}

	if (!isAllowedCwd(candidate, config.allowedRoots)) {
		await ctx.reply(
			`Carpeta no permitida:\n${candidate}\n\nPermitidas:\n${config.allowedRoots.join("\n")}`,
		);
		return;
	}

	const project = addProject(
		registry,
		candidate.split(/[/\\]/u).pop() || "project",
		candidate,
		config.allowedRoots,
	);
	registry.activeProjectId = project.id;
	saveRegistry(registry);
	switchProjectContext(candidate);
	await ctx.reply(
		`Proyecto activo actualizado y sesión RPC reiniciada:\n${project.id}\n${currentCwd}`,
	);
});

bot.command("resumen", async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "");
	if (arg) {
		if (!lastSessionPicks.length)
			lastSessionPicks = sessionPicksForActiveProject(8);
		const pick = getSessionPick(arg);
		if (!pick) {
			await ctx.reply(
				`Uso: /resumen T<n>\nPrimero corré /trabajos. Disponibles: ${lastSessionPicks.length}`,
			);
			return;
		}
		await showSessionPreview(ctx, pick);
		return;
	}
	void runPrompt(
		ctx,
		`Proyecto activo del bot: ${activeProjectLabel()}\n\nHacé un resumen breve de la sesión/proyecto actual: objetivo, decisiones, archivos relevantes, próximos pasos y riesgos. Si Engram está disponible, guardá un resumen de sesión o memoria relevante antes de responder. Si detectás otro proyecto distinto, avisá la discrepancia.`,
	);
});

bot.command("mem", async (ctx) => {
	if (!(await guard(ctx))) return;
	const query = commandArg(ctx.message?.text ?? "");
	if (!query) {
		await ctx.reply("Uso: /mem texto a buscar");
		return;
	}
	void runPrompt(
		ctx,
		`Buscá en Engram memoria relevante sobre: ${query}. Resumí solo lo encontrado y decime si no hay resultados.`,
	);
});

bot.command("queue", async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply(taskQueue.formatStatus());
});

bot.command("queue_detail", async (ctx) => {
	if (!(await guard(ctx))) return;
	await replyLong(
		ctx,
		formatStructuredTaskQueueDetail(structuredTaskQueue.listTasks()),
	);
});

bot.command("queue_clear", async (ctx) => {
	if (!(await guard(ctx))) return;
	const count = taskQueue.clear();
	await ctx.reply(`Cola limpiada: ${count} tarea(s).`);
});

bot.command("queue_clear_structured", async (ctx) => {
	if (!(await guard(ctx))) return;
	const count = structuredTaskQueue.clearPersisted();
	await ctx.reply(`Cola estructurada limpiada: ${count} tarea(s).`);
});

bot.command("queue_approve", async (ctx) => {
	if (!(await guard(ctx))) return;
	const id = commandArg(ctx.message?.text ?? "");
	const task = id ? structuredTaskQueue.getTask(id) : undefined;
	if (!id || !task) {
		await ctx.reply("Uso: /queue_approve <id>");
		return;
	}
	if (task.guardStatus !== "needs_confirmation") {
		await ctx.reply("Esa tarea no está esperando aprobación.");
		return;
	}
	structuredTaskQueue.markGuardApproved(task.id);
	taskQueue.removeAllMatching(task.text);
	await ctx.reply(`Tarea aprobada: ${task.id}. Ejecutando con guard aprobado.`);
	void runPrompt(ctx, task.text, {
		fromQueue: true,
		structuredTaskCategory: task.category,
	});
});

bot.command("queue_reject", async (ctx) => {
	if (!(await guard(ctx))) return;
	const id = commandArg(ctx.message?.text ?? "");
	const task = id ? structuredTaskQueue.getTask(id) : undefined;
	if (!id || !task) {
		await ctx.reply("Uso: /queue_reject <id>");
		return;
	}
	structuredTaskQueue.markGuardRejected(
		task.id,
		"Rechazada por confirmación humana.",
	);
	taskQueue.removeFirstMatching(task.text);
	await ctx.reply(`Tarea rechazada: ${task.id}.`);
});

bot.command("mode", async (ctx) => {
	if (!(await guard(ctx))) return;
	const arg = commandArg(ctx.message?.text ?? "").toLowerCase();
	let modePrefix: string;
	if (arg === "interactive") {
		modePrefix =
			"Modo de orquestación: interactive. Antes de fases grandes o acciones riesgosas, pedí confirmación explícita.";
	} else if (arg === "auto") {
		modePrefix =
			"Modo de orquestación: auto prudente. Avanzá sin pausas en tareas seguras, pero pedí confirmación para acciones destructivas, credenciales, commits, push o deploy.";
	} else if (arg === "clear" || arg === "default") {
		modePrefix = "";
	} else {
		await ctx.reply("Uso: /mode interactive | auto | clear");
		return;
	}
	agentRouter.setActiveModePrefix(modePrefix);
	await ctx.reply(
		`Modo del agente activo actualizado y sesión reiniciada: ${modePrefix || "default"}`,
	);
});

bot.command("model", async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply("Usá /agents para elegir el agente/modelo activo.");
});

bot.command("cancel", async (ctx) => {
	if (!(await guard(ctx))) return;
	pendingAction = null;
	pendingLabRequest = null;
	clearPendingUiRequest();
	taskQueue.clear();
	taskQueueGeneration++;
	activePromptInFlight = false;
	const cancelledActive = agentRouter.cancelActive();
	const cancelledLabs = agentRouter.cancelProfiles(
		agentRouter.labProfiles().map((profile) => profile.id),
	);
	await ctx.reply(
		cancelledActive || cancelledLabs
			? `Cancelado. Agente activo: ${cancelledActive ? "sí" : "no"}. Labs: ${cancelledLabs}.`
			: "No había tarea activa. También limpié cualquier selección pendiente.",
	);
});

bot.command(LEGACY_SESSION_COMMANDS, async (ctx) => {
	if (!(await guard(ctx))) return;
	await ctx.reply(
		"Este comando queda para la próxima iteración. Esta versión mantiene una sesión RPC por CWD.",
	);
});

async function sendPendingUiResponse(
	ctx: Context,
	text: string,
): Promise<boolean> {
	if (!pendingUiRequest) {
		pendingAction = null;
		pendingUiRuntime = null;
		pendingUiToken = null;
		await ctx.reply(
			"No hay decisión pendiente. Mandá tu próximo mensaje normal.",
		);
		return true;
	}
	const response = parseUiRequestAnswer(pendingUiRequest, text);
	if (!response) {
		await ctx.reply(formatUiRequestForTelegram(pendingUiRequest), {
			reply_markup: pendingUiToken
				? inlineKeyboardForUiRequest(pendingUiRequest, pendingUiToken)
				: undefined,
		});
		return true;
	}
	const sent = pendingUiRuntime
		? agentRouter.answerUiRequestForRuntime(pendingUiRuntime, response)
		: agentRouter.answerActiveUiRequest(response);
	if (!sent) {
		await ctx.reply(
			"No pude enviar la decisión porque el servidor Pi no está activo.",
		);
		return true;
	}
	pendingUiRequest = null;
	pendingUiRuntime = null;
	pendingUiToken = null;
	pendingAction = null;
	await ctx.reply("Decisión enviada al orquestador.");
	return true;
}

bot.on("callback_query:data", async (ctx) => {
	if (!(await guard(ctx))) return;
	const remoteCallback = parseIduRemoteCallback(ctx.callbackQuery.data);
	if (remoteCallback) {
		await ctx.answerCallbackQuery();
		if (remoteCallback.type === "menu") {
			await replyIduRemoteMenu(ctx);
			return;
		}
		if (remoteCallback.type === "projects") {
			await replyIduRemoteProjects(ctx);
			return;
		}
		if (remoteCallback.type === "run") {
			await runIduRemoteCommand(ctx, remoteCallback.command);
			return;
		}
		await activateRemoteProject(ctx, remoteCallback.projectId);
		return;
	}
	const callback = parseUiCallbackData(ctx.callbackQuery.data);
	if (!callback) return;
	await ctx.answerCallbackQuery();
	if (
		!pendingUiRequest ||
		!pendingUiToken ||
		callback.token !== pendingUiToken
	) {
		await ctx.reply("Ese botón ya no corresponde a la decisión pendiente.");
		return;
	}
	await sendPendingUiResponse(ctx, callback.answer);
});

bot.on("message:text", async (ctx) => {
	if (!(await guard(ctx))) return;
	const text = ctx.message.text.trim();
	if (!text) return;

	if (pendingUiRequest && !text.startsWith("/")) {
		await sendPendingUiResponse(ctx, text);
		return;
	}

	if (text.startsWith("/")) return;

	const masterPlanDecision = handleMasterPlanNaturalDecision({
		text,
		projectId: currentProjectId(),
		projectPath: activeProjectPath(),
		stateRoot: activeProjectStateRoot(),
		gitHead: readGitHead(activeProjectPath()),
		source: "telegram",
	});
	if (masterPlanDecision.handled) {
		await replyLong(
			ctx,
			masterPlanDecision.action === "interactive"
				? formatMasterPlanReview(masterPlanDecision.review)
				: formatMasterPlanOperation(masterPlanDecision.result),
		);
		return;
	}

	if (pendingAction === "project-core-wizard") {
		const activeProject = getActiveProject(registry);
		try {
			const result = answerProjectCoreWizard(
				{
					projectId: activeProject?.id ?? currentProjectId(),
					projectPath: activeProject?.path ?? currentCwd,
					workspaceRoot: config.agentWorkspaceRoot,
					projectName: activeProject?.name ?? activeProject?.id,
				},
				text,
			);
			if (result.completed) pendingAction = null;
			await replyLong(ctx, result.message);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pendingAction = null;
			await replyLong(ctx, `No pude actualizar Project Core:\n${message}`);
		}
		return;
	}

	if (pendingAction === "addproject-path") {
		pendingAction = null;
		try {
			const project = addProjectFromPath(text);
			await ctx.reply(
				`Proyecto agregado y activado:\n${project.id}\n${project.path}`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await ctx.reply(`No pude agregar ese proyecto:\n${message}`);
		}
		return;
	}

	if (pendingAction === "useproject-id") {
		pendingAction = null;
		try {
			const project = setActiveProject(
				registry,
				resolveProjectChoice(text),
				config.allowedRoots,
			);
			saveRegistry(registry);
			switchProjectContext(project.path);
			await ctx.reply(
				`Proyecto activo actualizado:\n${project.id}\n${project.path}`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await ctx.reply(message);
		}
		return;
	}

	if (pendingAction === "select-session") {
		if (isActiveSessionChoice(text)) {
			pendingAction = null;
			await ctx.reply(
				"Seguimos con el agente activo. Mandá tu próximo mensaje, o usá /trabajos para elegir otro trabajo.",
			);
			return;
		}
		const pick = getSessionPick(text);
		if (pick) {
			await resumeSessionPick(ctx, pick);
			return;
		}
		await ctx.reply(
			"Elegí un trabajo tipo T1, T2...; o respondé A/activo para seguir con el agente activo. Usá /cancel para salir del selector.",
		);
		return;
	}

	if (pendingAction === "select-lab-agent") {
		const index = parseLabAgentIndex(text);
		if (!index) {
			await ctx.reply(
				`Elegí un agente lab válido:\n\n${formatLabAgentChoices()}`,
			);
			return;
		}
		pendingAction = "select-lab-duration";
		pendingLabRequest = { profileIndexes: [index] };
		await ctx.reply(
			`Elegí profundidad para test lab:\n\n${formatDurationChoices()}`,
		);
		return;
	}

	if (pendingAction === "select-lab-duration") {
		const duration = parseLabDuration(text);
		if (!duration || !pendingLabRequest) {
			await ctx.reply(
				`Elegí una profundidad válida:\n\n${formatDurationChoices()}`,
			);
			return;
		}
		const request = pendingLabRequest;
		pendingLabRequest = null;
		pendingAction = null;
		await runLabForProfiles(ctx, request.profileIndexes, duration);
		return;
	}

	if (pendingAction === "select-agent") {
		const selected = agentRouter.select(text);
		if (selected) {
			pendingAction = null;
			const runtime = agentRouter.activeRuntime();
			await ctx.reply(
				`Agente activo:\n${selected.label}\nid: ${selected.id}\nWorkspace: ${runtime.cwd}\nModo workspace: ${runtime.workspaceKind}`,
			);
			return;
		}
		await ctx.reply(
			"Elegí un número/id de /agents, o usá /cancel para salir del selector.",
		);
		return;
	}

	if (looksLikePath(text)) {
		await ctx.reply(
			"Eso parece una ruta. Para agregarla y trabajar ahí usá:\n/addproject\nLuego pegá la ruta, o usá /new <ruta>.",
		);
		return;
	}

	void runPrompt(ctx, text);
});

bot.catch((error) => {
	console.error("Bot error", error);
});

function shutdown(): void {
	agentRouter.stopAll("Bridge detenido.");
}

process.once("SIGINT", () => {
	shutdown();
	process.exit(0);
});
process.once("SIGTERM", () => {
	shutdown();
	process.exit(0);
});
process.once("exit", shutdown);

console.log(
	`pi-telegram-bridge iniciado. PID=${process.pid} CWD=${currentCwd} PI=${[config.piBin, "<PI_CLI_JS>", "--mode", "rpc"].join(" ")}`,
);
void bot.start({
	onStart: async () => {
		await notifyBridgeStartupFromIntent();
	},
});
