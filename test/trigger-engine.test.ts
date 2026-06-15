import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	runTriggerEngineTick,
	TRIGGER_DEFINITIONS,
} from "../src/trigger-engine.js";
import { appendEvent } from "../src/event-bus.js";
import { readEvents } from "../src/event-bus.js";
import { readPendingInjections } from "../src/injection-store.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-trigger-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

const FIXED_TS = "2026-06-08T10:00:00.000Z";

test("runTriggerEngineTick con stateRoot sin eventos retorna 0 inyecciones y lista de disparadores", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		assert.equal(result.injectedCount, 0);
		assert.equal(result.evaluatedTriggers.length, TRIGGER_DEFINITIONS.length);
	} finally {
		cleanup();
	}
});

test("stuck_tasks_1h con task_stuck ageMs >= 1h sin task_created posterior inyecta 1 envelope", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "task_stuck",
			projectId: "idu-pi",
			payload: {
				taskId: "t-1",
				ageMs: 3_700_000,
				domain: "stale_work",
				severity: "warning",
			},
			sourceRef: "autonomous-alert-engine",
			evidenceRefs: [],
		});
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		assert.equal(result.injectedCount, 1);
		const pending = readPendingInjections(stateRoot);
		assert.equal(pending.length, 1);
		assert.equal(pending[0]?.triggerId, "stuck_tasks_1h");
	} finally {
		cleanup();
	}
});

test("Idempotencia: 2 ticks consecutivos con misma ventana no duplican", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "task_stuck",
			projectId: "idu-pi",
			payload: {
				taskId: "t-2",
				ageMs: 3_700_000,
				domain: "stale_work",
				severity: "warning",
			},
			sourceRef: "autonomous-alert-engine",
			evidenceRefs: [],
		});
		const r1 = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		const r2 = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		assert.equal(r1.injectedCount, 1);
		assert.equal(r2.injectedCount, 0);
		assert.equal(readPendingInjections(stateRoot).length, 1);
	} finally {
		cleanup();
	}
});

test("stuck_tasks_1h con task_created posterior a task_stuck no matchea", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "task_stuck",
			projectId: "idu-pi",
			payload: {
				taskId: "t-3",
				ageMs: 3_700_000,
				domain: "stale_work",
				severity: "warning",
			},
			sourceRef: "autonomous-alert-engine",
			evidenceRefs: [],
		});
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "task_created",
			projectId: "idu-pi",
			payload: { taskId: "t-3" },
			sourceRef: "structured-task-queue",
			evidenceRefs: [],
		});
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		assert.equal(result.injectedCount, 0);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly con cache viejo (>1h) inyecta envelope info", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// Seed: master-plan-objective-cache con ts viejo
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "Idu-pi supervisa proyectos",
				updatedAt: "2026-06-08T07:00:00.000Z",
			}),
			"utf8",
		);
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			isProjectActive: () => true,
		});
		assert.ok(result.injectedCount >= 1);
		const pending = readPendingInjections(stateRoot);
		assert.ok(pending.some((i) => i.triggerId === "objective_reminder_hourly"));
		const o = pending.find((i) => i.triggerId === "objective_reminder_hourly");
		assert.equal(o?.decisionEnvelope.severity, "info");
		assert.equal(o?.decisionEnvelope.orchestratorDecisionRequired, false);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly con isProjectActive=false no inyecta", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt: "2026-06-08T07:00:00.000Z",
			}),
			"utf8",
		);
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			isProjectActive: () => false,
		});
		const pending = readPendingInjections(stateRoot);
		assert.equal(
			pending.filter((i) => i.triggerId === "objective_reminder_hourly").length,
			0,
		);
	} finally {
		cleanup();
	}
});

test("intention_decision_pending con ageMs >= 30min y requiresHuman=true inyecta warning", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "intention_decision_pending",
			projectId: "idu-pi",
			payload: {
				request: "touch auth.ts",
				ageMs: 1_900_000,
				requiresHuman: true,
			},
			sourceRef: "project-preflight",
			evidenceRefs: [],
		});
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		assert.ok(result.injectedCount >= 1);
		const pending = readPendingInjections(stateRoot);
		const i = pending.find((p) => p.triggerId === "intention_decision_pending");
		assert.equal(i?.decisionEnvelope.severity, "warning");
		assert.equal(i?.decisionEnvelope.orchestratorDecisionRequired, true);
	} finally {
		cleanup();
	}
});

test("intention_decision_pending con requiresHuman=false no matchea", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "intention_decision_pending",
			projectId: "idu-pi",
			payload: {
				request: "tweak copy",
				ageMs: 1_900_000,
				requiresHuman: false,
			},
			sourceRef: "project-preflight",
			evidenceRefs: [],
		});
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		const pending = readPendingInjections(stateRoot);
		assert.equal(
			pending.filter((p) => p.triggerId === "intention_decision_pending")
				.length,
			0,
		);
	} finally {
		cleanup();
	}
});

test("evaluatedTriggers contiene los 3 ids", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		const ids = result.evaluatedTriggers;
		assert.ok(ids.includes("stuck_tasks_1h"));
		assert.ok(ids.includes("objective_reminder_hourly"));
		assert.ok(ids.includes("intention_decision_pending"));
	} finally {
		cleanup();
	}
});

test("Triggers con ventana vacía no inyectan", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// Sin eventos y sin cache => todos los disparadores matchean vacío
		// (excepto objective_reminder_hourly que matchea si no hay cache, ver trigger)
		// Para esta assertion: el trigger engine debe retornar sin inyectar nada
		// que dependa de eventos presentes. Verificamos que NO haya stuck_tasks_1h ni intention_decision_pending.
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
		});
		const pending = readPendingInjections(stateRoot);
		assert.equal(
			pending.filter(
				(p) =>
					p.triggerId === "stuck_tasks_1h" ||
					p.triggerId === "intention_decision_pending",
			).length,
			0,
		);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly with cache age 1h-1ms does NOT match", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		const now = new Date(FIXED_TS);
		const ageMs = 3_600_000 - 1; // 1h - 1ms
		const updatedAt = new Date(now.getTime() - ageMs).toISOString();
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt,
			}),
			"utf8",
		);
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now,
			isProjectActive: () => true,
		});
		const pending = readPendingInjections(stateRoot);
		assert.equal(
			pending.filter((i) => i.triggerId === "objective_reminder_hourly").length,
			0,
			"cache age 1h-1ms should NOT fire",
		);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly with cache age exactly 1h does NOT match (strict less-than)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		const now = new Date(FIXED_TS);
		const ageMs = 3_600_000; // exactly 1h
		const updatedAt = new Date(now.getTime() - ageMs).toISOString();
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt,
			}),
			"utf8",
		);
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now,
			isProjectActive: () => true,
		});
		const pending = readPendingInjections(stateRoot);
		assert.equal(
			pending.filter((i) => i.triggerId === "objective_reminder_hourly").length,
			0,
			"cache age exactly 1h should NOT fire (strict less-than contract)",
		);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly with cache age 1h+1ms matches with severity info", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		const now = new Date(FIXED_TS);
		const ageMs = 3_600_000 + 1; // 1h + 1ms
		const updatedAt = new Date(now.getTime() - ageMs).toISOString();
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt,
			}),
			"utf8",
		);
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now,
			isProjectActive: () => true,
		});
		assert.ok(result.injectedCount >= 1, "should fire when cache age > 1h");
		const pending = readPendingInjections(stateRoot);
		const o = pending.find((i) => i.triggerId === "objective_reminder_hourly");
		assert.ok(o, "objective_reminder_hourly should be present");
		assert.equal(o?.decisionEnvelope.severity, "info");
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly envelope has decisionRequired: false", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		const now = new Date(FIXED_TS);
		const ageMs = 3_600_000 + 1000; // 1h + 1s
		const updatedAt = new Date(now.getTime() - ageMs).toISOString();
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt,
			}),
			"utf8",
		);
		runTriggerEngineTick({
			stateRoot,
			projectId: "idu-pi",
			now,
			isProjectActive: () => true,
		});
		const pending = readPendingInjections(stateRoot);
		const o = pending.find((i) => i.triggerId === "objective_reminder_hourly");
		assert.ok(o, "objective_reminder_hourly should be present");
		assert.equal(
			o?.decisionEnvelope.severity,
			"info",
			"severity should be info",
		);
		assert.equal(
			o?.decisionEnvelope.orchestratorDecisionRequired,
			false,
			"decisionRequired should be false",
		);
		assert.deepEqual(
			o?.decisionEnvelope.options,
			["review", "ignore"],
			"options should be review and ignore",
		);
	} finally {
		cleanup();
	}
});

test("runTriggerEngineTick continues to fire other triggers when one build throws", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// Seed: stuck task that should fire stuck_tasks_1h
		appendEvent(stateRoot, {
			ts: FIXED_TS,
			kind: "task_stuck",
			projectId: "idu-pi",
			payload: {
				taskId: "t-x",
				ageMs: 3_700_000,
				domain: "stale_work",
				severity: "warning",
			},
			sourceRef: "autonomous-alert-engine",
			evidenceRefs: [],
		});
		// Seed: stale objective cache so objective_reminder fires too
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "idu-pi",
				objective: "test",
				updatedAt: "2026-06-08T07:00:00.000Z",
			}),
			"utf8",
		);
		// Define a faulty trigger that matches but throws on build
		const faultyDef = {
			id: "faulty_test_trigger",
			description: "faulty trigger for resilience test",
			kinds: ["task_stuck"],
			signature: "faulty|test",
			contract: {
				decisionRequired: true,
				severity: "warning" as const,
				options: ["review"],
			},
			match: () => ({
				triggerId: "faulty_test_trigger",
				matches: [
					{
						event: {
							ts: FIXED_TS,
							kind: "task_stuck",
							projectId: "idu-pi",
							payload: { taskId: "t-x" },
							sourceRef: "test",
							evidenceRefs: [],
						},
						reason: "always matches",
					},
				],
			}),
			build: () => {
				throw new Error("profile missing");
			},
		};
		const stuckDef = TRIGGER_DEFINITIONS.find(
			(d) => d.id === "stuck_tasks_1h",
		);
		assert.ok(stuckDef, "stuck_tasks_1h must be defined");
		const result = runTriggerEngineTick(
			{
				stateRoot,
				projectId: "idu-pi",
				now: new Date(FIXED_TS),
			},
			[faultyDef, stuckDef],
		);
		// Tick did NOT throw, and stuck_tasks_1h still fired
		assert.ok(result.injectedCount >= 1, "stuck_tasks_1h must still fire");
		const pending = readPendingInjections(stateRoot);
		assert.ok(
			pending.some((p) => p.triggerId === "stuck_tasks_1h"),
			"stuck_tasks_1h injection should exist",
		);
		assert.equal(
			pending.some((p) => p.triggerId === "faulty_test_trigger"),
			false,
			"faulty trigger should not inject",
		);
		// trigger_build_failed event was appended
		const events = readEvents(stateRoot, {});
		const failEvent = events.find((e) => e.kind === "trigger_build_failed");
		assert.ok(failEvent, "trigger_build_failed event should exist");
		assert.equal(
			(failEvent?.payload as { triggerId?: string }).triggerId,
			"faulty_test_trigger",
		);
	} finally {
		cleanup();
	}
});

test("objective_reminder_hourly build produces hermetic envelope with info severity", () => {
	const def = TRIGGER_DEFINITIONS.find(
		(d) => d.id === "objective_reminder_hourly",
	);
	assert.ok(def, "objective_reminder_hourly definition should exist");

	const context = {
		stateRoot: "/tmp/test",
		projectId: "idu-pi",
		now: new Date(FIXED_TS),
		isProjectActive: () => true,
	};

	const mockMatchResult = {
		triggerId: "objective_reminder_hourly",
		matches: [
			{
				event: {
					ts: FIXED_TS,
					kind: "master_plan_drift",
					projectId: "idu-pi",
					payload: { reason: "cache_stale", ageMs: 3_600_001 },
					sourceRef: "trigger-engine-synthetic",
					evidenceRefs: [],
				},
				reason: "cache ageMs 3600001",
			},
		],
	};

	const built = def.build(mockMatchResult, context);

	assert.equal(
		built.decisionEnvelope.severity,
		"info",
		"hermetic envelope severity should be info",
	);
	assert.equal(
		built.decisionEnvelope.orchestratorDecisionRequired,
		false,
		"hermetic envelope decisionRequired should be false",
	);
	assert.deepEqual(
		built.decisionEnvelope.options,
		["review", "ignore"],
		"hermetic envelope options should be review and ignore",
	);
	assert.equal(
		built.triggerId,
		"objective_reminder_hourly",
		"triggerId should match",
	);
});
