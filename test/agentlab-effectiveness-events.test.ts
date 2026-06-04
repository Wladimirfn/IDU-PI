import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	agentLabEffectivenessEventFromRequestPlan,
	agentLabEffectivenessEventFromRunResult,
	agentLabEffectivenessEventFromStatus,
	agentLabEffectivenessEventsPath,
	buildAgentLabEffectivenessReport,
	flushAgentLabEffectivenessEvents,
	readAgentLabEffectivenessEvents,
	recordAgentLabEffectivenessEvent,
	recordAgentLabEffectivenessEventDeferred,
} from "../src/agentlab-effectiveness-events.js";
import type { AgentLabReviewRequestPlan } from "../src/agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewStatus,
} from "../src/agentlab-review-runner.js";

function tempStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-agentlab-effectiveness-"));
}

function requestPlan(): AgentLabReviewRequestPlan {
	return {
		generatedAt: "2026-06-04T00:00:00.000Z",
		projectId: "idu-pi",
		source: "postflight",
		warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
		requests: [
			{
				id: "req-security",
				createdAt: "2026-06-04T00:00:00.000Z",
				projectId: "idu-pi",
				projectPath: "C:/projects/idu-pi",
				requestedBy: "supervisor",
				specialty: "security",
				trigger: "postflight",
				objective: "Review security boundaries",
				contextSummary: "bounded",
				evidence: ["postflight"],
				filesToInspect: [],
				flowsToCheck: [],
				rulesToCheck: [],
				constraints: ["audit-only"],
				allowedActions: ["review"],
				forbiddenActions: ["no repo writes"],
				expectedOutputs: ["findings"],
				maxCommands: 3,
				maxMinutes: 10,
				tokenBudgetHint: "bounded",
				requiresHumanApproval: true,
			},
		],
		errors: [],
	};
}

function runResult(): AgentLabReviewRunResult {
	return {
		generatedAt: "2026-06-04T00:00:00.000Z",
		sourceRequestFile: "request.json",
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "idu-pi",
		runs: [
			{
				requestId: "req-security",
				specialty: "security",
				status: "completed",
				commandsExecuted: [],
				rawSummary: "raw agent text must not be stored",
				parsedReport: {
					id: "report-1",
					requestId: "req-security",
					projectId: "idu-pi",
					specialty: "security",
					status: "completed",
					summary: "Completed",
					qualityFindings: [],
					safetyFindings: [
						{
							title: "Critical issue",
							description: "Evidence-backed finding.",
							severity: "critical",
							evidence: "file:line",
							confidence: "high",
							category: "security",
							affectedFiles: ["src/example.ts"],
							affectedFlows: [],
							relatedRules: [],
							controlPillars: [],
						},
					],
					architectureFindings: [],
					tokenCostFindings: [],
					timeFindings: [],
					resourceFindings: [],
					recommendations: [],
					testsSuggested: [],
					testsExecuted: [],
					evidence: ["file:line"],
					proposedSupervisorActions: [],
					suggestedSkillUpdates: [],
					suggestedRuleUpdates: [],
					suggestedAgentTasks: [],
					confidence: "high",
					requiresHumanApproval: true,
					createdAt: "2026-06-04T00:00:00.000Z",
				},
				contractValidation: { valid: true, errors: [] },
				findings: [
					{
						title: "Critical issue",
						description: "Evidence-backed finding.",
						severity: "critical",
						evidence: "file:line",
						confidence: "high",
						category: "security",
						affectedFiles: ["src/example.ts"],
						affectedFlows: [],
						relatedRules: [],
						controlPillars: [],
					},
				],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: true,
			},
			{
				requestId: "req-architecture",
				specialty: "architecture",
				status: "partial",
				commandsExecuted: [],
				rawSummary: "partial raw text must not be stored",
				contractValidation: { valid: false, errors: ["fallback"] },
				findings: [],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: false,
				qualityWarnings: ["fallback repair"],
			},
		],
		consolidatedSummary: "Summary must not be stored in events.",
		consolidatedFindings: [
			{
				title: "Critical issue",
				description: "Evidence-backed finding.",
				severity: "critical",
				evidence: "file:line",
				confidence: "high",
				category: "security",
				affectedFiles: ["src/example.ts"],
				affectedFlows: [],
				relatedRules: [],
				controlPillars: [],
			},
		],
		recommendedNext: "Review.",
		requiresHumanApproval: true,
		safeNotes: [],
	};
}

test("AgentLab effectiveness events append safe JSONL under stateRoot reports", async () => {
	const root = tempStateRoot();
	try {
		const event = agentLabEffectivenessEventFromRequestPlan(
			"idu-pi",
			requestPlan(),
		);
		const result = await recordAgentLabEffectivenessEvent(root, event);
		assert.equal(result.ok, true);
		assert.equal(result.path, agentLabEffectivenessEventsPath(root));
		assert.match(result.path, /reports.*agentlab-effectiveness-events\.jsonl/u);
		const events = readAgentLabEffectivenessEvents(root);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.eventType, "request_created");
		assert.equal(events[0]?.requestCount, 1);
		assert.equal(events[0]?.requiresHumanApproval, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("AgentLab effectiveness report summarizes outcomes findings and privacy flags", () => {
	const runEvent = agentLabEffectivenessEventFromRunResult(
		"idu-pi",
		runResult(),
	);
	const staleEvent = agentLabEffectivenessEventFromStatus("idu-pi", {
		path: "current.json",
		name: "current.json",
		valid: false,
		errors: ["AgentLab run stale: current request has no valid run."],
	} satisfies AgentLabReviewStatus);
	const validStatusEvent = agentLabEffectivenessEventFromStatus("idu-pi", {
		path: "current.json",
		name: "current.json",
		valid: true,
		errors: [],
		result: runResult(),
	} satisfies AgentLabReviewStatus);
	const report = buildAgentLabEffectivenessReport([
		runEvent,
		staleEvent,
		validStatusEvent,
	]);
	assert.equal(report.totalEvents, 3);
	assert.equal(report.reviewRuns, 1);
	assert.equal(report.statusChecks, 2);
	assert.equal(report.outcomes.completed, 1);
	assert.equal(report.outcomes.partial, 1);
	assert.equal(report.outcomes.stale, 1);
	assert.equal(report.findingsBySeverity.critical, 1);
	assert.equal(report.humanApprovalRequired, 2);
	assert.equal(report.evidenceCompleteness.complete, 1);
	assert.equal(report.evidenceCompleteness.partial, 1);
	assert.equal(report.tokensMeasured, false);
	assert.equal(report.contextPercentMeasured, false);
	assert.equal(report.promptTextStored, false);
	assert.equal(report.rawUserTextStored, false);
	assert.equal(report.remoteAnalytics, false);
});

test("AgentLab effectiveness events do not serialize forbidden raw fields", () => {
	const event = agentLabEffectivenessEventFromRunResult("idu-pi", runResult());
	const serialized = JSON.stringify(event);
	for (const forbidden of [
		"prompt",
		"rawUserText",
		"env",
		"headers",
		"tokens",
		"cost",
		"contextPercent",
		"rawSummary",
		"consolidatedSummary",
	]) {
		assert.equal(serialized.includes(forbidden), false, forbidden);
	}
});

test("AgentLab effectiveness reader ignores malformed lines and deferred writes flush", async () => {
	const root = tempStateRoot();
	try {
		recordAgentLabEffectivenessEventDeferred(
			root,
			agentLabEffectivenessEventFromRequestPlan("idu-pi", requestPlan()),
		);
		await flushAgentLabEffectivenessEvents();
		const path = agentLabEffectivenessEventsPath(root);
		writeFileSync(
			`${path}`,
			`${readAgentLabEffectivenessEvents(root)
				.map((event) => JSON.stringify(event))
				.join("\n")}\nnot-json\n`,
			"utf8",
		);
		const events = readAgentLabEffectivenessEvents(root, 10);
		assert.equal(events.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
