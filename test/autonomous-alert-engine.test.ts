import assert from "node:assert/strict";
import { test } from "node:test";
import type { StructuredTask } from "../src/structured-task-queue.js";
import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertControlState,
} from "../src/autonomous-alert-engine.js";

function task(
	id: string,
	text: string,
	status: StructuredTask["status"] = "pending",
): StructuredTask {
	return {
		id,
		text,
		category: "bug",
		priority: 3,
		status,
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		projectId: "idu-pi",
	};
}

const activeControl: AutonomousAlertControlState = {
	version: 1,
	active: true,
	disabledDomains: [],
	updatedAt: "2026-06-05T00:00:00.000Z",
};

test("autonomous alert report includes raw honesty contract", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [],
		allowTaskCreation: false,
	});

	assert.equal(report.rawHonesty, true);
	assert.equal(report.noImplementation, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.contractsModified, false);
	assert.equal(report.dependenciesUpdated, false);
});

test("repeated bug threshold creates low risk task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "postflight context.md bug repeated"),
			task("bug-2", "postflight context.md bug repeated again"),
			task("bug-3", "postflight local-only bug regression"),
			task("bug-4", "postflight local-only bug keeps returning"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "create_task");
	assert.equal(decision.requiresHuman, false);
	assert.equal(decision.taskDraft?.guardRisk, "low");
	assert.match(decision.taskDraft?.text ?? "", /regression test/u);
	assert.ok(decision.uncomfortableTruths.length > 0);
});

test("repeated bug alert ignores completed tasks with regression evidence", () => {
	const covered = [
		"Fixed with regression test; focused tests passed; reviewer PASS.",
		"Review checklist updated; full build/test/diff-check passed.",
		"Regression coverage recorded in postflight tests and reviewer PASS.",
		"Completed with explicit postflight evidence and fresh reviewer PASS.",
	];
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: covered.map((completionEvidence, index) => ({
			...task(
				`covered-${index + 1}`,
				"Bug: postflight context.md repeated regression",
				"done",
			),
			completionEvidence,
		})),
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	assert.equal(
		report.decisions.some((decision) => decision.domain === "repeated_bug"),
		false,
	);
	assert.equal(report.humanEscalations.length, 0);
});

test("repeated bug alert ignores completed runtime tasks with full gate and reviewer evidence", () => {
	const runtimeEvidence = [
		"Fixed idu_postflight local-only noise bug. Evidence: RED tests failed before ignoredFiles support; GREEN full gate corepack pnpm build && corepack pnpm test && git diff --check => 1089 pass / 0 fail / 1 skipped; LSP 0; reviewer 4a941d68 PASS.",
		"Implemented and pushed Idu-pi Autonomous Alert Engine v1. Verification: LSP diagnostics 0; full gate corepack pnpm build && corepack pnpm test && git diff --check => 1110 pass / 0 fail / 1 skipped; fresh reviewer 0403b50f PASS.",
		"Resolved by commit af652b5 fix(idu): bound self-maintenance pressure window. Evidence: focused tests 170 pass / 0 fail; LSP 0 diagnostics; full gate corepack pnpm build && corepack pnpm test && git diff --check => 1192 pass / 0 fail / 1 skipped; fresh reviewer c7a63f7d PASS.",
		"Resolved repeated-failure learning blocker with regression evidence: covered completed repeated failures no longer emit systemic-repeated-failure-learning; focused automaticov1/mcp/self-maintenance tests passed; full gate corepack pnpm build && corepack pnpm test && git diff --check passed with 1194 pass / 0 fail / 1 skipped; LSP 0 diagnostics; fresh reviewer ece3c046 PASS.",
	];
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: runtimeEvidence.map((completionEvidence, index) => ({
			...task(
				`runtime-covered-${index + 1}`,
				"Bug: postflight context repeated failure learning regression",
				"done",
			),
			completionEvidence,
		})),
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	assert.equal(
		report.decisions.some((decision) => decision.domain === "repeated_bug"),
		false,
	);
});

test("repeated bug alert still counts completed tasks with insufficient evidence", () => {
	const insufficientEvidence = [
		"Tests skipped; no regression coverage added.",
		"No regression test exists; postflight failed.",
		"Review checklist not updated.",
		"No postflight evidence recorded.",
	];
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: insufficientEvidence.map((completionEvidence, index) => ({
			...task(
				`uncovered-${index + 1}`,
				"Bug: postflight context.md repeated regression",
				"done",
			),
			completionEvidence,
		})),
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "create_task");
});

test("repeated bug alert still counts negated test pass wording", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			"Not all tests passed; reviewer PASS.",
			"No tests passed; reviewer PASS.",
			"Not all tests passed; reviewer PASS.",
			"No tests passed; reviewer PASS.",
		].map((completionEvidence, index) => ({
			...task(
				`negated-pass-${index + 1}`,
				"Bug: postflight context repeated regression",
				"done",
			),
			completionEvidence,
		})),
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "create_task");
});

test("security and db repeated bugs escalate to human without task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "security db auth bug repeated"),
			task("bug-2", "security db auth bug repeated again"),
			task("bug-3", "security db schema bug returned"),
			task("bug-4", "security db schema bug returned again"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "ask_human");
	assert.equal(decision.requiresHuman, true);
	assert.equal(decision.taskDraft, undefined);
});

test("cooldown suppresses duplicate task creation", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "telegram bug repeated"),
			task("bug-2", "telegram bug repeated"),
			task("bug-3", "telegram bug repeated"),
			task("bug-4", "telegram bug repeated"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
		cooldowns: {
			"repeated_bug:telegram": "2026-06-06T00:00:00.000Z",
		},
	});

	const decision = report.decisions.find(
		(item) => item.domain === "repeated_bug",
	);
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "snooze");
	assert.equal(report.suppressedByCooldown.length, 1);
});

test("security and db domain signals ask human without task drafts", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [
			{
				id: "security-review-pressure",
				category: "security_review_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:security=2"],
				summary: "Security review evidence is stale or incomplete",
				recommendedActions: ["Ask the human before changing security posture."],
			},
			{
				id: "db-review-pressure",
				category: "db_review_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:db=2"],
				summary: "DB review evidence is stale or incomplete",
				recommendedActions: ["Ask the human before changing DB/schema/data."],
			},
		],
		allowTaskCreation: true,
	});

	const protectedDecisions = report.decisions.filter(
		(decision) => decision.domain === "security" || decision.domain === "db",
	);
	assert.equal(protectedDecisions.length, 2);
	for (const decision of protectedDecisions) {
		assert.equal(decision.recommendedAction, "ask_human");
		assert.equal(decision.requiresHuman, true);
		assert.equal(decision.taskDraft, undefined);
	}
});

test("optimization and bibliotecario signals can create bounded task drafts", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [
			{
				id: "optimization-review-pressure",
				category: "optimization_review_pressure",
				severity: "warning",
				confidence: 0.65,
				evidenceRefs: ["structured-task-queue:optimization=2"],
				summary: "Optimization review is stale",
				recommendedActions: ["Create a bounded resource optimization audit."],
			},
			{
				id: "bibliotecario-source-pressure",
				category: "bibliotecario_source_pressure",
				severity: "warning",
				confidence: 0.65,
				evidenceRefs: ["structured-task-queue:bibliotecario=2"],
				summary: "Bibliotecario/source evidence is stale",
				recommendedActions: ["Create a bounded Bibliotecario source review."],
				bibliotecarioInputs: ["review registered version/source evidence"],
			},
		],
		allowTaskCreation: true,
	});

	const optimization = report.decisions.find(
		(decision) => decision.domain === "optimization",
	);
	const bibliotecario = report.decisions.find(
		(decision) => decision.domain === "bibliotecario",
	);
	assert.ok(optimization);
	assert.equal(optimization.recommendedAction, "create_task");
	assert.equal(optimization.taskDraft?.guardRisk, "medium");
	assert.match(optimization.taskDraft?.text ?? "", /optimization/i);
	assert.ok(bibliotecario);
	assert.equal(bibliotecario.recommendedAction, "create_task");
	assert.match(bibliotecario.taskDraft?.text ?? "", /Bibliotecario|source/i);
});

test("npm security coverage gap is raw honest and does not claim coverage", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [
			{
				id: "external-security-coverage-gap",
				category: "external_security_coverage_gap",
				severity: "warning",
				confidence: 0.8,
				evidenceRefs: ["external-intelligence:npm-advisories=skipped"],
				summary: "npm/security advisory coverage is unavailable or skipped",
				recommendedActions: [
					"Do not claim dependency-risk awareness until allowlisted evidence exists.",
				],
			},
		],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find((item) =>
		item.id.includes("external-security-coverage-gap"),
	);
	assert.ok(decision);
	assert.equal(decision.domain, "security");
	assert.equal(decision.recommendedAction, "ask_human");
	assert.equal(decision.taskDraft, undefined);
	assert.ok(
		decision.uncomfortableTruths.some((truth) =>
			/Do not claim full dependency-risk awareness/u.test(
				truth.omittedComfort ?? truth.claim,
			),
		),
	);
});
