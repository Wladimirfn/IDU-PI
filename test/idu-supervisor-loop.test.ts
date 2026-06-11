import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	formatIduSupervisorLoopResult,
	runIduSupervisorLoop,
	type IduSupervisorLoopResult,
} from "../src/idu-supervisor-loop.js";
import type {
	SemanticAuditCheckpoint,
	SemanticAuditStats,
} from "../src/semantic-audit.js";
import type { SaveSemanticCompactionDraftResult } from "../src/semantic-compaction.js";
import type {
	SemanticAgentTaskCreationResult,
	SemanticAgentTaskPlan,
} from "../src/semantic-agent-tasks.js";
import { StructuredTaskQueue } from "../src/structured-task-queue.js";

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

function fakeDraft(root: string): SaveSemanticCompactionDraftResult {
	return {
		path: join(
			root,
			"reports",
			"semantic-compaction-draft-20260102-030405.json",
		),
		prompt: "safe prompt",
		draft: {
			generatedAt: "2026-01-02T03:04:05.000Z",
			projectId: "pi-telegram-bridge",
			warning: "Borrador IA. No es fuente de verdad.",
			sourceAuditRunIds: ["audit-1"],
			inputSummary: { criticalFindings: 1 },
			preservedRules: ["No ejecutar AgentLabs"],
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
				recommendedRules: [],
			},
			misclassifiedExamples: [],
			suggestedRuleUpdates: [],
			suggestedSkillUpdates: [],
			suggestedMemoryItems: [],
			suggestedAgentTasks: ["Revisar seguridad auth/login"],
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function fakePlan(count = 2): SemanticAgentTaskPlan {
	return {
		draftPath: "semantic-compaction-draft-20260102-030405.json",
		draftName: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		validDraft: true,
		errors: [],
		candidates: Array.from({ length: count }, (_, index) => ({
			type: index % 2 === 0 ? "security" : "database",
			category: "review",
			title: `review-${index + 1}`,
			priority: 5,
			reason: "semantic finding",
			recommendation: "review manually",
			evidence: "evidence",
			requiresHumanApproval: true,
			dedupeKey: `domain:${index + 1}`,
			queuePriority: 1,
			text: `Revisión SG5 semantic-audit — task ${index + 1}\nDedupe: domain:${index + 1}`,
		})),
	};
}

function runWithDeps(
	options: {
		active?: boolean;
		stats?: SemanticAuditStats;
		checkpoint?: SemanticAuditCheckpoint;
		allowSemanticDraft?: boolean;
		allowAgentTaskPlan?: boolean;
		maxCreatedTasks?: number;
		planCount?: number;
		mode?: "execute" | "plan";
	} = {},
): { result: IduSupervisorLoopResult; calls: Record<string, number> } {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-loop-"));
	const calls = { auditRun: 0, checkpoint: 0, draft: 0, plan: 0, createTasks: 0 };
	try {
		const repository = {
			getSemanticAuditStats: () => options.stats ?? stats(),
			getSemanticAuditCheckpoint: () => options.checkpoint ?? checkpoint(),
			createSemanticAuditRun: () => {
				calls.auditRun += 1;
			},
			updateSemanticAuditCheckpoint: () => {
				calls.checkpoint += 1;
			},
		};
		const queue = new StructuredTaskQueue({
			filePath: join(root, "reports", "tasks.jsonl"),
		});
		const result = runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			trigger: "manual",
			options: {
				allowSemanticDraft: options.allowSemanticDraft ?? false,
				allowAgentTaskPlan: options.allowAgentTaskPlan ?? false,
				dryRun: false,
				mode: options.mode,
				maxCreatedTasks: options.maxCreatedTasks,
			},
			repository,
			queue,
			isIduActive: () => options.active ?? true,
			saveSemanticCompactionDraft: () => {
				calls.draft += 1;
				return fakeDraft(root);
			},
			buildSemanticAgentTaskPlan: () => {
				calls.plan += 1;
				return fakePlan(options.planCount ?? 2);
			},
			createSemanticAgentTasks: (input) => {
				calls.createTasks += 1;
				const plan = fakePlan(options.planCount ?? 2);
				const created = plan.candidates
					.slice(0, input.maxCreatedTasks ?? 7)
					.map((candidate, index) => ({
						id: `task-${index + 1}`,
						text: candidate.text,
						category: "review",
						priority: candidate.queuePriority,
						status: "pending" as const,
						createdAt: "2026-01-02T03:04:05.000Z",
						updatedAt: "2026-01-02T03:04:05.000Z",
						emotion: "neutral",
						source: "semantic-audit",
						projectId: "pi-telegram-bridge",
					}));
				return {
					plan,
					created,
					skippedDuplicates: [],
				} satisfies SemanticAgentTaskCreationResult;
			},
		});
		return { result, calls };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("loop skipped si Idu-pi inactive", () => {
	const { result, calls } = runWithDeps({ active: false });

	assert.equal(result.status, "skipped");
	assert.equal(result.reason, "idu_inactive");
	assert.equal(calls.auditRun, 0);
	assert.equal(calls.draft, 0);
	assert.equal(calls.createTasks, 0);
});

test("loop ejecuta status si active sin umbral", () => {
	const { result } = runWithDeps({
		active: true,
		stats: stats({ userSignalCount: 26 }),
	});

	assert.equal(result.status, "completed");
	assert.equal(
		result.steps.find((step) => step.name === "session_check")?.status,
		"active",
	);
	assert.equal(
		result.steps.find((step) => step.name === "semantic_audit_status")?.status,
		"completed",
	);
	assert.equal(
		result.steps.find((step) => step.name === "semantic_audit_run")?.status,
		"skipped",
	);
	assert.match(formatIduSupervisorLoopResult(result), /No se alcanzó umbral/u);
});

test("loop crea semantic audit si umbral alcanzado", () => {
	const { result, calls } = runWithDeps({
		stats: stats({ userSignalCount: 100 }),
	});

	assert.equal(calls.auditRun, 1);
	assert.equal(
		result.steps.find((step) => step.name === "semantic_audit_run")?.status,
		"completed",
	);
});

test("loop no crea draft si allowSemanticDraft false", () => {
	const { calls } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: false,
	});

	assert.equal(calls.draft, 0);
});

test("loop crea draft si allowSemanticDraft true y critical", () => {
	const { result, calls } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
	});

	assert.equal(calls.draft, 1);
	assert.equal(
		result.steps.find((step) => step.name === "semantic_compaction_draft")
			?.status,
		"completed",
	);
});

test("loop no crea AgentLab tasks si allowAgentTaskPlan false", () => {
	const { calls } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: false,
	});

	assert.equal(calls.plan, 0);
	assert.equal(calls.createTasks, 0);
});

test("loop prepara y crea agent task plan si allowAgentTaskPlan true", () => {
	const { result, calls } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: true,
	});

	assert.equal(calls.plan, 1);
	assert.equal(calls.createTasks, 1);
	assert.equal(result.createdTasks, 2);
});

test("loop no crea agent tasks en threshold minor sin draft fresco", () => {
	const { result, calls } = runWithDeps({
		stats: stats({ userSignalCount: 100 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: true,
	});

	assert.equal(calls.draft, 0);
	assert.equal(calls.plan, 0);
	assert.equal(calls.createTasks, 0);
	assert.equal(result.createdTasks, 0);
	assert.equal(
		result.steps.find((step) => step.name === "semantic_agent_tasks")?.status,
		"skipped",
	);
});

test("loop respeta maxCreatedTasks", () => {
	const { result } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: true,
		maxCreatedTasks: 1,
		planCount: 4,
	});

	assert.equal(result.createdTasks, 1);
});

test("loop plan mode observa y propone sin escribir aunque flags estén activos", () => {
	const { result, calls } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: true,
		mode: "plan",
	});

	assert.equal(result.trigger, "manual");
	assert.equal(calls.auditRun, 0);
	assert.equal(calls.checkpoint, 0);
	assert.equal(calls.draft, 0);
	assert.equal(calls.plan, 0);
	assert.equal(calls.createTasks, 0);
	assert.equal(result.createdTasks, 0);
	assert.match(result.summary, /advisory-only/u);
	assert.match(
		result.steps.find((step) => step.name === "semantic_audit_run")?.summary ??
			"",
		/plan mode/u,
	);
});

test("loop nunca ejecuta AgentLabs ni borra datos", () => {
	const { result } = runWithDeps({
		stats: stats({ criticalFindingCount: 1 }),
		allowSemanticDraft: true,
		allowAgentTaskPlan: true,
	});

	assert.equal(result.safety.agentLabsExecuted, false);
	assert.equal(result.safety.rulesApplied, false);
	assert.equal(result.safety.memoryDeleted, false);
	assert.equal(result.safety.projectCoreModified, false);
	assert.match(formatIduSupervisorLoopResult(result), /No ejecuté AgentLabs/u);
	assert.match(formatIduSupervisorLoopResult(result), /no borré memoria/u);
});

// A2-T: canonical labDbPath tests (Spec A3-S1)

test("A3-S1: loop passes canonical labDbPath to saveSemanticCompactionDraft (not reports/lab.db)", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-loop-canonical-"));
	// canonical labDbPath is stateRoot/lab.db (projects/pi-telegram-bridge/lab.db)
	const canonicalLabDbPath = join(root, "projects", "pi-telegram-bridge", "lab.db");
	const capturedDbPaths: string[] = [];

	try {
		const repository = {
			getSemanticAuditStats: () => stats({ criticalFindingCount: 1 }),
			getSemanticAuditCheckpoint: () => checkpoint(),
			createSemanticAuditRun: () => {},
			updateSemanticAuditCheckpoint: () => {},
		};
		const queue = new StructuredTaskQueue({
			filePath: join(root, "projects", "pi-telegram-bridge", "tasks.jsonl"),
		});

		runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			labDbPath: canonicalLabDbPath,
			trigger: "manual",
			options: {
				allowSemanticDraft: true,
				allowAgentTaskPlan: false,
				dryRun: false,
			},
			repository,
			queue,
			isIduActive: () => true,
			saveSemanticCompactionDraft: (input) => {
				capturedDbPaths.push(input.dbPath);
				return fakeDraft(root);
			},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}

	assert.equal(capturedDbPaths.length, 1, "saveSemanticCompactionDraft should have been called once");
	assert.equal(capturedDbPaths[0], canonicalLabDbPath,
		"dbPath passed to saveSemanticCompactionDraft must be the canonical labDbPath, not reports/lab.db");
	assert.ok(
		!capturedDbPaths[0]?.includes("reports"),
		`dbPath must not traverse reports/: got ${capturedDbPaths[0]}`,
	);
});

test("PR-0: loop honors explicit reportsPath when labDbPath is legacy reports/lab.db", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-loop-legacy-"));
	const legacyReportsPath = join(root, "reports");
	const legacyLabDbPath = join(legacyReportsPath, "lab.db");
	const capturedReportsPaths: string[] = [];

	try {
		const repository = {
			getSemanticAuditStats: () => stats({ criticalFindingCount: 1 }),
			getSemanticAuditCheckpoint: () => checkpoint(),
			createSemanticAuditRun: () => {},
			updateSemanticAuditCheckpoint: () => {},
		};
		const queue = new StructuredTaskQueue({
			filePath: join(legacyReportsPath, "tasks.jsonl"),
		});

		runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			labDbPath: legacyLabDbPath,
			reportsPath: legacyReportsPath,
			trigger: "manual",
			options: {
				allowSemanticDraft: true,
				allowAgentTaskPlan: false,
				dryRun: false,
			},
			repository,
			queue,
			isIduActive: () => true,
			saveSemanticCompactionDraft: (input) => {
				capturedReportsPaths.push(input.reportsPath);
				return fakeDraft(root);
			},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}

	assert.deepEqual(capturedReportsPaths, [legacyReportsPath]);
	assert.notEqual(capturedReportsPaths[0], join(legacyReportsPath, "reports"));
});

test("A3-S1: loop uses canonical reportsPath (stateRoot/reports) for buildSemanticAgentTaskPlan", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-loop-canonical-"));
	const canonicalLabDbPath = join(root, "projects", "pi-telegram-bridge", "lab.db");
	// canonical reportsPath for semantic compaction drafts: stateRoot/reports
	const canonicalStateRoot = dirname(canonicalLabDbPath);
	const canonicalReportsPath = join(canonicalStateRoot, "reports");
	const capturedReportsPaths: string[] = [];

	try {
		const repository = {
			getSemanticAuditStats: () => stats({ criticalFindingCount: 1 }),
			getSemanticAuditCheckpoint: () => checkpoint(),
			createSemanticAuditRun: () => {},
			updateSemanticAuditCheckpoint: () => {},
		};
		const queue = new StructuredTaskQueue({
			filePath: join(root, "projects", "pi-telegram-bridge", "tasks.jsonl"),
		});
		const draftPath = join(canonicalReportsPath, "semantic-compaction-draft-20260102-030405.json");

		runIduSupervisorLoop({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			labDbPath: canonicalLabDbPath,
			trigger: "manual",
			options: {
				allowSemanticDraft: true,
				allowAgentTaskPlan: true,
				dryRun: false,
			},
			repository,
			queue,
			isIduActive: () => true,
			saveSemanticCompactionDraft: (input) => {
				capturedReportsPaths.push(input.reportsPath);
				return {
					path: draftPath,
					prompt: "safe prompt",
					draft: fakeDraft(root).draft,
				};
			},
			buildSemanticAgentTaskPlan: (pathOrLatest, reportsPath) => {
				capturedReportsPaths.push(`plan:${reportsPath}`);
				return fakePlan(0);
			},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}

	// saveSemanticCompactionDraft reportsPath must use stateRoot/reports, not workspaceRoot/reports
	const draftReportsPath = capturedReportsPaths.find(p => !p.startsWith("plan:"));
	assert.ok(draftReportsPath, "saveSemanticCompactionDraft must have been called");
	assert.equal(draftReportsPath, canonicalReportsPath,
		`reportsPath to draft must be stateRoot/reports (${canonicalReportsPath}), not workspaceRoot/reports`);
	assert.ok(
		!draftReportsPath?.startsWith(root + "/reports") && !draftReportsPath?.startsWith(root + "\\reports"),
		`reportsPath must not be workspaceRoot/reports directly: got ${draftReportsPath}`,
	);
});
