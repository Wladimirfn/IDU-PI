/**
 * agentlab-librarian role tests — T3.9.
 *
 * Locks the agentlab-librarian role contract:
 * - subscribes to source_added, source_digest_drift
 * - priority 25, cooldownMs 600000 (10 minutes)
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
import { createAgentLabLibrarianRole } from "../../src/roles/agentlab-librarian.js";
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

function makeInput(event: Event, signature = "sig-librarian-123"): RoleInput {
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
// 1. subscribes to source_added, source_digest_drift
// ---------------------------------------------------------------------------

test("agentlab-librarian subscribes to source_added, source_digest_drift", () => {
	const role = createAgentLabLibrarianRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("source_added"));
	assert.ok(subs.includes("source_digest_drift"));
});

// ---------------------------------------------------------------------------
// 2. priority 25
// ---------------------------------------------------------------------------

test("agentlab-librarian has priority 25", () => {
	const role = createAgentLabLibrarianRole();
	assert.equal(role.priority, 25);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 600000 (10 minutes)
// ---------------------------------------------------------------------------

test("agentlab-librarian has cooldownMs 600000", () => {
	const role = createAgentLabLibrarianRole();
	assert.equal(role.cooldownMs, 600_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for source_added
// ---------------------------------------------------------------------------

test("shouldFire returns true for source_added", () => {
	const role = createAgentLabLibrarianRole();
	const event = makeEvent("source_added", {
		sourceId: "doc-123",
		url: "https://example.com/doc",
	});
	const input = makeInput(event, "sig-source-added-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for source_added");
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns true for source_digest_drift
// ---------------------------------------------------------------------------

test("shouldFire returns true for source_digest_drift", () => {
	const role = createAgentLabLibrarianRole();
	const event = makeEvent("source_digest_drift", {
		sourceId: "doc-456",
		expectedDigest: "abc123",
		actualDigest: "def456",
	});
	const input = makeInput(event, "sig-digest-drift-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for source_digest_drift");
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns false for non-matching events
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed", () => {
	const role = createAgentLabLibrarianRole();
	const event = makeEvent("file_changed", { path: "src/test.ts" });
	const input = makeInput(event, "sig-non-matching-librarian");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, false, "shouldFire must return false for non-subscribed events");
});

// ---------------------------------------------------------------------------
// 7. invoke calls promptForRole with role="agentlab-librarian"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-librarian'", async () => {
	const role = createAgentLabLibrarianRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "source-freshness",
				description: "Source is outdated",
				severity: "medium",
			},
		],
		summary: "Librarian review: 1 finding",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("source_added", {
		sourceId: "doc-789",
		url: "https://example.com/doc",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-librarian",
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
	assert.equal(calls[0]!.role, "agentlab-librarian");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 8. invoke parses LLM response into RoleAdvisory
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabLibrarianRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				type: "missing-digest",
				description: "Source lacks digest verification",
				severity: "low",
			},
			{
				type: "broken-source-link",
				description: "Source URL is no longer accessible",
				severity: "high",
			},
		],
		summary: "2 librarian findings detected",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("source_digest_drift", {
		sourceId: "doc-999",
		expectedDigest: "abc",
		actualDigest: "def",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-librarian",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-librarian");
	assert.equal(advisory.priority, 25);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.findings), "findings must be an array");
	assert.equal(advisory.meta!.findings.length, 2);
	assert.equal(advisory.meta!.findings[0].type, "missing-digest");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. invoke handles malformed LLM response with fallback
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty findings", async () => {
	const role = createAgentLabLibrarianRole();
	const { router } = makeFakeAgentRouter("this is not valid JSON {{{");
	const { repository } = makeFakeRepository();

	const event = makeEvent("source_added", {
		sourceId: "doc-bad",
		url: "https://example.com",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-librarian",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-librarian");
	assert.equal(advisory.priority, 25);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.findings), "findings must be an array");
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
	const role = createAgentLabLibrarianRole();
	const event = makeEvent("source_added", {
		sourceId: "doc-cooldown",
		url: "https://example.com",
	});
	const input = makeInput(event, "sig-cooldown-librarian");

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
