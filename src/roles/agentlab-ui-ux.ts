/**
 * agentlab-ui-ux role — T3.3.
 *
 * Monitors UI changes: HTML, CSS, SCSS, JSX, TSX, Vue, Svelte files.
 * Produces accessibility, consistency, and design token advisories.
 *
 * REQ-LRV2-16: Priority 40, Cooldown 5 minutes, subscribes to
 * file_changed (UI paths), design_token_drift.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_UI_UX_PRIORITY = 40;
const AGENTLAB_UI_UX_COOLDOWN_MS = 300_000; // 5 minutes
const AGENTLAB_UI_UX_SUBSCRIBES: readonly EventKind[] = [
	"file_changed",
	"design_token_drift",
];

// UI-related file patterns (JSX/TSX components, styles, templates)
const UI_PATH_RE = /\.(jsx|tsx|css|scss|html|vue|svelte)$/i;

const MAX_ISSUES_PER_CATEGORY = 6;

type A11yIssue = {
	description: string;
	selector?: string;
	wcag?: string;
};

type ConsistencyIssue = {
	description: string;
	selector?: string;
};

type TokenViolation = {
	description: string;
	selector?: string;
	property?: string;
	value?: string;
	expected?: string;
};

type UiUxMeta = {
	a11y: A11yIssue[];
	consistency: ConsistencyIssue[];
	tokens: TokenViolation[];
	summary: string;
};

type LLMResponse = {
	a11y?: Array<{
		description?: string;
		selector?: string;
		wcag?: string;
	}>;
	consistency?: Array<{
		description?: string;
		selector?: string;
	}>;
	tokens?: Array<{
		description?: string;
		selector?: string;
		property?: string;
		value?: string;
		expected?: string;
	}>;
	summary?: string;
};

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

function capArray<T>(items: T[] | undefined, max: number): T[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
}

function buildAgentLabUiUxPrompt(input: RoleInput, _ctx: RoleContext): string {
	const lines: string[] = [
		"You are the UI/UX analyst for the IDU orchestrator.",
		"Your role is to review UI changes and identify accessibility, consistency, and design token issues.",
		"",
	];

	const event = input.event;

	if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		lines.push("UI-related file changed:");
		lines.push(`  Path: ${path}`);
		lines.push("");
		lines.push("Analyze the change for UI issues:");
		lines.push(
			"  - Accessibility (WCAG compliance, ARIA attributes, contrast)",
		);
		lines.push("  - Consistency (spacing, typography, component patterns)");
		lines.push("  - Design tokens (use of theme variables, color palette)");
	} else if (event.kind === "design_token_drift") {
		const token = event.payload.token as string;
		const oldValue = event.payload.oldValue as string;
		const newValue = event.payload.newValue as string;
		lines.push("Design token changed:");
		lines.push(`  Token: ${token}`);
		lines.push(`  Old value: ${oldValue}`);
		lines.push(`  New value: ${newValue}`);
		lines.push("");
		lines.push("Analyze the token change for issues:");
		lines.push("  - Which components use this token?");
		lines.push("  - Does the new value maintain contrast?");
		lines.push("  - Are there hardcoded values that should use the token?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "a11y": [');
	lines.push("    {");
	lines.push('      "description": "<accessibility issue>",');
	lines.push('      "selector": "<CSS selector (optional)>",');
	lines.push('      "wcag": "<WCAG criterion (optional)>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "consistency": [');
	lines.push("    {");
	lines.push('      "description": "<consistency issue>",');
	lines.push('      "selector": "<CSS selector (optional)>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "tokens": [');
	lines.push("    {");
	lines.push('      "description": "<token violation>",');
	lines.push('      "selector": "<CSS selector (optional)>",');
	lines.push('      "property": "<CSS property (optional)>",');
	lines.push('      "value": "<current value (optional)>",');
	lines.push('      "expected": "<expected token (optional)>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap each array at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabUiUxRole(): Role {
	return {
		name: "AgentLab de UI/UX",
		priority: AGENTLAB_UI_UX_PRIORITY,
		cooldownMs: AGENTLAB_UI_UX_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_UI_UX_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_UI_UX_COOLDOWN_MS) {
					return false;
				}
			}

			// For file_changed events, check if path matches UI patterns
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				return UI_PATH_RE.test(path);
			}

			// For design_token_drift, always fire (after cooldown check)
			if (input.event.kind === "design_token_drift") {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabUiUxPrompt(input, ctx);

			const result = await ctx.router.promptForRole("agentlab-ui-ux", prompt, {
				projectId: ctx.projectId,
				stateRoot: ctx.stateRoot,
				invocationSink: (record) => {
					ctx.repository.appendInvocation(record);
				},
			});

			const { parsed, error: parseError } = parseLLMResponse(result.output);

			// Build evidence refs
			const evidenceRefs: string[] = [`events.jsonl:${input.event.ts}`];
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "design_token_drift") {
				const token = input.event.payload.token as string;
				evidenceRefs.push(`design-token:${token}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty arrays
				const meta: UiUxMeta = {
					a11y: [],
					consistency: [],
					tokens: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-ui-ux",
					priority: AGENTLAB_UI_UX_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize a11y issues
			const rawA11y = parsed.a11y || [];
			const a11y: A11yIssue[] = capArray(rawA11y, MAX_ISSUES_PER_CATEGORY)
				.filter(
					(a) =>
						a && typeof a === "object" && typeof a.description === "string",
				)
				.map((a) => ({
					description: a.description || "",
					selector: a.selector,
					wcag: a.wcag,
				}));

			// Parse and normalize consistency issues
			const rawConsistency = parsed.consistency || [];
			const consistency: ConsistencyIssue[] = capArray(
				rawConsistency,
				MAX_ISSUES_PER_CATEGORY,
			)
				.filter(
					(c) =>
						c && typeof c === "object" && typeof c.description === "string",
				)
				.map((c) => ({
					description: c.description || "",
					selector: c.selector,
				}));

			// Parse and normalize token violations
			const rawTokens = parsed.tokens || [];
			const tokens: TokenViolation[] = capArray(
				rawTokens,
				MAX_ISSUES_PER_CATEGORY,
			)
				.filter(
					(t) =>
						t && typeof t === "object" && typeof t.description === "string",
				)
				.map((t) => ({
					description: t.description || "",
					selector: t.selector,
					property: t.property,
					value: t.value,
					expected: t.expected,
				}));

			const summary = parsed.summary || "UI/UX review completed";

			const meta: UiUxMeta = {
				a11y,
				consistency,
				tokens,
				summary,
			};

			const a11yCount = a11y.length;
			const consistencyCount = consistency.length;
			const tokensCount = tokens.length;
			const totalIssues = a11yCount + consistencyCount + tokensCount;

			let advisoryText = summary;
			if (totalIssues > 0) {
				const parts: string[] = [];
				if (a11yCount > 0) parts.push(`${a11yCount} a11y`);
				if (consistencyCount > 0) parts.push(`${consistencyCount} consistency`);
				if (tokensCount > 0) parts.push(`${tokensCount} token`);
				advisoryText = `${totalIssues} UI issues (${parts.join(", ")}): ${summary}`;
			} else {
				advisoryText = `No UI issues: ${summary}`;
			}

			return {
				roleId: "agentlab-ui-ux",
				priority: AGENTLAB_UI_UX_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
