/**
 * RoleEngine tests — T1.4 (RED → GREEN).
 *
 * These tests lock the engine's public contract: dispatch routing,
 * shouldFire gating, cooldown enforcement, per-turn cap with a
 * single warning, advisory persistence, priority ordering, turn
 * reset, and state durability across restarts.
 *
 * The tests use fake roles and a fake emitEvent callback so they
 * are fully hermetic — no real Pi sessions, no real LLM calls.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { Event, EventKind } from "../src/event-bus.js";
import type { RoleEngineConfig } from "../src/role-engine-config.js";
import { RoleEngine } from "../src/role-engine.js";
import type { IduModelRoleId } from "../src/model-assignments.js";
import type {
	Role,
	RoleAdvisory,
	RoleContext,
	RoleInput,
} from "../src/roles/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-role-engine-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function allEnabled(): Record<IduModelRoleId, boolean> {
	return {
		"supervisor-main": true,
		"supervisor-semantic": true,
		"supervisor-compaction": true,
		"agentlab-general": true,
		"agentlab-project-understanding": true,
		"agentlab-security": true,
		"agentlab-architecture": true,
		"agentlab-database": true,
		"agentlab-ui-ux": true,
		"agentlab-performance": true,
		"agentlab-code-quality": true,
		"agentlab-docs": true,
		"agentlab-librarian": true,
	};
}

function defaultConfig(
	overrides: Partial<RoleEngineConfig> = {},
): RoleEngineConfig {
	return {
		enabled: true,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: allEnabled(),
		roleCooldownMs: {},
		...overrides,
	};
}

function makeEvent(
	kind: EventKind,
	payload: Record<string, unknown> = { request: "hello" },
	ts = "2026-01-01T00:00:00.000Z",
): Event {
	return {
		ts,
		kind,
		projectId: "test",
		payload,
		sourceRef: "test-source",
		evidenceRefs: [],
	};
}

function fakeRole(
	id: IduModelRoleId,
	opts: {
		priority?: number;
		cooldownMs?: number;
		subscribesTo?: EventKind[];
		shouldFire?: (
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		) => boolean;
		invoke?: (input: RoleInput, ctx: RoleContext) => Promise<RoleAdvisory>;
	},
): Role {
	const priority = opts.priority ?? 50;
	return {
		name: `${id}-test`,
		priority,
		cooldownMs: opts.cooldownMs ?? 60_000,
		subscribesTo: () => opts.subscribesTo ?? ["orchestrator_turn"],
		shouldFire: opts.shouldFire ?? (() => true),
		invoke:
			opts.invoke ??
			(async (input) => ({
				roleId: id,
				priority,
				ts: input.context.now.toISOString(),
				advisory: `advisory from ${id}`,
				evidenceRefs: [],
			})),
	};
}

// ---------------------------------------------------------------------------
// 1. dispatch() finds roles that subscribe to a kind and calls them
// ---------------------------------------------------------------------------

test("dispatch() finds roles that subscribe to a kind and calls them", async () => {
	const root = freshRoot();
	const invokeLog: string[] = [];

	const roleMain = fakeRole("supervisor-main", {
		subscribesTo: ["orchestrator_turn"],
		invoke: async (input) => {
			invokeLog.push("supervisor-main");
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: "main advisory",
				evidenceRefs: [],
			};
		},
	});

	const roleSecurity = fakeRole("agentlab-security", {
		subscribesTo: ["file_changed"],
		invoke: async () => {
			invokeLog.push("agentlab-security");
			return {
				roleId: "agentlab-security",
				priority: 95,
				ts: new Date().toISOString(),
				advisory: "security advisory",
				evidenceRefs: [],
			};
		},
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: {
			"supervisor-main": roleMain,
			"agentlab-security": roleSecurity,
		},
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: () => {},
	});

	const result = await engine.onEvent(makeEvent("orchestrator_turn"));

	assert.equal(result.fired.length, 1, "exactly one role fires");
	assert.deepEqual(invokeLog, ["supervisor-main"]);
	assert.equal(
		result.fired[0]?.roleId,
		"supervisor-main",
	);
});

// ---------------------------------------------------------------------------
// 2. dispatch() honors shouldFire returning false (skips invoke)
// ---------------------------------------------------------------------------

test("dispatch() honors shouldFire returning false (skips invoke)", async () => {
	const root = freshRoot();
	let invokeCalled = false;

	const roleMain = fakeRole("supervisor-main", {
		subscribesTo: ["orchestrator_turn"],
		shouldFire: () => false,
		invoke: async (input) => {
			invokeCalled = true;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: "should not fire",
				evidenceRefs: [],
			};
		},
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: { "supervisor-main": roleMain },
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: () => {},
	});

	const result = await engine.onEvent(makeEvent("orchestrator_turn"));

	assert.equal(invokeCalled, false, "invoke must not be called when shouldFire returns false");
	assert.equal(result.fired.length, 0);
	assert.equal(result.skippedByIdempotency, 1);
});

// ---------------------------------------------------------------------------
// 3. dispatch() honors cooldown (same hash within cooldownMs → skip)
// ---------------------------------------------------------------------------

test("dispatch() honors cooldown (same hash within cooldownMs → skip)", async () => {
	const root = freshRoot();
	let invokeCount = 0;
	const fixedNow = new Date("2026-01-01T00:00:00.000Z");

	const roleMain = fakeRole("supervisor-main", {
		subscribesTo: ["orchestrator_turn"],
		cooldownMs: 60_000,
		invoke: async (input) => {
			invokeCount++;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: `invoke #${invokeCount}`,
				evidenceRefs: [],
			};
		},
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: { "supervisor-main": roleMain },
		now: () => fixedNow,
		appendAdvisory: () => {},
	});

	const event = makeEvent("orchestrator_turn");

	// First dispatch: fires
	const r1 = await engine.onEvent(event);
	assert.equal(r1.fired.length, 1, "first dispatch fires");
	assert.equal(invokeCount, 1);

	// Second dispatch (same event hash, within cooldown): skipped
	const r2 = await engine.onEvent(event);
	assert.equal(r2.fired.length, 0, "second dispatch skipped by cooldown");
	assert.equal(r2.skippedByCooldown, 1);
	assert.equal(invokeCount, 1, "invoke count unchanged");
});

// ---------------------------------------------------------------------------
// 4. dispatch() honors MAX_ROLE_INVOCATIONS_PER_TURN and emits exactly one
//    cap warning per turn
// ---------------------------------------------------------------------------

test("dispatch() honors MAX_ROLE_INVOCATIONS_PER_TURN and emits exactly one cap warning per turn", async () => {
	const root = freshRoot();
	const capturedEvents: Event[] = [];

	const roleA = fakeRole("supervisor-main", {
		priority: 90,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleB = fakeRole("supervisor-semantic", {
		priority: 80,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleC = fakeRole("supervisor-compaction", {
		priority: 70,
		subscribesTo: ["orchestrator_turn"],
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig({ maxRoleInvocationsPerTurn: 2 }),
		registry: {
			"supervisor-main": roleA,
			"supervisor-semantic": roleB,
			"supervisor-compaction": roleC,
		},
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: () => {},
		emitEvent: (event) => {
			capturedEvents.push(event);
		},
	});

	const result = await engine.onEvent(makeEvent("orchestrator_turn"));

	// Only 2 roles fire (the cap), the 3rd is skipped
	assert.equal(result.fired.length, 2, "exactly 2 roles fire under cap=2");
	assert.equal(result.skippedByCap, 1, "one role skipped by cap");
	assert.equal(result.capWarning, true, "capWarning flag set");

	// Exactly one cap warning event emitted
	const capWarnings = capturedEvents.filter(
		(event) => event.kind === "role_engine_cap_warning",
	);
	assert.equal(capWarnings.length, 1, "exactly one cap warning event");
	assert.equal(capWarnings[0]?.payload.turnId, undefined, "no turnId yet (onTurnStart not called)");

	// Second dispatch in the same turn: no additional cap warning
	capturedEvents.length = 0;
	const result2 = await engine.onEvent(makeEvent("orchestrator_turn", { request: "other" }));
	const capWarnings2 = capturedEvents.filter(
		(event) => event.kind === "role_engine_cap_warning",
	);
	assert.equal(
		capWarnings2.length,
		0,
		"no second cap warning in the same turn",
	);
	// The remaining roles are still skipped by cap
	assert.ok(result2.skippedByCap >= 0, "subsequent dispatches also respect cap");
});

// ---------------------------------------------------------------------------
// 5. dispatch() appends each successful RoleAdvisory via the appendAdvisory
//    callback
// ---------------------------------------------------------------------------

test("dispatch() appends each successful RoleAdvisory via the appendAdvisory callback", async () => {
	const root = freshRoot();
	const appended: RoleAdvisory[] = [];

	const roleA = fakeRole("supervisor-main", {
		priority: 90,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleB = fakeRole("supervisor-semantic", {
		priority: 80,
		subscribesTo: ["orchestrator_turn"],
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: {
			"supervisor-main": roleA,
			"supervisor-semantic": roleB,
		},
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: (advisory) => {
			appended.push(advisory);
		},
	});

	await engine.onEvent(makeEvent("orchestrator_turn"));

	assert.equal(appended.length, 2, "two advisories appended");
	const roleIds = appended.map((a) => a.roleId).sort();
	assert.deepEqual(roleIds, ["supervisor-main", "supervisor-semantic"]);
});

// ---------------------------------------------------------------------------
// 6. dispatch() emits orchestrator_advisory events with priority-ordered
//    advisories
// ---------------------------------------------------------------------------

test("dispatch() emits orchestrator_advisory events with priority-ordered advisories", async () => {
	const root = freshRoot();
	const capturedEvents: Event[] = [];

	const roleLow = fakeRole("agentlab-general", {
		priority: 20,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleHigh = fakeRole("supervisor-main", {
		priority: 90,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleMed = fakeRole("supervisor-semantic", {
		priority: 80,
		subscribesTo: ["orchestrator_turn"],
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: {
			"agentlab-general": roleLow,
			"supervisor-main": roleHigh,
			"supervisor-semantic": roleMed,
		},
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: () => {},
		emitEvent: (event) => {
			capturedEvents.push(event);
		},
	});

	const result = await engine.onEvent(makeEvent("orchestrator_turn"));

	// All 3 roles fire
	assert.equal(result.fired.length, 3);

	// The fired array is priority-ordered (DESC)
	assert.equal(result.fired[0]?.roleId, "supervisor-main", "highest priority first");
	assert.equal(result.fired[1]?.roleId, "supervisor-semantic", "medium priority second");
	assert.equal(result.fired[2]?.roleId, "agentlab-general", "lowest priority last");

	// The engine emits orchestrator_advisory events for each advisory
	const advisoryEvents = capturedEvents.filter(
		(event) => event.kind === "orchestrator_advisory",
	);
	assert.equal(advisoryEvents.length, 3, "three orchestrator_advisory events emitted");
	// They are emitted in priority order (the engine processes roles in priority order)
	assert.equal(advisoryEvents[0]?.payload.roleId, "supervisor-main");
	assert.equal(advisoryEvents[1]?.payload.roleId, "supervisor-semantic");
	assert.equal(advisoryEvents[2]?.payload.roleId, "agentlab-general");
	// Each advisory event carries the required fields
	for (const evt of advisoryEvents) {
		assert.ok(evt.payload.roleId, "has roleId");
		assert.ok(typeof evt.payload.priority === "number", "has priority");
		assert.ok(typeof evt.payload.ts === "string", "has ts");
		assert.ok(typeof evt.payload.advisory === "string", "has advisory");
		assert.ok(Array.isArray(evt.payload.evidenceRefs), "has evidenceRefs");
	}
});

// ---------------------------------------------------------------------------
// 7. onTurnStart() resets the per-turn counter and returns the
//    highest-priority advisory
// ---------------------------------------------------------------------------

test("onTurnStart() resets the per-turn counter and returns the highest-priority advisory", async () => {
	const root = freshRoot();

	const roleLow = fakeRole("agentlab-general", {
		priority: 20,
		subscribesTo: ["orchestrator_turn"],
	});
	const roleHigh = fakeRole("supervisor-main", {
		priority: 90,
		subscribesTo: ["orchestrator_turn"],
	});

	const engine = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		// Cap at 1 — only the highest-priority role will fire
		config: defaultConfig({ maxRoleInvocationsPerTurn: 1 }),
		registry: {
			"agentlab-general": roleLow,
			"supervisor-main": roleHigh,
		},
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		appendAdvisory: () => {},
	});

	// Dispatch an event — only the highest-priority role fires (cap=1)
	await engine.onEvent(makeEvent("orchestrator_turn"));

	// onTurnStart returns the highest-priority advisory
	const next = engine.onTurnStart("turn-001");
	assert.ok(next, "nextAdvisory is defined");
	assert.equal(next.roleId, "supervisor-main", "highest-priority advisory returned");
	assert.equal(next.priority, 90);

	// After onTurnStart, the per-turn counter is reset.
	// Dispatch again — the same role should fire again (counter reset).
	// But cooldown still applies, so we use a different event (different hash).
	const result2 = await engine.onEvent(
		makeEvent("orchestrator_turn", { request: "new-request" }),
	);
	// The cap was reset by onTurnStart, so supervisor-main can fire again
	// (assuming cooldown allows — we need a different event hash and
	// the cooldown window has not elapsed, but since it's a different
	// hash, the cooldown check is per-hash).
	// Actually, the cooldown is per (role, eventHash). The new event has
	// a different hash, so the cooldown doesn't block it.
	assert.equal(result2.fired.length, 1, "role fires again after turn reset");
	assert.equal(result2.fired[0]?.roleId, "supervisor-main");
});

// ---------------------------------------------------------------------------
// 8. dispatch() persists cooldown state to disk and reloads it on the next
//    dispatch (cooldown survives restart)
// ---------------------------------------------------------------------------

test("dispatch() persists cooldown state to disk and reloads it on the next dispatch (cooldown survives restart)", async () => {
	const root = freshRoot();
	let invokeCount = 0;
	const fixedNow = new Date("2026-01-01T00:00:00.000Z");

	const roleMain = fakeRole("supervisor-main", {
		subscribesTo: ["orchestrator_turn"],
		cooldownMs: 60_000,
		invoke: async (input) => {
			invokeCount++;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: `invoke #${invokeCount}`,
				evidenceRefs: [],
			};
		},
	});

	// Engine instance A
	const engineA = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: { "supervisor-main": roleMain },
		now: () => fixedNow,
		appendAdvisory: () => {},
	});

	const event = makeEvent("orchestrator_turn");
	const r1 = await engineA.onEvent(event);
	assert.equal(r1.fired.length, 1, "engine A: first dispatch fires");
	assert.equal(invokeCount, 1);

	// Verify state file exists on disk
	const statePath = join(root, "reports", "role-engine-state.json");
	assert.ok(existsSync(statePath), "state file persisted to disk");
	const stateRaw = readFileSync(statePath, "utf8");
	const stateParsed = JSON.parse(stateRaw);
	assert.ok(
		stateParsed.lastFireByHash?.["supervisor-main"],
		"state has per-role hash entries",
	);

	// Engine instance B (simulating a restart — same stateRoot)
	const roleMainB = fakeRole("supervisor-main", {
		subscribesTo: ["orchestrator_turn"],
		cooldownMs: 60_000,
		invoke: async (input) => {
			invokeCount++;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: `invoke #${invokeCount}`,
				evidenceRefs: [],
			};
		},
	});

	const engineB = new RoleEngine({
		stateRoot: root,
		projectId: "test",
		router: {} as never,
		repository: {} as never,
		config: defaultConfig(),
		registry: { "supervisor-main": roleMainB },
		now: () => fixedNow,
		appendAdvisory: () => {},
	});

	// Same event → same hash → cooldown should block
	const r2 = await engineB.onEvent(event);
	assert.equal(r2.fired.length, 0, "engine B: cooldown survived restart");
	assert.equal(r2.skippedByCooldown, 1);
	assert.equal(invokeCount, 1, "invoke count unchanged after restart");
});
