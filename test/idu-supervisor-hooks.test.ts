import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatSupervisorHookResult,
	maybeRunSupervisorAfterPostflight,
	maybeRunSupervisorAfterSemanticTrigger,
	maybeRunSupervisorAfterTask,
	maybeRunSupervisorOnIduActivation,
	shouldThrottleSupervisorLoop,
	type IduSupervisorHookResult,
} from "../src/idu-supervisor-hooks.js";
import type {
	IduSupervisorLoopInput,
	IduSupervisorLoopResult,
} from "../src/idu-supervisor-loop.js";
import {
	StructuredTaskQueue,
	type StructuredTask,
} from "../src/structured-task-queue.js";

function fakeLoopResult(
	input: IduSupervisorLoopInput,
): IduSupervisorLoopResult {
	return {
		status: "completed",
		trigger: input.trigger,
		projectId: input.projectId,
		steps: [
			{ name: "session_check", status: "active", summary: "Idu-pi activo." },
		],
		createdTasks: 0,
		summary: `loop ${input.trigger}`,
		recommendedNext: [],
		safety: {
			agentLabsExecuted: false,
			rulesApplied: false,
			memoryDeleted: false,
			projectCoreModified: false,
		},
	};
}

async function withHookRuntime(
	fn: (runtime: {
		root: string;
		queue: StructuredTaskQueue;
		calls: IduSupervisorLoopInput[];
		runTask: (
			patch?: Partial<Parameters<typeof maybeRunSupervisorAfterTask>[0]>,
		) => IduSupervisorHookResult;
	}) => void | Promise<void>,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-hooks-"));
	try {
		const calls: IduSupervisorLoopInput[] = [];
		const queue = new StructuredTaskQueue({
			filePath: join(root, "reports", "tasks.jsonl"),
		});
		const base = {
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			repository: {
				getSemanticAuditStats: () => ({
					projectId: "pi-telegram-bridge",
					labRunCount: 0,
					findingCount: 0,
					proposalCount: 0,
					taskCount: 0,
					userSignalCount: 0,
					memoryItemCount: 0,
					criticalFindingCount: 0,
					highFindingCount: 0,
				}),
				getSemanticAuditCheckpoint: () => ({
					projectId: "pi-telegram-bridge",
					lastLabRunCount: 0,
					lastFindingCount: 0,
					lastProposalCount: 0,
					lastTaskCount: 0,
					lastUserSignalCount: 0,
					lastMemoryItemCount: 0,
					lastCriticalFindingCount: 0,
					lastHighFindingCount: 0,
				}),
				createSemanticAuditRun: () => undefined,
				updateSemanticAuditCheckpoint: () => undefined,
			},
			queue,
			isIduActive: () => true,
			now: () => new Date("2026-05-24T21:00:00.000Z"),
			runSupervisorLoop: (input: IduSupervisorLoopInput) => {
				calls.push(input);
				return fakeLoopResult(input);
			},
		};
		await fn({
			root,
			queue,
			calls,
			runTask: (patch = {}) =>
				maybeRunSupervisorAfterTask({
					...base,
					...patch,
				}),
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("hook no corre si /idu inactive", async () => {
	await withHookRuntime(({ runTask, calls }) => {
		const result = runTask({ isIduActive: () => false });

		assert.equal(result.status, "skipped");
		assert.equal(result.reason, "idu_inactive");
		assert.equal(calls.length, 0);
	});
});

test("hook corre si /idu active y evento relevante", async () => {
	await withHookRuntime(({ runTask, calls }) => {
		const result = runTask();

		assert.equal(result.status, "completed");
		assert.equal(result.trigger, "after_task_registered");
		assert.equal(calls.length, 1);
		assert.equal(calls[0].trigger, "after_task_registered");
		assert.deepEqual(calls[0].options, {
			allowSemanticDraft: false,
			allowAgentTaskPlan: false,
			dryRun: false,
		});
	});
});

test("throttle evita loops repetidos", async () => {
	await withHookRuntime(({ runTask, calls, root }) => {
		assert.equal(runTask().status, "completed");
		const second = runTask({
			now: () => new Date("2026-05-24T21:05:00.000Z"),
		});

		assert.equal(second.status, "skipped");
		assert.equal(second.reason, "throttled");
		assert.equal(calls.length, 1);
		assert.equal(
			existsSync(join(root, "reports", "idu-supervisor-hook-state.json")),
			true,
		);
	});
});

test("critical/high bypass throttle", async () => {
	await withHookRuntime(({ runTask, calls }) => {
		assert.equal(runTask().status, "completed");
		const task = { guardRisk: "high" } as StructuredTask;
		const second = runTask({
			task,
			now: () => new Date("2026-05-24T21:05:00.000Z"),
		});

		assert.equal(second.status, "completed");
		assert.equal(second.bypassedThrottle, true);
		assert.equal(calls.length, 2);
	});
});

test("failure no rompe flujo principal", async () => {
	await withHookRuntime(({ runTask }) => {
		const result = runTask({
			runSupervisorLoop: () => {
				throw new Error("boom");
			},
		});

		assert.equal(result.status, "warning");
		assert.equal(result.reason, "supervisor_failed");
		assert.match(
			formatSupervisorHookResult(result),
			/flujo principal continúa/u,
		);
	});
});

test("on_idu_activation usa trigger correcto", async () => {
	await withHookRuntime(({ root, queue, calls }) => {
		const result = maybeRunSupervisorOnIduActivation({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			repository: {} as never,
			queue,
			isIduActive: () => true,
			runSupervisorLoop: (input: IduSupervisorLoopInput) => {
				calls.push(input);
				return fakeLoopResult(input);
			},
		});

		assert.equal(result.trigger, "on_idu_activation");
		assert.equal(calls[0].trigger, "on_idu_activation");
		assert.equal(calls[0].options.allowSemanticDraft, false);
		assert.equal(calls[0].options.allowAgentTaskPlan, false);
	});
});

test("after_postflight usa trigger correcto y high bypass", async () => {
	await withHookRuntime(({ root, queue, calls }) => {
		const common = {
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			repository: {} as never,
			queue,
			isIduActive: () => true,
			runSupervisorLoop: (input: IduSupervisorLoopInput) => {
				calls.push(input);
				return fakeLoopResult(input);
			},
		};
		assert.equal(
			maybeRunSupervisorAfterPostflight({ ...common, risk: "low" }).status,
			"completed",
		);
		const second = maybeRunSupervisorAfterPostflight({
			...common,
			risk: "high",
			now: () => new Date("2026-05-24T21:05:00.000Z"),
		});

		assert.equal(second.status, "completed");
		assert.equal(second.bypassedThrottle, true);
		assert.equal(calls[1].trigger, "after_postflight");
	});
});

test("after_semantic_threshold usa trigger correcto y permite draft sólo major/critical", async () => {
	await withHookRuntime(({ root, queue, calls }) => {
		const result = maybeRunSupervisorAfterSemanticTrigger({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			repository: {} as never,
			queue,
			isIduActive: () => true,
			semanticTrigger: {
				projectId: "pi-telegram-bridge",
				decision: "executed",
				triggerReason: "threshold_major",
				summary: "major",
				newEventCount: 1000,
			},
			runSupervisorLoop: (input: IduSupervisorLoopInput) => {
				calls.push(input);
				return fakeLoopResult(input);
			},
		});

		assert.equal(result.trigger, "after_semantic_threshold");
		assert.equal(calls[0].trigger, "after_semantic_threshold");
		assert.equal(calls[0].options.allowSemanticDraft, true);
		assert.equal(calls[0].options.allowAgentTaskPlan, false);
	});
});

test("after_semantic_threshold sin eventos nuevos devuelve no_new_events", async () => {
	await withHookRuntime(({ root, queue, calls }) => {
		const result = maybeRunSupervisorAfterSemanticTrigger({
			projectId: "pi-telegram-bridge",
			projectPath: join(root, "project"),
			workspaceRoot: root,
			repository: {} as never,
			queue,
			isIduActive: () => true,
			semanticTrigger: {
				projectId: "pi-telegram-bridge",
				decision: "skipped",
				triggerReason: "not_enough_data",
				summary: "skip",
				newEventCount: 0,
			},
		});

		assert.equal(result.status, "skipped");
		assert.equal(result.reason, "no_new_events");
		assert.equal(calls.length, 0);
	});
});

test("hooks no ejecutan AgentLabs ni aplican reglas ni borran datos", async () => {
	await withHookRuntime(({ runTask }) => {
		const result = runTask();

		assert.equal(result.safety.agentLabsExecuted, false);
		assert.equal(result.safety.rulesApplied, false);
		assert.equal(result.safety.memoryDeleted, false);
		assert.equal(result.safety.projectCoreModified, false);
	});
});

test("throttle state se guarda en reports/idu-supervisor-hook-state.json sin secretos", async () => {
	await withHookRuntime(({ runTask, root }) => {
		runTask();
		const path = join(root, "reports", "idu-supervisor-hook-state.json");
		const text = readFileSync(path, "utf8");

		assert.match(text, /pi-telegram-bridge/u);
		assert.match(text, /lastRunAt/u);
		assert.doesNotMatch(
			text,
			/token|secret|password|apiKey|bearer|credentials/iu,
		);
	});
});

test("shouldThrottleSupervisorLoop respeta ventana por proyecto", () => {
	const lastRunAt = "2026-05-24T21:00:00.000Z";

	assert.equal(
		shouldThrottleSupervisorLoop({
			lastRunAt,
			now: new Date("2026-05-24T21:09:59.000Z"),
		}),
		true,
	);
	assert.equal(
		shouldThrottleSupervisorLoop({
			lastRunAt,
			now: new Date("2026-05-24T21:10:00.000Z"),
		}),
		false,
	);
});
