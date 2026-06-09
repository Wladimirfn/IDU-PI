import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAgentLabReviewRequest } from "../src/agentlab-supervisor-contract.js";
import {
	createAgentLabReviewRequests,
	reviewAgentLabReviewRequest,
} from "../src/agentlab-review-requests.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-model-selection-"));
}

function writeAssignments(
	root: string,
	assignments: Record<string, string>,
): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "model-assignments.json"),
		`${JSON.stringify({ version: 1, assignments }, null, 2)}\n`,
		"utf8",
	);
}

function now(): Date {
	return new Date("2026-05-25T12:34:56.000Z");
}

test("AgentLab request with explicit model round-trips through create + read", () => {
	const reportsPath = join(tempRoot(), "reports");
	const projectPath = tempRoot();

	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security review",
		manualContext: "auth security review",
		model: "opencode-go/deepseek-v4-pro",
		now,
	});

	assert.ok(plan.requests.length > 0);
	for (const request of plan.requests) {
		assert.equal(request.model, "opencode-go/deepseek-v4-pro");
	}

	const review = reviewAgentLabReviewRequest(plan.path!, reportsPath);
	assert.equal(review.valid, true);
	assert.ok(review.plan);
	for (const request of review.plan!.requests) {
		assert.equal(request.model, "opencode-go/deepseek-v4-pro");
	}
});

test("AgentLab buildAgentLabReviewRequest copies the model field onto the request", () => {
	const request = buildAgentLabReviewRequest({
		id: "request-model-1",
		projectId: "pi-telegram-bridge",
		projectPath: "/repo",
		specialty: "security",
		trigger: "manual",
		objective: "audit",
		contextSummary: "ctx",
		model: "openai/gpt-4o",
	});
	assert.equal(request.model, "openai/gpt-4o");
});

test("AgentLab buildAgentLabReviewRequest omits the model field when not set", () => {
	const request = buildAgentLabReviewRequest({
		id: "request-model-2",
		projectId: "pi-telegram-bridge",
		projectPath: "/repo",
		specialty: "security",
		trigger: "manual",
		objective: "audit",
		contextSummary: "ctx",
	});
	assert.equal(request.model, undefined);
});

test("AgentLab request auto-picks the model when the role has a direct-model assignment", () => {
	const temp = tempRoot();
	const stateRoot = join(temp, "state");
	const projectPath = join(temp, "project");
	const reportsPath = join(stateRoot, "reports");
	writeAssignments(stateRoot, {
		"agentlab-security": "opencode-go/deepseek-v4-pro",
	});

	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security review",
		manualContext: "auth security review",
		stateRoot,
		now,
	});

	// The "security" specialty is the dominant match; the security request
	// must carry the direct-model assignment verbatim.
	const securityRequest = plan.requests.find(
		(request) => request.specialty === "security",
	);
	assert.ok(securityRequest, "expected a security request");
	assert.equal(securityRequest?.model, "opencode-go/deepseek-v4-pro");
});

test("AgentLab request does not auto-pick when the role has a profile assignment and emits a structured error", () => {
	const temp = tempRoot();
	const stateRoot = join(temp, "state");
	const projectPath = join(temp, "project");
	const reportsPath = join(stateRoot, "reports");
	writeAssignments(stateRoot, {
		// profile id, not a canonical model id — must NOT auto-pick
		"agentlab-security": "security",
	});

	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security review",
		manualContext: "auth security review",
		stateRoot,
		now,
	});

	const securityRequest = plan.requests.find(
		(request) => request.specialty === "security",
	);
	assert.ok(securityRequest, "expected a security request");
	assert.equal(securityRequest?.model, undefined);
	// Structured error surfaces in the plan: code + specialty.
	const allErrors = plan.errors.join("\n");
	assert.match(
		allErrors,
		/agentlab_model_unresolved|model[\s_-]?unresolved|model required/i,
	);
	assert.match(allErrors, /security/u);
});

test("AgentLab request does not auto-pick when there is no model-assignments.json and emits a structured error", () => {
	const temp = tempRoot();
	const stateRoot = join(temp, "state");
	const projectPath = join(temp, "project");
	const reportsPath = join(stateRoot, "reports");
	// No writeAssignments call: model-assignments.json is absent.

	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security review",
		manualContext: "auth security review",
		stateRoot,
		now,
	});

	const securityRequest = plan.requests.find(
		(request) => request.specialty === "security",
	);
	assert.ok(securityRequest, "expected a security request");
	assert.equal(securityRequest?.model, undefined);
	const allErrors = plan.errors.join("\n");
	assert.match(
		allErrors,
		/agentlab_model_unresolved|model[\s_-]?unresolved|model required/i,
	);
});

test("AgentLab request without model field is back-compat: existing callers keep model undefined", () => {
	const reportsPath = join(tempRoot(), "reports");
	const projectPath = tempRoot();

	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security review",
		manualContext: "auth security review",
		now,
	});

	assert.ok(plan.requests.length > 0);
	for (const request of plan.requests) {
		assert.equal(request.model, undefined);
	}
});
