/**
 * supervisor-main role tests — T1.6 (RED phase).
 *
 * These tests lock the supervisor-main role contract:
 * - subscribes to orchestrator_turn, alerts_scheduled_tick, lab_write
 * - priority 90, cooldownMs 30000
 * - shouldFire logic for each event kind
 * - invoke calls agentRouter.promptForRole with correct role and prompt
 * - invoke parses LLM response into RoleAdvisory with documented shape
 * - invoke sets requires_human=true when LLM says "wait for human"
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createSupervisorMainRole } from "../../src/roles/supervisor-main.js";
import type { AgentRouter } from "../../src/agent-router.js";
import type { LabDbRepository } from "../../src/lab-db-repository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
	kind: EventKind,
	payload: Record<string, unknown> = {},
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

function makeInput(event: Event, signature = "sig-abc123"): RoleInput {
	return {
		event,
		inputSignature: signature,
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router: {} as AgentRouter,
			repository: {} as LabDbRepository,
		},
	};
}

type PromptForRoleCall = {
	role: string;
	message: string;
};

function makeFakeAgentRouter(response: string): {
	router: AgentRouter;
	calls: PromptForRoleCall[];
} {
	const calls: PromptForRoleCall[] = [];
	const router = {
		promptForRole: async (role: string, message: string, _options: unknown) => {
			calls.push({ role, message });
			return {
				ok: true,
				output: response,
				provider: "minimax",
				model: "MiniMax-M3",
				role,
			};
		},
	} as unknown as AgentRouter;
	return { router, calls };
}

function makeFakeRepository(): {
	repository: LabDbRepository;
	invocations: unknown[];
} {
	const invocations: unknown[] = [];
	const repository = {
		appendInvocation: (record: unknown) => {
			invocations.push(record);
			return record;
		},
	} as unknown as LabDbRepository;
	return { repository, invocations };
}

// ---------------------------------------------------------------------------
// 1. subscribes to orchestrator_turn, alerts_scheduled_tick, lab_write
// ---------------------------------------------------------------------------

test("supervisor-main subscribes to orchestrator_turn, alerts_scheduled_tick, lab_write", () => {
	const role = createSupervisorMainRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 3);
	assert.ok(subs.includes("orchestrator_turn"));
	assert.ok(subs.includes("alerts_scheduled_tick"));
	assert.ok(subs.includes("lab_write"));
});

// ---------------------------------------------------------------------------
// 2. priority 90
// ---------------------------------------------------------------------------

test("supervisor-main has priority 90", () => {
	const role = createSupervisorMainRole();
	assert.equal(role.priority, 90);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 30000
// ---------------------------------------------------------------------------

test("supervisor-main has cooldownMs 30000", () => {
	const role = createSupervisorMainRole();
	assert.equal(role.cooldownMs, 30_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true when there is a fresh orchestrator advisory
// ---------------------------------------------------------------------------

test("shouldFire returns true when there is a fresh orchestrator advisory", () => {
	const role = createSupervisorMainRole();
	const event = makeEvent("orchestrator_turn", { request: "new task" });
	const input = makeInput(event, "sig-new-123");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for fresh orchestrator_turn",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false when nothing has changed since the last fire
// ---------------------------------------------------------------------------

test("shouldFire returns false when nothing has changed since the last fire", () => {
	const role = createSupervisorMainRole();
	const event = makeEvent("orchestrator_turn", { request: "same task" });
	const input = makeInput(event, "sig-same-456");
	const lastFireAt = new Date("2026-01-01T00:00:10.000Z");
	const now = new Date("2026-01-01T00:00:20.000Z");
	// Same signature as before (simulated via inputSignature)
	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		false,
		"shouldFire must return false when signature unchanged",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns true on alerts_scheduled_tick (heartbeat)
// ---------------------------------------------------------------------------

test("shouldFire returns true on alerts_scheduled_tick even if the tick is identical (heartbeat)", () => {
	const role = createSupervisorMainRole();
	const event = makeEvent("alerts_scheduled_tick", { tickId: "tick-1" });
	const input = makeInput(event, "sig-tick-789");
	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:01:00.000Z");
	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		true,
		"shouldFire must return true for alerts_scheduled_tick (heartbeat)",
	);
});

// ---------------------------------------------------------------------------
// 7. invoke calls agentRouter.promptForRole with role="supervisor-main"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='supervisor-main' and the assembled prompt", async () => {
	const role = createSupervisorMainRole();
	const llmResponse = JSON.stringify({
		next_action: "approve task",
		priority: 90,
		blocked_items: [],
		risk: "low",
		requires_human: false,
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", { request: "do something" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-test",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	await role.invoke(input, input.context);

	assert.equal(calls.length, 1, "promptForRole must be called exactly once");
	assert.equal(calls[0]!.role, "supervisor-main");
	assert.ok(calls[0]!.message.length > 0, "prompt must be non-empty");
});

// ---------------------------------------------------------------------------
// 8. invoke parses the LLM response into a RoleAdvisory with documented shape
// ---------------------------------------------------------------------------

test("invoke parses the LLM response into a RoleAdvisory with the documented shape", async () => {
	const role = createSupervisorMainRole();
	const llmResponse = JSON.stringify({
		next_action: "approve task",
		priority: 90,
		blocked_items: ["missing approval"],
		risk: "medium",
		requires_human: false,
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", { request: "review PR" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-test",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "supervisor-main");
	assert.equal(advisory.priority, 90);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.equal(advisory.meta!.nextAction, "approve task");
	assert.deepEqual(advisory.meta!.blockedItems, ["missing approval"]);
	assert.equal(advisory.meta!.risk, "medium");
	assert.equal(advisory.meta!.requiresHuman, false);
});

// ---------------------------------------------------------------------------
// 9. invoke sets requires_human=true when LLM says "wait for human"
// ---------------------------------------------------------------------------

test("invoke sets requires_human=true when the LLM response says 'wait for human'", async () => {
	const role = createSupervisorMainRole();
	const llmResponse = JSON.stringify({
		next_action: "wait for human",
		priority: 90,
		blocked_items: ["human approval required"],
		risk: "high",
		requires_human: true,
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", {
		request: "critical decision",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-human-test",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.meta!.nextAction, "wait for human");
	assert.equal(advisory.meta!.requiresHuman, true);
	assert.equal(advisory.meta!.risk, "high");
});
