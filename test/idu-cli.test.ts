import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	activateIduSession,
	configureIduSessionStore,
	getIduSessionStatus,
} from "../src/idu-session.js";
import {
	approveStructuredTaskById,
	completeStructuredTaskById,
	createCliTask,
	formatCliTaskResult,
	rejectStructuredTaskById,
	runCliCommand,
	normalizeCliArgs,
	type CliRuntime,
} from "../src/cli.js";
import {
	flushIduUsageEvents,
	readIduUsageEvents,
} from "../src/usage-events.js";
import {
	flushSupervisorActivityEvents,
	readSupervisorActivityEvents,
	recordSupervisorActivityEventDeferred,
	supervisorActivityInputFromLoopResult,
} from "../src/supervisor-activity-events.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type {
	SemanticAuditRunResult,
	SemanticAuditStatusReport,
} from "../src/semantic-audit-command.js";
import type {
	SaveSemanticCompactionDraftResult,
	SemanticCompactionReview,
} from "../src/semantic-compaction.js";
import type {
	SemanticAgentTaskCreationResult,
	SemanticAgentTaskPlan,
} from "../src/semantic-agent-tasks.js";
import type { IduSupervisorLoopResult } from "../src/idu-supervisor-loop.js";
import type { IduSupervisorCronPlanResult } from "../src/idu-supervisor-cron.js";
import type {
	SupervisorImprovementCreationResult,
	SupervisorImprovementPlan,
} from "../src/supervisor-improvement-proposals.js";
import type {
	SupervisorImprovementDecisionResult,
	SupervisorImprovementStatusResult,
} from "../src/supervisor-improvement-decisions.js";
import type { SkillImprovementDecisionResult } from "../src/skill-improvement-decisions.js";
import type {
	AgentLabReviewRequestPlan,
	AgentLabReviewRequestReview,
} from "../src/agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewStatus,
} from "../src/agentlab-review-runner.js";
import type {
	AgentLabConsolidationResult,
	AgentLabConsolidationStatus,
} from "../src/agentlab-report-consolidation.js";
import type {
	SkillDraftCreationResult,
	SkillDraftReview,
} from "../src/skill-drafts.js";
import type {
	SourceSkillCandidateCreationResult,
	SourceSkillCandidateReview,
} from "../src/source-skill-candidates.js";
import type {
	SkillImprovementCreationResult,
	SkillImprovementPlan,
	SkillImprovementStatusResult,
} from "../src/skill-improvement-proposals.js";
import type {
	SupervisorLearningRuleDecisionResult,
	SupervisorLearningRulesApplyResult,
	SupervisorLearningRulesRollbackResult,
	SupervisorLearningRulesStatus,
	SupervisorLearningRulesTestResult,
} from "../src/supervisor-learning-rules.js";
import {
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	type StructuredTask,
} from "../src/structured-task-queue.js";
import type { TaskTemplateKind } from "../src/task-templates.js";

async function withRuntime(
	fn: (
		runtime: CliRuntime,
		paths: { projectPath: string; workspaceRoot: string },
	) => void | Promise<void>,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-"));
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	try {
		const runtime = fakeRuntime(projectPath, workspaceRoot);
		await fn(runtime, { projectPath, workspaceRoot });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function fakeConnection(projectPath: string): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["sin scan reciente"],
		projectId: "pi-telegram-bridge",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "idu-pi prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-22T00:00:00.000Z",
	};
}

function fakePreflight(request: string): ProjectPreflightReport {
	return {
		risk: /login/u.test(request) ? "high" : "low",
		okToProceed: !/login/u.test(request),
		request,
		projectId: "pi-telegram-bridge",
		projectPath: "/project",
		connectionStatus: "ready",
		affectedAreas: /login/u.test(request)
			? ["auth/seguridad"]
			: ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: /login/u.test(request)
			? "Pedir confirmación humana."
			: "Puede continuar.",
		requiresHumanConfirmation: /login/u.test(request),
		shouldRunAgentLab: false,
	};
}

function fakePostflight(): ProjectPostflightReport {
	return {
		risk: "low",
		changedFiles: [],
		impactedAreas: [],
		warnings: [],
		recommendedNext: "Sin cambios locales detectados.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	};
}

function fakeSemanticAuditStatus(): SemanticAuditStatusReport {
	return {
		projectId: "pi-telegram-bridge",
		stats: {
			projectId: "pi-telegram-bridge",
			labRunCount: 1,
			findingCount: 0,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 0,
			highFindingCount: 0,
		},
		checkpoint: {
			projectId: "pi-telegram-bridge",
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
			labRuns: 1,
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
			newEventCount: 1,
		},
		recommendedNext:
			"Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

function fakeSemanticAuditRun(): SemanticAuditRunResult {
	return {
		projectId: "pi-telegram-bridge",
		runId: "audit-1",
		status: "completed",
		summary: "Auditoría manual registrada sin compactación.",
		checkpointUpdated: true,
		stats: fakeSemanticAuditStatus().stats,
		decision: fakeSemanticAuditStatus().decision,
		recommendedNext:
			"Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

function fakeSemanticCompactionDraft(
	workspaceRoot: string,
): SaveSemanticCompactionDraftResult {
	return {
		path: join(
			workspaceRoot,
			"reports",
			"semantic-compaction-draft-20260102-030405.json",
		),
		prompt: "safe compaction prompt",
		draft: {
			generatedAt: "2026-01-02T03:04:05.000Z",
			projectId: "pi-telegram-bridge",
			warning: "Borrador IA. No es fuente de verdad.",
			sourceAuditRunIds: ["audit-1"],
			inputSummary: { criticalFindings: 1 },
			preservedRules: ["No borrar datos"],
			criticalBugs: [{ title: "Critical auth bug" }],
			humanDecisions: [],
			reusableLessons: [],
			architecturalRisks: [],
			classifierQualityReview: {
				emotionCorrect: "needs_review",
				categoryCorrect: "needs_review",
				priorityCorrect: "needs_review",
				intentCorrect: "needs_review",
				guardrailCorrect: "needs_review",
				falsePositives: [],
				falseNegatives: [],
				errorPatterns: ["login typo"],
				recommendedRules: ["Si falla + db → bug/database/high"],
			},
			misclassifiedExamples: [],
			suggestedRuleUpdates: ["Si falla + db → bug/database/high"],
			suggestedSkillUpdates: [],
			suggestedMemoryItems: [],
			suggestedAgentTasks: ["Revisar seguridad auth/login"],
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function fakeSemanticCompactionReview(
	workspaceRoot: string,
): SemanticCompactionReview {
	const draft = fakeSemanticCompactionDraft(workspaceRoot).draft;
	return {
		path: join(
			workspaceRoot,
			"reports",
			"semantic-compaction-draft-20260102-030405.json",
		),
		validDraft: true,
		errors: [],
		draft,
		hasRawOutput: false,
		summary: {
			preservedRules: draft.preservedRules,
			criticalBugs: ["Critical auth bug"],
			classifierErrors: ["login typo"],
			suggestedRuleUpdates: draft.suggestedRuleUpdates,
			suggestedSkillUpdates: [],
			suggestedAgentTasks: draft.suggestedAgentTasks,
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function fakeSemanticAgentTaskPlan(): SemanticAgentTaskPlan {
	return {
		draftPath: "semantic-compaction-draft-20260102-030405.json",
		draftName: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		validDraft: true,
		errors: [],
		candidates: [
			{
				type: "security",
				category: "review",
				title: "Revisar seguridad auth/login",
				priority: 5,
				reason: "findings críticos sobre auth/login",
				recommendation: "revisar seguridad de autenticación",
				evidence: "Critical auth bug",
				requiresHumanApproval: true,
				dedupeKey: "security:auth-login",
				queuePriority: 1,
				text: "Revisión SG5 semantic-audit — security: Revisar seguridad auth/login\nPrioridad semántica: 5\nPrioridad cola: 1\nNo ejecutar cambios sin aprobación humana.\nDedupe: security:auth-login",
			},
		],
	};
}

function fakeSemanticAgentTaskCreation(): SemanticAgentTaskCreationResult {
	return {
		plan: fakeSemanticAgentTaskPlan(),
		created: [
			{
				id: "task-sg5-1",
				text: "Revisión SG5 semantic-audit — security: Revisar seguridad auth/login",
				category: "review",
				priority: 5,
				status: "pending",
				createdAt: "2026-05-23T00:00:00.000Z",
				updatedAt: "2026-05-23T00:00:00.000Z",
				emotion: "neutral",
				source: "semantic-audit",
				projectId: "pi-telegram-bridge",
			},
		],
		skippedDuplicates: [],
	};
}

function fakeSupervisorImprovementPlan(): SupervisorImprovementPlan {
	return {
		draftPath: "semantic-compaction-draft-20260102-030405.json",
		sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
		draftName: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		validDraft: true,
		errors: [],
		proposals: [
			{
				id: "pending",
				type: "intent_rule_update",
				title: "Clasificar fallas de base de datos como bug/database/high",
				description: "Propuesta review-only de regla de intención.",
				evidence: ["Si falla + db → bug/database/high"],
				sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
				riskLevel: "medium",
				expectedBenefit: ["quality", "safety"],
				suggestedAction: "approve_for_manual_apply",
				requiresHumanApproval: true,
				status: "proposed",
				createdAt: "2026-05-24T00:00:00.000Z",
			},
		],
	};
}

function fakeSupervisorImprovementCreation(): SupervisorImprovementCreationResult {
	return {
		plan: fakeSupervisorImprovementPlan(),
		path: "reports/supervisor-improvement-proposals-20260524-000000.json",
		created: fakeSupervisorImprovementPlan().proposals,
	};
}

function fakeSupervisorImprovementStatus(): SupervisorImprovementStatusResult {
	return {
		file: {
			path: "reports/supervisor-improvement-proposals-20260524-000000.json",
			name: "supervisor-improvement-proposals-20260524-000000.json",
			warning: "Propuestas revisables. No aplicar sin aprobación humana.",
			projectId: "pi-telegram-bridge",
			proposals: fakeSupervisorImprovementPlan().proposals,
		},
		counts: { proposed: 1, approved: 0, rejected: 0, deferred: 0 },
		recommendedNext: "Aprobar, rechazar o diferir propuestas pendientes.",
	};
}

function fakeSupervisorImprovementDecision(
	action: "approved" | "rejected" | "deferred",
): SupervisorImprovementDecisionResult {
	const proposal = {
		...fakeSupervisorImprovementPlan().proposals[0]!,
		status: action,
		decision: {
			decision: action,
			decidedAt: "2026-05-24T00:00:00.000Z",
			source: "cli" as const,
		},
	};
	return {
		action,
		file: { ...fakeSupervisorImprovementStatus().file, proposals: [proposal] },
		updated: [proposal],
		skipped: [],
		backupPath:
			"reports/supervisor-improvement-proposals.backup-20260524-000000.json",
	};
}

function fakeSupervisorResult(): IduSupervisorLoopResult {
	return {
		status: "completed",
		trigger: "manual",
		projectId: "pi-telegram-bridge",
		steps: [
			{ name: "session_check", status: "active", summary: "Idu-pi activo." },
			{
				name: "semantic_audit_status",
				status: "completed",
				summary: "shouldRun=false trigger=not_enough_data",
			},
			{
				name: "semantic_audit_run",
				status: "skipped",
				summary: "No se alcanzó umbral.",
			},
			{
				name: "semantic_compaction_draft",
				status: "skipped",
				summary: "No corresponde crear draft.",
			},
			{
				name: "semantic_agent_tasks",
				status: "skipped",
				summary: "allowAgentTaskPlan=false.",
			},
		],
		createdTasks: 0,
		summary: "No se alcanzó umbral. No se ejecutaron tareas.",
		recommendedNext: ["Esperar umbral o ejecutar revisión manual."],
		safety: {
			agentLabsExecuted: false,
			rulesApplied: false,
			memoryDeleted: false,
			projectCoreModified: false,
		},
	};
}

function fakeTask(): StructuredTask {
	return {
		id: "task-1",
		text: "Bug task. Symptom/context: urgente otra vez falló login",
		category: "bug",
		priority: 5,
		status: "pending",
		createdAt: "2026-05-23T00:00:00.000Z",
		updatedAt: "2026-05-23T00:00:00.000Z",
		emotion: "urgente",
		source: "cli",
		projectId: "pi-telegram-bridge",
	};
}

function fakeSupervisorLearningRulesApply(
	workspaceRoot: string,
): SupervisorLearningRulesApplyResult {
	return {
		path: join(workspaceRoot, "reports", "supervisor-learning-rules.json"),
		created: [],
		omitted: [],
		notApplicable: [],
		file: {
			version: 1,
			updatedAt: "2026-05-23T00:00:00.000Z",
			sourceProposalFiles: [],
			rules: [],
		},
	};
}

function fakeSupervisorLearningRulesStatus(
	workspaceRoot: string,
): SupervisorLearningRulesStatus {
	return {
		path: join(workspaceRoot, "reports", "supervisor-learning-rules.json"),
		exists: true,
		ruleCount: 0,
		enabledCount: 0,
		disabledCount: 0,
		types: [],
		rules: [],
		warnings: [],
	};
}

function fakeSupervisorLearningRulesTest(
	workspaceRoot: string,
): SupervisorLearningRulesTestResult {
	return {
		path: join(workspaceRoot, "reports", "supervisor-learning-rules.json"),
		exists: true,
		cases: [],
		warnings: [],
	};
}

function fakeSupervisorLearningRuleDecision(
	workspaceRoot: string,
	action: "enabled" | "disabled",
): SupervisorLearningRuleDecisionResult {
	return {
		path: join(workspaceRoot, "reports", "supervisor-learning-rules.json"),
		backupPath: join(
			workspaceRoot,
			"reports",
			"supervisor-learning-rules.backup-20260523-000000.json",
		),
		action,
		rule: {
			id: "learn-improvement-001",
			type: "intent_rule",
			sourceProposalId: "improvement-001",
			sourceProposalFile:
				"supervisor-improvement-proposals-20260523-000000.json",
			enabled: action === "enabled",
			description: "fake rule",
			match: { phrases: ["login"], concepts: [] },
			outcome: { concepts: [], riskHints: [] },
			createdAt: "2026-05-23T00:00:00.000Z",
			approvedBy: "human",
		},
		file: {
			version: 1,
			updatedAt: "2026-05-23T00:00:00.000Z",
			sourceProposalFiles: [],
			rules: [],
		},
	};
}

function fakeSupervisorLearningRulesRollback(
	workspaceRoot: string,
): SupervisorLearningRulesRollbackResult {
	return {
		path: join(workspaceRoot, "reports", "supervisor-learning-rules.json"),
		backupPath: join(
			workspaceRoot,
			"reports",
			"supervisor-learning-rules.backup-20260523-000001.json",
		),
		restoredFrom: join(
			workspaceRoot,
			"reports",
			"supervisor-learning-rules.backup-20260523-000000.json",
		),
		file: {
			version: 1,
			updatedAt: "2026-05-23T00:00:00.000Z",
			sourceProposalFiles: [],
			rules: [],
		},
	};
}

function fakeSkillImprovementPlan(): SkillImprovementPlan {
	return {
		draftPath: "semantic-compaction-draft-20260102-030405.json",
		sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
		draftName: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		validDraft: true,
		errors: [],
		skillRegistry: [
			{
				name: "project-understanding",
				path: ".agents/skills/project-understanding/SKILL.md",
				source: "index",
			},
		],
		proposals: [
			{
				id: "skill-improvement-001",
				type: "improve_skill",
				skillName: "project-understanding",
				title: "Mejorar skill project-understanding",
				description: "Propuesta review-only de skill.",
				evidence: ["Project Core/Constitution"],
				sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
				riskLevel: "medium",
				expectedBenefit: ["quality", "architecture_consistency"],
				suggestedAction: "approve_for_manual_apply",
				requiresHumanApproval: true,
				status: "proposed",
				createdAt: "2026-05-25T00:00:00.000Z",
			},
		],
	};
}

function fakeSkillImprovementCreation(): SkillImprovementCreationResult {
	return {
		plan: fakeSkillImprovementPlan(),
		path: "reports/skill-improvement-proposals-20260525-000000.json",
		created: fakeSkillImprovementPlan().proposals,
	};
}

function fakeSkillImprovementDecision(
	action: "approved" | "rejected" | "deferred",
): SkillImprovementDecisionResult {
	return {
		action,
		file: {
			path: "reports/skill-improvement-proposals-20260525-000000.json",
			name: "skill-improvement-proposals-20260525-000000.json",
			warning:
				"Propuestas revisables. No modificar skills sin aprobación humana.",
			projectId: "pi-telegram-bridge",
			proposals: [
				{
					...fakeSkillImprovementPlan().proposals[0]!,
					status: action,
					decisionLog: [
						{
							decision: action,
							decidedAt: "2026-05-25T00:00:00.000Z",
							source: "cli",
						},
					],
				},
			],
		},
		updated: [
			{
				...fakeSkillImprovementPlan().proposals[0]!,
				status: action,
			},
		],
		skipped: [],
		backupPath:
			"reports/skill-improvement-proposals.backup-20260525-000000.json",
	};
}

function fakeAgentLabRequestPlan(): AgentLabReviewRequestPlan {
	return {
		generatedAt: "2026-05-25T00:00:00.000Z",
		projectId: "pi-telegram-bridge",
		source: "postflight",
		warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
		path: "reports/agentlab-review-request-20260525-000000.json",
		errors: [],
		requests: [
			{
				id: "agentlab-pi-postflight-security-01",
				projectId: "pi-telegram-bridge",
				projectPath: "C:/repo",
				requestedBy: "supervisor",
				specialty: "security",
				trigger: "postflight",
				objective: "Revisar postflight high para security",
				contextSummary: "Cambio auth/login",
				evidence: ["src/auth.ts"],
				filesToInspect: ["src/auth.ts"],
				flowsToCheck: [],
				rulesToCheck: [],
				constraints: ["No modificar repo real"],
				allowedActions: ["inspeccionar"],
				forbiddenActions: ["no commit", "no push", "no modificar repo real"],
				maxCommands: 5,
				maxMinutes: 15,
				tokenBudgetHint: "bounded-postflight",
				expectedOutputs: ["hallazgos con evidencia"],
				requiresHumanApproval: true,
				createdAt: "2026-05-25T00:00:00.000Z",
			},
		],
	};
}

function fakeAgentLabRequestReview(): AgentLabReviewRequestReview {
	return {
		path: "reports/agentlab-review-request-20260525-000000.json",
		name: "agentlab-review-request-20260525-000000.json",
		valid: true,
		errors: [],
		plan: fakeAgentLabRequestPlan(),
	};
}

function fakeAgentLabReviewRun(): AgentLabReviewRunResult {
	return {
		generatedAt: "2026-05-25T00:00:00.000Z",
		sourceRequestFile: "reports/agentlab-review-request-20260525-000000.json",
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "pi-telegram-bridge",
		path: "reports/agentlab-review-run-20260525-000000.json",
		runs: [
			{
				requestId: "agentlab-pi-postflight-security-01",
				specialty: "security",
				status: "skipped",
				agentId: "general",
				workspace: "C:/clone",
				commandsExecuted: [],
				rawSummary: "Saltado: sin workspace clone.",
				contractValidation: { valid: false, errors: [] },
				findings: [],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: true,
			},
		],
		consolidatedSummary: "1 requests: 0 completed, 1 skipped, 0 failed.",
		consolidatedFindings: [],
		recommendedNext:
			"Revisar reporte y decidir siguiente paso; no apliqué cambios.",
		requiresHumanApproval: true,
		safeNotes: ["No modifiqué repo real."],
	};
}

function fakeAgentLabReviewStatus(): AgentLabReviewStatus {
	return {
		path: "reports/agentlab-review-run-20260525-000000.json",
		name: "agentlab-review-run-20260525-000000.json",
		valid: true,
		errors: [],
		result: fakeAgentLabReviewRun(),
	};
}

function fakeAgentLabConsolidation(): AgentLabConsolidationResult {
	return {
		valid: true,
		errors: [],
		path: "reports/agentlab-consolidation-20260525-000000.json",
		generatedAt: "2026-05-25T00:00:00.000Z",
		sourceReviewRun: "reports/agentlab-review-run-20260525-000000.json",
		projectId: "pi-telegram-bridge",
		warning: "Consolidación AgentLab. No aplica cambios.",
		summary: "runs: 1; findings: 1",
		consolidatedFindings: [],
		consolidatedRecommendations: [],
		testsSuggested: [],
		supervisorImprovementCandidates: [],
		skillImprovementCandidates: [],
		semanticMemoryCandidates: [],
		agentTaskCandidates: [],
		risks: [],
		requiresHumanApproval: false,
		recommendedNext: ["revisar consolidación"],
	};
}

function fakeAgentLabConsolidationStatus(): AgentLabConsolidationStatus {
	return {
		path: "reports/agentlab-consolidation-20260525-000000.json",
		name: "agentlab-consolidation-20260525-000000.json",
		valid: true,
		errors: [],
		result: fakeAgentLabConsolidation(),
	};
}

function fakeSkillDraftCreation(): SkillDraftCreationResult {
	const draft = {
		proposalId: "skill-improvement-001",
		action: "create_skill" as const,
		skillName: "security-auth-review",
		targetPath: ".agents/skills/security-auth-review/SKILL.md",
		title: "Crear skill security-auth-review",
		purpose: "Draft for security-auth-review",
		whenToUse: "Use for auth/login reviews.",
		safetyRules: ["Do not modify skills automatically."],
		inputsExpected: ["approved proposal"],
		outputsExpected: ["reviewable draft"],
		testsSuggested: ["run skill-check before apply"],
		contentPreview: "---\nname: security-auth-review\n---",
		requiresHumanApproval: true as const,
	};
	return {
		path: "reports/skill-draft-20260525-000000.json",
		plan: {
			generatedAt: "2026-05-25T00:00:00.000Z",
			sourceProposalFile: "skill-improvement-proposals-20260525-000000.json",
			warning: "Borrador de skill. No es fuente de verdad.",
			skillDrafts: [draft],
			omittedProposals: [],
		},
		created: [draft],
		omittedProposals: [],
		notApplicable: [],
	};
}

function fakeSkillDraftReview(): SkillDraftReview {
	return {
		path: "reports/skill-draft-20260525-000000.json",
		name: "skill-draft-20260525-000000.json",
		valid: true,
		errors: [],
		plan: fakeSkillDraftCreation().plan,
	};
}

function fakeSourceSkillCandidateCreation(
	selector = "all",
): SourceSkillCandidateCreationResult {
	return {
		ok: true,
		path: "reports/source-skill-candidates-20260603-120000.json",
		report: {
			version: 1,
			projectId: "idu-pi",
			createdAt: "2026-06-03T12:00:00.000Z",
			source: "source_library",
			warning: `selector ${selector}; Reports-only`,
			contractPromotionAllowed: false,
			requiresHumanApproval: true,
			tokensCostMeasured: false,
			efficiencyEvidence: "no medido",
			candidates: [],
			limitations: [],
			requiredActions: [],
		},
	};
}

function fakeSourceSkillCandidateReview(): SourceSkillCandidateReview {
	return {
		ok: true,
		path: "reports/source-skill-candidates-20260603-120000.json",
		errors: [],
		report: fakeSourceSkillCandidateCreation().report,
	};
}

function fakeSkillImprovementStatus(): SkillImprovementStatusResult {
	return {
		path: "reports/skill-improvement-proposals-20260525-000000.json",
		name: "skill-improvement-proposals-20260525-000000.json",
		valid: true,
		errors: [],
		createdAt: "2026-05-25T00:00:00.000Z",
		sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		countsByStatus: { proposed: 1, approved: 0, rejected: 0, deferred: 0 },
		countsByType: {
			create_skill: 0,
			improve_skill: 1,
			archive_skill: 0,
			move_skill: 0,
			validate_skill: 0,
		},
		proposals: fakeSkillImprovementPlan().proposals,
	};
}

function fakePrepare(projectPath: string): IduPrepareResult {
	return {
		projectId: "pi-telegram-bridge",
		projectPath,
		initialStatus: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "aligned",
		readiness: "aligned_ready",
		differencesDetected: { screens: 0, uiElements: 0, dataStores: 0, flows: 0 },
		steps: [
			{
				id: "inspect_connection",
				status: "completed",
				summary: "ready",
			},
		],
		errors: [],
		finalRisk: "low",
		recommendedNext: "Listo para operar.",
		suggestedActions: ["idu-pi status"],
	};
}

function fakeRuntime(projectPath: string, workspaceRoot: string): CliRuntime {
	const tasks: StructuredTask[] = [];
	const runtime: CliRuntime = {
		projectId: "pi-telegram-bridge",
		projectPath,
		workspaceRoot,
		inspectConnection: () => fakeConnection(projectPath),
		formatConnection: (report) =>
			["Estado CLI", report.projectId, report.status].join("\n"),
		formatDashboard: (report) =>
			[
				"Idu-pi activo",
				"",
				"Proyecto:",
				report.projectId ?? "—",
				"",
				"Acción principal:",
				"idu-pi prepare",
			].join("\n"),
		preflight: fakePreflight,
		formatPreflight: (report) =>
			[
				"Preflight Idu-pi",
				"",
				"Riesgo:",
				report.risk,
				"",
				"Solicitud:",
				report.request,
			].join("\n"),
		advisory: (request): ProjectAdvisory => ({
			level: /login/u.test(request) ? "risk" : "info",
			title: /login/u.test(request)
				? "Idu-pi Advisory — Riesgo alto"
				: "Idu-pi Advisory — Info",
			request,
			affectedAreas: /login/u.test(request) ? ["auth/seguridad"] : [],
			missingContext: [],
			warnings: [],
			availableContext: [],
			recommendation: "Pedir confirmación humana.",
			actions: ["idu-pi preflight"],
			requiresHumanConfirmation: /login/u.test(request),
			okToProceed: !/login/u.test(request),
		}),
		formatAdvisory: (advisory) =>
			[advisory.title, "", "Solicitud:", advisory.request].join("\n"),
		postflight: fakePostflight,
		formatPostflight: (report) =>
			["Postflight Idu-pi", "", "Riesgo:", report.risk].join("\n"),
		prepare: () => fakePrepare(projectPath),
		formatPrepare: (result) =>
			["Idu-pi Prepare", "", "Proyecto:", result.projectId].join("\n"),
		projectStateReset: (confirmed) => {
			if (!confirmed)
				throw new Error(
					"Reset requiere confirmación explícita: agregá --yes al comando.",
				);
			return {
				projectId: "pi-telegram-bridge",
				projectPath,
				stateRoot: workspaceRoot,
				deletedEntries: ["reports"],
				recreatedRoot: true,
				warning:
					"Reset destructivo de estado aislado: no desregistra el proyecto ni toca el repo real.",
			};
		},
		formatProjectStateResetResult: (result) =>
			["Idu-pi project state reset", "", result.stateRoot].join("\n"),
		masterPlanStatus: () =>
			({
				status: "draft",
				currentPlanJson: join(workspaceRoot, "reports", "master-plan.json"),
			}) as any,
		masterPlanReview: () =>
			({
				markdown: "# Plan Maestro Idu-pi\n",
				plan: { status: "draft" },
			}) as any,
		masterPlanApprove: () =>
			({
				plan: { status: "approved" },
				current: { status: "approved" },
			}) as any,
		masterPlanReject: () =>
			({
				plan: { status: "rejected" },
				current: { status: "rejected" },
			}) as any,
		masterPlanRedraft: () =>
			({
				plan: { status: "draft" },
				current: { status: "draft" },
			}) as any,
		formatMasterPlanStatus: (status: { status?: string }) =>
			["Master Plan Status", String(status.status)].join("\n"),
		formatMasterPlanReview: (review: { markdown?: string }) =>
			String(review.markdown),
		sourceLibraryStatus: () => ({
			projectId: "pi-telegram-bridge",
			paths: {
				root: join(workspaceRoot, "Doc", "pi-telegram-bridge"),
				indexPath: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"source-index.json",
				),
				libraryIndexPath: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"source-library-index.json",
				),
				localSourcesDir: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"sources",
					"local",
				),
				extractedDir: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"sources",
					"extracted",
				),
				convertedDir: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"sources",
					"converted",
				),
				chunksDir: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"sources",
					"chunks",
				),
				digestsDir: join(
					workspaceRoot,
					"Doc",
					"pi-telegram-bridge",
					"sources",
					"digests",
				),
			},
			state: "missing",
			sources: [],
			missingSources: [],
			staleSources: [],
			unindexedLocalFiles: [],
			errors: [],
			advisory: "stateRoot only; no contract promotion",
		}),
		sourceLibraryAdd: () => ({
			...runtime.sourceLibraryStatus(),
			state: "ready",
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
		sourceLibraryRemove: () => ({
			...runtime.sourceLibraryStatus(),
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
			projectId: "pi-telegram-bridge",
			paths: runtime.sourceLibraryStatus().paths,
			source: runtime.sourceLibraryAdd("C:/docs/manual.md").addedSource!,
			readStatus: "ready",
			content: "manual robusto",
			maxChars: 20_000,
			truncated: false,
			citationPath: "sources/extracted/source-demo-manual-abc123.txt",
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceLibraryExtract: () => ({
			...runtime.sourceLibraryRead("source-demo-manual-abc123"),
			extractionStatus: "extracted",
			extractedTextPath: "sources/extracted/source-demo-manual-abc123.txt",
		}),
		sourceLibraryReport: () => ({
			projectId: "pi-telegram-bridge",
			paths: runtime.sourceLibraryStatus().paths,
			source: runtime.sourceLibraryAdd("C:/docs/manual.md").addedSource!,
			extractedAvailable: true,
			extractionStatus: "extracted",
			citationPath: "sources/extracted/source-demo-manual-abc123.txt",
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceLibraryResearch: () => ({
			projectId: "pi-telegram-bridge",
			query: "robusto",
			generatedAt: "2026-06-01T00:00:00.000Z",
			searchedSourceIds: ["source-demo-manual-abc123"],
			signals: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceDigest: () => ({
			version: 1,
			projectId: "pi-telegram-bridge",
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
			projectId: "pi-telegram-bridge",
			paths: runtime.sourceLibraryStatus().paths,
			digests: [],
			libraryIndexExists: true,
			contractPromotionAllowed: false,
		}),
		sourceChunkRead: () => ({
			projectId: "pi-telegram-bridge",
			sourceId: "source-demo-manual-abc123",
			chunkId: "source-demo-manual-abc123-chunk-001",
			path: "sources/chunks/source-demo-manual-abc123/source-demo-manual-abc123-chunk-001.md",
			content: "manual robusto",
			maxChars: 12_000,
			truncated: false,
			contractPromotionAllowed: false,
		}),
		sourceRecommend: () => ({
			projectId: "pi-telegram-bridge",
			request: "robusto",
			generatedAt: "2026-06-01T00:00:00.000Z",
			matches: [],
			missingKnowledge: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceRequiredActions: () => ({
			projectId: "pi-telegram-bridge",
			generatedAt: "2026-06-01T00:00:00.000Z",
			actions: [],
			limitations: [],
			contractPromotionAllowed: false,
		}),
		sourceSkillCandidatesCreate: fakeSourceSkillCandidateCreation,
		sourceSkillCandidatesReview: () => fakeSourceSkillCandidateReview(),
		sourceLibraryRefresh: () => runtime.sourceLibraryStatus(),
		formatSourceLibraryStatus: (status) =>
			["Idu-pi Source Library", "", "Estado:", status.state].join("\n"),
		formatSourceLibraryAddResult: (result) =>
			["Idu-pi Source Library Add", "", result.addedSource?.id ?? "none"].join(
				"\n",
			),
		formatSourceLibraryRemoveResult: (result) =>
			[
				"Idu-pi Source Library Remove",
				"",
				result.removedSource?.id ?? "none",
			].join("\n"),
		formatSourceLibraryReadResult: () => "Idu-pi Source Library Read",
		formatSourceLibraryExtractResult: () => "Idu-pi Source Library Extract",
		formatSourceLibraryItemReport: () => "Idu-pi Source Library Report",
		formatSourceResearchReport: () => "Idu-pi Source Research Report",
		formatSourceDigest: () => "Idu-pi Source Digest",
		formatSourceDigestStatus: () => "Idu-pi Source Digest Status",
		formatSourceChunkRead: () => "Idu-pi Source Chunk Read",
		formatSourceRecommendationReport: () => "Idu-pi Source Recommend For Task",
		formatSourceRequiredActionsReport: () => "Idu-pi Source Required Actions",
		formatSourceSkillCandidateCreationResult: (result) =>
			[
				"Source skill candidates",
				"",
				`candidates: ${result.report.candidates.length}`,
				`warning: ${result.report.warning}`,
				"tokens/cost: no medido",
			].join("\n"),
		formatSourceSkillCandidateReview: (review) =>
			[
				"Source skill candidates review",
				"",
				"Estado:",
				review.ok ? "valid" : "invalid",
			].join("\n"),
		formatSourceLibraryRefreshResult: (status) =>
			["Idu-pi Source Library Refresh", "", status.state].join("\n"),
		formatMasterPlanOperation: (result: { plan: { status: string } }) =>
			["Master Plan", String(result.plan.status)].join("\n"),
		labReviewPlan: () => ({
			shouldReview: false,
			risk: "low",
			affectedAreas: [],
			suggestedAgentLabs: [],
			warnings: [],
			recommendedNext: "No se requiere revisión AgentLab para este riesgo.",
		}),
		formatLabReviewPlan: () =>
			"Lab Review Plan Idu-pi\n\nNo ejecuté AgentLabs; solo preparé el plan.",
		semanticAuditStatus: fakeSemanticAuditStatus,
		formatSemanticAuditStatus: (report) =>
			[
				"Semantic Audit Status",
				"",
				"Proyecto:",
				report.projectId,
				"",
				"shouldRun:",
				String(report.decision.shouldRun),
			].join("\n"),
		semanticAuditRun: fakeSemanticAuditRun,
		formatSemanticAuditRun: (result) =>
			[
				"Semantic Audit Run",
				"",
				"Estado:",
				result.status,
				"",
				"No usé IA, no compacté memoria, no borré datos y no ejecuté AgentLabs.",
			].join("\n"),
		semanticCompactionDraft: () => fakeSemanticCompactionDraft(workspaceRoot),
		formatSemanticCompactionDraft: (result) =>
			[
				"Semantic Compaction Draft",
				"",
				"Ruta:",
				result.path,
				"",
				"No apliqué reglas, no creé semantic_memory_items, no borré datos y no ejecuté AgentLabs.",
			].join("\n"),
		semanticCompactionReview: () => fakeSemanticCompactionReview(workspaceRoot),
		formatSemanticCompactionReview: (review) =>
			[
				"Semantic Compaction Review",
				"",
				"Draft válido:",
				review.validDraft ? "sí" : "no",
				"",
				"suggestedRuleUpdates:",
				review.summary.suggestedRuleUpdates.join("\n"),
				"",
				"suggestedAgentTasks:",
				review.summary.suggestedAgentTasks.join("\n"),
			].join("\n"),
		supervisorTick: fakeSupervisorResult,
		supervisorCronPlan: (): IduSupervisorCronPlanResult => ({
			status: "planned",
			projectId: "test-project",
			classification: "watch",
			proposedActions: ["idu_semantic_audit_status"],
			advisoryOnly: true,
			writesAllowed: false,
			agentLabsAllowed: false,
			loop: fakeSupervisorResult(),
		}),
		formatSupervisorTick: (result) =>
			[
				"Idu-pi Supervisor Tick",
				"",
				"Estado:",
				result.status,
				"",
				"No ejecuté AgentLabs, no apliqué reglas, no borré memoria.",
			].join("\n"),
		supervisorOnIduActivation: () => undefined,
		supervisorImprovementPlan: fakeSupervisorImprovementPlan,
		formatSupervisorImprovementPlan: (plan) =>
			[
				"Supervisor Improvement Proposals",
				"",
				"Propuestas:",
				String(plan.proposals.length),
				"",
				"No apliqué reglas ni modifiqué skills.",
			].join("\n"),
		supervisorImprovementCreate: fakeSupervisorImprovementCreation,
		formatSupervisorImprovementCreationResult: (result) =>
			[
				"Supervisor Improvement Proposals Created",
				"",
				"Ruta:",
				result.path,
				"",
				"No apliqué reglas, no modifiqué skills y no ejecuté AgentLabs.",
			].join("\n"),
		supervisorImprovementStatus: fakeSupervisorImprovementStatus,
		formatSupervisorImprovementStatus: (result) =>
			[
				"Supervisor Improvement Status",
				"",
				"proposed:",
				String(result.counts.proposed),
				"",
				"No apliqué cambios ni ejecuté AgentLabs.",
			].join("\n"),
		supervisorImprovementApprove: () =>
			fakeSupervisorImprovementDecision("approved"),
		supervisorImprovementReject: () =>
			fakeSupervisorImprovementDecision("rejected"),
		supervisorImprovementDefer: () =>
			fakeSupervisorImprovementDecision("deferred"),
		formatSupervisorImprovementDecisionResult: (result) =>
			[
				"Supervisor Improvement Decision",
				"",
				"Acción:",
				result.action,
				"",
				"Sólo registré decisión humana. No apliqué cambios.",
			].join("\n"),
		supervisorImprovementsApply: () =>
			fakeSupervisorLearningRulesApply(workspaceRoot),
		formatSupervisorLearningRulesApplyResult: (result) =>
			[
				"Supervisor Learning Rules Applied",
				"",
				"Ruta:",
				result.path,
				"",
				"Reglas creadas:",
				String(result.created.length),
			].join("\n"),
		supervisorLearningRulesStatus: () =>
			fakeSupervisorLearningRulesStatus(workspaceRoot),
		formatSupervisorLearningRulesStatus: (status) =>
			[
				"Supervisor Learning Rules Status",
				"",
				"Reglas:",
				String(status.ruleCount),
			].join("\n"),
		supervisorLearningRulesTest: () =>
			fakeSupervisorLearningRulesTest(workspaceRoot),
		formatSupervisorLearningRulesTest: () =>
			"Supervisor Learning Rules Test\n\nCasos:\n- ninguno",
		supervisorLearningRulesDisable: () =>
			fakeSupervisorLearningRuleDecision(workspaceRoot, "disabled"),
		supervisorLearningRulesEnable: () =>
			fakeSupervisorLearningRuleDecision(workspaceRoot, "enabled"),
		formatSupervisorLearningRuleDecision: (result) =>
			[
				`Supervisor Learning Rule ${result.action}`,
				"",
				"Rule:",
				result.rule.id,
			].join("\n"),
		supervisorLearningRulesRollback: () =>
			fakeSupervisorLearningRulesRollback(workspaceRoot),
		formatSupervisorLearningRulesRollback: () =>
			"Supervisor Learning Rules Rollback\n\nRules:\n0",
		skillImprovementPlan: fakeSkillImprovementPlan,
		formatSkillImprovementPlan: (plan) =>
			[
				"Skill Improvement Proposals",
				"",
				"Propuestas:",
				String(plan.proposals.length),
				"",
				"No modifiqué skills ni ejecuté AgentLabs.",
			].join("\n"),
		skillImprovementCreate: fakeSkillImprovementCreation,
		formatSkillImprovementCreationResult: (result) =>
			[
				"Skill Improvement Proposals Created",
				"",
				"Ruta:",
				result.path,
				"",
				"No modifiqué skills, .agents ni .atl.",
			].join("\n"),
		skillImprovementStatus: fakeSkillImprovementStatus,
		formatSkillImprovementStatus: (status) =>
			[
				"Skill Improvement Status",
				"",
				"proposed:",
				String(status.countsByStatus.proposed),
			].join("\n"),
		skillImprovementApprove: () => fakeSkillImprovementDecision("approved"),
		skillImprovementReject: () => fakeSkillImprovementDecision("rejected"),
		skillImprovementDefer: () => fakeSkillImprovementDecision("deferred"),
		formatSkillImprovementDecisionResult: (result) =>
			[
				"Skill Improvement Decision",
				"",
				"Acción:",
				result.action,
				"",
				"Sólo registré decisión humana. No modifiqué skills.",
			].join("\n"),
		skillDraftsCreate: fakeSkillDraftCreation,
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
		formatSkillDraftCreationResult: (result) =>
			[
				"Skill Drafts Created",
				"",
				"Ruta:",
				result.path,
				"",
				"No modifiqué skills reales, .agents ni .atl.",
			].join("\n"),
		skillDraftReview: fakeSkillDraftReview,
		formatSkillDraftReview: (review) =>
			[
				"Skill Draft Review",
				"",
				"Archivo:",
				review.name,
				"",
				"security-auth-review",
				"",
				"No modifiqué skills reales, .agents ni .atl.",
			].join("\n"),
		agentLabRequestCreate: fakeAgentLabRequestPlan,
		formatAgentLabReviewRequestPlan: (plan) =>
			[
				"AgentLab Review Requests Created",
				"",
				"Ruta:",
				plan.path,
				"",
				"No ejecuté AgentLabs ni apliqué skills.",
			].join("\n"),
		agentLabRequestReview: fakeAgentLabRequestReview,
		formatAgentLabReviewRequestReview: (review) =>
			[
				"AgentLab Review Request Review",
				"",
				"Archivo:",
				review.name,
				"",
				"security",
			].join("\n"),
		agentLabReviewRun: async () => fakeAgentLabReviewRun(),
		formatAgentLabReviewRunResult: (result) =>
			[
				"AgentLab Review Run",
				"",
				"Ruta:",
				result.path,
				"",
				"Skipped:",
				"1",
			].join("\n"),
		agentLabReviewStatus: fakeAgentLabReviewStatus,
		formatAgentLabReviewStatus: (status) =>
			["AgentLab Review Status", "", "Archivo:", status.name].join("\n"),
		agentLabReportConsolidate: fakeAgentLabConsolidation,
		formatAgentLabConsolidationResult: (result) =>
			[
				"AgentLab Report Consolidation",
				"",
				"Ruta:",
				result.path,
				"",
				"No apliqué cambios, no ejecuté AgentLabs, no modifiqué skills/Core/Constitution.",
			].join("\n"),
		agentLabReportConsolidationStatus: fakeAgentLabConsolidationStatus,
		formatAgentLabConsolidationStatus: (status) =>
			[
				"AgentLab Report Consolidation Status",
				"",
				"Archivo:",
				status.name,
			].join("\n"),
		semanticAgentTaskPlan: fakeSemanticAgentTaskPlan,
		formatSemanticAgentTaskPlan: (plan) =>
			[
				"Semantic Agent Tasks Review",
				"",
				"Tareas candidatas:",
				String(plan.candidates.length),
				"",
				"security — priority 5",
				"",
				"No ejecuté AgentLabs ni modifiqué código.",
			].join("\n"),
		semanticAgentTasksCreate: fakeSemanticAgentTaskCreation,
		formatSemanticAgentTaskCreationResult: (result) =>
			[
				"Semantic Agent Tasks Created",
				"",
				"Creadas:",
				...result.created.map(
					(task) => `- ${task.id} ${task.category} priority ${task.priority}`,
				),
				"",
				"Solo registré tareas para revisión. No ejecuté AgentLabs.",
			].join("\n"),
		createTask: (_kind: TaskTemplateKind, details: string) => {
			const task = {
				...fakeTask(),
				id: `task-${tasks.length + 1}`,
				text: details,
			};
			tasks.push(task);
			return task;
		},
		listTasks: () => tasks.map((task) => ({ ...task })),
		formatTask: (task) =>
			[
				"Idu-pi Task",
				"",
				"Estado:",
				"queued",
				"",
				"ID:",
				task.id,
				"",
				"Nota segura:",
				"Registré la tarea y la señal localmente; no ejecuté IA ni AgentLabs.",
			].join("\n"),
		queueDetail: () => "Cola estructurada (1):\n\ntask-1 | pending | P5 | bug",
		queueClearStructured: () => 1,
		queueApprove: fakeTask,
		queueReject: fakeTask,
	};
	return runtime;
}

test("cli status muestra estado sin escribir archivos", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const before = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		const result = await runCliCommand(["status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado CLI/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
		const after = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		assert.deepEqual(after, before);
	});
});

test("cli status sin runtime no crea registry faltante", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-status-readonly-"));
	const registryPath = join(root, "data", "projects.json");
	const previous = { ...process.env };
	try {
		process.env.DEFAULT_CWD = root;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = join(root, "state");
		process.env.IDU_PI_REGISTRY_PATH = registryPath;
		process.env.TELEGRAM_BOT_TOKEN = "test-token";
		process.env.ALLOWED_USER_ID = "1";
		const result = await runCliCommand(["status"]);
		assert.equal(result.exitCode, 1);
		assert.equal(existsSync(registryPath), false);
	} finally {
		process.env = previous;
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI master-plan commands are wired with aliases", async () => {
	await withRuntime(async (runtime) => {
		const status = await runCliCommand(["master-plan-status"], runtime);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /Master Plan Status/u);
		const review = await runCliCommand(
			["idu-master-plan-review", "latest"],
			runtime,
		);
		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /Plan Maestro Idu-pi/u);
		const approve = await runCliCommand(
			["master-plan-approve", "latest"],
			runtime,
		);
		assert.equal(approve.exitCode, 0);
		assert.match(approve.stdout, /approved/u);
		const reject = await runCliCommand(
			["idu-master-plan-reject", "latest", "objetivo incompleto"],
			runtime,
		);
		assert.equal(reject.exitCode, 0);
		assert.match(reject.stdout, /rejected/u);
		const redraft = await runCliCommand(
			["master-plan-redraft", "latest"],
			runtime,
		);
		assert.equal(redraft.exitCode, 0);
		assert.match(redraft.stdout, /draft/u);
	});
});

test("CLI alert commands expose status tick and control safely", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `telegram bug repeated ${index}`);
		}

		const status = await runCliCommand(["alerts", "status"], runtime);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /Autonomous Alerts/u);
		assert.match(status.stdout, /rawHonesty: true/u);
		assert.match(status.stdout, /No implementé código/u);
		assert.equal(existsSync(join(workspaceRoot, "reports")), false);

		const beforeTick = runtime.listTasks?.().length ?? 0;
		const tick = await runCliCommand(["alerts", "tick"], runtime);
		assert.equal(tick.exitCode, 0);
		assert.match(tick.stdout, /allowTaskCreation: false/u);
		assert.equal(runtime.listTasks?.().length ?? 0, beforeTick);
		assert.equal(existsSync(join(workspaceRoot, "reports")), false);

		const pause = await runCliCommand(
			["alerts", "control", "pause", "60"],
			runtime,
		);
		assert.equal(pause.exitCode, 0);
		assert.match(pause.stdout, /Alert control updated/u);
		const statePath = join(
			workspaceRoot,
			"reports",
			"autonomous-alert-engine-state.json",
		);
		assert.equal(existsSync(statePath), true);
		assert.match(readFileSync(statePath, "utf8"), /pausedUntil/u);
	});
});

test("CLI alert tick is read-only by default for human escalations", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `security db auth bug repeated ${index}`);
		}
		const result = await runCliCommand(["alerts", "tick"], runtime);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /allowTaskCreation: false/u);
		assert.equal(existsSync(join(workspaceRoot, "reports")), false);
	});
});

test("CLI alert tick requires explicit allow-task-creation", async () => {
	await withRuntime(async (runtime) => {
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `telegram bug repeated ${index}`);
		}
		const result = await runCliCommand(
			["alerts", "tick", "--allow-task-creation"],
			runtime,
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /allowTaskCreation: true/u);
		assert.match(result.stdout, /Tareas creadas:/u);
		assert.ok((runtime.listTasks?.().length ?? 0) > 4);
	});
});

test("CLI scheduled alert tick is OS-priority and read-only by default", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession(runtime.projectId);
		runtime.masterPlanReview = () =>
			({
				markdown: "# Plan Maestro Idu-pi\n",
				plan: {
					status: "approved",
					inferredObjective:
						"Idu-pi supervises the Pi orchestrator with evidence.",
					executiveSummary: "Supervisor/auditor summary",
					criticalRisks: [],
				},
			}) as any;
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `scheduled backlog repeated ${index}`);
		}
		const beforeTick = runtime.listTasks?.().length ?? 0;
		const result = await runCliCommand(["alerts", "scheduled-tick"], runtime);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Autonomous Alerts Scheduled Tick/u);
		assert.match(result.stdout, /status: ran/u);
		assert.match(result.stdout, /planApproved: true/u);
		assert.match(result.stdout, /allowTaskCreation: false/u);
		assert.match(result.stdout, /Telegram no es requerido/u);
		assert.equal(runtime.listTasks?.().length ?? 0, beforeTick);
		assert.equal(
			existsSync(
				join(workspaceRoot, "reports", "master-plan-objective-cache.json"),
			),
			true,
		);
	});
});

test("CLI automaticov1 cycle composes engines without authorizing work", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession(runtime.projectId);
		runtime.masterPlanReview = () =>
			({
				markdown: "# Plan Maestro Idu-pi\n",
				plan: {
					status: "approved",
					projectId: runtime.projectId,
					inferredObjective:
						"Idu-pi supervises the Pi orchestrator with evidence.",
					executiveSummary: "Supervisor/auditor summary",
					criticalRisks: [],
					workMilestones: [
						{
							name: "Hito supervisor",
							goal: "Keep supervisor execution aligned",
							actions: ["Run bounded supervisor cycle"],
							exitCriteria: ["cycle report reviewed"],
						},
					],
				},
			}) as any;
		const result = await runCliCommand(["automaticov1", "cycle"], runtime);
		await flushIduUsageEvents();
		await flushSupervisorActivityEvents();
		const usageEvents = readIduUsageEvents(workspaceRoot);
		const supervisorEvents = readSupervisorActivityEvents(workspaceRoot);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /automaticov1 cycle/u);
		assert.match(result.stdout, /allowedToProceed: false/u);
		assert.match(result.stdout, /externalFetch: disabled/u);
		assert.match(result.stdout, /skillProposals: disabled/u);
		assert.match(result.stdout, /automaticov1:bibliotecario-snapshot/u);
		assert.equal(usageEvents.length, 1);
		assert.equal(usageEvents[0]?.surface, "cli");
		assert.equal(usageEvents[0]?.action, "automaticov1");
		assert.equal(usageEvents[0]?.allowedToProceed, false);
		assert.equal(usageEvents[0]?.requiresHuman, true);
		assert.equal(usageEvents[0]?.recommendation, "warn");
		assert.equal(usageEvents[0]?.ok, true);
		assert.equal(supervisorEvents.length, 1);
		assert.equal(supervisorEvents[0]?.eventType, "supervisor_tick");
		assert.equal(supervisorEvents[0]?.origin, "orchestrator_requested");
		assert.equal(supervisorEvents[0]?.trigger, "cron_planning");
		assert.equal(supervisorEvents[0]?.status, "completed");
		assert.equal(supervisorEvents[0]?.active, true);
		assert.equal(supervisorEvents[0]?.ok, true);
	});
});

test("CLI scheduled alert tick creates tasks only with explicit allow-task-creation", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession(runtime.projectId);
		runtime.masterPlanReview = () =>
			({
				markdown: "# Plan Maestro Idu-pi\n",
				plan: {
					status: "approved",
					inferredObjective:
						"Idu-pi supervises the Pi orchestrator with evidence.",
					executiveSummary: "Supervisor/auditor summary",
					criticalRisks: [],
				},
			}) as any;
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `scheduled backlog repeated ${index}`);
		}
		const result = await runCliCommand(
			["alerts", "scheduled-tick", "--allow-task-creation"],
			runtime,
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /status: ran/u);
		assert.match(result.stdout, /allowTaskCreation: true/u);
		assert.match(result.stdout, /Tareas creadas: 1/u);
		assert.ok((runtime.listTasks?.().length ?? 0) > 4);
	});
});

test("CLI scheduled alert tick blocks when Master Plan review is unavailable", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		configureIduSessionStore({ workspaceRoot });
		activateIduSession(runtime.projectId);
		runtime.masterPlanReview = undefined;
		const result = await runCliCommand(["alerts", "scheduled-tick"], runtime);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /status: blocked_objective/u);
		assert.match(result.stdout, /planApproved: false/u);
		assert.match(result.stdout, /Master Plan no disponible/u);
	});
});

test("CLI source library commands are wired with aliases", async () => {
	await withRuntime(async (runtime) => {
		const status = await runCliCommand(["source-status"], runtime);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /Idu-pi Source Library/u);
		const add = await runCliCommand(
			["idu-source-add", "C:/docs/manual.md"],
			runtime,
		);
		assert.equal(add.exitCode, 0);
		assert.match(add.stdout, /source-demo-manual/u);
		const remove = await runCliCommand(
			["source-remove", "source-demo-manual-abc123"],
			runtime,
		);
		assert.equal(remove.exitCode, 0);
		assert.match(remove.stdout, /Source Library Remove/u);
		const read = await runCliCommand(
			["source-read", "source-demo-manual-abc123"],
			runtime,
		);
		assert.equal(read.exitCode, 0);
		assert.match(read.stdout, /Source Library Read/u);
		const extract = await runCliCommand(
			["source-extract", "source-demo-manual-abc123"],
			runtime,
		);
		assert.equal(extract.exitCode, 0);
		assert.match(extract.stdout, /Source Library Extract/u);
		const report = await runCliCommand(
			["source-report", "source-demo-manual-abc123"],
			runtime,
		);
		assert.equal(report.exitCode, 0);
		assert.match(report.stdout, /Source Library Report/u);
		const research = await runCliCommand(
			["source-research", "robusto"],
			runtime,
		);
		assert.equal(research.exitCode, 0);
		assert.match(research.stdout, /Source Research Report/u);
		const digest = await runCliCommand(
			["source-digest", "source-demo-manual-abc123"],
			runtime,
		);
		assert.equal(digest.exitCode, 0);
		assert.match(digest.stdout, /Source Digest/u);
		const digestStatus = await runCliCommand(["source-digest-status"], runtime);
		assert.equal(digestStatus.exitCode, 0);
		assert.match(digestStatus.stdout, /Source Digest Status/u);
		const chunk = await runCliCommand(
			[
				"source-chunk-read",
				"source-demo-manual-abc123",
				"source-demo-manual-abc123-chunk-001",
			],
			runtime,
		);
		assert.equal(chunk.exitCode, 0);
		assert.match(chunk.stdout, /Source Chunk Read/u);
		const recommend = await runCliCommand(
			["source-recommend", "robusto"],
			runtime,
		);
		assert.equal(recommend.exitCode, 0);
		assert.match(recommend.stdout, /Source Recommend/u);
		const requiredActions = await runCliCommand(
			["source-required-actions"],
			runtime,
		);
		assert.equal(requiredActions.exitCode, 0);
		assert.match(requiredActions.stdout, /Source Required Actions/u);
		const candidates = await runCliCommand(
			["idu-source-skill-candidates-create", "all"],
			runtime,
		);
		assert.equal(candidates.exitCode, 0);
		assert.match(candidates.stdout, /Source skill candidates/u);
		assert.match(candidates.stdout, /Reports-only/u);
		assert.match(candidates.stdout, /tokens\/cost: no medido/u);
		const candidateReview = await runCliCommand(
			["source-skill-candidates-review", "latest"],
			runtime,
		);
		assert.equal(candidateReview.exitCode, 0);
		assert.match(candidateReview.stdout, /Source skill candidates review/u);
		const refresh = await runCliCommand(["source-refresh"], runtime);
		assert.equal(refresh.exitCode, 0);
		assert.match(refresh.stdout, /Source Library Refresh/u);
	});
});

test("cli natural approval only acts with pending Master Plan action", async () => {
	await withRuntime(async (runtime) => {
		let pending = false;
		let approved = false;
		runtime.masterPlanNaturalDecision = (text) => {
			if (!pending) return { handled: false, reason: "no_pending_action" };
			if (text === "ok" || text === "dale") {
				approved = true;
				pending = false;
				return {
					handled: true,
					action: "approved",
					result: {
						plan: { status: "approved" },
						current: { status: "approved" },
					} as any,
				};
			}
			return { handled: false, reason: "no_match" };
		};

		const ignored = await runCliCommand(["ok"], runtime);
		assert.equal(ignored.exitCode, 1);
		assert.equal(approved, false);

		pending = true;
		const result = await runCliCommand(["dale"], runtime);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /approved/u);
		assert.equal(approved, true);
	});
});

test("cli idu activa sesión persistente", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		runtime.supervisorOnIduActivation = () => ({
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
		});
		const result = await runCliCommand(["idu"], runtime);
		await flushIduUsageEvents();

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Guardrails automáticos activados/u);
		assert.match(
			result.stdout,
			/Arranque supervisor:\ncompleted — Supervisor startup check completed\./u,
		);
		assert.equal(
			existsSync(join(workspaceRoot, "reports", "idu-session-state.json")),
			true,
		);
		assert.equal(
			existsSync(join(workspaceRoot, "reports", "idu-usage-events.jsonl")),
			true,
		);
	});
});

test("cli usage-status muestra resumen de eventos locales", async () => {
	await withRuntime(async (runtime) => {
		await runCliCommand(["idu"], runtime);
		const result = await runCliCommand(["idu-usage-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Uso Idu-pi/u);
		assert.match(result.stdout, /llamadas Idu-pi: 1/u);
		assert.match(result.stdout, /compactaciones detectadas: no medido/u);
		assert.match(result.stdout, /tokens Idu-pi: no medido/u);
		assert.match(result.stdout, /% contexto Idu-pi: no medido/u);
		assert.match(result.stdout, /cli/u);
		assert.match(result.stdout, /idu/u);
	});
});

test("cli idu-off desactiva sesión", async () => {
	await withRuntime(async (runtime) => {
		await runCliCommand(["idu"], runtime);
		const result = await runCliCommand(["idu-off"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado:\ninactive/u);
		assert.match(result.stdout, /guardrails:\nmanual/u);
	});
});

test("cli idu-status lee el mismo estado persistido", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		await runCliCommand(["idu"], runtime);
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("pi-telegram-bridge").active, true);

		const result = await runCliCommand(["idu-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado:\nactive/u);
		assert.match(result.stdout, /projectId:\npi-telegram-bridge/u);
	});
});

test("cli normaliza separador -- sin perder comandos ni argumentos", async () => {
	assert.deepEqual(normalizeCliArgs(["idu"]), ["idu"]);
	assert.deepEqual(normalizeCliArgs(["--", "idu"]), ["idu"]);
	assert.deepEqual(normalizeCliArgs(["--"]), []);
	assert.deepEqual(normalizeCliArgs(["--", "idu-task", "fallo login"]), [
		"idu-task",
		"fallo login",
	]);
	assert.deepEqual(
		normalizeCliArgs(["--", "idu-master-plan-review", "latest"]),
		["idu-master-plan-review", "latest"],
	);
});

test("cli acepta separador -- estilo node/corepack", async () => {
	await withRuntime(async (runtime) => {
		await runCliCommand(["idu"], runtime);

		const iduStatus = await runCliCommand(["--", "idu-status"], runtime);
		assert.equal(iduStatus.exitCode, 0);
		assert.match(iduStatus.stdout, /Estado:\nactive/u);
		assert.equal(iduStatus.stderr, "");

		const home = await runCliCommand(["--"], runtime);
		assert.equal(home.exitCode, 0);
		assert.match(home.stdout, /Idu-pi|Estado:/u);

		let capturedDetails = "";
		const task = await runCliCommand(["--", "idu-task", "fallo login"], {
			...runtime,
			createTask: (kind, details) => {
				capturedDetails = details;
				return runtime.createTask(kind, details);
			},
		});
		assert.equal(task.exitCode, 0);
		assert.equal(capturedDetails, "fallo login");
		assert.match(task.stdout, /Idu-pi Task/u);

		const review = await runCliCommand(
			["--", "idu-master-plan-review", "latest"],
			runtime,
		);
		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /Plan Maestro Idu-pi/u);
	});
});

test("cli prepare llama al flujo de idu_prepare", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-prepare"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Prepare/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
	});
});

test("cli project reset state exige --yes", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-project-reset-state"], runtime);

		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /--yes/u);
	});
});

test("cli project reset state funciona con --yes", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-project-reset-state", "--yes"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /project state reset/u);
	});
});

test("cli preflight cambia login devuelve riesgo high", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-preflight", "cambia login"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Preflight Idu-pi/u);
		assert.match(result.stdout, /Riesgo:\nhigh/u);
	});
});

test("cli advisory cambia login devuelve advisory", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-advisory", "cambia login"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Advisory/u);
		assert.match(result.stdout, /cambia login/u);
	});
});

test("cli postflight registra sólo evento de uso local", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const before = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		const result = await runCliCommand(["idu-postflight"], runtime);
		await flushIduUsageEvents();

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Postflight Idu-pi/u);
		const after = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		assert.deepEqual(
			after.filter((entry) => !before.includes(entry)),
			["idu-usage-events.jsonl"],
		);
	});
});

test("cli lab-review-plan postflight prepara plan sin AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-lab-review-plan", "postflight"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Lab Review Plan Idu-pi/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI agentlab request commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const createPostflight = await runCliCommand(
			["idu-agentlab-request-create", "postflight"],
			runtime,
		);
		const createSkillDraft = await runCliCommand(
			["idu-agentlab-request-create", "skill-draft", "latest"],
			runtime,
		);
		const createMasterPlan = await runCliCommand(
			["idu-agentlab-request-create", "master-plan", "latest"],
			runtime,
		);
		const review = await runCliCommand(
			["idu-agentlab-request-review", "latest"],
			runtime,
		);
		const simpleReview = await runCliCommand(["revisar"], runtime);

		assert.equal(createPostflight.exitCode, 0);
		assert.match(createPostflight.stdout, /AgentLab Review Requests Created/u);
		assert.match(createPostflight.stdout, /No ejecuté AgentLabs/u);
		assert.equal(createSkillDraft.exitCode, 0);
		assert.match(createSkillDraft.stdout, /agentlab-review-request/u);
		assert.equal(createMasterPlan.exitCode, 0);
		assert.match(createMasterPlan.stdout, /agentlab-review-request/u);
		assert.match(createMasterPlan.stdout, /No ejecuté AgentLabs/u);
		assert.doesNotMatch(createMasterPlan.stdout, /Deep review ejecutado/u);
		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /AgentLab Review Request Review/u);
		assert.equal(simpleReview.exitCode, 0);
		assert.match(simpleReview.stdout, /Revisión del supervisor/u);
		assert.match(simpleReview.stdout, /Repo real: sin modificar/u);
	});
});

test("CLI agentlab review run/status commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const run = await runCliCommand(
			["idu-agentlab-review-run", "latest"],
			runtime,
		);
		const status = await runCliCommand(
			["idu-agentlab-review-status", "latest"],
			runtime,
		);

		assert.equal(run.exitCode, 0);
		assert.match(run.stdout, /AgentLab Review Run/u);
		assert.match(run.stdout, /agentlab-review-run/u);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /AgentLab Review Status/u);
	});
});

test("CLI agentlab report consolidation commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const consolidate = await runCliCommand(
			["idu-agentlab-report-consolidate", "latest"],
			runtime,
		);
		const alias = await runCliCommand(
			["agentlab-report-consolidate", "latest"],
			runtime,
		);
		const status = await runCliCommand(
			["idu-agentlab-report-consolidation-status", "latest"],
			runtime,
		);

		assert.equal(consolidate.exitCode, 0);
		assert.match(consolidate.stdout, /AgentLab Report Consolidation/u);
		assert.match(consolidate.stdout, /agentlab-consolidation/u);
		assert.equal(alias.exitCode, 0);
		assert.match(alias.stdout, /No apliqué cambios/u);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /AgentLab Report Consolidation Status/u);
	});
});

test("CLI semantic-audit-status funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-semantic-audit-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Audit Status/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
	});
});

test("CLI semantic-audit-run funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-semantic-audit-run"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Audit Run/u);
		assert.match(result.stdout, /No usé IA/u);
	});
});

test("CLI semantic-compact-draft funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-semantic-compact-draft"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Compaction Draft/u);
		assert.match(result.stdout, /semantic-compaction-draft/u);
		assert.match(result.stdout, /no ejecuté AgentLabs/u);
	});
});

test("CLI semantic-compact-review latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-semantic-compact-review", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Compaction Review/u);
		assert.match(result.stdout, /suggestedRuleUpdates/u);
		assert.match(result.stdout, /suggestedAgentTasks/u);
	});
});

test("CLI semantic-agent-tasks-review latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-semantic-agent-tasks-review", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Agent Tasks Review/u);
		assert.match(result.stdout, /security — priority 5/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI semantic-agent-tasks-create latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-semantic-agent-tasks-create", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Agent Tasks Created/u);
		assert.match(result.stdout, /task-sg5-1/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI idu-supervisor-improvements-review latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-supervisor-improvements-review", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Supervisor Improvement Proposals/u);
		assert.match(result.stdout, /Propuestas:\n1/u);
		assert.match(result.stdout, /No apliqué reglas/u);
	});
});

test("CLI idu-supervisor-improvements-create latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-supervisor-improvements-create", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Supervisor Improvement Proposals Created/u);
		assert.match(result.stdout, /supervisor-improvement-proposals/u);
		assert.match(result.stdout, /no ejecuté AgentLabs/u);
	});
});

test("CLI supervisor-improvements-status latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["supervisor-improvements-status", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Supervisor Improvement Status/u);
		assert.match(result.stdout, /proposed:\n1/u);
		assert.match(result.stdout, /No apliqué cambios/u);
	});
});

test("CLI skill-improvements commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const review = await runCliCommand(
			["skill-improvements-review", "latest"],
			runtime,
		);
		const create = await runCliCommand(
			["idu-skill-improvements-create", "latest"],
			runtime,
		);
		const status = await runCliCommand(
			["skill-improvements-status", "latest"],
			runtime,
		);

		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /Skill Improvement Proposals/u);
		assert.match(review.stdout, /No modifiqué skills/u);
		assert.equal(create.exitCode, 0);
		assert.match(create.stdout, /skill-improvement-proposals/u);
		assert.match(create.stdout, /.agents ni .atl/u);
		assert.equal(status.exitCode, 0);
		assert.match(status.stdout, /Skill Improvement Status/u);
		assert.match(status.stdout, /proposed:\n1/u);
	});
});

test("CLI skill-improvements decision commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const approved = await runCliCommand(
			["skill-improvements-approve", "latest", "skill-improvement-001"],
			runtime,
		);
		const rejected = await runCliCommand(
			[
				"idu-skill-improvements-reject",
				"latest",
				"skill-improvement-001",
				"no aplica",
			],
			runtime,
		);
		const deferred = await runCliCommand(
			[
				"skill-improvements-defer",
				"latest",
				"skill-improvement-001",
				"requiere evidencia",
			],
			runtime,
		);

		assert.equal(approved.exitCode, 0);
		assert.match(approved.stdout, /Skill Improvement Decision/u);
		assert.match(approved.stdout, /approved/u);
		assert.match(approved.stdout, /No modifiqué skills/u);
		assert.equal(rejected.exitCode, 0);
		assert.match(rejected.stdout, /rejected/u);
		assert.equal(deferred.exitCode, 0);
		assert.match(deferred.stdout, /deferred/u);
	});
});

test("CLI skill-drafts commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const create = await runCliCommand(
			["skill-drafts-create", "latest"],
			runtime,
		);
		const review = await runCliCommand(
			["idu-skill-drafts-review", "latest"],
			runtime,
		);

		assert.equal(create.exitCode, 0);
		assert.match(create.stdout, /Skill Drafts Created/u);
		assert.match(create.stdout, /skill-draft/u);
		assert.match(create.stdout, /No modifiqué skills reales/u);
		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /Skill Draft Review/u);
		assert.match(review.stdout, /security-auth-review/u);
	});
});

test("CLI supervisor-improvements decision commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const approved = await runCliCommand(
			["supervisor-improvements-approve", "latest", "improvement-001"],
			runtime,
		);
		const rejected = await runCliCommand(
			[
				"supervisor-improvements-reject",
				"latest",
				"improvement-001",
				"no aplica",
			],
			runtime,
		);
		const deferred = await runCliCommand(
			[
				"supervisor-improvements-defer",
				"latest",
				"improvement-001",
				"requiere evidencia",
			],
			runtime,
		);

		assert.equal(approved.exitCode, 0);
		assert.equal(rejected.exitCode, 0);
		assert.equal(deferred.exitCode, 0);
		assert.match(approved.stdout, /Acción:\napproved/u);
		assert.match(rejected.stdout, /Acción:\nrejected/u);
		assert.match(deferred.stdout, /Acción:\ndeferred/u);
	});
});

test("CLI idu-supervisor-improvements decision aliases funcionan", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-supervisor-improvements-approve", "latest", "improvement-001"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Supervisor Improvement Decision/u);
	});
});

test("CLI supervisor-improvements aliases siguen funcionando", async () => {
	await withRuntime(async (runtime) => {
		const review = await runCliCommand(
			["supervisor-improvements-review", "latest"],
			runtime,
		);
		const create = await runCliCommand(
			["supervisor-improvements-create", "latest"],
			runtime,
		);

		assert.equal(review.exitCode, 0);
		assert.equal(create.exitCode, 0);
		assert.match(review.stdout, /Supervisor Improvement Proposals/u);
		assert.match(create.stdout, /Supervisor Improvement Proposals Created/u);
	});
});

test("CLI supervisor learning rules apply/status funcionan", async () => {
	await withRuntime(async (runtime) => {
		const apply = await runCliCommand(
			["idu-supervisor-improvements-apply", "latest"],
			runtime,
		);
		const status = await runCliCommand(
			["idu-supervisor-learning-rules-status"],
			runtime,
		);

		assert.equal(apply.exitCode, 0);
		assert.equal(status.exitCode, 0);
		assert.match(apply.stdout, /Supervisor Learning Rules Applied/u);
		assert.match(status.stdout, /Supervisor Learning Rules Status/u);
	});
});

test("CLI supervisor learning rules QA commands funcionan", async () => {
	await withRuntime(async (runtime) => {
		const testResult = await runCliCommand(
			["idu-supervisor-learning-rules-test"],
			runtime,
		);
		const disabled = await runCliCommand(
			[
				"idu-supervisor-learning-rules-disable",
				"learn-improvement-001",
				"ruidosa",
			],
			runtime,
		);
		const enabled = await runCliCommand(
			[
				"idu-supervisor-learning-rules-enable",
				"learn-improvement-001",
				"validada",
			],
			runtime,
		);
		const rollback = await runCliCommand(
			["idu-supervisor-learning-rules-rollback", "latest"],
			runtime,
		);

		assert.equal(testResult.exitCode, 0);
		assert.equal(disabled.exitCode, 0);
		assert.equal(enabled.exitCode, 0);
		assert.equal(rollback.exitCode, 0);
		assert.match(testResult.stdout, /Supervisor Learning Rules Test/u);
		assert.match(disabled.stdout, /disabled/u);
		assert.match(enabled.stdout, /enabled/u);
		assert.match(rollback.stdout, /Supervisor Learning Rules Rollback/u);
	});
});

test("CLI supervisor-tick funciona sin AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["supervisor-tick"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Supervisor Tick/u);
		assert.match(result.stdout, /Estado:\ncompleted/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("supervisor tick records supervisor activity without incrementing Idu-pi calls", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const instrumentedRuntime: CliRuntime = {
			...runtime,
			supervisorTick: (options) => {
				const result = runtime.supervisorTick(options);
				recordSupervisorActivityEventDeferred(
					workspaceRoot,
					supervisorActivityInputFromLoopResult(result, {
						origin: "supervisor_manual_tick",
						eventType: "supervisor_tick",
					}),
				);
				return result;
			},
		};
		const result = await runCliCommand(
			["idu-supervisor-tick"],
			instrumentedRuntime,
		);
		await flushSupervisorActivityEvents();
		await flushIduUsageEvents();

		assert.equal(result.exitCode, 0);
		const activity = readSupervisorActivityEvents(workspaceRoot);
		assert.equal(activity.length, 1);
		assert.equal(activity[0]?.eventType, "supervisor_tick");
		assert.equal(activity[0]?.origin, "supervisor_manual_tick");
		assert.equal(activity[0]?.trigger, "manual");
		assert.equal(activity[0]?.status, "completed");
		assert.equal(readIduUsageEvents(workspaceRoot).length, 0);
	});
});

test("CLI idu-supervisor-tick alias funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-supervisor-tick"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Supervisor Tick/u);
	});
});

test("CLI task bug encola tarea sin AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-task", "bug", "urgente otra vez falló login"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Task/u);
		assert.match(result.stdout, /queued/u);
		assert.match(result.stdout, /no ejecuté IA ni AgentLabs/u);
	});
});

test("CLI idu-task sin argumentos muestra ayuda sin fallar", async () => {
	await withRuntime(async (runtime) => {
		let createTaskCalled = false;
		const result = await runCliCommand(["idu-task"], {
			...runtime,
			createTask: (kind, details) => {
				createTaskCalled = true;
				return runtime.createTask(kind, details);
			},
		});

		assert.equal(result.exitCode, 0);
		assert.equal(createTaskCalled, false);
		assert.match(result.stdout, /Plantillas de tarea/u);
		assert.equal(result.stderr, "");
	});
});

test("CLI idu-task infiere bug de falla en base de datos", async () => {
	await withRuntime(async (runtime) => {
		let capturedKind = "";
		let capturedDetails = "";
		const result = await runCliCommand(
			[
				"idu-task",
				"fallas",
				"en",
				"las",
				"bases",
				"de",
				"datos",
				"debemos",
				"arreglarla",
			],
			{
				...runtime,
				createTask: (kind, details) => {
					capturedKind = kind;
					capturedDetails = details;
					return fakeTask();
				},
			},
		);

		assert.equal(result.exitCode, 0);
		assert.equal(capturedKind, "bug");
		assert.equal(
			capturedDetails,
			"fallas en las bases de datos debemos arreglarla",
		);
		assert.match(result.stdout, /Idu-pi Task/u);
	});
});

test("CLI idu-task infiere bug desde texto libre", async () => {
	await withRuntime(async (runtime) => {
		let capturedKind = "";
		let capturedDetails = "";
		const result = await runCliCommand(
			["idu-task", "fallo", "nuevamente", "el", "login"],
			{
				...runtime,
				createTask: (kind, details) => {
					capturedKind = kind;
					capturedDetails = details;
					return fakeTask();
				},
			},
		);

		assert.equal(result.exitCode, 0);
		assert.equal(capturedKind, "bug");
		assert.equal(capturedDetails, "fallo nuevamente el login");
		assert.match(result.stdout, /Idu-pi Task/u);
	});
});

test("createCliTask inactive encola sin needs_confirmation", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-inactive-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		const task = createCliTask("bug", "urgente login falla", {
			projectId: "pi-telegram-bridge",
			projectPath: root,
			workspaceRoot,
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: fakePreflight,
		});

		assert.equal(task.status, "pending");
		assert.notEqual(task.guardStatus, "needs_confirmation");
		assert.match(formatCliTaskResult(task), /queued/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createCliTask active bloquea login high con confirmación", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-active-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("pi-telegram-bridge");
		const task = createCliTask("bug", "urgente login falla", {
			projectId: "pi-telegram-bridge",
			projectPath: root,
			workspaceRoot,
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: fakePreflight,
		});
		const formatted = formatCliTaskResult(task);

		assert.equal(task.guardStatus, "needs_confirmation");
		assert.equal(task.guardRisk, "high");
		assert.match(formatted, /Tarea pausada: requiere confirmación humana/u);
		assert.match(formatted, /Intención:/u);
		assert.match(formatted, /bug_report\/login\/high/u);
		assert.match(formatted, /idu-pi idu-queue-approve/u);
		assert.match(formatted, /idu-pi idu-queue-reject/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createCliTask active usa intención humana aunque preflight sea low", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-intent-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("pi-telegram-bridge");
		const task = createCliTask("bug", "borrar base de datos y schema", {
			projectId: "pi-telegram-bridge",
			projectPath: root,
			workspaceRoot,
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: (request) => ({
				...fakePreflight(request.replace(/login/gu, "")),
				risk: "low",
				okToProceed: true,
				requiresHumanConfirmation: false,
			}),
		});

		assert.equal(task.intentRiskHint, "blocker");
		assert.equal(task.guardStatus, "needs_confirmation");
		assert.equal(task.guardRisk, "blocker");
		assert.match(task.guardReason ?? "", /intent blocker/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI queue-detail muestra cola estructurada", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-detail"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Cola estructurada/u);
	});
});

test("CLI queue-detail muestra comandos CLI para aprobación", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-detail"], {
			...runtime,
			queueDetail: () =>
				formatStructuredTaskQueueDetail(
					[
						{
							...fakeTask(),
							guardStatus: "needs_confirmation",
							guardRisk: "high",
						},
					],
					{
						approveCommand: (id) => `idu-pi idu-queue-approve ${id}`,
						rejectCommand: (id) => `idu-pi idu-queue-reject ${id}`,
					},
				),
		});

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Aprobar: idu-pi idu-queue-approve task-1/u);
		assert.match(result.stdout, /Rechazar: idu-pi idu-queue-reject task-1/u);
	});
});

test("CLI queue-clear-structured limpia cola estructurada", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-clear-structured"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Cola estructurada limpiada: 1 tarea/u);
	});
});

test("CLI queue-approve aprueba tarea sin ejecutar AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-queue-approve", "task-1"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Tarea aprobada: task-1/u);
		assert.match(result.stdout, /No ejecuté IA ni AgentLabs/u);
	});
});

test("CLI queue_reject rechaza tarea", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-reject", "task-1"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Tarea rechazada: task-1/u);
	});
});

test("CLI queue-reject sin ID falla y no modifica cola", async () => {
	await withRuntime(async (runtime) => {
		let called = false;
		const guardedRuntime: CliRuntime = {
			...runtime,
			queueReject: () => {
				called = true;
				return fakeTask();
			},
		};

		const result = await runCliCommand(["idu-queue-reject"], guardedRuntime);

		assert.equal(result.exitCode, 1);
		assert.equal(called, false);
		assert.match(result.stderr, /Falta solicitud/u);
	});
});

test("CLI queue-approve sin ID falla y no modifica cola", async () => {
	await withRuntime(async (runtime) => {
		let called = false;
		const guardedRuntime: CliRuntime = {
			...runtime,
			queueApprove: () => {
				called = true;
				return fakeTask();
			},
		};

		const result = await runCliCommand(["idu-queue-approve"], guardedRuntime);

		assert.equal(result.exitCode, 1);
		assert.equal(called, false);
		assert.match(result.stderr, /Falta solicitud/u);
	});
});

test("CLI queue helpers aceptan prefijo de ID", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-queue-prefix-"));
	try {
		const queue = new StructuredTaskQueue({ workspaceRoot: root });
		const task = queue.enqueueTask({
			text: "Bug task. Symptom/context: login falla",
			category: "bug",
			priority: 5,
		});
		queue.enqueueTask({
			text: "Second task",
			category: "bug",
			priority: 5,
		});
		queue.markNeedsConfirmation(task.id, {
			guardRisk: "high",
			guardReason: "preflight high",
		});
		const prefix = task.id;

		assert.equal(approveStructuredTaskById(queue, "task-"), undefined);
		assert.equal(
			approveStructuredTaskById(queue, prefix)?.guardStatus,
			"approved",
		);
		assert.equal(
			completeStructuredTaskById(queue, "task-", "wrong task"),
			undefined,
		);
		const completed = completeStructuredTaskById(
			queue,
			prefix,
			"commit abc; tests green",
		);
		assert.equal(completed?.completionEvidence, "commit abc; tests green");
		assert.equal(completed?.guardStatus, undefined);
		assert.equal(queue.getTask(task.id)?.status, "done");
		assert.equal(rejectStructuredTaskById(queue, "missing-prefix"), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI comandos muestra catálogo local sin runtime", async () => {
	const result = await runCliCommand(["comandos"]);

	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /CLI pnpm/u);
	assert.match(
		result.stdout,
		/corepack pnpm cli -- idu-semantic-compact-draft/u,
	);
	assert.match(
		result.stdout,
		/corepack pnpm cli -- idu-semantic-agent-tasks-create latest/u,
	);
	assert.doesNotMatch(result.stdout, /corepack pnpm cli -- supervisor-tick/u);
});

test("comando desconocido muestra ayuda", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["desconocido"], runtime);

		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /Comando desconocido/u);
		assert.match(result.stdout, /Uso:/u);
	});
});

test("cli help no requiere runtime ni configuración", async () => {
	const result = await runCliCommand(["--help"]);

	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Uso: idu-pi/u);
	assert.match(result.stdout, /idu-pi idu start/u);
	assert.equal(result.stderr, "");
});
