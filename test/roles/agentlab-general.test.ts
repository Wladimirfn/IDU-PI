/**
 * agentlab-general role tests — T3.8.
 *
 * Locks the agentlab-general role contract:
 * - subscribes to every event kind (fallback role)
 * - priority 20, cooldownMs 600000 (10 minutes)
 * - shouldFire logic: any subscribed event kind
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs
 * - invoke handles malformed LLM response with fallback (empty findings)
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput } from "../../src/roles/index.js";
import { createAgentLabGeneralRole } from "../../src/roles/agentlab-general.js";
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

function makeInput(event: Event, signature = "sig-general-123"): RoleInput {
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
// 1. subscribes to every event kind (fallback role)
// ---------------------------------------------------------------------------

test("agentlab-general subscribes to every event kind (fallback)", () => {
	const role = createAgentLabGeneralRole();
	const subs = role.subscribesTo();
	// Fallback role listens to all key event kinds
	assert.ok(subs.includes("orchestrator_turn"));
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("lab_write"));
	assert.ok(subs.includes("module_added"));
	assert.ok(subs.includes("breaking_change"));
	assert.ok(subs.includes("dependency_bumped"));
});

// ---------------------------------------------------------------------------
// 2. priority 20
// ---------------------------------------------------------------------------

test("agentlab-general has priority 20", () => {
	const role = createAgentLabGeneralRole();
	assert.equal(role.priority, 20);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 600000 (10 minutes)
// ---------------------------------------------------------------------------

test("agentlab-general has cooldownMs 600000", () => {
	const role = createAgentLabGeneralRole();
	assert.equal(role.cooldownMs, 600_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for matching events
// ---------------------------------------------------------------------------

test("shouldFire returns true for orchestrator_turn", () => {
	const role = createAgentLabGeneralRole();
	const event = makeEvent("orchestrator_turn", {
		request: "implement feature X",
	});
	const input = makeInput(event, "sig-orch-turn-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for orchestrator_turn",
	);
});

test("shouldFire returns true for file_changed", () => {
	const role = createAgentLabGeneralRole();
	const event = makeEvent("file_changed", { path: "src/test.ts" });
	const input = makeInput(event, "sig-file-changed-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for file_changed");
});

test("shouldFire returns true for lab_write", () => {
	const role = createAgentLabGeneralRole();
	const event = makeEvent("lab_write", { topic: "test" });
	const input = makeInput(event, "sig-lab-write-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for lab_write");
});

// ---------------------------------------------------------------------------
// 5. invoke calls promptForRole with role="agentlab-general"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-general'", async () => {
	const role = createAgentLabGeneralRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "general-drift",
				description: "Unusual pattern detected",
				severity: "low",
			},
		],
		summary: "General review: 1 finding",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("orchestrator_turn", { request: "test" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-general",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	await role.invoke(input, input.context);

	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.role, "agentlab-general");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 6. invoke parses LLM response into RoleAdvisory
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabGeneralRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "general-drift",
				description: "Unexpected code pattern",
				severity: "medium",
			},
		],
		summary: "General review completed",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/module.ts" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-general",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-general");
	assert.equal(advisory.priority, 20);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(
		Array.isArray(advisory.meta!.findings),
		"findings must be an array",
	);
	assert.equal(advisory.meta!.findings.length, 1);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 7. invoke handles malformed LLM response with fallback
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty findings", async () => {
	const role = createAgentLabGeneralRole();
	const { router } = makeFakeAgentRouter("not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/test.ts" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-general",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-general");
	assert.equal(advisory.priority, 20);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(
		Array.isArray(advisory.meta!.findings),
		"findings must be an array",
	);
	assert.equal(
		advisory.meta!.findings.length,
		0,
		"findings must be empty for malformed response",
	);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 8. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 10 min → skip)", () => {
	const role = createAgentLabGeneralRole();
	const event = makeEvent("orchestrator_turn", { request: "test" });
	const input = makeInput(event, "sig-cooldown-general");

	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:05:00.000Z"); // 5 min later, within 10 min cooldown

	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		false,
		"shouldFire must return false within cooldown window",
	);

	const afterCooldown = new Date("2026-01-01T00:11:00.000Z"); // 11 min later
	const resultAfter = role.shouldFire(input, lastFireAt, afterCooldown);
	assert.equal(
		resultAfter,
		true,
		"shouldFire must return true after cooldown expires",
	);
});
