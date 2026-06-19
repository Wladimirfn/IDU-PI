#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
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
import { readPendingBlockingInjection } from "./objective-injection.js";
import { recordLifecycleEvent } from "./telemetry-lifecycle.js";
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
	runIdOrchestratorAdvisoryCommand,
	runIdRoleEngineCommand,
	runIdRoleEngineStatusCommand,
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
	migrateHygieneLayout,
	type MigrationResult,
} from "./hygiene-migrate.js";
import { planSweep, type PlanSweepResult } from "./sweep-command.js";
import { runHygieneSensor } from "./hygiene-sensor.js";
import { ackAdvisory, type AckAdvisoryResult } from "./idu-ack-advisory.js";
import {
	runBibliotecarioInit,
	formatBibliotecarioInit,
} from "./cli-bibliotecario-init.js";
import { runOnboardProject } from "./cli-onboard-project.js";
import { runSkillRating, formatSkillRating } from "./cli-skill-rating.js";
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
import { buildIduExecutionReadiness } from "./idu-execution-readiness.js";
import {
	handleBirthStatus,
	handleBirthExistingScan,
	handleBirthBibliotecarioDiscovery,
	handleBirthValidate,
	handleBirthRepoPlan,
	type BirthStatusEnvelope,
	type BirthExistingScanEnvelope,
	type BirthBibliotecarioEnvelope,
	type BirthValidateEnvelope,
	type BirthRepoPlanEnvelope,
	type BirthRepoPlan,
} from "./birth-runtime.js";
import {
	approveBirthGeneralSpec,
	type ApproveBirthGeneralSpecResult,
} from "./birth-general-spec-runtime.js";
import {
	runVisualDerivation,
	type VisualDerivationPrompt,
	type VisualDerivationResult,
} from "./birth-general-spec-derive.js";
import {
	handleBirthPrototypeMaster,
	type BirthPrototypeMasterEnvelope,
} from "./birth-prototype-runtime.js";
import { runTriggerEngineTickOptIn } from "./trigger-engine-invocation.js";
import { runMcpContextPackAutoRefreshTick } from "./mcp-context-pack-auto-refresh-invocation.js";
import { formatScheduledTickSkippedDetail } from "./alerts-scheduled-tick-skipped-detail.js";
import {
	formatInspectEventsReport,
	inspectEvents,
} from "./events-inspector.js";
import {
	appendInjection,
	readPendingInjections,
	markInjectionAcked,
	type Injection,
} from "./injection-store.js";
import { applyPrune, planPrune } from "./idu-outbox-prune.js";
import { listDecisions } from "./decision-ledger.js";
import { emitAlertsScheduledTick } from "./role-events.js";
import { TRIGGER_DEFINITIONS } from "./trigger-engine.js";
import { readBirthArtifact } from "./birth-artifacts.js";
import {
	buildExecutionDirectorTick,
	type ExecutionDirectorTickInput,
	type ExecutionDirectorTickResult,
} from "./execution-director-tick.js";
import { buildMasterPlanTaskTree } from "./master-plan-task-tree.js";
import {
	ProposalOutboxStore,
	type FlowBoundProposal,
} from "./proposal-outbox.js";
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
import {
	readProjectAlignmentState,
	recordProjectAlignmentState,
} from "./project-alignment-state.js";
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
	type IduMcpTarget,
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
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
	formatSupervisorTriggerStatus,
	getSupervisorTriggerStatus,
} from "./supervisor-trigger.js";
import {
	disableTriggerEngineConfig,
	enableTriggerEngineConfig,
	formatTriggerEngineConfigResult,
	formatTriggerEngineConfigStatus,
	getTriggerEngineConfigStatus,
} from "./trigger-engine-config.js";
import {
	analyzeStructuredTaskSignal,
	formatStructuredTaskQueueDetail,
	formatTareasView,
	formatTareasYCola,
	renderTaskQueuePanel,
	StructuredTaskQueue,
	structuredTaskInputForText,
	type StructuredTask,
} from "./structured-task-queue.js";
import {
	formatColaDeAccionesFeed,
	readColaDeAccionesFeed,
} from "./cola-acciones-feed.js";
import {
	buildTaskPrompt,
	formatTaskTemplateHelp,
	inferTaskTemplateKind,
	type TaskTemplateKind,
} from "./task-templates.js";
import { existsSync, readFileSync } from "node:fs";
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
	type IduModelRoleId,
} from "./model-assignments.js";
import {
	buildUnifiedModelCatalog,
	modelProviderDisplayKey,
	modelProviderDisplayLabel,
	readPiModelCatalogSnapshot,
	resolvePiModelCatalogSnapshotPath,
} from "./model-catalog.js";
import {
	buildIduUsageReport,
	filterRecentIduUsageEvents,
	flushIduUsageEvents,
	formatIduUsageSummary,
	readIduUsageEvents,
	recordIduUsageEventDeferred,
	summarizeIduUsageEvents,
} from "./usage-events.js";
import { recordCliUsage } from "./cli/usage.js";
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
	buildAutonomousAlertEngineReport,
	type AutonomousAlertDecision,
	type AutonomousAlertEngineReport,
} from "./autonomous-alert-engine.js";
import {
	runAutomaticov1AdvisoryCycle,
	type Automaticov1CycleResult,
} from "./automaticov1-cycle.js";
import {
	runAutonomousAlertScheduledTick,
	type AutonomousAlertScheduledTickResult,
} from "./autonomous-alert-scheduler.js";
import { emitStuckTaskEventsFromAlertReport } from "./autonomous-alert-engine-event-bridge.js";
import {
	appendDigestQueueEntry,
	classifyInterrupt,
	maybeFlushDigest,
	type DigestSignal,
} from "./digest.js";
import {
	appendAutonomousAlertDecision,
	readAutonomousAlertEngineState,
	updateAutonomousAlertControlState,
	type AutonomousAlertEngineState,
} from "./autonomous-alert-engine-state.js";
import { buildExternalIntelligenceReport } from "./external-intelligence.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "./external-source-registry.js";
import {
	buildSupervisorSelfMaintenanceAdvisory,
	SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
	type SupervisorSelfMaintenanceAdvisory,
} from "./supervisor-self-maintenance-advisory.js";

// CliResult moved to src/cli/dispatch-glue/types.ts (PR 1 of Item 4, cluster Q).
// The typecheck guard (npx tsc --noEmit) verifies all consumers still resolve.
import type { CliResult } from "./cli/dispatch-glue/index.js";
// Internal imports (Q cluster helpers, used throughout cli.ts).
import {
	ok,
	fail,
	helpText,
	requiredText,
	requiredArg,
	requiredDecisionParts,
	requiredRuleDecisionParts,
	primaryIntentConcept,
	cliCommandFor,
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
	runWizardActivateSupervisor,
	registeredProjectForPath,
	requiredEnvForWizard,
	parseAllowedRootsForWizard,
	wizardActivationDiagnostic,
} from "./cli/wizard/index.js";
import {
	formatPendingInjections,
	formatTriggerSubscription,
} from "./cli/tail-formatters/index.js";
import {
	handleSetupCommand,
	parseMcpTarget,
	handleProjectCommand,
	inspectConnection,
	formatCliSupervisorStartupSection,
	formatDashboard,
	buildPreflightReport,
	buildPostflightReport,
	runPrepare,
	loadConfirmedProjectConstitution,
} from "./cli/setup/index.js";
// (PR 2 imports already exist above; this is just an anchor for the editor)
import {
	loadAutomaticov1Plan,
	loadCliExecutionReadiness,
	safeProjectCoreStatus,
	safeProjectConstitutionStatus,
	runCliExecutionDirectorTick,
	formatExecutionDirectorTick,
	formatProposalOutbox,
	formatProposalDetail,
	runCliAutomaticov1Cycle,
	formatCliAutomaticov1Cycle,
	handleCliEventsInspectCommand,
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
import {
	parseBirthGeneralSpecCliInput,
	parseGeneralSpecSections,
	requiredStringArray,
	isObjectRecord,
	formatBirthGeneralSpec,
	parseUiFiles,
	formatBirthGeneralSpecDerivation,
	formatBirthStatus,
	formatBirthExistingScan,
	formatBirthBibliotecario,
	formatBirthValidate,
	formatBirthRepoPlan,
	formatBirthPrototype,
} from "./cli/birth/index.js";
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
import {
	handleCliAlertCommand,
	buildCliAutonomousAlertStatus,
	runCliAutonomousAlertTick,
	digestSignalFromAlertDecision,
	buildAlertRouteInjection,
	runCliAutonomousAlertScheduledTick,
	runCliAutonomousAlertControl,
	formatCliAutonomousAlertReport,
	formatCliAutonomousAlertScheduledTick,
	formatCliAutonomousAlertControl,
	positiveIntegerText,
	emitIduProgress,
} from "./cli/alerts/index.js";
import type {
	CliAutonomousAlertTickResult,
	CliAutonomousAlertControlResult,
	DigestAlertRoutingResult,
} from "./cli/alerts/index.js";
// routeAlertDecisionsForDigest is exported (public surface, snapshot test pins it).
import { routeAlertDecisionsForDigest } from "./cli/alerts/index.js";
import {
	runMasterPlanDeepReview,
	runOrReuseMasterPlanDeepReview,
} from "./cli/agentlab/index.js";

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
import {
	modelAssignmentOptions,
	modelAssignmentOptionGroups,
	formatModelAssignmentOptionLabel,
	resolveRoleSelection,
	resolveAssignmentSelection,
	validateAgentProfiles,
} from "./cli/role/index.js";

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
import {
	semanticCompactionProjectContext,
	strongestGuardRisk,
} from "./cli/queue/index.js";
import type {
	TaskQueuePanelDispatchRuntime,
	TaskQueuePanelDispatchResult,
} from "./cli/queue/index.js";



export type CliRuntime = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	labDbPath?: string;
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
	};
	return {
		projectId: activeProject.id,
		projectPath: activeProject.path,
		workspaceRoot: runtimeWorkspaceRoot,
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
					...semanticCompactionProjectContext(activeProject.path),
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
		agentLabReviewRun: (pathOrLatest) =>
			runAgentLabReviewRequestFile({
				pathOrLatest,
				reportsPath: reportsPath,
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

function pisoBannerLine(workspaceRoot: string): string {
	const blocking = readPendingBlockingInjection(workspaceRoot);
	if (!blocking) return "";
	const mins = Math.floor(blocking.ageMs / 60_000);
	return `\u26a0 BLOCKING: ${blocking.severity} ${blocking.kind} — ${blocking.summary} (acked=${blocking.acked}, ageMs=${blocking.ageMs} ~${mins}m) — pull \`idu_pending_injections\` and act\n`;
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
				createRegistryIfMissing: command !== "status",
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
				return ok(
					activeRuntime.formatConnection(activeRuntime.inspectConnection()),
				);
			case "idu": {
				activateIduSession(activeRuntime.projectId);
				const supervisorStartup = activeRuntime.supervisorOnIduActivation();
				recordCliUsage(activeRuntime, command, { ok: true });
				return ok(
					[
						"Guardrails automáticos activados para el proyecto activo.",
						...formatCliSupervisorStartupSection(supervisorStartup),
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
				const banner = pisoBannerLine(activeRuntime.workspaceRoot);
				return ok(banner + formatIduSessionStatus(status));
			}
			case "alerts":
			case "idu-alerts":
				return handleCliAlertCommand(activeRuntime, rest);
			case "events":
			case "idu-events":
			return handleEvents(activeRuntime, rest);
			case "idu-alerts-status":
			case "alerts-status":
				return ok(
					formatCliAutonomousAlertReport(
						buildCliAutonomousAlertStatus(activeRuntime),
					),
				);
			case "idu-alerts-tick":
			case "alerts-tick":
				return ok(
					formatCliAutonomousAlertReport(
						runCliAutonomousAlertTick(activeRuntime, {
							allowTaskCreation: rest.includes("--allow-task-creation"),
						}),
					),
				);
			case "idu-alerts-scheduled-tick":
			case "alerts-scheduled-tick":
				return ok(
					formatCliAutonomousAlertScheduledTick(
						runCliAutonomousAlertScheduledTick(activeRuntime, {
							allowTaskCreation: rest.includes("--allow-task-creation"),
						}),
					),
				);
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
			case "hygiene-migrate": {
				const parsed = parseHygieneMigrateArgs(rest);
				const repoRoot = parsed.repoRoot ?? activeRuntime.projectPath;
				if (!repoRoot) {
					return fail(
						"idu-hygiene-migrate requiere --repo-root <path> o un proyecto activo.",
					);
				}
				const result: MigrationResult = migrateHygieneLayout({
					repoRoot,
					stateRoot: activeRuntime.workspaceRoot,
				});
				return {
					exitCode: result.errors.length > 0 ? 1 : 0,
					stdout: formatHygieneMigrateResult(repoRoot, result),
					stderr: "",
				};
			}
			case "idu-ack-advisory":
			case "ack-advisory": {
				const injectionId = rest[0];
				if (!injectionId) {
					return fail("Usage: idu-ack-advisory <injectionId> [reason...]");
				}
				const reason = rest.slice(1).join(" ").trim() || undefined;
				const result: AckAdvisoryResult = ackAdvisory({
					stateRoot: activeRuntime.workspaceRoot,
					injectionId,
					reason,
				});
				return ok(`acked ${result.injectionId} (${result.reason})`);
			}
			case "idu-hygiene-sweep":
			case "hygiene-sweep": {
				const repoRoot = activeRuntime.projectPath;
				if (!repoRoot) {
					return fail(
						"idu-hygiene-sweep requiere un proyecto activo (activeRuntime.projectPath).",
					);
				}
				const stateRoot = activeRuntime.workspaceRoot;
				const sensorOutput = runHygieneSensor({
					stateRoot,
					repoPath: repoRoot,
				});
				const sweep: PlanSweepResult = planSweep({
					sensorOutput,
					stateRoot,
					repoPath: repoRoot,
					mode: "advisory",
				});
				return {
					exitCode: 0, // advisory only — never fail
					stdout: formatHygieneSweepResult(repoRoot, sweep),
					stderr: "",
				};
			}
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
			case "idu-run-cron-preflight": {
				// Cron entry point: runs postflight → sensor → AgentLab →
				// supervisor chain and writes a supervisor_advisory to
				// injections.jsonl. Reuses the same promptForRole as the
				// MCP path so role-rails and cooldowns are shared.
				const result = await activeRuntime.runCronPreflight?.({
					changedFiles: rest,
				});
				if (!result) {
					return ok("Cron preflight: not available in this runtime\n");
				}
				const advisoryLine = result.supervisorAdvisory
					? (result.supervisorAdvisory.advisory?.summary ??
						result.supervisorAdvisory.reason ??
						"ok")
					: "null";
				return ok(
					`Cron preflight: sensorImpulses=${result.sensorImpulses.length} supervisorAdvisory=${advisoryLine}\n`,
				);
			}
			case "idu-objective-status": {
				// PR-A of objective-injection (PISO gate read path).
				// Read-only: no side effects, no enqueue. Use this to verify
				// the current PISO gate state from the CLI.
				const blocking = readPendingBlockingInjection(
					activeRuntime.workspaceRoot,
				);
				const statePath = join(
					activeRuntime.workspaceRoot,
					"objective-reminder.json",
				);
				const reminderExists = existsSync(statePath);
				return ok(
					`objective_reminder state:\n` +
						`  blocking: ${blocking ? `${blocking.severity} ${blocking.kind} (acked=${blocking.acked}, ageMs=${blocking.ageMs})` : "none"}\n` +
						`  state_file: ${reminderExists ? statePath : "not created yet"}\n`,
				);
			}
			case "idu-check-user-escalation": {
				// PR-105c. Reads last-user-interaction.json (if present) and
				// runs the user escalation check. Writes user-escalations.jsonl
				// if any threshold is breached.
				const result = await activeRuntime.checkUserEscalation?.({});
				if (!result) {
					return ok("User escalation: not available in this runtime\n");
				}
				if (result.shouldEscalate) {
					return ok(
						`User escalation: shouldEscalate=true reasons=${result.reasons.join(",")} critical=${result.counts.critical} total=${result.counts.total} hoursSince=${result.hoursSinceLastInteraction.toFixed(1)} escalationId=${result.escalationId}\n`,
					);
				}
				return ok(
					`User escalation: shouldEscalate=false critical=${result.counts.critical} total=${result.counts.total} hoursSince=${result.hoursSinceLastInteraction.toFixed(1)}\n`,
				);
			}
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
				if (!task) return fail(`task not found: ${id}`);
				return ok(`Tarea aprobada: ${task.id}. No ejecuté IA ni AgentLabs.`);
			}
			case "idu-queue-reject":
			case "queue-reject":
			case "queue_reject": {
				const id = requiredText(rest);
				const task = activeRuntime.queueReject(id);
				if (!task) return fail(`task not found: ${id}`);
				return ok(`Tarea rechazada: ${task.id}.`);
			}
			case "idu-queue-complete":
			case "queue-complete":
			case "queue_complete": {
				const id = requiredText(rest.slice(0, 1));
				const evidence = requiredText(rest.slice(1));
				const task = activeRuntime.queueComplete?.(id, evidence);
				if (!task) return fail("Uso: idu-pi queue-complete <id> <evidence>");
				return ok(`Tarea completada: ${task.id}. Evidencia registrada.`);
			}
			case "idu-birth-status":
			case "birth-status":
				return ok(
					formatBirthStatus(
						handleBirthStatus({
							projectId: activeRuntime.projectId,
							stateRoot: activeRuntime.workspaceRoot,
						}),
					),
				);
			case "idu-birth-existing-scan":
			case "birth-existing-scan": {
				const result = handleBirthExistingScan({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					projectPath: activeRuntime.projectPath,
				});
				return ok(formatBirthExistingScan(result));
			}
			case "idu-birth-bibliotecario-discovery":
			case "birth-bibliotecario-discovery": {
				const scan = readBirthArtifact<{ observed?: { docs?: string[] } }>(
					activeRuntime.workspaceRoot,
					"existing-scan",
				);
				const localRefs = (scan?.observed?.docs ?? [])
					.slice(0, 5)
					.map((p) => ({ path: p, quality: "secondary" as const }));
				const result = handleBirthBibliotecarioDiscovery({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					localSourceRefs: localRefs,
					requestedExternalCategories: [],
					externalPermission: "not_requested",
					masterPlanSummary: "",
				});
				return ok(formatBirthBibliotecario(result));
			}
			case "idu-onboard-project":
			case "onboard-project": {
				const result = runOnboardProject(
					activeRuntime.workspaceRoot,
					activeRuntime.projectId,
					{
						projectPath: activeRuntime.projectPath,
						allowedRoots: [
							activeRuntime.projectPath,
							activeRuntime.workspaceRoot,
						],
						registryPath: process.env.IDU_PI_REGISTRY_PATH,
					},
				);
				return {
					exitCode: result.exitCode,
					stdout: result.ok ? `${JSON.stringify(result, null, 2)}\n` : "",
					stderr: result.ok ? "" : `${JSON.stringify(result, null, 2)}\n`,
				};
			}
			case "idu-bibliotecario-init":
			case "bibliotecario-init": {
				const result = runBibliotecarioInit({
					stateRoot: activeRuntime.workspaceRoot,
					projectId: activeRuntime.projectId,
				});
				if (!result.ok) {
					return fail(result.error);
				}
				return ok(formatBibliotecarioInit(result));
			}
			case "idu-skill-rating":
			case "skill-rating": {
				const result = runSkillRating(rest, {
					stateRoot: activeRuntime.workspaceRoot,
				});
				if (!result.ok) {
					return {
						exitCode: result.exitCode,
						stdout: "",
						stderr: formatSkillRating(result),
					};
				}
				return ok(formatSkillRating(result));
			}
			case "idu-birth-validate":
			case "birth-validate": {
				const result = handleBirthValidate({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					projectPath: activeRuntime.projectPath,
				});
				return ok(formatBirthValidate(result));
			}
			case "idu-birth-general-spec":
			case "birth-general-spec": {
				if (!activeRuntime.workspaceRoot) {
					return fail(
						"General Spec approval requires an active project stateRoot.",
					);
				}
				const input = parseBirthGeneralSpecCliInput(rest);
				const result = await approveBirthGeneralSpec({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					sections: input.sections,
					approvedBy: input.approvedBy,
				});
				const status = handleBirthStatus({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
				});
				return ok(formatBirthGeneralSpec(result, status));
			}
			case "idu-birth-general-spec-derive":
			case "birth-general-spec-derive": {
				if (!activeRuntime.workspaceRoot) {
					return fail(
						"General Spec derivation requires an active project stateRoot.",
					);
				}
				const promptForRole = activeRuntime.promptForRole;
				const result = await runVisualDerivation({
					stateRoot: activeRuntime.workspaceRoot,
					uiFiles: parseUiFiles(rest),
					promptForRole:
						promptForRole ?? (async () => ({ ok: false, output: "" })),
				});
				return ok(formatBirthGeneralSpecDerivation(result));
			}
			case "idu-birth-prototype-master":
			case "birth-prototype-master": {
				const json = rest.join(" ").trim();
				let action: "draft" | "review" | "approve" = "review";
				let draft: Parameters<typeof handleBirthPrototypeMaster>[0]["draft"];
				let approvedBy: string | undefined;
				if (json) {
					let parsedUnknown: unknown;
					try {
						parsedUnknown = JSON.parse(json);
					} catch (e) {
						return fail(`JSON inválido: ${(e as Error).message}`);
					}
					if (typeof parsedUnknown === "object" && parsedUnknown !== null) {
						const p = parsedUnknown as {
							action?: string;
							draft?: Parameters<typeof handleBirthPrototypeMaster>[0]["draft"];
							approvedBy?: string;
						};
						if (
							p.action === "draft" ||
							p.action === "review" ||
							p.action === "approve"
						) {
							action = p.action;
						}
						draft = p.draft;
						approvedBy = p.approvedBy;
					}
				}
				const result = handleBirthPrototypeMaster({
					action,
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					...(draft ? { draft } : {}),
					...(approvedBy ? { approvedBy } : {}),
				});
				return ok(formatBirthPrototype(result));
			}
			case "idu-pending-injections":
			case "pending-injections": {
				const params = rest.join(" ").trim();
				// AUDITOR-FIX-A: default ack = FALSE. A routine pull (no flag)
				// only writes `delivered`. `ack:true` must be EXPLICIT — that's
				// the deliberate dismissal escape hatch. If we default to true,
				// every pull dismisses + acks the advisory, defeating Item 5's
				// forced-pull escalation.
				const ack = /\back\s*:\s*true\b/.test(params);
				const pending = readPendingInjections(activeRuntime.workspaceRoot, {});
				if (pending.length > 0) {
					for (const inj of pending) {
						// Wire telemetry: write `delivered` for each surfaced
						// advisory (#2467). The cron evaluator calls
						// markInjectionAcked when it writes `resolved` or
						// `expired` (per-kind policy). The path is included
						// for hygiene advisories so the path-absent
						// predicate can be constructed.
						const meta = inj.meta as { path?: string } | undefined;
						recordLifecycleEvent({
							stateRoot: activeRuntime.workspaceRoot,
							injectionId: inj.injectionId,
							phase: "delivered",
							kind: inj.kind,
							path: meta?.path,
							now: new Date(),
						});
						if (ack) {
							// ack:true on the pull = deliberate dismissal (escape
							// hatch). Same guard as idu_ack_advisory: only
							// write the `dismissed` event on a real
							// transition. The #156 audit caught the
							// phantom-dismissal bug; the MCP server
							// twin and this CLI mirror were both fixed
							// in the same commit.
							const outcome = markInjectionAcked(
								activeRuntime.workspaceRoot,
								inj.injectionId,
							);
							if (outcome === "acked") {
								recordLifecycleEvent({
									stateRoot: activeRuntime.workspaceRoot,
									injectionId: inj.injectionId,
									phase: "dismissed",
									kind: inj.kind,
									reason: "idu-pending-injections ack:true",
									now: new Date(),
								});
							}
						}
					}
				}
				const banner = pisoBannerLine(activeRuntime.workspaceRoot);
				return ok(banner + formatPendingInjections(pending, ack));
			}
			case "idu-decision-ledger":
			case "decision-ledger": {
				// Syntax: idu-decision-ledger list [--project <id>] [--since <iso>] [--limit N]
				let projectId = "";
				let since: string | undefined;
				let limit = 50;
				for (const arg of rest) {
					if (arg.startsWith("--project=")) {
						projectId = arg.slice("--project=".length);
						continue;
					}
					if (arg.startsWith("--since=")) {
						since = arg.slice("--since=".length);
						continue;
					}
					const m = /^--limit\s+(\d+)$/u.exec(arg);
					if (m) limit = Number(m[1]);
				}
				if (!projectId) {
					projectId = activeRuntime.workspaceRoot;
				}
				const dbPath = join(activeRuntime.workspaceRoot, "lab.db");
				const decisions = listDecisions(dbPath, { projectId, since, limit });
				return ok(
					[
						`Decision ledger for projectId=${projectId}`,
						`count: ${decisions.length}`,
						"",
						...decisions.map((d) => {
							const rationale = d.rationale ? ` — ${d.rationale}` : "";
							return `[${d.id}] ${d.decidedAt} ${d.decidedBy} ${d.decision} ${d.targetKind}:${d.targetId}${d.profileRef ? ` (profile: ${d.profileRef})` : ""}${rationale}`;
						}),
					].join("\n"),
				);
			}
			case "idu-outbox-prune":
			case "outbox-prune": {
				// Syntax: idu-outbox-prune [--older-than 30d] [--confirm]
				let olderThanDays = 30;
				let confirm = false;
				for (const arg of rest) {
					if (arg === "--confirm") {
						confirm = true;
						continue;
					}
					const m = /^--older-than\s+(\d+)([dhm])$/u.exec(arg);
					if (m) {
						const n = Number(m[1]);
						const unit = m[2];
						if (unit === "d") olderThanDays = n;
						else if (unit === "h")
							olderThanDays = Math.max(1, Math.round(n / 24));
						else if (unit === "m")
							olderThanDays = Math.max(1, Math.round(n / 60 / 24));
					}
				}
				const plan = planPrune(activeRuntime.workspaceRoot, { olderThanDays });
				if (!confirm) {
					return ok(
						[
							"Outbox prune — DRY RUN (use --confirm to apply)",
							`cutoff: ${plan.cutoff}`,
							`proposals prunable: ${plan.proposals.length}`,
							`injections prunable: ${plan.injections.length}`,
							"",
							"Nada se modifica. Re-correr con --confirm para archivar.",
						].join("\n"),
					);
				}
				const result = applyPrune(activeRuntime.workspaceRoot, plan, {
					olderThanDays,
				});
				return ok(
					[
						"Outbox prune — applied",
						`cutoff: ${result.cutoff}`,
						`archive: ${result.archiveDir}`,
						`archived: proposals=${result.archived.proposals}, injections=${result.archived.injections}`,
						`removed (live): proposals=${result.removed.proposals}, injections=${result.removed.injections}`,
					].join("\n"),
				);
			}
			case "idu-subscribe-triggers":
			case "subscribe-triggers":
				return ok(formatTriggerSubscription());
			case "idu-supervisor-trigger":
			case "supervisor-trigger": {
				const subcommand = (rest.shift() ?? "status").toLowerCase();
				const stateRoot = activeRuntime.workspaceRoot;
				if (subcommand === "enable") {
					return ok(
						formatSupervisorTriggerResult(
							enableSupervisorTrigger(stateRoot, {
								source: "cli",
								now: new Date(),
							}),
						),
					);
				}
				if (subcommand === "disable") {
					return ok(
						formatSupervisorTriggerResult(
							disableSupervisorTrigger(stateRoot, {
								source: "cli",
								now: new Date(),
							}),
						),
					);
				}
				if (subcommand === "status") {
					return ok(
						formatSupervisorTriggerStatus(
							getSupervisorTriggerStatus(stateRoot),
						),
					);
				}
				return fail(
					`Subcomando no reconocido: ${subcommand}. Usá enable | disable | status.`,
				);
			}
			case "idu-trigger-engine":
			case "trigger-engine": {
				const subcommand = (rest.shift() ?? "status").toLowerCase();
				const stateRoot = activeRuntime.workspaceRoot;
				if (subcommand === "enable") {
					return ok(
						formatTriggerEngineConfigResult(
							enableTriggerEngineConfig(stateRoot, {
								source: "cli",
								now: new Date(),
							}),
						),
					);
				}
				if (subcommand === "disable") {
					return ok(
						formatTriggerEngineConfigResult(
							disableTriggerEngineConfig(stateRoot, {
								source: "cli",
								now: new Date(),
							}),
						),
					);
				}
				if (subcommand === "status") {
					return ok(
						formatTriggerEngineConfigStatus(
							getTriggerEngineConfigStatus(stateRoot),
						),
					);
				}
				return fail(
					`Subcomando no reconocido: ${subcommand}. Usá enable | disable | status.`,
				);
			}
			case "idu-birth-repo-plan":
			case "birth-repo-plan": {
				const json = rest.join(" ").trim();
				if (!json) return fail("Uso: idu-pi idu-birth-repo-plan <json-plan>");
				let parsedUnknown: unknown;
				try {
					parsedUnknown = JSON.parse(json);
				} catch (e) {
					return fail(`JSON inválido: ${(e as Error).message}`);
				}
				// Accept both { repoPlan: {...} } envelope and raw { ... } body.
				const parsed: BirthRepoPlan =
					typeof parsedUnknown === "object" &&
					parsedUnknown !== null &&
					"repoPlan" in parsedUnknown
						? (parsedUnknown as { repoPlan: BirthRepoPlan }).repoPlan
						: (parsedUnknown as BirthRepoPlan);
				const result = handleBirthRepoPlan({
					projectId: activeRuntime.projectId,
					stateRoot: activeRuntime.workspaceRoot,
					repoPlan: parsed,
				});
				return ok(formatBirthRepoPlan(result));
			}
			case "idu-trigger-show": {
				const triggerId = rest[0];
				if (!triggerId) {
					return fail("Uso: idu-trigger-show <triggerId>");
				}
				const def = TRIGGER_DEFINITIONS.find((d) => d.id === triggerId);
				if (!def) {
					return fail(`Trigger not found: ${triggerId}`);
				}
				const cadenceMap: Record<string, string> = {
					objective_reminder_hourly:
						"1h after the master-plan-objective-cache.json `updatedAt`",
					stuck_tasks_1h:
						"1h after task_stuck event without subsequent task_created",
					intention_decision_pending:
						"30min after intention_decision_pending event",
				};
				const cadence = cadenceMap[def.id] || "not specified";
				const output = [
					`ID: ${def.id}`,
					`Description: ${def.description}`,
					`Kinds: ${def.kinds.join(", ")}`,
					`Signature: ${def.signature}`,
					`Contract:`,
					`  - decisionRequired: ${def.contract.decisionRequired}`,
					`  - severity: ${def.contract.severity}`,
					`  - options: [${def.contract.options.join(", ")}]`,
					`Cadence: ${cadence}`,
				].join("\n");
				return ok(output);
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
	process.exit(result.exitCode);
}



































































if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	void main();
}
