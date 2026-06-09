/**
 * agentlab-architecture role tests — T3.1.
 *
 * Locks the agentlab-architecture role contract:
 * - subscribes to file_changed, module_added, breaking_change
 * - priority 60, cooldownMs 300000 (5 minutes)
 * - shouldFire logic: file_changed with addedLines > 200, module_added, breaking_change
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with drifts, summary, priority, evidenceRefs
 * - invoke handles malformed LLM response with fallback (empty drifts)
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createAgentLabArchitectureRole, ARCH_ADDED_LINES_THRESHOLD } from "../../src/roles/agentlab-architecture.js";
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

function makeInput(event: Event, signature = "sig-arch-123"): RoleInput {
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
// 1. subscribes to file_changed, module_added, breaking_change
// ---------------------------------------------------------------------------

test("agentlab-architecture subscribes to file_changed, module_added, breaking_change", () => {
	const role = createAgentLabArchitectureRole();
	const subs = role.subscribesTo();
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("module_added"));
	assert.ok(subs.includes("breaking_change"));
});

// ---------------------------------------------------------------------------
// 2. priority 60
// ---------------------------------------------------------------------------

test("agentlab-architecture has priority 60", () => {
	const role = createAgentLabArchitectureRole();
	assert.equal(role.priority, 60);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 300000 (5 minutes)
// ---------------------------------------------------------------------------

test("agentlab-architecture has cooldownMs 300000", () => {
	const role = createAgentLabArchitectureRole();
	assert.equal(role.cooldownMs, 300_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for file_changed with addedLines > 200
// ---------------------------------------------------------------------------

test("shouldFire returns true for file_changed with addedLines > threshold", () => {
	const role = createAgentLabArchitectureRole();
	const event = makeEvent("file_changed", { path: "src/engine.ts", addedLines: 250 });
	const input = makeInput(event, "sig-arch-big-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true when addedLines > threshold");
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for file_changed with addedLines <= threshold
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed with addedLines <= threshold", () => {
	const role = createAgentLabArchitectureRole();
	const event = makeEvent("file_changed", { path: "src/small.ts", addedLines: 50 });
	const input = makeInput(event, "sig-arch-small-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, false, "shouldFire must return false when addedLines <= threshold");
});

test("shouldFire returns true for module_added", () => {
	const role = createAgentLabArchitectureRole();
	const event = makeEvent("module_added", { moduleName: "new-module" });
	const input = makeInput(event, "sig-arch-mod-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true);
});

test("shouldFire returns true for breaking_change", () => {
	const role = createAgentLabArchitectureRole();
	const event = makeEvent("breaking_change", { description: "API changed" });
	const input = makeInput(event, "sig-arch-brk-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true);
});

// ---------------------------------------------------------------------------
// 6. invoke calls promptForRole with role="agentlab-architecture"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-architecture'", async () => {
	const role = createAgentLabArchitectureRole();
	const llmResponse = JSON.stringify({
		drifts: [
			{
				kind: "layering",
				contract: "src/roles/index.ts",
				description: "Role module imports from engine directly",
				evidence: "src/roles/foo.ts:3",
			},
		],
		summary: "Architecture review: 1 drift found",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("module_added", { moduleName: "new-module" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-arch",
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
	assert.equal(calls[0]!.role, "agentlab-architecture");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 7. invoke parses LLM response into RoleAdvisory with drifts, summary, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with drifts, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabArchitectureRole();
	const llmResponse = JSON.stringify({
		drifts: [
			{
				kind: "contract-violation",
				contract: "src/roles/index.ts",
				description: "Role bypasses engine dispatch",
				evidence: "src/roles/foo.ts:10",
			},
			{
				kind: "layering",
				contract: "src/event-bus.ts",
				description: "Direct DB access from role module",
				evidence: "src/roles/bar.ts:5",
			},
		],
		summary: "2 architecture drifts detected",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("breaking_change", { description: "API shape changed" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-arch",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-architecture");
	assert.equal(advisory.priority, 60);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.drifts), "drifts must be an array");
	assert.equal(advisory.meta!.drifts.length, 2);
	assert.equal(advisory.meta!.drifts[0].kind, "contract-violation");
	assert.equal(advisory.meta!.drifts[0].contract, "src/roles/index.ts");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 8. invoke handles malformed LLM response with fallback (empty drifts)
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty drifts", async () => {
	const role = createAgentLabArchitectureRole();
	const { router } = makeFakeAgentRouter("this is not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("module_added", { moduleName: "broken" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-arch",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-architecture");
	assert.equal(advisory.priority, 60);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.drifts), "drifts must be an array");
	assert.equal(advisory.meta!.drifts.length, 0, "drifts must be empty for malformed response");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 5 min → skip)", () => {
	const role = createAgentLabArchitectureRole();
	const event = makeEvent("module_added", { moduleName: "test-mod" });
	const input = makeInput(event, "sig-cooldown-arch");

	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:03:00.000Z"); // 3 min later, within 5 min cooldown

	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(result, false, "shouldFire must return false within cooldown window");

	const afterCooldown = new Date("2026-01-01T00:06:00.000Z"); // 6 min later
	const resultAfter = role.shouldFire(input, lastFireAt, afterCooldown);
	assert.equal(resultAfter, true, "shouldFire must return true after cooldown expires");
});

// ---------------------------------------------------------------------------
// Bonus: ARCH_ADDED_LINES_THRESHOLD is exported
// ---------------------------------------------------------------------------

test("ARCH_ADDED_LINES_THRESHOLD is exported and equals 200", () => {
	assert.equal(ARCH_ADDED_LINES_THRESHOLD, 200);
});
