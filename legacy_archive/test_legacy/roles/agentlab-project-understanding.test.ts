/**
 * agentlab-project-understanding role tests — T3.7.
 *
 * Locks the agentlab-project-understanding role contract:
 * - subscribes to project_map_changed, blueprint_edited
 * - priority 35, cooldownMs 600000 (10 minutes)
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
import { createAgentLabProjectUnderstandingRole } from "../../src/roles/agentlab-project-understanding.js";
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

function makeInput(
	event: Event,
	signature = "sig-proj-understanding-123",
): RoleInput {
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
// 1. subscribes to project_map_changed, blueprint_edited
// ---------------------------------------------------------------------------

test("agentlab-project-understanding subscribes to project_map_changed, blueprint_edited", () => {
	const role = createAgentLabProjectUnderstandingRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("project_map_changed"));
	assert.ok(subs.includes("blueprint_edited"));
});

// ---------------------------------------------------------------------------
// 2. priority 35
// ---------------------------------------------------------------------------

test("agentlab-project-understanding has priority 35", () => {
	const role = createAgentLabProjectUnderstandingRole();
	assert.equal(role.priority, 35);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 600000 (10 minutes)
// ---------------------------------------------------------------------------

test("agentlab-project-understanding has cooldownMs 600000", () => {
	const role = createAgentLabProjectUnderstandingRole();
	assert.equal(role.cooldownMs, 600_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for project_map_changed
// ---------------------------------------------------------------------------

test("shouldFire returns true for project_map_changed", () => {
	const role = createAgentLabProjectUnderstandingRole();
	const event = makeEvent("project_map_changed", {
		delta: { added: ["src/new-module.ts"] },
	});
	const input = makeInput(event, "sig-proj-map-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for project_map_changed",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns true for blueprint_edited
// ---------------------------------------------------------------------------

test("shouldFire returns true for blueprint_edited", () => {
	const role = createAgentLabProjectUnderstandingRole();
	const event = makeEvent("blueprint_edited", {
		blueprintId: "architecture-v2",
		changes: ["module added"],
	});
	const input = makeInput(event, "sig-blueprint-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for blueprint_edited",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns false for non-matching events
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed", () => {
	const role = createAgentLabProjectUnderstandingRole();
	const event = makeEvent("file_changed", { path: "src/test.ts" });
	const input = makeInput(event, "sig-non-matching-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false for non-subscribed events",
	);
});

// ---------------------------------------------------------------------------
// 7. invoke calls promptForRole with role="agentlab-project-understanding"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-project-understanding'", async () => {
	const role = createAgentLabProjectUnderstandingRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "project-shape-drift",
				description: "New module added without documentation",
				severity: "medium",
			},
		],
		summary: "Project understanding review: 1 finding",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("project_map_changed", {
		delta: { added: ["new.ts"] },
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-proj-understanding",
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
	assert.equal(calls[0]!.role, "agentlab-project-understanding");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 8. invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabProjectUnderstandingRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "missing-doc",
				description: "New module lacks README",
				severity: "low",
			},
			{
				type: "blueprint-inconsistency",
				description: "Module structure differs from blueprint",
				severity: "medium",
			},
		],
		summary: "2 findings detected",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("blueprint_edited", {
		blueprintId: "arch-v2",
		changes: ["updated"],
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-proj-understanding",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-project-understanding");
	assert.equal(advisory.priority, 35);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(
		Array.isArray(advisory.meta!.findings),
		"findings must be an array",
	);
	assert.equal(advisory.meta!.findings.length, 2);
	assert.equal(advisory.meta!.findings[0].type, "missing-doc");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. invoke handles malformed LLM response with fallback (empty findings)
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty findings", async () => {
	const role = createAgentLabProjectUnderstandingRole();
	const { router } = makeFakeAgentRouter("this is not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("project_map_changed", { delta: {} });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-proj-understanding",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-project-understanding");
	assert.equal(advisory.priority, 35);
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
// 10. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 10 min → skip)", () => {
	const role = createAgentLabProjectUnderstandingRole();
	const event = makeEvent("project_map_changed", {
		delta: { added: ["test.ts"] },
	});
	const input = makeInput(event, "sig-cooldown-proj-understanding");

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
