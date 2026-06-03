#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	canonicalDirectory,
	isAllowedCwd,
	loadConfig,
	parseAgentProfiles,
	type BridgeConfig,
} from "./config.js";
import { AgentRouter, profileModelLabel } from "./agent-router.js";
import {
	applyPackageEnvDefaults,
	buildCliHomeStatus,
	formatCliHome,
	formatCliProjectStatus,
	formatDiagnosticsStatus,
	formatIduLogo,
	formatInstallationMenu,
	formatMainMenu,
	formatModelProfilesMenu,
	formatModelProfilesStatus,
	formatSetupPathHelp,
	formatSupervisorStatus,
	formatTaskQueueStatus,
	formatTelegramRemoteMenu,
	formatTelegramRemoteStatus,
	formatSetupWizardNonInteractive,
	resolveCliPackageRoot,
	resolveIduRegistryPath,
} from "./cli-home.js";
import {
	formatProjectStatePaths,
	formatProjectStateResetResult,
	resetProjectState,
	resolveProjectStatePaths,
	type ProjectStateResetResult,
} from "./project-state.js";
import {
	addSourceLibraryItem,
	extractSourceLibraryItem,
	formatSourceLibraryAddResult,
	formatSourceLibraryExtractResult,
	formatSourceLibraryItemReport,
	formatSourceLibraryReadResult,
	formatSourceLibraryRefreshResult,
	formatSourceLibraryRemoveResult,
	formatSourceLibraryStatus,
	getSourceLibraryStatus,
	readSourceLibraryItem,
	refreshSourceLibrary,
	removeSourceLibraryItem,
	reportSourceLibraryItem,
	type RemoveSourceLibraryItemResult,
	type SourceLibraryExtractResult,
	type SourceLibraryItemReport,
	type SourceLibraryMutationResult,
	type SourceLibraryReadResult,
	type SourceLibraryStatus,
} from "./source-library.js";
import {
	createSourceResearchReport,
	formatSourceResearchReport,
	type SourceResearchReport,
} from "./source-research.js";
import {
	createSourceDigest,
	formatSourceChunkRead,
	formatSourceDigest,
	formatSourceDigestStatus,
	formatSourceRecommendationReport,
	formatSourceRequiredActionsReport,
	getSourceDigestStatus,
	getSourceRequiredActions,
	readSourceChunk,
	recommendSourcesForTask,
	type SourceChunkReadResult,
	type SourceDigest,
	type SourceDigestStatus,
	type SourceRecommendationReport,
	type SourceRequiredActionsReport,
} from "./source-digest.js";
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
import { runIduBootstrap } from "./idu-bootstrap.js";
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
	type MasterPlanDraftResult,
	type MasterPlanProgressEvent,
	type MasterPlanReview,
	type MasterPlanStatusResult,
} from "./master-plan.js";
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
import { buildPostflightPhysicalGates } from "./physical-gates.js";
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
	detectAgentConfigs,
	detectSystem,
	detectTools,
	formatIduSetupStatus,
	formatInstallIduMcpConfigResult,
	formatProjectEnrollResult,
	formatProjectInstallStatus,
	installIduMcpConfig,
	printIduMcpConfig,
	projectEnroll,
	projectInstallStatus,
	resolvePiAgentDir,
} from "./idu-installer.js";
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
	planIduSupervisorCron,
	type IduSupervisorCronPlanResult,
} from "./idu-supervisor-cron.js";
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
	approveSupervisorImprovement,
	deferSupervisorImprovement,
	formatSupervisorImprovementDecisionResult,
	formatSupervisorImprovementStatus,
	getSupervisorImprovementStatus,
	rejectSupervisorImprovement,
	type SupervisorImprovementDecisionResult,
	type SupervisorImprovementStatusResult,
} from "./supervisor-improvement-decisions.js";
import {
	buildSkillImprovementPlan,
	createSkillImprovementProposals,
	formatSkillImprovementCreationResult,
	formatSkillImprovementPlan,
	formatSkillImprovementStatus,
	getSkillImprovementStatus,
	type SkillImprovementCreationResult,
	type SkillImprovementPlan,
	type SkillImprovementStatusResult,
} from "./skill-improvement-proposals.js";
import {
	approveSkillImprovementProposal,
	deferSkillImprovementProposal,
	formatSkillImprovementDecisionResult,
	rejectSkillImprovementProposal,
	type SkillImprovementDecisionResult,
} from "./skill-improvement-decisions.js";
import {
	createAgentLabReviewRequests,
	formatAgentLabReviewRequestPlan,
	formatAgentLabReviewRequestReview,
	reviewAgentLabReviewRequest,
	type AgentLabReviewRequestPlan,
	type AgentLabReviewRequestReview,
} from "./agentlab-review-requests.js";
import {
	formatAgentLabReviewRunResult,
	formatAgentLabReviewStatus,
	getAgentLabReviewStatus,
	runAgentLabReviewRequestFile,
	type AgentLabReviewRunResult,
	type AgentLabReviewStatus,
} from "./agentlab-review-runner.js";
import {
	consolidateAgentLabReviewRun,
	formatAgentLabConsolidationResult,
	formatAgentLabConsolidationStatus,
	getAgentLabConsolidationStatus,
	type AgentLabConsolidationResult,
	type AgentLabConsolidationStatus,
} from "./agentlab-report-consolidation.js";
import {
	createSkillDraftsFromApprovedProposals,
	formatSkillDraftCreationResult,
	formatSkillDraftReview,
	reviewSkillDraft,
	type SkillDraftCreationResult,
	type SkillDraftReview,
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
	type SupervisorLearningRuleDecisionResult,
	type SupervisorLearningRulesApplyResult,
	type SupervisorLearningRulesRollbackResult,
	type SupervisorLearningRulesStatus,
	type SupervisorLearningRulesTestResult,
} from "./supervisor-learning-rules.js";
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
import { dirname, join } from "node:path";
import {
	bridgeLifecycleReply,
	launchBridgeLifecycle,
	type BridgeLifecycleAction,
} from "./bridge-lifecycle.js";
import {
	formatBridgeEnvStatus,
	packageEnvPath,
	readEnvDraft,
	tailTextFile,
	validateBridgeEnvDraft,
	writeEnvDraftWithBackup,
} from "./env-config.js";
import {
	IDU_MODEL_ROLES,
	applySupervisorModelAssignment,
	assignmentOptionsFromModelCatalog,
	formatAgentLabModelAssignmentProposal,
	formatModelAssignments,
	loadModelAssignments,
	readGentleModelRouting,
	recommendAgentLabModelAssignments,
	saveModelAssignment,
	saveModelAssignments,
} from "./model-assignments.js";
import {
	buildUnifiedModelCatalog,
	modelProviderDisplayKey,
	modelProviderDisplayLabel,
	readPiModelCatalogSnapshot,
	resolvePiModelCatalogSnapshotPath,
} from "./model-catalog.js";
import {
	flushIduUsageEvents,
	formatIduUsageSummary,
	readIduUsageEvents,
	recordIduUsageEventDeferred,
	summarizeIduUsageEvents,
} from "./usage-events.js";

export type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type CliRuntime = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	sessionStatePath?: string;
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
	masterPlanStatus?: () => MasterPlanStatusResult;
	masterPlanReview?: (pathOrLatest: string) => MasterPlanReview;
	masterPlanApprove?: (
		pathOrLatest: string,
		reason?: string,
		source?: "cli" | "pi" | "telegram" | "mcp",
	) => MasterPlanDraftResult;
	masterPlanReject?: (
		pathOrLatest: string,
		reason?: string,
	) => MasterPlanDraftResult;
	masterPlanRedraft?: (reason?: string) => MasterPlanDraftResult;
	masterPlanNaturalDecision?: (
		text: string,
	) => ReturnType<typeof handleMasterPlanNaturalDecision>;
	sourceLibraryStatus: () => SourceLibraryStatus;
	sourceLibraryAdd: (inputPath: string) => SourceLibraryMutationResult;
	sourceLibraryRemove: (sourceId: string) => RemoveSourceLibraryItemResult;
	sourceLibraryRead: (sourceId: string) => SourceLibraryReadResult;
	sourceLibraryExtract: (sourceId: string) => SourceLibraryExtractResult;
	sourceLibraryReport: (sourceId: string) => SourceLibraryItemReport;
	sourceLibraryResearch: (query: string) => SourceResearchReport;
	sourceDigest: (sourceId: string) => SourceDigest;
	sourceDigestStatus: () => SourceDigestStatus;
	sourceChunkRead: (sourceId: string, chunkId: string) => SourceChunkReadResult;
	sourceRecommend: (request: string) => SourceRecommendationReport;
	sourceRequiredActions: () => SourceRequiredActionsReport;
	sourceLibraryRefresh: () => SourceLibraryStatus;
	formatSourceLibraryStatus: (status: SourceLibraryStatus) => string;
	formatSourceLibraryAddResult: (result: SourceLibraryMutationResult) => string;
	formatSourceLibraryRemoveResult: (
		result: RemoveSourceLibraryItemResult,
	) => string;
	formatSourceLibraryReadResult: (result: SourceLibraryReadResult) => string;
	formatSourceLibraryExtractResult: (
		result: SourceLibraryExtractResult,
	) => string;
	formatSourceLibraryItemReport: (result: SourceLibraryItemReport) => string;
	formatSourceResearchReport: (result: SourceResearchReport) => string;
	formatSourceDigest: (result: SourceDigest) => string;
	formatSourceDigestStatus: (result: SourceDigestStatus) => string;
	formatSourceChunkRead: (result: SourceChunkReadResult) => string;
	formatSourceRecommendationReport: (
		result: SourceRecommendationReport,
	) => string;
	formatSourceRequiredActionsReport: (
		result: SourceRequiredActionsReport,
	) => string;
	formatSourceLibraryRefreshResult: (status: SourceLibraryStatus) => string;
	formatMasterPlanStatus?: (result: MasterPlanStatusResult) => string;
	formatMasterPlanReview?: (review: MasterPlanReview) => string;
	formatMasterPlanOperation?: (result: MasterPlanDraftResult) => string;
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
	supervisorTick: (options?: {
		allowSemanticDraft?: boolean;
		allowAgentTaskPlan?: boolean;
	}) => IduSupervisorLoopResult;
	supervisorCronPlan: () => IduSupervisorCronPlanResult;
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
	supervisorImprovementStatus: (
		pathOrLatest: string,
	) => SupervisorImprovementStatusResult;
	formatSupervisorImprovementStatus: (
		result: SupervisorImprovementStatusResult,
	) => string;
	supervisorImprovementApprove: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SupervisorImprovementDecisionResult;
	supervisorImprovementReject: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SupervisorImprovementDecisionResult;
	supervisorImprovementDefer: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SupervisorImprovementDecisionResult;
	formatSupervisorImprovementDecisionResult: (
		result: SupervisorImprovementDecisionResult,
	) => string;
	supervisorImprovementsApply: (
		pathOrLatest: string,
	) => SupervisorLearningRulesApplyResult;
	formatSupervisorLearningRulesApplyResult: (
		result: SupervisorLearningRulesApplyResult,
	) => string;
	supervisorLearningRulesStatus: () => SupervisorLearningRulesStatus;
	formatSupervisorLearningRulesStatus: (
		status: SupervisorLearningRulesStatus,
	) => string;
	supervisorLearningRulesTest: () => SupervisorLearningRulesTestResult;
	formatSupervisorLearningRulesTest: (
		result: SupervisorLearningRulesTestResult,
	) => string;
	supervisorLearningRulesDisable: (
		ruleId: string,
		reason?: string,
	) => SupervisorLearningRuleDecisionResult;
	supervisorLearningRulesEnable: (
		ruleId: string,
		reason?: string,
	) => SupervisorLearningRuleDecisionResult;
	formatSupervisorLearningRuleDecision: (
		result: SupervisorLearningRuleDecisionResult,
	) => string;
	supervisorLearningRulesRollback: (
		backupPathOrLatest: string,
	) => SupervisorLearningRulesRollbackResult;
	formatSupervisorLearningRulesRollback: (
		result: SupervisorLearningRulesRollbackResult,
	) => string;
	skillImprovementPlan: (pathOrLatest: string) => SkillImprovementPlan;
	formatSkillImprovementPlan: (plan: SkillImprovementPlan) => string;
	skillImprovementCreate: (
		pathOrLatest: string,
	) => SkillImprovementCreationResult;
	formatSkillImprovementCreationResult: (
		result: SkillImprovementCreationResult,
	) => string;
	skillImprovementStatus: (
		pathOrLatest: string,
	) => SkillImprovementStatusResult;
	formatSkillImprovementStatus: (
		status: SkillImprovementStatusResult,
	) => string;
	skillImprovementApprove: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SkillImprovementDecisionResult;
	skillImprovementReject: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SkillImprovementDecisionResult;
	skillImprovementDefer: (
		pathOrLatest: string,
		proposalIdOrAll: string,
		reason?: string,
	) => SkillImprovementDecisionResult;
	formatSkillImprovementDecisionResult: (
		result: SkillImprovementDecisionResult,
	) => string;
	skillDraftsCreate: (pathOrLatest: string) => SkillDraftCreationResult;
	formatSkillDraftCreationResult: (result: SkillDraftCreationResult) => string;
	skillDraftReview: (pathOrLatest: string) => SkillDraftReview;
	formatSkillDraftReview: (review: SkillDraftReview) => string;
	agentLabRequestCreate: (
		source: string,
		pathOrLatest?: string,
	) => AgentLabReviewRequestPlan;
	formatAgentLabReviewRequestPlan: (plan: AgentLabReviewRequestPlan) => string;
	agentLabRequestReview: (pathOrLatest: string) => AgentLabReviewRequestReview;
	formatAgentLabReviewRequestReview: (
		review: AgentLabReviewRequestReview,
	) => string;
	agentLabReviewRun: (pathOrLatest: string) => Promise<AgentLabReviewRunResult>;
	formatAgentLabReviewRunResult: (result: AgentLabReviewRunResult) => string;
	agentLabReviewStatus: (pathOrLatest: string) => AgentLabReviewStatus;
	formatAgentLabReviewStatus: (status: AgentLabReviewStatus) => string;
	agentLabReportConsolidate: (
		pathOrLatest: string,
	) => AgentLabConsolidationResult;
	formatAgentLabConsolidationResult: (
		result: AgentLabConsolidationResult,
	) => string;
	agentLabReportConsolidationStatus: (
		pathOrLatest: string,
	) => AgentLabConsolidationStatus;
	formatAgentLabConsolidationStatus: (
		status: AgentLabConsolidationStatus,
	) => string;
	createTask: (kind: TaskTemplateKind, details: string) => StructuredTask;
	formatTask: (task: StructuredTask) => string;
	queueDetail: () => string;
	listTasks?: () => StructuredTask[];
	queueClearStructured: () => number;
	queueApprove: (idOrPrefix: string) => StructuredTask | undefined;
	queueReject: (idOrPrefix: string) => StructuredTask | undefined;
	projectStateReset: (confirmed: boolean) => ProjectStateResetResult;
	formatProjectStateResetResult: (result: ProjectStateResetResult) => string;
	activeProfileId?: () => string;
};

type RuntimeContext = {
	config: BridgeConfig;
	registry: ProjectRegistry;
	activeProject: ProjectEntry;
	structuredTaskQueue: StructuredTaskQueue;
	runtimeWorkspaceRoot: string;
	reportsPath: string;
	labDbPath: string;
};

function resolveRuntimeProject(
	registry: ProjectRegistry,
	config: BridgeConfig,
	projectPath?: string,
): ProjectEntry | undefined {
	if (!projectPath?.trim()) return getActiveProject(registry);
	const path = canonicalDirectory(projectPath.trim());
	if (!isAllowedCwd(path, config.allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${path}`);
	}
	return registry.projects.find((project) =>
		sameRuntimePath(project.path, path),
	);
}

function sameRuntimePath(left: string, right: string): boolean {
	const normalize = (value: string) =>
		process.platform === "win32" ? value.toLowerCase() : value;
	return normalize(left) === normalize(right);
}

export type CreateCliRuntimeOptions = {
	projectPath?: string;
	requireTelegramConfig?: boolean;
	createRegistryIfMissing?: boolean;
};

export function createCliRuntime(
	options: CreateCliRuntimeOptions = {},
): CliRuntime {
	applyPackageEnvDefaults();
	const config = loadConfig({
		requireTelegram: options.requireTelegramConfig ?? true,
	});
	process.env.AGENT_WORKSPACE_ROOT ??= config.agentWorkspaceRoot;
	const registry = loadRegistry(config.defaultCwd, config.allowedRoots, {
		registryPath: resolveIduRegistryPath(),
		createIfMissing: options.createRegistryIfMissing ?? true,
	});
	const activeProject = resolveRuntimeProject(
		registry,
		config,
		options.projectPath,
	);
	if (!activeProject) {
		throw new Error(
			"No hay proyecto activo. Usá /addproject <id> <ruta> en Telegram o configurá DEFAULT_CWD.",
		);
	}
	const projectStatePaths = activeProject.stateRoot
		? resolveProjectStatePaths({
				workspaceRoot: config.agentWorkspaceRoot,
				projectId: activeProject.id,
				projectPath: activeProject.path,
			})
		: undefined;
	const runtimeWorkspaceRoot =
		projectStatePaths?.stateRoot ?? config.agentWorkspaceRoot;
	const reportsPath =
		projectStatePaths?.reportsDir ?? join(config.agentWorkspaceRoot, "reports");
	const labDbPath =
		projectStatePaths?.labDbPath ??
		join(config.agentWorkspaceRoot, "reports", "lab.db");
	configureIduSessionStore(
		projectStatePaths
			? {
					workspaceRoot: runtimeWorkspaceRoot,
					filePath: projectStatePaths.sessionStatePath,
				}
			: { workspaceRoot: runtimeWorkspaceRoot },
	);
	const structuredTaskQueue = new StructuredTaskQueue(
		projectStatePaths
			? { filePath: projectStatePaths.taskQueuePath }
			: { workspaceRoot: runtimeWorkspaceRoot },
	);
	const labDbRepository = new LabDbRepository(labDbPath, {
		enableSemanticAuditTrigger: true,
		onSemanticAuditTrigger: (semanticTrigger) => {
			maybeRunSupervisorAfterSemanticTrigger({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				repository: labDbRepository,
				queue: structuredTaskQueue,
				semanticTrigger,
			});
		},
	});
	const agentRouter = new AgentRouter({
		piBin: config.piBin,
		basePiArgs: config.piArgs,
		profiles: config.agentProfiles,
		defaultProjectId: activeProject.id,
		defaultCwd: activeProject.path,
		workspaceRoot: runtimeWorkspaceRoot,
		workspaceMode: config.agentWorkspaceMode,
	});
	const modelAssignments = projectStatePaths
		? loadModelAssignments(projectStatePaths.stateRoot)
		: { version: 1 as const, assignments: {} };
	applySupervisorModelAssignment(
		agentRouter,
		modelAssignments,
		config.agentProfiles,
	);
	const context = {
		config,
		registry,
		activeProject,
		structuredTaskQueue,
		runtimeWorkspaceRoot,
		reportsPath,
		labDbPath,
	};
	const masterPlanStateRoot =
		projectStatePaths?.stateRoot ??
		resolveProjectStatePaths({
			workspaceRoot: config.agentWorkspaceRoot,
			projectId: activeProject.id,
			projectPath: activeProject.path,
		}).stateRoot;
	return {
		projectId: activeProject.id,
		projectPath: activeProject.path,
		workspaceRoot: runtimeWorkspaceRoot,
		...(projectStatePaths?.sessionStatePath
			? { sessionStatePath: projectStatePaths.sessionStatePath }
			: {}),
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
				workspaceRoot: runtimeWorkspaceRoot,
				repository: labDbRepository,
				queue: structuredTaskQueue,
				risk: report.risk,
			});
			return report;
		},
		formatPostflight: formatProjectPostflightReport,
		prepare: () => runPrepare(context),
		formatPrepare: formatIduPrepareResult,
		projectStateReset: (confirmed) => {
			if (!confirmed) {
				throw new Error(
					"Reset requiere confirmación explícita: agregá --yes al comando.",
				);
			}
			return resetProjectState(
				projectStatePaths ??
					resolveProjectStatePaths({
						workspaceRoot: config.agentWorkspaceRoot,
						projectId: activeProject.id,
						projectPath: activeProject.path,
					}),
			);
		},
		formatProjectStateResetResult,
		masterPlanStatus: () =>
			getMasterPlanStatus({
				stateRoot: masterPlanStateRoot,
				currentGitHead: readGitHead(activeProject.path),
			}),
		masterPlanReview: (pathOrLatest) =>
			reviewMasterPlan({ stateRoot: masterPlanStateRoot, pathOrLatest }),
		masterPlanApprove: (pathOrLatest, reason, source = "cli") =>
			approveMasterPlan({
				stateRoot: masterPlanStateRoot,
				pathOrLatest,
				source,
				reason,
			}),
		masterPlanReject: (pathOrLatest, reason) =>
			rejectMasterPlan({
				stateRoot: masterPlanStateRoot,
				pathOrLatest,
				reason,
			}),
		masterPlanRedraft: (reason) =>
			redraftMasterPlan({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				stateRoot: masterPlanStateRoot,
				gitHead: readGitHead(activeProject.path),
				reason,
			}),
		masterPlanNaturalDecision: (text) =>
			handleMasterPlanNaturalDecision({
				text,
				projectId: activeProject.id,
				projectPath: activeProject.path,
				stateRoot: masterPlanStateRoot,
				gitHead: readGitHead(activeProject.path),
				source: "cli",
			}),
		sourceLibraryStatus: () =>
			getSourceLibraryStatus({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
			}),
		sourceLibraryAdd: (inputPath) =>
			addSourceLibraryItem({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				inputPath,
			}),
		sourceLibraryRemove: (sourceId) =>
			removeSourceLibraryItem({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
			}),
		sourceLibraryRead: (sourceId) =>
			readSourceLibraryItem({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
			}),
		sourceLibraryExtract: (sourceId) =>
			extractSourceLibraryItem({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
			}),
		sourceLibraryReport: (sourceId) =>
			reportSourceLibraryItem({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
			}),
		sourceLibraryResearch: (query) =>
			createSourceResearchReport({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				query,
			}),
		sourceDigest: (sourceId) =>
			createSourceDigest({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
			}),
		sourceDigestStatus: () =>
			getSourceDigestStatus({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
			}),
		sourceChunkRead: (sourceId, chunkId) =>
			readSourceChunk({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				sourceId,
				chunkId,
			}),
		sourceRecommend: (request) =>
			recommendSourcesForTask({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
				request,
			}),
		sourceRequiredActions: () =>
			getSourceRequiredActions({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
			}),
		sourceLibraryRefresh: () =>
			refreshSourceLibrary({
				stateRoot: masterPlanStateRoot,
				projectId: activeProject.id,
			}),
		formatSourceLibraryStatus,
		formatSourceLibraryAddResult,
		formatSourceLibraryRemoveResult,
		formatSourceLibraryReadResult,
		formatSourceLibraryExtractResult,
		formatSourceLibraryItemReport,
		formatSourceResearchReport,
		formatSourceDigest,
		formatSourceDigestStatus,
		formatSourceChunkRead,
		formatSourceRecommendationReport,
		formatSourceRequiredActionsReport,
		formatSourceLibraryRefreshResult,
		formatMasterPlanStatus,
		formatMasterPlanReview,
		formatMasterPlanOperation,
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
				dbPath: labDbPath,
				reportsPath: reportsPath,
				workspaceRoot: runtimeWorkspaceRoot,
				...semanticCompactionProjectContext(activeProject.path),
			}),
		formatSemanticCompactionDraft,
		semanticCompactionReview: (pathOrLatest) =>
			reviewSemanticCompactionDraft(pathOrLatest, reportsPath),
		formatSemanticCompactionReview,
		semanticAgentTaskPlan: (pathOrLatest) =>
			buildSemanticAgentTaskPlan(pathOrLatest, reportsPath),
		formatSemanticAgentTaskPlan,
		semanticAgentTasksCreate: (pathOrLatest) =>
			createSemanticAgentTasks({
				pathOrLatest,
				reportsPath: reportsPath,
				queue: structuredTaskQueue,
				projectId: activeProject.id,
			}),
		formatSemanticAgentTaskCreationResult,
		supervisorTick: (options = {}) =>
			runIduSupervisorLoop({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				trigger: "manual",
				options: {
					allowSemanticDraft: options.allowSemanticDraft ?? false,
					allowAgentTaskPlan: options.allowAgentTaskPlan ?? false,
					dryRun: false,
				},
				repository: labDbRepository,
				queue: structuredTaskQueue,
			}),
		supervisorCronPlan: () =>
			planIduSupervisorCron({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				trigger: "cron_planning",
				options: {
					allowSemanticDraft: false,
					allowAgentTaskPlan: false,
					dryRun: true,
					mode: "plan",
				},
				repository: labDbRepository,
				queue: structuredTaskQueue,
			}),
		formatSupervisorTick: formatIduSupervisorLoopResult,
		supervisorOnIduActivation: () => {
			maybeRunSupervisorOnIduActivation({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				repository: labDbRepository,
				queue: structuredTaskQueue,
			});
		},
		supervisorImprovementPlan: (pathOrLatest) =>
			buildSupervisorImprovementPlan(pathOrLatest, reportsPath),
		formatSupervisorImprovementPlan,
		supervisorImprovementCreate: (pathOrLatest) =>
			createSupervisorImprovementProposals(pathOrLatest, reportsPath),
		formatSupervisorImprovementCreationResult,
		supervisorImprovementStatus: (pathOrLatest) =>
			getSupervisorImprovementStatus(pathOrLatest, reportsPath),
		formatSupervisorImprovementStatus,
		supervisorImprovementApprove: (pathOrLatest, proposalIdOrAll, reason) =>
			approveSupervisorImprovement(pathOrLatest, proposalIdOrAll, reportsPath, {
				source: "cli",
				reason,
			}),
		supervisorImprovementReject: (pathOrLatest, proposalIdOrAll, reason) =>
			rejectSupervisorImprovement(pathOrLatest, proposalIdOrAll, reportsPath, {
				source: "cli",
				reason,
			}),
		supervisorImprovementDefer: (pathOrLatest, proposalIdOrAll, reason) =>
			deferSupervisorImprovement(pathOrLatest, proposalIdOrAll, reportsPath, {
				source: "cli",
				reason,
			}),
		formatSupervisorImprovementDecisionResult,
		supervisorImprovementsApply: (pathOrLatest) =>
			applySupervisorLearningRules(pathOrLatest, reportsPath),
		formatSupervisorLearningRulesApplyResult,
		supervisorLearningRulesStatus: () =>
			getSupervisorLearningRulesStatus(reportsPath),
		formatSupervisorLearningRulesStatus,
		supervisorLearningRulesTest: () => testSupervisorLearningRules(reportsPath),
		formatSupervisorLearningRulesTest,
		supervisorLearningRulesDisable: (ruleId, reason) =>
			disableSupervisorLearningRule(ruleId, reportsPath, {
				source: "cli",
				reason,
			}),
		supervisorLearningRulesEnable: (ruleId, reason) =>
			enableSupervisorLearningRule(ruleId, reportsPath, {
				source: "cli",
				reason,
			}),
		formatSupervisorLearningRuleDecision,
		supervisorLearningRulesRollback: (backupPathOrLatest) =>
			rollbackSupervisorLearningRules(backupPathOrLatest, reportsPath),
		formatSupervisorLearningRulesRollback,
		skillImprovementPlan: (pathOrLatest) =>
			buildSkillImprovementPlan(pathOrLatest, reportsPath, {
				workspaceRoot: activeProject.path,
				dbPath: labDbPath,
			}),
		formatSkillImprovementPlan,
		skillImprovementCreate: (pathOrLatest) =>
			createSkillImprovementProposals(pathOrLatest, reportsPath, {
				workspaceRoot: activeProject.path,
				dbPath: labDbPath,
			}),
		formatSkillImprovementCreationResult,
		skillImprovementStatus: (pathOrLatest) =>
			getSkillImprovementStatus(pathOrLatest, reportsPath),
		formatSkillImprovementStatus,
		skillImprovementApprove: (pathOrLatest, proposalIdOrAll, reason) =>
			approveSkillImprovementProposal(
				pathOrLatest,
				proposalIdOrAll,
				reportsPath,
				{ source: "cli", reason },
			),
		skillImprovementReject: (pathOrLatest, proposalIdOrAll, reason) =>
			rejectSkillImprovementProposal(
				pathOrLatest,
				proposalIdOrAll,
				reportsPath,
				{ source: "cli", reason },
			),
		skillImprovementDefer: (pathOrLatest, proposalIdOrAll, reason) =>
			deferSkillImprovementProposal(
				pathOrLatest,
				proposalIdOrAll,
				reportsPath,
				{ source: "cli", reason },
			),
		formatSkillImprovementDecisionResult,
		skillDraftsCreate: (pathOrLatest) =>
			createSkillDraftsFromApprovedProposals(pathOrLatest, reportsPath),
		formatSkillDraftCreationResult,
		skillDraftReview: (pathOrLatest) =>
			reviewSkillDraft(pathOrLatest, reportsPath),
		formatSkillDraftReview,
		agentLabRequestCreate: (source, pathOrLatest) => {
			if (source === "postflight") {
				return createAgentLabReviewRequests({
					source: "postflight",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					postflightReport: buildPostflightReport(context),
				});
			}
			if (source === "skill-draft") {
				return createAgentLabReviewRequests({
					source: "skill_draft",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					skillDraftPathOrLatest: pathOrLatest ?? "latest",
				});
			}
			if (source === "master-plan") {
				return createAgentLabReviewRequests({
					source: "master_plan",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					masterPlanPathOrLatest: pathOrLatest ?? "latest",
				});
			}
			if (source === "external-source-intelligence") {
				return createAgentLabReviewRequests({
					source: "external_source_intelligence",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
				});
			}
			throw new Error(
				`Fuente no soportada para agentlab-request-create: ${source}`,
			);
		},
		formatAgentLabReviewRequestPlan,
		agentLabRequestReview: (pathOrLatest) =>
			reviewAgentLabReviewRequest(pathOrLatest, reportsPath),
		formatAgentLabReviewRequestReview,
		agentLabReviewRun: (pathOrLatest) =>
			runAgentLabReviewRequestFile({
				pathOrLatest,
				reportsPath: reportsPath,
				projectId: activeProject.id,
				projectPath: activeProject.path,
				router: agentRouter,
				modelAssignments,
			}),
		formatAgentLabReviewRunResult,
		agentLabReviewStatus: (pathOrLatest) =>
			getAgentLabReviewStatus(pathOrLatest, reportsPath),
		formatAgentLabReviewStatus,
		agentLabReportConsolidate: (pathOrLatest) =>
			consolidateAgentLabReviewRun(pathOrLatest, reportsPath),
		formatAgentLabConsolidationResult,
		agentLabReportConsolidationStatus: (pathOrLatest) =>
			getAgentLabConsolidationStatus(pathOrLatest, reportsPath),
		formatAgentLabConsolidationStatus,
		createTask: (kind, details) =>
			createCliTask(kind, details, {
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
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
		listTasks: () => structuredTaskQueue.listTasks(),
		queueClearStructured: () => structuredTaskQueue.clearPersisted(),
		queueApprove: (id) => approveStructuredTaskById(structuredTaskQueue, id),
		queueReject: (id) => rejectStructuredTaskById(structuredTaskQueue, id),
		activeProfileId: () => agentRouter.activeProfile().id,
	};
}

export function normalizeCliArgs(args: string[]): string[] {
	return args[0] === "--" ? args.slice(1) : args;
}

function recordCliUsage(
	runtime: CliRuntime,
	action: string,
	fields: {
		risk?: string;
		recommendation?: string;
		allowedToProceed?: boolean;
		requiresHuman?: boolean;
		durationMs?: number;
		ok?: boolean;
	} = {},
): void {
	recordIduUsageEventDeferred(runtime.workspaceRoot, {
		projectId: runtime.projectId,
		surface: "cli",
		action,
		active: getIduSessionStatus(runtime.projectId).active,
		...fields,
	});
}

export async function runCliCommand(
	args: string[],
	runtime?: CliRuntime,
): Promise<CliResult> {
	applyPackageEnvDefaults();
	const normalizedArgs = normalizeCliArgs(args);
	const [command, ...rest] = normalizedArgs;
	try {
		if (command === "help" || command === "--help" || command === "-h") {
			return ok(helpText());
		}
		if (command === undefined || command === "home") {
			return ok(
				formatCliHome(
					buildCliHomeStatus({
						argvPath: process.argv[1],
						stdinInteractive: Boolean(process.stdin.isTTY),
					}),
				),
			);
		}
		if (command === "comandos") return ok(formatCommandCatalog());
		if (command === "install" || command === "init") {
			return ok(
				rest.length ? handleSetupCommand(rest) : handleSetupCommand(["wizard"]),
			);
		}
		if (command === "setup") {
			return ok(handleSetupCommand(rest));
		}
		if (command === "project") return ok(handleProjectCommand(rest));
		if (command === "idu" && !runtime) {
			return ok(await runBootstrapIduCommand());
		}
		const activeRuntime =
			runtime ??
			createCliRuntime({
				createRegistryIfMissing: command !== "status",
			});
		configureIduSessionStore(
			activeRuntime.sessionStatePath
				? {
						workspaceRoot: activeRuntime.workspaceRoot,
						filePath: activeRuntime.sessionStatePath,
					}
				: { workspaceRoot: activeRuntime.workspaceRoot },
		);
		const naturalMasterPlanDecision = normalizedArgs.join(" ").trim();
		if (naturalMasterPlanDecision && activeRuntime.masterPlanNaturalDecision) {
			const decision = activeRuntime.masterPlanNaturalDecision(
				naturalMasterPlanDecision,
			);
			if (decision.handled && activeRuntime.formatMasterPlanOperation) {
				return decision.action === "interactive"
					? ok(
							activeRuntime.formatMasterPlanReview?.(decision.review) ??
								decision.review.markdown,
						)
					: ok(activeRuntime.formatMasterPlanOperation(decision.result));
			}
		}
		switch (command) {
			case "status":
				return ok(
					activeRuntime.formatConnection(activeRuntime.inspectConnection()),
				);
			case "idu": {
				activateIduSession(activeRuntime.projectId);
				activeRuntime.supervisorOnIduActivation();
				recordCliUsage(activeRuntime, command, { ok: true });
				return ok(
					[
						"Guardrails automáticos activados para el proyecto activo.",
						"",
						activeRuntime.formatDashboard(activeRuntime.inspectConnection()),
					].join("\n"),
				);
			}
			case "idu-off": {
				const status = deactivateIduSession(activeRuntime.projectId);
				recordCliUsage(activeRuntime, command, { ok: true });
				return ok(formatIduSessionStatus(status));
			}
			case "idu-status": {
				const status = getIduSessionStatus(activeRuntime.projectId);
				recordCliUsage(activeRuntime, command, { ok: true });
				return ok(formatIduSessionStatus(status));
			}
			case "idu-prepare":
			case "prepare": {
				const result = activeRuntime.prepare();
				recordCliUsage(activeRuntime, command, { ok: true });
				return ok(activeRuntime.formatPrepare(result));
			}
			case "idu-project-reset-state":
			case "project-reset-state":
				return ok(
					activeRuntime.formatProjectStateResetResult(
						activeRuntime.projectStateReset(rest.includes("--yes")),
					),
				);
			case "idu-master-plan-status":
			case "master-plan-status":
				if (
					!activeRuntime.masterPlanStatus ||
					!activeRuntime.formatMasterPlanStatus
				)
					return fail("Master Plan no disponible en este runtime.");
				return ok(
					activeRuntime.formatMasterPlanStatus(
						activeRuntime.masterPlanStatus(),
					),
				);
			case "idu-master-plan-review":
			case "master-plan-review":
				if (
					!activeRuntime.masterPlanReview ||
					!activeRuntime.formatMasterPlanReview
				)
					return fail("Master Plan no disponible en este runtime.");
				return ok(
					activeRuntime.formatMasterPlanReview(
						activeRuntime.masterPlanReview(rest.join(" ").trim() || "latest"),
					),
				);
			case "idu-master-plan-approve":
			case "master-plan-approve":
				if (
					!activeRuntime.masterPlanApprove ||
					!activeRuntime.formatMasterPlanOperation
				)
					return fail("Master Plan no disponible en este runtime.");
				return ok(
					activeRuntime.formatMasterPlanOperation(
						activeRuntime.masterPlanApprove(rest.join(" ").trim() || "latest"),
					),
				);
			case "idu-master-plan-reject":
			case "master-plan-reject": {
				if (
					!activeRuntime.masterPlanReject ||
					!activeRuntime.formatMasterPlanOperation
				)
					return fail("Master Plan no disponible en este runtime.");
				const pathOrLatest = rest[0] ?? "latest";
				const reason = rest.slice(1).join(" ").trim() || undefined;
				return ok(
					activeRuntime.formatMasterPlanOperation(
						activeRuntime.masterPlanReject(pathOrLatest, reason),
					),
				);
			}
			case "idu-master-plan-redraft":
			case "master-plan-redraft": {
				if (
					!activeRuntime.masterPlanRedraft ||
					!activeRuntime.formatMasterPlanOperation
				)
					return fail("Master Plan no disponible en este runtime.");
				const reasonParts = rest[0] === "latest" ? rest.slice(1) : rest;
				return ok(
					activeRuntime.formatMasterPlanOperation(
						activeRuntime.masterPlanRedraft(
							reasonParts.join(" ").trim() || undefined,
						),
					),
				);
			}
			case "idu-source-status":
			case "source-status":
				return ok(
					activeRuntime.formatSourceLibraryStatus(
						activeRuntime.sourceLibraryStatus(),
					),
				);
			case "idu-source-add":
			case "source-add":
				return ok(
					activeRuntime.formatSourceLibraryAddResult(
						activeRuntime.sourceLibraryAdd(requiredText(rest)),
					),
				);
			case "idu-source-remove":
			case "source-remove":
				return ok(
					activeRuntime.formatSourceLibraryRemoveResult(
						activeRuntime.sourceLibraryRemove(requiredText(rest)),
					),
				);
			case "idu-source-read":
			case "source-read":
				return ok(
					activeRuntime.formatSourceLibraryReadResult(
						activeRuntime.sourceLibraryRead(requiredText(rest)),
					),
				);
			case "idu-source-extract":
			case "source-extract":
				return ok(
					activeRuntime.formatSourceLibraryExtractResult(
						activeRuntime.sourceLibraryExtract(requiredText(rest)),
					),
				);
			case "idu-source-report":
			case "source-report":
				return ok(
					activeRuntime.formatSourceLibraryItemReport(
						activeRuntime.sourceLibraryReport(requiredText(rest)),
					),
				);
			case "idu-source-research":
			case "source-research":
				return ok(
					activeRuntime.formatSourceResearchReport(
						activeRuntime.sourceLibraryResearch(requiredText(rest)),
					),
				);
			case "idu-source-digest":
			case "source-digest":
				return ok(
					activeRuntime.formatSourceDigest(
						activeRuntime.sourceDigest(requiredText(rest)),
					),
				);
			case "idu-source-digest-status":
			case "source-digest-status":
				return ok(
					activeRuntime.formatSourceDigestStatus(
						activeRuntime.sourceDigestStatus(),
					),
				);
			case "idu-source-chunk-read":
			case "source-chunk-read":
				return ok(
					activeRuntime.formatSourceChunkRead(
						activeRuntime.sourceChunkRead(
							requiredArg(rest, 0, "sourceId"),
							requiredArg(rest, 1, "chunkId"),
						),
					),
				);
			case "idu-source-recommend":
			case "source-recommend":
				return ok(
					activeRuntime.formatSourceRecommendationReport(
						activeRuntime.sourceRecommend(requiredText(rest)),
					),
				);
			case "idu-source-required-actions":
			case "source-required-actions":
				return ok(
					activeRuntime.formatSourceRequiredActionsReport(
						activeRuntime.sourceRequiredActions(),
					),
				);
			case "idu-source-refresh":
			case "source-refresh":
				return ok(
					activeRuntime.formatSourceLibraryRefreshResult(
						activeRuntime.sourceLibraryRefresh(),
					),
				);
			case "idu-preflight":
			case "preflight": {
				const report = activeRuntime.preflight(requiredText(rest));
				recordCliUsage(activeRuntime, command, {
					risk: report.risk,
					recommendation: report.recommendedNext,
					allowedToProceed: report.okToProceed,
					requiresHuman: report.requiresHumanConfirmation,
					ok: report.okToProceed,
				});
				return ok(activeRuntime.formatPreflight(report));
			}
			case "idu-advisory":
			case "advisory": {
				const advisory = activeRuntime.advisory(requiredText(rest));
				recordCliUsage(activeRuntime, command, {
					recommendation: advisory.recommendation,
					requiresHuman: advisory.requiresHumanConfirmation,
					allowedToProceed: advisory.okToProceed,
					ok: advisory.okToProceed,
				});
				return ok(activeRuntime.formatAdvisory(advisory));
			}
			case "idu-postflight":
			case "postflight": {
				const report = activeRuntime.postflight();
				recordCliUsage(activeRuntime, command, {
					risk: report.risk,
					recommendation: report.recommendedNext,
					requiresHuman: report.requiresHumanConfirmation,
					ok: !report.requiresHumanConfirmation,
				});
				return ok(activeRuntime.formatPostflight(report));
			}
			case "idu-usage-status":
			case "usage-status":
				await flushIduUsageEvents();
				return ok(
					formatIduUsageSummary(
						summarizeIduUsageEvents(
							readIduUsageEvents(activeRuntime.workspaceRoot),
						),
					),
				);
			case "idu-lab-review-plan":
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
			case "idu-review":
			case "review":
			case "revisar":
				return ok(await runMasterPlanDeepReview(activeRuntime, "simple"));
			case "idu-agentlab-request-create":
			case "agentlab-request-create": {
				const source = rest[0] ?? "postflight";
				const selector = rest.slice(1).join(" ").trim() || "latest";
				return ok(
					activeRuntime.formatAgentLabReviewRequestPlan(
						activeRuntime.agentLabRequestCreate(source, selector),
					),
				);
			}
			case "idu-agentlab-request-review":
			case "agentlab-request-review":
				return ok(
					activeRuntime.formatAgentLabReviewRequestReview(
						activeRuntime.agentLabRequestReview(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-agentlab-review-run":
			case "agentlab-review-run":
				return ok(
					activeRuntime.formatAgentLabReviewRunResult(
						await activeRuntime.agentLabReviewRun(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-agentlab-review-status":
			case "agentlab-review-status":
				return ok(
					activeRuntime.formatAgentLabReviewStatus(
						activeRuntime.agentLabReviewStatus(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-agentlab-report-consolidate":
			case "agentlab-report-consolidate":
				return ok(
					activeRuntime.formatAgentLabConsolidationResult(
						activeRuntime.agentLabReportConsolidate(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-agentlab-report-consolidation-status":
			case "agentlab-report-consolidation-status":
				return ok(
					activeRuntime.formatAgentLabConsolidationStatus(
						activeRuntime.agentLabReportConsolidationStatus(
							rest.join(" ").trim() || "latest",
						),
					),
				);
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
			case "idu-supervisor-improvements-status":
			case "supervisor-improvements-status":
				return ok(
					activeRuntime.formatSupervisorImprovementStatus(
						activeRuntime.supervisorImprovementStatus(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-supervisor-improvements-approve":
			case "supervisor-improvements-approve": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSupervisorImprovementDecisionResult(
						activeRuntime.supervisorImprovementApprove(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-supervisor-improvements-reject":
			case "supervisor-improvements-reject": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSupervisorImprovementDecisionResult(
						activeRuntime.supervisorImprovementReject(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-supervisor-improvements-defer":
			case "supervisor-improvements-defer": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSupervisorImprovementDecisionResult(
						activeRuntime.supervisorImprovementDefer(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-supervisor-improvements-apply":
			case "supervisor-improvements-apply":
				return ok(
					activeRuntime.formatSupervisorLearningRulesApplyResult(
						activeRuntime.supervisorImprovementsApply(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-supervisor-learning-rules-status":
			case "supervisor-learning-rules-status":
				return ok(
					activeRuntime.formatSupervisorLearningRulesStatus(
						activeRuntime.supervisorLearningRulesStatus(),
					),
				);
			case "idu-supervisor-learning-rules-test":
			case "supervisor-learning-rules-test":
				return ok(
					activeRuntime.formatSupervisorLearningRulesTest(
						activeRuntime.supervisorLearningRulesTest(),
					),
				);
			case "idu-supervisor-learning-rules-disable":
			case "supervisor-learning-rules-disable": {
				const decision = requiredRuleDecisionParts(rest);
				return ok(
					activeRuntime.formatSupervisorLearningRuleDecision(
						activeRuntime.supervisorLearningRulesDisable(
							decision.ruleId,
							decision.reason,
						),
					),
				);
			}
			case "idu-supervisor-learning-rules-enable":
			case "supervisor-learning-rules-enable": {
				const decision = requiredRuleDecisionParts(rest);
				return ok(
					activeRuntime.formatSupervisorLearningRuleDecision(
						activeRuntime.supervisorLearningRulesEnable(
							decision.ruleId,
							decision.reason,
						),
					),
				);
			}
			case "idu-supervisor-learning-rules-rollback":
			case "supervisor-learning-rules-rollback":
				return ok(
					activeRuntime.formatSupervisorLearningRulesRollback(
						activeRuntime.supervisorLearningRulesRollback(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-skill-improvements-review":
			case "skill-improvements-review":
				return ok(
					activeRuntime.formatSkillImprovementPlan(
						activeRuntime.skillImprovementPlan(requiredText(rest)),
					),
				);
			case "idu-skill-improvements-create":
			case "skill-improvements-create":
				return ok(
					activeRuntime.formatSkillImprovementCreationResult(
						activeRuntime.skillImprovementCreate(requiredText(rest)),
					),
				);
			case "idu-skill-improvements-status":
			case "skill-improvements-status":
				return ok(
					activeRuntime.formatSkillImprovementStatus(
						activeRuntime.skillImprovementStatus(
							rest.join(" ").trim() || "latest",
						),
					),
				);
			case "idu-skill-improvements-approve":
			case "skill-improvements-approve": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSkillImprovementDecisionResult(
						activeRuntime.skillImprovementApprove(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-skill-improvements-reject":
			case "skill-improvements-reject": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSkillImprovementDecisionResult(
						activeRuntime.skillImprovementReject(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-skill-improvements-defer":
			case "skill-improvements-defer": {
				const decision = requiredDecisionParts(rest);
				return ok(
					activeRuntime.formatSkillImprovementDecisionResult(
						activeRuntime.skillImprovementDefer(
							decision.pathOrLatest,
							decision.proposalIdOrAll,
							decision.reason,
						),
					),
				);
			}
			case "idu-skill-drafts-create":
			case "skill-drafts-create":
				return ok(
					activeRuntime.formatSkillDraftCreationResult(
						activeRuntime.skillDraftsCreate(rest.join(" ").trim() || "latest"),
					),
				);
			case "idu-skill-drafts-review":
			case "skill-drafts-review":
				return ok(
					activeRuntime.formatSkillDraftReview(
						activeRuntime.skillDraftReview(rest.join(" ").trim() || "latest"),
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

function emitIduProgress(event: MasterPlanProgressEvent): void {
	if (process.env.IDU_PI_PROGRESS !== "1") return;
	process.stderr.write(`__IDU_PROGRESS__${JSON.stringify(event)}\n`);
}

async function runBootstrapIduCommand(): Promise<string> {
	const config = loadConfig({ requireTelegram: false });
	process.env.AGENT_WORKSPACE_ROOT ??= config.agentWorkspaceRoot;
	const bootstrap = runIduBootstrap({
		projectPath: process.cwd(),
		config,
		registryPath: resolveIduRegistryPath(),
	});
	const activeRuntime = createCliRuntime({
		projectPath: bootstrap.project.path,
		requireTelegramConfig: false,
	});
	activeRuntime.supervisorOnIduActivation();
	let sawPlanProgress = false;
	const onProgress = (event: MasterPlanProgressEvent) => {
		sawPlanProgress = true;
		emitIduProgress(event);
	};
	const masterPlan = ensureMasterPlanForIdu({
		projectId: bootstrap.project.id,
		projectPath: bootstrap.project.path,
		stateRoot: bootstrap.statePaths.stateRoot,
		gitHead: bootstrap.currentGitHead,
		onProgress,
	});
	if (!sawPlanProgress) {
		emitIduProgress({
			stage: "scan",
			status: "ok",
			message: "Plan Maestro existente reutilizado; escaneo vigente",
		});
		emitIduProgress({
			stage: "reverse_engineering",
			status: "ok",
			message: "Ingeniería inversa vigente reutilizada",
		});
		emitIduProgress({
			stage: "forge_plan",
			status: "ok",
			message: "Plan Maestro vigente reutilizado",
		});
	}
	let reviewHandled = false;
	let displayMasterPlan = masterPlan;
	if (
		bootstrap.criticalDecisions.length === 0 &&
		masterPlan.plan?.autoDepth.mode === "deep_required"
	) {
		emitIduProgress({
			stage: "forge_plan",
			status: "running",
			message: "Ejecutando o reutilizando análisis profundo AgentLab",
		});
		await runOrReuseMasterPlanDeepReview(activeRuntime);
		reviewHandled = true;
		emitIduProgress({
			stage: "forge_plan",
			status: "ok",
			message: "Análisis profundo consolidado en el Plan Maestro",
		});
		displayMasterPlan = ensureMasterPlanForIdu({
			projectId: bootstrap.project.id,
			projectPath: bootstrap.project.path,
			stateRoot: bootstrap.statePaths.stateRoot,
			gitHead: bootstrap.currentGitHead,
			onProgress,
		});
	}
	const finalReport = formatIduSupervisorPlanReport({
		bootstrap,
		masterPlan: displayMasterPlan,
		reviewHandled,
	});
	const finalBlocked =
		/\[BLOCKED\]|No puedo cerrar el Plan Maestro todavía/u.test(finalReport);
	emitIduProgress({
		stage: "quarantine",
		status: finalBlocked ? "blocked" : "ok",
		message: finalBlocked
			? "Repo real protegido; faltan conexiones externas para cerrar el plan"
			: "Repo real protegido; reporte final listo",
	});
	recordIduUsageEventDeferred(bootstrap.statePaths.stateRoot, {
		projectId: bootstrap.project.id,
		surface: "cli",
		action: "idu",
		active: getIduSessionStatus(bootstrap.project.id).active,
		recommendation: finalBlocked ? "blocked" : "ready",
		allowedToProceed: !finalBlocked,
		requiresHuman: finalBlocked,
		ok: !finalBlocked,
	});
	return finalReport;
}

function handleSetupCommand(rest: string[]): string {
	const subcommand = rest[0] ?? "status";
	const agentDir = resolvePiAgentDir();
	const packageRoot = resolveCliPackageRoot();
	const mcpServerPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"mcp-server.js",
	);
	const extensionSourcePath = join(
		packageRoot,
		".pi",
		"extensions",
		"idu-pi-commands.ts",
	);
	if (subcommand === "status") {
		const mcpInstalled = existsSync(join(agentDir, "mcp.json"));
		return formatIduSetupStatus({
			system: detectSystem(),
			tools: detectTools(),
			agentConfigs: detectAgentConfigs(),
			mcpInstalled,
		});
	}
	if (subcommand === "wizard") {
		return formatSetupWizardNonInteractive(
			buildCliHomeStatus({
				argvPath: process.argv[1],
				stdinInteractive: false,
			}),
		);
	}
	if (subcommand === "path-help") {
		return formatSetupPathHelp();
	}
	if (subcommand === "mcp-print") {
		return printIduMcpConfig({ mcpServerPath });
	}
	if (subcommand === "mcp-init") {
		const force = rest.includes("--force");
		const dryRun = rest.includes("--dry-run");
		const result = installIduMcpConfig({
			agentDir,
			mcpServerPath,
			extensionSourcePath,
			force,
			dryRun,
		});
		return formatInstallIduMcpConfigResult(result);
	}
	throw new Error(
		"Uso: idu-pi setup [status|wizard|path-help|mcp-init|mcp-print] [--force] [--dry-run]",
	);
}

function handleProjectCommand(rest: string[]): string {
	const subcommand = rest[0];
	const config = loadConfig({ requireTelegram: false });
	const registryPath = resolveIduRegistryPath();
	if (subcommand === "enroll") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project enroll <projectPath> [projectId]");
		return formatProjectEnrollResult(
			projectEnroll({
				projectPath,
				projectId: rest[2],
				workspaceRoot: config.agentWorkspaceRoot,
				allowedRoots: config.allowedRoots,
				registryPath,
			}),
		);
	}
	if (subcommand === "status") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project status <projectPath>");
		return formatProjectInstallStatus(
			projectInstallStatus({
				projectPath,
				workspaceRoot: config.agentWorkspaceRoot,
				allowedRoots: config.allowedRoots,
				mcpAvailable: existsSync(join(resolvePiAgentDir(), "mcp.json")),
				registryPath,
			}),
		);
	}
	if (subcommand === "state-path") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project state-path <projectPath>");
		const status = projectInstallStatus({
			projectPath,
			workspaceRoot: config.agentWorkspaceRoot,
			allowedRoots: config.allowedRoots,
			registryPath,
		});
		return formatProjectStatePaths(
			resolveProjectStatePaths({
				workspaceRoot: config.agentWorkspaceRoot,
				projectId: status.projectId,
				projectPath: status.projectPath,
			}),
		);
	}
	throw new Error(
		"Uso: idu-pi project [enroll|status|state-path] <projectPath> [projectId]",
	);
}

function inspectConnection(context: RuntimeContext): ProjectConnectionReport {
	return inspectProjectConnection({
		registry: context.registry,
		defaultCwd: context.config.defaultCwd,
		allowedRoots: context.config.allowedRoots,
		workspaceRoot: context.runtimeWorkspaceRoot,
		projectId: context.activeProject.id,
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

function runPrepare(context: RuntimeContext): IduPrepareResult {
	const reportsPath = context.reportsPath;
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
		.replace(/^\/idu_prepare\b/u, "idu-pi idu-prepare")
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

function requiredArg(parts: string[], index: number, name: string): string {
	const value = parts[index]?.trim();
	if (!value) throw new Error(`Falta ${name}.`);
	return value;
}

function requiredDecisionParts(parts: string[]): {
	pathOrLatest: string;
	proposalIdOrAll: string;
	reason?: string;
} {
	const [pathOrLatest = "", proposalIdOrAll = "", ...reasonParts] = parts;
	if (!pathOrLatest.trim() || !proposalIdOrAll.trim()) {
		throw new Error(
			"Uso: supervisor-improvements-approve latest <proposalId|all> [motivo]",
		);
	}
	const reason = reasonParts.join(" ").trim();
	return {
		pathOrLatest,
		proposalIdOrAll,
		...(reason ? { reason } : {}),
	};
}

function requiredRuleDecisionParts(parts: string[]): {
	ruleId: string;
	reason?: string;
} {
	const [ruleId = "", ...reasonParts] = parts;
	if (!ruleId.trim()) {
		throw new Error("Uso: supervisor-learning-rules-disable <ruleId> [motivo]");
	}
	const reason = reasonParts.join(" ").trim();
	return { ruleId, ...(reason ? { reason } : {}) };
}

function ok(stdout: string): CliResult {
	return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): CliResult {
	return { exitCode: 1, stdout: helpText(), stderr };
}

async function runMasterPlanDeepReview(
	runtime: CliRuntime,
	mode: "simple" | "advanced",
	selector = "latest",
): Promise<string> {
	const plan = runtime.agentLabRequestCreate("master-plan", selector);
	if (plan.errors.length > 0)
		return runtime.formatAgentLabReviewRequestPlan(plan);
	const run = await runtime.agentLabReviewRun("latest");
	recordMasterPlanLabReviewDone({
		stateRoot: runtime.workspaceRoot,
		run,
	});
	if (mode === "simple") {
		return [
			"Revisión del supervisor",
			"",
			`Requests: ${plan.requests.length}`,
			"Deep review: ejecutado en sandbox/clone.",
			"Repo real: sin modificar.",
			"",
			runtime.formatAgentLabReviewRunResult(run),
		].join("\n");
	}
	return [
		runtime.formatAgentLabReviewRequestPlan(plan),
		"",
		"Deep review ejecutado automáticamente desde Plan Maestro:",
		"",
		runtime.formatAgentLabReviewRunResult(run),
	].join("\n");
}

async function runOrReuseMasterPlanDeepReview(
	runtime: CliRuntime,
): Promise<string> {
	const status = runtime.agentLabReviewStatus("latest");
	if (status.valid && status.result && status.result.runs.length > 0) {
		recordMasterPlanLabReviewDone({
			stateRoot: runtime.workspaceRoot,
			run: status.result,
		});
		return [
			"Revisión del supervisor",
			"",
			"Estado: ya existe deep review vigente; no lo repetí.",
			"",
			runtime.formatAgentLabReviewStatus(status),
		].join("\n");
	}
	return runMasterPlanDeepReview(runtime, "simple");
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
		"  idu-pi idu-prepare         (Telegram: /idu_prepare)",
		"  idu-pi idu-project-reset-state --yes  # borra estado aislado; no toca repo real",
		"  idu-pi idu-master-plan-status",
		"  idu-pi idu-master-plan-review latest",
		"  idu-pi idu-master-plan-approve latest",
		"  idu-pi idu-master-plan-reject latest [motivo]",
		"  idu-pi idu-master-plan-redraft latest",
		"  idu-pi idu-source-status",
		"  idu-pi idu-source-add <path.md|path.txt|path.pdf>",
		"  idu-pi idu-source-read <source-id>",
		"  idu-pi idu-source-extract <source-id>",
		"  idu-pi idu-source-report <source-id>",
		'  idu-pi idu-source-research "consulta"',
		"  idu-pi idu-source-digest <source-id>",
		"  idu-pi idu-source-digest-status",
		"  idu-pi idu-source-chunk-read <source-id> <chunk-id>",
		'  idu-pi idu-source-recommend "tarea"',
		"  idu-pi idu-source-required-actions",
		"  idu-pi idu-source-refresh",
		"  idu-pi idu-supervisor-tick (Telegram: /idu_supervisor_tick)",
		"  idu-pi idu-supervisor-improvements-review latest",
		"  idu-pi idu-supervisor-improvements-create latest",
		"  idu-pi idu-supervisor-improvements-status latest",
		"  idu-pi idu-supervisor-improvements-approve latest <proposalId|all>",
		"  idu-pi idu-supervisor-improvements-reject latest <proposalId|all> [motivo]",
		"  idu-pi idu-supervisor-improvements-defer latest <proposalId|all> [motivo]",
		"  idu-pi idu-supervisor-learning-rules-status",
		"  idu-pi idu-supervisor-learning-rules-test",
		"  idu-pi idu-supervisor-learning-rules-disable <ruleId> [motivo]",
		"  idu-pi idu-supervisor-learning-rules-enable <ruleId> [motivo]",
		"  idu-pi idu-supervisor-learning-rules-rollback latest",
		"  idu-pi idu-skill-improvements-review latest",
		"  idu-pi idu-skill-improvements-create latest",
		"  idu-pi idu-skill-improvements-status latest",
		"  idu-pi idu-skill-improvements-approve latest <proposalId|all>",
		"  idu-pi idu-skill-improvements-reject latest <proposalId|all> [motivo]",
		"  idu-pi idu-skill-improvements-defer latest <proposalId|all> [motivo]",
		"  idu-pi idu-skill-drafts-create latest",
		"  idu-pi idu-skill-drafts-review latest",
		'  idu-pi idu-preflight "solicitud"',
		'  idu-pi idu-advisory "solicitud"',
		"  idu-pi idu-postflight",
		"  idu-pi idu-usage-status",
		"  idu-pi idu-lab-review-plan postflight",
		"  idu-pi revisar",
		"  idu-pi idu-agentlab-request-create postflight",
		"  idu-pi idu-agentlab-request-create master-plan latest  # crea solicitud; no ejecuta labs",
		"  idu-pi idu-agentlab-request-create skill-draft latest",
		"  idu-pi idu-agentlab-request-review latest",
		"  idu-pi idu-agentlab-review-run latest  # ejecuta AgentLab review-only en clone/sandbox",
		"  idu-pi idu-agentlab-review-status latest",
		"  idu-pi idu-agentlab-report-consolidate latest",
		"  idu-pi idu-agentlab-report-consolidation-status latest",
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
		"- No ejecuta AgentLabs salvo el comando explícito idu-agentlab-review-run, que corre review-only en clone/sandbox.",
		"- Las mejoras del supervisor son propuestas de revisión; no aplican reglas ni skills.",
	].join("\n");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const normalizedArgs = normalizeCliArgs(args);
	if (shouldRunInteractiveHome(normalizedArgs)) {
		const output = await runInteractiveHome();
		if (output) console.log(output);
		return;
	}
	const result = await runCliCommand(args);
	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	process.exit(result.exitCode);
}

function shouldRunInteractiveHome(args: string[]): boolean {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
	const [command, subcommand] = args;
	return (
		command === undefined ||
		command === "home" ||
		((command === "setup" || command === "install" || command === "init") &&
			subcommand === "wizard") ||
		((command === "install" || command === "init") && subcommand === undefined)
	);
}

type CliQuestion = (message: string) => Promise<string>;
type CliPrint = (message: string) => void;
type CliHomeActionOptions = {
	bridgeLauncher?: (action: BridgeLifecycleAction, root: string) => void;
};

type MenuOption = { label: string; value: string };

const ANSI_RESET = "\x1b[0m";
const ANSI_HOME = "\x1b[H";
const ANSI_CLEAR_TO_END = "\x1b[J";
const ANSI_ALT_SCREEN_ON = "\x1b[?1049h";
const ANSI_ALT_SCREEN_OFF = "\x1b[?1049l";
const ANSI_HIDE_CURSOR = "\x1b[?25l";
const ANSI_SHOW_CURSOR = "\x1b[?25h";
const ANSI_WHITE_BG = "\x1b[47m";
const ANSI_DARK_PURPLE = "\x1b[35m";
const ANSI_DIM = "\x1b[2m";
const ANSI_PANEL_WIDTH = 72;

export async function runInteractiveHome(): Promise<string> {
	while (true) {
		const status = buildCliHomeStatus({
			argvPath: process.argv[1],
			stdinInteractive: true,
		});
		const choice = await selectMenu("", mainMenuOptions(), status);
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "config") {
			const result = await runInstallationMenuTui();
			if (result === "__back") continue;
			return result;
		}
		if (choice === "project") {
			const result = await showTextView(
				"Proyecto actual",
				formatCliProjectStatus(status),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		if (choice === "telegram") {
			const result = await runTelegramRemoteMenuTui(status);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "models") {
			const result = await runModelProfilesMenuTui(status);
			if (result === "__back") continue;
			return result;
		}
		if (choice === "supervisor") {
			const result = await showTextView(
				"Supervisor",
				formatSupervisorStatus(status),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		if (choice === "tasks") {
			const result = await showTextView(
				"Tareas y cola",
				formatTaskQueueStatus(),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		if (choice === "diagnostics") {
			const result = await showTextView(
				"Diagnóstico",
				formatDiagnosticsStatus(status),
			);
			if (result === "back") continue;
			return "Salida sin cambios.";
		}
		return "Salida sin cambios.";
	}
}

function mainMenuOptions(): MenuOption[] {
	return [
		{ label: "Configurar IDU-Pi", value: "config" },
		{ label: "Proyecto actual", value: "project" },
		{ label: "Telegram remoto", value: "telegram" },
		{ label: "Modelos y perfiles", value: "models" },
		{ label: "Supervisor", value: "supervisor" },
		{ label: "Tareas y cola", value: "tasks" },
		{ label: "Diagnóstico", value: "diagnostics" },
		{ label: "Exit", value: "exit" },
	];
}

function installationMenuOptions(): MenuOption[] {
	return [
		{ label: "Verificar sistema", value: "1" },
		{ label: "Instalar/actualizar MCP en Pi", value: "2" },
		{ label: "Instalar/actualizar comandos slash globales", value: "3" },
		{ label: "Enrolar proyecto actual", value: "4" },
		{ label: "Activar supervisor en este proyecto", value: "5" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

async function runInstallationMenuTui(): Promise<string> {
	const choice = await selectMenu(
		"Configurar IDU-Pi",
		installationMenuOptions(),
	);
	if (choice === "back") return "__back";
	if (choice === "exit") return "Salida sin cambios.";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const result = await handleInstallationChoice(choice, (message: string) =>
			rl.question(message),
		);
		await showTextView("Resultado", result);
		return "__back";
	} finally {
		rl.close();
	}
}

function telegramRemoteMenuOptions(): MenuOption[] {
	return [
		{ label: "Ver estado remoto", value: "status" },
		{ label: "Configurar acceso remoto", value: "configure" },
		{ label: "Sincronizar comandos remotos", value: "sync" },
		{ label: "Iniciar puente remoto", value: "run" },
		{ label: "Detener puente remoto", value: "off" },
		{ label: "Reiniciar puente remoto", value: "restart" },
		{ label: "Ver logs", value: "logs" },
		{ label: "Save", value: "save" },
		{ label: "Descartar", value: "discard" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

async function runTelegramRemoteMenuTui(
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	while (true) {
		const choice = await selectMenu(
			"Telegram remoto",
			telegramRemoteMenuOptions(),
			undefined,
			formatTelegramRemoteStatus(status),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			const result = await handleTelegramRemoteChoice(
				choice,
				(message: string) => rl.question(message),
				status,
				options,
			);
			await showTextView("Telegram remoto", result);
		} finally {
			rl.close();
		}
	}
}

function modelProfilesMenuOptions(): MenuOption[] {
	return [
		{ label: "Asignar modelo por rol", value: "assign" },
		{ label: "Ver asignaciones actuales", value: "status" },
		{ label: "Propuesta automática por AgentLab", value: "proposal" },
		{ label: "Validar configuración", value: "validate" },
		{ label: "Avanzado: editar PI_AGENT_PROFILES", value: "edit" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}

async function runModelProfilesMenuTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	while (true) {
		const choice = await selectMenu(
			"Modelos Idu-pi",
			modelProfilesMenuOptions(),
			undefined,
			formatModelProfilesStatus(status),
		);
		if (choice === "back") return "__back";
		if (choice === "exit") return "Salida sin cambios.";
		if (choice === "status") {
			const result = await showTextView(
				"Perfiles actuales",
				formatModelProfilesStatus(status),
			);
			if (result === "exit") return "Salida sin cambios.";
			continue;
		}
		let message: string;
		if (choice === "assign") {
			message = await assignModelRoleTui(status);
		} else if (choice === "edit") {
			message = await editAgentProfilesTui(status);
		} else {
			const rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				message = await handleModelProfilesChoice(
					choice,
					(prompt: string) => rl.question(prompt),
					status,
				);
			} finally {
				rl.close();
			}
		}
		const result = await showTextView("Modelos Idu-pi", message);
		if (result === "exit") return "Salida sin cambios.";
	}
}

async function selectMenu(
	title: string,
	options: MenuOption[],
	status?: ReturnType<typeof buildCliHomeStatus>,
	content?: string,
): Promise<string> {
	return selectSearchableMenu(title, options, {
		status,
		content,
		search: false,
	});
}

async function selectSearchableMenu(
	title: string,
	options: MenuOption[],
	settings: {
		status?: ReturnType<typeof buildCliHomeStatus>;
		content?: string;
		search?: boolean;
		help?: string;
	} = {},
): Promise<string> {
	let selected = 0;
	let query = "";
	emitKeypressEvents(process.stdin);
	const rawMode = process.stdin.isTTY;
	if (rawMode) process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdout.write(`${ANSI_ALT_SCREEN_ON}${ANSI_HIDE_CURSOR}`);
	const filteredOptions = () => {
		if (!settings.search || !query.trim()) return options;
		const normalized = query.trim().toLowerCase();
		return options.filter((option) =>
			`${option.label}\n${option.value}`.toLowerCase().includes(normalized),
		);
	};
	const render = () => {
		const width = ANSI_PANEL_WIDTH;
		const visible = filteredOptions();
		selected = Math.min(selected, Math.max(0, visible.length - 1));
		const pageTitle = title || "Menú principal";
		const contentRows = settings.content
			? [
					midBorder(width),
					...contentLines(settings.content, width).map((line) =>
						panelLine(line, width),
					),
				]
			: [];
		const searchRows = settings.search
			? [
					panelLine(
						`buscar: ${query || "(escribí para filtrar)"}`,
						width,
						ANSI_DIM,
					),
				]
			: [];
		const header = [
			...(settings.status
				? [formatIduLogo(), "", `version: ${settings.status.version}`, ""]
				: []),
			topBorder(pageTitle, width),
			panelLine(
				settings.help ??
					(settings.search
						? "↑/↓ navegar · escribir filtra · Enter elegir · Esc volver/salir"
						: "↑/↓ navegar · Enter elegir · Esc/q salir"),
				width,
				ANSI_DIM,
			),
			...searchRows,
			...contentRows,
			midBorder(width),
		].join("\n");
		const rows = visible.length
			? visible
					.map((option, index) => {
						const label = option.label.padEnd(width - 4, " ");
						return index === selected
							? `${ANSI_DARK_PURPLE}│${ANSI_RESET} ${ANSI_WHITE_BG}${ANSI_DARK_PURPLE}❯ ${label}${ANSI_RESET} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`
							: `${ANSI_DARK_PURPLE}│${ANSI_RESET}   ${label} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`;
					})
					.join("\n")
			: panelLine("Sin resultados", width, ANSI_DIM);
		const footer = bottomBorder(width);
		process.stdout.write(
			`${ANSI_HOME}${header}\n${rows}\n${footer}${ANSI_CLEAR_TO_END}`,
		);
	};
	try {
		render();
		return await new Promise<string>((resolve) => {
			const onKeypress = (chunk: string, key: { name?: string }) => {
				const visible = filteredOptions();
				if (key.name === "up") {
					if (visible.length)
						selected = (selected - 1 + visible.length) % visible.length;
					render();
					return;
				}
				if (key.name === "down") {
					if (visible.length) selected = (selected + 1) % visible.length;
					render();
					return;
				}
				if (settings.search && key.name === "backspace") {
					query = query.slice(0, -1);
					selected = 0;
					render();
					return;
				}
				if (key.name === "return") {
					if (visible.length)
						resolve(visible[selected]?.value ?? visible[0].value);
					return;
				}
				if (key.name === "escape" || (!settings.search && key.name === "q"))
					resolve("exit");
				if (
					settings.search &&
					chunk.length === 1 &&
					chunk.charCodeAt(0) >= 32
				) {
					query += chunk;
					selected = 0;
					render();
				}
			};
			process.stdin.on("keypress", onKeypress);
		}).finally(() => process.stdin.removeAllListeners("keypress"));
	} finally {
		if (rawMode) process.stdin.setRawMode(false);
		process.stdout.write(`${ANSI_SHOW_CURSOR}${ANSI_ALT_SCREEN_OFF}`);
	}
}

async function showTextView(
	title: string,
	content: string,
): Promise<"back" | "exit"> {
	const choice = await selectMenu(
		title,
		[
			{ label: "← Volver", value: "back" },
			{ label: "Exit", value: "exit" },
		],
		undefined,
		content,
	);
	return choice === "back" ? "back" : "exit";
}

function topBorder(title: string, width: number): string {
	const safeTitle = ` ${title} `;
	const right = Math.max(width - safeTitle.length - 1, 1);
	return `${ANSI_DARK_PURPLE}╭─${safeTitle}${"─".repeat(right)}╮${ANSI_RESET}`;
}

function midBorder(width: number): string {
	return `${ANSI_DARK_PURPLE}├${"─".repeat(width)}┤${ANSI_RESET}`;
}

function bottomBorder(width: number): string {
	return `${ANSI_DARK_PURPLE}╰${"─".repeat(width)}╯${ANSI_RESET}`;
}

function panelLine(text: string, width: number, color = ""): string {
	const clean = text.replace(/\r/gu, "");
	const clipped =
		clean.length > width - 4 ? `${clean.slice(0, width - 5)}…` : clean;
	const padded = clipped.padEnd(width - 2, " ");
	return `${ANSI_DARK_PURPLE}│${ANSI_RESET} ${color}${padded}${ANSI_RESET} ${ANSI_DARK_PURPLE}│${ANSI_RESET}`;
}

function contentLines(content: string, _width: number): string[] {
	return content.replace(/\r/gu, "").split("\n");
}

export async function runInteractiveHomeWithQuestion(
	question: CliQuestion,
	print: CliPrint = () => {},
	options: CliHomeActionOptions = {},
): Promise<string> {
	const status = buildCliHomeStatus({
		argvPath: process.argv[1],
		stdinInteractive: true,
	});
	print(formatMainMenu(status));
	const choice = (await question("\nElegí una opción [1-8]: ")).trim();
	if (choice === "8" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1") return runInstallationMenu(question, print);
	if (choice === "2") return formatCliProjectStatus(status);
	if (choice === "3")
		return runTelegramRemoteMenu(question, print, status, options);
	if (choice === "4") return runModelProfilesMenu(question, print, status);
	if (choice === "5") return formatSupervisorStatus(status);
	if (choice === "6") return formatTaskQueueStatus();
	if (choice === "7") return formatDiagnosticsStatus(status);
	return [
		"Opción no reconocida. No ejecuté acciones.",
		"Usá `idu-pi` o `idu-pi setup wizard`.",
	].join("\n");
}

async function handleModelProfilesChoice(
	choice: string,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	if (choice === "status") return formatModelProfilesStatus(status);
	if (choice === "edit") return editAgentProfiles(question, status);
	if (choice === "proposal")
		return proposeAgentLabModelAssignments(question, status);
	if (choice === "assign") return assignModelRole(question, status);
	if (choice === "validate") return validateAgentProfiles(status);
	return "Opción no reconocida. No ejecuté acciones.";
}

async function editAgentProfilesTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const choice = await selectMenu("Editar perfiles", [
		{ label: "Editar PI_AGENT_PROFILES", value: "edit" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	]);
	if (choice !== "edit") return "Cancelado sin cambios.";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await editAgentProfiles(
			(prompt: string) => rl.question(prompt),
			status,
		);
	} finally {
		rl.close();
	}
}

async function editAgentProfiles(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const raw = (
		await question("PI_AGENT_PROFILES (Enter vacío=volver, exit=salir): ")
	).trim();
	if (!raw || /^exit|salir|volver$/iu.test(raw))
		return "Cancelado sin cambios.";
	try {
		parseAgentProfiles(raw);
	} catch (error) {
		return `PI_AGENT_PROFILES inválido. No escribí .env.\n${error instanceof Error ? error.message : String(error)}`;
	}
	if (
		!(await confirmAction(
			question,
			"Guardar PI_AGENT_PROFILES en .env con backup?",
		))
	) {
		return "Cancelado sin cambios.";
	}
	const envPath = packageEnvPath(status.packageRoot);
	const result = writeEnvDraftWithBackup(envPath, readEnvDraft(envPath), {
		PI_AGENT_PROFILES: raw,
	});
	return [
		"Perfiles guardados en .env.",
		...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
	].join("\n");
}

async function proposeAgentLabModelAssignments(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de proponer modelos por AgentLab.";
	const current = loadModelAssignments(stateRoot);
	const proposal = recommendAgentLabModelAssignments(
		status.agentProfiles,
		current,
		{
			cwd: status.cwd,
		},
	);
	const proposalText = formatAgentLabModelAssignmentProposal(
		proposal,
		status.agentProfiles,
	);
	if (proposal.status === "blocked") {
		return [
			proposalText,
			"",
			"No guardé cambios: la propuesta no tiene diversidad suficiente. Usá 'Asignar modelos por rol' o editá perfiles/modelos primero.",
		].join("\n");
	}
	if (
		!(await confirmAction(
			question,
			`${proposalText}\n\n¿Guardar esta propuesta en model-assignments.json?`,
		))
	) {
		return [
			proposalText,
			"",
			"Cancelado sin cambios. Podés ajustar manualmente con 'Asignar modelos por rol'.",
		].join("\n");
	}
	try {
		const nextAssignments = { ...current.assignments };
		for (const recommendation of proposal.recommendations) {
			nextAssignments[recommendation.roleId] =
				recommendation.recommendedProfileId;
		}
		const saved = saveModelAssignments(
			stateRoot,
			nextAssignments,
			status.agentProfiles,
		);
		return [
			"Propuesta AgentLab aprobada y guardada por el usuario.",
			"Idu-pi no rotó modelos automáticamente; esta escritura ocurrió sólo tras confirmación.",
			"",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar propuesta.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

async function assignModelRoleTui(
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de asignar modelos por rol.";
	let roleId: string;
	let profileId: string;
	while (true) {
		const assignments = loadModelAssignments(stateRoot);
		roleId = await selectSearchableMenu(
			"Elegir rol Idu-pi",
			[
				...IDU_MODEL_ROLES.map((role) => ({
					label: `${role.label} (${role.id}) — ${assignments.assignments[role.id] ?? "inherit"}`,
					value: role.id,
				})),
				{ label: "← Volver", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content:
					"Seleccioná qué rol querés configurar. Idu-pi sólo guarda la asignación después de confirmar.",
			},
		);
		if (roleId === "exit" || roleId === "__back" || roleId === "__exit")
			return "Cancelado sin cambios.";
		profileId = await selectModelAssignmentTui(status, roleId);
		if (profileId === "__back") continue;
		if (profileId === "exit" || profileId === "__exit")
			return "Cancelado sin cambios.";
		break;
	}
	let finalProfileId = profileId;
	if (finalProfileId === "__custom_model__") {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			finalProfileId = (
				await rl.question("Custom model id (provider/model): ")
			).trim();
		} finally {
			rl.close();
		}
	}
	const confirmation = await selectMenu("Confirmar asignación", [
		{ label: `Guardar ${roleId} -> ${finalProfileId}`, value: "yes" },
		{ label: "Cancelar", value: "no" },
	]);
	if (confirmation !== "yes") return "Cancelado sin cambios.";
	try {
		const saved = saveModelAssignment(
			stateRoot,
			roleId,
			finalProfileId,
			status.agentProfiles,
		);
		return [
			"Asignación guardada.",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar asignación.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

async function selectModelAssignmentTui(
	status: ReturnType<typeof buildCliHomeStatus>,
	roleId: string,
): Promise<string> {
	const groups = modelAssignmentOptionGroups(status);
	while (true) {
		const choice = await selectSearchableMenu(
			"Elegir proveedor/modelo para el rol",
			[
				...groups.profiles.map((option) => ({
					label: option.label,
					value: option.value,
				})),
				...groups.providerGroups.map((group) => ({
					label: `[proveedor] ${group.label} — ${group.models.length} modelo${group.models.length === 1 ? "" : "s"}`,
					value: `__provider__:${group.key}`,
				})),
				...(groups.custom
					? [
							{
								label: `[avanzado] ${groups.custom.label}`,
								value: groups.custom.value,
							},
						]
					: []),
				{ label: "← Volver a roles", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content: [
					`Rol: ${roleId}`,
					"Modelos detectados en este entorno.",
					"Elegí un perfil, un proveedor/familia o la opción avanzada manual.",
				].join("\n"),
			},
		);
		if (!choice.startsWith("__provider__:")) return choice;
		const providerKey = choice.slice("__provider__:".length);
		const group = groups.providerGroups.find(
			(candidate) => candidate.key === providerKey,
		);
		if (!group) continue;
		const modelChoice = await selectSearchableMenu(
			`Elegir modelo — ${group.label}`,
			[
				...group.models.map((option) => ({
					label: option.label,
					value: option.value,
				})),
				{ label: "← Volver a proveedores", value: "__back" },
				{ label: "Exit", value: "__exit" },
			],
			{
				search: true,
				content: [
					`Rol: ${roleId}`,
					`${group.label}: ${group.models.length} modelo${group.models.length === 1 ? "" : "s"} detectado${group.models.length === 1 ? "" : "s"}.`,
					"Se guarda el identificador técnico exacto provider/model.",
				].join("\n"),
			},
		);
		if (modelChoice === "__back") continue;
		return modelChoice;
	}
}

async function promptModelAssignment(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string | undefined> {
	const groups = modelAssignmentOptionGroups(status);
	const providerOptions = groups.providerGroups.map((group) => ({
		value: `__provider__:${group.key}`,
		label: `[proveedor] ${group.label} — ${group.models.length} modelo${group.models.length === 1 ? "" : "s"}`,
	}));
	const firstStepOptions = [
		...groups.profiles.map((option) => ({
			value: option.value,
			label: option.label,
		})),
		...providerOptions,
		...(groups.custom
			? [
					{
						value: groups.custom.value,
						label: `[avanzado] ${groups.custom.label}`,
					},
				]
			: []),
	];
	const directOptions = modelAssignmentOptions(status);
	const firstStepText = firstStepOptions
		.map((option, index) => `${index + 1}. ${option.label}`)
		.join("\n");
	const answer = (
		await question(
			`Elegí perfil o proveedor/familia:\nModelos detectados en este entorno.\n${firstStepText}\nperfil/proveedor: `,
		)
	).trim();
	const directSelection = Number.isInteger(Number(answer))
		? undefined
		: resolveAssignmentSelection(answer, directOptions);
	if (directSelection) return directSelection;
	const firstSelection = resolveAssignmentSelection(answer, firstStepOptions);
	if (!firstSelection) return undefined;
	if (!firstSelection.startsWith("__provider__:")) return firstSelection;
	const providerKey = firstSelection.slice("__provider__:".length);
	const group = groups.providerGroups.find(
		(candidate) => candidate.key === providerKey,
	);
	if (!group) return undefined;
	const modelText = group.models
		.map((option, index) => `${index + 1}. ${option.label}`)
		.join("\n");
	const modelAnswer = (
		await question(`Elegí modelo de ${group.label}:\n${modelText}\nmodelo: `)
	).trim();
	return resolveAssignmentSelection(modelAnswer, group.models);
}

async function assignModelRole(
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	const stateRoot = status.project.stateRoot;
	if (!stateRoot)
		return "No hay stateRoot. Enrolá o bootstrappeá el proyecto antes de asignar modelos por rol.";
	const assignments = loadModelAssignments(stateRoot);
	const roleOptions = IDU_MODEL_ROLES.map(
		(role, index) =>
			`${index + 1}. ${role.label} (${role.id}) — ${assignments.assignments[role.id] ?? "inherit"}`,
	).join("\n");
	const roleAnswer = (
		await question(`Elegí rol por número o id:\n${roleOptions}\nrol: `)
	).trim();
	const roleId = resolveRoleSelection(roleAnswer);
	if (!roleId) return "Rol no reconocido. No escribí model-assignments.json.";
	let profileId = await promptModelAssignment(question, status);
	if (profileId === "__custom_model__") {
		profileId = (await question("Custom model id (provider/model): ")).trim();
	}
	if (!profileId)
		return "Perfil/modelo no reconocido. No escribí model-assignments.json.";
	try {
		if (
			!(await confirmAction(
				question,
				`Guardar asignación ${roleId} -> ${profileId} en model-assignments.json?`,
			))
		) {
			return "Cancelado sin cambios.";
		}
		const saved = saveModelAssignment(
			stateRoot,
			roleId,
			profileId,
			status.agentProfiles,
		);
		return [
			"Asignación guardada.",
			formatModelAssignments(saved, status.agentProfiles),
			...(saved.backupPath ? [`Backup: ${saved.backupPath}`] : []),
		].join("\n");
	} catch (error) {
		return `No pude guardar asignación.\n${error instanceof Error ? error.message : String(error)}`;
	}
}

type ModelAssignmentMenuOption = {
	value: string;
	label: string;
	source: "profile" | "model" | "custom";
	providerKey?: string;
	providerLabel?: string;
};

type ModelAssignmentMenuGroups = {
	profiles: ModelAssignmentMenuOption[];
	providerGroups: Array<{
		key: string;
		label: string;
		providers: string[];
		models: ModelAssignmentMenuOption[];
	}>;
	custom?: ModelAssignmentMenuOption;
};

function modelAssignmentOptions(
	status: ReturnType<typeof buildCliHomeStatus>,
): ModelAssignmentMenuOption[] {
	const snapshot = readPiModelCatalogSnapshot(
		resolvePiModelCatalogSnapshotPath(),
	);
	const catalog = buildUnifiedModelCatalog({
		snapshotModels: snapshot?.models,
		gentleModelIds: readGentleModelRouting(status.cwd),
		profileModelIds: status.agentProfiles.map(profileModelLabel),
	});
	return assignmentOptionsFromModelCatalog(
		status.agentProfiles,
		catalog.entries,
	).map((option) => {
		const provider = option.value.split("/")[0];
		return {
			value: option.value,
			label: formatModelAssignmentOptionLabel(option),
			source: option.source,
			...(option.source === "model" && provider
				? {
						providerKey: modelProviderDisplayKey(provider),
						providerLabel: modelProviderDisplayLabel(provider),
					}
				: {}),
		};
	});
}

function modelAssignmentOptionGroups(
	status: ReturnType<typeof buildCliHomeStatus>,
): ModelAssignmentMenuGroups {
	const options = modelAssignmentOptions(status);
	const providerGroups = new Map<
		string,
		{
			key: string;
			label: string;
			providers: string[];
			models: ModelAssignmentMenuOption[];
		}
	>();
	let custom: ModelAssignmentMenuOption | undefined;
	const profiles: ModelAssignmentMenuOption[] = [];
	for (const option of options) {
		if (option.source === "profile") {
			profiles.push(option);
			continue;
		}
		if (option.source === "custom") {
			custom = option;
			continue;
		}
		const provider = option.value.split("/")[0];
		if (!provider) continue;
		const key = option.providerKey ?? modelProviderDisplayKey(provider);
		const label = option.providerLabel ?? modelProviderDisplayLabel(provider);
		const current = providerGroups.get(key) ?? {
			key,
			label,
			providers: [],
			models: [],
		};
		if (!current.providers.includes(provider)) current.providers.push(provider);
		current.models.push(option);
		providerGroups.set(key, current);
	}
	return {
		profiles,
		providerGroups: [...providerGroups.values()]
			.map((group) => ({
				...group,
				providers: [...group.providers].sort((left, right) =>
					left.localeCompare(right),
				),
				models: [...group.models].sort(
					(left, right) =>
						left.label.localeCompare(right.label) ||
						left.value.localeCompare(right.value),
				),
			}))
			.sort(
				(left, right) =>
					left.label.localeCompare(right.label) ||
					left.key.localeCompare(right.key),
			),
		custom,
	};
}

function formatModelAssignmentOptionLabel(option: {
	value: string;
	label: string;
	source: "profile" | "model" | "custom";
}): string {
	if (option.source === "profile") return `[perfil] ${option.label}`;
	if (option.source === "custom") return `${option.label}`;
	const provider = option.value.split("/")[0] ?? "modelo";
	return `${option.label} — ${modelProviderDisplayLabel(provider)}`;
}

function resolveRoleSelection(input: string): string | undefined {
	const index = Number(input);
	if (
		Number.isInteger(index) &&
		index >= 1 &&
		index <= IDU_MODEL_ROLES.length
	) {
		return IDU_MODEL_ROLES[index - 1]?.id;
	}
	return IDU_MODEL_ROLES.find((role) => role.id === input)?.id;
}

function resolveAssignmentSelection(
	input: string,
	options: Array<{ value: string }>,
): string | undefined {
	const index = Number(input);
	if (Number.isInteger(index) && index >= 1 && index <= options.length) {
		return options[index - 1]?.value;
	}
	return options.find((option) => option.value === input)?.value;
}

function validateAgentProfiles(
	status: ReturnType<typeof buildCliHomeStatus>,
): string {
	try {
		parseAgentProfiles(
			status.agentProfiles
				.map(
					(profile) =>
						`${profile.id}|${profile.label}|${profile.piArgs.join(" ")}`,
				)
				.join(";"),
		);
		return [
			"Configuración de perfiles válida.",
			`perfiles: ${status.agentProfiles.length}`,
			...(status.project.stateRoot
				? [
						formatModelAssignments(
							loadModelAssignments(status.project.stateRoot),
							status.agentProfiles,
						),
					]
				: ["model assignments: sin stateRoot"]),
		].join("\n");
	} catch (error) {
		return `Configuración inválida: ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function runTelegramRemoteMenu(
	question: CliQuestion,
	print: CliPrint,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	print(formatTelegramRemoteMenu());
	const choice = (await question("\nElegí una opción [1-11]: ")).trim();
	if (choice === "10" || /^volver$/iu.test(choice))
		return "Volver sin cambios.";
	if (choice === "11" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	return handleTelegramRemoteChoice(choice, question, status, options);
}

async function handleTelegramRemoteChoice(
	choice: string,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions = {},
): Promise<string> {
	const envPath = packageEnvPath(status.packageRoot);
	const logPath = join(status.packageRoot, "logs", "bridge.log");
	if (choice === "status" || choice === "1") {
		const draft = readEnvDraft(envPath);
		return formatBridgeEnvStatus({
			envPath,
			exists: existsSync(envPath),
			values: draft.values,
			packageRoot: status.packageRoot,
			startScriptExists: existsSync(
				join(status.packageRoot, "scripts", "start-bridge.ps1"),
			),
			stopScriptExists: existsSync(
				join(status.packageRoot, "scripts", "stop-bridge.ps1"),
			),
			logPath,
			logExists: existsSync(logPath),
			bridgeStatus: "unknown (sin shell riesgosa)",
		});
	}
	if (choice === "configure" || choice === "2") {
		const token = (await question("TELEGRAM_BOT_TOKEN: ")).trim();
		const userId = (await question("ALLOWED_USER_ID: ")).trim();
		const errors = validateBridgeEnvDraft({
			TELEGRAM_BOT_TOKEN: token,
			ALLOWED_USER_ID: userId,
		});
		if (errors.length)
			return `Configuración inválida:\n- ${errors.join("\n- ")}`;
		if (!(await confirmAction(question, "Guardar .env con backup?")))
			return "Cancelado sin cambios.";
		const result = writeEnvDraftWithBackup(envPath, readEnvDraft(envPath), {
			TELEGRAM_BOT_TOKEN: token,
			ALLOWED_USER_ID: userId,
		});
		return [
			"Acceso remoto guardado.",
			...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
			"Token guardado enmascarado; no se imprime el secreto.",
		].join("\n");
	}
	if (choice === "sync" || choice === "3") {
		return "La sincronización real de comandos remotos requiere el bot corriendo: usá /config sync_commands desde Telegram. No hay contexto bot.api en el CLI local.";
	}
	if (choice === "run" || choice === "4")
		return runBridgeLifecycleChoice("run", question, status, options);
	if (choice === "off" || choice === "5")
		return runBridgeLifecycleChoice("off", question, status, options);
	if (choice === "restart" || choice === "6")
		return runBridgeLifecycleChoice("restart", question, status, options);
	if (choice === "logs" || choice === "7") return tailTextFile(logPath, 80);
	if (choice === "save" || choice === "8")
		return "No hay draft pendiente; Configurar acceso remoto guarda con Save dentro del flujo.";
	if (choice === "discard" || choice === "9")
		return "No hay draft pendiente para descartar.";
	return "Opción Telegram remoto no reconocida. No ejecuté acciones.";
}

async function runBridgeLifecycleChoice(
	action: BridgeLifecycleAction,
	question: CliQuestion,
	status: ReturnType<typeof buildCliHomeStatus>,
	options: CliHomeActionOptions,
): Promise<string> {
	if (
		!(await confirmAction(
			question,
			`${bridgeLifecycleReply(action)} ¿Continuar?`,
		))
	) {
		return "Cancelado sin cambios.";
	}
	(options.bridgeLauncher ?? launchBridgeLifecycle)(action, status.packageRoot);
	return bridgeLifecycleReply(action);
}

async function runModelProfilesMenu(
	question: CliQuestion,
	print: CliPrint,
	status: ReturnType<typeof buildCliHomeStatus>,
): Promise<string> {
	print(formatModelProfilesMenu());
	const choice = (await question("\nElegí una opción [1-7]: ")).trim();
	if (choice === "6" || /^volver$/iu.test(choice)) return "Volver sin cambios.";
	if (choice === "7" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1" || choice === "assign")
		return assignModelRole(question, status);
	if (choice === "2" || choice === "status")
		return formatModelProfilesStatus(status);
	if (choice === "3" || choice === "proposal")
		return proposeAgentLabModelAssignments(question, status);
	if (choice === "4" || choice === "validate")
		return validateAgentProfiles(status);
	if (choice === "5" || choice === "edit")
		return editAgentProfiles(question, status);
	return "Opción no reconocida. No ejecuté acciones.";
}

async function runInstallationMenu(
	question: CliQuestion,
	print: CliPrint,
): Promise<string> {
	print(formatInstallationMenu());
	const choice = (await question("\nElegí una opción [1-7]: ")).trim();
	return handleInstallationChoice(choice, question);
}

async function handleInstallationChoice(
	choice: string,
	question: CliQuestion,
): Promise<string> {
	if (choice === "6" || /^volver$/iu.test(choice)) return "Volver sin cambios.";
	if (choice === "7" || /^exit|salir$/iu.test(choice))
		return "Salida sin cambios.";
	if (choice === "1") return handleSetupCommand(["status"]);
	if (choice === "2") {
		if (
			!(await confirmAction(
				question,
				"Esto modificará ~/.pi/agent/mcp.json y/o extensions. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleSetupCommand(["mcp-init"]);
	}
	if (choice === "3") {
		if (
			!(await confirmAction(
				question,
				"Esto modificará ~/.pi/agent/mcp.json y/o extensions. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleSetupCommand(["mcp-init", "--force"]);
	}
	if (choice === "4") {
		if (
			!(await confirmAction(
				question,
				"Esto enrolará el proyecto actual y creará stateRoot. ¿Continuar?",
			))
		) {
			return "Cancelado sin cambios.";
		}
		return handleProjectCommand(["enroll", process.cwd()]);
	}
	if (choice === "5") {
		if (
			!(await confirmAction(question, "Esto activará guardrails. ¿Continuar?"))
		) {
			return "Cancelado sin cambios.";
		}
		return runWizardActivateSupervisor();
	}
	return "Opción de instalación no reconocida. No ejecuté acciones.";
}

function runWizardActivateSupervisor(): string {
	try {
		applyPackageEnvDefaults();
		const defaultCwd = canonicalDirectory(requiredEnvForWizard("DEFAULT_CWD"));
		const allowedRoots = parseAllowedRootsForWizard(
			process.env.ALLOWED_ROOTS,
			defaultCwd,
		);
		const registry = loadRegistry(defaultCwd, allowedRoots, {
			registryPath: resolveIduRegistryPath(),
			createIfMissing: false,
		});
		const projectPath = canonicalDirectory(process.cwd());
		if (!isAllowedCwd(projectPath, allowedRoots)) {
			return wizardActivationDiagnostic(
				`cwd fuera de ALLOWED_ROOTS: ${projectPath}`,
			);
		}
		const project = registeredProjectForPath(registry, projectPath);
		if (!project) {
			return wizardActivationDiagnostic(
				"Proyecto no registrado; el wizard no enrola automáticamente.",
			);
		}
		if (!project.stateRoot || !existsSync(project.stateRoot)) {
			return wizardActivationDiagnostic(
				"Proyecto registrado sin stateRoot aislado existente; re-enrolalo antes de activar.",
			);
		}
		configureIduSessionStore({
			workspaceRoot: project.stateRoot,
			filePath: join(project.stateRoot, "idu-session-state.json"),
		});
		activateIduSession(project.id);
		return [
			"Guardrails automáticos activados para el proyecto activo.",
			"No ejecuté bootstrap, scans, prepare ni AgentLabs desde el wizard.",
			`projectId: ${project.id}`,
			`projectPath: ${project.path}`,
			`stateRoot: ${project.stateRoot}`,
		].join("\n");
	} catch (error) {
		return wizardActivationDiagnostic(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function registeredProjectForPath(
	registry: ProjectRegistry,
	projectPath: string,
): ProjectEntry | undefined {
	const normalize = (value: string) =>
		process.platform === "win32" ? value.toLowerCase() : value;
	return registry.projects.find(
		(project) => normalize(project.path) === normalize(projectPath),
	);
}

function requiredEnvForWizard(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function parseAllowedRootsForWizard(
	raw: string | undefined,
	defaultCwd: string,
): string[] {
	return (raw?.trim() ? raw.split(";") : [defaultCwd])
		.map((entry) => canonicalDirectory(entry.trim()))
		.filter(Boolean);
}

function wizardActivationDiagnostic(reason: string): string {
	return [
		"No pude activar guardrails desde el wizard.",
		`Qué pasó: ${reason}`,
		"Acción recomendada: primero enrolá o bootstrappeá el proyecto de forma explícita.",
		"Comando sugerido: idu-pi project enroll .",
	].join("\n");
}

async function confirmAction(
	question: CliQuestion,
	message: string,
): Promise<boolean> {
	const answer = (await question(`${message} [y/N]: `)).trim().toLowerCase();
	return (
		answer === "y" ||
		answer === "yes" ||
		answer === "s" ||
		answer === "si" ||
		answer === "sí"
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	void main();
}
