import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveEventsPath } from "../src/event-bus.js";
import { markInjectionAcked, appendInjection } from "../src/injection-store.js";
import {
	emitOrchestratorTurn,
	emitAlertsScheduledTick,
} from "../src/role-events.js";
import { listDecisions } from "../src/decision-ledger.js";
import { runTriggerEngineTick } from "../src/trigger-engine.js";
import { buildObjectiveReminderText } from "../src/objective-reminder.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-wirings-e2e-"));
}

function readEventsJsonl(stateRoot: string): Array<{
	kind: string;
	payload: Record<string, unknown>;
}> {
	const path = resolveEventsPath(stateRoot);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as never);
}

test("Wiring 1: buildObjectiveReminderText produces a profile-driven summary", () => {
	const text = buildObjectiveReminderText({
		stateRoot: makeStateRoot(),
		now: new Date(),
	});
	assert.match(text, /Eres: orquestador/);
	assert.match(
		text,
		/Rutina obligatoria|Al iniciar sesi|Entre tareas|Antes de implementar/i,
	);
});

test("Wiring 2: emitOrchestratorTurn lands an event in events.jsonl with toolName", () => {
	const stateRoot = makeStateRoot();
	try {
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		const events = readEventsJsonl(stateRoot);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.kind, "orchestrator_turn");
		assert.equal(
			(events[0]?.payload as { toolName: string }).toolName,
			"idu_status",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Wiring 3: emitAlertsScheduledTick lands an event in events.jsonl with cronExpr", () => {
	const stateRoot = makeStateRoot();
	try {
		emitAlertsScheduledTick({
			stateRoot,
			projectId: "demo",
			cronExpr: "*/15 * * * *",
			source: "cron",
			now: new Date(),
		});
		const events = readEventsJsonl(stateRoot);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.kind, "alerts_scheduled_tick");
		assert.equal(
			(events[0]?.payload as { cronExpr: string }).cronExpr,
			"*/15 * * * *",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Wiring 4: markInjectionAcked records a decision in the ledger with profile_ref", () => {
	const stateRoot = makeStateRoot();
	try {
		appendInjection(stateRoot, {
			ts: new Date().toISOString(),
			triggerId: "test_trigger",
			decisionEnvelope: {
				severity: "info",
				summary: "demo injection",
				options: ["review", "ignore"],
				evidenceRefs: [],
				orchestratorDecisionRequired: false,
			},
			injectionId: "inj-test-1",
			acked: false,
		});
		markInjectionAcked(stateRoot, "inj-test-1");
		const dbPath = join(stateRoot, "lab.db");
		const decisions = listDecisions(dbPath, { projectId: "default" });
		const ackDecision = decisions.find(
			(d) => d.targetId === "inj-test-1" && d.decision === "ack",
		);
		assert.ok(ackDecision, "decision for inj-test-1 must be recorded");
		assert.equal(ackDecision?.profileRef, "config/profiles/orchestrator.md");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Wiring 4b: when recordDecision throws, markInjectionAcked throws and leaves injection un-acked", () => {
	const stateRoot = makeStateRoot();
	try {
		appendInjection(stateRoot, {
			ts: new Date().toISOString(),
			triggerId: "test_trigger",
			decisionEnvelope: {
				severity: "info",
				summary: "demo injection",
				options: ["review", "ignore"],
				evidenceRefs: [],
				orchestratorDecisionRequired: false,
			},
			injectionId: "inj-test-1b",
			acked: false,
		});
		// Make the lab.db path point to a directory so SQLite cannot open it
		// and recordDecision will throw.
		mkdirSync(join(stateRoot, "lab.db"));
		assert.throws(
			() => markInjectionAcked(stateRoot, "inj-test-1b"),
			/lab\.db|SQLITE|database/i,
		);
		// injection must still be un-acked (so orchestrator can retry)
		const raw = readFileSync(join(stateRoot, "injections.jsonl"), "utf8");
		assert.ok(raw.includes("inj-test-1b"));
		assert.ok(!/"acked":true/.test(raw), "injection must remain un-acked");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Wiring 5: objective_reminder_hourly build emits master_plan_drift event when cache is stale", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-wiring5-"));
	try {
		// Seed: stale objective cache so the trigger matches
		const cachePath = join(stateRoot, "master-plan-objective-cache.json");
		const now = new Date("2026-06-15T00:00:00Z");
		const stale = new Date(now.getTime() - 3_600_000 - 1).toISOString();
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				projectId: "demo",
				objective: "Idu-pi supervisa proyectos",
				updatedAt: stale,
			}),
			"utf8",
		);
		const result = runTriggerEngineTick({
			stateRoot,
			projectId: "demo",
			now,
			isProjectActive: () => true,
		});
		assert.ok(
			result.injectedCount >= 1,
			"objective_reminder_hourly must fire when cache is stale",
		);
		const events = readEventsJsonl(stateRoot);
		const driftEvents = events.filter((e) => e.kind === "master_plan_drift");
		assert.ok(
			driftEvents.length >= 1,
			"at least one master_plan_drift event must be emitted by the trigger",
		);
		const reasons = driftEvents.map(
			(e) => (e.payload as { reason?: string }).reason,
		);
		assert.ok(
			reasons.some(
				(r) => r === "cache_stale" || r === "objective_reminder_fired",
			),
			`master_plan_drift event must carry reason (got: ${JSON.stringify(reasons)})`,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Wiring 5b: orchestrator_turn and alerts_scheduled_tick coexist in events.jsonl", () => {
	const stateRoot = makeStateRoot();
	try {
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		emitAlertsScheduledTick({
			stateRoot,
			projectId: "demo",
			cronExpr: "*/15 * * * *",
			source: "cron",
			now: new Date("2026-06-15T00:00:01Z"),
		});
		const events = readEventsJsonl(stateRoot);
		assert.equal(events.length, 2);
		const kinds = events.map((e) => e.kind).sort();
		assert.deepEqual(kinds, ["alerts_scheduled_tick", "orchestrator_turn"]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
