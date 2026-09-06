/**
 * `supervisor-semantic` role — T2.1.
 *
 * Classifies orchestrator turns into intent categories and suggests
 * routing to the next role. Uses prompt-helpers for prompt construction.
 *
 * REQ-LRV2-11: Priority 80, Cooldown 10s, subscribes to orchestrator_turn.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";
import { getOrchestratorAdvisoryStream } from "../orchestrator-advisory-stream.js";

const SUPERVISOR_SEMANTIC_PRIORITY = 80;
const SUPERVISOR_SEMANTIC_COOLDOWN_MS = 10_000;
const SUPERVISOR_SEMANTIC_SUBSCRIBES: readonly EventKind[] = [
	"orchestrator_turn",
];

const VALID_INTENTS = ["audit", "plan", "ask", "fix", "chat"] as const;
const VALID_ACTION_TYPES = ["review", "execute", "respond", "clarify"] as const;

type ValidIntent = (typeof VALID_INTENTS)[number];
type ValidActionType = (typeof VALID_ACTION_TYPES)[number];

type SemanticMeta = {
	intentClass: ValidIntent;
	routingHint: string;
	actionType: ValidActionType;
	errorMessage?: string;
};

type LLMResponse = {
	intent?: string;
	routing_hint?: string;
	action_type?: string;
};

function parseIntent(raw: string | undefined): {
	value: ValidIntent;
	error?: string;
} {
	if (!raw || !VALID_INTENTS.includes(raw as ValidIntent)) {
		return { value: "ask", error: `Invalid intent: ${raw || "undefined"}` };
	}
	return { value: raw as ValidIntent };
}

function parseActionType(raw: string | undefined): {
	value: ValidActionType;
	error?: string;
} {
	if (!raw || !VALID_ACTION_TYPES.includes(raw as ValidActionType)) {
		return {
			value: "clarify",
			error: `Invalid action_type: ${raw || "undefined"}`,
		};
	}
	return { value: raw as ValidActionType };
}

function parseLLMResponse(raw: string): {
	parsed: LLMResponse | null;
	error?: string;
} {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return { parsed: parsed as LLMResponse };
		}
		return { parsed: null, error: "Response is not an object" };
	} catch (e) {
		return { parsed: null, error: `JSON parse error: ${e}` };
	}
}

function buildSupervisorSemanticPrompt(
	input: RoleInput,
	ctx: RoleContext,
): string {
	// Get recent advisories from the stream
	const stream = getOrchestratorAdvisoryStream(ctx.stateRoot);
	const recentAdvisories = stream.getAdvisories({ limit: 5 });

	// Extract user turns from the event payload
	const userTurns =
		(input.event.payload.userTurns as Array<{ ts: string; text: string }>) ||
		[];
	const lastFiveTurns = userTurns.slice(-5);

	const lines: string[] = [
		"You are the semantic supervisor for the IDU orchestrator.",
		"Your role is to classify the user's intent and suggest routing.",
		"",
		"Recent orchestrator advisories:",
	];

	if (recentAdvisories.length === 0) {
		lines.push("  (none)");
	} else {
		for (const adv of recentAdvisories) {
			lines.push(`  - [${adv.ts}] ${adv.roleId}: ${adv.advisory}`);
		}
	}

	lines.push("");
	lines.push("User's last 5 turns:");

	if (lastFiveTurns.length === 0) {
		lines.push("  (none)");
	} else {
		for (const turn of lastFiveTurns) {
			lines.push(`  - [${turn.ts}] ${turn.text}`);
		}
	}

	lines.push("");
	lines.push("Current request:");
	lines.push(
		`  ${JSON.stringify(input.event.payload.request || input.event.payload)}`,
	);
	lines.push("");
	lines.push("Classify the intent and respond with a JSON object:");
	lines.push("{");
	lines.push('  "intent": "audit" | "plan" | "ask" | "fix" | "chat",');
	lines.push(
		'  "routing_hint": "<short string suggesting which role should handle this>",',
	);
	lines.push('  "action_type": "review" | "execute" | "respond" | "clarify"');
	lines.push("}");
	lines.push("");
	lines.push("Respond with a single JSON object.");

	return lines.join("\n");
}

export function createSupervisorSemanticRole(): Role {
	return {
		name: "Supervisor semántico",
		priority: SUPERVISOR_SEMANTIC_PRIORITY,
		cooldownMs: SUPERVISOR_SEMANTIC_COOLDOWN_MS,
		subscribesTo: () => SUPERVISOR_SEMANTIC_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			_now: Date,
		): boolean {
			// Fire only on first sight. The engine handles cooldowns
			// and input-signature idempotency at its level; the role's
			// shouldFire is a gate that returns true when lastFireAt is
			// undefined (never fired) so the engine can invoke the role
			// for each distinct orchestrator_turn payload.
			void input;
			return !lastFireAt;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildSupervisorSemanticPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"supervisor-semantic",
				prompt,
				{
					projectId: ctx.projectId,
					stateRoot: ctx.stateRoot,
					invocationSink: (record) => {
						ctx.repository.appendInvocation(record);
					},
				},
			);

			const { parsed, error: parseError } = parseLLMResponse(result.output);

			if (!parsed) {
				// Malformed response — fallback to safe defaults
				const meta: SemanticMeta = {
					intentClass: "ask",
					routingHint: "supervisor-main",
					actionType: "clarify",
					errorMessage: parseError || "Unknown parse error",
				};

				return {
					roleId: "supervisor-semantic",
					priority: SUPERVISOR_SEMANTIC_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: "Failed to parse LLM response, defaulting to ask/clarify",
					evidenceRefs: [`events.jsonl:${input.event.ts}`],
					meta,
				};
			}

			const intentResult = parseIntent(parsed.intent);
			const actionTypeResult = parseActionType(parsed.action_type);
			const routingHint = parsed.routing_hint || "supervisor-main";

			const meta: SemanticMeta = {
				intentClass: intentResult.value,
				routingHint,
				actionType: actionTypeResult.value,
			};

			// Surface validation errors in meta
			if (intentResult.error || actionTypeResult.error) {
				meta.errorMessage = [intentResult.error, actionTypeResult.error]
					.filter(Boolean)
					.join("; ");
			}

			return {
				roleId: "supervisor-semantic",
				priority: SUPERVISOR_SEMANTIC_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: `Intent: ${meta.intentClass}, routing to ${meta.routingHint}`,
				evidenceRefs: [`events.jsonl:${input.event.ts}`],
				meta,
			};
		},
	};
}
