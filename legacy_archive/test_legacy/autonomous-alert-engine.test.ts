import assert from "node:assert/strict";
import { test } from "node:test";
import type { StructuredTask } from "../src/structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "../src/supervisor-self-maintenance-advisory.js";
import {
	buildAutonomousAlertEngineReport,
	classifySignal,
	systemicBypassEligibility,
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

test("repeated bug alert ignores completed runtime tasks with noisy preamble", () => {
	const runtimeEvidence = [
		"Fixed idu_postflight local-only noise bug. Root cause: buildPostflightTaskTrace compared report.changedFiles against expectedFiles without call-scoped ignored/local-only inputs, so context.md caused misleading needs_evidence. Added call-scoped ignoredFiles to idu_postflight and task trace; exact matches or slash-suffixed prefixes are removed from unexpected detection and included in trace.ignoredFiles; real unexpected files still fail. Commit 225f05f fix(idu): allow postflight local-only ignores pushed to origin/feat/idu-context-pressure. Evidence: RED tests failed before ignoredFiles support; GREEN full gate corepack pnpm build && corepack pnpm test && git diff --check => 1089 pass / 0 fail / 1 skipped; LSP 0; reviewer 4a941d68 PASS.",
		"Resolved repeated-failure learning blocker with regression evidence: covered completed repeated failures no longer emit systemic-repeated-failure-learning; uncovered and mixed uncovered failures still block. Evidence: focused automaticov1/mcp/self-maintenance tests passed; full gate corepack pnpm build && corepack pnpm test && git diff --check passed with 1194 pass / 0 fail / 1 skipped; LSP 0 diagnostics; fresh reviewer ece3c046 PASS.",
		"Resolved systemic-supervisor-friction automaticov1 slice: advisory-only supervisor pressure no longer hard-blocks when readiness/task tree are green and hard pressure evidence is zero; hard supervisor evidence, repeated failures, external-security, readiness, and task-tree gates still block. Evidence: RED test reproduced blocked_systemic_maintenance; focused tests passed; full gate corepack pnpm build && corepack pnpm test && git diff --check passed with 1202 pass / 0 fail / 1 skipped; LSP 0 diagnostics; fresh reviewer c0c25b48 PASS.",
		"Implemented repeated_bug:context alert fix: autonomous alert engine now ignores completed repeated-bug tasks only when completionEvidence has positive regression/review coverage, while negative/insufficient evidence (tests skipped, no regression, checklist not updated, no postflight evidence, postflight failed, needs evidence, did not pass, no coverage) still counts. Verification: RED reproduced covered historical tasks still alerted; RED reproduced insufficient evidence was incorrectly suppressed; GREEN focused autonomous-alert-engine 9 pass / 0 fail; LSP 0; full gate corepack pnpm build && corepack pnpm test && git diff --check => 1225 pass / 0 fail / 1 skipped; fresh reviewer final PASS.",
	];
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: runtimeEvidence.map((completionEvidence, index) => ({
			...task(
				`runtime-noisy-${index + 1}`,
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

test("repeated bug alert still counts colon-form negated evidence", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: Array.from({ length: 4 }, (_, index) => ({
			...task(
				`negated-evidence-colon-${index + 1}`,
				"Bug: postflight context repeated regression",
				"done",
			),
			completionEvidence: "No postflight evidence: reviewer PASS.",
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

// ---------------------------------------------------------------------------
// Issue #398: shared signal classification + bypass gate that honors
// disabledDomains and active cooldowns. The previous bypass gate was
// a stripped mirror that skipped both checks.
// ---------------------------------------------------------------------------

function signal(
	overrides: Partial<{
		id: string;
		category: SupervisorSelfMaintenanceSignal["category"];
		severity: SupervisorSelfMaintenanceSignal["severity"];
	}> = {},
): SupervisorSelfMaintenanceSignal {
	return {
		id: overrides.id ?? "signal-1",
		category: overrides.category ?? "supervisor_activity_pressure",
		severity: overrides.severity ?? "warning",
		confidence: 0.85,
		summary: "test signal",
		evidenceRefs: [],
		recommendedActions: [],
	};
}

const NOW = new Date("2026-06-05T00:00:00.000Z");

test("classifySignal: wouldCreateTask when not disabled, not protected, not cooldown, severity!=high", () => {
	const cls = classifySignal(signal(), activeControl, undefined, NOW);
	assert.equal(cls.domain, "agentlab");
	assert.equal(cls.protectedDomain, false);
	assert.equal(cls.inCooldown, false);
	assert.equal(cls.highRisk, false);
	assert.equal(cls.wouldCreateTask, true);
});

test("classifySignal: wouldCreateTask=false when domain is disabled", () => {
	const control: AutonomousAlertControlState = {
		...activeControl,
		disabledDomains: ["agentlab"],
	};
	const cls = classifySignal(signal(), control, undefined, NOW);
	assert.equal(cls.domain, "agentlab");
	assert.equal(cls.wouldCreateTask, false, "disabled domain MUST NOT contribute to canCreateTask");
});

test("classifySignal: wouldCreateTask=false when in cooldown", () => {
	const cooldowns = { "agentlab:signal-1": new Date(NOW.getTime() + 60_000).toISOString() };
	const cls = classifySignal(signal(), activeControl, cooldowns, NOW);
	assert.equal(cls.inCooldown, true);
	assert.equal(cls.wouldCreateTask, false, "cooldowned signal MUST NOT contribute to canCreateTask");
});

test("classifySignal: wouldCreateTask=false when severity is high", () => {
	const cls = classifySignal(
		signal({ severity: "high" }),
		activeControl,
		undefined,
		NOW,
	);
	assert.equal(cls.highRisk, true);
	assert.equal(cls.wouldCreateTask, false);
});

test("classifySignal: wouldCreateTask=false when domain is protected (security/db)", () => {
	const cls = classifySignal(
		signal({ category: "security_review_pressure" }),
		activeControl,
		undefined,
		NOW,
	);
	assert.equal(cls.domain, "security");
	assert.equal(cls.protectedDomain, true);
	assert.equal(cls.wouldCreateTask, false);
});

test("classifySignal: wouldCreateTask=false for unmapped category", () => {
	const cls = classifySignal(
		signal({ category: "external_security_coverage_gap" }),
		activeControl,
		undefined,
		NOW,
	);
	assert.equal(cls.wouldCreateTask, false);
});

test("systemicBypassEligibility: canCreateTask when at least one signal would create", () => {
	const signals = [signal({ id: "sig-a" }), signal({ id: "sig-b" })];
	const out = systemicBypassEligibility(signals, activeControl, undefined, NOW);
	assert.equal(out.canCreateTask, true);
	assert.equal(out.protectedDomainPresent, false);
});

test("systemicBypassEligibility: empty signals -> both false", () => {
	const out = systemicBypassEligibility([], activeControl, undefined, NOW);
	assert.deepEqual(out, { canCreateTask: false, protectedDomainPresent: false });
});

test("systemicBypassEligibility: disabled domain -> NO contribution (mirror decisionFromSelfMaintenanceSignal)", () => {
	const control: AutonomousAlertControlState = {
		...activeControl,
		disabledDomains: ["security", "agentlab"],
	};
	// Issue #398: a signal whose domain is disabled must be skipped
	// entirely. Same as decisionFromSelfMaintenanceSignal returning
	// undefined. Before the fix, the bypass gate counted it toward
	// protectedDomainPresent if it was protected; this test asserts
	// the new (mirror) behavior — disabled == off.
	const signals = [
		signal({ id: "sig-a", category: "security_review_pressure" }),
		signal({ id: "sig-b", category: "supervisor_activity_pressure" }),
	];
	const out = systemicBypassEligibility(signals, control, undefined, NOW);
	assert.equal(out.canCreateTask, false);
	assert.equal(
		out.protectedDomainPresent,
		false,
		"disabled protected domain must NOT trip the protected floor — it is off",
	);
});

test("systemicBypassEligibility: cooldown -> canCreateTask=false, protected floor still fires when domain is protected", () => {
	// cooldowns fire for "agentlab:signal-a" so sig-a does NOT
	// contribute to canCreateTask. sig-b is in security (protected),
	// not in cooldown. The protected floor should still fire for it.
	const cooldowns = {
		"agentlab:signal-a": new Date(NOW.getTime() + 60_000).toISOString(),
	};
	const signals = [
		signal({ id: "signal-a" }),
		signal({ id: "signal-b", category: "security_review_pressure" }),
	];
	const out = systemicBypassEligibility(signals, activeControl, cooldowns, NOW);
	assert.equal(out.canCreateTask, false, "cooldowned sig-a must NOT enable bypass");
	assert.equal(
		out.protectedDomainPresent,
		true,
		"sig-b is protected (security) so the floor must still fire",
	);
});

test("systemicBypassEligibility: high severity -> canCreateTask=false, protected floor still fires when domain is protected", () => {
	const signals = [
		signal({ id: "sig-a", severity: "high" }),
		signal({ id: "sig-b", category: "security_review_pressure" }),
	];
	const out = systemicBypassEligibility(signals, activeControl, undefined, NOW);
	assert.equal(out.canCreateTask, false, "high-severity sig-a must NOT enable bypass");
	assert.equal(out.protectedDomainPresent, true);
});

test("systemicBypassEligibility: deterministic with same inputs", () => {
	const signals = [
		signal({ id: "sig-a" }),
		signal({ id: "sig-b", category: "security_review_pressure" }),
	];
	const a = systemicBypassEligibility(signals, activeControl, undefined, NOW);
	const b = systemicBypassEligibility(signals, activeControl, undefined, NOW);
	assert.deepEqual(a, b);
});

// Issue #398 audit (post-merge): without `control`, the helper MUST
// fail closed. A previous PR default of `{ disabledDomains: [] }`
// was fail-open: the empty list is the most permissive state and
// reproduced the pre-fix bug exactly (granted bypass on signals the
// operator had not authorised). Both flags must be `false` when
// control is undefined. Mirrors `decisionFromSelfMaintenanceSignal`
// returning `undefined` for the same "no info" case.
test("systemicBypassEligibility: control=undefined -> both flags false (fail-closed)", () => {
	const signals = [signal({ id: "sig-a" }), signal({ id: "sig-b" })];
	const out = systemicBypassEligibility(signals, undefined, undefined, NOW);
	assert.deepEqual(out, { canCreateTask: false, protectedDomainPresent: false });
});

test("systemicBypassEligibility: control=undefined with taskable signal still -> both flags false (fail-closed)", () => {
	// Even with a signal that would normally produce create_task
	// (no disabled, no cooldown, not protected, severity!=high),
	// an absent control must NOT enable the bypass. Same shape
	// that a disabled domain would produce, mirrored.
	const signals = [signal({ id: "sig-a", severity: "warning" })];
	const out = systemicBypassEligibility(signals, undefined, undefined, NOW);
	assert.equal(out.canCreateTask, false);
	assert.equal(out.protectedDomainPresent, false);
});

// Issue #463: the motor de alertas corta before deciding anything
// when `control.active === false` (operator turned the engine off)
// or `isPaused(control, now)` (`control.pausedUntil` in the future).
// The bypass must mirror that — once the operator said "no", every
// signal's wouldCreateTask is false. The protectedDomainPresent
// floor is the same shape as the no-control path: when the helper
// can't tell whether any signal is "really" protected, it fails
// closed on both flags (the "decide once for the four conditions"
// design).
test("systemicBypassEligibility: control.active===false -> both flags false (mirror #142 early-return)", () => {
	const inactiveControl: AutonomousAlertControlState = {
		...activeControl,
		active: false,
	};
	const signals = [signal({ id: "sig-a" })];
	const out = systemicBypassEligibility(signals, inactiveControl, undefined, NOW);
	assert.equal(out.canCreateTask, false);
	assert.equal(out.protectedDomainPresent, false);
});

test("systemicBypassEligibility: control.pausedUntil>now -> both flags false (mirror #142 early-return)", () => {
	const pausedControl: AutonomousAlertControlState = {
		...activeControl,
		pausedUntil: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
	};
	const signals = [signal({ id: "sig-a" })];
	const out = systemicBypassEligibility(signals, pausedControl, undefined, NOW);
	assert.equal(out.canCreateTask, false);
	assert.equal(out.protectedDomainPresent, false);
});

test("systemicBypassEligibility: control.active=true AND pausedUntil in past -> bypass works (control path is clean)", () => {
	// Sanity: when the four "I can't tell" conditions are all clear,
	// the bypass operates as before. This is the "no mutation" baseline.
	const pastPausedControl: AutonomousAlertControlState = {
		...activeControl,
		active: true,
		pausedUntil: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
	};
	const signals = [signal({ id: "sig-a" })];
	const out = systemicBypassEligibility(signals, pastPausedControl, undefined, NOW);
	assert.equal(out.canCreateTask, true);
	assert.equal(out.protectedDomainPresent, false);
});
