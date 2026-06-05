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

function decisionFromSelfMaintenanceSignal(
	input: BuildAutonomousAlertEngineReportInput,
	signal: SupervisorSelfMaintenanceSignal,
	generatedAt: string,
	now: Date,
): AutonomousAlertDecision | undefined {
	const domain = mapSignalDomain(signal.category);
	if (!domain || input.control.disabledDomains.includes(domain)) {
		return undefined;
	}
	const cooldownKey = `${domain}:${signal.id}`;
	const cooldownUntil = input.cooldowns?.[cooldownKey];
	const inCooldown = cooldownActive(cooldownUntil, now);
	const highRisk = signal.severity === "high";
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
		domain,
		severity: signal.severity,
		confidence: signal.confidence,
		evidenceRefs: signal.evidenceRefs,
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: signal.summary,
				evidenceRefs: signal.evidenceRefs,
				impact:
					"Ignoring this signal makes the project less reliable and less centered on the Master Plan.",
				requiredNext: highRisk
					? "Ask the human before high-impact action."
					: (signal.recommendedActions[0] ??
						"Create a bounded follow-up task."),
			},
		],
		recommendedAction,
		...(recommendedAction === "create_task"
			? {
					taskDraft: {
						text: `${signal.summary}. Evidence: ${signal.evidenceRefs.join(", ")}`,
						category: "maintenance",
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

function mapSignalDomain(
	category: SupervisorSelfMaintenanceSignal["category"],
): AutonomousAlertDomain | undefined {
	if (category === "backlog_pressure") return "backlog";
	if (category === "stale_tasks") return "stale_work";
	if (category === "neglected_areas") return "neglected_area";
	if (category === "semantic_audit_pressure") return "semantic_audit";
	if (category === "supervisor_activity_pressure") return "agentlab";
	return undefined;
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
