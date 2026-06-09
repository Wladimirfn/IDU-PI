/**
 * agentlab-docs role tests — T3.6.
 *
 * Locks the agentlab-docs role contract:
 * - subscribes to public_api_added (without docs), broken_link
 * - priority 30, cooldownMs 600000 (10 minutes)
 * - shouldFire logic: public_api_added with docsPresent === false, broken_link
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with gaps and brokenLinks
 * - invoke handles malformed LLM response with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput } from "../../src/roles/index.js";
import { createAgentLabDocsRole } from "../../src/roles/agentlab-docs.js";
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

function makeInput(event: Event, signature = "sig-docs-123"): RoleInput {
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
// 1. subscribes to public_api_added, broken_link
// ---------------------------------------------------------------------------

test("agentlab-docs subscribes to public_api_added, broken_link", () => {
	const role = createAgentLabDocsRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("public_api_added"));
	assert.ok(subs.includes("broken_link"));
});

// ---------------------------------------------------------------------------
// 2. priority 30
// ---------------------------------------------------------------------------

test("agentlab-docs has priority 30", () => {
	const role = createAgentLabDocsRole();
	assert.equal(role.priority, 30);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 600000 (10 minutes)
// ---------------------------------------------------------------------------

test("agentlab-docs has cooldownMs 600000", () => {
	const role = createAgentLabDocsRole();
	assert.equal(role.cooldownMs, 600_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for public_api_added with docsPresent === false
// ---------------------------------------------------------------------------

test("shouldFire returns true for public_api_added with docsPresent === false", () => {
	const role = createAgentLabDocsRole();
	const event = makeEvent("public_api_added", {
		path: "src/api/public.ts",
		exportName: "newPublicFunction",
		docsPresent: false,
	});
	const input = makeInput(event, "sig-docs-nodoc-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true when docsPresent === false",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for public_api_added with docsPresent === true
// ---------------------------------------------------------------------------

test("shouldFire returns false for public_api_added with docsPresent === true", () => {
	const role = createAgentLabDocsRole();
	const event = makeEvent("public_api_added", {
		path: "src/api/public.ts",
		exportName: "documentedFunction",
		docsPresent: true,
	});
	const input = makeInput(event, "sig-docs-documented-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false when docsPresent === true",
	);
});

test("shouldFire returns false for public_api_added without docsPresent field", () => {
	const role = createAgentLabDocsRole();
	const event = makeEvent("public_api_added", {
		path: "src/api/public.ts",
		exportName: "function",
	});
	const input = makeInput(event, "sig-docs-no-field-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false when docsPresent is missing (assume true)",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns true for broken_link
// ---------------------------------------------------------------------------

test("shouldFire returns true for broken_link", () => {
	const role = createAgentLabDocsRole();
	const event = makeEvent("broken_link", {
		url: "https://docs.example.com/missing",
		referencedFrom: "README.md",
	});
	const input = makeInput(event, "sig-docs-broken-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for broken_link");
});

// ---------------------------------------------------------------------------
// 7. invoke calls promptForRole with role="agentlab-docs"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-docs'", async () => {
	const role = createAgentLabDocsRole();
	const llmResponse = JSON.stringify({
		docGaps: [
			{
				path: "src/api/public.ts",
				exportName: "newPublicFunction",
				recommendedDoc: "Add JSDoc describing the function signature and usage",
			},
		],
		brokenLinks: [],
		summary: "Docs review: 1 gap found",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("public_api_added", {
		path: "src/api/public.ts",
		exportName: "newPublicFunction",
		docsPresent: false,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-docs",
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
	assert.equal(calls[0]!.role, "agentlab-docs");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 8. invoke parses LLM response into RoleAdvisory with gaps and brokenLinks
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with gaps and brokenLinks", async () => {
	const role = createAgentLabDocsRole();
	const llmResponse = JSON.stringify({
		docGaps: [
			{
				path: "src/api/public.ts",
				exportName: "newPublicFunction",
				recommendedDoc: "Add JSDoc",
			},
		],
		brokenLinks: [
			{
				url: "https://docs.example.com/missing",
				referencedFrom: "README.md",
				suggestion: "Update to https://docs.example.com/new-page",
			},
		],
		summary: "1 doc gap and 1 broken link",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("broken_link", {
		url: "https://docs.example.com/missing",
		referencedFrom: "README.md",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-docs",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-docs");
	assert.equal(advisory.priority, 30);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.gaps), "gaps must be an array");
	assert.equal(advisory.meta!.gaps.length, 1);
	assert.ok(Array.isArray(advisory.meta!.brokenLinks), "brokenLinks must be an array");
	assert.equal(advisory.meta!.brokenLinks.length, 1);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. invoke handles malformed LLM response with fallback
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty arrays", async () => {
	const role = createAgentLabDocsRole();
	const { router } = makeFakeAgentRouter("not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("public_api_added", {
		path: "src/api/public.ts",
		docsPresent: false,
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-docs",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-docs");
	assert.equal(advisory.priority, 30);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.gaps), "gaps must be an array");
	assert.equal(
		advisory.meta!.gaps.length,
		0,
		"gaps must be empty for malformed response",
	);
	assert.ok(Array.isArray(advisory.meta!.brokenLinks), "brokenLinks must be an array");
	assert.equal(
		advisory.meta!.brokenLinks.length,
		0,
		"brokenLinks must be empty for malformed response",
	);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 10. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 10 min → skip)", () => {
	const role = createAgentLabDocsRole();
	const event = makeEvent("broken_link", {
		url: "https://docs.example.com/missing",
	});
	const input = makeInput(event, "sig-cooldown-docs");

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
