import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgentLabReport } from "../src/agentlab-contract.js";

function validReport() {
	return {
		role: "code_quality",
		summary: "Build and tests completed with one finding.",
		findings: [
			{
				title: "Unsafe SQL interpolation",
				description: "A numeric field is interpolated into SQL.",
				evidence: "durationMs accepted injected SQL text",
				severity: "high",
				confidence: "medium",
				category: "code_quality",
				proposal: {
					summary: "Validate durationMs before SQL construction.",
					steps: [
						"Add a safe integer guard",
						"Cover injection input with a test",
					],
					risk: "Low; rejects invalid runtime input before SQLite call.",
					requiresHumanApproval: true,
				},
			},
		],
		commandsExecuted: ["corepack pnpm test"],
	};
}

test("validateAgentLabReport accepts a valid report", () => {
	const result = validateAgentLabReport(validReport());

	assert.equal(result.ok, true);
	assert.equal(
		result.report.summary,
		"Build and tests completed with one finding.",
	);
});

test("validateAgentLabReport rejects a report without summary", () => {
	const value = validReport();
	delete (value as { summary?: string }).summary;

	const result = validateAgentLabReport(value);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /summary/u);
});

test("validateAgentLabReport rejects a finding without evidence", () => {
	const value = validReport();
	delete (value.findings[0] as { evidence?: string }).evidence;

	const result = validateAgentLabReport(value);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /evidence/u);
});

test("validateAgentLabReport rejects a high finding without human approval", () => {
	const value = validReport();
	value.findings[0].proposal.requiresHumanApproval = false;

	const result = validateAgentLabReport(value);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /requiresHumanApproval/u);
});

test("validateAgentLabReport accepts a report with summary and no findings", () => {
	const result = validateAgentLabReport({
		role: "general",
		summary: "No findings.",
		findings: [],
	});

	assert.equal(result.ok, true);
	assert.deepEqual(result.report.findings, []);
});

test("validateAgentLabReport rejects an invalid role", () => {
	const value = validReport();
	value.role = "backend";

	const result = validateAgentLabReport(value);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /role/u);
});

test("validateAgentLabReport rejects a proposal without steps", () => {
	const value = validReport();
	delete (value.findings[0].proposal as { steps?: string[] }).steps;

	const result = validateAgentLabReport(value);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /steps/u);
});
