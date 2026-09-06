/**
 * agentlab-performance role — T3.4.
 *
 * Monitors performance regressions: hot path file changes and bundle size growth.
 * Produces performance advisories with p50/p95 estimates and regression details.
 *
 * REQ-LRV2-17: Priority 50, Cooldown 5 minutes, subscribes to
 * file_changed (hot path), bundle_size_grew.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_PERFORMANCE_PRIORITY = 50;
const AGENTLAB_PERFORMANCE_COOLDOWN_MS = 300_000; // 5 minutes
const AGENTLAB_PERFORMANCE_SUBSCRIBES: readonly EventKind[] = [
	"file_changed",
	"bundle_size_grew",
];

const MAX_REGRESSIONS = 4;

type PerformanceRegression = {
	path: string;
	p50Estimate: number;
	p95Estimate: number;
	evidence: string;
};

type PerformanceMeta = {
	regressions: PerformanceRegression[];
	summary: string;
};

type LLMResponse = {
	regressions?: Array<{
		path?: string;
		p50Estimate?: number;
		p95Estimate?: number;
		evidence?: string;
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

function parsePositiveInt(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	if (value <= 0) {
		return null;
	}
	return Math.floor(value);
}

function capArray<T>(items: T[] | undefined, max: number): T[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
}

function buildAgentLabPerformancePrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the performance analyst for the IDU orchestrator.",
		"Your role is to review hot path changes and bundle size growth to identify performance regressions.",
		"",
	];

	const event = input.event;

	if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		lines.push("Hot path file changed:");
		lines.push(`  Path: ${path}`);
		lines.push("");
		lines.push("Analyze the change for performance issues:");
		lines.push("  - Synchronous operations in async paths");
		lines.push("  - Missing caching opportunities");
		lines.push("  - Inefficient algorithms or data structures");
		lines.push("  - Increased latency (p50/p95 estimates in milliseconds)");
	} else if (event.kind === "bundle_size_grew") {
		const bundlePath = event.payload.bundlePath as string;
		const oldSize = event.payload.oldSize as number;
		const newSize = event.payload.newSize as number;
		lines.push("Bundle size increased:");
		lines.push(`  Bundle: ${bundlePath}`);
		lines.push(`  Old size: ${oldSize} bytes`);
		lines.push(`  New size: ${newSize} bytes`);
		lines.push(
			`  Growth: ${newSize - oldSize} bytes (${(((newSize - oldSize) / oldSize) * 100).toFixed(2)}%)`,
		);
		lines.push("");
		lines.push("Analyze the bundle growth for performance impact:");
		lines.push("  - New dependencies added");
		lines.push("  - Code duplication");
		lines.push("  - Tree-shaking opportunities missed");
		lines.push("  - Impact on load time (p50/p95 estimates in milliseconds)");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "regressions": [');
	lines.push("    {");
	lines.push('      "path": "<file or bundle path>",');
	lines.push('      "p50Estimate": <median latency in ms (positive integer)>,');
	lines.push(
		'      "p95Estimate": <95th percentile latency in ms (positive integer)>,',
	);
	lines.push('      "evidence": "<explanation of the regression>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push(
		"Cap regressions at 4 items. p50Estimate and p95Estimate must be positive integers. Respond with a single JSON object.",
	);

	return lines.join("\n");
}

export function createAgentLabPerformanceRole(): Role {
	return {
		name: "AgentLab de rendimiento",
		priority: AGENTLAB_PERFORMANCE_PRIORITY,
		cooldownMs: AGENTLAB_PERFORMANCE_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_PERFORMANCE_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_PERFORMANCE_COOLDOWN_MS) {
					return false;
				}
			}

			// For file_changed events, check if isHotPath === true
			if (input.event.kind === "file_changed") {
				const isHotPath = input.event.payload.isHotPath as boolean;
				return isHotPath === true;
			}

			// For bundle_size_grew events, always fire (after cooldown check)
			if (input.event.kind === "bundle_size_grew") {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabPerformancePrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-performance",
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
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "bundle_size_grew") {
				const bundlePath = input.event.payload.bundlePath as string;
				evidenceRefs.push(`bundle:${bundlePath}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty regressions
				const meta: PerformanceMeta = {
					regressions: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-performance",
					priority: AGENTLAB_PERFORMANCE_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize regressions
			const rawRegressions = parsed.regressions || [];
			const regressions: PerformanceRegression[] = capArray(
				rawRegressions,
				MAX_REGRESSIONS,
			)
				.filter(
					(r) =>
						r &&
						typeof r === "object" &&
						typeof r.path === "string" &&
						parsePositiveInt(r.p50Estimate) !== null &&
						parsePositiveInt(r.p95Estimate) !== null,
				)
				.map((r) => ({
					path: r.path || "unknown",
					p50Estimate: parsePositiveInt(r.p50Estimate) || 0,
					p95Estimate: parsePositiveInt(r.p95Estimate) || 0,
					evidence: r.evidence || "",
				}));

			const summary = parsed.summary || "Performance review completed";

			const meta: PerformanceMeta = {
				regressions,
				summary,
			};

			const regressionCount = regressions.length;

			let advisoryText = summary;
			if (regressionCount > 0) {
				advisoryText = `${regressionCount} performance regression${regressionCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No performance regressions: ${summary}`;
			}

			return {
				roleId: "agentlab-performance",
				priority: AGENTLAB_PERFORMANCE_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
