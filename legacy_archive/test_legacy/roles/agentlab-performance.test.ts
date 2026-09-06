/**
 * agentlab-performance role tests — T3.4.
 *
 * Locks the agentlab-performance role contract:
 * - subscribes to file_changed (hot path), bundle_size_grew
 * - priority 50, cooldownMs 300000 (5 minutes)
 * - shouldFire logic: file_changed with isHotPath === true, bundle_size_grew
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with regressions, p50Estimate, p95Estimate
 * - invoke handles malformed LLM response with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createAgentLabPerformanceRole } from "../../src/roles/agentlab-performance.js";
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

function makeInput(event: Event, signature = "sig-perf-123"): RoleInput {
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
// 1. subscribes to file_changed, bundle_size_grew
// ---------------------------------------------------------------------------

test("agentlab-performance subscribes to file_changed, bundle_size_grew", () => {
	const role = createAgentLabPerformanceRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("bundle_size_grew"));
});

// ---------------------------------------------------------------------------
// 2. priority 50
// ---------------------------------------------------------------------------

test("agentlab-performance has priority 50", () => {
	const role = createAgentLabPerformanceRole();
	assert.equal(role.priority, 50);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 300000 (5 minutes)
// ---------------------------------------------------------------------------

test("agentlab-performance has cooldownMs 300000", () => {
	const role = createAgentLabPerformanceRole();
	assert.equal(role.cooldownMs, 300_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for file_changed with isHotPath === true
// ---------------------------------------------------------------------------

test("shouldFire returns true for file_changed with isHotPath === true", () => {
	const role = createAgentLabPerformanceRole();
	const event = makeEvent("file_changed", {
		path: "src/services/handler.ts",
		isHotPath: true,
	});
	const input = makeInput(event, "sig-perf-hot-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true when isHotPath === true",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for file_changed with isHotPath === false or missing
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed with isHotPath === false", () => {
	const role = createAgentLabPerformanceRole();
	const event = makeEvent("file_changed", {
		path: "src/utils.ts",
		isHotPath: false,
	});
	const input = makeInput(event, "sig-perf-cold-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false when isHotPath === false",
	);
});

test("shouldFire returns false for file_changed without isHotPath", () => {
	const role = createAgentLabPerformanceRole();
	const event = makeEvent("file_changed", {
		path: "src/utils.ts",
	});
	const input = makeInput(event, "sig-perf-no-hot-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false when isHotPath is missing",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns true for bundle_size_grew
// ---------------------------------------------------------------------------

test("shouldFire returns true for bundle_size_grew", () => {
	const role = createAgentLabPerformanceRole();
	const event = makeEvent("bundle_size_grew", {
		bundlePath: "dist/bundle.js",
		oldSize: 1024000,
		newSize: 1048576,
	});
	const input = makeInput(event, "sig-perf-bundle-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for bundle_size_grew",
	);
});

// ---------------------------------------------------------------------------
// 7. invoke calls promptForRole with role="agentlab-performance"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-performance'", async () => {
	const role = createAgentLabPerformanceRole();
	const llmResponse = JSON.stringify({
		regressions: [
			{
				path: "src/services/handler.ts",
				p50Estimate: 150,
				p95Estimate: 450,
				evidence: "Added synchronous DB call in hot path",
			},
		],
		summary: "Performance review: 1 regression found",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", {
		path: "src/services/handler.ts",
		isHotPath: true,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-perf",
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
	assert.equal(calls[0]!.role, "agentlab-performance");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 8. invoke parses LLM response into RoleAdvisory with regressions, p50Estimate, p95Estimate
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with regressions, p50Estimate, p95Estimate", async () => {
	const role = createAgentLabPerformanceRole();
	const llmResponse = JSON.stringify({
		regressions: [
			{
				path: "src/services/handler.ts",
				p50Estimate: 150,
				p95Estimate: 450,
				evidence: "Added synchronous DB call",
			},
			{
				path: "src/controllers/api.ts",
				p50Estimate: 200,
				p95Estimate: 600,
				evidence: "Removed caching layer",
			},
		],
		summary: "2 performance regressions detected",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("bundle_size_grew", {
		bundlePath: "dist/bundle.js",
		oldSize: 1024000,
		newSize: 1048576,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-perf",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-performance");
	assert.equal(advisory.priority, 50);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(
		Array.isArray(advisory.meta!.regressions),
		"regressions must be an array",
	);
	assert.equal(advisory.meta!.regressions.length, 2);
	assert.equal(advisory.meta!.regressions[0].p50Estimate, 150);
	assert.equal(advisory.meta!.regressions[0].p95Estimate, 450);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. invoke handles malformed LLM response with fallback (empty regressions)
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty regressions", async () => {
	const role = createAgentLabPerformanceRole();
	const { router } = makeFakeAgentRouter("this is not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("bundle_size_grew", {
		bundlePath: "dist/bundle.js",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-perf",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-performance");
	assert.equal(advisory.priority, 50);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(
		Array.isArray(advisory.meta!.regressions),
		"regressions must be an array",
	);
	assert.equal(
		advisory.meta!.regressions.length,
		0,
		"regressions must be empty for malformed response",
	);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 10. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 5 min → skip)", () => {
	const role = createAgentLabPerformanceRole();
	const event = makeEvent("bundle_size_grew", {
		bundlePath: "dist/bundle.js",
	});
	const input = makeInput(event, "sig-cooldown-perf");

	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:03:00.000Z"); // 3 min later, within 5 min cooldown

	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		false,
		"shouldFire must return false within cooldown window",
	);

	const afterCooldown = new Date("2026-01-01T00:06:00.000Z"); // 6 min later
	const resultAfter = role.shouldFire(input, lastFireAt, afterCooldown);
	assert.equal(
		resultAfter,
		true,
		"shouldFire must return true after cooldown expires",
	);
});
