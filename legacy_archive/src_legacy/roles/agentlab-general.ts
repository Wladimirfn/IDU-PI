/**
 * agentlab-general role — T3.8.
 *
 * General-purpose fallback role that monitors common events:
 * orchestrator_turn, file_changed, lab_write.
 * Produces general drift advisories for anything other roles didn't catch.
 *
 * REQ-LRV2-21: Priority 20, Cooldown 10 minutes, subscribes to
 * every event (fallback). For practical purposes: orchestrator_turn, file_changed, lab_write.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_GENERAL_PRIORITY = 20;
const AGENTLAB_GENERAL_COOLDOWN_MS = 600_000; // 10 minutes
const AGENTLAB_GENERAL_SUBSCRIBES: readonly EventKind[] = [
	"orchestrator_turn",
	"file_changed",
	"lab_write",
	"module_added",
	"breaking_change",
	"dependency_bumped",
];

const MAX_FINDINGS = 4;

type GeneralFinding = {
	type: string;
	description: string;
	severity: string;
};

type GeneralMeta = {
	findings: GeneralFinding[];
	summary: string;
};

type LLMResponse = {
	findings?: Array<{
		type?: string;
		description?: string;
		severity?: string;
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

function buildAgentLabGeneralPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the general analyst for the IDU orchestrator.",
		"Your role is to review recent events and identify general drift, patterns, or issues that other specialized roles did not catch.",
		"",
	];

	const event = input.event;

	lines.push(`Recent event: ${event.kind}`);
	lines.push(`Timestamp: ${event.ts}`);

	if (event.kind === "orchestrator_turn") {
		const request = event.payload.request as string;
		lines.push(`Request: ${request || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the orchestrator turn:");
		lines.push("  - Is the request well-formed?");
		lines.push("  - Are there any unusual patterns?");
		lines.push("  - Is there anything that might need attention?");
	} else if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		lines.push(`Path: ${path}`);
		lines.push("");
		lines.push("Analyze the file change:");
		lines.push("  - Is the change expected?");
		lines.push("  - Are there any side effects?");
		lines.push("  - Does it affect other modules?");
	} else if (event.kind === "lab_write") {
		const topic = event.payload.topic as string;
		lines.push(`Topic: ${topic || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the lab write:");
		lines.push("  - Is the topic well-documented?");
		lines.push("  - Are there any gaps?");
	} else if (event.kind === "module_added") {
		const moduleName = event.payload.moduleName as string;
		lines.push(`Module: ${moduleName || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the new module:");
		lines.push("  - Is it properly integrated?");
		lines.push("  - Are there any dependencies missing?");
	} else if (event.kind === "breaking_change") {
		const description = event.payload.description as string;
		lines.push(`Description: ${description || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the breaking change:");
		lines.push("  - Is it justified?");
		lines.push("  - Are all affected parties notified?");
	} else if (event.kind === "dependency_bumped") {
		const dep = event.payload.dependency as string;
		const version = event.payload.version as string;
		lines.push(`Dependency: ${dep || "(unknown)"}`);
		lines.push(`Version: ${version || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the dependency bump:");
		lines.push("  - Is it a major version change?");
		lines.push("  - Are there breaking changes in the dependency?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "findings": [');
	lines.push("    {");
	lines.push('      "type": "<general-drift|pattern|anomaly|other>",');
	lines.push('      "description": "<detailed description>",');
	lines.push('      "severity": "<low|medium|high>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap findings at 4 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabGeneralRole(): Role {
	return {
		name: "AgentLab general",
		priority: AGENTLAB_GENERAL_PRIORITY,
		cooldownMs: AGENTLAB_GENERAL_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_GENERAL_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_GENERAL_COOLDOWN_MS) {
					return false;
				}
			}

			// For subscribed events, always fire (after cooldown check)
			const kind = input.event.kind;
			if (
				kind === "orchestrator_turn" ||
				kind === "file_changed" ||
				kind === "lab_write" ||
				kind === "module_added" ||
				kind === "breaking_change" ||
				kind === "dependency_bumped"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabGeneralPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-general",
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
			evidenceRefs.push(`event:${input.event.kind}`);

			if (!parsed) {
				// Malformed response — fallback to empty findings
				const meta: GeneralMeta = {
					findings: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-general",
					priority: AGENTLAB_GENERAL_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize findings
			const rawFindings = parsed.findings || [];
			const findings: GeneralFinding[] = capArray(rawFindings, MAX_FINDINGS)
				.filter(
					(f) =>
						f &&
						typeof f === "object" &&
						typeof f.type === "string" &&
						typeof f.description === "string",
				)
				.map((f) => ({
					type: f.type || "other",
					description: f.description || "",
					severity: f.severity || "low",
				}));

			const summary = parsed.summary || "General review completed";

			const meta: GeneralMeta = {
				findings,
				summary,
			};

			const findingCount = findings.length;

			let advisoryText = summary;
			if (findingCount > 0) {
				advisoryText = `${findingCount} general finding${findingCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No general issues: ${summary}`;
			}

			return {
				roleId: "agentlab-general",
				priority: AGENTLAB_GENERAL_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
