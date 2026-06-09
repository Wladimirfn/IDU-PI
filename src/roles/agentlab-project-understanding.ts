/**
 * agentlab-project-understanding role — T3.7.
 *
 * Monitors project understanding: project map changes, blueprint edits.
 * Produces project-shape drift advisories, missing docs, blueprint inconsistencies.
 *
 * REQ-LRV2-20: Priority 35, Cooldown 10 minutes, subscribes to
 * project_map_changed, blueprint_edited.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_PROJECT_UNDERSTANDING_PRIORITY = 35;
const AGENTLAB_PROJECT_UNDERSTANDING_COOLDOWN_MS = 600_000; // 10 minutes
const AGENTLAB_PROJECT_UNDERSTANDING_SUBSCRIBES: readonly EventKind[] = [
	"project_map_changed",
	"blueprint_edited",
];

const MAX_FINDINGS = 4;

type ProjectFinding = {
	type: string;
	description: string;
	severity: string;
};

type ProjectUnderstandingMeta = {
	findings: ProjectFinding[];
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

function buildAgentLabProjectUnderstandingPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the project understanding analyst for the IDU orchestrator.",
		"Your role is to review project map changes and blueprint edits to identify drift, missing documentation, and inconsistencies.",
		"",
	];

	const event = input.event;

	if (event.kind === "project_map_changed") {
		const delta = event.payload.delta as Record<string, unknown>;
		const added = (delta?.added as string[]) || [];
		const removed = (delta?.removed as string[]) || [];
		const modified = (delta?.modified as string[]) || [];

		lines.push("Project map changed:");
		if (added.length > 0) lines.push(`  Added: ${added.join(", ")}`);
		if (removed.length > 0) lines.push(`  Removed: ${removed.join(", ")}`);
		if (modified.length > 0) lines.push(`  Modified: ${modified.join(", ")}`);
		lines.push("");
		lines.push("Analyze the project map changes:");
		lines.push("  - Are new modules documented?");
		lines.push("  - Do removed modules break references?");
		lines.push("  - Does the project shape drift from the blueprint?");
	} else if (event.kind === "blueprint_edited") {
		const blueprintId = event.payload.blueprintId as string;
		const changes = event.payload.changes as string[];

		lines.push("Blueprint edited:");
		lines.push(`  Blueprint: ${blueprintId || "(unknown)"}`);
		if (Array.isArray(changes) && changes.length > 0) {
			lines.push(`  Changes: ${changes.join(", ")}`);
		}
		lines.push("");
		lines.push("Analyze the blueprint edit:");
		lines.push("  - Are the changes consistent with the project map?");
		lines.push(
			"  - Do any modules referenced in the blueprint no longer exist?",
		);
		lines.push("  - Are there missing documentation links?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "findings": [');
	lines.push("    {");
	lines.push(
		'      "type": "<project-shape-drift|missing-doc|blueprint-inconsistency|other>",',
	);
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

export function createAgentLabProjectUnderstandingRole(): Role {
	return {
		name: "AgentLab de comprensión del proyecto",
		priority: AGENTLAB_PROJECT_UNDERSTANDING_PRIORITY,
		cooldownMs: AGENTLAB_PROJECT_UNDERSTANDING_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_PROJECT_UNDERSTANDING_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_PROJECT_UNDERSTANDING_COOLDOWN_MS) {
					return false;
				}
			}

			// For subscribed events, always fire (after cooldown check)
			if (
				input.event.kind === "project_map_changed" ||
				input.event.kind === "blueprint_edited"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabProjectUnderstandingPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-project-understanding",
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
			if (input.event.kind === "project_map_changed") {
				evidenceRefs.push("project-map");
			} else if (input.event.kind === "blueprint_edited") {
				const blueprintId = input.event.payload.blueprintId as string;
				if (blueprintId) evidenceRefs.push(`blueprint:${blueprintId}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty findings
				const meta: ProjectUnderstandingMeta = {
					findings: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-project-understanding",
					priority: AGENTLAB_PROJECT_UNDERSTANDING_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize findings
			const rawFindings = parsed.findings || [];
			const findings: ProjectFinding[] = capArray(rawFindings, MAX_FINDINGS)
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

			const summary =
				parsed.summary || "Project understanding review completed";

			const meta: ProjectUnderstandingMeta = {
				findings,
				summary,
			};

			const findingCount = findings.length;

			let advisoryText = summary;
			if (findingCount > 0) {
				advisoryText = `${findingCount} project understanding finding${findingCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No project understanding issues: ${summary}`;
			}

			return {
				roleId: "agentlab-project-understanding",
				priority: AGENTLAB_PROJECT_UNDERSTANDING_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
