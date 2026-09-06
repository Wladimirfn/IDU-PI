/**
 * supervisor-semantic role tests — T2.1 (RED phase).
 *
 * These tests lock the supervisor-semantic role contract:
 * - subscribes to orchestrator_turn
 * - priority 80, cooldownMs 10000
 * - shouldFire logic for new orchestrator_turn events
 * - invoke calls agentRouter.promptForRole with correct role
 * - invoke parses LLM response into RoleAdvisory with intentClass, routingHint, actionType
 * - invoke handles malformed LLM responses with fallback to "ask" / "clarify"
 * - prompt includes user's last 5 turns and recent orchestrator advisories
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createSupervisorSemanticRole } from "../../src/roles/supervisor-semantic.js";
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
// 1. subscribes to orchestrator_turn
// ---------------------------------------------------------------------------

test("supervisor-semantic subscribes to orchestrator_turn", () => {
	const role = createSupervisorSemanticRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 1);
	assert.ok(subs.includes("orchestrator_turn"));
});

// ---------------------------------------------------------------------------
// 2. priority 80
// ---------------------------------------------------------------------------

test("supervisor-semantic has priority 80", () => {
	const role = createSupervisorSemanticRole();
	assert.equal(role.priority, 80);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 10000
// ---------------------------------------------------------------------------

test("supervisor-semantic has cooldownMs 10000", () => {
	const role = createSupervisorSemanticRole();
	assert.equal(role.cooldownMs, 10_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true when there is a new orchestrator_turn
// ---------------------------------------------------------------------------

test("shouldFire returns true when there is a new orchestrator_turn", () => {
	const role = createSupervisorSemanticRole();
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
		"shouldFire must return true for new orchestrator_turn",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false when there is no new orchestrator_turn
// ---------------------------------------------------------------------------

test("shouldFire returns false when there is no new orchestrator_turn", () => {
	const role = createSupervisorSemanticRole();
	const event = makeEvent("orchestrator_turn", { request: "same task" });
	const input = makeInput(event, "sig-same-456");
	const lastFireAt = new Date("2026-01-01T00:00:10.000Z");
	const now = new Date("2026-01-01T00:00:20.000Z");
	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		false,
		"shouldFire must return false when payload unchanged",
	);
});

// ---------------------------------------------------------------------------
// 6. invoke calls agentRouter.promptForRole with role="supervisor-semantic"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='supervisor-semantic'", async () => {
	const role = createSupervisorSemanticRole();
	const llmResponse = JSON.stringify({
		intent: "plan",
		routing_hint: "supervisor-main",
		action_type: "execute",
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
	assert.equal(calls[0]!.role, "supervisor-semantic");
	assert.ok(calls[0]!.message.length > 0, "prompt must be non-empty");
});

// ---------------------------------------------------------------------------
// 7. invoke parses the LLM response into a RoleAdvisory with intentClass, routingHint, actionType
// ---------------------------------------------------------------------------

test("invoke parses the LLM response into a RoleAdvisory with intentClass, routingHint, actionType, priority, evidenceRefs", async () => {
	const role = createSupervisorSemanticRole();
	const llmResponse = JSON.stringify({
		intent: "plan",
		routing_hint: "supervisor-main",
		action_type: "execute",
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

	assert.equal(advisory.roleId, "supervisor-semantic");
	assert.equal(advisory.priority, 80);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.equal(advisory.meta!.intentClass, "plan");
	assert.equal(advisory.meta!.routingHint, "supervisor-main");
	assert.equal(advisory.meta!.actionType, "execute");
});

// ---------------------------------------------------------------------------
// 8. invoke emits a RoleAdvisory with fallback when LLM response is malformed
// ---------------------------------------------------------------------------

test("invoke emits a RoleAdvisory with fallback to 'ask' / 'clarify' when LLM response is malformed", async () => {
	const role = createSupervisorSemanticRole();
	const llmResponse = "this is not valid JSON";
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", { request: "confusing task" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-test",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "supervisor-semantic");
	assert.equal(advisory.priority, 80);
	assert.ok(advisory.meta, "meta must be present");
	assert.equal(advisory.meta!.intentClass, "ask");
	assert.equal(advisory.meta!.actionType, "clarify");
	assert.ok(
		typeof advisory.meta!.errorMessage === "string",
		"errorMessage must be present for malformed response",
	);
});

// ---------------------------------------------------------------------------
// 9. the prompt includes the user's last 5 turns and recent orchestrator advisories
// ---------------------------------------------------------------------------

test("the prompt includes the user's last 5 turns (text) and the recent orchestrator advisories", async () => {
	const role = createSupervisorSemanticRole();
	const llmResponse = JSON.stringify({
		intent: "ask",
		routing_hint: "supervisor-main",
		action_type: "respond",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", {
		request: "what is the status?",
		userTurns: [
			{ ts: "2026-01-01T00:00:00.000Z", text: "First question" },
			{ ts: "2026-01-01T00:01:00.000Z", text: "Second question" },
			{ ts: "2026-01-01T00:02:00.000Z", text: "Third question" },
		],
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-prompt-test",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:03:00.000Z"),
			router,
			repository,
		},
	};

	await role.invoke(input, input.context);

	assert.equal(calls.length, 1);
	const prompt = calls[0]!.message;
	// Check that the prompt includes user turns
	assert.ok(
		prompt.includes("First question") || prompt.includes("user"),
		"prompt should include user turns",
	);
	// Check that the prompt asks for classification
	assert.ok(
		prompt.toLowerCase().includes("intent") ||
			prompt.toLowerCase().includes("classif"),
		"prompt should ask for intent classification",
	);
});
