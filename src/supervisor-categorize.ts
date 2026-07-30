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
 *   3. appendInjection (central)  →  injection + auto-emitted
 *   4. idu_pending_injections    →  orchestrator sees the report
 *
 * The supervisor's response is parsed for counts via regex
 * (e.g. "4 critical, 2 medium, 1 low"). If the response is
 * malformed, the function returns zeros (defensive).
 */

import { consultSupervisor, type ConsultResult } from "./supervisor-consult.js";
import { appendInjection, type Injection } from "./injection-store.js";
import type { SensorMatch } from "./sensors.js";
import type { PromptForRoleResult } from "./agent-router.js";
import type { IduModelRoleId } from "./model-assignments.js";
import type { AgentLabFinding } from "./agentlab-supervisor-contract.js";

export type CategorizedCounts = {
	critical: number;
	medium: number;
	low: number;
};

export type FindingSummary = {
	match: SensorMatch;
	ok: boolean;
	/**
	 * Structured, pillar-routed findings from the sensor's validated
	 * AgentLabReviewReport (flattened across the 6 buckets). Replaces the
	 * former `response: string` which carried raw truncated prose — the
	 * validated findings sat unused in the report. Empty when the sensor's
	 * review was invalid (no garbled prose reaches the categorizer).
	 */
	findings: readonly AgentLabFinding[];
};

/**
 * Discard record surfaced from the sensor impulse layer (structurally identical
 * to SensorDiscard in sensor-impulses.ts). Declared locally so this module does
 * not depend on the sensor layer — TypeScript structural typing lets callers
 * pass a SensorDiscard[] without conversion.
 */
export type SupervisorAdvisoryDiscard = {
	file: string;
	role: IduModelRoleId;
	reason: "depth_cap" | "safety_ceiling";
};

export type SupervisorAdvisory = {
	ts: string;
	kind: "supervisor_advisory";
	summary: string;
	counts: CategorizedCounts;
	advisoryId: string;
	/**
	 * Number of sensor discards surfaced in this advisory (0 when none).
	 * Optional for backward compatibility with direct callers that build a
	 * SupervisorAdvisory literal; categorizeFindings always populates it.
	 */
	discardsCount?: number;
	/**
	 * Compact deterministic discard breakdown (e.g.
	 * "38 discarded (depth_cap: agentlab-code-quality=38)"). Empty string when
	 * there are no discards. Carried separately from summary so a later
	 * reformatter cannot drop the coverage gap, and so the injection envelope
	 * can report it structurally.
	 */
	discardsSummary?: string;
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

/**
 * Deterministic, compact discard breakdown grouped by reason + role.
 * Example: "38 discarded (depth_cap: agentlab-code-quality=38)".
 * Multi-reason/multi-role:
 *   "3 discarded (depth_cap: agentlab-security=2; safety_ceiling: agentlab-code-quality=1)".
 * Returns "" when there are no discards.
 *
 * Pure (no LLM): discards are a COVERAGE GAP, not findings to categorize, so
 * they are never mixed into the categorizer prompt — only appended to the
 * summary here, in code. Reasons and roles are sorted for stable output.
 */
export function formatDiscardsSummary(
	discards: readonly SupervisorAdvisoryDiscard[],
): string {
	if (discards.length === 0) return "";
	const byReason = new Map<string, Map<string, number>>();
	for (const d of discards) {
		let byRole = byReason.get(d.reason);
		if (!byRole) {
			byRole = new Map<string, number>();
			byReason.set(d.reason, byRole);
		}
		byRole.set(d.role, (byRole.get(d.role) ?? 0) + 1);
	}
	const parts: string[] = [];
	for (const reason of [...byReason.keys()].sort()) {
		const roleCounts = [...(byReason.get(reason) ?? []).entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
			.map(([role, count]) => `${role}=${count}`);
		parts.push(`${reason}: ${roleCounts.join(", ")}`);
	}
	return `${discards.length} discarded (${parts.join("; ")})`;
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
	/**
	 * Optional sensor discards (depth_cap / safety_ceiling). When present AND
	 * non-empty, they are surfaced deterministically in the advisory summary
	 * (in CODE, never in the LLM prompt) so a coverage gap can never be
	 * silently dropped — even when the categorizer fails or returns zero
	 * findings. Omit to keep the exact prior behavior.
	 */
	discards?: readonly SupervisorAdvisoryDiscard[];
}): Promise<CategorizeResult | null> {
	const discards = input.discards ?? [];
	const discardCount = discards.length;
	const discardText = formatDiscardsSummary(discards);

	// Flatten every sensor's structured findings into one stream. The count
	// that matters for "is there anything to categorize" is the FINDING count,
	// not the SENSOR count — a sensor whose review was invalid contributes an
	// empty findings array and must not trigger a spurious LLM call.
	const allFindings = input.findings.flatMap((f) => f.findings);

	// Nothing to say: no findings to categorize and no discards to surface.
	if (allFindings.length === 0 && discardCount === 0) return null;

	const now = input.now ?? new Date();

	// Findings empty but discards present: surface them in code WITHOUT an LLM
	// call (there is nothing to categorize). The owner's lesson across this
	// whole arc: invisibility is the bug; never rely on the model to mention
	// discards.
	if (allFindings.length === 0) {
		const advisory = buildDiscardAdvisory(now, discardCount, discardText);
		writeSupervisorAdvisory(input.stateRoot, advisory);
		return { ok: true, counts: advisory.counts, advisory };
	}

	// Per-finding structured line (severity + title + category). This is the
	// validated, pillar-routed signal — more compact than 300 chars of raw
	// prose per sensor, and never truncated (E1 fix).
	const summary = input.findings
		.flatMap((f) =>
			f.findings.map(
				(finding) =>
					`[${f.match.role}] ${f.match.file}: [${finding.severity}] ${finding.title} (${finding.category})`,
			),
		)
		.join("\n");
	const question = `Categorize these ${allFindings.length} AgentLab findings.

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
		// role_not_enabled, cooldown_active, or model error.
		if (discardCount === 0) {
			// Preserve prior behavior: no advisory when the categorizer is off
			// and there is nothing extra to surface.
			return {
				ok: false,
				counts: { critical: 0, medium: 0, low: 0 },
				reason: consult.reason ?? "consult_failed",
			};
		}
		// Categorizer failed BUT discards must still be surfaced in code.
		const advisory = buildDiscardAdvisory(now, discardCount, discardText);
		writeSupervisorAdvisory(input.stateRoot, advisory);
		return {
			ok: false,
			counts: advisory.counts,
			advisory,
			reason: consult.reason ?? "consult_failed",
		};
	}

	const counts = parseCategorizedCounts(consult.response);
	if (!counts) {
		// The LLM responded but its response is unparseable.
		if (discardCount === 0) {
			// Don't write a misleading 0/0/0 advisory; surface the failure to
			// the caller so it can decide (prior behavior).
			return {
				ok: false,
				counts: { critical: 0, medium: 0, low: 0 },
				reason: "parse_failed",
			};
		}
		// Unparseable, but discards still surface in code.
		const advisory = buildDiscardAdvisory(now, discardCount, discardText);
		writeSupervisorAdvisory(input.stateRoot, advisory);
		return { ok: false, counts: advisory.counts, advisory, reason: "parse_failed" };
	}

	const advisory: SupervisorAdvisory = {
		ts: now.toISOString(),
		kind: "supervisor_advisory",
		summary: discardText
			? `${formatCategorizedCounts(counts)}; ${discardText}`
			: formatCategorizedCounts(counts),
		counts,
		advisoryId: `sa-${now.getTime()}`,
		discardsCount: discardCount,
		discardsSummary: discardText,
	};
	writeSupervisorAdvisory(input.stateRoot, advisory);

	return { ok: true, counts, advisory };
}

/**
 * Build a zero-counts advisory whose only real payload is the discard summary.
 * Used when the categorizer could not produce counts (empty findings, consult
 * failure, or parse failure) but discards still need to be surfaced in code.
 */
function buildDiscardAdvisory(
	now: Date,
	discardCount: number,
	discardText: string,
): SupervisorAdvisory {
	const zeroCounts: CategorizedCounts = { critical: 0, medium: 0, low: 0 };
	return {
		ts: now.toISOString(),
		kind: "supervisor_advisory",
		summary: `${formatCategorizedCounts(zeroCounts)}; ${discardText}`,
		counts: zeroCounts,
		advisoryId: `sa-${now.getTime()}`,
		discardsCount: discardCount,
		discardsSummary: discardText,
	};
}

export function writeSupervisorAdvisory(
	stateRoot: string,
	advisory: SupervisorAdvisory,
): void {
	// A.1: write through the central `appendInjection` so the
	// injection is paired with its `emitted` lifecycle event in one
	// atomic call. Previously this function wrote the JSONL line
	// directly + called `recordInjectionEmitted` manually (F-W2-1).
	// The structural coupling closes that leak class: a forgotten
	// manual emit is no longer possible.
	const discardCount = advisory.discardsCount ?? 0;
	// Wire discards through the injection envelope: the summary already
	// carries the discard text (categorizeFindings bakes it in), and we add a
	// dedicated evidence ref so the coverage gap is structurally visible even
	// if a future caller reformats the summary text.
	//
	// Severity is INTENTIONALLY left counts-driven. A discarded high-risk role
	// (security/database) does NOT escalate severity here — that is a
	// correctable call the owner can revisit; for now we only make the discard
	// visible, per the "invisibility is the bug" lesson.
	const evidenceRefs =
		discardCount > 0
			? ["sensor:agentlab_finding", "supervisor:advisory", "sensor:discards"]
			: ["sensor:agentlab_finding", "supervisor:advisory"];
	const envelope: Injection = {
		ts: advisory.ts,
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
			evidenceRefs,
			orchestratorDecisionRequired: true,
		},
		injectionId: advisory.advisoryId,
		kind: advisory.kind,
		acked: false,
	};
	appendInjection(stateRoot, envelope);
}
