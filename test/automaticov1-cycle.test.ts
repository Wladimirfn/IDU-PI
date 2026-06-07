import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	runAutomaticov1AdvisoryCycle,
	type Automaticov1CycleInput,
} from "../src/automaticov1-cycle.js";
import type { IduUsageEvent } from "../src/usage-events.js";
import type { StructuredTask } from "../src/structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "../src/supervisor-self-maintenance-advisory.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-automaticov1-cycle-"));
}

function task(id: string): StructuredTask {
	return {
		id,
		text: "backlog item",
		category: "maintenance",
		priority: 3,
		status: "pending",
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		projectId: "idu-pi",
	};
}

function backlogSignal(id: string): SupervisorSelfMaintenanceSignal {
	return {
		id,
		category: "backlog_pressure",
		severity: "warning",
		confidence: 0.8,
		evidenceRefs: [`signal:${id}`],
		summary: `Backlog signal ${id}`,
		recommendedActions: ["Create a bounded maintenance task."],
	};
}

function securitySignal(): SupervisorSelfMaintenanceSignal {
	return {
		id: "security-gap",
		category: "security_review_pressure",
		severity: "high",
		confidence: 0.9,
		evidenceRefs: ["security:gap"],
		summary: "Security review pressure requires human escalation.",
		recommendedActions: ["Ask the human/orchestrator before creating tasks."],
	};
}

function input(
	stateRoot: string,
	overrides: Partial<Automaticov1CycleInput> = {},
): Automaticov1CycleInput {
	return {
		projectId: "idu-pi",
		projectPath: "C:/repo",
		stateRoot,
		iduActive: true,
		now: new Date("2026-06-05T00:00:00.000Z"),
		loadPlan: () => ({
			status: "approved",
			inferredObjective: "Idu-pi supervises the orchestrator with evidence.",
			executiveSummary: "Supervisor/auditor summary",
			criticalRisks: [],
		}),
		loadTasks: () => [],
		loadExecutionReadiness: () => ({
			version: 1,
			status: "execution_ready",
			coreStatus: "confirmed",
			constitutionStatus: "active",
			taskTreeStatus: "ready",
			mcpContextPackStaleness: "fresh",
			blockingReasons: [],
		}),
		loadSelfMaintenanceSignals: () => [],
		createTask: () => ({ id: "created-task" }),
		...overrides,
	};
}

test("automaticov1 cycle skips optional engines when Idu-pi is inactive", async () => {
	const stateRoot = tempRoot();
	let bibliotecarioCalls = 0;
	let externalCalls = 0;
	let skillCalls = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			iduActive: false,
			buildBibliotecarioSnapshot: () => {
				bibliotecarioCalls += 1;
				return { fetchAllowed: false };
			},
			buildExternalIntelligenceReport: async () => {
				externalCalls += 1;
				return { signals: [] };
			},
			createSkillDraftFromLessons: () => {
				skillCalls += 1;
				return { allowedToProceed: false };
			},
		}),
	);

	assert.equal(result.status, "skipped_inactive");
	assert.equal(result.alertScheduledTick.status, "skipped_inactive");
	assert.equal(bibliotecarioCalls, 0);
	assert.equal(externalCalls, 0);
	assert.equal(skillCalls, 0);
	assert.equal(result.allowedToProceed, false);
});

test("automaticov1 cycle is advisory and no-fetch/no-skill-writes by default", async () => {
	const stateRoot = tempRoot();
	let externalCalls = 0;
	let skillCalls = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			loadTasks: () => [task("t1"), task("t2"), task("t3"), task("t4")],
			buildSupervisorCronPlan: () => ({
				advisoryOnly: true,
				writesAllowed: false,
			}),
			buildBibliotecarioSnapshot: () => ({
				fetchAllowed: false,
				rawContentIncluded: false,
				contractPromotionAllowed: false,
			}),
			buildExternalIntelligenceReport: async () => {
				externalCalls += 1;
				return { signals: [] };
			},
			createSkillDraftFromLessons: () => {
				skillCalls += 1;
				return { allowedToProceed: false };
			},
		}),
	);

	assert.equal(result.status, "ran");
	assert.equal(result.authority, "advisory");
	assert.equal(result.allowedToProceed, false);
	assert.equal(result.repoWritesAllowed, false);
	assert.equal(result.externalFetchExecuted, false);
	assert.equal(result.skillProposalExecuted, false);
	assert.equal(externalCalls, 0);
	assert.equal(skillCalls, 0);
	assert.equal(result.alertScheduledTick.tasksCreated.length, 0);
	assert.ok(result.bibliotecarioSnapshot);
	assert.ok(result.supervisorCronPlan);
});

test("automaticov1 cycle injects stale MCP context pack refresh advisory", async () => {
	const stateRoot = tempRoot();
	const usageEvents: IduUsageEvent[] = [
		{
			version: 1,
			id: "stale-context-pack",
			timestamp: "2026-06-04T23:45:00.000Z",
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_supervisor_context_pack",
		},
		{
			version: 1,
			id: "recent-cli",
			timestamp: "2026-06-04T23:59:00.000Z",
			projectId: "idu-pi",
			surface: "cli",
			action: "automaticov1",
		},
	];
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, { usageEvents }),
	);

	assert.equal(result.status, "ran");
	assert.equal(result.allowedToProceed, false);
	assert.ok(
		result.evidenceRefs.includes("automaticov1:mcp-context-pack:stale"),
	);
	assert.ok(
		result.nextActions.some((action) =>
			/refresh idu_supervisor_context_pack/u.test(action),
		),
	);
	assert.ok(
		result.safeNotes.some((note) =>
			/does not auto-run supervisor context/u.test(note),
		),
	);
});

test("automaticov1 cycle blocks when execution readiness supplier is missing", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadExecutionReadiness: undefined,
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "blocked_readiness");
	assert.equal(created, 0);
	assert.equal(result.executionReadiness?.status, "missing_task_tree");
	assert.ok(
		result.evidenceRefs.includes("automaticov1:readiness:missing_task_tree"),
	);
});

test("automaticov1 cycle blocks when execution readiness is not satisfied", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadExecutionReadiness: () => ({
				version: 1,
				status: "not_ready",
				coreStatus: "draft",
				constitutionStatus: "draft",
				taskTreeStatus: "ready",
				mcpContextPackStaleness: "fresh",
				blockingReasons: [
					"Project Core must be confirmed; current=draft.",
					"Constitution must be active; current=draft.",
				],
			}),
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "blocked_readiness");
	assert.equal(created, 0);
	assert.equal(result.executionReadiness?.status, "not_ready");
	assert.ok(result.evidenceRefs.includes("automaticov1:readiness:not_ready"));
	assert.ok(
		result.nextActions.some((action) =>
			/execution readiness blockers/u.test(action),
		),
	);
});

test("automaticov1 cycle blocks when Master Plan task tree is not ready", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadTaskTree: () => ({
				version: 1,
				status: "empty",
				projectId: "idu-pi",
				objective: "Idu-pi supervises execution",
				hitos: [],
				blockingReasons: ["Approved Master Plan has no executable task tree."],
			}),
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "blocked_task_tree");
	assert.equal(created, 0);
	assert.equal(result.taskTree?.status, "empty");
	assert.ok(result.evidenceRefs.includes("automaticov1:task-tree:empty"));
	assert.ok(
		result.nextActions.some((action) => /Master Plan task tree/u.test(action)),
	);
});

test("automaticov1 cycle blocks when hard supervisor friction requires systemic repair", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => [
				{
					id: "supervisor-activity-pressure",
					category: "supervisor_activity_pressure",
					severity: "high",
					confidence: 0.9,
					evidenceRefs: [
						"idu-usage-events:failures=5",
						"idu-usage-events:notAllowed=40",
						"idu-usage-events:requiresHuman=28",
					],
					summary: "Supervisor friction is high",
					recommendedActions: [
						"Create systemic improvement task before continuing automation.",
					],
				},
			],
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "blocked_systemic_maintenance");
	assert.equal(created, 0);
	assert.ok(
		result.evidenceRefs.includes("automaticov1:systemic-maintenance:block"),
	);
	assert.ok(
		result.nextActions.some((action) =>
			/systemic improvement task/u.test(action),
		),
	);
});

for (const hardEvidenceRef of [
	"structured-task-queue:open=1",
	"structured-task-queue:stale=1",
	"structured-task-queue:failed=1",
	"idu-usage-events:failures=1",
	"agentlab-review-requests:stale=1",
]) {
	test(`automaticov1 cycle blocks supervisor pressure with ${hardEvidenceRef}`, async () => {
		const stateRoot = tempRoot();
		const result = await runAutomaticov1AdvisoryCycle(
			input(stateRoot, {
				allowTaskCreation: true,
				loadSelfMaintenanceSignals: () => [
					{
						id: "supervisor-activity-pressure",
						category: "supervisor_activity_pressure",
						severity: "high",
						confidence: 0.9,
						evidenceRefs: [hardEvidenceRef],
						summary: "Supervisor pressure has hard evidence",
						recommendedActions: ["Repair hard supervisor pressure."],
					},
				],
			}),
		);

		assert.equal(result.status, "blocked_systemic_maintenance");
		assert.ok(
			result.evidenceRefs.includes("automaticov1:systemic-maintenance:block"),
		);
	});
}

for (const hardSignal of [
	{
		category: "repeated_failure_patterns" as const,
		evidenceRef: "structured-task-queue:postflight=3",
	},
	{
		category: "external_security_coverage_gap" as const,
		evidenceRef: "external-intelligence:npm-security-coverage=missing",
	},
]) {
	test(`automaticov1 cycle preserves hard block for ${hardSignal.category}`, async () => {
		const stateRoot = tempRoot();
		const result = await runAutomaticov1AdvisoryCycle(
			input(stateRoot, {
				allowTaskCreation: true,
				loadSelfMaintenanceSignals: () => [
					{
						id: hardSignal.category,
						category: hardSignal.category,
						severity: "high",
						confidence: 0.9,
						evidenceRefs: [hardSignal.evidenceRef],
						summary: "Hard systemic pressure",
						recommendedActions: ["Resolve hard systemic pressure."],
					},
				],
			}),
		);

		assert.equal(result.status, "blocked_systemic_maintenance");
		assert.ok(
			result.evidenceRefs.includes("automaticov1:systemic-maintenance:block"),
		);
	});
}

test("automaticov1 cycle does not block on advisory-only supervisor pressure", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadTasks: () => [],
			loadSelfMaintenanceSignals: () => [
				{
					id: "supervisor-activity-pressure",
					category: "supervisor_activity_pressure",
					severity: "high",
					confidence: 0.85,
					evidenceRefs: [
						"supervisor-activity:events=12",
						"structured-task-queue:open=0",
						"structured-task-queue:stale=0",
						"idu-usage-events:failures=0",
						"idu-usage-events:notAllowed=40",
						"idu-usage-events:requiresHuman=28",
						"agentlab-review-requests:stale=0",
						"supervisor-activity:skipped=4",
					],
					summary:
						"Supervisor advisory gates are noisy but no hard pressure exists",
					recommendedActions: [
						"Review advisory pressure before increasing automation scope.",
					],
				},
			],
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "ran");
	assert.equal(created, 0);
	assert.equal(
		result.evidenceRefs.includes("automaticov1:systemic-maintenance:block"),
		false,
	);
	assert.equal(
		result.nextActions.some((action) =>
			/systemic improvement task/u.test(action),
		),
		false,
	);
});

test("automaticov1 cycle delegates bounded task creation to scheduled alert executor", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => [
				backlogSignal("one"),
				backlogSignal("two"),
				backlogSignal("three"),
				backlogSignal("four"),
			],
			createTask: () => {
				created += 1;
				return { id: `created-${created}` };
			},
		}),
	);

	assert.equal(result.status, "ran");
	assert.equal(result.alertScheduledTick.allowTaskCreation, true);
	assert.equal(created, 3);
	assert.equal(result.alertScheduledTick.tasksCreated.length, 3);
});

test("automaticov1 cycle preserves protected human escalations", async () => {
	const stateRoot = tempRoot();
	let created = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowTaskCreation: true,
			loadSelfMaintenanceSignals: () => [
				securitySignal(),
				backlogSignal("one"),
			],
			createTask: () => {
				created += 1;
				return { id: "created" };
			},
		}),
	);

	assert.equal(result.status, "ran");
	assert.equal(created, 0);
	assert.equal(result.alertScheduledTick.tasksCreated.length, 0);
	assert.equal(
		result.alertScheduledTick.report?.humanEscalations[0]?.domain,
		"security",
	);
});

test("automaticov1 cycle runs exact-allowlist external intelligence only when explicitly enabled", async () => {
	const stateRoot = tempRoot();
	let externalCalls = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowExternalFetch: true,
			buildExternalIntelligenceReport: async () => {
				externalCalls += 1;
				return {
					mode: "advisory_only",
					rawContentStored: false,
					contractPromotionAllowed: false,
					signals: [],
				};
			},
		}),
	);

	assert.equal(externalCalls, 1);
	assert.equal(result.externalFetchExecuted, true);
	assert.ok(result.externalIntelligenceReport);
	assert.equal(result.allowedToProceed, false);
});

test("automaticov1 cycle runs skill proposal pipeline only when explicitly enabled", async () => {
	const stateRoot = tempRoot();
	let skillCalls = 0;
	const result = await runAutomaticov1AdvisoryCycle(
		input(stateRoot, {
			allowSkillDraftProposal: true,
			createSkillDraftFromLessons: () => {
				skillCalls += 1;
				return {
					mode: "proposal-only",
					createdProposals: [],
					createdDrafts: [],
					allowedToProceed: false,
					advisoryOnly: true,
				};
			},
		}),
	);

	assert.equal(skillCalls, 1);
	assert.equal(result.skillProposalExecuted, true);
	assert.ok(result.skillDraftFromLessons);
	assert.equal(result.allowedToProceed, false);
});
