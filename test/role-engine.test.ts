import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendEvent,
	resolveEventsPath,
	type Event,
	type EventKind,
} from "../src/event-bus.js";
import type { AgentRouter, AgentSession, PromptForRoleResult } from "../src/agent-router.js";
import type { LabDbRepository } from "../src/lab-db-repository.js";
import { createRoleEngine, type RoleEngineDeps } from "../src/role-engine.js";
import type { Role, RoleAdvisory, RoleContext, RoleInput } from "../src/roles/index.js";
import { DEFAULT_ROLE_ENGINE_CONFIG } from "../src/role-engine-config.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-role-engine-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function fakeAdvisory(roleId: Role["name"] extends string ? string : never) {
	return { roleId } as unknown as RoleAdvisory;
}

function noopRouter(): AgentRouter {
	const session: AgentSession = {
		cwd: "/tmp",
		running: false,
		busy: false,
		start() {},
		async prompt() {
			return { ok: true, output: "" } satisfies PromptForRoleResult;
		},
		answerUiRequest() {
			return false;
		},
		cancel() {
			return false;
		},
		stop() {},
	};
	return {
		profiles: [],
		currentProjectId: "p",
		currentCwd: "/tmp",
		activeProfile() {
			throw new Error("not used in role-engine tests");
		},
		activeRuntime() {
			throw new Error("not used");
		},
		labProfiles() {
			return [];
		},
		runtimeForProfile() {
			throw new Error("not used");
		},
		runtimeForAdHocProfile() {
			throw new Error("not used");
		},
		cancelProfiles() {
			return 0;
		},
		select() {
			return undefined;
		},
		setActiveProfile() {
			return undefined;
		},
		startActive() {
			throw new Error("not used");
		},
		async prompt() {
			return { ok: true, output: "" } satisfies PromptForRoleResult;
		},
		async promptForRole() {
			return {
				ok: true,
				output: "fake",
				provider: "fake",
				model: "fake",
				role: "supervisor-main",
			};
		},
		answerActiveUiRequest() {
			return false;
		},
		answerUiRequestForRuntime() {
			return false;
		},
		restartActive() {
			throw new Error("not used");
		},
		stopActive() {
			return false;
		},
		cancelActive() {
			return false;
		},
		resetActiveSession() {},
		setActiveModePrefix() {},
		stopAll() {},
		switchProject() {},
	} as unknown as AgentRouter;
}

function noopRepository(): LabDbRepository {
	return {
		init() {
			return { ok: true };
		},
		recordBugFinding() {},
		recordLabRun() {},
		recordUserSignal() {},
		recordFindingWithProposal() {},
		listOpenFindings() {
			return [];
		},
		getSemanticAuditStats() {
			throw new Error("not used");
		},
		getSemanticAuditCheckpoint() {
			throw new Error("not used");
		},
		createSemanticAuditRun() {},
		updateSemanticAuditCheckpoint() {},
		recordSemanticMemoryItem() {},
		appendInvocation(input) {
			return input;
		},
		listRecentInvocations() {
			return [];
		},
	} as unknown as LabDbRepository;
}

function makeRole(
	opts: Partial<Role> & { name: string; subs: readonly EventKind[] },
): Role {
	return {
		name: opts.name,
		priority: opts.priority ?? 50,
		cooldownMs: opts.cooldownMs ?? 30_000,
		subscribesTo: () => opts.subs,
		shouldFire: opts.shouldFire ?? (() => true),
		invoke: opts.invoke ?? (async () => ({
			roleId: "supervisor-main",
			priority: opts.priority ?? 50,
			ts: new Date().toISOString(),
			advisory: `advisory from ${opts.name}`,
			evidenceRefs: [],
		})),
	};
}

function makeDeps(
	root: string,
	roles: Role[],
	opts: { appendAdvisory?: (a: Omit<RoleAdvisory, never>) => void } = {},
): RoleEngineDeps {
	const written: RoleAdvisory[] = [];
	const appendAdvisory = opts.appendAdvisory ?? ((a) => written.push(a as RoleAdvisory));
	return {
		stateRoot: root,
		projectId: "p",
		router: noopRouter(),
		repository: noopRepository(),
		config: { ...DEFAULT_ROLE_ENGINE_CONFIG, enabled: true },
		rolesByKind: (kind) => roles.filter((r) => r.subscribesTo().includes(kind)),
		appendAdvisory,
		now: () => new Date("2026-06-08T10:00:00.000Z"),
		_collected: written,
	} as unknown as RoleEngineDeps & { _collected: RoleAdvisory[] };
}

function makeEvent(kind: EventKind, payload: Record<string, unknown> = {}): Event {
	return {
		ts: "2026-06-08T10:00:00.000Z",
		kind,
		projectId: "p",
		payload,
		sourceRef: "test",
		evidenceRefs: [],
	};
}

test("dispatch() finds roles that subscribe to a kind and calls them", async () => {
	const root = freshRoot();
	const roleA = makeRole({ name: "A", subs: ["file_changed"], priority: 50 });
	const roleB = makeRole({ name: "B", subs: ["file_changed"], priority: 60 });
	const roleC = makeRole({ name: "C", subs: ["orchestrator_turn"], priority: 90 });
	const deps = makeDeps(root, [roleA, roleB, roleC]);
	const engine = createRoleEngine(deps);
	const result = await engine.onEvent(makeEvent("file_changed", { path: "x.ts" }));
	// Both A and B subscribe; C does not.
	assert.equal(result.fired.length, 2);
	const names = result.fired.map((a) => a.advisory).sort();
	assert.deepEqual(names, ["advisory from A", "advisory from B"]);
});

test("dispatch() honors shouldFire returning false (skips invoke)", async () => {
	const root = freshRoot();
	const calls: string[] = [];
	const roleA = makeRole({
		name: "A",
		subs: ["file_changed"],
		priority: 50,
		shouldFire: () => true,
		invoke: async () => {
			calls.push("A");
			return {
				roleId: "supervisor-main",
				priority: 50,
				ts: "2026-06-08T10:00:00.000Z",
				advisory: "A fired",
				evidenceRefs: [],
			};
		},
	});
	const roleB = makeRole({
		name: "B",
		subs: ["file_changed"],
		priority: 60,
		shouldFire: () => false,
		invoke: async () => {
			calls.push("B");
			return {
				roleId: "supervisor-main",
				priority: 60,
				ts: "2026-06-08T10:00:00.000Z",
				advisory: "B fired",
				evidenceRefs: [],
			};
		},
	});
	const deps = makeDeps(root, [roleA, roleB]);
	const engine = createRoleEngine(deps);
	const result = await engine.onEvent(makeEvent("file_changed"));
	assert.deepEqual(calls, ["A"]);
	assert.equal(result.fired.length, 1);
	assert.equal(result.fired[0]!.advisory, "A fired");
	assert.ok(result.skippedByIdempotency >= 1 || result.skippedByCooldown >= 1);
});

test("dispatch() honors cooldown (same hash within cooldownMs → skip)", async () => {
	const root = freshRoot();
	const calls: string[] = [];
	const role = makeRole({
		name: "A",
		subs: ["file_changed"],
		priority: 50,
		cooldownMs: 60_000,
		invoke: async () => {
			calls.push("A");
			return {
				roleId: "supervisor-main",
				priority: 50,
				ts: "2026-06-08T10:00:00.000Z",
				advisory: "A fired",
				evidenceRefs: [],
			};
		},
	});
	const nowMs = Date.parse("2026-06-08T10:00:00.000Z");
	const deps = makeDeps(root, [role]);
	(deps as unknown as { now: () => Date }).now = () => new Date(nowMs);
	const engine = createRoleEngine(deps);
	// First event: fires.
	const r1 = await engine.onEvent(
		makeEvent("file_changed", { path: "x.ts" }),
	);
	assert.equal(r1.fired.length, 1);
	assert.deepEqual(calls, ["A"]);
	// Same event within cooldown: skipped.
	const r2 = await engine.onEvent(
		makeEvent("file_changed", { path: "x.ts" }),
	);
	assert.equal(r2.fired.length, 0);
	assert.deepEqual(calls, ["A"]);
	assert.ok(r2.skippedByCooldown >= 1, "should report cooldown skip");
	// Different hash (different payload): fires again.
	const r3 = await engine.onEvent(
		makeEvent("file_changed", { path: "y.ts" }),
	);
	assert.equal(r3.fired.length, 1);
	assert.deepEqual(calls, ["A", "A"]);
	// Different timestamp + same payload: also same hash because
	// payload is the same, but the engine re-checks signature.
	// We don't assert further; cooldown + cap are the key cases.
});

test("dispatch() honors MAX_ROLE_INVOCATIONS_PER_TURN and emits exactly one cap warning per turn", async () => {
	const root = freshRoot();
	const roles: Role[] = [];
	for (let i = 0; i < 3; i++) {
		roles.push(
			makeRole({
				name: `R${i}`,
				subs: ["file_changed"],
				priority: 50 - i,
				cooldownMs: 0,
				invoke: async () => ({
					roleId: "supervisor-main",
					priority: 50,
					ts: "2026-06-08T10:00:00.000Z",
					advisory: `R${i} fired`,
					evidenceRefs: [],
				}),
			}),
		);
	}
	const deps = makeDeps(root, roles);
	(deps as unknown as { config: { maxRoleInvocationsPerTurn: number } }).config = {
		...DEFAULT_ROLE_ENGINE_CONFIG,
		enabled: true,
		maxRoleInvocationsPerTurn: 2,
	};
	const engine = createRoleEngine(deps);
	// Pre-emit orchestrator_turn to start the turn (per design §6.1).
	await engine.onEvent(makeEvent("orchestrator_turn", { turnId: "t-1" }));
	// Now file_changed hits the cap.
	const r = await engine.onEvent(makeEvent("file_changed", { path: "a.ts" }));
	assert.equal(r.fired.length, 2, "two roles fired, the third is capped");
	assert.equal(r.capWarning, true);
	assert.ok(r.skippedByCap >= 1);
	// A role_engine_cap_warning event was emitted.
	const events = readFileSync(resolveEventsPath(root), "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Event);
	const capWarnings = events.filter((e) => e.kind === "role_engine_cap_warning");
	assert.equal(capWarnings.length, 1, "exactly one cap warning per turn");
	// A second file_changed in the same turn does NOT re-emit the warning.
	const r2 = await engine.onEvent(makeEvent("file_changed", { path: "b.ts" }));
	assert.equal(r2.capWarning, false);
	const capWarnings2 = readFileSync(resolveEventsPath(root), "utf8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Event)
		.filter((e) => e.kind === "role_engine_cap_warning");
	assert.equal(
		capWarnings2.length,
		1,
		"second event in same turn does not re-emit warning",
	);
});

test("dispatch() appends each successful RoleAdvisory via the appendAdvisory callback", async () => {
	const root = freshRoot();
	const roleA = makeRole({
		name: "A",
		subs: ["file_changed"],
		priority: 50,
		cooldownMs: 0,
	});
	const roleB = makeRole({
		name: "B",
		subs: ["file_changed"],
		priority: 60,
		cooldownMs: 0,
	});
	const collected: Array<Omit<RoleAdvisory, never>> = [];
	const deps = makeDeps(root, [roleA, roleB], {
		appendAdvisory: (a) => collected.push(a),
	});
	const engine = createRoleEngine(deps);
	await engine.onEvent(makeEvent("file_changed", { path: "a.ts" }));
	assert.equal(collected.length, 2);
	// Sorted by priority DESC.
	assert.equal(collected[0]!.advisory, "advisory from B");
	assert.equal(collected[1]!.advisory, "advisory from A");
});
