import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	configureIduSessionStore,
	deactivateIduSession,
	getIduSessionStatus,
} from "../src/idu-session.js";
import {
	callIduMcpTool,
	handleMcpRequest,
	listIduMcpTools,
	type IduMcpProjectResolution,
	type IduMcpRuntimeFactory,
} from "../src/mcp-server.js";

const hermeticMcpRoot = mkdtempSync(join(tmpdir(), "idu-mcp-hermetic-"));
const hermeticProjectPath = join(hermeticMcpRoot, "project");
const hermeticWorkspaceRoot = join(hermeticMcpRoot, "workspace");
mkdirSync(hermeticProjectPath, { recursive: true });
mkdirSync(hermeticWorkspaceRoot, { recursive: true });
process.env.DEFAULT_CWD = hermeticProjectPath;
process.env.ALLOWED_ROOTS = hermeticMcpRoot;
process.env.AGENT_WORKSPACE_ROOT = hermeticWorkspaceRoot;
process.env.IDU_PI_REGISTRY_PATH = join(
	hermeticMcpRoot,
	"registry",
	"projects.json",
);
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.ALLOWED_USER_ID;
import type { CliRuntime } from "../src/cli.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { DecisionEnvelope } from "../src/decision-envelope.js";
import { flushIduUsageEvents } from "../src/usage-events.js";
import {
	buildAgentLabEffectivenessReport,
	flushAgentLabEffectivenessEvents,
	readAgentLabEffectivenessEvents,
} from "../src/agentlab-effectiveness-events.js";
import {
	flushContextQualityEvents,
	readContextQualityEvents,
} from "../src/context-quality-events.js";
import type { ContextBudgetUsage } from "../src/context-budget.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { IduSupervisorLoopResult } from "../src/idu-supervisor-loop.js";
import type { IduSupervisorCronPlanResult } from "../src/idu-supervisor-cron.js";
import type { SemanticAuditStatusReport } from "../src/semantic-audit-command.js";
import {
	createAgentLabReviewRequests,
	type AgentLabReviewRequestPlan,
} from "../src/agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewStatus,
} from "../src/agentlab-review-runner.js";
import type { StructuredTask } from "../src/structured-task-queue.js";
import type {
	RemoveSourceLibraryItemResult,
	SourceLibraryMutationResult,
	SourceLibraryStatus,
} from "../src/source-library.js";
import type { ExternalIntelligenceReport } from "../src/external-intelligence.js";
import type { ExternalSourceRecommendationReport } from "../src/external-source-registry.js";
import type {
	SourceSkillCandidateCreationResult,
	SourceSkillCandidateReview,
} from "../src/source-skill-candidates.js";

const UNUSED = "unused";

function fakeSourceSkillCandidateCreation(): SourceSkillCandidateCreationResult {
	return {
		ok: true,
		path: "C:/idu/workspace/reports/source-skill-candidates-20260603-120000.json",
		report: {
			version: 1,
			projectId: "sistema_de_mantencion",
			createdAt: "2026-06-03T12:00:00.000Z",
			source: "source_library",
			warning: "Reports-only",
			contractPromotionAllowed: false,
			requiresHumanApproval: true,
			tokensCostMeasured: false,
			efficiencyEvidence: "no medido",
			candidates: [
				{
					candidateId: "skill-candidate-001",
					title: "Robust manual reader",
					suggestedSkillName: "robust-manual-reader",
					purpose: "Use source evidence without leaking raw manual text.",
					triggers: ["manual robusto"],
					sourceIds: ["source-demo-manual-abc123"],
					chunkIds: ["source-demo-manual-abc123-chunk-001"],
					evidenceRefs: ["source:source-demo-manual-abc123"],
					draftTargetPath: ".agents/skills/robust-manual-reader/SKILL.md",
					draftPreview: "RAW DRAFT PREVIEW manual robusto should not leak",
					limitations: ["proposal only"],
					duplicateHints: [],
					requiresHumanApproval: true,
					contractPromotionAllowed: false,
					tokensCostMeasured: false,
					efficiencyEvidence: "no medido",
				},
			],
			limitations: [],
			requiredActions: [],
		},
	};
}

function fakeSourceSkillCandidateReview(): SourceSkillCandidateReview {
	return {
		ok: true,
		path: "C:/idu/workspace/reports/source-skill-candidates-20260603-120000.json",
		report: fakeSourceSkillCandidateCreation().report,
		errors: [],
	};
}

function connection(
	projectPath = "C:/projects/sistema",
): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["sin scan reciente"],
		projectId: "sistema_de_mantencion",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "idu-pi idu-preflight <solicitud>",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-25T00:00:00.000Z",
	};
}

function preflight(request: string): ProjectPreflightReport {
	const risky = /loggin|login|auth/iu.test(request);
	return {
		risk: risky ? "high" : "low",
		okToProceed: !risky,
		request,
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		connectionStatus: "ready",
		affectedAreas: risky ? ["auth/seguridad", "login"] : ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: risky
			? "Pedir confirmación humana antes de implementar."
			: "Puede continuar con alcance acotado.",
		requiresHumanConfirmation: risky,
		shouldRunAgentLab: false,
	};
}

function fakeTask(text: string, active: boolean): StructuredTask {
	return {
		id: active ? "task-20260525-000001" : "task-20260525-000002",
		text: `Bug task. Symptom/context: ${text}`,
		originalText: text,
		category: "bug",
		priority: 10,
		status: "pending",
		createdAt: "2026-05-25T00:00:00.000Z",
		updatedAt: "2026-05-25T00:00:00.000Z",
		projectId: "sistema_de_mantencion",
		guardRisk: /loggin|login/iu.test(text) ? "high" : "low",
		guardStatus:
			active && /loggin|login/iu.test(text) ? "needs_confirmation" : "clear",
		guardReason: active
			? "preflight high; área: auth/seguridad"
			: "Idu-pi inactivo",
		intentConcepts: ["auth"],
	};
}

function fakeRuntime(projectPath = "C:/projects/sistema"): CliRuntime {
	let active = false;
	const tasks: StructuredTask[] = [];
	const runtime = {
		projectId: "sistema_de_mantencion",
		projectPath,
		workspaceRoot: "C:/idu/workspace",
		inspectConnection: () => connection(projectPath),
		formatConnection: () => "connection",
		formatDashboard: () => "dashboard",
		preflight,
		formatPreflight: () => "preflight",
		advisory: (request: string): ProjectAdvisory => ({
			level: preflight(request).risk === "high" ? "risk" : "info",
			title: "Idu-pi Advisory",
			request,
			affectedAreas: preflight(request).affectedAreas,
			missingContext: [],
			warnings: [],
			availableContext: [],
			recommendation: preflight(request).recommendedNext,
			actions: ["Pedir confirmación humana"],
			requiresHumanConfirmation: preflight(request).requiresHumanConfirmation,
			okToProceed: preflight(request).okToProceed,
		}),
		formatAdvisory: () => "advisory",
		postflight: (): ProjectPostflightReport => ({
			risk: "low",
			changedFiles: ["src/auth.ts"],
			impactedAreas: ["seguridad"],
			warnings: [],
			recommendedNext: "Revisar cambios.",
			shouldRunAgentLab: false,
			suggestedAgentLabs: [],
			requiresHumanConfirmation: false,
			physicalGates: [
				{
					id: "physical-git-status",
					kind: "git_status",
					status: "warn",
					summary: "Git status observed 1 changed file.",
					advisoryOnly: true,
					destructive: false,
				},
			],
		}),
		formatPostflight: () => "postflight",
		prepare: (): IduPrepareResult => ({
			projectId: "sistema_de_mantencion",
			projectPath,
			initialStatus: "ready",
			configStatus: "project_local_valid",
			alignmentStatus: "pending_scan",
			readiness: "config_ready",
			differencesDetected: {
				screens: 0,
				uiElements: 0,
				dataStores: 0,
				flows: 0,
			},
			steps: [],
			errors: [],
			finalRisk: "low",
			recommendedNext: "Listo para preflight.",
			suggestedActions: [],
		}),
		formatPrepare: () => "prepare",
		masterPlanStatus: () =>
			({
				status: "draft",
				currentPlanJson: "master-plan.json",
				currentPlanMd: "master-plan.md",
				projectId: "sistema_de_mantencion",
				projectPath,
				updatedAt: "2026-06-01T00:00:00.000Z",
			}) as never,
		masterPlanRedraft: () =>
			({
				jsonPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.json",
				markdownPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.md",
				current: {},
				memory: {},
				plan: {
					status: "draft",
					flowArtifact: "master-plan.flows.json",
				},
			}) as never,
		masterPlanApprove: (_selector, reason) =>
			({
				jsonPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.json",
				markdownPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.md",
				current: {},
				memory: {},
				plan: {
					status: "approved",
					flowArtifact: "master-plan.flows.json",
					approval: { source: "mcp", reason },
				},
			}) as never,
		masterPlanReject: (_selector, reason) =>
			({
				jsonPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.json",
				markdownPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.md",
				current: {},
				memory: {},
				plan: {
					status: "rejected",
					flowArtifact: "master-plan.flows.json",
					approval: { reason },
				},
			}) as never,
		masterPlanReview: () =>
			({
				current: {},
				jsonPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.json",
				markdown: "# Plan Maestro\n\n## Identidad del proyecto",
				revisionAntesDeZarpar: {
					status: "needs_user_definition",
					confidence: 0.72,
					projectUnderstanding: [
						"Sistema de mantenimiento con Plan Maestro draft.",
					],
					requiredContracts: [
						{
							category: "objective",
							title: "Contrato de objetivo",
							status: "needs_user_confirmation",
							requirement: "Confirmar objetivo y alcance antes de zarpar.",
							evidence: ["master-plan.json"],
							nextAction: "Pedir confirmación al usuario.",
						},
					],
					missingDefinitions: ["Plan Maestro sigue en draft."],
					requiredInformationSources: ["Doc/<project>/source-index.json"],
					recommendedExternalSources: ["npm security advisories"],
					recommendedMcpTools: ["idu_task_context"],
					recommendedAgentLabs: [
						{
							name: "AgentLab seguridad",
							purpose: "Auditar auth, secretos y superficie de ataque.",
							trigger: "Antes de aprobar cambios sensibles.",
							evidence: ["plan.securityModel"],
						},
					],
					currentProblems: ["Contratos aprobados vacíos."],
					repairStrategy: ["Confirmar contratos mínimos con el usuario."],
					questionsForUser: ["¿Confirmás el objetivo del proyecto?"],
					beforeSailingChecklist: ["Aprobar Plan Maestro."],
				},
				plan: {
					status: "approved",
					executiveSummary:
						"Sistema de mantenimiento aprobado para pruebas MCP.",
					inferredObjective:
						"Mantener gobernanza preventiva desde Plan Maestro aprobado.",
					scope: ["Supervisar cambios con contratos"],
					outOfScope: ["Implementar desde Idu-pi"],
					flowArtifact: "master-plan.flows.json",
					canonicalClaims: [
						{
							title: "Objetivo aprobado",
							statement: "MCP asesora y el orquestador decide.",
							source: "user_approved",
							status: "confirmed",
							confidence: 0.95,
							evidence: ["Doc/04-contratos-aprobados.md"],
						},
					],
					operationalContracts: [
						{
							area: "agent",
							title: "Contrato de ejecución para agentes",
							rules: [
								"El orquestador decide e implementa con subagentes normales.",
							],
							evidence: ["Doc/01-contratos-operativos.generado.md"],
							severity: "high",
							mode: "block",
						},
					],
					workMilestones: [
						{
							name: "Hito 1 — Loop preventivo",
							goal: "Crear paquetes de trabajo gobernados antes de codificar.",
							actions: ["Agregar snapshot", "Agregar acción candidata"],
							exitCriteria: ["Worker recibe lineamientos antes de implementar"],
						},
					],
					driftFindings: [
						{
							title: "Blueprint no confirmado",
							severity: "medium",
							recommendation: "Validar antes de tratar defaults como contrato.",
							evidence: ["config/project-blueprint.json"],
						},
					],
					projectFlows: [
						{
							name: "Flujo MCP advisory",
							category: "entrypoint",
							purpose: "MCP informa y recomienda; el orquestador decide.",
							entrypoints: ["idu_task_context"],
							rules: ["No commit/push", "No AgentLabs automáticos"],
							evidence: ["docs/mcp-server.md"],
						},
					],
					qualityRisks: ["Proyecto grande; riesgo de omitir módulos."],
					criticalRisks: [],
					recommendedNext: ["Agregar loop MCP preventivo."],
				},
			}) as never,
		formatMasterPlanStatus: () => "master status",
		formatMasterPlanReview: () => "master review",
		formatMasterPlanOperation: () => "master operation",
		projectStateReset: () => ({
			projectId: "sistema_de_mantencion",
			projectPath,
			stateRoot: "C:/idu/workspace/projects/sistema_de_mantencion",
			deletedEntries: ["reports"],
			recreatedRoot: true,
			warning:
				"Reset destructivo de estado aislado: no desregistra el proyecto ni toca el repo real.",
		}),
		formatProjectStateResetResult: () => "state reset",
		labReviewPlan: () => {
			throw new Error(UNUSED);
		},
		formatLabReviewPlan: () => UNUSED,
		semanticAuditStatus: (): SemanticAuditStatusReport => ({
			projectId: "sistema_de_mantencion",
			stats: {
				projectId: "sistema_de_mantencion",
				labRunCount: 0,
				findingCount: 0,
				proposalCount: 0,
				taskCount: 0,
				userSignalCount: 0,
				memoryItemCount: 0,
				criticalFindingCount: 0,
				highFindingCount: 0,
			},
			checkpoint: {
				projectId: "sistema_de_mantencion",
				lastLabRunCount: 0,
				lastFindingCount: 0,
				lastProposalCount: 0,
				lastTaskCount: 0,
				lastUserSignalCount: 0,
				lastMemoryItemCount: 0,
				lastCriticalFindingCount: 0,
				lastHighFindingCount: 0,
			},
			newEvents: {
				labRuns: 0,
				findings: 0,
				proposals: 0,
				tasks: 0,
				userSignals: 0,
				memoryItems: 0,
				criticalFindings: 0,
				highFindings: 0,
			},
			decision: {
				shouldRun: false,
				triggerReason: "not_enough_data",
				newEventCount: 0,
			},
			recommendedNext: "Esperar umbral.",
		}),
		formatSemanticAuditStatus: () => "semantic status",
		semanticAuditRun: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAuditRun: () => UNUSED,
		semanticCompactionDraft: () => {
			throw new Error(UNUSED);
		},
		formatSemanticCompactionDraft: () => UNUSED,
		semanticCompactionReview: () => {
			throw new Error(UNUSED);
		},
		formatSemanticCompactionReview: () => UNUSED,
		semanticAgentTaskPlan: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAgentTaskPlan: () => UNUSED,
		semanticAgentTasksCreate: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAgentTaskCreationResult: () => UNUSED,
		supervisorTick: (): IduSupervisorLoopResult =>
			active
				? {
						status: "completed",
						trigger: "manual",
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check",
								status: "active",
								summary: "Idu-pi activo.",
							},
						],
						createdTasks: 0,
						summary: "Tick seguro.",
						recommendedNext: [],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					}
				: {
						status: "skipped",
						reason: "idu_inactive",
						trigger: "manual",
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check",
								status: "inactive",
								summary: "Idu-pi inactivo.",
							},
						],
						createdTasks: 0,
						summary: "Idu-pi está apagado.",
						recommendedNext: ["Activar /idu"],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					},
		supervisorCronPlan: (): IduSupervisorCronPlanResult => {
			const loop: IduSupervisorLoopResult = active
				? {
						status: "completed" as const,
						trigger: "cron_planning" as const,
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check" as const,
								status: "active" as const,
								summary: "Idu-pi activo.",
							},
						],
						createdTasks: 0,
						summary: "Cron plan seguro.",
						recommendedNext: ["idu_semantic_audit_status"],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					}
				: {
						status: "skipped" as const,
						reason: "idu_inactive" as const,
						trigger: "cron_planning" as const,
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check" as const,
								status: "inactive" as const,
								summary: "Idu-pi inactivo.",
							},
						],
						createdTasks: 0,
						summary: "Cron plan idle.",
						recommendedNext: ["Activar /idu"],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					};
			return {
				status: active ? "planned" : "skipped",
				projectId: "sistema_de_mantencion",
				classification: active ? "watch" : "idle",
				proposedActions: loop.recommendedNext,
				advisoryOnly: true,
				writesAllowed: false,
				agentLabsAllowed: false,
				loop,
			};
		},
		formatSupervisorTick: () => "tick",
		supervisorOnIduActivation: () => {
			active = true;
			return undefined;
		},
		supervisorImprovementPlan: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementPlan: () => UNUSED,
		supervisorImprovementCreate: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementCreationResult: () => UNUSED,
		supervisorImprovementStatus: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementStatus: () => UNUSED,
		supervisorImprovementApprove: () => {
			throw new Error(UNUSED);
		},
		supervisorImprovementReject: () => {
			throw new Error(UNUSED);
		},
		supervisorImprovementDefer: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementDecisionResult: () => UNUSED,
		supervisorImprovementsApply: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesApplyResult: () => UNUSED,
		supervisorLearningRulesStatus: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesStatus: () => UNUSED,
		supervisorLearningRulesTest: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesTest: () => UNUSED,
		supervisorLearningRulesDisable: () => {
			throw new Error(UNUSED);
		},
		supervisorLearningRulesEnable: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRuleDecision: () => UNUSED,
		supervisorLearningRulesRollback: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesRollback: () => UNUSED,
		skillImprovementPlan: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementPlan: () => UNUSED,
		skillImprovementCreate: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementCreationResult: () => UNUSED,
		skillImprovementStatus: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementStatus: () => UNUSED,
		skillImprovementApprove: () => {
			throw new Error(UNUSED);
		},
		skillImprovementReject: () => {
			throw new Error(UNUSED);
		},
		skillImprovementDefer: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementDecisionResult: () => UNUSED,
		skillDraftsCreate: () => {
			throw new Error(UNUSED);
		},
		formatSkillDraftCreationResult: () => UNUSED,
		skillDraftFromLessons: () => ({
			mode: "proposal-only",
			selector: "latest",
			semanticDraftPath: "semantic-compaction-draft.json",
			proposalsPath: "skill-improvement-proposals.json",
			createdProposals: [],
			createdDrafts: [],
			omittedProposals: [],
			nextActions: ["approve proposals"],
			requiredActions: ["Review skill improvement proposals."],
			allowedToProceed: false,
			advisoryOnly: true,
			safeNotes: ["No modifiqué skills reales, .agents ni .atl."],
		}),
		skillDraftReview: () => {
			throw new Error(UNUSED);
		},
		formatSkillDraftReview: () => UNUSED,
		sourceLibraryStatus: (): SourceLibraryStatus => ({
			projectId: "sistema_de_mantencion",
			paths: {
				root: "C:/idu/state/Doc/sistema_de_mantencion",
				indexPath: "C:/idu/state/Doc/sistema_de_mantencion/source-index.json",
				libraryIndexPath:
					"C:/idu/state/Doc/sistema_de_mantencion/source-library-index.json",
				localSourcesDir: "C:/idu/state/Doc/sistema_de_mantencion/sources/local",
				extractedDir:
					"C:/idu/state/Doc/sistema_de_mantencion/sources/extracted",
				convertedDir:
					"C:/idu/state/Doc/sistema_de_mantencion/sources/converted",
				chunksDir: "C:/idu/state/Doc/sistema_de_mantencion/sources/chunks",
				digestsDir: "C:/idu/state/Doc/sistema_de_mantencion/sources/digests",
			},
			state: "ready",
			sources: [],
			missingSources: [],
			staleSources: [],
			unindexedLocalFiles: [],
			errors: [],
			advisory: "stateRoot only; no contract promotion",
		}),
		sourceLibraryAdd: (): SourceLibraryMutationResult => ({
			...fakeRuntime().sourceLibraryStatus(),
			addedSource: {
				id: "source-demo-manual-abc123",
				title: "manual.md",
				kind: "markdown",
				trustLevel: "manual",
				freshnessPolicy: "manual",
				originalPath: "C:/docs/manual.md",
				storedPath: "sources/local/source-demo-manual-abc123-manual.md",
				sha256: "abc123",
				sizeBytes: 12,
				status: "ready",
				addedAt: "2026-06-01T00:00:00.000Z",
				lastCheckedAt: "2026-06-01T00:00:00.000Z",
				contractPromotionAllowed: false,
			},
		}),
		sourceLibraryRemove: (): RemoveSourceLibraryItemResult => ({
			...fakeRuntime().sourceLibraryStatus(),
			removedFiles: ["sources/local/source-demo-manual-abc123-manual.md"],
			removedSource: {
				id: "source-demo-manual-abc123",
				title: "manual.md",
				kind: "markdown",
				trustLevel: "manual",
				freshnessPolicy: "manual",
				originalPath: "C:/docs/manual.md",
				storedPath: "sources/local/source-demo-manual-abc123-manual.md",
				sha256: "abc123",
				sizeBytes: 12,
				status: "ready",
				addedAt: "2026-06-01T00:00:00.000Z",
				lastCheckedAt: "2026-06-01T00:00:00.000Z",
				contractPromotionAllowed: false,
			},
		}),
		sourceLibraryRead: () => ({
			projectId: "sistema_de_mantencion",
			paths: fakeRuntime().sourceLibraryStatus().paths,
			source: fakeRuntime().sourceLibraryAdd("C:/docs/manual.md").addedSource!,
			readStatus: "ready",
			content: "manual robusto",
			maxChars: 20_000,
			truncated: false,
			citationPath: "sources/extracted/source-demo-manual-abc123.txt",
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceLibraryExtract: () => ({
			...fakeRuntime().sourceLibraryRead("source-demo-manual-abc123"),
			extractionStatus: "extracted",
			extractedTextPath: "sources/extracted/source-demo-manual-abc123.txt",
		}),
		sourceLibraryReport: () => ({
			projectId: "sistema_de_mantencion",
			paths: fakeRuntime().sourceLibraryStatus().paths,
			source: fakeRuntime().sourceLibraryAdd("C:/docs/manual.md").addedSource!,
			extractedAvailable: true,
			extractionStatus: "extracted",
			citationPath: "sources/extracted/source-demo-manual-abc123.txt",
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceLibraryResearch: () => ({
			projectId: "sistema_de_mantencion",
			query: "robusto",
			generatedAt: "2026-06-01T00:00:00.000Z",
			searchedSourceIds: ["source-demo-manual-abc123"],
			signals: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceDigest: () => ({
			version: 1,
			projectId: "sistema_de_mantencion",
			sourceId: "source-demo-manual-abc123",
			title: "manual.md",
			kind: "markdown",
			generatedAt: "2026-06-01T00:00:00.000Z",
			processingMode: "direct",
			summary: "manual robusto",
			topics: ["robusto"],
			useWhen: ["cuando la tarea menciona robusto"],
			chunks: [],
			recommendedReads: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceDigestStatus: () => ({
			projectId: "sistema_de_mantencion",
			paths: fakeRuntime().sourceLibraryStatus().paths,
			digests: [],
			libraryIndexExists: true,
			contractPromotionAllowed: false,
		}),
		sourceChunkRead: () => ({
			projectId: "sistema_de_mantencion",
			sourceId: "source-demo-manual-abc123",
			chunkId: "source-demo-manual-abc123-chunk-001",
			path: "sources/chunks/source-demo-manual-abc123/source-demo-manual-abc123-chunk-001.md",
			content: "manual robusto",
			maxChars: 12_000,
			truncated: false,
			contractPromotionAllowed: false,
		}),
		sourceRecommend: () => ({
			projectId: "sistema_de_mantencion",
			request: "robusto",
			generatedAt: "2026-06-01T00:00:00.000Z",
			matches: [],
			missingKnowledge: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceRequiredActions: () => ({
			projectId: "sistema_de_mantencion",
			generatedAt: "2026-06-01T00:00:00.000Z",
			actions: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceSkillCandidatesCreate: () => fakeSourceSkillCandidateCreation(),
		sourceSkillCandidatesReview: () => fakeSourceSkillCandidateReview(),
		sourceLibraryRefresh: (): SourceLibraryStatus =>
			fakeRuntime().sourceLibraryStatus(),
		formatSourceLibraryStatus: () => "source library status",
		formatSourceLibraryAddResult: () => "source library add",
		formatSourceLibraryRemoveResult: () => "source library remove",
		formatSourceLibraryReadResult: () => "source library read",
		formatSourceLibraryExtractResult: () => "source library extract",
		formatSourceLibraryItemReport: () => "source library report",
		formatSourceResearchReport: () => "source research report",
		formatSourceDigest: () => "source digest",
		formatSourceDigestStatus: () => "source digest status",
		formatSourceChunkRead: () => "source chunk read",
		formatSourceRecommendationReport: () => "source recommend",
		formatSourceRequiredActionsReport: () => "source required actions",
		formatSourceSkillCandidateCreationResult: () =>
			"Source skill candidates\n\nReports-only\ntokens/cost: no medido",
		formatSourceSkillCandidateReview: () =>
			"Source skill candidates review\n\nvalid",
		formatSourceLibraryRefreshResult: () => "source library refresh",
		agentLabRequestCreate: (source: string): AgentLabReviewRequestPlan => ({
			generatedAt: "2026-05-25T00:00:00.000Z",
			projectId: "sistema_de_mantencion",
			source:
				source === "skill-draft"
					? "skill_draft"
					: source === "master-plan"
						? "master_plan"
						: source === "external-source-intelligence"
							? "external_source_intelligence"
							: "postflight",
			warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
			requests: [],
			errors: [],
			path: "C:/idu/workspace/reports/agentlab-review-request-20260525-000000.json",
		}),
		formatAgentLabReviewRequestPlan: () => "agentlab request",
		agentLabRequestReview: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabReviewRequestReview: () => UNUSED,
		agentLabReviewRun: async (): Promise<AgentLabReviewRunResult> => ({
			generatedAt: "2026-05-25T00:00:00.000Z",
			sourceRequestFile: "request.json",
			warning: "Revisión AgentLab. No aplica cambios.",
			projectId: "sistema_de_mantencion",
			runs: [],
			consolidatedSummary: "Sin hallazgos.",
			consolidatedFindings: [],
			recommendedNext: "Revisar reporte.",
			requiresHumanApproval: false,
			safeNotes: ["Review-only sandbox."],
			path: "C:/idu/workspace/reports/agentlab-review-run-20260525-000000.json",
		}),
		formatAgentLabReviewRunResult: () => "agentlab run",
		agentLabReviewStatus: (): AgentLabReviewStatus => ({
			path: "run.json",
			name: "run.json",
			valid: true,
			errors: [],
			result: {
				generatedAt: "2026-05-25T00:00:00.000Z",
				sourceRequestFile: "request.json",
				warning: "Revisión AgentLab. No aplica cambios.",
				projectId: "sistema_de_mantencion",
				runs: [],
				consolidatedSummary: "Sin hallazgos.",
				consolidatedFindings: [],
				recommendedNext: "Revisar reporte.",
				requiresHumanApproval: false,
				safeNotes: [],
			},
		}),
		formatAgentLabReviewStatus: () => "agentlab status",
		agentLabReportConsolidate: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabConsolidationResult: () => UNUSED,
		agentLabReportConsolidationStatus: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabConsolidationStatus: () => UNUSED,
		createTask: (_kind: string, details: string) => {
			const task = fakeTask(details, active);
			tasks.push(task);
			return task;
		},
		formatTask: () => "task",
		queueDetail: () => JSON.stringify(tasks),
		listTasks: () => tasks,
		queueClearStructured: () => 0,
		queueApprove: (idOrPrefix: string) => {
			const matches = tasks.filter((candidate) =>
				candidate.id.startsWith(idOrPrefix),
			);
			if (matches.length !== 1) return undefined;
			const task = matches[0];
			task.guardStatus = "approved";
			return task;
		},
		queueReject: () => undefined,
		queueComplete: (idOrPrefix: string, evidence: string) => {
			const matches = tasks.filter((candidate) =>
				candidate.id.startsWith(idOrPrefix),
			);
			if (matches.length !== 1) return undefined;
			const task = matches[0];
			task.status = "done";
			task.completionEvidence = evidence;
			delete task.guardStatus;
			delete task.guardRisk;
			delete task.guardReason;
			return task;
		},
	} satisfies CliRuntime & {
		listTasks: () => StructuredTask[];
		queueComplete: (
			idOrPrefix: string,
			evidence: string,
		) => StructuredTask | undefined;
	};
	return runtime;
}

const fakeStateRoot = mkdtempSync(join(tmpdir(), "idu-mcp-fake-state-"));

function registered(
	projectPath = "C:/projects/sistema",
): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "sistema_de_mantencion",
		projectPath,
		stateRoot: fakeStateRoot,
		safeNotes: [],
		errors: [],
	};
}

function factory(): IduMcpRuntimeFactory {
	return (projectPath) => fakeRuntime(projectPath);
}

test("mcp server lists Idu-pi tools", async () => {
	const tools = listIduMcpTools();
	assert.ok(tools.some((tool) => tool.name === "idu_status"));
	assert.ok(tools.some((tool) => tool.name === "idu_project_enroll"));
	assert.ok(tools.some((tool) => tool.name === "idu_project_reset_state"));
	assert.ok(tools.some((tool) => tool.name === "idu_bootstrap_project"));
	assert.ok(tools.some((tool) => tool.name === "idu_start"));
	assert.ok(tools.some((tool) => tool.name === "idu_agentlab_review_run"));
	assert.ok(tools.some((tool) => tool.name === "idu_orchestrator_procedure"));
	assert.ok(tools.some((tool) => tool.name === "idu_task_context"));
	assert.ok(tools.some((tool) => tool.name === "idu_master_plan_status"));
	assert.ok(tools.some((tool) => tool.name === "idu_master_plan_create"));
	assert.ok(tools.some((tool) => tool.name === "idu_master_plan_review"));
	assert.ok(tools.some((tool) => tool.name === "idu_master_plan_approve"));
	assert.ok(tools.some((tool) => tool.name === "idu_master_plan_reject"));
	assert.ok(tools.some((tool) => tool.name === "idu_plan_snapshot"));
	assert.ok(tools.some((tool) => tool.name === "idu_next_advisory_action"));
	assert.ok(tools.some((tool) => tool.name === "idu_continuation_proposal"));
	assert.ok(tools.some((tool) => tool.name === "idu_task_package_create"));
	assert.ok(tools.some((tool) => tool.name === "idu_supervisor_context_pack"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_status"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_add"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_remove"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_read"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_extract"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_report"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_research_report"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_digest"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_digest_status"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_chunk_read"));
	assert.ok(
		tools.some((tool) => tool.name === "idu_source_recommend_for_task"),
	);
	assert.ok(tools.some((tool) => tool.name === "idu_source_required_actions"));
	assert.ok(
		tools.some((tool) => tool.name === "idu_source_skill_candidates_create"),
	);
	assert.ok(
		tools.some((tool) => tool.name === "idu_source_skill_candidates_review"),
	);
	assert.ok(tools.some((tool) => tool.name === "idu_skill_draft_from_lessons"));
	assert.ok(tools.some((tool) => tool.name === "idu_source_refresh"));
	assert.ok(tools.some((tool) => tool.name === "idu_queue_complete"));
	assert.ok(tools.some((tool) => tool.name === "idu_supervisor_cron_plan"));
	assert.ok(
		tools.some((tool) => tool.name === "idu_architectural_pruning_plan"),
	);
	assert.ok(tools.some((tool) => tool.name === "idu_context_pruning_advisory"));
	assert.ok(
		tools.some(
			(tool) => tool.name === "idu_supervisor_self_maintenance_advisory",
		),
	);
	assert.ok(
		tools.some((tool) => tool.name === "idu_external_intelligence_report"),
	);
	assert.ok(
		tools.some((tool) => tool.name === "idu_external_source_recommend"),
	);
	assert.ok(
		tools.some((tool) => tool.name === "idu_bibliotecario_proactive_advisory"),
	);
	assert.equal(tools.length, 55);
});

test("idu_supervisor_context_pack compone visión plan y gates compactos", async () => {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-context-pack-project-"));
	writeFileSync(
		join(projectPath, "README.md"),
		[
			"# Idu-pi",
			"",
			"Idu-pi es un cerebelo supervisor de proyecto para el orquestador.",
			"",
			"## Qué problema resuelve",
			"Evita que el proyecto avance sin objetivo claro o evidencia.",
			"",
			"## Qué NO es",
			"No reemplaza al humano ni al orquestador.",
		].join("\n"),
		"utf8",
	);
	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request:
				"Implement Goal Injection / Supervisor Context Pack for orchestrator AgentLabs completion decisions",
			includePlanSnapshot: true,
		},
		{
			runtimeFactory: factory(),
			projectResolver: () => registered(projectPath),
		},
	);

	assert.equal(result.ok, true);
	assert.equal(result.data.authority, "advisory");
	assert.equal(result.data.audience, "orchestrator_subagents");
	assert.match(JSON.stringify(result.data.goals), /cerebelo supervisor/u);
	assert.match(
		JSON.stringify(result.data.goals),
		/Mantener gobernanza preventiva/u,
	);
	assert.ok((result.data.contracts as string[]).includes("agent"));
	assert.match(JSON.stringify(result.data.autonomyGates), /postflight/u);
	assert.match(
		JSON.stringify(result.data.skipNoiseGuidance),
		/No leas docs completas/u,
	);
	assert.ok(result.data.taskPackage);
	assert.ok(result.data.taskContext);
	assert.ok(result.data.planSnapshot);
	assert.ok(result.data.governanceConfig);
	assert.ok(result.data.workerBoundary);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).governanceConfig,
		undefined,
	);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).workerBoundary,
		undefined,
	);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).contextBudget,
		undefined,
	);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).operationalContracts,
		undefined,
	);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).flows,
		undefined,
	);
	assert.equal(
		(result.data.planSnapshot as Record<string, unknown>).recommendedAgentLabs,
		undefined,
	);
	assert.match(
		String((result.data.planSnapshot as Record<string, unknown>).objective),
		/gobernanza preventiva/u,
	);
	const consultation = result.data.supervisorConsultation as {
		version: number;
		authority: string;
		planObjective: string;
		supervisorRecommendation: string;
		risks: string[];
		gates: string[];
		contracts: string[];
		evidenceRefs: string[];
		proceed: boolean;
		proceedRationale: string;
		stopRationale: string[];
		agentLabs: { mode: string; autoRun: boolean };
	};
	assert.equal(consultation.version, 1);
	assert.equal(consultation.authority, "advisory");
	assert.match(consultation.planObjective, /gobernanza preventiva/u);
	assert.ok(consultation.supervisorRecommendation);
	assert.ok(consultation.risks.length > 0);
	assert.ok(consultation.gates.some((gate) => /Plan Maestro/u.test(gate)));
	assert.ok(consultation.contracts.includes("agent"));
	assert.ok(consultation.evidenceRefs.includes("plan:snapshot"));
	assert.equal(typeof consultation.proceed, "boolean");
	assert.ok(consultation.proceedRationale);
	assert.equal(Array.isArray(consultation.stopRationale), true);
	assert.equal(consultation.agentLabs.mode, "audit_only");
	assert.equal(consultation.agentLabs.autoRun, false);
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
		consultation.proceed,
	);
	const budget = result.data.contextBudget as ContextBudgetUsage;
	assert.equal(budget.profile, "supervisor_context_pack");
	assert.equal(budget.contractPromotionAllowed, false);
});

test("idu_supervisor_context_pack includes bounded Source Library evidence refs", async () => {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-context-pack-sources-"));
	writeFileSync(
		join(projectPath, "README.md"),
		"# Idu-pi\n\nIdu-pi es un cerebelo supervisor compacto.",
		"utf8",
	);
	const rawChunkMarker = "RAW_CHUNK_BODY_MUST_NOT_LEAK";
	const runtime = fakeRuntime(projectPath);
	runtime.sourceRecommend = (request) => ({
		projectId: "sistema_de_mantencion",
		request,
		generatedAt: "2026-06-04T00:00:00.000Z",
		matches: [
			{
				sourceId: "source-architecture",
				title: "Architecture Manual",
				chunkIds: [
					"chunk-001",
					"chunk-002",
					"chunk-003",
					"chunk-004",
					"chunk-005",
					"chunk-006",
				],
				whyRelevant: "Explains architecture boundaries for this task.",
				confidence: "high",
				orchestratorInstruction:
					"Read named chunks with idu_source_chunk_read before implementation.",
				contractPromotionAllowed: false,
				content: rawChunkMarker,
			} as never,
		],
		missingKnowledge: ["No digest exists for dependency advisories."],
		limitations: ["Local Source Library only; no web fetch."],
		contractPromotionAllowed: false,
	});
	runtime.sourceRequiredActions = () => ({
		projectId: "sistema_de_mantencion",
		generatedAt: "2026-06-04T00:00:00.000Z",
		actions: [
			{
				sourceId: "source-pdf",
				title: "Manual PDF",
				kind: "pdf",
				digestStatus: "blocked_unread",
				conversionStatus: "metadata_only",
				requiredAction: {
					owner: "orchestrator",
					action: "dispatch_librarian_reader",
					reason: "PDF has no extracted text.",
					recommendedAgent: "librarian",
					recommendedReaderType: "document-reader",
					instructions:
						"Dispatch a document reader and return compact findings only.",
					contractPromotionAllowed: false,
				},
				contractPromotionAllowed: false,
			},
		],
		limitations: ["Required actions are advisory."],
		contractPromotionAllowed: false,
	});

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "Use architecture source evidence before implementation" },
		{
			runtimeFactory: () => runtime,
			projectResolver: () => registered(projectPath),
		},
	);

	assert.equal(result.ok, true);
	const sourceEvidence = result.data.sourceEvidence as {
		recommendationReport: {
			matches: Array<{ sourceId: string; chunkIds: string[] }>;
			contractPromotionAllowed: boolean;
		};
		requiredActions: { actions: unknown[]; contractPromotionAllowed: boolean };
		rawContentIncluded: boolean;
		agentLabAutoRunAllowed: boolean;
	};
	assert.equal(
		sourceEvidence.recommendationReport.contractPromotionAllowed,
		false,
	);
	assert.equal(sourceEvidence.requiredActions.contractPromotionAllowed, false);
	assert.equal(sourceEvidence.rawContentIncluded, false);
	assert.equal(sourceEvidence.agentLabAutoRunAllowed, false);
	assert.equal(
		sourceEvidence.recommendationReport.matches[0]?.sourceId,
		"source-architecture",
	);
	assert.deepEqual(sourceEvidence.recommendationReport.matches[0]?.chunkIds, [
		"chunk-001",
		"chunk-002",
		"chunk-003",
		"chunk-004",
		"chunk-005",
	]);
	assert.equal(sourceEvidence.requiredActions.actions.length, 1);
	const serialized = JSON.stringify(result.data);
	assert.equal(serialized.includes(rawChunkMarker), false);
	assert.match(serialized, /idu_source_chunk_read/u);
	assert.match(serialized, /dispatch_librarian_reader/u);
	assert.equal(
		(result.data.supervisorConsultation as { agentLabs: { autoRun: boolean } })
			.agentLabs.autoRun,
		false,
	);
});

test("idu_supervisor_context_pack records context quality without raw prompt text", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-context-quality-mcp-"));
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(projectPath, { recursive: true });
	writeFileSync(
		join(projectPath, "README.md"),
		"# Idu-pi\n\nIdu-pi es un cerebelo supervisor compacto.",
		"utf8",
	);
	const hugeMarker = "PROMPT_GIGANTE_CONTEXT_QUALITY";
	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request: `audit context quality ${`${hugeMarker} `.repeat(300)}`,
			includePlanSnapshot: false,
		},
		{
			runtimeFactory: factory(),
			projectResolver: () => ({
				...registered(projectPath),
				stateRoot,
			}),
		},
	);

	assert.equal(result.ok, true);
	await flushContextQualityEvents();
	const events = readContextQualityEvents(stateRoot);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.scope, "supervisor_context_pack");
	assert.equal(events[0]?.profile, "supervisor_context_pack");
	assert.equal(events[0]?.hasTaskGoal, true);
	assert.equal(events[0]?.hasTaskPackage, true);
	assert.equal(JSON.stringify(events).includes(hugeMarker), false);
});

test("idu_supervisor_context_pack compacts README human vision before budgeting", async () => {
	const projectPath = mkdtempSync(
		join(tmpdir(), "idu-context-pack-readme-diet-"),
	);
	writeFileSync(
		join(projectPath, "README.md"),
		[
			"# Idu-pi",
			"Idu-pi es un cerebelo supervisor de proyecto para el orquestador.",
			"## Qué problema resuelve",
			...Array.from(
				{ length: 80 },
				(_, index) =>
					`Supervisor orquestador AgentLab contexto evidencia línea ${index + 1} con mucha explicación repetida que no debe entrar completa al pack.`,
			),
			"## Qué NO es",
			"No reemplaza al humano ni al orquestador.",
		].join("\n"),
		"utf8",
	);

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "measure readme human vision compactness" },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered(projectPath),
		},
	);

	assert.equal(result.ok, true);
	const humanVision = String(
		(result.data.goals as Record<string, unknown>).humanVision,
	);
	assert.match(humanVision, /cerebelo supervisor/u);
	assert.match(humanVision, /Qué NO es/u);
	assert.match(humanVision, /No reemplaza/u);
	assert.equal(humanVision.includes("context truncated"), false);
	assert.ok(humanVision.length <= 900);
});

test("idu_supervisor_context_pack preserves all priority README section hints", async () => {
	const projectPath = mkdtempSync(
		join(tmpdir(), "idu-context-pack-readme-priority-"),
	);
	writeFileSync(
		join(projectPath, "README.md"),
		[
			"# Idu-pi",
			"Idu-pi es un cerebelo supervisor de proyecto para el orquestador.",
			"## Qué problema resuelve",
			"Evita avanzar sin evidencia.",
			"## Qué NO es",
			"No reemplaza al humano.",
			"## Cómo funciona",
			"Consulta Plan Maestro y gates.",
			"## Arquitectura simple",
			"MCP asesora y el orquestador decide.",
			...Array.from(
				{ length: 80 },
				(_, index) =>
					`Supervisor orquestador AgentLab línea repetida ${index + 1} que no debe desplazar secciones clave.`,
			),
		].join("\n"),
		"utf8",
	);

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "measure all readme priority sections" },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered(projectPath),
		},
	);

	assert.equal(result.ok, true);
	const humanVision = String(
		(result.data.goals as Record<string, unknown>).humanVision,
	);
	assert.match(humanVision, /Qué problema/u);
	assert.match(humanVision, /Evita avanzar/u);
	assert.match(humanVision, /Qué NO es/u);
	assert.match(humanVision, /No reemplaza/u);
	assert.match(humanVision, /Cómo funciona/u);
	assert.match(humanVision, /Consulta Plan/u);
	assert.match(humanVision, /Arquitectura simple/u);
	assert.match(humanVision, /MCP asesora/u);
	assert.ok(humanVision.length <= 900);
});

test("idu_supervisor_context_pack limita README y request gigantes sin redistribuir prompt crudo", async () => {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-context-pack-large-"));
	writeFileSync(
		join(projectPath, "README.md"),
		`# Idu-pi\n\n${"texto enorme ".repeat(3000)}`,
		"utf8",
	);
	const hugeRequest = `audit frontend data agent context quality ${"PROMPT_GIGANTE_NO_REDISTRIBUIR ".repeat(1000)}`;
	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request: hugeRequest,
			includePlanSnapshot: false,
		},
		{
			runtimeFactory: factory(),
			projectResolver: () => registered(projectPath),
		},
	);

	assert.equal(result.ok, true);
	assert.equal(result.data.planSnapshot, undefined);
	const serialized = JSON.stringify(result.data);
	assert.equal(serialized.includes("originalText"), false);
	assert.ok(serialized.length < hugeRequest.length / 2);
	assert.ok(
		(serialized.match(/PROMPT_GIGANTE_NO_REDISTRIBUIR/gu) ?? []).length <= 30,
	);
	assert.match(String(result.data.request), /context truncated/u);
	assert.match(
		String((result.data.taskPackage as Record<string, unknown>).request),
		/context truncated/u,
	);
	assert.equal(
		JSON.stringify(result.data.supervisorConsultation).includes(
			"PROMPT_GIGANTE_NO_REDISTRIBUIR",
		),
		false,
	);
	const budget = result.data.contextBudget as ContextBudgetUsage;
	assert.equal(budget.profile, "supervisor_context_pack");
	assert.equal(budget.truncated, true);
});

test("MCP exposes direct Master Plan lifecycle tools", async () => {
	const status = await callIduMcpTool(
		"idu_master_plan_status",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(status.ok, true);
	assert.equal(status.data.status, "draft");
	assert.equal(status.data.currentPlanJson, "master-plan.json");

	const create = await callIduMcpTool(
		"idu_master_plan_create",
		{ reason: "crear plan normativo" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(create.ok, true);
	assert.equal(create.data.status, "draft");
	assert.equal(create.data.flowArtifact, "master-plan.flows.json");

	const review = await callIduMcpTool(
		"idu_master_plan_review",
		{ selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(review.ok, true);
	assert.match(String(review.data.markdown), /Plan Maestro/u);
	assert.equal(
		(
			review.data.revisionAntesDeZarpar as {
				requiredContracts: Array<{ category: string }>;
			}
		).requiredContracts.some((contract) => contract.category === "objective"),
		true,
	);
	assert.match(
		String(
			(
				review.data.revisionAntesDeZarpar as {
					recommendedAgentLabs: Array<{ name: string }>;
				}
			).recommendedAgentLabs[0]?.name,
		),
		/seguridad/iu,
	);

	const approve = await callIduMcpTool(
		"idu_master_plan_approve",
		{ selector: "latest", reason: "usuario confirmó contratos" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(approve.ok, true);
	assert.equal(approve.data.status, "approved");
	assert.equal(
		(approve.data.approval as { reason?: string }).reason,
		"usuario confirmó contratos",
	);
	assert.match(approve.safeNotes.join("\n"), /No apliqué flows/iu);
	assert.match(approve.safeNotes.join("\n"), /no toqué el repo real/iu);

	const reject = await callIduMcpTool(
		"idu_master_plan_reject",
		{ selector: "latest", reason: "objetivo incorrecto" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(reject.ok, true);
	assert.equal(reject.data.status, "rejected");
	assert.equal(
		(reject.data.approval as { reason?: string }).reason,
		"objetivo incorrecto",
	);
	assert.match(reject.safeNotes.join("\n"), /No borré drafts/iu);
});

test("idu_status works with explicit projectPath", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{ projectPath: "C:/projects/sistema" },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/sistema"),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.tool, "idu_status");
	assert.equal(result.projectId, "sistema_de_mantencion");
	assert.equal(result.projectPath, "C:/projects/sistema");
	assert.equal(result.data.configStatus, "project_local_valid");
});

test("idu_status works with mocked active project", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{},
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/active"),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.projectPath, "C:/projects/active");
});

test("MCP usage recording is visible when tool call resolves", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-usage-visible-"));
	try {
		const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
		const runtime = fakeRuntime("C:/projects/sistema");
		await callIduMcpTool(
			"idu_status",
			{},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered("C:/projects/sistema"),
					stateRoot,
				}),
			},
		);

		const usagePath = join(stateRoot, "reports", "idu-usage-events.jsonl");
		assert.equal(existsSync(usagePath), true);
		const event = JSON.parse(readFileSync(usagePath, "utf8").trim()) as {
			surface?: string;
			action?: string;
		};
		assert.equal(event.surface, "mcp");
		assert.equal(event.action, "idu_status");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("MCP usage recording does not write outside stateRoot", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-usage-"));
	try {
		const runtime = fakeRuntime("C:/projects/sistema");
		runtime.workspaceRoot = join(root, "workspace");
		await callIduMcpTool(
			"idu_status",
			{},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => registered("C:/projects/sistema"),
			},
		);
		assert.equal(
			existsSync(
				join(runtime.workspaceRoot, "reports", "idu-usage-events.jsonl"),
			),
			false,
		);

		const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
		await callIduMcpTool(
			"idu_status",
			{},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered("C:/projects/sistema"),
					stateRoot,
				}),
			},
		);
		await flushIduUsageEvents();
		const usagePath = join(stateRoot, "reports", "idu-usage-events.jsonl");
		assert.equal(existsSync(usagePath), true);
		const event = JSON.parse(readFileSync(usagePath, "utf8").trim()) as {
			surface?: string;
			action?: string;
		};
		assert.equal(event.surface, "mcp");
		assert.equal(event.action, "idu_status");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("MCP AgentLab tools record local effectiveness events without raw text", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-agentlab-effectiveness-"));
	try {
		const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
		const runtime = fakeRuntime("C:/projects/sistema");
		await callIduMcpTool(
			"idu_agentlab_request_create",
			{ source: "postflight", selector: "latest" },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered("C:/projects/sistema"),
					stateRoot,
				}),
			},
		);
		await flushAgentLabEffectivenessEvents();
		let events = readAgentLabEffectivenessEvents(stateRoot);
		let report = buildAgentLabEffectivenessReport(events);
		assert.equal(report.requestsCreated, 1);
		assert.equal(report.reviewRuns, 0);

		await callIduMcpTool(
			"idu_agentlab_review_run",
			{ selector: "latest" },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered("C:/projects/sistema"),
					stateRoot,
				}),
			},
		);
		await callIduMcpTool(
			"idu_agentlab_review_status",
			{ selector: "latest" },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered("C:/projects/sistema"),
					stateRoot,
				}),
			},
		);
		await flushAgentLabEffectivenessEvents();
		events = readAgentLabEffectivenessEvents(stateRoot);
		report = buildAgentLabEffectivenessReport(events);
		assert.equal(report.requestsCreated, 1);
		assert.equal(report.reviewRuns, 1);
		assert.equal(report.statusChecks, 1);
		assert.equal(report.remoteAnalytics, false);
		const serialized = JSON.stringify(events);
		for (const forbidden of [
			"prompt",
			"rawUserText",
			"env",
			"headers",
			"tokens",
			"cost",
			"contextPercent",
			"rawSummary",
		]) {
			assert.equal(serialized.includes(forbidden), false, forbidden);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_activate and idu_deactivate change session state", async () => {
	const sessionRoot = mkdtempSync(join(tmpdir(), "idu-mcp-session-"));
	configureIduSessionStore({
		workspaceRoot: sessionRoot,
		filePath: join(sessionRoot, "test-session-state.json"),
	});
	deactivateIduSession("sistema_de_mantencion");
	const activate = await callIduMcpTool(
		"idu_activate",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(activate.ok, true);
	assert.equal(activate.data.active, true);
	const deactivate = await callIduMcpTool(
		"idu_deactivate",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(deactivate.ok, true);
	assert.equal(deactivate.data.active, false);
});

test("idu_project_reset_state requires explicit confirmation", async () => {
	const result = await callIduMcpTool(
		"idu_project_reset_state",
		{ projectPath: "C:/projects/sistema" },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/sistema"),
		},
	);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /confirm=true/u);
});

test("idu_project_reset_state clears isolated state with confirmation", async () => {
	const result = await callIduMcpTool(
		"idu_project_reset_state",
		{ projectPath: "C:/projects/sistema", confirm: true },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/sistema"),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(
		result.data.stateRoot,
		"C:/idu/workspace/projects/sistema_de_mantencion",
	);
});

test("idu_preflight detects high auth/login risk", async () => {
	const result = await callIduMcpTool(
		"idu_preflight",
		{ request: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, true);
	const decisionEnvelope = result.data.decisionEnvelope as DecisionEnvelope;
	assert.equal(decisionEnvelope.version, 1);
	assert.equal(decisionEnvelope.authority, "advisory");
	assert.equal(decisionEnvelope.advisoryOnly, true);
	assert.equal(decisionEnvelope.tool, "idu_preflight");
	assert.equal(decisionEnvelope.recommendation, "ask_human");
	assert.equal(decisionEnvelope.requiresHuman, true);
	assert.equal(decisionEnvelope.allowedToProceed, false);
	assert.ok(
		decisionEnvelope.requiredActions.some(
			(action) => action.action === "approve_or_adjust_before_implementation",
		),
	);
	assert.equal(result.data.risk, "high");
	assert.equal(result.data.requiresHumanConfirmation, true);
	assert.deepEqual(result.data.detectedImpact, ["auth/seguridad", "login"]);
	assert.ok(Array.isArray(result.data.evidenceGateways));
	assert.equal(
		(result.data.evidenceGateways as Array<{ source: string }>)[0]?.source,
		"preflight",
	);
	assert.deepEqual(
		(result.data.alignmentAdvisory as { audience: string; severity: string })
			.audience,
		"orchestrator",
	);
	assert.equal(
		(result.data.alignmentAdvisory as { severity: string }).severity,
		"needs_approval",
	);
	assert.equal(
		(result.data.alignmentAdvisory as { recommendation: string })
			.recommendation,
		"ask_human",
	);
	const consultation = result.data.supervisorConsultation as {
		proceed: boolean;
		requiresHuman: boolean;
		stopRationale: string[];
		agentLabs: { autoRun: boolean };
	};
	assert.equal(consultation.proceed, false);
	assert.equal(consultation.requiresHuman, true);
	assert.ok(consultation.stopRationale.length > 0);
	assert.equal(consultation.agentLabs.autoRun, false);
	assert.equal(
		(result.data.governanceConfig as { mcpAuthorityMode: string })
			.mcpAuthorityMode,
		"advisory",
	);
	assert.ok(
		(
			result.data.workerBoundary as { agentLabsMustNot: string[] }
		).agentLabsMustNot.some((item) => /implementar/u.test(item)),
	);
});

test("idu_orchestrator_procedure and task_context guide without implementing", async () => {
	const procedure = await callIduMcpTool(
		"idu_orchestrator_procedure",
		{ purpose: "create_plan", request: "crear plan" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(procedure.ok, true);
	assert.match(procedure.summary, /Procedimiento asesor/u);
	assert.equal(
		(procedure.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(procedure.data.decisionEnvelope as DecisionEnvelope)
			.orchestratorDecisionRequired,
		true,
	);
	assert.ok(
		(procedure.data.procedure as string[]).some((step) =>
			/revalidar/i.test(step),
		),
	);
	assert.ok(
		(procedure.data.mustNot as string[]).some((step) =>
			/AgentLabs para codificar/u.test(step),
		),
	);

	const implementProcedure = await callIduMcpTool(
		"idu_orchestrator_procedure",
		{ purpose: "implement_change", request: "implementar cambio" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(implementProcedure.ok, true);
	const implementProcedureText = JSON.stringify(
		implementProcedure.data.procedure,
	);
	assert.match(implementProcedureText, /idu_supervisor_context_pack/u);
	assert.match(implementProcedureText, /idu_task_context/u);
	assert.match(
		JSON.stringify(implementProcedure.data.mustConsult),
		/idu_supervisor_context_pack/u,
	);
	assert.equal(
		(implementProcedure.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(implementProcedure.data.decisionEnvelope as DecisionEnvelope)
			.orchestratorDecisionRequired,
		true,
	);

	const context = await callIduMcpTool(
		"idu_task_context",
		{ request: "cambiar login" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(context.ok, true);
	assert.match(context.summary, /Contexto asesor/u);
	assert.equal(
		(context.data.decisionEnvelope as DecisionEnvelope).recommendation,
		"ask_human",
	);
	assert.equal(
		(context.data.alignmentAdvisory as { recommendation: string })
			.recommendation,
		"ask_human",
	);
	assert.ok(
		(context.data.alignmentAdvisory as { requiredReads: string[] })
			.requiredReads.length > 0,
	);
});

test("approved plan advisory loop returns snapshot, next action, and task package", async () => {
	const options = {
		runtimeFactory: factory(),
		projectResolver: () => registered(),
	};
	const snapshot = await callIduMcpTool("idu_plan_snapshot", {}, options);
	assert.equal(snapshot.ok, true);
	assert.equal(snapshot.data.authority, "advisory");
	assert.equal(snapshot.data.planStatus, "approved");
	assert.match(String(snapshot.data.objective), /gobernanza preventiva/u);
	assert.ok((snapshot.data.operationalContracts as unknown[]).length > 0);
	assert.ok((snapshot.data.flows as unknown[]).length > 0);
	const snapshotBudget = snapshot.data.contextBudget as ContextBudgetUsage;
	assert.equal(snapshotBudget.profile, "plan_snapshot");
	assert.equal(snapshotBudget.advisoryOnly, true);
	assert.equal(snapshotBudget.contractPromotionAllowed, false);

	const contextPack = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "mejorar MCP" },
		options,
	);
	assert.equal(contextPack.ok, true);
	assert.equal(contextPack.data.authority, "advisory");
	assert.equal(contextPack.data.audience, "orchestrator_subagents");
	const contextPackBudget = contextPack.data
		.contextBudget as ContextBudgetUsage;
	assert.equal(contextPackBudget.profile, "supervisor_context_pack");
	assert.ok(contextPack.data.taskPackage);
	assert.ok(contextPack.data.taskContext);
	assert.ok(Array.isArray(contextPack.data.autonomyGates));

	const next = await callIduMcpTool(
		"idu_next_advisory_action",
		{ request: "mejorar MCP", maxScope: "small" },
		options,
	);
	assert.equal(next.ok, true);
	assert.equal(next.data.authority, "advisory");
	assert.equal(
		(next.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(next.data.decisionEnvelope as DecisionEnvelope)
			.orchestratorDecisionRequired,
		true,
	);
	assert.equal(next.data.implementationOwner, "orchestrator");
	assert.equal(next.data.agentLabsRole, "audit_only");
	const candidate = next.data.candidateAction as {
		title: string;
		contractsAffected: string[];
		requiredReads: string[];
		acceptanceCriteria: string[];
	};
	assert.match(candidate.title, /acción candidata|loop MCP|mejorar MCP/iu);
	assert.ok(candidate.contractsAffected.includes("agent"));
	assert.ok(candidate.requiredReads.some((read) => /Plan Maestro/u.test(read)));
	assert.ok(candidate.acceptanceCriteria.length > 0);
	assert.equal(
		(next.data.agentLabPolicy as { execution: string }).execution,
		"orchestrator_explicit_call_only",
	);

	const continuationRuntime = fakeRuntime();
	continuationRuntime.createTask(
		"bug",
		"mejorar MCP con siguiente tarea segura",
	);
	const continuation = await callIduMcpTool(
		"idu_continuation_proposal",
		{ autonomyWindowMinutes: 240, maxScope: "medium" },
		{
			runtimeFactory: () => continuationRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(continuation.ok, true);
	assert.equal(continuation.data.authority, "advisory");
	assert.equal(continuation.data.decision, "continue_autonomously");
	assert.equal(continuation.data.allowedToProceed, true);
	assert.equal(continuation.data.requiresHuman, false);
	assert.equal(continuation.data.orchestratorDecisionRequired, true);
	assert.equal(
		(continuation.data.planAlignment as { planStatus: string }).planStatus,
		"approved",
	);
	assert.equal(
		(continuation.data.queueProgress as { selectedTaskGuardStatus: string })
			.selectedTaskGuardStatus,
		"clear",
	);
	assert.equal(
		(continuation.data.candidateAction as { origin: string }).origin,
		"queue",
	);
	assert.match(
		String((continuation.data.candidateAction as { title: string }).title),
		/mejorar MCP/u,
	);
	assert.equal(
		(continuation.data.agentLabPolicy as { execution: string }).execution,
		"orchestrator_explicit_call_only",
	);

	const continuationWithRequestRuntime = fakeRuntime();
	continuationWithRequestRuntime.createTask(
		"bug",
		"mejorar arranque autónomo con siguiente tarea segura",
	);
	const continuationWithRequest = await callIduMcpTool(
		"idu_continuation_proposal",
		{
			request: "seguir tarea aprobada de arranque autónomo",
			autonomyWindowMinutes: 120,
			maxScope: "medium",
		},
		{
			runtimeFactory: () => continuationWithRequestRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(continuationWithRequest.ok, true);
	assert.equal(continuationWithRequest.data.decision, "continue_autonomously");
	assert.equal(continuationWithRequest.data.allowedToProceed, true);
	assert.equal(
		(continuationWithRequest.data.candidateAction as { origin: string }).origin,
		"queue",
	);
	assert.match(
		String(
			(continuationWithRequest.data.candidateAction as { title: string }).title,
		),
		/arranque autónomo/u,
	);
	assert.equal(
		(
			continuationWithRequest.data.queueProgress as {
				selectedTaskGuardStatus: string;
			}
		).selectedTaskGuardStatus,
		"clear",
	);
	assert.equal(
		(continuationWithRequest.data.planAlignment as { withinObjective: boolean })
			.withinObjective,
		true,
	);
	assert.doesNotMatch(
		(
			continuationWithRequest.data.planAlignment as { blockers: string[] }
		).blockers.join("\n"),
		/tarea de cola aprobada/iu,
	);
	assert.equal(
		(continuationWithRequest.data.decisionEnvelope as DecisionEnvelope)
			.allowedToProceed,
		true,
	);
	assert.equal(
		(continuation.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
		true,
	);
	assert.match(continuation.safeNotes.join("\n"), /no implementa/iu);

	const riskyContinuationRuntime = fakeRuntime();
	riskyContinuationRuntime.createTask(
		"bug",
		"arreglar login auth con cambio sensible",
	);
	const riskyContinuation = await callIduMcpTool(
		"idu_continuation_proposal",
		{ autonomyWindowMinutes: 240, maxScope: "medium" },
		{
			runtimeFactory: () => riskyContinuationRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(riskyContinuation.ok, true);
	assert.equal(riskyContinuation.data.decision, "ask_user");
	assert.equal(riskyContinuation.data.allowedToProceed, false);
	assert.equal(riskyContinuation.data.requiresHuman, true);
	assert.equal(
		(riskyContinuation.data.queueProgress as { selectedTaskGuardRisk: string })
			.selectedTaskGuardRisk,
		"high",
	);
	assert.equal(
		(riskyContinuation.data.taskPackage as { humanApprovalRequired: boolean })
			.humanApprovalRequired,
		true,
	);
	assert.equal(
		(
			riskyContinuation.data.taskPackage as {
				preconditions: { blocked: boolean };
			}
		).preconditions.blocked,
		true,
	);

	const blockedQueueRuntime = fakeRuntime();
	blockedQueueRuntime.createTask("bug", "arreglar login auth pendiente");
	const bypassAttempt = await callIduMcpTool(
		"idu_continuation_proposal",
		{
			request: "mejorar documentación menor",
			autonomyWindowMinutes: 240,
			maxScope: "small",
		},
		{
			runtimeFactory: () => blockedQueueRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(bypassAttempt.ok, true);
	assert.equal(bypassAttempt.data.decision, "ask_user");
	assert.equal(bypassAttempt.data.allowedToProceed, false);
	assert.equal(
		(bypassAttempt.data.queueProgress as { blockingPendingTaskId: string })
			.blockingPendingTaskId,
		"task-20260525-000002",
	);

	const arbitraryRequest = await callIduMcpTool(
		"idu_continuation_proposal",
		{
			request: "crear módulo de pagos fuera del plan",
			autonomyWindowMinutes: 240,
			maxScope: "small",
		},
		{
			runtimeFactory: () => fakeRuntime(),
			projectResolver: () => registered(),
		},
	);
	assert.equal(arbitraryRequest.ok, true);
	assert.equal(arbitraryRequest.data.decision, "ask_user");
	assert.equal(arbitraryRequest.data.allowedToProceed, false);
	assert.equal(
		(arbitraryRequest.data.planAlignment as { withinObjective: boolean })
			.withinObjective,
		false,
	);

	const taskPackage = await callIduMcpTool(
		"idu_task_package_create",
		{ request: "mejorar MCP", actionId: "plan-action-test" },
		options,
	);
	assert.equal(taskPackage.ok, true);
	assert.equal(taskPackage.data.implementationOwner, "normal_subagents");
	assert.equal(taskPackage.data.iduRole, "advisor_auditor");
	assert.equal(taskPackage.data.agentLabsRole, "audit_only");
	assert.ok(Array.isArray(taskPackage.data.evidenceGateways));
	assert.equal(
		(taskPackage.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(taskPackage.data.decisionEnvelope as DecisionEnvelope)
			.orchestratorDecisionRequired,
		true,
	);
	assert.ok(
		(
			taskPackage.data.decisionEnvelope as DecisionEnvelope
		).requiredActions.some(
			(action) => action.action === "run_governance_review_before_worker",
		),
	);
	assert.equal(
		(taskPackage.data.evidenceGateways as Array<{ source: string }>)[0]?.source,
		"task_package",
	);
	assert.deepEqual(taskPackage.data.preconditions, {
		planApproved: true,
		blocked: false,
		blockers: [],
		recommendation: "governance_review",
	});
	assert.equal(
		(taskPackage.data.governanceReview as { required: boolean }).required,
		true,
	);
	assert.ok(
		(taskPackage.data.stopConditions as string[]).some((condition) =>
			/AgentLab/u.test(condition),
		),
	);
});

test("idu_supervisor_context_pack budgets only embedded compact plan snapshot", async () => {
	const runtime = fakeRuntime();
	runtime.masterPlanReview = () =>
		({
			current: {},
			jsonPath: "C:/idu/workspace/projects/sistema/master-plan.json",
			markdown: "# Plan Maestro approved",
			revisionAntesDeZarpar: { recommendedAgentLabs: [] },
			plan: {
				status: "approved",
				executiveSummary: "Resumen compacto.",
				inferredObjective: "Objetivo compacto.",
				criticalRisks: [],
				operationalContracts: Array.from({ length: 20 }, (_, index) => ({
					area: "agent",
					title: `Contrato ${index}`,
					rules: [`Regla extensa ${index} ${"x".repeat(900)}`],
				})),
				projectFlows: Array.from({ length: 20 }, (_, index) => ({
					name: `Flujo ${index}`,
					rules: [`Regla de flujo ${"y".repeat(900)}`],
				})),
			},
		}) as never;
	const options = {
		runtimeFactory: () => runtime,
		projectResolver: () => registered(),
	};

	const snapshot = await callIduMcpTool("idu_plan_snapshot", {}, options);
	const snapshotBudget = snapshot.data.contextBudget as ContextBudgetUsage;
	assert.equal(snapshotBudget.profile, "plan_snapshot");
	assert.equal(snapshotBudget.truncated, true);
	assert.ok(
		snapshotBudget.omitted.some((omission) =>
			omission.path.startsWith("operationalContracts"),
		),
	);
	assert.ok(
		snapshotBudget.omitted.some((omission) =>
			omission.path.startsWith("flows"),
		),
	);

	const pack = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "measure compact embedded snapshot", includePlanSnapshot: true },
		options,
	);
	assert.equal(pack.ok, true);
	assert.equal(
		(pack.data.planSnapshot as Record<string, unknown>).operationalContracts,
		undefined,
	);
	assert.equal(
		(pack.data.planSnapshot as Record<string, unknown>).flows,
		undefined,
	);
	const packBudget = pack.data.contextBudget as ContextBudgetUsage;
	assert.equal(packBudget.profile, "supervisor_context_pack");
	assert.equal(
		packBudget.omitted.some((omission) =>
			omission.path.startsWith("operationalContracts"),
		),
		false,
	);
	assert.equal(
		packBudget.omitted.some((omission) => omission.path.startsWith("flows")),
		false,
	);
	assert.equal(
		packBudget.omitted.some(
			(omission) => omission.path === "contextBudget.total",
		),
		false,
	);
});

test("idu_supervisor_context_pack budgets actual embedded plan snapshot size", async () => {
	const runtime = fakeRuntime();
	runtime.masterPlanReview = () =>
		({
			current: {},
			jsonPath: "C:/idu/workspace/projects/sistema/master-plan.json",
			markdown: "# Plan Maestro approved",
			revisionAntesDeZarpar: { recommendedAgentLabs: [] },
			plan: {
				status: "approved",
				executiveSummary: "Resumen compacto ".repeat(80),
				inferredObjective: "Objetivo compacto ".repeat(80),
				criticalRisks: Array.from(
					{ length: 8 },
					(_, index) => `Blocker ${index} ${"z".repeat(180)}`,
				),
				recommendedNext: Array.from(
					{ length: 8 },
					(_, index) => `Next ${index} ${"n".repeat(180)}`,
				),
				operationalContracts: [],
				projectFlows: [],
			},
		}) as never;
	const pack = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request: "measure huge compact embedded snapshot",
			includePlanSnapshot: true,
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	assert.equal(pack.ok, true);
	const serializedPlanSnapshotLength = JSON.stringify(
		pack.data.planSnapshot,
	).length;
	const packBudget = pack.data.contextBudget as ContextBudgetUsage;
	assert.ok(serializedPlanSnapshotLength > 2_200);
	assert.ok(packBudget.usedChars >= serializedPlanSnapshotLength);
	assert.equal(
		packBudget.omitted.some((omission) => omission.path === "planSnapshot"),
		false,
	);
});

test("MCP context budgets report plan and source truncation explicitly", async () => {
	const runtime = fakeRuntime();
	runtime.masterPlanReview = () =>
		({
			current: {},
			jsonPath: "C:/idu/workspace/projects/sistema/master-plan.json",
			markdown: "# Plan Maestro approved",
			revisionAntesDeZarpar: { recommendedAgentLabs: [] },
			plan: {
				status: "approved",
				executiveSummary: "Resumen ".repeat(400),
				inferredObjective: "Objetivo ".repeat(400),
				criticalRisks: [],
				operationalContracts: Array.from({ length: 20 }, (_, index) => ({
					area: "agent",
					title: `Contrato ${index}`,
					rules: [`Regla extensa ${index} ${"x".repeat(900)}`],
				})),
				projectFlows: Array.from({ length: 20 }, (_, index) => ({
					name: `Flujo ${index}`,
					rules: [`Regla de flujo ${"y".repeat(900)}`],
				})),
			},
		}) as never;
	runtime.sourceLibraryRead = () => ({
		...fakeRuntime().sourceLibraryRead("source-demo-manual-abc123"),
		content: "manual ".repeat(2_000),
		maxChars: 100,
		truncated: true,
	});

	const options = {
		runtimeFactory: () => runtime,
		projectResolver: () => registered(),
	};
	const snapshot = await callIduMcpTool("idu_plan_snapshot", {}, options);
	const snapshotBudget = snapshot.data.contextBudget as ContextBudgetUsage;
	assert.equal(snapshotBudget.profile, "plan_snapshot");
	assert.equal(snapshotBudget.truncated, true);
	assert.ok(
		snapshotBudget.omitted.some(
			(omission) =>
				omission.path === "objective" ||
				omission.path === "operationalContracts",
		),
	);
	assert.equal(snapshotBudget.advisoryOnly, true);
	assert.equal(snapshotBudget.contractPromotionAllowed, false);

	const read = await callIduMcpTool(
		"idu_source_read",
		{ sourceId: "source-demo-manual-abc123" },
		options,
	);
	const readBudget = (
		read.data.result as { contextBudgetUsage: ContextBudgetUsage }
	).contextBudgetUsage;
	assert.equal(readBudget.profile, "source_chunk_read");
	assert.equal(readBudget.truncated, true);
	assert.ok(
		readBudget.omitted.some(
			(omission) =>
				omission.path === "result.content" && omission.reason === "max_chars",
		),
	);
	assert.equal(readBudget.advisoryOnly, true);
	assert.equal(readBudget.contractPromotionAllowed, false);
});

test("task package blocks implementation when Plan Maestro is not approved", async () => {
	const runtime = fakeRuntime();
	runtime.masterPlanReview = () =>
		({
			current: {},
			jsonPath: "C:/idu/workspace/projects/sistema/master-plan.json",
			markdown: "# Plan Maestro draft",
			revisionAntesDeZarpar: { recommendedAgentLabs: [] },
			plan: {
				status: "draft",
				inferredObjective: "Objetivo pendiente.",
				criticalRisks: [],
				operationalContracts: [],
				projectFlows: [],
			},
		}) as never;
	const taskPackage = await callIduMcpTool(
		"idu_task_package_create",
		{ request: "crear loop automático" },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	assert.equal(taskPackage.ok, true);
	assert.equal(taskPackage.data.recommendation, "ask_human");
	assert.deepEqual(taskPackage.data.preconditions, {
		planApproved: false,
		blocked: true,
		blockers: ["Plan Maestro no aprobado"],
		recommendation: "ask_human",
	});
	assert.equal(taskPackage.data.humanApprovalRequired, true);
});

test("idu_postflight reports advisory task trace without applying changes", async () => {
	const result = await callIduMcpTool(
		"idu_postflight",
		{
			actionId: "plan-action-test",
			taskPackageId: "pkg-test",
			expectedContracts: ["security", "data"],
			expectedFiles: ["src/"],
			expectedChangeMode: "code",
		},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, true);
	const decisionEnvelope = result.data.decisionEnvelope as DecisionEnvelope;
	assert.equal(decisionEnvelope.authority, "advisory");
	assert.equal(decisionEnvelope.allowedToProceed, false);
	assert.ok(
		decisionEnvelope.requiredActions.some(
			(action) => action.action === "resolve_task_trace_delta",
		),
	);
	assert.ok(Array.isArray(result.data.evidenceGateways));
	assert.ok(Array.isArray(result.data.physicalGates));
	assert.ok(Array.isArray(result.data.physicalGateways));
	assert.equal(
		(result.data.evidenceGateways as Array<{ source: string }>)[0]?.source,
		"postflight",
	);
	assert.equal(
		(result.data.physicalGateways as Array<{ source: string }>)[0]?.source,
		"physical_gate",
	);
	assert.equal(
		(result.data.physicalGates as Array<{ destructive: boolean }>).every(
			(gate) => gate.destructive === false,
		),
		true,
	);
	const trace = result.data.taskTrace as {
		actionId: string;
		taskPackageId: string;
		matchesIntent: boolean;
		expectedChangeMode: string;
		observedChangeMode: string;
		observedContracts: string[];
		missingExpectedContracts: string[];
		contractDelta: Array<{ contract: string; status: string }>;
	};
	assert.equal(trace.actionId, "plan-action-test");
	assert.equal(trace.taskPackageId, "pkg-test");
	assert.equal(trace.expectedChangeMode, "code");
	assert.equal(trace.observedChangeMode, "code");
	assert.equal(trace.matchesIntent, false);
	assert.ok(trace.observedContracts.includes("security"));
	assert.deepEqual(trace.missingExpectedContracts, ["data"]);
	assert.deepEqual(trace.contractDelta, [
		{ contract: "data", status: "expected_not_observed" },
	]);
	const consultation = result.data.supervisorConsultation as {
		proceed: boolean;
		stopRationale: string[];
		evidenceRefs: string[];
		agentLabs: { mode: string; autoRun: boolean };
	};
	assert.equal(consultation.proceed, false);
	assert.ok(consultation.stopRationale.some((item) => /data/u.test(item)));
	assert.ok(consultation.evidenceRefs.length > 0);
	assert.equal(consultation.agentLabs.mode, "audit_only");
	assert.equal(consultation.agentLabs.autoRun, false);
	assert.match(
		result.safeNotes.join("\n"),
		/no ejecutó build\/test automáticamente/u,
	);
	assert.match(result.safeNotes.join("\n"), /no cierra ni aplica/u);
});

test("idu_postflight accepts expectedChangeMode and maps normalized contracts", async () => {
	const runtime = fakeRuntime();
	runtime.postflight = (): ProjectPostflightReport => ({
		risk: "low",
		changedFiles: [
			"src/lab-db.ts",
			"src/components/Button.tsx",
			"test/ui.test.ts",
		],
		ignoredFiles: ["subagent-artifacts/review.md"],
		observedChangeMode: "code",
		impactedAreas: ["DB/storage", "UI", "orquestación", "tests"],
		warnings: [],
		recommendedNext: "Revisar cambios.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	});
	const result = await callIduMcpTool(
		"idu_postflight",
		{
			expectedContracts: ["data", "frontend", "agent", "tests"],
			expectedFiles: ["src/", "test/"],
			expectedChangeMode: "code",
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	const trace = result.data.taskTrace as {
		matchesIntent: boolean;
		ignoredFiles: string[];
		observedContracts: string[];
		missingExpectedContracts: string[];
		modeDelta: unknown;
	};
	assert.equal(result.ok, true);
	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.ignoredFiles, ["subagent-artifacts/review.md"]);
	assert.deepEqual(trace.missingExpectedContracts, []);
	assert.equal(trace.modeDelta, null);
	assert.ok(trace.observedContracts.includes("data"));
	assert.ok(trace.observedContracts.includes("frontend"));
	assert.ok(trace.observedContracts.includes("agent"));
	assert.ok(trace.observedContracts.includes("tests"));
});

test("idu_postflight accepts explicit ignored files for task trace", async () => {
	const runtime = fakeRuntime();
	runtime.postflight = (): ProjectPostflightReport => ({
		risk: "low",
		changedFiles: ["src/mcp-server.ts", "context.md"],
		ignoredFiles: [],
		observedChangeMode: "code",
		impactedAreas: ["orquestación"],
		warnings: [],
		recommendedNext: "Revisar cambios.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	});
	const result = await callIduMcpTool(
		"idu_postflight",
		{
			expectedContracts: ["agent"],
			expectedFiles: ["src/"],
			expectedChangeMode: "code",
			ignoredFiles: ["context.md"],
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	const trace = result.data.taskTrace as {
		matchesIntent: boolean;
		ignoredFiles: string[];
		unexpectedAreas: string[];
	};
	const decisionEnvelope = result.data.decisionEnvelope as DecisionEnvelope;

	assert.equal(result.ok, true);
	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	assert.deepEqual(trace.ignoredFiles, ["context.md"]);
	assert.equal(
		decisionEnvelope.requiredActions.some(
			(action) => action.action === "resolve_task_trace_delta",
		),
		false,
	);
});

test("idu_postflight stays advisory with active session and no-op mode", async () => {
	const runtime = fakeRuntime();
	runtime.supervisorOnIduActivation();
	runtime.postflight = (): ProjectPostflightReport => ({
		risk: "low",
		changedFiles: [],
		ignoredFiles: ["subagent-artifacts/review.md"],
		observedChangeMode: "no-op",
		impactedAreas: [],
		warnings: [],
		recommendedNext: "Sin cambios locales detectados.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	});
	const result = await callIduMcpTool(
		"idu_postflight",
		{ expectedChangeMode: "no-op" },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	const trace = result.data.taskTrace as { matchesIntent: boolean };
	assert.equal(result.ok, true);
	assert.equal(trace.matchesIntent, true);
	assert.equal(result.data.requiresHumanConfirmation, false);
	assert.deepEqual(result.data.suggestedAgentLabs, []);
	assert.match(result.safeNotes.join("\n"), /no hace commit ni push/u);
});

test("idu_orchestrator_procedure validates purpose at runtime", async () => {
	const result = await callIduMcpTool(
		"idu_orchestrator_procedure",
		{ purpose: "unknown" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /Invalid argument purpose/u);
});

test("idu_task respects active and inactive guardrails", async () => {
	const activeRuntime = fakeRuntime();
	activeRuntime.supervisorOnIduActivation();
	const active = await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{
			runtimeFactory: () => activeRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(active.data.guardStatus, "needs_confirmation");
	assert.equal(active.data.guardRisk, "high");

	const inactive = await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.notEqual(inactive.data.guardStatus, "needs_confirmation");
});

test("idu_supervisor_tick skips when inactive", async () => {
	const result = await callIduMcpTool(
		"idu_supervisor_tick",
		{ allowSemanticDraft: false, allowAgentTaskPlan: false },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, true);
	assert.equal(result.data.status, "skipped");
	assert.equal(result.data.reason, "idu_inactive");
	assert.equal(
		(result.data.alignmentAdvisory as { audience: string }).audience,
		"orchestrator",
	);
	assert.equal(
		(result.data.alignmentAdvisory as { severity: string }).severity,
		"warning",
	);
});

test("idu_supervisor_cron_plan is advisory-only and does not execute", async () => {
	const runtime = fakeRuntime();
	runtime.supervisorOnIduActivation();
	const result = await callIduMcpTool(
		"idu_supervisor_cron_plan",
		{},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	assert.equal(result.ok, true);
	assert.equal(result.data.classification, "watch");
	assert.equal(result.data.advisoryOnly, true);
	assert.equal(result.data.writesAllowed, false);
	assert.equal(result.data.agentLabsAllowed, false);
	assert.match(result.safeNotes.join("\n"), /advisory-only/u);
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(result.data.plan as IduSupervisorCronPlanResult).loop.trigger,
		"cron_planning",
	);
});

test("idu_architectural_pruning_plan is advisory-only", async () => {
	const result = await callIduMcpTool(
		"idu_architectural_pruning_plan",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);

	assert.equal(result.ok, true);
	assert.ok(Array.isArray(result.data.candidates));
	assert.equal((result.data.plan as { noDeletion: boolean }).noDeletion, true);
	assert.equal(
		(result.data.plan as { noAutoApprove: boolean }).noAutoApprove,
		true,
	);
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
		false,
	);
	assert.ok(
		(result.data.decisionEnvelope as DecisionEnvelope).requiredActions.some(
			(action) => action.action === "review_pruning_plan_before_changes",
		),
	);
	assert.match(result.safeNotes.join("\n"), /no borré archivos/u);
});

test("idu_bibliotecario_proactive_advisory composes bounded advisory surfaces", async () => {
	const runtime = fakeRuntime();
	runtime.sourceRecommend = (request) => ({
		projectId: "sistema_de_mantencion",
		request: `${request} ${"q".repeat(1000)}`,
		generatedAt: "2026-06-01T00:00:00.000Z",
		matches: [
			{
				sourceId: `source-${"a".repeat(400)}`,
				title: `Huge local source ${"b".repeat(400)}`,
				chunkIds: Array.from({ length: 20 }, (_, index) => `chunk-${index}`),
				whyRelevant: `Relevant ${"c".repeat(1000)}`,
				confidence: "high",
				orchestratorInstruction: `Read ${"d".repeat(1000)}`,
				contractPromotionAllowed: false,
				content: "RAW_CHUNK_BODY_MUST_NOT_LEAK",
			} as any,
		],
		missingKnowledge: [`Missing ${"e".repeat(1000)}`],
		limitations: [`Limit ${"f".repeat(1000)}`],
		contractPromotionAllowed: false,
	});
	const result = await callIduMcpTool(
		"idu_bibliotecario_proactive_advisory",
		{
			request:
				"plan contracts npm TypeScript repeated failures and skill optimization",
			domains: ["security", "web"],
			language: "typescript",
			framework: "node",
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	assert.equal(result.ok, true);
	const data = result.data as {
		decisionEnvelope: DecisionEnvelope;
		planLibrarian: unknown;
		sourceEcosystem: {
			local: {
				matches: Array<{ chunkIds: string[]; whyRelevant: string }>;
				contextPressure: {
					rawContentIncluded: boolean;
					tokenCostMeasured: boolean;
					pressure: string;
				};
			};
		};
		skillOptimization: { skillPromotionAllowed: boolean };
		failureSemanticDebt: unknown;
		resourceContextCheck: {
			rawContentIncluded: boolean;
			webFetchAllowed: boolean;
			writesAllowed: boolean;
			agentLabAutoRunAllowed: boolean;
			contractPromotionAllowed: boolean;
			skillPromotionAllowed: boolean;
			tokenCostMeasured: boolean;
			estimatedTokenUse: string;
			pressure: string;
		};
	};
	assert.equal(data.decisionEnvelope.authority, "advisory");
	assert.equal(data.decisionEnvelope.allowedToProceed, false);
	assert.ok(data.planLibrarian);
	assert.ok(data.sourceEcosystem);
	assert.equal(data.sourceEcosystem.local.matches[0].chunkIds.length, 5);
	assert.ok(data.sourceEcosystem.local.matches[0].whyRelevant.length <= 280);
	assert.equal(
		data.sourceEcosystem.local.contextPressure.rawContentIncluded,
		false,
	);
	assert.equal(
		data.sourceEcosystem.local.contextPressure.tokenCostMeasured,
		false,
	);
	assert.equal(data.sourceEcosystem.local.contextPressure.pressure, "medium");
	assert.ok(data.skillOptimization);
	assert.ok(data.failureSemanticDebt);
	assert.ok(data.resourceContextCheck);
	assert.equal(data.resourceContextCheck.rawContentIncluded, false);
	assert.equal(data.resourceContextCheck.webFetchAllowed, false);
	assert.equal(data.resourceContextCheck.writesAllowed, false);
	assert.equal(data.resourceContextCheck.agentLabAutoRunAllowed, false);
	assert.equal(data.resourceContextCheck.contractPromotionAllowed, false);
	assert.equal(data.resourceContextCheck.skillPromotionAllowed, false);
	assert.equal(data.resourceContextCheck.tokenCostMeasured, false);
	assert.equal(data.resourceContextCheck.estimatedTokenUse, "not_measured");
	assert.match(data.resourceContextCheck.pressure, /^(low|medium|high)$/u);
	assert.equal(data.skillOptimization.skillPromotionAllowed, false);
	assert.match(result.safeNotes.join("\n"), /No ejecuté AgentLabs/iu);
	const serialized = JSON.stringify(result.data);
	assert.doesNotMatch(serialized, /manual robusto/u);
	assert.doesNotMatch(serialized, /RAW DRAFT PREVIEW/u);
	assert.doesNotMatch(serialized, /draftPreview/u);
	assert.doesNotMatch(serialized, /draftTargetPath/u);
});

test("idu_skill_draft_from_lessons creates advisory learning artifacts", async () => {
	const runtime = fakeRuntime();
	runtime.skillDraftFromLessons = (options = {}) => ({
		mode: options.mode ?? "proposal-only",
		selector: options.selector ?? "semantic-compaction-draft.json",
		semanticDraftPath: "semantic-compaction-draft.json",
		proposalsPath: "skill-improvement-proposals.json",
		createdProposals: [
			{
				id: "skill-improvement-001",
				type: "create_skill",
				skillName: "ci-hermetic-testing",
				title: "Create CI hermetic testing skill",
				description: "Capture failure lessons.",
				evidence: ["CI failed without local .env"],
				sourceDraftPath: "semantic-compaction-draft.json",
				riskLevel: "medium",
				expectedBenefit: ["quality", "safety"],
				requiresHumanApproval: true,
				suggestedAction: "approve_for_agent_review",
				status: "proposed",
				createdAt: "2026-06-04T12:00:00.000Z",
			},
		],
		createdDrafts: [],
		omittedProposals: [],
		nextActions: ["Approve a proposal before draft generation."],
		requiredActions: ["Review skill improvement proposals."],
		allowedToProceed: false,
		advisoryOnly: true,
		safeNotes: [
			"No modifiqué skills reales, .agents ni .atl.",
			"No ejecuté AgentLabs automáticamente.",
		],
	});
	const result = await callIduMcpTool(
		"idu_skill_draft_from_lessons",
		{ mode: "proposal-only" },
		{
			runtimeFactory: () => runtime,
			projectResolver: () => registered(),
		},
	);

	assert.equal(result.ok, true);
	const data = result.data as {
		result: {
			mode: string;
			createdProposals: unknown[];
			createdDrafts: unknown[];
		};
		decisionEnvelope: { allowedToProceed: boolean; requiresHuman: boolean };
	};
	assert.equal(data.result.mode, "proposal-only");
	assert.equal(data.result.createdProposals.length, 1);
	assert.equal(data.result.createdDrafts.length, 0);
	assert.equal(data.decisionEnvelope.allowedToProceed, false);
	assert.equal(data.decisionEnvelope.requiresHuman, true);
	assert.match(result.safeNotes.join("\n"), /No modifiqué skills reales/u);
	assert.match(result.safeNotes.join("\n"), /No ejecuté AgentLabs/u);
});

test("idu_context_pruning_advisory is read-only and advisory-only", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-context-pruning-mcp-"));
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
		mkdirSync(projectPath, { recursive: true });
		mkdirSync(join(projectPath, "docs", "superpowers", "plans"), {
			recursive: true,
		});
		writeFileSync(
			join(projectPath, "docs", "superpowers", "plans", "2026-01-01-old.md"),
			"# Raw task prompt that must not be copied\n- [ ] open\n",
			"utf8",
		);
		const runtime = fakeRuntime(projectPath);
		runtime.workspaceRoot = stateRoot;
		const result = await callIduMcpTool(
			"idu_context_pruning_advisory",
			{},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered(projectPath),
					stateRoot,
				}),
			},
		);

		assert.equal(result.ok, true);
		const report = result.data.report as {
			mode: string;
			noDeletion: boolean;
			noAutoDelete: boolean;
			noContractPromotion: boolean;
			rawPromptsStored: boolean;
			rawDocsStored: boolean;
			remoteAnalytics: boolean;
			signals: unknown[];
		};
		assert.equal(report.mode, "advisory_only");
		assert.equal(report.noDeletion, true);
		assert.equal(report.noAutoDelete, true);
		assert.equal(report.noContractPromotion, true);
		assert.equal(report.rawPromptsStored, false);
		assert.equal(report.rawDocsStored, false);
		assert.equal(report.remoteAnalytics, false);
		assert.ok(report.signals.length > 0);
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).authority,
			"advisory",
		);
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
			false,
		);
		const serialized = JSON.stringify(result);
		assert.equal(
			serialized.includes("Raw task prompt that must not be copied"),
			false,
		);
		assert.match(result.safeNotes.join("\n"), /no borré archivos/u);
		assert.match(result.safeNotes.join("\n"), /No promoví contratos/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("autonomous alert MCP tools are listed", () => {
	const tools = listIduMcpTools().map((tool) => tool.name);
	assert.ok(tools.includes("idu_autonomous_alerts_status"));
	assert.ok(tools.includes("idu_autonomous_alerts_tick"));
	assert.ok(tools.includes("idu_autonomous_alerts_control"));
});

test("autonomous alert status is read-only and raw honest", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-status-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		const result = await callIduMcpTool(
			"idu_autonomous_alerts_status",
			{},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({ ...registered(), stateRoot }),
			},
		);
		assert.equal(result.ok, true);
		const report = result.data.report as {
			rawHonesty: boolean;
			noImplementation: boolean;
			agentLabsExecuted: boolean;
		};
		assert.equal(report.rawHonesty, true);
		assert.equal(report.noImplementation, true);
		assert.equal(report.agentLabsExecuted, false);
		assert.equal(existsSync(stateRoot), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("autonomous alert control writes only alert control state", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-control-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		const result = await callIduMcpTool(
			"idu_autonomous_alerts_control",
			{ action: "disable", reason: "user stop" },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({ ...registered(), stateRoot }),
			},
		);
		assert.equal(result.ok, true);
		const state = result.data.state as {
			control: { active: boolean; reason?: string };
		};
		assert.equal(state.control.active, false);
		assert.equal(state.control.reason, "user stop");
		assert.equal(
			existsSync(
				join(stateRoot, "reports", "autonomous-alert-engine-state.json"),
			),
			true,
		);
		assert.equal(existsSync(join(stateRoot, "unexpected-output.json")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_supervisor_self_maintenance_advisory returns self-maintenance read-only report", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-self-maintenance-mcp-"));
	const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
	mkdirSync(join(stateRoot, "reports"), { recursive: true });
	writeFileSync(
		join(stateRoot, "reports", "idu-usage-events.jsonl"),
		`${JSON.stringify({
			version: 1,
			id: "usage-1",
			timestamp: "2026-06-05T00:00:00.000Z",
			projectId: "sistema_de_mantencion",
			surface: "mcp",
			action: "idu_postflight",
			ok: false,
			allowedToProceed: false,
			requiresHuman: true,
		})}\n`,
		"utf8",
	);
	writeFileSync(
		join(stateRoot, "reports", "agentlab-effectiveness-events.jsonl"),
		`${JSON.stringify({
			version: 1,
			id: "agentlab-1",
			timestamp: "2026-06-05T00:00:00.000Z",
			projectId: "sistema_de_mantencion",
			eventType: "status_checked",
			source: "mcp",
			staleRequests: 3,
		})}\n`,
		"utf8",
	);
	writeFileSync(
		join(stateRoot, "reports", "idu-supervisor-activity-events.jsonl"),
		Array.from({ length: 3 }, (_, index) =>
			JSON.stringify({
				version: 1,
				id: `supervisor-${index}`,
				timestamp: "2026-06-05T00:00:00.000Z",
				projectId: "sistema_de_mantencion",
				eventType: "supervisor_hook",
				origin: "supervisor_auto_hook",
				trigger: "after_postflight",
				status: "skipped",
				reason: "throttled",
				active: true,
			}),
		).join("\n") + "\n",
		"utf8",
	);
	const runtime = fakeRuntime();
	runtime.semanticAuditStatus = () => ({
		projectId: "sistema_de_mantencion",
		stats: {} as never,
		checkpoint: {} as never,
		newEvents: {
			labRuns: 50,
			findings: 50,
			proposals: 25,
			tasks: 25,
			userSignals: 0,
			memoryItems: 0,
			criticalFindings: 0,
			highFindings: 0,
		},
		decision: {} as never,
		recommendedNext: "Run semantic audit.",
	});
	for (let index = 0; index < 10; index += 1) {
		const task = runtime.createTask(
			"bug",
			`postflight context.md repeated failure ${index}`,
		);
		task.id = `maintenance-${index}`;
	}
	const result = await callIduMcpTool(
		"idu_supervisor_self_maintenance_advisory",
		{},
		{
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		},
	);

	assert.equal(result.ok, true);
	const report = result.data.report as {
		authority: string;
		mode: string;
		noWrites: boolean;
		agentLabsExecuted: boolean;
		rulesApplied: boolean;
		skillsModified: boolean;
		totals: {
			pendingTasks: number;
			supervisorEvents: number;
			usageFailures: number;
			agentLabStaleRequests: number;
			semanticNewEvents: number;
		};
		signals: Array<{ category: string }>;
		safeNotes: string[];
	};
	assert.equal(report.authority, "advisory");
	assert.equal(report.mode, "advisory_only");
	assert.equal(report.noWrites, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.totals.pendingTasks, 10);
	assert.equal(report.totals.supervisorEvents, 3);
	assert.equal(report.totals.usageFailures, 3);
	assert.equal(report.totals.agentLabStaleRequests, 3);
	assert.equal(report.totals.semanticNewEvents, 150);
	assert.ok(
		report.signals.some((signal) => signal.category === "backlog_pressure"),
	);
	assert.ok(
		report.signals.some(
			(signal) => signal.category === "repeated_failure_patterns",
		),
	);
	assert.ok(
		report.signals.some(
			(signal) => signal.category === "semantic_audit_pressure",
		),
	);
	assert.ok(
		report.signals.some(
			(signal) => signal.category === "supervisor_activity_pressure",
		),
	);
	assert.equal(result.data.structuredTaskInputStatus, "available");
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.equal(
		(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
		false,
	);
	assert.match(report.safeNotes.join("\n"), /no files, tasks, rules, skills/u);
	assert.match(result.safeNotes.join("\n"), /No creé tareas/u);
	assert.match(result.safeNotes.join("\n"), /no toqué AgentLabs/u);
	assert.equal(existsSync(join(stateRoot, "unexpected-output.json")), false);
	rmSync(root, { recursive: true, force: true });
});

test("idu_external_intelligence_report is allowlisted and advisory-only", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-external-intelligence-mcp-"));
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "sistema_de_mantencion");
		mkdirSync(projectPath, { recursive: true });
		const runtime = fakeRuntime(projectPath);
		runtime.workspaceRoot = stateRoot;
		const result = await callIduMcpTool(
			"idu_external_intelligence_report",
			{ sourceIds: ["npm-advisories"] },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered(projectPath),
					stateRoot,
				}),
			},
		);

		assert.equal(result.ok, true);
		const report = result.data.report as ExternalIntelligenceReport;
		assert.equal(report.mode, "advisory_only");
		assert.equal(report.stateRootOnly, true);
		assert.equal(report.rawContentStored, false);
		assert.equal(report.autoDependencyUpdatesAllowed, false);
		assert.equal(report.agentLabAutoRunAllowed, false);
		assert.equal(report.remoteAnalyticsAllowed, false);
		assert.equal(report.contractPromotionAllowed, false);
		assert.equal(report.sourcesQueried[0]?.status, "skipped");
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).authority,
			"advisory",
		);
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
			false,
		);
		const paths = result.data.paths as {
			currentPath: string;
			historyPath: string;
		};
		assert.ok(paths.currentPath.startsWith(stateRoot));
		assert.ok(paths.historyPath.startsWith(stateRoot));
		assert.equal(existsSync(paths.currentPath), true);
		const serialized = JSON.stringify(result);
		assert.equal(serialized.includes("RAW"), false);
		assert.match(result.safeNotes.join("\n"), /allowlist/u);
		assert.match(result.safeNotes.join("\n"), /No actualicé dependencias/u);
		assert.match(result.safeNotes.join("\n"), /No ejecuté AgentLabs/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_external_intelligence_report refuses workspace fallback without stateRoot", async () => {
	const root = mkdtempSync(
		join(tmpdir(), "idu-external-intelligence-no-state-"),
	);
	try {
		const projectPath = join(root, "project");
		mkdirSync(projectPath, { recursive: true });
		const runtime = fakeRuntime(projectPath);
		const result = await callIduMcpTool(
			"idu_external_intelligence_report",
			{ sourceIds: ["npm-advisories"] },
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					status: "registered_project",
					projectId: "sistema_de_mantencion",
					projectPath,
					safeNotes: [],
					errors: [],
				}),
			},
		);

		assert.equal(result.ok, false);
		assert.equal(result.errors.includes("missing_state_root"), true);
		assert.equal(result.data.stateRootRequired, true);
		assert.equal(result.data.workspaceFallbackAllowed, false);
		assert.equal(existsSync(join(projectPath, "reports")), false);
		assert.match(
			result.safeNotes.join("\n"),
			/no usa workspaceRoot como fallback/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_external_source_recommend is registry-only and advisory", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-external-source-registry-mcp-"));
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "idu-pi");
		mkdirSync(projectPath, { recursive: true });
		const runtime = fakeRuntime(projectPath);
		const result = await callIduMcpTool(
			"idu_external_source_recommend",
			{
				request: "HTML sin JS embebido y estructura Next.js TypeScript",
				domains: ["web", "programming_structure", "separation_of_concerns"],
				language: "html",
				framework: "nextjs",
				maxMatches: 6,
			},
			{
				runtimeFactory: () => runtime,
				projectResolver: () => ({
					...registered(projectPath),
					stateRoot,
				}),
			},
		);

		assert.equal(result.ok, true);
		const report = result.data.report as ExternalSourceRecommendationReport;
		assert.equal(report.fetchAllowed, false);
		assert.equal(report.rawDocsStored, false);
		assert.equal(report.promotionAllowed, false);
		assert.equal(report.agentLabAutoRunAllowed, false);
		assert.ok(Array.isArray(report.matches));
		assert.ok(report.matches.length > 0);
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).authority,
			"advisory",
		);
		assert.equal(
			(result.data.decisionEnvelope as DecisionEnvelope).allowedToProceed,
			true,
		);
		const safeNotes = result.safeNotes.join("\n");
		assert.match(safeNotes, /no hice web\/live fetch/u);
		assert.match(safeNotes, /no guardé raw docs/u);
		assert.match(safeNotes, /No importé Source Library/u);
		assert.match(safeNotes, /No promoví contratos/u);
		assert.match(safeNotes, /No ejecuté AgentLabs/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_queue_complete marks a task done with evidence", async () => {
	const runtime = fakeRuntime();
	const task = runtime.createTask(
		"feature",
		"compactar contexto con evidencia",
	);
	const completed = await callIduMcpTool(
		"idu_queue_complete",
		{
			taskId: task.id.slice(0, 14),
			evidence: "commit abc123; build/test/postflight passed",
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	assert.equal(completed.ok, true);
	assert.equal(completed.data.taskId, task.id);
	assert.equal(completed.data.status, "done");
	assert.equal(
		(completed.data.task as StructuredTask).completionEvidence,
		"commit abc123; build/test/postflight passed",
	);
	assert.match(completed.safeNotes.join("\n"), /no ejecuté IA ni AgentLabs/iu);

	const detail = await callIduMcpTool(
		"idu_queue_detail",
		{},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	assert.equal(
		((detail.data.tasks as StructuredTask[])[0] as StructuredTask).status,
		"done",
	);
	assert.equal(
		((detail.data.tasks as StructuredTask[])[0] as StructuredTask).guardStatus,
		"clear",
	);
	assert.equal(detail.data.guardStatus, "clear");
});

test("idu_queue_detail returns complete ids and guard status", async () => {
	const runtime = fakeRuntime();
	runtime.supervisorOnIduActivation();
	await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	const detail = await callIduMcpTool(
		"idu_queue_detail",
		{},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	assert.equal(detail.ok, true);
	const queueData = detail.data as {
		tasks: Array<{ id: string; guardStatus: string }>;
	};
	assert.equal(queueData.tasks[0].id, "task-20260525-000001");
	assert.equal(queueData.tasks[0].guardStatus, "needs_confirmation");
});

test("MCP tool output always includes required JSON envelope", async () => {
	const result = await callIduMcpTool(
		"idu_advisory",
		{ request: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	for (const key of [
		"ok",
		"tool",
		"projectId",
		"projectPath",
		"summary",
		"data",
		"safeNotes",
		"errors",
	]) {
		assert.ok(key in result, key);
	}
	assert.ok("alignmentAdvisory" in result.data);
	assert.equal("advisoryText" in result.data, false);
});

test("unregistered projectPath returns clear diagnostic", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{ projectPath: "C:/projects/unknown" },
		{
			runtimeFactory: factory(),
			projectResolver: () => ({
				status: "unregistered_project",
				projectId: "unknown",
				projectPath: "C:/projects/unknown",
				safeNotes: [],
				errors: ["Proyecto no registrado: C:/projects/unknown"],
				recommendedNext: "Registrá el proyecto en Idu-pi antes de usar MCP.",
			}),
		},
	);
	assert.equal(result.ok, false);
	assert.equal(result.data.resolutionStatus, "unregistered_project");
	assert.match(result.summary, /no registrado/i);
});

test("mcp server source does not import Telegram entrypoint", () => {
	const source = readFileSync(
		join(process.cwd(), "src", "mcp-server.ts"),
		"utf8",
	);
	assert.doesNotMatch(source, /\.\/index\.js/u);
	assert.doesNotMatch(source, /grammy|new Bot|Bot\(/u);
});

test("JSON-RPC initialize, notifications, and tool calls work", async () => {
	const init = await handleMcpRequest({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {},
	});
	assert.equal(init?.jsonrpc, "2.0");
	assert.equal(init?.id, 1);
	const initResult = init?.result as {
		capabilities: { tools: { listChanged: boolean } };
	};
	assert.equal(initResult.capabilities.tools.listChanged, false);

	const notification = await handleMcpRequest({
		jsonrpc: "2.0",
		method: "notifications/initialized",
		params: {},
	});
	assert.equal(notification, undefined);

	const call = await handleMcpRequest(
		{
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "idu_status", arguments: {} },
		},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(call?.id, 2);
	const callResult = call?.result as {
		content: Array<{ type: string; text: string }>;
	};
	assert.equal(callResult.content[0].type, "text");
	const body = JSON.parse(callResult.content[0].text) as {
		ok: boolean;
		tool: string;
	};
	assert.equal(body.ok, true);
	assert.equal(body.tool, "idu_status");
});

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function setMcpEnv(root: string, projectPath: string): string {
	const workspaceRoot = join(root, "workspace");
	const registryPath = join(root, "registry", "projects.json");
	process.env.DEFAULT_CWD = projectPath;
	process.env.ALLOWED_ROOTS = root;
	process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	delete process.env.TELEGRAM_BOT_TOKEN;
	delete process.env.ALLOWED_USER_ID;
	return registryPath;
}

test("idu_project_status does not write files for unregistered project", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-status-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const registryPath = setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_project_status", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.data.registered, false);
		assert.equal(existsSync(registryPath), false);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_enroll registers project and creates isolated state only", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-enroll-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_project_enroll", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.projectId, "project");
		const statePaths = result.data.statePaths as {
			stateRoot: string;
			reportsDir: string;
			agentLabReportsDir: string;
		};
		assert.equal(existsSync(statePaths.stateRoot), true);
		assert.equal(existsSync(statePaths.reportsDir), true);
		assert.equal(existsSync(statePaths.agentLabReportsDir), true);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
		assert.equal(
			existsSync(join(projectPath, "config", "project-constitution.json")),
			false,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_status reports registered project after enroll", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-status-registered-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, projectPath);
	try {
		await callIduMcpTool("idu_project_enroll", { projectPath });
		const result = await callIduMcpTool("idu_project_status", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.data.registered, true);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_enroll rejects paths outside allowed roots", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-enroll-deny-"));
	const outside = mkdtempSync(join(tmpdir(), "idu-mcp-outside-"));
	const previous = snapshotEnv();
	setMcpEnv(root, root);
	try {
		const result = await callIduMcpTool("idu_project_enroll", {
			projectPath: outside,
		});
		assert.equal(result.ok, false);
		assert.match(result.summary, /ALLOWED_ROOTS/u);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("idu_bootstrap_project creates drafts only when explicitly allowed and activates when requested", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-bootstrap-"));
	const noDraftsPath = join(root, "no-drafts");
	const draftsPath = join(root, "drafts");
	mkdirSync(noDraftsPath, { recursive: true });
	mkdirSync(draftsPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, noDraftsPath);
	try {
		const noDrafts = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: noDraftsPath,
			allowCreateDrafts: false,
			activate: false,
		});
		assert.equal(noDrafts.ok, true);
		assert.equal(
			existsSync(join(noDraftsPath, "config", "project-core.json")),
			false,
		);

		const withDraftsInactive = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: draftsPath,
			allowCreateDrafts: true,
			activate: false,
		});
		assert.equal(withDraftsInactive.ok, true);
		assert.equal(
			existsSync(join(draftsPath, "config", "project-core.json")),
			true,
		);
		assert.equal(
			existsSync(join(draftsPath, "config", "project-constitution.json")),
			true,
		);
		assert.equal(
			getIduSessionStatus(String(withDraftsInactive.projectId)).active,
			false,
		);

		const withDrafts = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: draftsPath,
			allowCreateDrafts: true,
			activate: true,
		});
		assert.equal(withDrafts.ok, true);
		assert.equal(
			getIduSessionStatus(String(withDrafts.projectId)).active,
			true,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_start does not enroll unregistered projects and activates registered projects", async () => {
	const unregistered = await callIduMcpTool(
		"idu_start",
		{ projectPath: "C:/projects/new" },
		{
			projectResolver: () => ({
				status: "unregistered_project",
				projectId: "new",
				projectPath: "C:/projects/new",
				recommendedNext: "Use enroll.",
				safeNotes: [],
				errors: ["not registered"],
			}),
			runtimeFactory: factory(),
		},
	);
	assert.equal(unregistered.ok, false);
	assert.match(
		String(unregistered.data.recommendedNext),
		/idu_project_enroll/u,
	);

	let startupHookCalls = 0;
	const runtime = fakeRuntime();
	runtime.supervisorOnIduActivation = () => {
		startupHookCalls += 1;
		return {
			status: "completed",
			trigger: "on_idu_activation",
			projectId: runtime.projectId,
			bypassedThrottle: false,
			throttleStatePath: "reports/idu-supervisor-hook-state.json",
			summary: "Supervisor startup check completed.",
			safety: {
				agentLabsExecuted: false,
				rulesApplied: false,
				memoryDeleted: false,
				projectCoreModified: false,
			},
		};
	};
	const registeredStart = await callIduMcpTool(
		"idu_start",
		{ projectPath: "C:/projects/sistema" },
		{ projectResolver: () => registered(), runtimeFactory: () => runtime },
	);
	assert.equal(registeredStart.ok, true);
	assert.equal(registeredStart.data.active, true);
	assert.equal(startupHookCalls, 1);
	assert.deepEqual(registeredStart.data.supervisorStartup, {
		status: "completed",
		trigger: "on_idu_activation",
		summary: "Supervisor startup check completed.",
		safety: {
			agentLabsExecuted: false,
			rulesApplied: false,
			memoryDeleted: false,
			projectCoreModified: false,
		},
	});
});

test("idu_activate remains activate-only and does not bootstrap unregistered projects", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-activate-only-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const registryPath = setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_activate", { projectPath });
		assert.equal(result.ok, false);
		assert.equal(existsSync(registryPath), false);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("source library MCP tools remain advisory and stateRoot-only", async () => {
	const status = await callIduMcpTool(
		"idu_source_status",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(status.ok, true);
	assert.match(status.summary, /Source Library/u);
	assert.ok(
		status.safeNotes.some((note) => /No promoví contratos/u.test(note)),
	);

	const add = await callIduMcpTool(
		"idu_source_add",
		{ path: "C:/docs/manual.md" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(add.ok, true);
	assert.ok(!add.data.run);
	assert.ok(add.safeNotes.some((note) => /stateRoot\/Doc/u.test(note)));

	const remove = await callIduMcpTool(
		"idu_source_remove",
		{ sourceId: "source-demo-manual-abc123" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(remove.ok, true);
	assert.ok(remove.safeNotes.some((note) => /No cambié contratos/u.test(note)));

	const read = await callIduMcpTool(
		"idu_source_read",
		{ sourceId: "source-demo-manual-abc123" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(read.ok, true);
	assert.equal(
		(read.data.result as { contextBudgetUsage: ContextBudgetUsage })
			.contextBudgetUsage.profile,
		"source_chunk_read",
	);
	assert.equal(
		(read.data.result as { contextBudgetUsage: ContextBudgetUsage })
			.contextBudgetUsage.advisoryOnly,
		true,
	);
	assert.ok(read.safeNotes.some((note) => /No consulté web/u.test(note)));

	const extract = await callIduMcpTool(
		"idu_source_extract",
		{ sourceId: "source-demo-manual-abc123" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(extract.ok, true);
	assert.ok(
		extract.safeNotes.some((note) =>
			/PDFs convertidos|metadata-only/u.test(note),
		),
	);

	const report = await callIduMcpTool(
		"idu_source_report",
		{ sourceId: "source-demo-manual-abc123" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(report.ok, true);
	assert.ok(report.safeNotes.some((note) => /metadata de fuente/u.test(note)));

	const research = await callIduMcpTool(
		"idu_source_research_report",
		{ query: "robusto" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(research.ok, true);
	assert.equal(
		(research.data.result as { contextBudgetUsage: ContextBudgetUsage })
			.contextBudgetUsage.profile,
		"source_research",
	);
	assert.ok(research.safeNotes.some((note) => /No consulté web/u.test(note)));

	const digest = await callIduMcpTool(
		"idu_source_digest",
		{ sourceId: "source-demo-manual-abc123" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(digest.ok, true);
	assert.ok(digest.safeNotes.some((note) => /chunks/u.test(note)));

	const digestStatus = await callIduMcpTool(
		"idu_source_digest_status",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(digestStatus.ok, true);
	assert.ok(
		digestStatus.safeNotes.some((note) => /No promoví contratos/u.test(note)),
	);

	const chunk = await callIduMcpTool(
		"idu_source_chunk_read",
		{
			sourceId: "source-demo-manual-abc123",
			chunkId: "source-demo-manual-abc123-chunk-001",
		},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(chunk.ok, true);
	assert.equal(
		(chunk.data.result as { contextBudgetUsage: ContextBudgetUsage })
			.contextBudgetUsage.profile,
		"source_chunk_read",
	);
	assert.ok(chunk.safeNotes.some((note) => /No consulté web/u.test(note)));

	const recommend = await callIduMcpTool(
		"idu_source_recommend_for_task",
		{ request: "robusto" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(recommend.ok, true);
	assert.ok(
		recommend.safeNotes.some((note) => /orquestador decide/u.test(note)),
	);

	const oversizedRuntime = fakeRuntime();
	oversizedRuntime.sourceRecommend = (request) => ({
		projectId: "sistema_de_mantencion",
		request: `${request} ${"x".repeat(1000)}`,
		generatedAt: "2026-06-01T00:00:00.000Z",
		matches: [
			{
				sourceId: `source-${"a".repeat(400)}`,
				title: `Huge source ${"b".repeat(400)}`,
				chunkIds: Array.from({ length: 20 }, (_, index) => `chunk-${index}`),
				whyRelevant: `Relevant ${"c".repeat(1000)}`,
				confidence: "high",
				orchestratorInstruction: `Read carefully ${"d".repeat(1000)}`,
				contractPromotionAllowed: false,
				content: "RAW_CHUNK_BODY_MUST_NOT_LEAK",
			} as any,
		],
		missingKnowledge: [`Missing ${"e".repeat(1000)}`],
		limitations: [`Limit ${"f".repeat(1000)}`],
		contractPromotionAllowed: false,
	});
	const oversizedRecommend = await callIduMcpTool(
		"idu_source_recommend_for_task",
		{ request: "robusto" },
		{
			runtimeFactory: () => oversizedRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(oversizedRecommend.ok, true);
	const oversizedResult = oversizedRecommend.data.result as {
		matches: Array<{
			chunkIds: string[];
			orchestratorInstruction: string;
			whyRelevant: string;
		}>;
		contextPressure: {
			rawContentIncluded: boolean;
			tokenCostMeasured: boolean;
			estimatedTokenUse: string;
			pressure: string;
		};
	};
	assert.equal(oversizedResult.matches[0].chunkIds.length, 5);
	assert.ok(oversizedResult.matches[0].orchestratorInstruction.length <= 280);
	assert.ok(oversizedResult.matches[0].whyRelevant.length <= 280);
	assert.equal(oversizedResult.contextPressure.rawContentIncluded, false);
	assert.equal(oversizedResult.contextPressure.tokenCostMeasured, false);
	assert.equal(
		oversizedResult.contextPressure.estimatedTokenUse,
		"not_measured",
	);
	assert.equal(oversizedResult.contextPressure.pressure, "medium");
	assert.doesNotMatch(
		JSON.stringify(oversizedRecommend.data),
		/RAW_CHUNK_BODY_MUST_NOT_LEAK/u,
	);

	const requiredActions = await callIduMcpTool(
		"idu_source_required_actions",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(requiredActions.ok, true);
	assert.equal(
		(requiredActions.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.ok(Array.isArray(requiredActions.data.evidenceGateways));
	assert.equal(
		(requiredActions.data.evidenceGateways as Array<{ source: string }>)[0]
			?.source,
		"source_required_actions",
	);
	assert.ok(
		requiredActions.safeNotes.some((note) =>
			/lector bibliotecario/u.test(note),
		),
	);

	const candidates = await callIduMcpTool(
		"idu_source_skill_candidates_create",
		{ selector: "all" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(candidates.ok, true);
	assert.equal(
		(candidates.data.result as { report: { tokensCostMeasured: boolean } })
			.report.tokensCostMeasured,
		false,
	);
	assert.match(candidates.safeNotes.join("\n"), /No instalé skills/u);
	assert.match(candidates.safeNotes.join("\n"), /tokens\/cost: no medido/u);

	const candidateReview = await callIduMcpTool(
		"idu_source_skill_candidates_review",
		{ pathOrLatest: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(candidateReview.ok, true);
	assert.match(candidateReview.summary, /valid/u);
	assert.match(candidateReview.safeNotes.join("\n"), /reports-only/u);

	const refresh = await callIduMcpTool(
		"idu_source_refresh",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(refresh.ok, true);
	assert.ok(
		refresh.safeNotes.some((note) => /No cambié contratos/u.test(note)),
	);
});

test("postflight request create remains request-only and review-run reports sandbox notes", async () => {
	const request = await callIduMcpTool(
		"idu_agentlab_request_create",
		{ source: "postflight", selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.match(request.summary, /solicitud/i);
	const requestWorkload = request.data.workloadEnvelope as {
		authority?: string;
		status?: string;
		autoRunAllowed?: boolean;
		repoWriteAllowed?: boolean;
		contractPromotionAllowed?: boolean;
	};
	assert.equal(requestWorkload.authority, "advisory");
	assert.equal(requestWorkload.status, "requested");
	assert.equal(requestWorkload.autoRunAllowed, false);
	assert.equal(requestWorkload.repoWriteAllowed, false);
	assert.equal(requestWorkload.contractPromotionAllowed, false);
	assert.equal(
		(request.data.decisionEnvelope as DecisionEnvelope).authority,
		"advisory",
	);
	assert.ok(
		request.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);

	const masterPlan = await callIduMcpTool(
		"idu_agentlab_request_create",
		{ source: "master-plan", selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(masterPlan.ok, true);
	assert.match(masterPlan.summary, /Solicitud AgentLab creada/i);
	assert.ok(!masterPlan.data.run);
	assert.ok(
		masterPlan.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);

	const externalRuntime = fakeRuntime();
	externalRuntime.sourceRecommend = (request) => ({
		projectId: "sistema_de_mantencion",
		request: `${request} ${"x".repeat(1000)}`,
		generatedAt: "2026-06-01T00:00:00.000Z",
		matches: [
			{
				sourceId: "source-doc-1",
				title: `Dependency advisory digest ${"t".repeat(400)}`,
				chunkIds: Array.from({ length: 20 }, (_, index) => `chunk-${index}`),
				whyRelevant: `Local digest mentions dependency governance. ${"r".repeat(1000)}`,
				confidence: "high",
				orchestratorInstruction: `Read chunk-001 if needed. ${"i".repeat(1000)}`,
				contractPromotionAllowed: false,
				content: "RAW_CHUNK_BODY_MUST_NOT_LEAK",
			} as any,
		],
		missingKnowledge: [`Missing ${"m".repeat(1000)}`],
		limitations: ["Local Source Library digest only; no web fetch."],
		contractPromotionAllowed: false,
	});
	externalRuntime.agentLabRequestCreate = (_source, _selector, options) =>
		createAgentLabReviewRequests({
			source: "external_source_intelligence",
			reportsPath: join(
				mkdtempSync(join(tmpdir(), "idu-mcp-source-evidence-")),
				"reports",
			),
			projectId: "sistema_de_mantencion",
			projectPath: "C:/projects/sistema",
			manualObjective: options?.objective,
			manualContext: options?.context,
			externalSourceLibraryEvidence: options?.externalSourceLibraryEvidence,
		});
	const external = await callIduMcpTool(
		"idu_agentlab_request_create",
		{
			source: "external-source-intelligence",
			selector: "latest",
			context: "audit dependency governance",
		},
		{
			runtimeFactory: () => externalRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(external.ok, true);
	const externalPlan = external.data.plan as AgentLabReviewRequestPlan;
	assert.equal(externalPlan.source, "external_source_intelligence");
	assert.match(JSON.stringify(externalPlan), /source-doc-1/u);
	assert.match(JSON.stringify(externalPlan), /chunk-0/u);
	assert.doesNotMatch(
		JSON.stringify(externalPlan),
		/RAW_CHUNK_BODY_MUST_NOT_LEAK/u,
	);
	assert.ok(JSON.stringify(externalPlan).length < 6000);
	assert.ok(!external.data.run);
	assert.ok(
		external.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);
	assert.ok(
		external.safeNotes.some((note) => /Source Library|local|web/u.test(note)),
	);

	const specialistRuntime = fakeRuntime();
	specialistRuntime.agentLabRequestCreate = (_source, _selector, options) =>
		createAgentLabReviewRequests({
			source: "specialist_audit_plan",
			reportsPath: join(
				mkdtempSync(join(tmpdir(), "idu-mcp-specialist-")),
				"reports",
			),
			projectId: "sistema_de_mantencion",
			projectPath: "C:/projects/sistema",
			manualObjective: options?.objective,
			manualContext: options?.context,
			specialties: options?.specialties,
		});
	const specialist = await callIduMcpTool(
		"idu_agentlab_request_create",
		{
			source: "specialist-audit-plan",
			objective: "Audit MCP and AgentLab governance",
			context: "Check advisory-only boundaries.",
			specialties: ["security", "architecture", "code_quality"],
		},
		{
			runtimeFactory: () => specialistRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(specialist.ok, true);
	assert.deepEqual(specialist.data.specialties, [
		"security",
		"architecture",
		"code_quality",
	]);
	const specialistPlan = specialist.data.plan as AgentLabReviewRequestPlan;
	assert.equal(specialistPlan.source, "specialist_audit_plan");
	assert.equal(specialistPlan.explicitRunRequirement?.required, true);
	assert.equal(
		specialistPlan.explicitRunRequirement?.tool,
		"idu_agentlab_review_run",
	);
	assert.equal(specialistPlan.specialtyWorkloadEnvelopes?.length, 3);
	assert.equal(
		specialistPlan.specialtyWorkloadEnvelopes?.[0]?.workloadEnvelope.status,
		"requested",
	);
	assert.ok(!specialist.data.run);
	assert.ok(
		specialist.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);

	const invalidSpecialist = await callIduMcpTool(
		"idu_agentlab_request_create",
		{
			source: "specialist-audit-plan",
			specialties: ["security", "not-a-specialty"],
		},
		{
			runtimeFactory: () => specialistRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(invalidSpecialist.ok, false);
	assert.match(invalidSpecialist.errors.join("\n"), /specialty inválida/u);

	const approvalRuntime = fakeRuntime();
	approvalRuntime.agentLabReviewStatus = (): AgentLabReviewStatus => ({
		path: "run.json",
		name: "run.json",
		valid: true,
		errors: [],
		result: {
			generatedAt: "2026-05-25T00:00:00.000Z",
			sourceRequestFile: "request.json",
			warning: "Revisión AgentLab. No aplica cambios.",
			projectId: "sistema_de_mantencion",
			runs: [
				{
					requestId: "req-1",
					specialty: "architecture",
					status: "completed",
					commandsExecuted: [],
					rawSummary: "Requires approval.",
					contractValidation: { valid: true, errors: [] },
					findings: [],
					recommendations: [
						{
							title: "Review architecture change",
							description: "Human review required.",
							rationale: "Risky architecture change.",
							expectedBenefit: "safety",
							risk: "high",
							requiresHumanApproval: true,
							suggestedNextStep: "Ask human before proceeding.",
						},
					],
					testsSuggested: [],
					requiresHumanApproval: true,
				},
			],
			consolidatedSummary: "Approval needed.",
			consolidatedFindings: [],
			recommendedNext: "Ask human before proceeding.",
			requiresHumanApproval: true,
			safeNotes: [],
		},
	});
	const approvalStatus = await callIduMcpTool(
		"idu_agentlab_review_status",
		{ selector: "latest" },
		{
			runtimeFactory: () => approvalRuntime,
			projectResolver: () => registered(),
		},
	);
	const approvalDecision = approvalStatus.data
		.decisionEnvelope as DecisionEnvelope;
	assert.equal(approvalDecision.requiresHuman, true);
	assert.equal(approvalDecision.allowedToProceed, false);
	assert.ok(
		approvalDecision.requiredActions.some(
			(action) => action.action === "review_agentlab_before_proceeding",
		),
	);

	const staleRuntime = fakeRuntime();
	staleRuntime.agentLabReviewStatus = (): AgentLabReviewStatus => ({
		path: "current.json",
		name: "current.json",
		valid: false,
		errors: [
			"AgentLab run stale: el request actual todavía no tiene una revisión AgentLab válida.",
		],
	});
	const staleStatus = await callIduMcpTool(
		"idu_agentlab_review_status",
		{ selector: "latest" },
		{
			runtimeFactory: () => staleRuntime,
			projectResolver: () => registered(),
		},
	);
	const staleDecision = staleStatus.data.decisionEnvelope as DecisionEnvelope;
	const staleWorkload = staleStatus.data.workloadEnvelope as {
		status?: string;
		authority?: string;
		autoRunAllowed?: boolean;
	};
	assert.equal(staleWorkload.status, "stale");
	assert.equal(staleWorkload.authority, "advisory");
	assert.equal(staleWorkload.autoRunAllowed, false);
	assert.equal(staleStatus.ok, false);
	assert.equal(staleDecision.recommendation, "block");
	assert.equal(staleDecision.allowedToProceed, false);
	assert.match(staleStatus.errors.join("\n"), /run stale/u);

	const invalid = await callIduMcpTool(
		"idu_agentlab_request_create",
		{ source: "implement" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(invalid.ok, false);
	assert.match(invalid.errors.join("\n"), /Invalid argument source/u);

	const run = await callIduMcpTool(
		"idu_agentlab_review_run",
		{ selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(run.ok, true);
	const runWorkload = run.data.workloadEnvelope as {
		authority?: string;
		autoRunAllowed?: boolean;
	};
	assert.equal(runWorkload.authority, "advisory");
	assert.equal(runWorkload.autoRunAllowed, false);
	assert.match(run.summary, /review/i);
	assert.ok(
		run.safeNotes.some((note) => /sandbox|review-only|clone/iu.test(note)),
	);
});
