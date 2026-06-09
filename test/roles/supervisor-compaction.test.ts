/**
 * supervisor-compaction role tests — T2.2 (RED phase).
 *
 * These tests lock the supervisor-compaction role contract:
 * - subscribes to context_budget_grew, orchestrator_turn
 * - priority 70, cooldownMs 60000
 * - shouldFire logic for budget events
 * - invoke calls agentRouter.promptForRole with correct role
 * - invoke parses LLM response into RoleAdvisory with keepItems, dropItems, summarizeItems, tokenEstimate
 * - invoke handles malformed LLM responses with fallback
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createSupervisorCompactionRole } from "../../src/roles/supervisor-compaction.js";
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
// 1. subscribes to context_budget_grew, orchestrator_turn
// ---------------------------------------------------------------------------

test("supervisor-compaction subscribes to context_budget_grew, orchestrator_turn", () => {
	const role = createSupervisorCompactionRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("context_budget_grew"));
	assert.ok(subs.includes("orchestrator_turn"));
});

// ---------------------------------------------------------------------------
// 2. priority 70
// ---------------------------------------------------------------------------

test("supervisor-compaction has priority 70", () => {
	const role = createSupervisorCompactionRole();
	assert.equal(role.priority, 70);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 60000
// ---------------------------------------------------------------------------

test("supervisor-compaction has cooldownMs 60000", () => {
	const role = createSupervisorCompactionRole();
	assert.equal(role.cooldownMs, 60_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true when a context_budget_grew event arrives
// ---------------------------------------------------------------------------

test("shouldFire returns true when a context_budget_grew event arrives", () => {
	const role = createSupervisorCompactionRole();
	const event = makeEvent("context_budget_grew", { budgetPct: 85 });
	const input = makeInput(event, "sig-budget-123");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for context_budget_grew event",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns true when an orchestrator_turn event arrives with budgetRatio > 0.8
// ---------------------------------------------------------------------------

test("shouldFire returns true when an orchestrator_turn event arrives with budgetRatio > 0.8", () => {
	const role = createSupervisorCompactionRole();
	const event = makeEvent("orchestrator_turn", { budgetRatio: 0.85 });
	const input = makeInput(event, "sig-turn-high-456");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for orchestrator_turn with budgetRatio > 0.8",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns false when an orchestrator_turn event arrives with budgetRatio <= 0.8
// ---------------------------------------------------------------------------

test("shouldFire returns false when an orchestrator_turn event arrives with budgetRatio <= 0.8", () => {
	const role = createSupervisorCompactionRole();
	const event = makeEvent("orchestrator_turn", { budgetRatio: 0.75 });
	const input = makeInput(event, "sig-turn-low-789");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false for orchestrator_turn with budgetRatio <= 0.8",
	);
});

// ---------------------------------------------------------------------------
// 7. invoke calls agentRouter.promptForRole with role="supervisor-compaction"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='supervisor-compaction'", async () => {
	const role = createSupervisorCompactionRole();
	const llmResponse = JSON.stringify({
		keep: ["item1", "item2"],
		drop: ["item3"],
		summarize: ["item4"],
		tokenEstimate: 500,
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("context_budget_grew", { budgetRatio: 0.85 });
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
	assert.equal(calls[0]!.role, "supervisor-compaction");
	assert.ok(calls[0]!.message.length > 0, "prompt must be non-empty");
});

// ---------------------------------------------------------------------------
// 8. invoke parses the LLM response into a RoleAdvisory with keepItems, dropItems, summarizeItems, tokenEstimate, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses the LLM response into a RoleAdvisory with keepItems, dropItems, summarizeItems, tokenEstimate, priority, evidenceRefs", async () => {
	const role = createSupervisorCompactionRole();
	const llmResponse = JSON.stringify({
		keep: ["important-context", "user-prefs"],
		drop: ["old-debug-logs", "verbose-output"],
		summarize: ["long-conversation-history", "detailed-analysis"],
		tokenEstimate: 1200,
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("context_budget_grew", { budgetRatio: 0.9 });
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

	assert.equal(advisory.roleId, "supervisor-compaction");
	assert.equal(advisory.priority, 70);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.keepItems));
	assert.ok(Array.isArray(advisory.meta!.dropItems));
	assert.ok(Array.isArray(advisory.meta!.summarizeItems));
	assert.equal(typeof advisory.meta!.tokenEstimate, "number");
	assert.equal(advisory.meta!.keepItems.length, 2);
	assert.equal(advisory.meta!.dropItems.length, 2);
	assert.equal(advisory.meta!.summarizeItems.length, 2);
	assert.equal(advisory.meta!.tokenEstimate, 1200);
});

// ---------------------------------------------------------------------------
// 9. invoke handles a malformed LLM response by returning a fallback advisory with empty lists and tokenEstimate=0
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty lists and tokenEstimate=0", async () => {
	const role = createSupervisorCompactionRole();
	const llmResponse = "this is not valid JSON";
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("context_budget_grew", { budgetRatio: 0.95 });
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

	assert.equal(advisory.roleId, "supervisor-compaction");
	assert.equal(advisory.priority, 70);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.keepItems));
	assert.ok(Array.isArray(advisory.meta!.dropItems));
	assert.ok(Array.isArray(advisory.meta!.summarizeItems));
	assert.equal(advisory.meta!.keepItems.length, 0, "keepItems must be empty");
	assert.equal(advisory.meta!.dropItems.length, 0, "dropItems must be empty");
	assert.equal(advisory.meta!.summarizeItems.length, 0, "summarizeItems must be empty");
	assert.equal(advisory.meta!.tokenEstimate, 0, "tokenEstimate must be 0");
});
