/**
 * agentlab-security role tests — T2.3.
 *
 * These tests lock the agentlab-security role contract:
 * - subscribes to file_changed, dependency_bumped
 * - priority 95, cooldownMs 300000 (5 minutes)
 * - shouldFire logic for security-sensitive file paths
 * - shouldFire logic for dependency_bumped events
 * - invoke calls agentRouter.promptForRole with correct role
 * - invoke parses LLM response into RoleAdvisory with findings array
 * - invoke handles malformed LLM responses with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createAgentLabSecurityRole } from "../../src/roles/agentlab-security.js";
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
// 1. subscribes to file_changed, dependency_bumped
// ---------------------------------------------------------------------------

test("agentlab-security subscribes to file_changed, dependency_bumped", () => {
	const role = createAgentLabSecurityRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("dependency_bumped"));
});

// ---------------------------------------------------------------------------
// 2. priority 95
// ---------------------------------------------------------------------------

test("agentlab-security has priority 95", () => {
	const role = createAgentLabSecurityRole();
	assert.equal(role.priority, 95);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 300000 (5 minutes in ms)
// ---------------------------------------------------------------------------

test("agentlab-security has cooldownMs 300000", () => {
	const role = createAgentLabSecurityRole();
	assert.equal(role.cooldownMs, 300_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for file_changed with auth.ts or login.ts or secrets patterns
// ---------------------------------------------------------------------------

test("shouldFire returns true for file_changed with path matching auth.ts", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("file_changed", { path: "src/auth.ts" });
	const input = makeInput(event, "sig-auth-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for auth.ts");
});

test("shouldFire returns true for file_changed with path matching login.ts", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("file_changed", { path: "src/login.ts" });
	const input = makeInput(event, "sig-login-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for login.ts");
});

test("shouldFire returns true for file_changed with path matching secret patterns", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("file_changed", { path: "config/.env.secret" });
	const input = makeInput(event, "sig-secret-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .env.secret");
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for file_changed with path NOT matching security patterns
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed with path NOT matching security patterns", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("file_changed", { path: "src/utils.ts" });
	const input = makeInput(event, "sig-utils-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		false,
		"shouldFire must return false for non-security paths",
	);
});

// ---------------------------------------------------------------------------
// 6. shouldFire returns true for dependency_bumped
// ---------------------------------------------------------------------------

test("shouldFire returns true for dependency_bumped event", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("dependency_bumped", {
		packageName: "express",
		oldVersion: "4.18.0",
		newVersion: "4.18.1",
	});
	const input = makeInput(event, "sig-dep-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for dependency_bumped",
	);
});

// ---------------------------------------------------------------------------
// 7. invoke calls agentRouter.promptForRole with role="agentlab-security"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-security'", async () => {
	const role = createAgentLabSecurityRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				severity: "high",
				title: "Hardcoded credentials",
				description: "Found hardcoded API key in source",
				recommendedFix: "Use environment variables",
				file: "src/auth.ts",
				line: 42,
			},
		],
		summary: "Security review found 1 high-severity issue",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/auth.ts" });
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
	assert.equal(calls[0]!.role, "agentlab-security");
	assert.ok(calls[0]!.message.length > 0, "prompt must be non-empty");
});

// ---------------------------------------------------------------------------
// 8. invoke parses the LLM response into a RoleAdvisory with findings array, summary, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses the LLM response into a RoleAdvisory with findings array, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabSecurityRole();
	const llmResponse = JSON.stringify({
		findings: [
			{
				severity: "critical",
				title: "SQL injection vulnerability",
				description: "User input not sanitized before SQL query",
				recommendedFix: "Use parameterized queries",
				file: "src/db.ts",
				line: 15,
			},
		],
		summary: "Critical SQL injection found",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/auth.ts" });
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

	assert.equal(advisory.roleId, "agentlab-security");
	assert.equal(advisory.priority, 95);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.findings), "findings must be an array");
	assert.equal(advisory.meta!.findings.length, 1);
	assert.equal(advisory.meta!.findings[0].severity, "critical");
	assert.equal(
		advisory.meta!.findings[0].title,
		"SQL injection vulnerability",
	);
	assert.ok(
		advisory.meta!.summary,
		"summary must be present",
	);
});

// ---------------------------------------------------------------------------
// 9. invoke handles a malformed LLM response by returning a fallback advisory with empty findings
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty findings", async () => {
	const role = createAgentLabSecurityRole();
	const llmResponse = "this is not valid JSON";
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/auth.ts" });
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

	assert.equal(advisory.roleId, "agentlab-security");
	assert.equal(advisory.priority, 95);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.findings), "findings must be an array");
	assert.equal(advisory.meta!.findings.length, 0, "findings must be empty for malformed response");
	assert.ok(
		advisory.meta!.summary,
		"summary must be present even for malformed response",
	);
});

// ---------------------------------------------------------------------------
// 10. shouldFire respects the cooldown (same event hash within 5 min → skip)
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event hash within 5 min → skip)", () => {
	const role = createAgentLabSecurityRole();
	const event = makeEvent("file_changed", { path: "src/auth.ts" });
	const input = makeInput(event, "sig-cooldown-test");
	
	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:02:00.000Z"); // 2 minutes later, within 5 min cooldown
	
	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(
		result,
		false,
		"shouldFire must return false within cooldown window",
	);
	
	// Now test after cooldown expires
	const afterCooldown = new Date("2026-01-01T00:06:00.000Z"); // 6 minutes later
	const resultAfter = role.shouldFire(input, lastFireAt, afterCooldown);
	assert.equal(
		resultAfter,
		true,
		"shouldFire must return true after cooldown expires",
	);
});
