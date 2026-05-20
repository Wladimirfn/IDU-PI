import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLabFindingsFromOutput } from "../src/lab-finding-parser.js";

const context = {
	projectId: "pi-telegram-bridge",
	agentId: "spark",
	labRunId: "run-1",
};

test("parseLabFindingsFromOutput returns no findings for unclear output", () => {
	const findings = parseLabFindingsFromOutput(
		"Resumen corto\nTests ejecutados: corepack pnpm test\nSin hallazgos.",
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput extracts finding from valid JSON", () => {
	const findings = parseLabFindingsFromOutput(
		`Analysis result:\n{\n  "findings": [\n    {\n      "title": "Build command fails",\n      "description": "The build command exits with TypeScript errors.",\n      "severity": "high",\n      "confidence": "medium",\n      "evidence": "corepack pnpm build exited with code 2",\n      "suspectedCause": "Missing exported type"\n    }\n  ]\n}`,
		context,
	);

	assert.equal(findings.length, 1);
	assert.equal(findings[0].projectId, "pi-telegram-bridge");
	assert.equal(findings[0].title, "Build command fails");
	assert.equal(
		findings[0].description,
		"The build command exits with TypeScript errors.",
	);
	assert.equal(findings[0].severity, "high");
	assert.equal(findings[0].confidence, "medium");
	assert.equal(findings[0].evidence, "corepack pnpm build exited with code 2");
	assert.equal(findings[0].suspectedCause, "Missing exported type");
});

test("parseLabFindingsFromOutput discards JSON finding without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Missing evidence",
					description: "This should not be recorded.",
					severity: "critical",
					confidence: "high",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput extracts affectedFiles from JSON", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Unsafe SQL interpolation",
					description: "A numeric field is interpolated directly into SQL.",
					evidence: "durationMs accepted injected SQL text",
					affectedFiles: ["src/lab-db.ts", "test/lab-db-repository.test.ts"],
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings[0].affectedFiles, [
		"src/lab-db.ts",
		"test/lab-db-repository.test.ts",
	]);
});

test("parseLabFindingsFromOutput generates stable dedupeKey", () => {
	const output = JSON.stringify({
		findings: [
			{
				title: "Unsafe SQL interpolation",
				description: "A numeric field is interpolated directly into SQL.",
				evidence: "durationMs accepted injected SQL text",
				affectedFiles: ["src/lab-db.ts"],
			},
		],
	});

	const first = parseLabFindingsFromOutput(output, context)[0];
	const second = parseLabFindingsFromOutput(output, context)[0];

	assert.equal(first.dedupeKey, second.dedupeKey);
	assert.equal(
		first.dedupeKey,
		"pi-telegram-bridge:spark:unsafe-sql-interpolation:src/lab-db.ts",
	);
});

test("parseLabFindingsFromOutput does not throw on invalid JSON", () => {
	assert.doesNotThrow(() =>
		parseLabFindingsFromOutput(`{"findings":[{"title":"Broken",`, context),
	);
});

test("parseLabFindingsFromOutput returns empty for incomplete JSON fragments", () => {
	const findings = parseLabFindingsFromOutput(
		`{"findings":[{"title":"Build failed",\n"description":"No evidence field."`,
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput does not invent high severity without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		"Possible issue: something might be slow, but no command output or file evidence was captured.",
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput does not fallback from JSON finding without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Build failed",
					description: "No evidence field.",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput ignores negated failure text", () => {
	const findings = parseLabFindingsFromOutput(
		"No failure found after running tests. Build passed and no errors were detected.",
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput extracts findings from valid AgentLabReport", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			role: "security",
			summary: "Security review found one issue.",
			findings: [
				{
					title: "Token logged",
					description: "A token is written to logs.",
					evidence: "console output includes TELEGRAM_BOT_TOKEN",
					severity: "critical",
					confidence: "high",
					category: "security",
					affectedFiles: ["src/index.ts"],
					proposal: {
						summary: "Remove token logging.",
						steps: ["Delete the log statement", "Add a regression test"],
						risk: "Low; removes sensitive output only.",
						requiresHumanApproval: true,
					},
				},
			],
			commandsExecuted: ["corepack pnpm test"],
		}),
		context,
	);

	assert.equal(findings.length, 1);
	assert.equal(findings[0].title, "Token logged");
	assert.equal(findings[0].severity, "critical");
	assert.equal(findings[0].confidence, "high");
	assert.equal(findings[0].proposal?.summary, "Remove token logging.");
	assert.deepEqual(findings[0].affectedFiles, ["src/index.ts"]);
});

test("parseLabFindingsFromOutput ignores AgentLabReport without finding evidence", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			role: "code_quality",
			summary: "Invalid report.",
			findings: [
				{
					title: "Build failed",
					description: "Build failed but no evidence was provided.",
					severity: "high",
					confidence: "medium",
					category: "code_quality",
					proposal: {
						summary: "Fix build.",
						steps: ["Inspect TypeScript errors"],
						risk: "Unknown.",
						requiresHumanApproval: true,
					},
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput ignores high AgentLabReport without human approval", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			role: "performance",
			summary: "Invalid high report.",
			findings: [
				{
					title: "Slow query",
					description: "Query takes too long.",
					evidence: "Query took 12s in test output.",
					severity: "high",
					confidence: "high",
					category: "performance",
					proposal: {
						summary: "Add index.",
						steps: ["Inspect query plan"],
						risk: "May affect writes.",
						requiresHumanApproval: false,
					},
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput does not fallback from invalid AgentLabReport", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			role: "backend",
			summary: "Invalid role but tempting failure text.",
			findings: [
				{
					title: "Build failed",
					description: "Build failed with clear text.",
					evidence: "Error: build failed with exit code 2",
					severity: "high",
					confidence: "high",
					category: "code_quality",
					proposal: {
						summary: "Fix build.",
						steps: ["Run build"],
						risk: "Low.",
						requiresHumanApproval: true,
					},
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput ignores AgentLab-shaped report without summary", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			role: "code_quality",
			findings: [
				{
					title: "Build failed",
					description: "Build failed with clear text.",
					evidence: "Error: build failed with exit code 2",
					severity: "medium",
					confidence: "high",
					category: "code_quality",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput ignores AgentLab-shaped report without role", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			summary: "Missing role but tempting finding.",
			findings: [
				{
					title: "Build failed",
					description: "Build failed with clear text.",
					evidence: "Error: build failed with exit code 2",
					severity: "medium",
					confidence: "high",
					category: "code_quality",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput keeps conservative text fallback without JSON", () => {
	const findings = parseLabFindingsFromOutput(
		"Finding: Build failed\nEvidence: corepack pnpm build exited with code 2\nFile: src/index.ts",
		context,
	);

	assert.equal(findings.length, 1);
	assert.equal(findings[0].severity, "info");
	assert.equal(findings[0].confidence, "low");
});
