/**
 * agentlab-code-quality role — T3.5.
 *
 * Monitors code quality issues: complexity thresholds, lint regressions, dead code.
 * Produces quality advisories with refactor hints and complexity concerns.
 *
 * REQ-LRV2-18: Priority 30, Cooldown 10 minutes, subscribes to
 * complexity_threshold, lint_regression, dead_code.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_CODE_QUALITY_PRIORITY = 30;
const AGENTLAB_CODE_QUALITY_COOLDOWN_MS = 600_000; // 10 minutes
const AGENTLAB_CODE_QUALITY_SUBSCRIBES: readonly EventKind[] = [
	"complexity_threshold",
	"lint_regression",
	"dead_code",
];

const MAX_ISSUES = 6;

type CodeQualityIssue = {
	type: string;
	path: string;
	description: string;
	refactorHint: string;
};

type CodeQualityMeta = {
	issues: CodeQualityIssue[];
	summary: string;
};

type LLMResponse = {
	issues?: Array<{
		type?: string;
		path?: string;
		description?: string;
		refactorHint?: string;
		refactor_hint?: string;
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

function buildAgentLabCodeQualityPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the code quality analyst for the IDU orchestrator.",
		"Your role is to review code quality issues and provide refactor hints.",
		"",
	];

	const event = input.event;

	if (event.kind === "complexity_threshold") {
		const path = event.payload.path as string;
		const cyclomatic = event.payload.cyclomatic as number;
		lines.push("Complexity threshold exceeded:");
		lines.push(`  Path: ${path}`);
		lines.push(`  Cyclomatic complexity: ${cyclomatic}`);
		lines.push("");
		lines.push("Analyze the complexity issue:");
		lines.push("  - Which branches/conditions contribute to complexity?");
		lines.push("  - Can the logic be simplified?");
		lines.push("  - Should the function be split into smaller units?");
	} else if (event.kind === "lint_regression") {
		const path = event.payload.path as string;
		const newErrors = event.payload.newErrors as number;
		lines.push("Lint regression detected:");
		lines.push(`  Path: ${path}`);
		lines.push(`  New errors: ${newErrors}`);
		lines.push("");
		lines.push("Analyze the lint issues:");
		lines.push("  - What lint rules were violated?");
		lines.push("  - Are these style issues or potential bugs?");
		lines.push("  - How should they be fixed?");
	} else if (event.kind === "dead_code") {
		const path = event.payload.path as string;
		const functionName = event.payload.functionName as string;
		lines.push("Dead code detected:");
		lines.push(`  Path: ${path}`);
		lines.push(`  Function: ${functionName || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the dead code:");
		lines.push("  - Is this function truly unused?");
		lines.push("  - Should it be removed or marked as deprecated?");
		lines.push("  - Are there any callers that might use it indirectly?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "issues": [');
	lines.push("    {");
	lines.push('      "type": "<complexity|lint|dead-code>",');
	lines.push('      "path": "<file path>",');
	lines.push('      "description": "<detailed description>",');
	lines.push('      "refactorHint": "<actionable refactor suggestion>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap issues at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabCodeQualityRole(): Role {
	return {
		name: "AgentLab de calidad de código",
		priority: AGENTLAB_CODE_QUALITY_PRIORITY,
		cooldownMs: AGENTLAB_CODE_QUALITY_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_CODE_QUALITY_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_CODE_QUALITY_COOLDOWN_MS) {
					return false;
				}
			}

			// For all three event kinds, fire after cooldown check
			if (
				input.event.kind === "complexity_threshold" ||
				input.event.kind === "lint_regression" ||
				input.event.kind === "dead_code"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabCodeQualityPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-code-quality",
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

			// Build evidence refs
			const evidenceRefs: string[] = [`events.jsonl:${input.event.ts}`];
			if (input.event.kind === "complexity_threshold") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "lint_regression") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "dead_code") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			}

			if (!parsed) {
				// Malformed response — fallback to empty issues
				const meta: CodeQualityMeta = {
					issues: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-code-quality",
					priority: AGENTLAB_CODE_QUALITY_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize issues
			const rawIssues = parsed.issues || [];
			const issues: CodeQualityIssue[] = capArray(rawIssues, MAX_ISSUES)
				.filter(
					(i) =>
						i &&
						typeof i === "object" &&
						typeof i.type === "string" &&
						typeof i.path === "string" &&
						typeof i.description === "string",
				)
				.map((i) => ({
					type: i.type || "unknown",
					path: i.path || "unknown",
					description: i.description || "",
					refactorHint: i.refactorHint || i.refactor_hint || "",
				}));

			const summary = parsed.summary || "Code quality review completed";

			const meta: CodeQualityMeta = {
				issues,
				summary,
			};

			const issueCount = issues.length;

			let advisoryText = summary;
			if (issueCount > 0) {
				advisoryText = `${issueCount} code quality issue${issueCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No code quality issues: ${summary}`;
			}

			return {
				roleId: "agentlab-code-quality",
				priority: AGENTLAB_CODE_QUALITY_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
