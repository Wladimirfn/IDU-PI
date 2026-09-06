import type {
	AutonomousAlertControlState,
	RawHonestyTruth,
} from "./autonomous-alert-engine.js";

export type AutonomousAlertCronStatus = "idle" | "paused" | "would_run";

export type AutonomousAlertCronPlanInput = {
	projectId: string;
	iduActive: boolean;
	control: AutonomousAlertControlState;
	now?: Date;
	allowTaskCreation?: boolean;
};

export type AutonomousAlertCronPlan = {
	version: 1;
	authority: "advisory";
	mode: "cron_plan";
	projectId: string;
	generatedAt: string;
	status: AutonomousAlertCronStatus;
	reason:
		| "idu_inactive"
		| "alert_engine_inactive"
		| "alert_engine_paused"
		| "ready";
	allowTaskCreation: boolean;
	nextToolCall?: {
		tool: "idu_autonomous_alerts_tick";
		args: { allowTaskCreation: boolean };
	};
	proposedActions: string[];
	advisoryOnly: true;
	agentLabsAllowed: false;
	dependenciesAllowed: false;
	rulesAllowed: false;
	skillsAllowed: false;
	contractsAllowed: false;
	rawHonesty: true;
	uncomfortableTruths: RawHonestyTruth[];
	safeNotes: string[];
};

export function planAutonomousAlertCron(
	input: AutonomousAlertCronPlanInput,
): AutonomousAlertCronPlan {
	const now = input.now ?? new Date();
	const generatedAt = now.toISOString();
	const allowTaskCreation = input.allowTaskCreation === true;
	if (!input.iduActive) {
		return basePlan({
			input,
			generatedAt,
			status: "idle",
			reason: "idu_inactive",
			allowTaskCreation: false,
			proposedActions: [
				"Activate Idu-pi before scheduled alert ticks can run.",
			],
			truth: {
				claim:
					"Autonomous alert cron is idle because Idu-pi guardrails are inactive.",
				evidenceRefs: ["idu-session:inactive"],
				impact:
					"No scheduled alert loop will protect the project while Idu-pi is off.",
				requiredNext:
					"Run Idu activation before expecting automatic alert checks.",
			},
		});
	}
	if (!input.control.active) {
		return basePlan({
			input,
			generatedAt,
			status: "paused",
			reason: "alert_engine_inactive",
			allowTaskCreation: false,
			proposedActions: [
				"Enable autonomous alerts before scheduled ticks can run.",
			],
			truth: {
				claim:
					"Autonomous alert cron is stopped because the alert engine is disabled.",
				evidenceRefs: ["autonomous-alert-control:active=false"],
				impact:
					"Idu-pi will not create alert decisions or routine tasks from scheduled checks.",
				requiredNext:
					"Enable alerts only if autonomous supervision is desired.",
			},
		});
	}
	if (isPaused(input.control, now)) {
		return basePlan({
			input,
			generatedAt,
			status: "paused",
			reason: "alert_engine_paused",
			allowTaskCreation: false,
			proposedActions: [
				"Wait until the pause expires or resume autonomous alerts before scheduled ticks run.",
			],
			truth: {
				claim: "Autonomous alert cron is paused by alert control state.",
				evidenceRefs: [
					`autonomous-alert-control:pausedUntil=${input.control.pausedUntil}`,
				],
				impact:
					"Scheduled alert checks are intentionally suppressed to avoid unwanted automation.",
				requiredNext: "Resume alerts or wait for the pause window to expire.",
			},
		});
	}
	return basePlan({
		input,
		generatedAt,
		status: "would_run",
		reason: "ready",
		allowTaskCreation,
		nextToolCall: {
			tool: "idu_autonomous_alerts_tick",
			args: { allowTaskCreation },
		},
		proposedActions: [
			"Run idu_autonomous_alerts_tick as an advisory scheduled check.",
			allowTaskCreation
				? "Task creation was explicitly requested; keep caps, cooldowns, and high-risk escalation active."
				: "Task creation is disabled by default for scheduled alert ticks.",
		],
		truth: {
			claim:
				"Autonomous alert cron is ready, but scheduled task creation is disabled unless explicitly enabled.",
			evidenceRefs: ["idu-session:active", "autonomous-alert-control:ready"],
			impact:
				"The loop can observe and report safely without silently growing the backlog.",
			requiredNext:
				"Run the alert tick with allowTaskCreation=false for default scheduled checks.",
		},
	});
}

function basePlan(input: {
	input: AutonomousAlertCronPlanInput;
	generatedAt: string;
	status: AutonomousAlertCronStatus;
	reason: AutonomousAlertCronPlan["reason"];
	allowTaskCreation: boolean;
	proposedActions: string[];
	truth: RawHonestyTruth;
	nextToolCall?: AutonomousAlertCronPlan["nextToolCall"];
}): AutonomousAlertCronPlan {
	return {
		version: 1,
		authority: "advisory",
		mode: "cron_plan",
		projectId: input.input.projectId,
		generatedAt: input.generatedAt,
		status: input.status,
		reason: input.reason,
		allowTaskCreation: input.allowTaskCreation,
		...(input.nextToolCall ? { nextToolCall: input.nextToolCall } : {}),
		proposedActions: input.proposedActions,
		advisoryOnly: true,
		agentLabsAllowed: false,
		dependenciesAllowed: false,
		rulesAllowed: false,
		skillsAllowed: false,
		contractsAllowed: false,
		rawHonesty: true,
		uncomfortableTruths: [input.truth],
		safeNotes: [
			"Autonomous alert cron is a plan only; it does not execute AgentLabs, update dependencies, modify rules, modify skills, or change contracts.",
			"Scheduled alert ticks must respect Idu active state, alert pause/off state, cooldowns, and task creation caps.",
		],
	};
}

function isPaused(control: AutonomousAlertControlState, now: Date): boolean {
	return Boolean(
		control.pausedUntil && Date.parse(control.pausedUntil) > now.getTime(),
	);
}
