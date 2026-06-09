/**
 * agentlab-code-quality role tests — T3.5.
 *
 * Locks the agentlab-code-quality role contract:
 * - subscribes to complexity_threshold, lint_regression, dead_code
 * - priority 30, cooldownMs 600000 (10 minutes)
 * - shouldFire logic for all three event kinds
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with issues array
 * - invoke handles malformed LLM response with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput } from "../../src/roles/index.js";
import { createAgentLabCodeQualityRole } from "../../src/roles/agentlab-code-quality.js";
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

function makeInput(event: Event, signature = "sig-cq-123"): RoleInput {
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
// 1. subscribes to complexity_threshold, lint_regression, dead_code
// ---------------------------------------------------------------------------

test("agentlab-code-quality subscribes to complexity_threshold, lint_regression, dead_code", () => {
	const role = createAgentLabCodeQualityRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 3);
	assert.ok(subs.includes("complexity_threshold"));
	assert.ok(subs.includes("lint_regression"));
	assert.ok(subs.includes("dead_code"));
});

// ---------------------------------------------------------------------------
// 2. priority 30
// ---------------------------------------------------------------------------

test("agentlab-code-quality has priority 30", () => {
	const role = createAgentLabCodeQualityRole();
	assert.equal(role.priority, 30);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 600000 (10 minutes)
// ---------------------------------------------------------------------------

test("agentlab-code-quality has cooldownMs 600000", () => {
	const role = createAgentLabCodeQualityRole();
	assert.equal(role.cooldownMs, 600_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for complexity_threshold
// ---------------------------------------------------------------------------

test("shouldFire returns true for complexity_threshold", () => {
	const role = createAgentLabCodeQualityRole();
	const event = makeEvent("complexity_threshold", {
		path: "src/engine.ts",
		cyclomatic: 25,
	});
	const input = makeInput(event, "sig-cq-complex-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for complexity_threshold",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns true for lint_regression
// ---------------------------------------------------------------------------

test("shouldFire returns true for lint_regression", () => {
	const role = createAgentLabCodeQualityRole();
	const event = makeEvent("lint_regression", {
		path: "src/utils.ts",
		newErrors: 5,
	});
	const input = makeInput(event, "sig-cq-lint-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for lint_regression");
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns true for dead_code
// ---------------------------------------------------------------------------

test("shouldFire returns true for dead_code", () => {
	const role = createAgentLabCodeQualityRole();
	const event = makeEvent("dead_code", {
		path: "src/legacy.ts",
		functionName: "unusedHelper",
	});
	const input = makeInput(event, "sig-cq-dead-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for dead_code");
});

// ---------------------------------------------------------------------------
// 7. shouldFire returns false for non-matching events
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed (not subscribed)", () => {
	const role = createAgentLabCodeQualityRole();
	const event = makeEvent("file_changed", {
		path: "src/engine.ts",
	});
	const input = makeInput(event, "sig-cq-fc-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false for non-subscribed kinds",
	);
});

// ---------------------------------------------------------------------------
// 8. invoke calls promptForRole with role="agentlab-code-quality"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-code-quality'", async () => {
	const role = createAgentLabCodeQualityRole();
	const llmResponse = JSON.stringify({
		issues: [
			{
				type: "complexity",
				path: "src/engine.ts",
				description: "Cyclomatic complexity 25 exceeds threshold 20",
				refactorHint: "Extract helper functions to reduce complexity",
			},
		],
		summary: "Code quality review: 1 issue found",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("complexity_threshold", {
		path: "src/engine.ts",
		cyclomatic: 25,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-cq",
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
	assert.equal(calls[0]!.role, "agentlab-code-quality");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 9. invoke parses LLM response into RoleAdvisory with issues array
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with issues array", async () => {
	const role = createAgentLabCodeQualityRole();
	const llmResponse = JSON.stringify({
		issues: [
			{
				type: "complexity",
				path: "src/engine.ts",
				description: "High cyclomatic complexity",
				refactorHint: "Extract helpers",
			},
			{
				type: "lint",
				path: "src/utils.ts",
				description: "Unused import",
				refactorHint: "Remove unused import",
			},
		],
		summary: "2 code quality issues",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("lint_regression", {
		path: "src/utils.ts",
		newErrors: 2,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-cq",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-code-quality");
	assert.equal(advisory.priority, 30);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.issues), "issues must be an array");
	assert.equal(advisory.meta!.issues.length, 2);
	assert.equal(advisory.meta!.issues[0].type, "complexity");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 10. invoke handles malformed LLM response with fallback (empty issues)
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty issues", async () => {
	const role = createAgentLabCodeQualityRole();
	const { router } = makeFakeAgentRouter("not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("dead_code", {
		path: "src/legacy.ts",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-cq",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-code-quality");
	assert.equal(advisory.priority, 30);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.issues), "issues must be an array");
	assert.equal(
		advisory.meta!.issues.length,
		0,
		"issues must be empty for malformed response",
	);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 11. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 10 min → skip)", () => {
	const role = createAgentLabCodeQualityRole();
	const event = makeEvent("complexity_threshold", {
		path: "src/engine.ts",
	});
	const input = makeInput(event, "sig-cooldown-cq");

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
