/**
 * agentlab-docs role — T3.6.
 *
 * Monitors documentation gaps: public APIs without docs and broken links.
 * Produces documentation advisories with doc gaps and broken link details.
 *
 * REQ-LRV2-19: Priority 30, Cooldown 10 minutes, subscribes to
 * public_api_added (without docs), broken_link.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_DOCS_PRIORITY = 30;
const AGENTLAB_DOCS_COOLDOWN_MS = 600_000; // 10 minutes
const AGENTLAB_DOCS_SUBSCRIBES: readonly EventKind[] = [
	"public_api_added",
	"broken_link",
];

const MAX_DOC_GAPS = 6;
const MAX_BROKEN_LINKS = 6;

type DocGap = {
	path: string;
	exportName: string;
	recommendedDoc: string;
};

type BrokenLink = {
	url: string;
	referencedFrom: string;
	suggestion: string;
};

type DocsMeta = {
	gaps: DocGap[];
	brokenLinks: BrokenLink[];
	summary: string;
};

type LLMResponse = {
	docGaps?: Array<{
		path?: string;
		exportName?: string;
		recommendedDoc?: string;
		recommended_doc?: string;
	}>;
	brokenLinks?: Array<{
		url?: string;
		referencedFrom?: string;
		referenced_from?: string;
		suggestion?: string;
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

function buildAgentLabDocsPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the documentation analyst for the IDU orchestrator.",
		"Your role is to review documentation gaps and broken links.",
		"",
	];

	const event = input.event;

	if (event.kind === "public_api_added") {
		const path = event.payload.path as string;
		const exportName = event.payload.exportName as string;
		lines.push("Public API added without documentation:");
		lines.push(`  Path: ${path}`);
		lines.push(`  Export: ${exportName || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the undocumented API:");
		lines.push("  - What does this API do?");
		lines.push("  - What parameters does it accept?");
		lines.push("  - What does it return?");
		lines.push("  - Are there any usage examples?");
		lines.push("  - Recommend JSDoc or Markdown documentation");
	} else if (event.kind === "broken_link") {
		const url = event.payload.url as string;
		const referencedFrom = event.payload.referencedFrom as string;
		lines.push("Broken link detected:");
		lines.push(`  URL: ${url}`);
		lines.push(`  Referenced from: ${referencedFrom || "(unknown)"}`);
		lines.push("");
		lines.push("Analyze the broken link:");
		lines.push("  - Is the target page moved or deleted?");
		lines.push("  - Is there an alternative URL?");
		lines.push("  - Should the reference be removed?");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "docGaps": [');
	lines.push("    {");
	lines.push('      "path": "<file path>",');
	lines.push('      "exportName": "<export name>",');
	lines.push('      "recommendedDoc": "<recommended documentation>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "brokenLinks": [');
	lines.push("    {");
	lines.push('      "url": "<broken URL>",');
	lines.push('      "referencedFrom": "<file that references it>",');
	lines.push('      "suggestion": "<fix suggestion>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap docGaps at 6 items. Cap brokenLinks at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabDocsRole(): Role {
	return {
		name: "AgentLab de documentación",
		priority: AGENTLAB_DOCS_PRIORITY,
		cooldownMs: AGENTLAB_DOCS_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_DOCS_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_DOCS_COOLDOWN_MS) {
					return false;
				}
			}

			// For public_api_added events, check if docsPresent === false
			if (input.event.kind === "public_api_added") {
				const docsPresent = input.event.payload.docsPresent as boolean;
				return docsPresent === false;
			}

			// For broken_link events, always fire (after cooldown check)
			if (input.event.kind === "broken_link") {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabDocsPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-docs",
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
			if (input.event.kind === "public_api_added") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "broken_link") {
				const url = input.event.payload.url as string;
				evidenceRefs.push(`link:${url}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty arrays
				const meta: DocsMeta = {
					gaps: [],
					brokenLinks: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-docs",
					priority: AGENTLAB_DOCS_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize doc gaps
			const rawDocGaps = parsed.docGaps || [];
			const gaps: DocGap[] = capArray(rawDocGaps, MAX_DOC_GAPS)
				.filter(
					(g) =>
						g &&
						typeof g === "object" &&
						typeof g.path === "string",
				)
				.map((g) => ({
					path: g.path || "unknown",
					exportName: g.exportName || "",
					recommendedDoc: g.recommendedDoc || g.recommended_doc || "",
				}));

			// Parse and normalize broken links
			const rawBrokenLinks = parsed.brokenLinks || [];
			const brokenLinks: BrokenLink[] = capArray(rawBrokenLinks, MAX_BROKEN_LINKS)
				.filter(
					(l) =>
						l &&
						typeof l === "object" &&
						typeof l.url === "string",
				)
				.map((l) => ({
					url: l.url || "",
					referencedFrom: l.referencedFrom || l.referenced_from || "",
					suggestion: l.suggestion || "",
				}));

			const summary = parsed.summary || "Documentation review completed";

			const meta: DocsMeta = {
				gaps,
				brokenLinks,
				summary,
			};

			const gapCount = gaps.length;
			const brokenCount = brokenLinks.length;

			let advisoryText = summary;
			if (gapCount > 0 || brokenCount > 0) {
				const parts: string[] = [];
				if (gapCount > 0) parts.push(`${gapCount} doc gap${gapCount > 1 ? "s" : ""}`);
				if (brokenCount > 0) parts.push(`${brokenCount} broken link${brokenCount > 1 ? "s" : ""}`);
				advisoryText = `${parts.join(" and ")}: ${summary}`;
			} else {
				advisoryText = `No documentation issues: ${summary}`;
			}

			return {
				roleId: "agentlab-docs",
				priority: AGENTLAB_DOCS_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
