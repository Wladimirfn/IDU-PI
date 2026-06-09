/**
 * agentlab-librarian role — T3.9.
 *
 * Monitors source library: new sources added, source digest drift.
 * Produces source freshness advisories, missing digests, broken source links.
 *
 * REQ-LRV2-22: Priority 25, Cooldown 10 minutes, subscribes to
 * source_added, source_digest_drift.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_LIBRARIAN_PRIORITY = 25;
const AGENTLAB_LIBRARIAN_COOLDOWN_MS = 600_000; // 10 minutes
const AGENTLAB_LIBRARIAN_SUBSCRIBES: readonly EventKind[] = [
	"source_added",
	"source_digest_drift",
];

const MAX_FINDINGS = 6;

type LibrarianFinding = {
	type: string;
	description: string;
	severity: string;
};

type LibrarianMeta = {
	findings: LibrarianFinding[];
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

function buildAgentLabLibrarianPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the librarian analyst for the IDU orchestrator.",
		"Your role is to review source additions and digest drift to ensure source freshness, proper digests, and valid links.",
		"",
	];

	const event = input.event;

	if (event.kind === "source_added") {
		const sourceId = event.payload.sourceId as string;
		const url = event.payload.url as string;

		lines.push("New source added:");
		lines.push(`  Source ID: ${sourceId || "(unknown)"}`);
		lines.push(`  URL: ${url || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the new source:");
		lines.push("  - Is the source URL accessible?");
		lines.push("  - Is the source properly cataloged?");
		lines.push("  - Does it have a digest for verification?");
		lines.push("  - Are there any duplicate sources?");
	} else if (event.kind === "source_digest_drift") {
		const sourceId = event.payload.sourceId as string;
		const expectedDigest = event.payload.expectedDigest as string;
		const actualDigest = event.payload.actualDigest as string;

		lines.push("Source digest drift detected:");
		lines.push(`  Source ID: ${sourceId || "(unknown)"}`);
		lines.push(`  Expected digest: ${expectedDigest || "(unknown)"}`);
		lines.push(`  Actual digest: ${actualDigest || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the digest drift:");
		lines.push("  - Has the source content changed?");
		lines.push("  - Is the change intentional or accidental?");
		lines.push("  - Should the digest be updated?");
		lines.push("  - Are there any broken links in the source?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "findings": [');
	lines.push("    {");
	lines.push(
		'      "type": "<source-freshness|missing-digest|broken-source-link|duplicate-source|other>",',
	);
	lines.push('      "description": "<detailed description>",');
	lines.push('      "severity": "<low|medium|high>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap findings at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabLibrarianRole(): Role {
	return {
		name: "AgentLab bibliotecario",
		priority: AGENTLAB_LIBRARIAN_PRIORITY,
		cooldownMs: AGENTLAB_LIBRARIAN_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_LIBRARIAN_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_LIBRARIAN_COOLDOWN_MS) {
					return false;
				}
			}

			// For subscribed events, always fire (after cooldown check)
			if (
				input.event.kind === "source_added" ||
				input.event.kind === "source_digest_drift"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabLibrarianPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-librarian",
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
			if (input.event.kind === "source_added") {
				const sourceId = input.event.payload.sourceId as string;
				if (sourceId) evidenceRefs.push(`source:${sourceId}`);
				const url = input.event.payload.url as string;
				if (url) evidenceRefs.push(`url:${url}`);
			} else if (input.event.kind === "source_digest_drift") {
				const sourceId = input.event.payload.sourceId as string;
				if (sourceId) evidenceRefs.push(`source:${sourceId}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty findings
				const meta: LibrarianMeta = {
					findings: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-librarian",
					priority: AGENTLAB_LIBRARIAN_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize findings
			const rawFindings = parsed.findings || [];
			const findings: LibrarianFinding[] = capArray(rawFindings, MAX_FINDINGS)
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

			const summary = parsed.summary || "Librarian review completed";

			const meta: LibrarianMeta = {
				findings,
				summary,
			};

			const findingCount = findings.length;

			let advisoryText = summary;
			if (findingCount > 0) {
				advisoryText = `${findingCount} librarian finding${findingCount > 1 ? "s" : ""}: ${summary}`;
			} else {
				advisoryText = `No librarian issues: ${summary}`;
			}

			return {
				roleId: "agentlab-librarian",
				priority: AGENTLAB_LIBRARIAN_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
