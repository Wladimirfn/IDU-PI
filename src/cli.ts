#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
	canonicalDirectory,
	governanceConfigFromConfig,
	isAllowedCwd,
	loadConfig,
	type BridgeConfig,
	type GovernanceConfigPayload,
} from "./config.js";
import { AgentRouter } from "./agent-router.js";
import { readPendingBlockingInjection } from "./objective-injection.js";
import {
	applyPackageEnvDefaults,
	buildCliHomeStatus,
	formatCliHome,
	resolveIduRegistryPath,
} from "./cli-home.js";
import {
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
import {
	createSourceSkillCandidates,
	formatSourceSkillCandidateCreationResult,
	formatSourceSkillCandidateReview,
	reviewSourceSkillCandidates,
	type SourceSkillCandidateCreationResult,
	type SourceSkillCandidateReview,
} from "./source-skill-candidates.js";
import { formatCommandCatalog } from "./command-catalog.js";
import {
	buildModelInvocationStatusOrError,
	formatModelInvocationStatus,
	parseModelInvocationStatusArgs,
	type BuildModelInvocationStatusResult,
	type ModelInvocationStatusReport,
} from "./cli-model-invocation-status.js";
import {
	formatOrchestratorAdvisory,
	formatRoleEngineStatus,
	type RoleEngineStatusReport,
} from "./cli-role-engine.js";
import { getOrchestratorAdvisoryStream } from "./orchestrator-advisory-stream.js";
import {
	resolveRoleEngineConfig,
	runRoleEngineMigration,
	saveRoleEngineConfig,
	type RoleEngineConfig,
	type RoleEngineConfigPatch,
} from "./role-engine-config.js";
import {
	rebindRoleEngineSubscription,
	unbindRoleEngineSubscription,
	type RoleEngineSubscriptionStatus,
} from "./role-engine-subscription.js";
import type { RoleAdvisory } from "./roles/index.js";
import {
	configureIduSessionStore,
	getIduSessionStatus,
} from "./idu-session.js";
import {
	formatIduPrepareResult,
	type IduPrepareResult,
} from "./idu-prepare.js";
import { runIduBootstrap } from "./idu-bootstrap.js";
import {
	migrateHygieneLayout,
	type MigrationResult,
} from "./hygiene-migrate.js";
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
	redraftMasterPlan,
	rejectMasterPlan,
	reviewMasterPlan,
	type MasterPlanDraftResult,
	type MasterPlanProgressEvent,
	type MasterPlanReview,
	type MasterPlanStatusResult,
} from "./master-plan.js";
import { buildMasterPlanTaskTree } from "./master-plan-task-tree.js";
import {
	ProposalOutboxStore,
	type FlowBoundProposal,
} from "./proposal-outbox.js";
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
import {
	formatProjectConnectionReport,
	type ProjectConnectionReport,
} from "./project-connection.js";
import {
	formatProjectPostflightReport,
	type ProjectPostflightReport,
} from "./project-postflight.js";
import {
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
	planIduSupervisorCron,
	type IduSupervisorCronPlanResult,
} from "./idu-supervisor-cron.js";
import {
	maybeRunSupervisorAfterPostflight,
	maybeRunSupervisorAfterSemanticTrigger,
	maybeRunSupervisorOnIduActivation,
	type IduSupervisorHookResult,
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
	type AgentLabSpecialistAuditPlanOptions,
} from "./agentlab-review-requests.js";
import {
	dispatchAgentLabReviewRun,
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
	createSkillDraftFromLessons,
	type SkillDraftFromLessonsMode,
	type SkillDraftFromLessonsResult,
} from "./skill-draft-from-lessons.js";
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
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	type StructuredTask,
} from "./structured-task-queue.js";
import type { TaskTemplateKind } from "./task-templates.js";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
	applySupervisorModelAssignment,
	loadModelAssignments,
	type IduModelRoleId,
} from "./model-assignments.js";
import {
	buildIduUsageReport,
	filterRecentIduUsageEvents,
	readIduUsageEvents,
	recordIduUsageEventDeferred,
} from "./usage-events.js";
import {
	filterRecentSupervisorActivityEvents,
	readSupervisorActivityEvents,
	recordSupervisorActivityEventDeferred,
	summarizeSupervisorActivityEvents,
	supervisorActivityInputFromLoopResult,
} from "./supervisor-activity-events.js";
import {
	buildAgentLabEffectivenessReport,
	readAgentLabEffectivenessEvents,
} from "./agentlab-effectiveness-events.js";
import {
	buildSupervisorSelfMaintenanceAdvisory,
	SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
} from "./supervisor-self-maintenance-advisory.js";

// CliResult moved to src/cli/dispatch-glue/types.ts (PR 1 of Item 4, cluster Q).
// The typecheck guard (npx tsc --noEmit) verifies all consumers still resolve.
import type { CliResult } from "./cli/dispatch-glue/index.js";
// Internal imports (Q cluster helpers, used throughout cli.ts).
import {
	ok,
	fail,
	helpText,
	parseHygieneMigrateArgs,
	formatHygieneMigrateResult,
	formatHygieneSweepResult,
} from "./cli/dispatch-glue/index.js";
// Re-export the 4 Q functions for the public surface (snapshot test pins them).
export {
	parseHygieneMigrateArgs,
	formatHygieneSweepResult,
	formatHygieneMigrateResult,
	helpText,
} from "./cli/dispatch-glue/index.js";
export type { CliResult } from "./cli/dispatch-glue/index.js";
// PR 3 (Item 4): RuntimeContext moved to dispatch-glue/context.ts (precondition
// of moving cluster O, which uses it). Same pattern as CliResult (PR 1)
// and ExecutionDirectorCliResult (PR 2).
import type { RuntimeContext } from "./cli/dispatch-glue/index.js";
// PR 3 (Item 4): clusters N (wizard) + P (tail-formatters) + O (setup) imports.
import {
	handleSetupCommand,
	handleProjectCommand,
	inspectConnection,
	formatCliSupervisorStartupSection,
	formatDashboard,
	buildPreflightReport,
	buildPostflightReport,
	runPrepare,
} from "./cli/setup/index.js";
// (PR 2 imports already exist above; this is just an anchor for the editor)
import {
	runCliExecutionDirectorTick,
	formatExecutionDirectorTick,
	formatProposalOutbox,
	formatProposalDetail,
} from "./cli/master-plan/index.js";
import type { ExecutionDirectorCliResult } from "./cli/master-plan/index.js";

// PR 7b (Item 4): cluster C (master-plan) case wrappers for the dispatch switch.
import {
	handleAutomaticov1,
	handleEvents,
	handleMasterPlanStatus,
	handleMasterPlanReview,
	handleMasterPlanApprove,
	handleMasterPlanReject,
	handleMasterPlanRedraft,
	handleExecutionDirectorTick,
	handleProposalOutbox,
	handleProposalDetail,
} from "./cli/master-plan/index.js";
// buildCliSelfMaintenanceReport moved to _shared/ (cross-cluster dep,
// used by both C and B). Re-exported below to preserve the 20-function surface.
import { buildCliSelfMaintenanceReport } from "./cli/_shared/index.js";
// Re-export ExecutionDirectorCliResult (PR 2: type moved to master-plan/types.ts).
export type { ExecutionDirectorCliResult } from "./cli/master-plan/index.js";
// Re-export buildCliSelfMaintenanceReport (PR 2: moved to _shared/).
export { buildCliSelfMaintenanceReport } from "./cli/_shared/index.js";

// PR 6 (Item 4): cluster L (TUI) exports (public surface, snapshot test pins).
import {
	runInteractiveHome,
	runTaskQueuePanelTui,
	__testSelectSearchableMenu,
	runInteractiveHomeWithQuestion,
} from "./cli/tui/index.js";
export {
	runInteractiveHome,
	runTaskQueuePanelTui,
	__testSelectSearchableMenu,
	runInteractiveHomeWithQuestion,
} from "./cli/tui/index.js";

// PR 5 (Item 4): re-export TaskQueuePanelDispatchRuntime + TaskQueuePanelDispatchResult.
export type {
	TaskQueuePanelDispatchRuntime,
	TaskQueuePanelDispatchResult,
} from "./cli/queue/index.js";

// PR 4 (Item 4): re-export routeAlertDecisionsForDigest (moved to alerts/).
export { routeAlertDecisionsForDigest } from "./cli/alerts/index.js";

// PR 5 (Item 4): cluster I (queue) exports (public surface, snapshot test pins).
// Note: `export { ... } from` re-exports but does NOT make the symbols
// available locally for use inside this file. So we use a regular
// `import` AND a `export { ... } from` for the re-export.
import {
	createCliTask,
	approveStructuredTaskById,
	rejectStructuredTaskById,
	completeStructuredTaskById,
	formatCliTaskResult,
	dispatchTaskQueuePanelChoice,
} from "./cli/queue/index.js";
export {
	createCliTask,
	approveStructuredTaskById,
	rejectStructuredTaskById,
	completeStructuredTaskById,
	formatCliTaskResult,
	dispatchTaskQueuePanelChoice,
} from "./cli/queue/index.js";

// PR 4 (Item 4): clusters B (alerts) + E (agentlab) + M (role) imports.
import { emitIduProgress } from "./cli/alerts/index.js";
// routeAlertDecisionsForDigest is exported (public surface, snapshot test pins it).
import { routeAlertDecisionsForDigest } from "./cli/alerts/index.js";
import { runOrReuseMasterPlanDeepReview } from "./cli/agentlab/index.js";

// PR 7c (Item 4): cluster E (agentlab) case wrappers for the dispatch switch.
import {
	handleUsageStatus,
	handleLabReviewPlan,
	handleReview,
	handleAgentLabRequestCreate,
	handleAgentLabRequestReview,
	handleAgentLabReviewRun,
	handleAgentLabReviewStatus,
	handleAgentLabReportConsolidate,
	handleAgentLabReportConsolidationStatus,
} from "./cli/agentlab/index.js";
// PR 7d (Item 4): cluster F (source) case wrappers for the dispatch switch.
import {
	handleSourceStatus,
	handleSourceAdd,
	handleSourceRemove,
	handleSourceRead,
	handleSourceExtract,
	handleSourceReport,
	handleSourceResearch,
	handleSourceDigest,
	handleSourceDigestStatus,
	handleSourceChunkRead,
	handleSourceRecommend,
	handleSourceRequiredActions,
	handleSourceSkillCandidatesCreate,
	handleSourceSkillCandidatesReview,
	handleSourceRefresh,
} from "./cli/source/index.js";
// PR 7e (Item 4): cluster G (supervisor) case wrappers for the dispatch switch.
import {
	handleRunCronPreflight,
	handleCheckUserEscalation,
	handleSupervisorTick,
	handleSupervisorImprovementsReview,
	handleSupervisorImprovementsCreate,
	handleSupervisorImprovementsStatus,
	handleSupervisorImprovementsApprove,
	handleSupervisorImprovementsReject,
	handleSupervisorImprovementsDefer,
	handleSupervisorImprovementsApply,
	handleSupervisorLearningRulesStatus,
	handleSupervisorLearningRulesTest,
	handleSupervisorLearningRulesDisable,
	handleSupervisorLearningRulesEnable,
	handleSupervisorLearningRulesRollback,
	handleSupervisorTrigger,
} from "./cli/supervisor/index.js";
// PR 7f (Item 4): cluster H (skill) case wrappers for the dispatch switch.
import {
	handleSkillImprovementsReview,
	handleSkillImprovementsCreate,
	handleSkillImprovementsStatus,
	handleSkillImprovementsApprove,
	handleSkillImprovementsReject,
	handleSkillImprovementsDefer,
	handleSkillDraftsCreate,
	handleSkillDraftsReview,
	handleSkillRating,
} from "./cli/skill/index.js";
// PR 7g (Item 4): cluster J (semantic) case wrappers for the dispatch switch.
import {
	handleSemanticAuditStatus,
	handleSemanticAuditRun,
	handleSemanticCompactDraft,
	handleSemanticCompactReview,
	handleSemanticAgentTasksReview,
	handleSemanticAgentTasksCreate,
} from "./cli/semantic/index.js";
// PR 7h (Item 4): cluster I (queue) case wrappers for the dispatch switch.
import {
	handleQueueDetail,
	handleQueueClearStructured,
	handleQueueApprove,
	handleQueueReject,
	handleQueueComplete,
	handleTask,
} from "./cli/queue/index.js";
// PR 7i (Item 4): cluster B (alerts) case wrappers for the dispatch switch.
import {
	handleAlerts,
	handleAlertsStatus,
	handleAlertsTick,
	handleAlertsScheduledTick,
} from "./cli/alerts/index.js";
// PR 7j (Item 4): cluster D (birth) case wrappers for the dispatch switch.
import {
	handleBirthStatus,
	handleBirthExistingScan,
	handleBirthBibliotecarioDiscovery,
	handleBirthValidate,
	handleBirthGeneralSpec,
	handleBirthGeneralSpecDerive,
	handleBirthPrototypeMaster,
	handleBirthRepoPlan,
} from "./cli/birth/index.js";
// PR 7k (Item 4): cluster K (single-shot) case wrappers for the dispatch switch.
import {
	handleStatus,
	handleIdu,
	handleIduOff,
	handleIduStatus,
	handleIduPrepare,
	handleIduProjectResetState,
	handleIduHygieneMigrate,
	handleIduAckAdvisory,
	handleIduHygieneSweep,
	handleIduSkillsDeploy,
	handleIduPreflight,
	handleIduAdvisory,
	handleIduPostflight,
	handleIduObjectiveStatus,
	handleIduOnboardProject,
	handleIduBibliotecarioInit,
	handleIduPendingInjections,
	handleIduDecisionLedger,
	handleIduOutboxPrune,
	handleIduSubscribeTriggers,
	handleIduTriggerEngine,
	handleIduTriggerShow,
	handleLockCleanup,
} from "./cli/single/index.js";

// PR 7a (Item 4): cluster M (role) case wrappers for the dispatch switch.
import {
	handleModelInvocationStatus,
	handleOrchestratorAdvisory,
	handleRoleEngine,
	handleRoleEngineStatus,
} from "./cli/role/index.js";

// PR 6 (Item 4): cluster L (TUI) internal imports (NOT public surface).
import {
	buildHomeTaskQueueRuntime,
	shouldRunInteractiveHome,
} from "./cli/tui/index.js";

// PR 5 (Item 4): cluster I (queue) internal imports + types.
import { semanticCompactionProjectContext } from "./cli/queue/index.js";
import type {
	TaskQueuePanelDispatchRuntime,
	TaskQueuePanelDispatchResult,
} from "./cli/queue/index.js";

export type CliRuntime = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	labDbPath?: string;
	// Phase 0 (#263): runtime-owned governance config, populated from the
	// config already loaded by createCliRuntime. Optional to avoid churn on
	// existing typed-literal test fakes; always present on production runtimes.
	governanceConfig?: GovernanceConfigPayload;
	digestNotify?: (text: string) => void;
	sessionStatePath?: string;
	promptForRole?: (
		role: IduModelRoleId,
		message: string,
		options?: {
			stateRoot?: string;
			projectId?: string;
			invocationSink?: (record: unknown) => void;
			onProgress?: (event: unknown) => void;
		},
	) => Promise<{
		ok: boolean;
		output: string;
		provider: string;
		model: string;
		role: IduModelRoleId;
	}>;
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
	sourceSkillCandidatesCreate: (
		selector?: string,
	) => SourceSkillCandidateCreationResult;
	sourceSkillCandidatesReview: (
		pathOrLatest: string,
	) => SourceSkillCandidateReview;
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
	formatSourceSkillCandidateCreationResult: (
		result: SourceSkillCandidateCreationResult,
	) => string;
	formatSourceSkillCandidateReview: (
		review: SourceSkillCandidateReview,
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
	supervisorConsult: (input: {
		role: import("./model-assignments.js").IduModelRoleId;
		question: string;
		context?: string;
	}) => Promise<import("./supervisor-consult.js").ConsultResult>;
	runCronPreflight?: (input: {
		changedFiles: readonly string[];
	}) => Promise<import("./cron-preflight.js").CronPreflightResult>;
	checkUserEscalation?: (input: {
		lastUserInteractionAt?: string;
	}) => Promise<import("./user-escalation.js").EscalationResult>;
	formatSupervisorTick: (result: IduSupervisorLoopResult) => string;
	executionDirectorTick?: () => ExecutionDirectorCliResult;
	formatExecutionDirectorTick?: (result: ExecutionDirectorCliResult) => string;
	proposalOutbox?: () => FlowBoundProposal[];
	formatProposalOutbox?: (proposals: FlowBoundProposal[]) => string;
	proposalDetail?: (id: string) => FlowBoundProposal | undefined;
	formatProposalDetail?: (
		proposal: FlowBoundProposal | undefined,
		id: string,
	) => string;
	supervisorOnIduActivation: () => IduSupervisorHookResult | undefined;
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
	skillDraftFromLessons: (options?: {
		mode?: SkillDraftFromLessonsMode;
		selector?: string;
	}) => SkillDraftFromLessonsResult;
	skillDraftReview: (pathOrLatest: string) => SkillDraftReview;
	formatSkillDraftReview: (review: SkillDraftReview) => string;
	agentLabRequestCreate: (
		source: string,
		pathOrLatest?: string,
		options?: AgentLabSpecialistAuditPlanOptions,
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
	queueComplete?: (
		idOrPrefix: string,
		evidence: string,
	) => StructuredTask | undefined;
	projectStateReset: (confirmed: boolean) => ProjectStateResetResult;
	formatProjectStateResetResult: (result: ProjectStateResetResult) => string;
	modelInvocationStatus: (options?: {
		role?: string;
		limit?: number;
	}) => BuildModelInvocationStatusResult;
	formatModelInvocationStatus: (report: ModelInvocationStatusReport) => string;
	getOrchestratorAdvisory: (options?: {
		roleId?: string;
		sinceMs?: number;
		limit?: number;
	}) => RoleAdvisory[];
	formatOrchestratorAdvisory: (rows: RoleAdvisory[]) => string;
	getRoleEngineStatus: () => RoleEngineStatusReport;
	formatRoleEngineStatus: (report: RoleEngineStatusReport) => string;
	saveRoleEngineConfig?: (patch: RoleEngineConfigPatch) => RoleEngineConfig;
	rebindRoleEngine?: () => RoleEngineSubscriptionStatus;
	unbindRoleEngine?: () => RoleEngineSubscriptionStatus;
	activeProfileId?: () => string;
};

// TODO(shared-module): this worktree overlay is a byte-identical duplicate of
// resolveWorktreeOverlay in src/mcp-server.ts (kept here to avoid a cross-module
// import from the CLI entry into the MCP entry). A follow-up slice extracts a
// single shared, tested implementation. See SDD worktree-aware-project-resolution.
type RuntimeGitRunner = (args: string[], cwd: string) => string;

const RUNTIME_GIT_TIMEOUT_MS = 5000;

function defaultRuntimeGitRunner(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: RUNTIME_GIT_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function runtimeCanonicalCommonDir(raw: string, cwd: string): string {
	const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
	return canonicalDirectory(absolute);
}

function runtimePorcelainLists(
	porcelain: string,
	candidateCanonical: string,
	cwd: string,
): boolean {
	for (const line of porcelain.split(/\r?\n/u)) {
		if (!line.startsWith("worktree ")) continue;
		const entry = line.slice("worktree ".length).trim();
		if (!entry) continue;
		try {
			const absolute = isAbsolute(entry) ? entry : resolve(cwd, entry);
			if (sameRuntimePath(canonicalDirectory(absolute), candidateCanonical)) {
				return true;
			}
		} catch {
			continue;
		}
	}
	return false;
}

type RuntimeWorktreeOverlayResult = {
	resolved: boolean;
	projectId?: string;
	effectiveCwd?: string;
};

function resolveWorktreeOverlayRuntime(input: {
	candidatePath: string;
	registry: ProjectRegistry;
	workspaceRoot: string;
	runGit?: RuntimeGitRunner;
}): RuntimeWorktreeOverlayResult {
	const runGit = input.runGit ?? defaultRuntimeGitRunner;
	try {
		if (!existsSync(join(input.candidatePath, ".git"))) {
			return { resolved: false };
		}
		const commonDirRaw = runGit(
			["rev-parse", "--git-common-dir"],
			input.candidatePath,
		).trim();
		if (!commonDirRaw) return { resolved: false };

		const toplevelRaw = runGit(
			["rev-parse", "--show-toplevel"],
			input.candidatePath,
		).trim();
		if (!toplevelRaw) return { resolved: false };

		const candidateCanonical = canonicalDirectory(input.candidatePath);
		const toplevelCanonical = canonicalDirectory(
			isAbsolute(toplevelRaw)
				? toplevelRaw
				: resolve(input.candidatePath, toplevelRaw),
		);
		if (!sameRuntimePath(candidateCanonical, toplevelCanonical)) {
			return { resolved: false };
		}
		const candidateCommonDir = runtimeCanonicalCommonDir(
			commonDirRaw,
			input.candidatePath,
		);

		for (const project of input.registry.projects) {
			try {
				const regCommonRaw = runGit(
					["rev-parse", "--git-common-dir"],
					project.path,
				).trim();
				if (!regCommonRaw) continue;
				if (
					!sameRuntimePath(
						runtimeCanonicalCommonDir(regCommonRaw, project.path),
						candidateCommonDir,
					)
				) {
					continue;
				}
				const porcelain = runGit(
					["worktree", "list", "--porcelain"],
					project.path,
				);
				if (
					!runtimePorcelainLists(
						porcelain,
						candidateCanonical,
						project.path,
					)
				) {
					continue;
				}
				return {
					resolved: true,
					projectId: project.id,
					effectiveCwd: candidateCanonical,
				};
			} catch {
				continue;
			}
		}
		return { resolved: false };
	} catch {
		return { resolved: false };
	}
}

type ResolvedRuntimeProject = {
	project: ProjectEntry;
	effectiveCwd?: string;
};

function resolveRuntimeProject(
	registry: ProjectRegistry,
	config: BridgeConfig,
	projectPath?: string,
): ResolvedRuntimeProject | undefined {
	if (!projectPath?.trim()) {
		const active = getActiveProject(registry);
		return active ? { project: active } : undefined;
	}
	const path = canonicalDirectory(projectPath.trim());
	if (!isAllowedCwd(path, config.allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${path}`);
	}
	const exact = registry.projects.find((project) =>
		sameRuntimePath(project.path, path),
	);
	if (exact) return { project: exact };
	// Exact-match missed: try the worktree-aware overlay. A worktree of an
	// enrolled parent resolves to the parent's ProjectEntry with effectiveCwd
	// set to the canonical worktree path (separates governance from git cwd).
	const overlay = resolveWorktreeOverlayRuntime({
		candidatePath: path,
		registry,
		workspaceRoot: config.agentWorkspaceRoot,
	});
	if (overlay.resolved && overlay.projectId) {
		const found = registry.projects.find(
			(project) => project.id === overlay.projectId,
		);
		if (found) {
			return { project: found, effectiveCwd: overlay.effectiveCwd };
		}
	}
	return undefined;
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
	stateRoot?: string;
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
	const resolvedRuntime = resolveRuntimeProject(
		registry,
		config,
		options.projectPath,
	);
	if (!resolvedRuntime) {
		throw new Error(
			"No hay proyecto activo. Usá /addproject <id> <ruta> en Telegram o configurá DEFAULT_CWD.",
		);
	}
	const activeProject = resolvedRuntime.project;
	// effectiveCwd is set only when resolution went through the worktree
	// overlay; it is the canonical worktree path to use for git operations
	// (postflight, HEAD reads) while governance stays bound to activeProject.
	const effectiveCwd = resolvedRuntime.effectiveCwd;
	// R5.3.2.1 fix: ensure context.activeProject.stateRoot is populated
	// before the RuntimeContext is built. buildPostflightReport
	// (src/cli/setup/helpers.ts:280) reads context.activeProject.stateRoot
	// and falls back to runtimeWorkspaceRoot when it is null. That fallback
	// is the agent workspace root, not the per-project stateRoot, so a
	// null activeProject.stateRoot makes the postflight gate read the
	// wrong constitution/flows files and silently skip with a false-positive
	// ok=true. The registry entry for a freshly enrolled project is
	// populated by projectEnroll (src/idu-installer.ts:567), but the
	// self-project may be loaded from a registry written before that
	// guarantee, so we compute the canonical stateRoot here when missing.
	if (!activeProject.stateRoot) {
		activeProject.stateRoot = resolveProjectStatePaths({
			workspaceRoot: config.agentWorkspaceRoot,
			projectId: activeProject.id,
			projectPath: activeProject.path,
		}).stateRoot;
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
	const runtimeStateRoot =
		projectStatePaths?.stateRoot ??
		resolveProjectStatePaths({
			workspaceRoot: config.agentWorkspaceRoot,
			projectId: activeProject.id,
			projectPath: activeProject.path,
		}).stateRoot;
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
				supervisorActivityStateRoot: runtimeStateRoot,
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
	const masterPlanStateRoot = runtimeStateRoot;
	runRoleEngineMigration(masterPlanStateRoot);
	const context = {
		config,
		registry,
		activeProject,
		structuredTaskQueue,
		runtimeWorkspaceRoot,
		masterPlanStateRoot,
		reportsPath,
		labDbPath,
		...(effectiveCwd ? { effectiveCwd } : {}),
	};
	return {
		projectId: activeProject.id,
		projectPath: activeProject.path,
		workspaceRoot: runtimeWorkspaceRoot,
		// Phase 0 (#263): governance config derived from the config already
		// loaded above, so migrated MCP builders need no DEFAULT_CWD read.
		governanceConfig: governanceConfigFromConfig(config),
		...(projectStatePaths ? { labDbPath } : {}),
		promptForRole: (role, message) =>
			agentRouter.promptForRole(role, message, {
				projectId: activeProject.id,
				stateRoot: runtimeStateRoot,
				invocationSink: labDbRepository.appendInvocation.bind(labDbRepository),
			}),
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
				supervisorActivityStateRoot: runtimeStateRoot,
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
		sourceSkillCandidatesCreate: (selector = "all") =>
			createSourceSkillCandidates({
				stateRoot: masterPlanStateRoot,
				reportsPath,
				projectId: activeProject.id,
				selector,
			}),
		sourceSkillCandidatesReview: (pathOrLatest) =>
			reviewSourceSkillCandidates(pathOrLatest, reportsPath),
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
		formatSourceSkillCandidateCreationResult,
		formatSourceSkillCandidateReview,
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
				...semanticCompactionProjectContext(
					activeProject.path,
					masterPlanStateRoot,
				),
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
		supervisorTick: (options = {}) => {
			const startedAt = Date.now();
			const result = runIduSupervisorLoop({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				labDbPath,
				reportsPath,
				trigger: "manual",
				options: {
					allowSemanticDraft: options.allowSemanticDraft ?? false,
					allowAgentTaskPlan: options.allowAgentTaskPlan ?? false,
					dryRun: false,
				},
				repository: labDbRepository,
				queue: structuredTaskQueue,
			});
			recordSupervisorActivityEventDeferred(
				runtimeStateRoot,
				supervisorActivityInputFromLoopResult(result, {
					origin: "supervisor_manual_tick",
					eventType: "supervisor_tick",
					durationMs: Date.now() - startedAt,
				}),
			);
			return result;
		},
		supervisorConsult: async (consultInput) => {
			const { consultSupervisor } = await import("./supervisor-consult.js");
			return consultSupervisor({
				stateRoot: runtimeStateRoot,
				role: consultInput.role,
				question: consultInput.question,
				context: consultInput.context,
				promptForRole: (role, message, options) =>
					agentRouter.promptForRole(role, message, {
						projectId: activeProject.id,
						stateRoot: runtimeStateRoot,
						invocationSink:
							labDbRepository.appendInvocation.bind(labDbRepository),
					}),
			});
		},
		runCronPreflight: async (preflightInput) => {
			const { runCronPreflight } = await import("./cron-preflight.js");
			return runCronPreflight({
				projectPath: activeProject.path,
				stateRoot: runtimeStateRoot,
				changedFiles: preflightInput.changedFiles,
				promptForRole: (role, message, options) =>
					agentRouter.promptForRole(role, message, {
						projectId: activeProject.id,
						stateRoot: runtimeStateRoot,
						invocationSink:
							labDbRepository.appendInvocation.bind(labDbRepository),
					}),
			});
		},
		checkUserEscalation: async (escalationInput) => {
			const { checkUserEscalation, resolveEscalationPath } = await import(
				"./user-escalation.js"
			);
			const interactionFile = join(
				runtimeStateRoot,
				"last-user-interaction.json",
			);
			let lastUserInteractionAt = escalationInput.lastUserInteractionAt;
			if (!lastUserInteractionAt && existsSync(interactionFile)) {
				try {
					const raw = JSON.parse(readFileSync(interactionFile, "utf8"));
					lastUserInteractionAt = raw.lastInteractionAt;
				} catch {
					// ignore parse errors, fall through to default
				}
			}
			if (!lastUserInteractionAt) {
				// Default: treat as "now" so the hours-since rule does not fire
				// spuriously when the state file is missing.
				lastUserInteractionAt = new Date().toISOString();
			}
			return checkUserEscalation({
				stateRoot: runtimeStateRoot,
				lastUserInteractionAt,
			});
		},
		supervisorCronPlan: () =>
			planIduSupervisorCron({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				labDbPath,
				reportsPath,
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
		executionDirectorTick: () => {
			const now = new Date();
			const supervisorActivity = summarizeSupervisorActivityEvents(
				filterRecentSupervisorActivityEvents(
					readSupervisorActivityEvents(masterPlanStateRoot),
					now,
					SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
				),
			);
			const usageReport = buildIduUsageReport(
				filterRecentIduUsageEvents(
					readIduUsageEvents(masterPlanStateRoot),
					now,
					SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
				),
				{ now },
			);
			const agentLabEffectiveness = buildAgentLabEffectivenessReport(
				readAgentLabEffectivenessEvents(masterPlanStateRoot),
			);
			const semanticDelta = buildSemanticAuditStatus({
				projectId: activeProject.id,
				repository: labDbRepository,
			}).newEvents;
			const selfMaintenance = buildSupervisorSelfMaintenanceAdvisory({
				projectId: activeProject.id,
				now,
				tasks: structuredTaskQueue.listTasks(),
				supervisorEvents: supervisorActivity.totalEvents,
				supervisorActivitySkipped:
					(supervisorActivity.byReason.idu_inactive ?? 0) +
					(supervisorActivity.byReason.no_new_events ?? 0) +
					(supervisorActivity.byReason.not_enough_data ?? 0),
				supervisorActivityThrottled: supervisorActivity.byReason.throttled ?? 0,
				usageFailures: usageReport.unresolvedFailures,
				usageNotAllowed: usageReport.notAllowed,
				usageRequiresHuman: usageReport.requiresHuman,
				agentLabStaleRequests: agentLabEffectiveness.staleRequests,
				semanticNewEvents:
					semanticDelta.labRuns +
					semanticDelta.findings +
					semanticDelta.proposals +
					semanticDelta.tasks +
					semanticDelta.userSignals +
					semanticDelta.memoryItems,
			});
			let currentPlan: ReturnType<typeof reviewMasterPlan>["plan"] | undefined;
			try {
				currentPlan = reviewMasterPlan({
					stateRoot: masterPlanStateRoot,
					pathOrLatest: "latest",
				}).plan;
			} catch {
				currentPlan = undefined;
			}
			return runCliExecutionDirectorTick({
				projectId: activeProject.id,
				stateRoot: masterPlanStateRoot,
				taskTree: buildMasterPlanTaskTree(currentPlan),
				selfMaintenanceSignals: selfMaintenance.signals,
			});
		},
		formatExecutionDirectorTick,
		proposalOutbox: () =>
			new ProposalOutboxStore({
				stateRoot: masterPlanStateRoot,
			}).listProposals(),
		formatProposalOutbox,
		proposalDetail: (id) =>
			new ProposalOutboxStore({ stateRoot: masterPlanStateRoot }).getProposal(
				id,
			),
		formatProposalDetail,
		supervisorOnIduActivation: () => {
			return maybeRunSupervisorOnIduActivation({
				projectId: activeProject.id,
				projectPath: activeProject.path,
				workspaceRoot: runtimeWorkspaceRoot,
				supervisorActivityStateRoot: runtimeStateRoot,
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
		skillDraftFromLessons: (options = {}) =>
			createSkillDraftFromLessons({
				mode: options.mode,
				selector: options.selector,
				reportsPath,
				semanticCompactionInput: {
					projectId: activeProject.id,
					dbPath: labDbPath,
					reportsPath,
					workspaceRoot: runtimeWorkspaceRoot,
					...semanticCompactionProjectContext(
						activeProject.path,
						masterPlanStateRoot,
					),
				},
				createSkillImprovementProposals: (pathOrLatest) =>
					createSkillImprovementProposals(pathOrLatest, reportsPath, {
						workspaceRoot: activeProject.path,
						dbPath: labDbPath,
					}),
				createSkillDraftsFromApprovedProposals: (pathOrLatest) =>
					createSkillDraftsFromApprovedProposals(pathOrLatest, reportsPath),
			}),
		skillDraftReview: (pathOrLatest) =>
			reviewSkillDraft(pathOrLatest, reportsPath),
		formatSkillDraftReview,
		agentLabRequestCreate: (source, pathOrLatest, options) => {
			// B5 PR3 v2 (REQ-B5-5): thread `stateRoot` and `model` from
			// the CLI/MCP surfaces into `createAgentLabReviewRequests` so
			// the create-time auto-pick logic in
			// `resolveCreateTimeModelErrors` actually fires.
			const createOptions = {
				model: options?.model,
				stateRoot: options?.stateRoot ?? masterPlanStateRoot,
			};
			if (source === "postflight") {
				return createAgentLabReviewRequests({
					source: "postflight",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					postflightReport: buildPostflightReport(context),
					...createOptions,
				});
			}
			if (source === "skill-draft") {
				return createAgentLabReviewRequests({
					source: "skill_draft",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					skillDraftPathOrLatest: pathOrLatest ?? "latest",
					...createOptions,
				});
			}
			if (source === "master-plan") {
				return createAgentLabReviewRequests({
					source: "master_plan",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					masterPlanPathOrLatest: pathOrLatest ?? "latest",
					...createOptions,
				});
			}
			if (source === "external-source-intelligence") {
				const sourceRequest =
					options?.context ??
					options?.objective ??
					(pathOrLatest && pathOrLatest !== "latest"
						? pathOrLatest
						: "external-source-intelligence librarian audit");
				const sourceEvidence = recommendSourcesForTask({
					stateRoot: masterPlanStateRoot,
					projectId: activeProject.id,
					request: sourceRequest,
				});
				return createAgentLabReviewRequests({
					source: "external_source_intelligence",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					manualObjective: options?.objective,
					manualContext: options?.context,
					externalSourceLibraryEvidence: {
						request: sourceEvidence.request,
						generatedAt: sourceEvidence.generatedAt,
						matches: sourceEvidence.matches.map((match) => ({
							sourceId: match.sourceId,
							title: match.title,
							chunkIds: match.chunkIds,
							whyRelevant: match.whyRelevant,
							confidence: match.confidence,
						})),
						missingKnowledge: sourceEvidence.missingKnowledge,
						limitations: sourceEvidence.limitations,
						contractPromotionAllowed: false,
					},
					...createOptions,
				});
			}
			if (source === "specialist-audit-plan") {
				return createAgentLabReviewRequests({
					source: "specialist_audit_plan",
					reportsPath: reportsPath,
					projectId: activeProject.id,
					projectPath: activeProject.path,
					manualObjective: options?.objective,
					manualContext: options?.context,
					specialties: options?.specialties,
					...createOptions,
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
		agentLabReviewRun: (pathOrLatest) => {
			// FIX 2 — async dispatch (PR2). The runner pipeline now runs as
			// a detached promise inside dispatchAgentLabReviewRun; the call
			// returns immediately with `{runId, dispatchPath}`. The dispatch
			// sentinel is shaped as a minimal `AgentLabReviewRunResult`
			// (empty runs, dispatched message in `consolidatedSummary`,
			// `safeNotes` carrying `runId` + `dispatchPath`) so the existing
			// `Promise<AgentLabReviewRunResult>` signature is preserved for
			// non-MCP consumers. The detached pipeline writes the canonical
			// `<runId>.json` on completion and emits supervisor activity
			// events via `recordSupervisorActivityEventDeferred`.
			const dispatched = dispatchAgentLabReviewRun({
				reportsPath,
				projectId: activeProject.id,
				projectPath: activeProject.path,
				maxMinutes: 15,
				requestId: `agentlab-review-run-${Date.now()}`,
				runLab: () =>
					runAgentLabReviewRequestFile({
						pathOrLatest,
						reportsPath,
						projectId: activeProject.id,
						projectPath: activeProject.path,
						router: agentRouter,
						modelAssignments,
						// B5 PR3 v2 (REQ-B5-5): thread `stateRoot` and
						// `invocationSink` so the runner's `usePromptForRole`
						// branch fires when `request.model` is set.
						stateRoot: masterPlanStateRoot,
						invocationSink: labDbRepository.appendInvocation.bind(labDbRepository),
					}),
				onActivity: (event) => {
					// Supervisor activity emission. Uses the deferred helper
					// already imported at the top of this module — no new
					// event types introduced (design D8). The dispatch kind
					// is carried via `status` + `reason` (allowed unions).
					const status = event.kind === "dispatch_failed" ? "warning" : "completed";
					const reason = event.kind === "dispatch_failed" ? "supervisor_failed" : undefined;
					recordSupervisorActivityEventDeferred(runtimeStateRoot, {
						projectId: activeProject.id,
						eventType: "supervisor_tick",
						origin: "pi_runtime_event",
						trigger: "manual",
						status,
						...(reason ? { reason } : {}),
						ok: event.kind !== "dispatch_failed",
						durationMs: Date.now(),
					});
				},
			}, "general");
			const dispatchEnvelope: AgentLabReviewRunResult = {
				generatedAt: dispatched.startedAt,
				sourceRequestFile: "dispatch",
				warning: "Revisión AgentLab. No aplica cambios.",
				projectId: activeProject.id,
				runs: [],
				consolidatedSummary: `AgentLab review run dispatched: ${dispatched.runId}`,
				consolidatedFindings: [],
				recommendedNext: `Poll agentlab_review_status ${dispatched.runId}`,
				requiresHumanApproval: false,
				safeNotes: [
					"AgentLab review dispatched as fire-and-forget (Fix 2).",
					`runId: ${dispatched.runId}`,
					`dispatchPath: ${dispatched.dispatchPath}`,
					`Poll status with: agentlab_review_status ${dispatched.runId}`,
				],
				path: dispatched.dispatchPath,
			};
			return Promise.resolve(dispatchEnvelope);
		},
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
				supervisorActivityStateRoot: runtimeStateRoot,
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
		queueComplete: (id, evidence) =>
			completeStructuredTaskById(structuredTaskQueue, id, evidence),
		modelInvocationStatus: (options) => {
			return buildModelInvocationStatusOrError({
				projectId: activeProject.id,
				stateRoot: masterPlanStateRoot,
				labDbPath: labDbPath,
				options,
			});
		},
		formatModelInvocationStatus,
		getOrchestratorAdvisory: (options) => {
			const stream = getOrchestratorAdvisoryStream(masterPlanStateRoot);
			return stream.getAdvisories({
				roleId: options?.roleId,
				sinceMs: options?.sinceMs,
				limit: options?.limit,
			});
		},
		formatOrchestratorAdvisory,
		getRoleEngineStatus: () => {
			const stream = getOrchestratorAdvisoryStream(masterPlanStateRoot);
			const config = resolveRoleEngineConfig(masterPlanStateRoot);
			const advisories = stream.getAdvisories();

			// Extract last fire per role from advisories
			const lastFiresMap = new Map<string, string>();
			for (const adv of advisories) {
				lastFiresMap.set(adv.roleId, adv.ts);
			}
			const lastFires = Array.from(lastFiresMap.entries()).map(
				([roleId, lastFireAt]) => ({
					roleId,
					lastFireAt,
				}),
			);

			return {
				config,
				lastFires,
				lastCapWarning: undefined, // Cap warning tracking not yet implemented in engine state
				advisoryStreamSummary: {
					totalAdvisories: advisories.length,
					lastAdvisory:
						advisories.length > 0
							? advisories[advisories.length - 1].ts
							: undefined,
				},
			};
		},
		formatRoleEngineStatus,
		saveRoleEngineConfig: (patch) =>
			saveRoleEngineConfig(masterPlanStateRoot, patch),
		rebindRoleEngine: () =>
			rebindRoleEngineSubscription({
				projectId: activeProject.id,
				stateRoot: masterPlanStateRoot,
				router: agentRouter,
				repository: labDbRepository,
			}),
		unbindRoleEngine: () => unbindRoleEngineSubscription(activeProject.id),
		activeProfileId: () => agentRouter.activeProfile().id,
	};
}

export function normalizeCliArgs(args: string[]): string[] {
	return args[0] === "--" ? args.slice(1) : args;
}

/**
 * Parse the rest-args of `idu-agentlab-request-create`. Mirrors
 * `parseModelInvocationStatusArgs` style: first token is the source
 * (defaults to `postflight`); the rest is the selector, with two
 * optional flag pairs (`--model <id>` and `--state-root <path>`).
 *
 * Unknown flags throw so the CLI surfaces a clear error.
 */
export function parseAgentLabRequestCreateArgs(rawArgs: readonly string[]): {
	source: string;
	selector: string;
	model?: string;
	stateRoot?: string;
} {
	const args = [...rawArgs];
	const source = args.shift() ?? "postflight";
	let model: string | undefined;
	let stateRoot: string | undefined;
	const selectorTokens: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--model") {
			const value = args[i + 1];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error("--model requiere un valor");
			}
			model = value;
			i++;
			continue;
		}
		if (arg === "--state-root") {
			const value = args[i + 1];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error("--state-root requiere un valor");
			}
			stateRoot = value;
			i++;
			continue;
		}
		selectorTokens.push(arg);
	}
	const selector = selectorTokens.join(" ").trim() || "latest";
	return {
		source,
		selector,
		...(model !== undefined ? { model } : {}),
		...(stateRoot !== undefined ? { stateRoot } : {}),
	};
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
		// idu-hygiene-migrate is one-shot: it operates on a repo path
		// (default: cwd), not on a registered project. Run it BEFORE
		// createCliRuntime so a user with no registered project can
		// still migrate their legacy layout.
		if (
			(command === "idu-hygiene-migrate" || command === "hygiene-migrate") &&
			!runtime
		) {
			const parsed = parseHygieneMigrateArgs(rest);
			const repoRoot = parsed.repoRoot ?? process.cwd();
			const stateRoot = process.env.AGENT_WORKSPACE_ROOT ?? repoRoot;
			try {
				const result: MigrationResult = migrateHygieneLayout({
					repoRoot,
					stateRoot,
				});
				return {
					exitCode: result.errors.length > 0 ? 1 : 0,
					stdout: formatHygieneMigrateResult(repoRoot, result),
					stderr: "",
				};
			} catch (err) {
				return fail(err instanceof Error ? err.message : String(err));
			}
		}
		const activeRuntime =
			runtime ??
			createCliRuntime({
				// The supervisor tick (idu-run-cron-preflight) must fail loud
				// when the registry is missing — auto-creating a "default"
				// project would silently audit whatever defaultCwd points at,
				// which is a foot-gun. Same posture as `status`: read-only,
				// no side effects, no auto-create. Other commands (idu,
				// install, setup, etc.) keep the auto-create UX for first-use
				// onboarding.
				createRegistryIfMissing:
					command !== "status" && command !== "idu-run-cron-preflight",
				requireTelegramConfig: false,
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
			case "automaticov1":
			case "idu-automaticov1":
				return await handleAutomaticov1(activeRuntime, command, rest);
			case "status":
				return handleStatus(activeRuntime);
			case "idu":
				return handleIdu(activeRuntime, command);
			case "idu-off":
				return handleIduOff(activeRuntime, command);
			case "idu-status":
				return handleIduStatus(activeRuntime, command);
			case "alerts":
			case "idu-alerts":
				return handleAlerts(activeRuntime, rest);
			case "events":
			case "idu-events":
				return handleEvents(activeRuntime, rest);
			case "idu-alerts-status":
			case "alerts-status":
				return handleAlertsStatus(activeRuntime);
			case "idu-alerts-tick":
			case "alerts-tick":
				return handleAlertsTick(activeRuntime, rest);
			case "idu-alerts-scheduled-tick":
			case "alerts-scheduled-tick":
				return handleAlertsScheduledTick(activeRuntime, rest);
			case "idu-prepare":
			case "prepare":
				return handleIduPrepare(activeRuntime, command);
			case "idu-project-reset-state":
			case "project-reset-state":
				return handleIduProjectResetState(activeRuntime, rest);
			case "idu-master-plan-status":
			case "master-plan-status":
				return handleMasterPlanStatus(activeRuntime);
			case "idu-master-plan-review":
			case "master-plan-review":
				return handleMasterPlanReview(activeRuntime, rest);
			case "idu-master-plan-approve":
			case "master-plan-approve":
				return handleMasterPlanApprove(activeRuntime, rest);
			case "idu-master-plan-reject":
			case "master-plan-reject":
				return handleMasterPlanReject(activeRuntime, rest);
			case "idu-master-plan-redraft":
			case "master-plan-redraft":
				return handleMasterPlanRedraft(activeRuntime, rest);
			case "idu-hygiene-migrate":
			case "hygiene-migrate":
				return handleIduHygieneMigrate(activeRuntime, rest);
			case "idu-ack-advisory":
			case "ack-advisory":
				return handleIduAckAdvisory(activeRuntime, rest);
			case "idu-hygiene-sweep":
			case "hygiene-sweep":
				return handleIduHygieneSweep(activeRuntime);
			case "idu-skills-deploy":
			case "skills-deploy":
				return handleIduSkillsDeploy(activeRuntime, rest);
			case "idu-source-status":
			case "source-status":
				return handleSourceStatus(activeRuntime);
			case "idu-source-add":
			case "source-add":
				return handleSourceAdd(activeRuntime, rest);
			case "idu-source-remove":
			case "source-remove":
				return handleSourceRemove(activeRuntime, rest);
			case "idu-source-read":
			case "source-read":
				return handleSourceRead(activeRuntime, rest);
			case "idu-source-extract":
			case "source-extract":
				return handleSourceExtract(activeRuntime, rest);
			case "idu-source-report":
			case "source-report":
				return handleSourceReport(activeRuntime, rest);
			case "idu-source-research":
			case "source-research":
				return handleSourceResearch(activeRuntime, rest);
			case "idu-source-digest":
			case "source-digest":
				return handleSourceDigest(activeRuntime, rest);
			case "idu-source-digest-status":
			case "source-digest-status":
				return handleSourceDigestStatus(activeRuntime);
			case "idu-source-chunk-read":
			case "source-chunk-read":
				return handleSourceChunkRead(activeRuntime, rest);
			case "idu-source-recommend":
			case "source-recommend":
				return handleSourceRecommend(activeRuntime, rest);
			case "idu-source-required-actions":
			case "source-required-actions":
				return handleSourceRequiredActions(activeRuntime);
			case "idu-source-skill-candidates-create":
			case "source-skill-candidates-create":
				return handleSourceSkillCandidatesCreate(activeRuntime, rest);
			case "idu-source-skill-candidates-review":
			case "source-skill-candidates-review":
				return handleSourceSkillCandidatesReview(activeRuntime, rest);
			case "idu-source-refresh":
			case "source-refresh":
				return handleSourceRefresh(activeRuntime);
			case "idu-preflight":
			case "preflight":
				return handleIduPreflight(activeRuntime, command, rest);
			case "idu-advisory":
			case "advisory":
				return handleIduAdvisory(activeRuntime, command, rest);
			case "idu-postflight":
			case "postflight":
				return handleIduPostflight(activeRuntime, command);
			case "idu-run-cron-preflight":
				return await handleRunCronPreflight(activeRuntime, rest);
			case "idu-objective-status":
				return handleIduObjectiveStatus(activeRuntime);
			case "idu-check-user-escalation":
				return await handleCheckUserEscalation(activeRuntime);
			case "idu-usage-status":
			case "usage-status":
				return await handleUsageStatus(activeRuntime);
			case "idu-lab-review-plan":
			case "lab-review-plan":
				return handleLabReviewPlan(activeRuntime, rest);
			case "idu-review":
			case "review":
			case "revisar":
				return await handleReview(activeRuntime);
			case "idu-model-invocation-status":
			case "model-invocation-status":
				return handleModelInvocationStatus(activeRuntime, rest);
			case "idu-orchestrator-advisory":
			case "orchestrator-advisory":
				return handleOrchestratorAdvisory(activeRuntime, rest);
			case "idu-role-engine":
			case "role-engine":
				return handleRoleEngine(activeRuntime, rest);
			case "idu-role-engine-status":
			case "role-engine-status":
				return handleRoleEngineStatus(activeRuntime, rest);
			case "idu-agentlab-request-create":
			case "agentlab-request-create":
				return handleAgentLabRequestCreate(activeRuntime, rest);
			case "idu-agentlab-request-review":
			case "agentlab-request-review":
				return handleAgentLabRequestReview(activeRuntime, rest);
			case "idu-agentlab-review-run":
			case "agentlab-review-run":
				return await handleAgentLabReviewRun(activeRuntime, rest);
			case "idu-agentlab-review-status":
			case "agentlab-review-status":
				return handleAgentLabReviewStatus(activeRuntime, rest);
			case "idu-agentlab-report-consolidate":
			case "agentlab-report-consolidate":
				return handleAgentLabReportConsolidate(activeRuntime, rest);
			case "idu-agentlab-report-consolidation-status":
			case "agentlab-report-consolidation-status":
				return handleAgentLabReportConsolidationStatus(activeRuntime, rest);
			case "idu-semantic-audit-status":
			case "semantic-audit-status":
				return handleSemanticAuditStatus(activeRuntime);
			case "idu-semantic-audit-run":
			case "semantic-audit-run":
				return handleSemanticAuditRun(activeRuntime);
			case "idu-semantic-compact-draft":
			case "semantic-compact-draft":
				return handleSemanticCompactDraft(activeRuntime);
			case "idu-semantic-compact-review":
			case "semantic-compact-review":
				return handleSemanticCompactReview(activeRuntime, rest);
			case "idu-semantic-agent-tasks-review":
			case "semantic-agent-tasks-review":
				return handleSemanticAgentTasksReview(activeRuntime, rest);
			case "idu-semantic-agent-tasks-create":
			case "semantic-agent-tasks-create":
				return handleSemanticAgentTasksCreate(activeRuntime, rest);
			case "idu-supervisor-tick":
			case "supervisor-tick":
				return handleSupervisorTick(activeRuntime);
			case "idu-execution-director-tick":
			case "execution-director-tick":
				return handleExecutionDirectorTick(activeRuntime);
			case "idu-proposal-outbox":
			case "proposal-outbox":
				return handleProposalOutbox(activeRuntime);
			case "idu-proposal-detail":
			case "proposal-detail":
				return handleProposalDetail(activeRuntime, rest);
			case "idu-supervisor-improvements-review":
			case "supervisor-improvements-review":
				return handleSupervisorImprovementsReview(activeRuntime, rest);
			case "idu-supervisor-improvements-create":
			case "supervisor-improvements-create":
				return handleSupervisorImprovementsCreate(activeRuntime, rest);
			case "idu-supervisor-improvements-status":
			case "supervisor-improvements-status":
				return handleSupervisorImprovementsStatus(activeRuntime, rest);
			case "idu-supervisor-improvements-approve":
			case "supervisor-improvements-approve":
				return handleSupervisorImprovementsApprove(activeRuntime, rest);
			case "idu-supervisor-improvements-reject":
			case "supervisor-improvements-reject":
				return handleSupervisorImprovementsReject(activeRuntime, rest);
			case "idu-supervisor-improvements-defer":
			case "supervisor-improvements-defer":
				return handleSupervisorImprovementsDefer(activeRuntime, rest);
			case "idu-supervisor-improvements-apply":
			case "supervisor-improvements-apply":
				return handleSupervisorImprovementsApply(activeRuntime, rest);
			case "idu-supervisor-learning-rules-status":
			case "supervisor-learning-rules-status":
				return handleSupervisorLearningRulesStatus(activeRuntime);
			case "idu-supervisor-learning-rules-test":
			case "supervisor-learning-rules-test":
				return handleSupervisorLearningRulesTest(activeRuntime);
			case "idu-supervisor-learning-rules-disable":
			case "supervisor-learning-rules-disable":
				return handleSupervisorLearningRulesDisable(activeRuntime, rest);
			case "idu-supervisor-learning-rules-enable":
			case "supervisor-learning-rules-enable":
				return handleSupervisorLearningRulesEnable(activeRuntime, rest);
			case "idu-supervisor-learning-rules-rollback":
			case "supervisor-learning-rules-rollback":
				return handleSupervisorLearningRulesRollback(activeRuntime, rest);
			case "idu-skill-improvements-review":
			case "skill-improvements-review":
				return handleSkillImprovementsReview(activeRuntime, rest);
			case "idu-skill-improvements-create":
			case "skill-improvements-create":
				return handleSkillImprovementsCreate(activeRuntime, rest);
			case "idu-skill-improvements-status":
			case "skill-improvements-status":
				return handleSkillImprovementsStatus(activeRuntime, rest);
			case "idu-skill-improvements-approve":
			case "skill-improvements-approve":
				return handleSkillImprovementsApprove(activeRuntime, rest);
			case "idu-skill-improvements-reject":
			case "skill-improvements-reject":
				return handleSkillImprovementsReject(activeRuntime, rest);
			case "idu-skill-improvements-defer":
			case "skill-improvements-defer":
				return handleSkillImprovementsDefer(activeRuntime, rest);
			case "idu-skill-drafts-create":
			case "skill-drafts-create":
				return handleSkillDraftsCreate(activeRuntime, rest);
			case "idu-skill-drafts-review":
			case "skill-drafts-review":
				return handleSkillDraftsReview(activeRuntime, rest);
			case "idu-task":
			case "task":
				return handleTask(activeRuntime, rest);
			case "idu-queue":
			case "queue":
			case "idu-queue-detail":
			case "queue-detail":
				return handleQueueDetail(activeRuntime);
			case "idu-queue-clear-structured":
			case "queue-clear-structured":
				return handleQueueClearStructured(activeRuntime);
			case "idu-queue-approve":
			case "queue-approve":
			case "queue_approve":
				return handleQueueApprove(activeRuntime, rest);
			case "idu-queue-reject":
			case "queue-reject":
			case "queue_reject":
				return handleQueueReject(activeRuntime, rest);
			case "idu-queue-complete":
			case "queue-complete":
			case "queue_complete":
				return handleQueueComplete(activeRuntime, rest);
			case "idu-birth-status":
			case "birth-status":
				return handleBirthStatus(activeRuntime);
			case "idu-birth-existing-scan":
			case "birth-existing-scan":
				return handleBirthExistingScan(activeRuntime);
			case "idu-birth-bibliotecario-discovery":
			case "birth-bibliotecario-discovery":
				return handleBirthBibliotecarioDiscovery(activeRuntime);
			case "idu-onboard-project":
			case "onboard-project":
				return handleIduOnboardProject(activeRuntime);
			case "idu-bibliotecario-init":
			case "bibliotecario-init":
				return handleIduBibliotecarioInit(activeRuntime);
			case "idu-skill-rating":
			case "skill-rating":
				return handleSkillRating(activeRuntime, rest);
			case "idu-birth-validate":
			case "birth-validate":
				return handleBirthValidate(activeRuntime);
			case "idu-birth-general-spec":
			case "birth-general-spec":
				return await handleBirthGeneralSpec(activeRuntime, rest);
			case "idu-birth-general-spec-derive":
			case "birth-general-spec-derive":
				return await handleBirthGeneralSpecDerive(activeRuntime, rest);
			case "idu-birth-prototype-master":
			case "birth-prototype-master":
				return handleBirthPrototypeMaster(activeRuntime, rest);
			case "idu-pending-injections":
			case "pending-injections":
				return handleIduPendingInjections(activeRuntime, rest);
			case "idu-decision-ledger":
			case "decision-ledger":
				return handleIduDecisionLedger(activeRuntime, rest);
			case "idu-outbox-prune":
			case "outbox-prune":
				return handleIduOutboxPrune(activeRuntime, rest);
			case "idu-subscribe-triggers":
			case "subscribe-triggers":
				return handleIduSubscribeTriggers();
			case "idu-supervisor-trigger":
			case "supervisor-trigger":
				return handleSupervisorTrigger(activeRuntime, rest);
			case "idu-trigger-engine":
			case "trigger-engine":
				return handleIduTriggerEngine(activeRuntime, rest);
			case "idu-birth-repo-plan":
			case "birth-repo-plan":
				return handleBirthRepoPlan(activeRuntime, rest);
			case "idu-trigger-show":
				return handleIduTriggerShow(rest);
			case "idu-lock-cleanup":
			case "lock-cleanup":
				return handleLockCleanup(activeRuntime, rest);
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

async function runBootstrapIduCommand(): Promise<string> {
	const config = loadConfig({ requireTelegram: false });
	process.env.AGENT_WORKSPACE_ROOT ??= config.agentWorkspaceRoot;
	const bootstrap = runIduBootstrap({
		projectPath: process.cwd(),
		config,
		registryPath: resolveIduRegistryPath(),
		consentGiven: true,
	});
	const activeRuntime = createCliRuntime({
		projectPath: bootstrap.project.path,
		requireTelegramConfig: false,
	});
	const supervisorStartup = activeRuntime.supervisorOnIduActivation();
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
	return [...formatCliSupervisorStartupSection(supervisorStartup), finalReport]
		.filter((line) => line.length > 0)
		.join("\n");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const normalizedArgs = normalizeCliArgs(args);
	if (shouldRunInteractiveHome(normalizedArgs)) {
		const taskQueueRuntime = buildHomeTaskQueueRuntime();
		const output = await runInteractiveHome(taskQueueRuntime);
		if (output) console.log(output);
		return;
	}
	const result = await runCliCommand(args);
	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	// Use exitCode instead of process.exit() so Node drains the event
	// loop and flushes stdout/stderr before the process ends. Without
	// this, on Windows runners (Node 22+), console.error + process.exit()
	// can drop stderr (e.g. the L946 "No hay proyecto activo" error
	// from createCliRuntime), which breaks subprocess-stdout-capture
	// assertions like test/idu-supervisor-tick-resolves-project.test.ts.
	process.exitCode = result.exitCode;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	void main();
}
