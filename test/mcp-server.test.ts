import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
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
import type { CliRuntime } from "../src/cli.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { DecisionEnvelope } from "../src/decision-envelope.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { IduSupervisorLoopResult } from "../src/idu-supervisor-loop.js";
import type { IduSupervisorCronPlanResult } from "../src/idu-supervisor-cron.js";
import type { SemanticAuditStatusReport } from "../src/semantic-audit-command.js";
import type { AgentLabReviewRequestPlan } from "../src/agentlab-review-requests.js";
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

const UNUSED = "unused";

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
		queueApprove: () => undefined,
		queueReject: () => undefined,
	} satisfies CliRuntime & { listTasks: () => StructuredTask[] };
	return runtime;
}

function registered(
	projectPath = "C:/projects/sistema",
): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "sistema_de_mantencion",
		projectPath,
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
	assert.ok(tools.some((tool) => tool.name === "idu_task_package_create"));
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
	assert.ok(tools.some((tool) => tool.name === "idu_source_refresh"));
	assert.ok(tools.some((tool) => tool.name === "idu_supervisor_cron_plan"));
	assert.equal(tools.length, 43);
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

test("idu_activate and idu_deactivate change session state", async () => {
	configureIduSessionStore({
		workspaceRoot: "C:/idu/workspace",
		filePath: join(process.cwd(), "dist", "test-session-state.json"),
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
		(taskPackage.data.decisionEnvelope as DecisionEnvelope).requiredActions.some(
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
	assert.equal(
		(result.data.evidenceGateways as Array<{ source: string }>)[0]?.source,
		"postflight",
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

	const registeredStart = await callIduMcpTool(
		"idu_start",
		{ projectPath: "C:/projects/sistema" },
		{ projectResolver: () => registered(), runtimeFactory: factory() },
	);
	assert.equal(registeredStart.ok, true);
	assert.equal(registeredStart.data.active, true);
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

	const external = await callIduMcpTool(
		"idu_agentlab_request_create",
		{ source: "external-source-intelligence", selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(external.ok, true);
	const externalPlan = external.data.plan as AgentLabReviewRequestPlan;
	assert.equal(externalPlan.source, "external_source_intelligence");
	assert.ok(!external.data.run);
	assert.ok(
		external.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);

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
		{ runtimeFactory: () => approvalRuntime, projectResolver: () => registered() },
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
	assert.match(run.summary, /review/i);
	assert.ok(
		run.safeNotes.some((note) => /sandbox|review-only|clone/iu.test(note)),
	);
});
