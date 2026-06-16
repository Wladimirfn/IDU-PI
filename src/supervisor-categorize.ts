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

import {
	appendFileSync,
	mkdirSync,
} from "node:fs";
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
	reason?: "role_not_enabled" | "cooldown_active" | "consult_failed" | "no_findings";
};

const COUNT_RE =
	/(?:(\d+)\s*critical|(\d+)\s*medium|(\d+)\s*low)/giu;

export function parseCategorizedCounts(input: string): CategorizedCounts {
	let critical = 0;
	let medium = 0;
	let low = 0;
	const re = new RegExp(COUNT_RE.source, COUNT_RE.flags);
	let m: RegExpExecArray | null;
	while ((m = re.exec(input)) !== null) {
		if (m[1] !== undefined) critical = Number(m[1]);
		else if (m[2] !== undefined) medium = Number(m[2]);
		else if (m[3] !== undefined) low = Number(m[3]);
	}
	return { critical, medium, low };
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
		.map((f) => `[${f.match.role}] ${f.match.file}: ${f.response.slice(0, 300)}`)
		.join("\n");
	const question = `Categorize these ${input.findings.length} AgentLab findings. Return ONLY a single line in the format "N critical, M medium, K low" — no extra text. Do not invent findings; count what's listed.`;
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
