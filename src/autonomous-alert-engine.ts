import type {
	StructuredTask,
	StructuredTaskInput,
} from "./structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

export type AutonomousAlertDomain =
	| "repeated_bug"
	| "backlog"
	| "stale_work"
	| "neglected_area"
	| "bibliotecario"
	| "security"
	| "db"
	| "optimization"
	| "semantic_audit"
	| "agentlab";

export type AutonomousAlertSeverity = "info" | "warning" | "high";
export type AutonomousAlertRecommendedAction =
	| "create_task"
	| "report_only"
	| "ask_human"
	| "snooze"
	| "blocked_by_pause";

export type RawHonestyTruth = {
	claim: string;
	evidenceRefs: string[];
	impact: string;
	requiredNext: string;
	omittedComfort?: string;
};

export type AutonomousAlertControlState = {
	version: 1;
	active: boolean;
	pausedUntil?: string;
	disabledDomains: string[];
	reason?: string;
	updatedAt: string;
};

export type AutonomousAlertTaskDraft = {
	text: string;
	category: StructuredTaskInput["category"];
	priority: number;
	guardRisk: "low" | "medium" | "high";
	evidenceRefs: string[];
};

export type AutonomousAlertDecision = {
	version: 1;
	id: string;
	generatedAt: string;
	projectId: string;
	authority: "advisory";
	domain: AutonomousAlertDomain;
	severity: AutonomousAlertSeverity;
	confidence: number;
	evidenceRefs: string[];
	rawHonesty: true;
	uncomfortableTruths: RawHonestyTruth[];
	recommendedAction: AutonomousAlertRecommendedAction;
	taskDraft?: AutonomousAlertTaskDraft;
	cooldownKey: string;
	cooldownUntil?: string;
	requiresHuman: boolean;
	forbiddenActions: string[];
};

export type AutonomousAlertEngineReport = {
	version: 1;
	authority: "advisory";
	mode: "autonomous_detection";
	generatedAt: string;
	projectId: string;
	active: boolean;
	paused: boolean;
	noImplementation: true;
	agentLabsExecuted: false;
	rulesApplied: false;
	skillsModified: false;
	contractsModified: false;
	dependenciesUpdated: false;
	rawHonesty: true;
	uncomfortableTruths: RawHonestyTruth[];
	decisions: AutonomousAlertDecision[];
	tasksCreated: Array<{
		taskId: string;
		alertId: string;
		evidenceRefs: string[];
	}>;
	humanEscalations: AutonomousAlertDecision[];
	suppressedByCooldown: AutonomousAlertDecision[];
	safeNotes: string[];
};

export type BuildAutonomousAlertEngineReportInput = {
	projectId: string;
	now?: Date;
	control: AutonomousAlertControlState;
	tasks: readonly StructuredTask[];
	selfMaintenanceSignals: readonly SupervisorSelfMaintenanceSignal[];
	allowTaskCreation: boolean;
	cooldowns?: Record<string, string>;
};

const FORBIDDEN_ACTIONS = [
	"no_code_implementation",
	"no_agentlabs_execution",
	"no_dependency_updates",
	"no_rule_changes",
	"no_skill_changes",
	"no_contract_changes",
] as const;

const REPEATED_BUG_KEYWORDS = [
	"postflight",
	"telegram",
	"bibliotecario",
	"agentlab",
	"context",
	"source",
	"skill",
	"security",
	"db",
	"auth",
] as const;

const HIGH_RISK_WORDS =
	/\b(security|auth|db|database|schema|migration|contract|rule|skill|dependency|npm|core)\b/iu;

export function buildAutonomousAlertEngineReport(
	input: BuildAutonomousAlertEngineReportInput,
): AutonomousAlertEngineReport {
	const now = input.now ?? new Date();
	const generatedAt = now.toISOString();
	const paused = isPaused(input.control, now);
	const decisions: AutonomousAlertDecision[] = [];

	if (!input.control.active || paused) {
		const blocked = blockedDecision(input, generatedAt, paused);
		decisions.push(blocked);
		return baseReport(input, generatedAt, paused, decisions);
	}

	const repeatedBug = repeatedBugDecision(input, generatedAt, now);
	if (repeatedBug) decisions.push(repeatedBug);

	for (const signal of input.selfMaintenanceSignals) {
		const decision = decisionFromSelfMaintenanceSignal(
			input,
			signal,
			generatedAt,
			now,
		);
		if (decision) decisions.push(decision);
	}

	return baseReport(input, generatedAt, paused, decisions);
}

function baseReport(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	paused: boolean,
	decisions: AutonomousAlertDecision[],
): AutonomousAlertEngineReport {
	const uncomfortableTruths = decisions.flatMap(
		(decision) => decision.uncomfortableTruths,
	);
	return {
		version: 1,
		authority: "advisory",
		mode: "autonomous_detection",
		generatedAt,
		projectId: input.projectId,
		active: input.control.active,
		paused,
		noImplementation: true,
		agentLabsExecuted: false,
		rulesApplied: false,
		skillsModified: false,
		contractsModified: false,
		dependenciesUpdated: false,
		rawHonesty: true,
		uncomfortableTruths,
		decisions,
		tasksCreated: [],
		humanEscalations: decisions.filter((decision) => decision.requiresHuman),
		suppressedByCooldown: decisions.filter(
			(decision) => decision.recommendedAction === "snooze",
		),
		safeNotes: [
			"Autonomous alerts are detection/task-routing only; no implementation was performed.",
			"AgentLabs, dependencies, rules, skills, and contracts were not modified.",
		],
	};
}

function repeatedBugDecision(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	now: Date,
): AutonomousAlertDecision | undefined {
	const projectTasks = input.tasks.filter(
		(task) => !task.projectId || task.projectId === input.projectId,
	);
	const counts = new Map<string, StructuredTask[]>();
	for (const task of projectTasks) {
		if (hasCoveredRepeatedBugEvidence(task)) continue;
		const text = task.text.toLowerCase();
		if (!/\b(bug|fail|failure|error|regression|repeated)\b/u.test(text)) {
			continue;
		}
		for (const keyword of REPEATED_BUG_KEYWORDS) {
			if (text.includes(keyword)) {
				const list = counts.get(keyword) ?? [];
				list.push(task);
				counts.set(keyword, list);
			}
		}
	}
	const match = [...counts.entries()].find(([, tasks]) => tasks.length >= 4);
	if (!match) return undefined;
	const [keyword, tasks] = match;
	const cooldownKey = `repeated_bug:${keyword}`;
	const cooldownUntil = input.cooldowns?.[cooldownKey];
	const evidenceRefs = tasks
		.slice(0, 6)
		.map((task) => `structured-task:${task.id}`);
	const highRisk = tasks.some((task) => HIGH_RISK_WORDS.test(task.text));
	const inCooldown = cooldownActive(cooldownUntil, now);
	const recommendedAction: AutonomousAlertRecommendedAction = inCooldown
		? "snooze"
		: highRisk
			? "ask_human"
			: input.allowTaskCreation
				? "create_task"
				: "report_only";
	return {
		version: 1,
		id: `alert-${cooldownKey}`,
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain: "repeated_bug",
		severity: highRisk ? "high" : "warning",
		confidence: 0.85,
		evidenceRefs,
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: `The same ${keyword} bug/failure pattern appeared ${tasks.length} times. Treating these as isolated incidents is process drift.`,
				evidenceRefs,
				impact:
					"Repeated failures waste review time and hide missing regression coverage.",
				requiredNext: highRisk
					? "Ask the human before changing high-risk areas."
					: "Create a focused investigation task and add or verify a regression test.",
				omittedComfort: "The report will not call this normal backlog noise.",
			},
		],
		recommendedAction,
		...(recommendedAction === "create_task"
			? {
					taskDraft: {
						text: `Investigate repeated ${keyword} bug pattern and add or verify a regression test. Evidence: ${evidenceRefs.join(", ")}`,
						category: "bug",
						priority: 3,
						guardRisk: "low" as const,
						evidenceRefs,
					},
				}
			: {}),
		cooldownKey,
		...(cooldownUntil ? { cooldownUntil } : {}),
		requiresHuman: highRisk,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

function hasCoveredRepeatedBugEvidence(task: StructuredTask): boolean {
	if (task.status !== "done") return false;
	const evidence = coverageEvidenceSegment(
		(task.completionEvidence ?? "").toLowerCase(),
	);
	if (hasNegativeCoverageEvidence(evidence)) return false;
	return hasPositiveCoverageEvidence(evidence);
}

function coverageEvidenceSegment(evidence: string): string {
	const markerPattern = /(^|[.!?]\s+)(verification|evidence):/gu;
	const matches = [...evidence.matchAll(markerPattern)];
	const lastMatch = matches.at(-1);
	if (!lastMatch?.index) return evidence;
	return evidence.slice(lastMatch.index + lastMatch[1].length);
}

function hasNegativeCoverageEvidence(evidence: string): boolean {
	return /no regression|tests? skipped|not all tests passed|no tests passed|postflight failed|needs evidence|needs_evidence|did not pass|no coverage|not updated|no postflight evidence|no .*evidence/u.test(
		evidence,
	);
}

function hasPositiveCoverageEvidence(evidence: string): boolean {
	return /regression (test|coverage|evidence)|review checklist|checklist updated|focused tests passed|tests passed|full build\/test|full gate[^.]*pass|postflight evidence|(?:fresh )?reviewer(?: [a-z0-9]+)? pass/u.test(
		evidence,
	);
}

function decisionFromSelfMaintenanceSignal(
	input: BuildAutonomousAlertEngineReportInput,
	signal: SupervisorSelfMaintenanceSignal,
	generatedAt: string,
	now: Date,
): AutonomousAlertDecision | undefined {
	const cls = classifySignal(signal, input.control, input.cooldowns, now);
	if (!cls.domain) return undefined;
	const domain = cls.domain;
	const cooldownKey = cls.cooldownKey;
	const cooldownUntil = input.cooldowns?.[cooldownKey];
	const inCooldown = cls.inCooldown;
	const protectedDomain = cls.protectedDomain;
	const highRisk = cls.highRisk;
	const recommendedAction: AutonomousAlertRecommendedAction = inCooldown
		? "snooze"
		: protectedDomain || signal.severity === "high"
			? "ask_human"
			: input.allowTaskCreation
				? "create_task"
				: "report_only";
	return {
		version: 1,
		id: `alert-${cooldownKey}`,
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain,
		severity: signal.severity,
		confidence: signal.confidence,
		evidenceRefs: signal.evidenceRefs,
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: signal.summary,
				evidenceRefs: signal.evidenceRefs,
				impact: impactForDomain(domain),
				requiredNext: highRisk
					? "Ask the human before high-impact action."
					: (signal.recommendedActions[0] ??
						"Create a bounded follow-up task."),
				...(signal.category === "external_security_coverage_gap"
					? {
							omittedComfort:
								"Do not claim full dependency-risk awareness while npm/security advisory coverage is unavailable, skipped, or unproven.",
						}
					: {}),
			},
		],
		recommendedAction,
		...(recommendedAction === "create_task"
			? {
					taskDraft: {
						text: taskDraftTextForDomain(domain, signal),
						category: domain === "bibliotecario" ? "docs" : "maintenance",
						priority: 4,
						guardRisk: "medium" as const,
						evidenceRefs: signal.evidenceRefs,
					},
				}
			: {}),
		cooldownKey,
		...(cooldownUntil ? { cooldownUntil } : {}),
		requiresHuman: highRisk,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

export function mapSignalDomain(
	category: SupervisorSelfMaintenanceSignal["category"],
): AutonomousAlertDomain | undefined {
	if (category === "backlog_pressure") return "backlog";
	if (category === "stale_tasks") return "stale_work";
	if (category === "neglected_areas") return "neglected_area";
	if (category === "semantic_audit_pressure") return "semantic_audit";
	if (category === "supervisor_activity_pressure") return "agentlab";
	if (category === "bibliotecario_source_pressure") return "bibliotecario";
	if (category === "security_review_pressure") return "security";
	if (category === "db_review_pressure") return "db";
	if (category === "optimization_review_pressure") return "optimization";
	if (category === "external_security_coverage_gap") return "security";
	return undefined;
}

export function isProtectedDomain(domain: AutonomousAlertDomain): boolean {
	return domain === "security" || domain === "db";
}

/**
 * Issue #398: shared signal classification. Both
 * `decisionFromSelfMaintenanceSignal` (the create_task branch) and
 * `systemicBypassEligibility` (the Layer-2 bypass gate) need the
 * SAME four checks — domain mapping, disabled-domain, cooldown, and
 * severity/protection — to decide whether a signal is eligible to
 * produce a task. Before this helper the bypass function only ran
 * the domain/severity tests and silently passed disabled or
 * cooldowned signals through. Centralising the logic here is the
 * "compartan la condición" the issue asks for: any future change to
 * the task-ability condition updates both branches at once.
 */
export type SignalClassification = {
	domain: AutonomousAlertDomain | undefined;
	cooldownKey: string;
	inCooldown: boolean;
	protectedDomain: boolean;
	highRisk: boolean;
	/** True iff the signal would produce `create_task` if
	 *  `allowTaskCreation` were true. False for unmapped, disabled,
	 *  cooldowned, protected, or `high`-severity signals. The bypass
	 *  gate uses this without `allowTaskCreation`; the alert engine
	 *  multiplies it by `input.allowTaskCreation` to pick the actual
	 *  recommendedAction. */
	wouldCreateTask: boolean;
};

export function classifySignal(
	signal: SupervisorSelfMaintenanceSignal,
	control: AutonomousAlertControlState,
	cooldowns: Record<string, string> | undefined,
	now: Date,
): SignalClassification {
	const domain = mapSignalDomain(signal.category);
	const cooldownKey = domain ? `${domain}:${signal.id}` : "";
	const inCooldown = domain
		? cooldownActive(cooldowns?.[cooldownKey], now)
		: false;
	const protectedDomain = domain ? isProtectedDomain(domain) : false;
	const highRisk = signal.severity === "high" || protectedDomain;
	const wouldCreateTask =
		domain !== undefined &&
		!control.disabledDomains.includes(domain) &&
		!inCooldown &&
		!protectedDomain &&
		signal.severity !== "high";
	return {
		domain,
		cooldownKey,
		inCooldown,
		protectedDomain,
		highRisk,
		wouldCreateTask,
	};
}

/**
 * Derives self-repair bypass eligibility from the systemic
 * self-maintenance signals, WITHOUT re-running the full alert
 * decision. Reuses `classifySignal` (single source of truth for the
 * task-ability condition) so this function and
 * `decisionFromSelfMaintenanceSignal` cannot drift.
 *
 * Used by the automaticov1 cycle to gate the Layer 2 self-repair
 * bypass in `decideAllowTaskCreation` so the bypass fires only when:
 *   - canCreateTask: at least one signal would produce a concrete
 *     create_task (a repair to queue), AND
 *   - protectedDomainPresent is false: NONE of the (non-disabled)
 *     signals is in a protected domain (security / db).
 *
 * Issue #398: disabled-domain and cooldown gates are checked here
 * via `classifySignal`. A signal whose domain is in
 * `control.disabledDomains` is skipped entirely — same as
 * `decisionFromSelfMaintenanceSignal` returning `undefined` for the
 * same case.
 *
 * The protectedDomainPresent floor is INTENTIONALLY REDUNDANT with
 * canCreateTask: a protected domain also fails the task-ability test
 * today (protected → ask_human, never create_task), so the floor
 * never changes the current outcome. The redundancy is the point —
 * if someone later adds a taskDraft to a protected signal, the floor
 * still blocks the bypass, and removing security protection becomes a
 * visible diff rather than a silent behavior change.
 *
 * `control` is OPTIONAL with FAIL-CLOSED semantics. When the
 * caller did not wire the alert-engine state we cannot know which
 * domains are disabled — the same shape as a domain being disabled
 * — so the bypass must NOT fire. Returning both flags `false`
 * reproduces the "off" verdict the alert engine would emit for an
 * unknown-disabled signal. This was the bug the owner caught in
 * the PR audit: a previous default of `{ disabledDomains: [] }`
 * was fail-OPEN (the empty list is the most permissive state and
 * reproduced the pre-fix bug exactly). Fail-closed is enforced
 * here at the helper level so any caller that forgets to wire
 * control gets the safe verdict, regardless of the cycle-level
 * default.
 */
export function systemicBypassEligibility(
	signals: readonly SupervisorSelfMaintenanceSignal[],
	control: AutonomousAlertControlState | undefined,
	cooldowns: Record<string, string> | undefined,
	now: Date,
): { canCreateTask: boolean; protectedDomainPresent: boolean } {
	// Issue #463: the four "I can't tell" conditions are decided in
	// ONE place at the top of the helper, not per-signal. Each
	// condition mirrors a check the motor de alertas performs in
	// `buildAutonomousAlertEngineReport` (line ~142):
	//   !control.active              — operator turned the engine off
	//   isPaused(control, now)       — control.pausedUntil in the future
	// Without `control` the helper can't know either way; that is the
	// previous fail-closed (#462). The trade-off: the protectedDomain
	// floor's "intentional redundancy" disappears for these three
	// "no info" paths — but the redundancy was meant to defend
	// against a per-signal case that could let a task through, and
	// these are global cuts that already deny at the source. The
	// per-signal redundancy (cooldown, disabled, protected, high)
	// remains. The owner said: "decidí una sola vez para las
	// cuatro condiciones, no una por una."
	if (!control) {
		return { canCreateTask: false, protectedDomainPresent: false };
	}
	if (control.active === false) {
		return { canCreateTask: false, protectedDomainPresent: false };
	}
	if (control.pausedUntil && new Date(control.pausedUntil) > now) {
		return { canCreateTask: false, protectedDomainPresent: false };
	}
	let canCreateTask = false;
	let protectedDomainPresent = false;
	for (const signal of signals) {
		const cls = classifySignal(signal, control, cooldowns, now);
		// Mirror decisionFromSelfMaintenanceSignal's
		// `if (!domain || input.control.disabledDomains.includes(domain)) return undefined`.
		// Unmapped and disabled-domain signals produce no decision at all.
		if (!cls.domain) continue;
		if (control.disabledDomains.includes(cls.domain)) continue;
		if (cls.wouldCreateTask) {
			canCreateTask = true;
		} else if (isProtectedDomain(cls.domain)) {
			protectedDomainPresent = true;
		}
	}
	return { canCreateTask, protectedDomainPresent };
}

function impactForDomain(domain: AutonomousAlertDomain): string {
	if (domain === "security") {
		return "Security or dependency-risk coverage cannot be assumed from weak evidence; false confidence would make the project less safe.";
	}
	if (domain === "db") {
		return "DB/schema/data drift can corrupt project behavior; it needs human review before changes.";
	}
	if (domain === "optimization") {
		return "Resource efficiency is being assumed, not proven, until a bounded optimization audit exists.";
	}
	if (domain === "bibliotecario") {
		return "Source/version awareness is stale when registered evidence is not reviewed.";
	}
	return "Ignoring this signal makes the project less reliable and less centered on the Master Plan.";
}

function taskDraftTextForDomain(
	domain: AutonomousAlertDomain,
	signal: SupervisorSelfMaintenanceSignal,
): string {
	if (domain === "optimization") {
		return `Run a bounded resource optimization audit. Evidence: ${signal.evidenceRefs.join(", ")}`;
	}
	if (domain === "bibliotecario") {
		return `Run a bounded Bibliotecario/source review using registered or allowlisted evidence only. Evidence: ${signal.evidenceRefs.join(", ")}`;
	}
	return `${signal.summary}. Evidence: ${signal.evidenceRefs.join(", ")}`;
}

function blockedDecision(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	paused: boolean,
): AutonomousAlertDecision {
	const reason = paused
		? "Alert engine is paused."
		: "Alert engine is inactive.";
	return {
		version: 1,
		id: "alert-engine-blocked",
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain: "backlog",
		severity: "info",
		confidence: 1,
		evidenceRefs: ["alert-engine:control-state"],
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: reason,
				evidenceRefs: ["alert-engine:control-state"],
				impact:
					"No autonomous alert tasks will be created while control state blocks the engine.",
				requiredNext:
					"Enable or resume alerts if autonomous supervision is desired.",
			},
		],
		recommendedAction: "blocked_by_pause",
		cooldownKey: "alert-engine:blocked",
		requiresHuman: false,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

function isPaused(control: AutonomousAlertControlState, now: Date): boolean {
	return Boolean(
		control.pausedUntil && Date.parse(control.pausedUntil) > now.getTime(),
	);
}

function cooldownActive(value: string | undefined, now: Date): boolean {
	return Boolean(value && Date.parse(value) > now.getTime());
}
