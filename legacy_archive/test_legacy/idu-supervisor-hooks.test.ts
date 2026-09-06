import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeTempDir } from "./helpers/temp.js";
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
import {
	flushSupervisorActivityEvents,
	readSupervisorActivityEvents,
	supervisorActivityEventsPath,
	type SupervisorActivityRecordInput,
} from "../src/supervisor-activity-events.js";

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
		activity: SupervisorActivityRecordInput[];
		runTask: (
			patch?: Partial<Parameters<typeof maybeRunSupervisorAfterTask>[0]>,
		) => IduSupervisorHookResult;
	}) => void | Promise<void>,
): Promise<void> {
	const root = makeTempDir("idu-supervisor-hooks-");
	const calls: IduSupervisorLoopInput[] = [];
	const activity: SupervisorActivityRecordInput[] = [];
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
		recordSupervisorActivity: (event: SupervisorActivityRecordInput) => {
			activity.push(event);
		},
	};
	await fn({
		root,
		queue,
		calls,
		activity,
		runTask: (patch = {}) =>
			maybeRunSupervisorAfterTask({
				...base,
				...patch,
			}),
	});
}

test("supervisor activity default writer uses explicit stateRoot not workspaceRoot", async () => {
	const workspaceRoot = makeTempDir("idu-supervisor-workspace-");
	const stateRoot = makeTempDir("idu-supervisor-state-");
	const queue = new StructuredTaskQueue({
		filePath: join(workspaceRoot, "reports", "tasks.jsonl"),
	});
	const result = maybeRunSupervisorAfterTask({
		projectId: "idu-pi",
		projectPath: join(workspaceRoot, "project"),
		workspaceRoot,
		supervisorActivityStateRoot: stateRoot,
		repository: {
			getSemanticAuditStats: () => ({
				projectId: "idu-pi",
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
				projectId: "idu-pi",
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
		isIduActive: () => false,
	});
	assert.equal(result.status, "skipped");
	await flushSupervisorActivityEvents();
	assert.equal(
		existsSync(supervisorActivityEventsPath(workspaceRoot)),
		false,
	);
	const events = readSupervisorActivityEvents(stateRoot);
	assert.equal(events.length, 1);
	assert.equal(events[0]?.origin, "supervisor_auto_hook");
	assert.equal(events[0]?.reason, "idu_inactive");
});

test("supervisor activity records inactive hook skip", async () => {
	await withHookRuntime(({ runTask, calls, activity }) => {
		const result = runTask({ isIduActive: () => false });

		assert.equal(result.status, "skipped");
		assert.equal(result.reason, "idu_inactive");
		assert.equal(calls.length, 0);
		assert.equal(activity.length, 1);
		assert.equal(activity[0]?.eventType, "supervisor_hook");
		assert.equal(activity[0]?.origin, "supervisor_auto_hook");
		assert.equal(activity[0]?.trigger, "after_task_registered");
		assert.equal(activity[0]?.status, "skipped");
		assert.equal(activity[0]?.reason, "idu_inactive");
		assert.equal(activity[0]?.active, false);
	});
});

test("hook no corre si /idu inactive", async () => {
	await withHookRuntime(({ runTask, calls }) => {
		const result = runTask({ isIduActive: () => false });

		assert.equal(result.status, "skipped");
		assert.equal(result.reason, "idu_inactive");
		assert.equal(calls.length, 0);
	});
});

test("supervisor activity records completed hook with loop counts", async () => {
	await withHookRuntime(({ runTask, calls, activity }) => {
		const result = runTask();

		assert.equal(result.status, "completed");
		assert.equal(calls.length, 1);
		assert.equal(activity.length, 1);
		assert.equal(activity[0]?.status, "completed");
		assert.equal(activity[0]?.origin, "supervisor_auto_hook");
		assert.equal(activity[0]?.active, true);
		assert.equal(activity[0]?.createdTasks, 0);
		assert.equal(activity[0]?.stepCounts?.active, 1);
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

test("hook forwards canonical labDbPath and reportsPath to supervisor loop", async () => {
	await withHookRuntime(({ runTask, calls, root }) => {
		const labDbPath = join(root, "projects", "pi-telegram-bridge", "lab.db");
		const reportsPath = join(root, "projects", "pi-telegram-bridge", "reports");

		const result = runTask({ labDbPath, reportsPath });

		assert.equal(result.status, "completed");
		assert.equal(calls.length, 1);
		assert.equal(calls[0].labDbPath, labDbPath);
		assert.equal(calls[0].reportsPath, reportsPath);
	});
});

test("supervisor activity records throttled hook skip", async () => {
	await withHookRuntime(({ runTask, calls, root, activity }) => {
		assert.equal(runTask().status, "completed");
		const second = runTask({
			now: () => new Date("2026-05-24T21:05:00.000Z"),
		});

		assert.equal(second.status, "skipped");
		assert.equal(second.reason, "throttled");
		assert.equal(calls.length, 1);
		assert.equal(activity.length, 2);
		assert.equal(activity[1]?.reason, "throttled");
		assert.equal(activity[1]?.active, true);
		assert.equal(
			existsSync(join(root, "reports", "idu-supervisor-hook-state.json")),
			true,
		);
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

test("supervisor activity failure recording does not block hook result", async () => {
	await withHookRuntime(({ runTask }) => {
		const result = runTask({
			recordSupervisorActivity: () => {
				throw new Error("telemetry boom");
			},
		});

		assert.equal(result.status, "completed");
	});
});

test("failure no rompe flujo principal", async () => {
	await withHookRuntime(({ runTask, activity }) => {
		const result = runTask({
			runSupervisorLoop: () => {
				throw new Error("boom");
			},
		});

		assert.equal(result.status, "warning");
		assert.equal(result.reason, "supervisor_failed");
		assert.equal(activity.at(-1)?.reason, "supervisor_failed");
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
