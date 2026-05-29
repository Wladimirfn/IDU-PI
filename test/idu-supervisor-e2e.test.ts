import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import type { AgentProfile } from "../src/config.js";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	getIduSessionStatus,
	shouldUseAutomaticGuardrails,
} from "../src/idu-session.js";
import {
	formatIduSupervisorLoopResult,
	runIduSupervisorLoop,
} from "../src/idu-supervisor-loop.js";
import type { PiRpcProgressEvent, PiRpcPromptResult } from "../src/pi-rpc.js";
import type {
	SemanticAuditCheckpoint,
	SemanticAuditStats,
} from "../src/semantic-audit.js";
import type { SaveSemanticCompactionDraftResult } from "../src/semantic-compaction.js";
import {
	StructuredTaskQueue,
	structuredTaskInputForText,
} from "../src/structured-task-queue.js";
import { analyzeProjectPreflight } from "../src/project-preflight.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import {
	createSupervisorImprovementProposals,
	type SupervisorImprovementProposal,
} from "../src/supervisor-improvement-proposals.js";
import { approveSupervisorImprovement } from "../src/supervisor-improvement-decisions.js";
import {
	applySupervisorLearningRules,
	getSupervisorLearningRulesStatus,
} from "../src/supervisor-learning-rules.js";
import {
	createSkillImprovementProposals,
	type SkillImprovementProposal,
} from "../src/skill-improvement-proposals.js";
import { approveSkillImprovementProposal } from "../src/skill-improvement-decisions.js";
import { createSkillDraftsFromApprovedProposals } from "../src/skill-drafts.js";
import { createAgentLabReviewRequests } from "../src/agentlab-review-requests.js";
import {
	runAgentLabReviewRequest,
	runAgentLabReviewRequestFile,
} from "../src/agentlab-review-runner.js";
import { consolidateAgentLabReviewRun } from "../src/agentlab-report-consolidation.js";

type Paths = {
	root: string;
	workspaceRoot: string;
	reportsPath: string;
	projectPath: string;
};

class FakeSession implements AgentSession {
	readonly cwd: string;
	running = false;
	busy = false;
	cancelled = false;
	prompts: string[] = [];

	constructor(
		cwd: string,
		private readonly outputForPrompt: (message: string) => string,
		private readonly onPrompt?: () => void,
	) {
		this.cwd = cwd;
	}

	start(): void {
		this.running = true;
	}

	async prompt(
		message: string,
		_onProgress?: (event: PiRpcProgressEvent) => void,
	): Promise<PiRpcPromptResult> {
		this.prompts.push(message);
		this.onPrompt?.();
		return { ok: true, output: this.outputForPrompt(message) };
	}

	answerUiRequest(): boolean {
		return false;
	}

	cancel(): boolean {
		this.cancelled = true;
		return true;
	}

	stop(): void {
		this.running = false;
	}
}

function tempPaths(): Paths {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-e2e-"));
	const workspaceRoot = join(root, "workspace");
	const reportsPath = join(workspaceRoot, "reports");
	const projectPath = join(root, "project");
	mkdirSync(reportsPath, { recursive: true });
	mkdirSync(projectPath, { recursive: true });
	return { root, workspaceRoot, reportsPath, projectPath };
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function initGitProject(projectPath: string): void {
	git(projectPath, ["init"]);
	git(projectPath, ["config", "user.email", "idu-test@example.invalid"]);
	git(projectPath, ["config", "user.name", "Idu Test"]);
	writeFileSync(join(projectPath, "README.md"), "# temp project\n", "utf8");
	git(projectPath, ["add", "README.md"]);
	git(projectPath, ["commit", "-m", "init"]);
}

function connection(projectPath: string): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["test"],
		projectId: "pi-telegram-bridge",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "idu-pi idu-prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-25T00:00:00.000Z",
	};
}

function stats(patch: Partial<SemanticAuditStats> = {}): SemanticAuditStats {
	return {
		projectId: "pi-telegram-bridge",
		labRunCount: 0,
		findingCount: 0,
		proposalCount: 0,
		taskCount: 0,
		userSignalCount: 0,
		memoryItemCount: 0,
		criticalFindingCount: 0,
		highFindingCount: 0,
		...patch,
	};
}

function checkpoint(
	patch: Partial<SemanticAuditCheckpoint> = {},
): SemanticAuditCheckpoint {
	return {
		projectId: "pi-telegram-bridge",
		lastLabRunCount: 0,
		lastFindingCount: 0,
		lastProposalCount: 0,
		lastTaskCount: 0,
		lastUserSignalCount: 0,
		lastMemoryItemCount: 0,
		lastCriticalFindingCount: 0,
		lastHighFindingCount: 0,
		...patch,
	};
}

function semanticDraft(paths: Paths): SaveSemanticCompactionDraftResult {
	const draft = {
		generatedAt: "2026-05-25T00:00:00.000Z",
		projectId: "pi-telegram-bridge",
		warning: "Borrador IA. No es fuente de verdad." as const,
		sourceAuditRunIds: ["audit-e2e"],
		inputSummary: { criticalFindings: 1, memoryItemCount: 0 },
		preservedRules: ["Nada crítico se aplica sin confirmación humana."],
		criticalBugs: [
			{
				title: "Repeated auth login failure",
				severity: "critical",
				evidence: "fallo nuevamente el loggin",
			},
		],
		humanDecisions: [],
		reusableLessons: ["El typo loggin debe mapearse a auth/login."],
		architecturalRisks: ["Project Core debe seguir confirmado por humano."],
		classifierQualityReview: {
			emotionCorrect: "needs_review" as const,
			categoryCorrect: "needs_review" as const,
			priorityCorrect: "needs_review" as const,
			intentCorrect: "needs_review" as const,
			guardrailCorrect: "needs_review" as const,
			falsePositives: [],
			falseNegatives: ["fallo nuevamente el loggin"],
			errorPatterns: ["loggin typo"],
			recommendedRules: ["Si loggin/login falla nuevamente → bug/auth/high"],
		},
		misclassifiedExamples: [
			{
				originalText: "fallo nuevamente el loggin",
				category: "bug",
				intent: "bug_report",
				guardRisk: "high",
			},
		],
		suggestedRuleUpdates: ["Si loggin/login falla nuevamente → bug/auth/high"],
		suggestedSkillUpdates: ["Crear skill security-auth-review para login"],
		suggestedMemoryItems: ["Loggin typo significa login/auth failure"],
		suggestedAgentTasks: ["Revisar seguridad auth/login"],
		noiseToIgnore: [],
		openQuestions: [],
	};
	const path = join(
		paths.reportsPath,
		"semantic-compaction-draft-20260525-000000.json",
	);
	writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
	return { path, draft, prompt: "deterministic e2e prompt" };
}

function profiles(): AgentProfile[] {
	return [
		{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		{
			id: "skill-review",
			label: "Skill Review Lab",
			provider: "pi",
			piArgs: [],
		},
		{ id: "general", label: "General Lab", provider: "pi", piArgs: [] },
	];
}

function validAgentLabReport(prompt: string): string {
	const requestId =
		/requestId debe ser ([^;]+);/u.exec(prompt)?.[1] ?? "request-skill";
	const specialty =
		/specialty debe ser ([^.]+)\./u.exec(prompt)?.[1] ?? "skill_review";
	return JSON.stringify({
		id: "report-e2e",
		requestId,
		projectId: "pi-telegram-bridge",
		specialty,
		status: "completed",
		summary: "Skill draft revisado sin aplicar cambios.",
		qualityFindings: [],
		safetyFindings: [
			{
				title: "Agregar ejemplo negativo al draft",
				description: "El draft debería pedir prueba de login inválido.",
				evidence: "reports/skill-draft revisado en sandbox",
				severity: "medium",
				confidence: "high",
				category: "skill_review",
				affectedFiles: ["reports/skill-draft-20260525-000200.json"],
				affectedFlows: ["login"],
				relatedRules: ["Nada crítico se aplica sin confirmación humana."],
				controlPillars: ["quality", "learning"],
			},
		],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: ["Ejecutar skill-check sobre el draft"],
		testsExecuted: [],
		evidence: ["Revisión de JSON skill draft"],
		recommendations: [
			{
				title: "Mejorar draft antes de aplicar",
				description: "Agregar caso negativo de auth/login.",
				rationale: "Evita que una skill incompleta se aplique al repo real.",
				expectedBenefit: "learning",
				risk: "low",
				requiresHumanApproval: true,
				suggestedNextStep: "Revisar consolidación AgentLab.",
			},
		],
		proposedSupervisorActions: [],
		suggestedSkillUpdates: ["Mejorar draft security-auth-review"],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: ["Revisar draft security-auth-review"],
		confidence: "high",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T00:03:00.000Z",
	});
}

function fakeRouter(
	paths: Paths,
	options: { mutateRealRepo?: boolean } = {},
): AgentRouter {
	return new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles: profiles(),
		defaultProjectId: "pi-telegram-bridge",
		defaultCwd: paths.projectPath,
		workspaceRoot: paths.workspaceRoot,
		workspaceMode: "clone",
		createSession: (sessionOptions) =>
			new FakeSession(
				sessionOptions.cwd,
				validAgentLabReport,
				options.mutateRealRepo
					? () =>
							writeFileSync(
								join(paths.projectPath, "agentlab-intruder.txt"),
								"mutation from fake lab\n",
								"utf8",
							)
					: undefined,
			),
		syncWorkspace: (_workspaceRoot, _projectId, _targetCwd, profileId) => {
			const workspace = join(paths.workspaceRoot, "workspaces", profileId);
			mkdirSync(workspace, { recursive: true });
			return workspace;
		},
	});
}

function reportFiles(reportsPath: string, prefix: string): string[] {
	return readdirSync(reportsPath).filter((file) => file.startsWith(prefix));
}

test("Idu-pi supervisor cycle is accepted end-to-end without unsafe apply", async () => {
	const paths = tempPaths();
	try {
		initGitProject(paths.projectPath);
		configureIduSessionStore({
			filePath: join(paths.reportsPath, "idu-session-state.json"),
		});
		deactivateIduSession("pi-telegram-bridge");

		const activated = activateIduSession("pi-telegram-bridge");
		assert.equal(activated.active, true);
		assert.equal(shouldUseAutomaticGuardrails("pi-telegram-bridge"), true);
		assert.equal(getIduSessionStatus("pi-telegram-bridge").active, true);
		assert.equal(
			existsSync(join(paths.reportsPath, "idu-session-state.json")),
			true,
		);

		const queue = new StructuredTaskQueue({
			filePath: join(paths.reportsPath, "tasks.jsonl"),
		});
		const humanText = "fallo nuevamente el loggin";
		const preflight = analyzeProjectPreflight(humanText, {
			connection: connection(paths.projectPath),
		});
		const task = queue.enqueueTask(
			structuredTaskInputForText(humanText, {
				source: "e2e",
				projectId: "pi-telegram-bridge",
			}),
		);
		const guarded = queue.markNeedsConfirmation(task.id, {
			guardRisk: preflight.risk,
			guardReason: preflight.recommendedNext,
		});
		assert.equal(guarded?.intentKind, "bug_report");
		assert.equal(guarded?.category, "bug");
		assert.equal(preflight.risk, "high");
		assert.equal(guarded?.guardStatus, "needs_confirmation");
		assert.equal(queue.listTasks().length, 1);

		let auditRuns = 0;
		let checkpointUpdates = 0;
		let memoryWrites = 0;
		const repository = {
			getSemanticAuditStats: () =>
				stats({ userSignalCount: 100, criticalFindingCount: 1 }),
			getSemanticAuditCheckpoint: () => checkpoint(),
			createSemanticAuditRun: () => {
				auditRuns += 1;
			},
			updateSemanticAuditCheckpoint: () => {
				checkpointUpdates += 1;
			},
			recordSemanticMemoryItem: () => {
				memoryWrites += 1;
			},
		};
		const supervisorResult = runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: paths.projectPath,
			workspaceRoot: paths.workspaceRoot,
			trigger: "manual",
			options: {
				allowSemanticDraft: true,
				allowAgentTaskPlan: false,
				dryRun: false,
			},
			repository,
			queue,
			isIduActive: () => true,
			saveSemanticCompactionDraft: () => semanticDraft(paths),
		});
		assert.equal(supervisorResult.status, "completed");
		assert.equal(auditRuns, 1);
		assert.equal(checkpointUpdates, 1);
		assert.equal(memoryWrites, 0);
		assert.equal(
			supervisorResult.steps.find(
				(step) => step.name === "semantic_compaction_draft",
			)?.status,
			"completed",
		);
		assert.match(
			formatIduSupervisorLoopResult(supervisorResult),
			/No ejecuté AgentLabs/u,
		);
		assert.equal(supervisorResult.safety.agentLabsExecuted, false);
		assert.equal(supervisorResult.safety.rulesApplied, false);
		assert.equal(supervisorResult.safety.memoryDeleted, false);
		assert.equal(supervisorResult.safety.projectCoreModified, false);

		const draftPath = join(
			paths.reportsPath,
			"semantic-compaction-draft-20260525-000000.json",
		);
		assert.equal(existsSync(draftPath), true);
		const draftJson = JSON.parse(readFileSync(draftPath, "utf8")) as {
			warning: string;
			suggestedRuleUpdates: string[];
			classifierQualityReview: { falseNegatives: string[] };
		};
		assert.equal(draftJson.warning, "Borrador IA. No es fuente de verdad.");
		assert.equal(draftJson.suggestedRuleUpdates.length > 0, true);
		assert.equal(
			draftJson.classifierQualityReview.falseNegatives.length > 0,
			true,
		);

		const supervisorProposals = createSupervisorImprovementProposals(
			"latest",
			paths.reportsPath,
			{ now: () => new Date("2026-05-25T00:01:00.000Z") },
		);
		assert.equal(existsSync(supervisorProposals.path ?? ""), true);
		assert.equal(
			supervisorProposals.created.every(
				(proposal) => proposal.status === "proposed",
			),
			true,
		);
		const intentRule = findProposal(
			supervisorProposals.created,
			"intent_rule_update",
		);
		approveSupervisorImprovement("latest", intentRule.id, paths.reportsPath, {
			source: "cli",
			now: () => new Date("2026-05-25T00:01:30.000Z"),
		});
		const learning = applySupervisorLearningRules("latest", paths.reportsPath, {
			now: () => new Date("2026-05-25T00:01:45.000Z"),
		});
		assert.equal(
			existsSync(join(paths.reportsPath, "supervisor-learning-rules.json")),
			true,
		);
		assert.equal(learning.created.length, 1);
		assert.equal(learning.created[0]?.enabled, true);
		assert.equal(
			getSupervisorLearningRulesStatus(paths.reportsPath).enabledCount,
			1,
		);

		const skillProposals = createSkillImprovementProposals(
			"latest",
			paths.reportsPath,
			{
				workspaceRoot: paths.projectPath,
				dbPath: join(paths.reportsPath, "lab.db"),
				now: () => new Date("2026-05-25T00:02:00.000Z"),
			},
		);
		assert.equal(existsSync(skillProposals.path ?? ""), true);
		const createSkill = findSkillProposal(
			skillProposals.created,
			"create_skill",
		);
		approveSkillImprovementProposal(
			"latest",
			createSkill.id,
			paths.reportsPath,
			{ source: "cli", now: () => new Date("2026-05-25T00:02:30.000Z") },
		);
		const skillDraft = createSkillDraftsFromApprovedProposals(
			"latest",
			paths.reportsPath,
			{ now: () => new Date("2026-05-25T00:02:45.000Z") },
		);
		assert.equal(existsSync(skillDraft.path ?? ""), true);
		assert.equal(
			skillDraft.created.some((draft) => draft.action === "create_skill"),
			true,
		);
		assert.equal(reportFiles(paths.reportsPath, "skill-draft-").length, 1);
		assert.equal(existsSync(join(paths.projectPath, ".agents")), false);
		assert.equal(existsSync(join(paths.projectPath, ".atl")), false);
		assert.equal(
			existsSync(
				join(
					paths.projectPath,
					".agents",
					"skills",
					createSkill.skillName,
					"SKILL.md",
				),
			),
			false,
		);

		const agentLabRequest = createAgentLabReviewRequests({
			source: "skill_draft",
			reportsPath: paths.reportsPath,
			projectId: "pi-telegram-bridge",
			projectPath: paths.projectPath,
			skillDraftPathOrLatest: "latest",
			now: () => new Date("2026-05-25T00:03:00.000Z"),
		});
		assert.equal(existsSync(agentLabRequest.path ?? ""), true);
		assert.equal(agentLabRequest.requests[0]?.specialty, "skill_review");
		assert.equal(
			agentLabRequest.requests[0]?.sourceSkillDraftPath?.endsWith(".json"),
			true,
		);
		assert.equal(
			agentLabRequest.requests[0]?.forbiddenActions.some((action) =>
				/repo real/iu.test(action),
			),
			true,
		);
		assert.equal(
			agentLabRequest.requests[0]?.forbiddenActions.some((action) =>
				/commit/iu.test(action),
			),
			true,
		);
		assert.equal(
			agentLabRequest.requests[0]?.forbiddenActions.some((action) =>
				/push/iu.test(action),
			),
			true,
		);

		const cleanRun = await runAgentLabReviewRequestFile({
			pathOrLatest: "latest",
			reportsPath: paths.reportsPath,
			projectId: "pi-telegram-bridge",
			projectPath: paths.projectPath,
			router: fakeRouter(paths),
			now: () => new Date("2026-05-25T00:04:00.000Z"),
		});
		assert.equal(existsSync(cleanRun.path ?? ""), true);
		assert.equal(cleanRun.runs[0]?.status, "completed");
		assert.equal(cleanRun.runs[0]?.contractValidation.valid, true);
		assert.equal(git(paths.projectPath, ["status", "--porcelain=v1"]), "");

		const mutatingRun = await runAgentLabReviewRequest({
			request: agentLabRequest.requests[0]!,
			projectPath: paths.projectPath,
			router: fakeRouter(paths, { mutateRealRepo: true }),
			now: () => new Date("2026-05-25T00:04:30.000Z"),
		});
		assert.equal(mutatingRun.status, "security_violation");
		assert.deepEqual(mutatingRun.realRepoChangedFiles, [
			"agentlab-intruder.txt",
		]);
		rmSync(join(paths.projectPath, "agentlab-intruder.txt"), { force: true });
		assert.equal(git(paths.projectPath, ["status", "--porcelain=v1"]), "");

		const consolidation = consolidateAgentLabReviewRun(
			"latest",
			paths.reportsPath,
			{ now: () => new Date("2026-05-25T00:05:00.000Z") },
		);
		assert.equal(consolidation.valid, true);
		assert.equal(existsSync(consolidation.path ?? ""), true);
		assert.equal(consolidation.consolidatedFindings.length > 0, true);
		assert.equal(consolidation.skillImprovementCandidates.length > 0, true);
		assert.equal(consolidation.agentTaskCandidates.length > 0, true);
		assert.equal(
			consolidation.warning,
			"Consolidación AgentLab. No aplica cambios.",
		);

		const inactive = runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: paths.projectPath,
			workspaceRoot: paths.workspaceRoot,
			trigger: "manual",
			options: {
				allowSemanticDraft: false,
				allowAgentTaskPlan: false,
				dryRun: false,
			},
			repository,
			queue,
			isIduActive: () => false,
		});
		deactivateIduSession("pi-telegram-bridge");
		assert.equal(inactive.status, "skipped");
		assert.equal(inactive.reason, "idu_inactive");
		assert.equal(shouldUseAutomaticGuardrails("pi-telegram-bridge"), false);

		assert.equal(
			existsSync(join(paths.projectPath, "config", "project-core.json")),
			false,
		);
		assert.equal(
			existsSync(
				join(paths.projectPath, "config", "project-constitution.json"),
			),
			false,
		);
		assert.equal(
			existsSync(join(paths.projectPath, "config", "project-blueprint.json")),
			false,
		);
		assert.equal(
			existsSync(join(paths.projectPath, "config", "project-flows.json")),
			false,
		);
		assert.equal(existsSync(join(paths.projectPath, "src", "lab.ts")), false);
		assert.equal(
			existsSync(join(paths.projectPath, "src", "agent-router.ts")),
			false,
		);
		assert.equal(
			existsSync(
				join(
					paths.workspaceRoot,
					"agentlabs",
					"reports",
					"consolidated-current.json",
				),
			),
			true,
		);
	} finally {
		rmSync(paths.root, { recursive: true, force: true });
	}
});

function findProposal(
	proposals: SupervisorImprovementProposal[],
	type: SupervisorImprovementProposal["type"],
): SupervisorImprovementProposal {
	const proposal = proposals.find((candidate) => candidate.type === type);
	assert.ok(proposal, `missing supervisor proposal ${type}`);
	return proposal;
}

function findSkillProposal(
	proposals: SkillImprovementProposal[],
	type: SkillImprovementProposal["type"],
): SkillImprovementProposal {
	const proposal = proposals.find((candidate) => candidate.type === type);
	assert.ok(proposal, `missing skill proposal ${type}`);
	return proposal;
}
