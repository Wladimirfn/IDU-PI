/**
 * `supervisor-main` role — T1.6.
 *
 * The principal supervisor that monitors orchestrator turns, alerts ticks,
 * and lab writes. It produces a structured advisory with next_action,
 * priority, blocked_items, risk, and requires_human.
 *
 * REQ-LRV2-10: Priority 90, Cooldown 30s, subscribes to orchestrator_turn,
 * alerts_scheduled_tick, lab_write.
 */

import type { Event, EventKind } from "../event-bus.js";
import type { Role, RoleId, RoleInput, RoleContext, RoleAdvisory } from "./index.js";
import { buildStateSummary } from "./prompt-helpers.js";
import { getOrchestratorAdvisoryStream } from "../orchestrator-advisory-stream.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPERVISOR_MAIN_PRIORITY = 90;
const SUPERVISOR_MAIN_COOLDOWN_MS = 30_000;
const SUPERVISOR_MAIN_SUBSCRIBES: readonly EventKind[] = [
	"orchestrator_turn",
	"alerts_scheduled_tick",
	"lab_write",
];

type SupervisorMainMeta = {
	nextAction: string;
	blockedItems: string[];
	risk: "low" | "medium" | "high";
	requiresHuman: boolean;
};

type LLMResponse = {
	next_action: string;
	priority?: number;
	blocked_items?: string[];
	risk?: "low" | "medium" | "high";
	requires_human?: boolean;
};

function parseLLMResponse(raw: string): LLMResponse | null {
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.next_action === "string"
		) {
			return parsed as LLMResponse;
		}
		return null;
	} catch {
		return null;
	}
}

function buildSupervisorMainPrompt(input: RoleInput, ctx: RoleContext): string {
	// Read recent advisories from the stream
	const stream = getOrchestratorAdvisoryStream(ctx.stateRoot);
	const recentAdvisories = stream.getAdvisories({ limit: 5 });

	// Read events.jsonl to find last alerts_scheduled_tick and lab_write
	const eventsPath = join(ctx.stateRoot, "events.jsonl");
	let lastAlertsTick: Event | undefined;
	let lastLabWrite: Event | undefined;

	if (existsSync(eventsPath)) {
		try {
			const lines = readFileSync(eventsPath, "utf8").trim().split("\n");
			// Read backwards to find the most recent events
			for (let i = lines.length - 1; i >= 0 && (!lastAlertsTick || !lastLabWrite); i--) {
				try {
					const event = JSON.parse(lines[i]!);
					if (!lastAlertsTick && event.kind === "alerts_scheduled_tick") {
						lastAlertsTick = event;
					} else if (!lastLabWrite && event.kind === "lab_write") {
						lastLabWrite = event;
					}
				} catch {
					// skip malformed lines
				}
			}
		} catch {
			// ignore read errors
		}
	}

	const stateSummary = buildStateSummary(recentAdvisories, lastAlertsTick, lastLabWrite);

	const systemPrompt = [
		"You are the principal supervisor for the IDU orchestrator.",
		"Your role is to monitor the orchestrator state and provide actionable advisories.",
		"Analyze the recent state and respond with a JSON object.",
		"",
		"Response schema:",
		"{",
		'  "next_action": "<short imperative: approve task, wait for human, investigate alert, or no action>",',
		'  "priority": <number 0-100>,',
		'  "blocked_items": ["<item 1>", "<item 2>"],',
		'  "risk": "<low|medium|high>",',
		'  "requires_human": <boolean>',
		"}",
		"",
		"Current state:",
		stateSummary,
		"",
		"Respond with a single JSON object.",
	].join("\n");

	return systemPrompt;
}

export function createSupervisorMainRole(): Role {
	return {
		name: "Supervisor principal",
		priority: SUPERVISOR_MAIN_PRIORITY,
		cooldownMs: SUPERVISOR_MAIN_COOLDOWN_MS,
		subscribesTo: () => SUPERVISOR_MAIN_SUBSCRIBES,
		shouldFire(input: RoleInput, lastFireAt: Date | undefined, now: Date): boolean {
			// First time firing or heartbeat/new data events
			const isHeartbeatOrNewData = 
				input.event.kind === "alerts_scheduled_tick" || 
				input.event.kind === "lab_write";
			return !lastFireAt || isHeartbeatOrNewData;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildSupervisorMainPrompt(input, ctx);

			const result = await ctx.router.promptForRole("supervisor-main", prompt, {
				projectId: ctx.projectId,
				stateRoot: ctx.stateRoot,
				invocationSink: (record) => {
					ctx.repository.appendInvocation(record);
				},
			});

			const parsed = parseLLMResponse(result.output);

			if (!parsed) {
				// Parse failure - return a safe default advisory
				return {
					roleId: "supervisor-main",
					priority: SUPERVISOR_MAIN_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: "Failed to parse LLM response",
					evidenceRefs: [`events.jsonl:${input.event.ts}`],
					meta: {
						nextAction: "no action",
						blockedItems: [],
						risk: "low",
						requiresHuman: false,
					},
				};
			}

			const meta: SupervisorMainMeta = {
				nextAction: parsed.next_action,
				blockedItems: parsed.blocked_items || [],
				risk: parsed.risk || "low",
				requiresHuman: parsed.requires_human || false,
			};

			return {
				roleId: "supervisor-main",
				priority: parsed.priority || SUPERVISOR_MAIN_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: `Supervisor recommends: ${meta.nextAction}`,
				evidenceRefs: [`events.jsonl:${input.event.ts}`],
				meta,
			};
		},
	};
}

export const SUPERVISOR_MAIN_ROLE_ID: RoleId = "supervisor-main";
