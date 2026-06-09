/**
 * `supervisor-compaction` role — T2.2.
 *
 * Monitors context budget growth and orchestrator turns with high budget usage.
 * Produces a compaction plan with items to keep, drop, and summarize.
 *
 * REQ-LRV2-12: Priority 70, Cooldown 60s, subscribes to context_budget_grew,
 * orchestrator_turn (when budget > 80%).
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";
import { getOrchestratorAdvisoryStream } from "../orchestrator-advisory-stream.js";

const SUPERVISOR_COMPACTION_PRIORITY = 70;
const SUPERVISOR_COMPACTION_COOLDOWN_MS = 60_000;
const SUPERVISOR_COMPACTION_SUBSCRIBES: readonly EventKind[] = [
	"context_budget_grew",
	"orchestrator_turn",
];

const COMPACTION_THRESHOLD_RATIO = 0.8;
const MAX_COMPACTION_ITEMS = 12;

type CompactionMeta = {
	keepItems: string[];
	dropItems: string[];
	summarizeItems: string[];
	tokenEstimate: number;
};

type LLMResponse = {
	keep?: string[];
	drop?: string[];
	summarize?: string[];
	tokenEstimate?: number;
};

function capArray(items: string[] | undefined, max: number): string[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
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

function buildSupervisorCompactionPrompt(
	input: RoleInput,
	ctx: RoleContext,
): string {
	// Get recent advisories from the stream
	const stream = getOrchestratorAdvisoryStream(ctx.stateRoot);
	const recentAdvisories = stream.getAdvisories({ limit: 5 });

	// Extract orchestrator turns from the event payload
	const orchestratorTurns =
		(input.event.payload.orchestratorTurns as Array<{
			ts: string;
			text: string;
		}>) || [];
	const lastTwentyTurns = orchestratorTurns.slice(-20);

	// Get current budget ratio
	const budgetRatio = input.event.payload.budgetRatio as number | undefined;

	const lines: string[] = [
		"You are the compaction supervisor for the IDU orchestrator.",
		"Your role is to analyze the context budget and produce a compaction plan.",
		"",
		"Current context budget usage:",
	];

	if (budgetRatio !== undefined) {
		const budgetPct = Math.round(budgetRatio * 100);
		lines.push(`  ${budgetPct}% of context budget used`);
	} else {
		lines.push("  (budget ratio not available)");
	}

	lines.push("");
	lines.push("Recent orchestrator advisories:");

	if (recentAdvisories.length === 0) {
		lines.push("  (none)");
	} else {
		for (const adv of recentAdvisories) {
			lines.push(`  - [${adv.ts}] ${adv.roleId}: ${adv.advisory}`);
		}
	}

	lines.push("");
	lines.push("Last 20 orchestrator turns:");

	if (lastTwentyTurns.length === 0) {
		lines.push("  (none)");
	} else {
		for (const turn of lastTwentyTurns) {
			lines.push(`  - [${turn.ts}] ${turn.text}`);
		}
	}

	lines.push("");
	lines.push("Produce a compaction plan by categorizing context items into:");
	lines.push("  - keep: items that must be preserved (critical context)");
	lines.push("  - drop: items that can be safely removed (obsolete, redundant)");
	lines.push(
		"  - summarize: items that can be condensed (verbose logs, detailed histories)",
	);
	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "keep": ["<item 1>", "<item 2>"],');
	lines.push('  "drop": ["<item 3>", "<item 4>"],');
	lines.push('  "summarize": ["<item 5>", "<item 6>"],');
	lines.push('  "tokenEstimate": <estimated tokens saved, integer>');
	lines.push("}");
	lines.push("");
	lines.push("Cap each list at 12 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createSupervisorCompactionRole(): Role {
	return {
		name: "Supervisor de compactación",
		priority: SUPERVISOR_COMPACTION_PRIORITY,
		cooldownMs: SUPERVISOR_COMPACTION_COOLDOWN_MS,
		subscribesTo: () => SUPERVISOR_COMPACTION_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			_now: Date,
		): boolean {
			// Fire on context_budget_grew events
			if (input.event.kind === "context_budget_grew") {
				return !lastFireAt;
			}

			// Fire on orchestrator_turn events only when budgetRatio > 0.8
			if (input.event.kind === "orchestrator_turn") {
				const budgetRatio = input.event.payload.budgetRatio as
					| number
					| undefined;
				if (budgetRatio !== undefined && budgetRatio > COMPACTION_THRESHOLD_RATIO) {
					return !lastFireAt;
				}
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildSupervisorCompactionPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"supervisor-compaction",
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
				// Malformed response — fallback to empty compaction plan
				const meta: CompactionMeta = {
					keepItems: [],
					dropItems: [],
					summarizeItems: [],
					tokenEstimate: 0,
				};

				return {
					roleId: "supervisor-compaction",
					priority: SUPERVISOR_COMPACTION_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs: [`events.jsonl:${input.event.ts}`],
					meta,
				};
			}

			// Parse and cap the lists
			const keepItems = capArray(parsed.keep, MAX_COMPACTION_ITEMS);
			const dropItems = capArray(parsed.drop, MAX_COMPACTION_ITEMS);
			const summarizeItems = capArray(parsed.summarize, MAX_COMPACTION_ITEMS);
			const tokenEstimate =
				typeof parsed.tokenEstimate === "number" ? parsed.tokenEstimate : 0;

			const meta: CompactionMeta = {
				keepItems,
				dropItems,
				summarizeItems,
				tokenEstimate,
			};

			const totalItems = keepItems.length + dropItems.length + summarizeItems.length;

			return {
				roleId: "supervisor-compaction",
				priority: SUPERVISOR_COMPACTION_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: `Compaction plan: ${totalItems} items, ~${tokenEstimate} tokens saved`,
				evidenceRefs: [
					`events.jsonl:${input.event.ts}`,
					`context-budget:orchestrator_advisory`,
				],
				meta,
			};
		},
	};
}
