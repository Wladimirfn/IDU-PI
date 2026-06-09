/**
 * agentlab-architecture role — T3.1.
 *
 * Monitors architectural changes: large file changes, new modules, breaking changes.
 * Produces architecture drift advisories with contract violations and layering issues.
 *
 * REQ-LRV2-14: Priority 60, Cooldown 5 minutes, subscribes to
 * file_changed (> N lines), module_added, breaking_change.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

export const ARCH_ADDED_LINES_THRESHOLD = 200;

const AGENTLAB_ARCHITECTURE_PRIORITY = 60;
const AGENTLAB_ARCHITECTURE_COOLDOWN_MS = 300_000; // 5 minutes
const AGENTLAB_ARCHITECTURE_SUBSCRIBES: readonly EventKind[] = [
	"file_changed",
	"module_added",
	"breaking_change",
];

const MAX_DRIFTS = 6;

type ArchitectureDrift = {
	kind: string;
	contract: string;
	description: string;
	evidence: string;
};

type ArchitectureMeta = {
	drifts: ArchitectureDrift[];
	summary: string;
};

type LLMResponse = {
	drifts?: Array<{
		kind?: string;
		contract?: string;
		description?: string;
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

function capArray<T>(items: T[] | undefined, max: number): T[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
}

function buildAgentLabArchitecturePrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the architecture analyst for the IDU orchestrator.",
		"Your role is to review architectural changes and identify drift, contract violations, and layering issues.",
		"",
	];

	const event = input.event;

	if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		const addedLines = event.payload.addedLines as number;
		lines.push("Large file change detected:");
		lines.push(`  Path: ${path}`);
		lines.push(`  Lines added: ${addedLines}`);
		lines.push("");
		lines.push("Analyze the change for architectural issues:");
		lines.push("  - Module boundary violations");
		lines.push("  - Contract changes (API signatures, type exports)");
		lines.push("  - Layering violations (roles importing from engine, etc.)");
		lines.push("  - Circular dependencies");
	} else if (event.kind === "module_added") {
		const moduleName = event.payload.moduleName as string;
		lines.push("New module added:");
		lines.push(`  Module: ${moduleName}`);
		lines.push("");
		lines.push("Analyze the new module for architectural fit:");
		lines.push("  - Does it respect existing boundaries?");
		lines.push("  - Does it introduce new contracts?");
		lines.push("  - Does it fit the layered architecture?");
	} else if (event.kind === "breaking_change") {
		const description = event.payload.description as string;
		lines.push("Breaking change detected:");
		lines.push(`  Description: ${description}`);
		lines.push("");
		lines.push("Analyze the breaking change:");
		lines.push("  - Which contracts are affected?");
		lines.push("  - What downstream modules need updates?");
		lines.push("  - Is the breaking change justified?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "drifts": [');
	lines.push("    {");
	lines.push('      "kind": "<layering|contract-violation|boundary|circular|other>",');
	lines.push('      "contract": "<affected contract or module path>",');
	lines.push('      "description": "<detailed description>",');
	lines.push('      "evidence": "<file:line or reference>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap drifts at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabArchitectureRole(): Role {
	return {
		name: "AgentLab de arquitectura",
		priority: AGENTLAB_ARCHITECTURE_PRIORITY,
		cooldownMs: AGENTLAB_ARCHITECTURE_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_ARCHITECTURE_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_ARCHITECTURE_COOLDOWN_MS) {
					return false;
				}
			}

			// For file_changed events, check if addedLines > threshold
			if (input.event.kind === "file_changed") {
				const addedLines = input.event.payload.addedLines as number;
				return addedLines > ARCH_ADDED_LINES_THRESHOLD;
			}

			// For module_added and breaking_change, always fire (after cooldown check)
			if (
				input.event.kind === "module_added" ||
				input.event.kind === "breaking_change"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabArchitecturePrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-architecture",
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
			} else if (input.event.kind === "module_added") {
				const moduleName = input.event.payload.moduleName as string;
				evidenceRefs.push(`module:${moduleName}`);
			} else if (input.event.kind === "breaking_change") {
				evidenceRefs.push("breaking-change");
			}

			if (!parsed) {
				// Malformed response — fallback to empty drifts
				const meta: ArchitectureMeta = {
					drifts: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-architecture",
					priority: AGENTLAB_ARCHITECTURE_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize drifts
			const rawDrifts = parsed.drifts || [];
			const drifts: ArchitectureDrift[] = capArray(rawDrifts, MAX_DRIFTS)
				.filter(
					(d) =>
						d &&
						typeof d === "object" &&
						typeof d.kind === "string" &&
						typeof d.contract === "string",
				)
				.map((d) => ({
					kind: d.kind || "other",
					contract: d.contract || "unknown",
					description: d.description || "",
					evidence: d.evidence || "",
				}));

			const summary = parsed.summary || "Architecture review completed";

			const meta: ArchitectureMeta = {
				drifts,
				summary,
			};

			const driftCount = drifts.length;

			let advisoryText = summary;
			if (driftCount > 0) {
				advisoryText = `${driftCount} architecture drift${driftCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No architecture drift: ${summary}`;
			}

			return {
				roleId: "agentlab-architecture",
				priority: AGENTLAB_ARCHITECTURE_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
