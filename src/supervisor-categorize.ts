/**
 * supervisor-categorize.ts — supervisor wake-up to categorize
 * AgentLab findings (the second half of the impulse chain).
 *
 * After `runSensorImpulses` returns AgentLab findings, the
 * orchestrator calls `categorizeFindings` to invoke the
 * supervisor-main AI. The supervisor reads the findings and
 * returns a count of critical/medium/low issues. The result is
 * written to `injections.jsonl` as a `supervisor_advisory` so
 * the orchestrator can read it via `idu_pending_injections`.
 *
 * Flow:
 *
 *   1. runSensorImpulses (PR-102) →  findings[]
 *   2. categorizeFindings (here) →  supervisor categorizes
 *   3. writeSupervisorAdvisory  →  injection to disk
 *   4. idu_pending_injections   →  orchestrator sees the report
 *
 * The supervisor's response is parsed for counts via regex
 * (e.g. "4 critical, 2 medium, 1 low"). If the response is
 * malformed, the function returns zeros (defensive).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { consultSupervisor, type ConsultResult } from "./supervisor-consult.js";
import type { SensorMatch } from "./sensors.js";
import type { PromptForRoleResult } from "./agent-router.js";
import type { IduModelRoleId } from "./model-assignments.js";

export type CategorizedCounts = {
	critical: number;
	medium: number;
	low: number;
};

export type FindingSummary = {
	match: SensorMatch;
	ok: boolean;
	response: string;
};

export type SupervisorAdvisory = {
	ts: string;
	kind: "supervisor_advisory";
	summary: string;
	counts: CategorizedCounts;
	advisoryId: string;
};

export type CategorizeResult = {
	ok: boolean;
	counts: CategorizedCounts;
	advisory?: SupervisorAdvisory;
	reason?:
		| "role_not_enabled"
		| "cooldown_active"
		| "consult_failed"
		| "parse_failed"
		| "no_findings";
};

const COUNT_RE = /(?:(\d+)\s*critical|(\d+)\s*medium|(\d+)\s*low)/giu;

export function parseCategorizedCounts(
	input: string,
): CategorizedCounts | null {
	if (!input || typeof input !== "string") return null;

	// Strategy 1: try the canonical format directly.
	const counts = tryParseCounts(input);
	if (counts) {
		// If we matched at least one of the three severity levels, treat
		// the response as parseable (even if other levels are missing).
		if (counts.critical + counts.medium + counts.low > 0) return counts;
	}

	// Strategy 2: extract counts from markdown code blocks.
	const codeBlock = /```(?:json)?\s*([\s\S]*?)\s*```/giu.exec(input);
	if (codeBlock) {
		const counts = tryParseCounts(codeBlock[1] ?? "");
		if (counts) return counts;
		// Try JSON inside the code block.
		try {
			const parsed = JSON.parse(codeBlock[1] ?? "") as {
				critical?: unknown;
				medium?: unknown;
				low?: unknown;
			};
			if (
				typeof parsed.critical === "number" &&
				typeof parsed.medium === "number" &&
				typeof parsed.low === "number"
			) {
				return {
					critical: parsed.critical,
					medium: parsed.medium,
					low: parsed.low,
				};
			}
		} catch {
			// not JSON; fall through
		}
	}

	// Strategy 3: extract counts from tool-call JSON payloads.
	const toolCall =
		/"tool"\s*:\s*"[a-z_]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}/iu.exec(input);
	if (toolCall) {
		const counts = tryParseCounts(toolCall[0]);
		if (counts) return counts;
	}

	// Strategy 4: search the whole response for the regex as a last
	// resort. The LLM may have wrapped the counts in a long preamble
	// (e.g. "I see ... 1 critical, 2 medium, 0 low"). The original
	// regex catches those too, so this is just an explicit pass after
	// the structured strategies have failed.
	const countsLast = tryParseCounts(input);
	if (countsLast) return countsLast;

	// Unparseable: no "N critical", "N medium", or "N low" anywhere.
	return null;
}

function tryParseCounts(input: string): CategorizedCounts | null {
	const re = new RegExp(COUNT_RE.source, COUNT_RE.flags);
	let m: RegExpExecArray | null;
	let critical: number | null = null;
	let medium: number | null = null;
	let low: number | null = null;
	while ((m = re.exec(input)) !== null) {
		if (m[1] !== undefined) critical = Number(m[1]);
		else if (m[2] !== undefined) medium = Number(m[2]);
		else if (m[3] !== undefined) low = Number(m[3]);
	}
	if (critical === null && medium === null && low === null) return null;
	return {
		critical: critical ?? 0,
		medium: medium ?? 0,
		low: low ?? 0,
	};
}

export function formatCategorizedCounts(counts: CategorizedCounts): string {
	return `${counts.critical} critical, ${counts.medium} medium, ${counts.low} low`;
}

export async function categorizeFindings(input: {
	stateRoot: string;
	findings: readonly FindingSummary[];
	promptForRole: (
		role: IduModelRoleId,
		message: string,
		options: { projectId: string; stateRoot: string },
	) => Promise<PromptForRoleResult>;
	now?: Date;
}): Promise<CategorizeResult | null> {
	if (input.findings.length === 0) return null;

	const now = input.now ?? new Date();
	const summary = input.findings
		.map(
			(f) => `[${f.match.role}] ${f.match.file}: ${f.response.slice(0, 300)}`,
		)
		.join("\n");
	const question = `Categorize these ${input.findings.length} AgentLab findings.

CRITICAL: respond with ONLY one line in the format "N critical, M medium, K low" (where N, M, K are integers). Do NOT call any tools. Do NOT write any other text, preamble, explanation, or markdown. Do NOT wrap the answer in code blocks. Just the one line.`;
	const context = `Findings:\n${summary}`;

	const consult = await consultSupervisor({
		stateRoot: input.stateRoot,
		role: "supervisor-main",
		question,
		context,
		promptForRole: input.promptForRole,
		now,
	});

	if (!consult.ok) {
		// role_not_enabled, cooldown_active, or model error
		return {
			ok: false,
			counts: { critical: 0, medium: 0, low: 0 },
			reason: consult.reason ?? "consult_failed",
		};
	}

	const counts = parseCategorizedCounts(consult.response);
	if (!counts) {
		// The LLM responded but its response is unparseable. Don't
		// write a 0/0/0 advisory; that would be misleading noise.
		// Return a parse_failed result so the caller can decide to
		// skip the advisory and surface the failure to the user.
		return {
			ok: false,
			counts: { critical: 0, medium: 0, low: 0 },
			reason: "parse_failed",
		};
	}

	const advisory: SupervisorAdvisory = {
		ts: now.toISOString(),
		kind: "supervisor_advisory",
		summary: formatCategorizedCounts(counts),
		counts,
		advisoryId: `sa-${now.getTime()}`,
	};
	writeSupervisorAdvisory(input.stateRoot, advisory);

	return { ok: true, counts, advisory };
}

export function writeSupervisorAdvisory(
	stateRoot: string,
	advisory: SupervisorAdvisory,
): void {
	const path = join(stateRoot, "injections.jsonl");
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(
		path,
		`${JSON.stringify({
			...advisory,
			acked: false,
			injectionId: advisory.advisoryId,
			triggerId: "supervisor_categorize",
			decisionEnvelope: {
				severity:
					advisory.counts.critical > 0
						? "critical"
						: advisory.counts.medium > 0
							? "warning"
							: "info",
				summary: advisory.summary,
				options: ["review_critical", "review_medium", "acknowledge"],
				evidenceRefs: ["sensor:agentlab_finding", "supervisor:advisory"],
				orchestratorDecisionRequired: true,
			},
		})}\n`,
		"utf8",
	);
}
