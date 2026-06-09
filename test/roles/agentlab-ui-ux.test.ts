/**
 * agentlab-ui-ux role tests — T3.3.
 *
 * Locks the agentlab-ui-ux role contract:
 * - subscribes to file_changed, design_token_drift
 * - priority 40, cooldownMs 300000 (5 minutes)
 * - shouldFire logic: file_changed with UI paths (html, jsx, tsx, css, scss, vue, svelte)
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with a11y, consistency, tokens, summary, priority, evidenceRefs
 * - invoke handles malformed LLM response with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createAgentLabUiUxRole } from "../../src/roles/agentlab-ui-ux.js";
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

function makeInput(event: Event, signature = "sig-ui-123"): RoleInput {
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
// 1. subscribes to file_changed, design_token_drift
// ---------------------------------------------------------------------------

test("agentlab-ui-ux subscribes to file_changed, design_token_drift", () => {
	const role = createAgentLabUiUxRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 2);
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("design_token_drift"));
});

// ---------------------------------------------------------------------------
// 2. priority 40
// ---------------------------------------------------------------------------

test("agentlab-ui-ux has priority 40", () => {
	const role = createAgentLabUiUxRole();
	assert.equal(role.priority, 40);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 300000 (5 minutes)
// ---------------------------------------------------------------------------

test("agentlab-ui-ux has cooldownMs 300000", () => {
	const role = createAgentLabUiUxRole();
	assert.equal(role.cooldownMs, 300_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for file_changed with UI paths
// ---------------------------------------------------------------------------

test("shouldFire returns true for file_changed with .tsx path", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("file_changed", {
		path: "src/components/Button.tsx",
	});
	const input = makeInput(event, "sig-ui-tsx-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .tsx files");
});

test("shouldFire returns true for file_changed with .css path", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("file_changed", { path: "styles/main.css" });
	const input = makeInput(event, "sig-ui-css-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .css files");
});

test("shouldFire returns true for file_changed with .html path", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("file_changed", { path: "public/index.html" });
	const input = makeInput(event, "sig-ui-html-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .html files");
});

test("shouldFire returns true for file_changed with .scss path", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("file_changed", { path: "styles/variables.scss" });
	const input = makeInput(event, "sig-ui-scss-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .scss files");
});

test("shouldFire returns true for design_token_drift", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("design_token_drift", { token: "color-primary" });
	const input = makeInput(event, "sig-ui-token-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(
		result,
		true,
		"shouldFire must return true for design_token_drift",
	);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for file_changed with non-UI paths
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed with non-UI path", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("file_changed", { path: "src/engine.ts" });
	const input = makeInput(event, "sig-ui-noui-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, false, "shouldFire must return false for non-UI paths");
});

// ---------------------------------------------------------------------------
// 6. invoke calls promptForRole with role="agentlab-ui-ux"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-ui-ux'", async () => {
	const role = createAgentLabUiUxRole();
	const llmResponse = JSON.stringify({
		a11y: [
			{
				description: "Missing alt attribute on img",
				selector: "img.avatar",
				wcag: "1.1.1",
			},
		],
		consistency: [],
		tokens: [
			{
				description: "Hardcoded color instead of design token",
				selector: ".button",
				property: "color",
				value: "#333",
				expected: "var(--color-text)",
			},
		],
		summary: "UI review: 1 a11y issue, 1 token violation",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", {
		path: "src/components/Button.tsx",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-ui",
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
	assert.equal(calls[0]!.role, "agentlab-ui-ux");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 7. invoke parses LLM response into RoleAdvisory with a11y, consistency, tokens, summary, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with a11y, consistency, tokens, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabUiUxRole();
	const llmResponse = JSON.stringify({
		a11y: [
			{
				description: "Low contrast ratio",
				selector: ".text-muted",
				wcag: "1.4.3",
			},
		],
		consistency: [
			{
				description: "Inconsistent button padding",
				selector: ".btn-lg",
			},
		],
		tokens: [
			{
				description: "Uses raw hex instead of token",
				selector: ".card",
				property: "border-color",
				value: "#ddd",
				expected: "var(--color-border)",
			},
		],
		summary: "3 UI issues found",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("design_token_drift", {
		token: "color-primary",
		oldValue: "#007bff",
		newValue: "#0056b3",
	});
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-ui",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-ui-ux");
	assert.equal(advisory.priority, 40);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.a11y), "a11y must be an array");
	assert.equal(advisory.meta!.a11y.length, 1);
	assert.ok(
		Array.isArray(advisory.meta!.consistency),
		"consistency must be an array",
	);
	assert.equal(advisory.meta!.consistency.length, 1);
	assert.ok(Array.isArray(advisory.meta!.tokens), "tokens must be an array");
	assert.equal(advisory.meta!.tokens.length, 1);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 8. invoke handles malformed LLM response with fallback
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty arrays", async () => {
	const role = createAgentLabUiUxRole();
	const { router } = makeFakeAgentRouter("{ broken json }");
	const { repository } = makeFakeRepository();

	const event = makeEvent("file_changed", { path: "src/App.tsx" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-ui",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-ui-ux");
	assert.equal(advisory.priority, 40);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.a11y), "a11y must be an array");
	assert.equal(
		advisory.meta!.a11y.length,
		0,
		"a11y must be empty for malformed response",
	);
	assert.ok(
		Array.isArray(advisory.meta!.consistency),
		"consistency must be an array",
	);
	assert.equal(
		advisory.meta!.consistency.length,
		0,
		"consistency must be empty for malformed response",
	);
	assert.ok(Array.isArray(advisory.meta!.tokens), "tokens must be an array");
	assert.equal(
		advisory.meta!.tokens.length,
		0,
		"tokens must be empty for malformed response",
	);
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 5 min → skip)", () => {
	const role = createAgentLabUiUxRole();
	const event = makeEvent("design_token_drift", { token: "color-primary" });
	const input = makeInput(event, "sig-cooldown-ui");

	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:02:00.000Z"); // 2 min later, within 5 min cooldown

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
