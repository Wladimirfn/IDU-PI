import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Event } from "./event-bus.js";
import { appendEvent, readEvents } from "./event-bus.js";
import { buildObjectiveReminderText } from "./objective-reminder.js";
import type { Injection } from "./injection-store.js";
import { appendInjection, readPendingInjections } from "./injection-store.js";

export type TriggerContext = {
	stateRoot: string;
	projectId: string;
	now: Date;
	isProjectActive?: () => boolean;
};

export type MatchResult = {
	triggerId: string;
	matches: Array<{ event: Event; reason: string }>;
};

export type TriggerDefinition = {
	id: string;
	description: string;
	kinds: string[];
	signature: string;
	contract: {
		decisionRequired: boolean;
		severity: "info" | "warning" | "critical";
		options: string[];
	};
	match: (events: Event[], context: TriggerContext) => MatchResult;
	build: (
		matches: MatchResult,
		context: TriggerContext,
	) => Omit<Injection, "ts" | "acked" | "injectionId">;
};

export type TriggerEngineResult = {
	injectedCount: number;
	skippedByIdempotency: number;
	evaluatedTriggers: string[];
};

const ONE_HOUR_MS = 3_600_000;
const THIRTY_MIN_MS = 1_800_000;

function computeInjectionId(args: {
	triggerId: string;
	fromTs: string;
	toTs: string;
	signature: string;
}): string {
	const h = createHash("sha1");
	h.update(`${args.triggerId}|${args.fromTs}|${args.toTs}|${args.signature}`);
	return h.digest("hex").slice(0, 16);
}

const stuckTasks1hDefinition: TriggerDefinition = {
	id: "stuck_tasks_1h",
	description: "Detecta tareas abiertas más de 1h sin movimiento posterior.",
	kinds: ["task_stuck", "task_created", "intention_registered"],
	signature: "stuck|task_stuck|task_created|intention_registered",
	contract: {
		decisionRequired: true,
		severity: "warning",
		options: ["review_each", "close_stale", "ignore"],
	},
	match: (events, context) => {
		const fromTs = new Date(context.now.getTime() - ONE_HOUR_MS).toISOString();
		const window = events.filter((e) => e.ts >= fromTs);
		const stuckEvents = window.filter((e) => e.kind === "task_stuck");
		const matches: Array<{ event: Event; reason: string }> = [];
		for (const stuck of stuckEvents) {
			const taskId = (stuck.payload as { taskId?: string }).taskId;
			if (!taskId) continue;
			const later = window.find(
				(e) =>
					(e.kind === "task_created" || e.kind === "intention_registered") &&
					(e.payload as { taskId?: string }).taskId === taskId &&
					e.ts >= stuck.ts,
			);
			if (later) continue;
			matches.push({
				event: stuck,
				reason: `task ${taskId} stuck ${(stuck.payload as { ageMs?: number }).ageMs ?? "?"}ms`,
			});
		}
		return { triggerId: "stuck_tasks_1h", matches };
	},
	build: (matches, context) => ({
		triggerId: "stuck_tasks_1h",
		decisionEnvelope: {
			severity: "warning",
			summary: `${matches.matches.length} tareas abiertas más de 1h`,
			options: ["review_each", "close_stale", "ignore"],
			evidenceRefs: matches.matches.map((m) => `events.jsonl:${m.event.ts}`),
			orchestratorDecisionRequired: true,
		},
	}),
};

const objectiveReminderHourlyDefinition: TriggerDefinition = {
	id: "objective_reminder_hourly",
	description:
		"Recuerda el objetivo del proyecto cuando el cache tiene más de 1h.",
	kinds: ["master_plan_drift"],
	signature: "objective|cache|active",
	contract: {
		decisionRequired: false,
		severity: "info",
		options: ["review", "ignore"],
	},
	match: (events, context) => {
		const isActive = context.isProjectActive?.() ?? false;
		if (!isActive)
			return { triggerId: "objective_reminder_hourly", matches: [] };
		const cachePath = join(
			context.stateRoot,
			"master-plan-objective-cache.json",
		);
		if (!existsSync(cachePath)) {
			return {
				triggerId: "objective_reminder_hourly",
				matches: [
					{
						event: syntheticEvent(context, "master_plan_drift", {
							reason: "cache_missing",
						}),
						reason: "objective cache missing",
					},
				],
			};
		}
		try {
			const raw = readFileSync(cachePath, "utf8");
			const parsed = JSON.parse(raw) as { updatedAt?: string };
			if (!parsed.updatedAt)
				return { triggerId: "objective_reminder_hourly", matches: [] };
			const ageMs =
				context.now.getTime() - new Date(parsed.updatedAt).getTime();
			if (ageMs <= ONE_HOUR_MS)
				return { triggerId: "objective_reminder_hourly", matches: [] };
			return {
				triggerId: "objective_reminder_hourly",
				matches: [
					{
						event: syntheticEvent(context, "master_plan_drift", {
							reason: "cache_stale",
							ageMs,
						}),
						reason: `cache ageMs ${ageMs}`,
					},
				],
			};
		} catch {
			return { triggerId: "objective_reminder_hourly", matches: [] };
		}
	},
	build: (_matches, context) => {
		const summary = buildObjectiveReminderText({
			stateRoot: context.stateRoot,
			now: context.now,
		});
		// Emit the master_plan_drift event so the role engine
		// (supervisor-main, supervisor-semantic) sees the stimulus.
		try {
			appendEvent(
				context.stateRoot,
				syntheticEvent(context, "master_plan_drift", {
					reason: "objective_reminder_fired",
				}),
			);
		} catch {
			// best-effort; do not block the build
		}
		return {
			triggerId: "objective_reminder_hourly",
			decisionEnvelope: {
				severity: "info",
				summary,
				options: ["review", "ignore"],
				evidenceRefs: ["master-plan-objective-cache.json"],
				orchestratorDecisionRequired: false,
			},
		};
	},
};

const intentionDecisionPendingDefinition: TriggerDefinition = {
	id: "intention_decision_pending",
	description:
		"Detecta intenciones pendientes de decisión humana hace más de 30 min.",
	kinds: ["intention_decision_pending"],
	signature: "intention|intention_decision_pending",
	contract: {
		decisionRequired: true,
		severity: "warning",
		options: ["review", "delegate", "ignore"],
	},
	match: (events, context) => {
		const fromTs = new Date(
			context.now.getTime() - THIRTY_MIN_MS,
		).toISOString();
		const window = events.filter((e) => e.ts >= fromTs);
		const matches: Array<{ event: Event; reason: string }> = [];
		for (const ev of window) {
			if (ev.kind !== "intention_decision_pending") continue;
			const payload = ev.payload as { ageMs?: number; requiresHuman?: boolean };
			if (payload.requiresHuman !== true) continue;
			if ((payload.ageMs ?? 0) < THIRTY_MIN_MS) continue;
			matches.push({
				event: ev,
				reason: `intention pending ${payload.ageMs}ms`,
			});
		}
		return { triggerId: "intention_decision_pending", matches };
	},
	build: (matches) => ({
		triggerId: "intention_decision_pending",
		decisionEnvelope: {
			severity: "warning",
			summary: `${matches.matches.length} intenciones esperando decisión humana`,
			options: ["review", "delegate", "ignore"],
			evidenceRefs: matches.matches.map((m) => `events.jsonl:${m.event.ts}`),
			orchestratorDecisionRequired: true,
		},
	}),
};

function syntheticEvent(
	context: TriggerContext,
	kind: string,
	payload: Record<string, unknown>,
): Event {
	return {
		ts: context.now.toISOString(),
		kind,
		projectId: context.projectId,
		payload,
		sourceRef: "trigger-engine-synthetic",
		evidenceRefs: [],
	};
}

export const TRIGGER_DEFINITIONS: TriggerDefinition[] = [
	stuckTasks1hDefinition,
	objectiveReminderHourlyDefinition,
	intentionDecisionPendingDefinition,
];

export function runTriggerEngineTick(
	context: TriggerContext,
): TriggerEngineResult {
	const events = readEvents(context.stateRoot, {});
	let injectedCount = 0;
	let skippedByIdempotency = 0;
	const existing = readPendingInjections(context.stateRoot, {});
	const existingIds = new Set(existing.map((i) => i.injectionId));

	for (const def of TRIGGER_DEFINITIONS) {
		const result = def.match(events, context);
		if (result.matches.length === 0) continue;
		const fromTs = new Date(context.now.getTime() - ONE_HOUR_MS).toISOString();
		const toTs = context.now.toISOString();
		const injectionId = computeInjectionId({
			triggerId: def.id,
			fromTs,
			toTs,
			signature: def.signature,
		});
		if (existingIds.has(injectionId)) {
			skippedByIdempotency += 1;
			continue;
		}
		const built = def.build(result, context);
		const envelope: Injection = {
			ts: context.now.toISOString(),
			triggerId: def.id,
			decisionEnvelope: built.decisionEnvelope,
			injectionId,
			acked: false,
		};
		appendInjection(context.stateRoot, envelope);
		injectedCount += 1;
	}
	return {
		injectedCount,
		skippedByIdempotency,
		evaluatedTriggers: TRIGGER_DEFINITIONS.map((d) => d.id),
	};
}
