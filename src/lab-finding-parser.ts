import {
	validateAgentLabReport,
	type AgentLabFinding,
	type AgentLabProposal,
} from "./agentlab-contract.js";
import type {
	BugFindingInput,
	FindingConfidence,
	FindingSeverity,
	ProposalType,
} from "./lab-db.js";

const SEVERITIES = new Set<FindingSeverity>([
	"critical",
	"high",
	"medium",
	"low",
	"info",
]);
const CONFIDENCES = new Set<FindingConfidence>(["high", "medium", "low"]);
const PROPOSAL_TYPES = new Set<ProposalType>([
	"fix",
	"test",
	"investigation",
	"docs",
	"memory",
]);

export type LabFindingParserContext = {
	projectId: string;
	agentId: string;
	labRunId: string;
};

export type ParsedLabProposal = {
	proposalType?: ProposalType;
	summary: string;
	details?: string;
	priority?: number;
};

export type ParsedLabFinding = BugFindingInput & {
	proposal?: ParsedLabProposal;
};

type JsonRecord = Record<string, unknown>;

export function parseLabFindingsFromOutput(
	output: string,
	context: LabFindingParserContext,
): ParsedLabFinding[] {
	const jsonResult = parseJsonFindings(output, context);
	if (jsonResult.foundJson || looksLikeJsonFinding(output)) {
		return jsonResult.findings;
	}
	return parseTextFindings(output, context);
}

function parseJsonFindings(
	output: string,
	context: LabFindingParserContext,
): { foundJson: boolean; findings: ParsedLabFinding[] } {
	for (const candidate of jsonCandidates(output)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			const findings = findingsFromJson(parsed, context);
			return { foundJson: true, findings };
		} catch {
			// Ignore invalid JSON blocks; parser must be tolerant.
		}
	}
	return { foundJson: false, findings: [] };
}

function looksLikeJsonFinding(output: string): boolean {
	return /[[{]/u.test(output) && /"findings?"\s*:/iu.test(output);
}

function* jsonCandidates(output: string): Iterable<string> {
	const fenced = output.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu);
	for (const match of fenced) {
		if (match[1]) yield match[1].trim();
	}

	const starts = [...output.matchAll(/[[{]/gu)].map(
		(match) => match.index ?? 0,
	);
	for (const start of starts) {
		for (let end = output.length; end > start; end--) {
			const candidate = output.slice(start, end).trim();
			if (candidate.endsWith("}") || candidate.endsWith("]")) {
				yield candidate;
				break;
			}
		}
	}
}

function findingsFromJson(
	parsed: unknown,
	context: LabFindingParserContext,
): ParsedLabFinding[] {
	if (looksLikeAgentLabReport(parsed)) {
		const result = validateAgentLabReport(parsed);
		return result.ok
			? result.report.findings.map((finding) =>
					findingFromAgentLabReport(finding, context),
				)
			: [];
	}

	const root = asRecord(parsed);
	const findingsValue = Array.isArray(parsed)
		? parsed
		: Array.isArray(root?.findings)
			? root.findings
			: [];
	const rootProposals = Array.isArray(root?.proposals) ? root.proposals : [];

	return findingsValue
		.map((finding, index) =>
			normalizeFinding(
				asRecord(finding),
				context,
				asRecord(rootProposals[index]),
			),
		)
		.filter((finding): finding is ParsedLabFinding => Boolean(finding));
}

function looksLikeAgentLabReport(value: unknown): boolean {
	const root = asRecord(value);
	return Boolean(
		root &&
			"findings" in root &&
			("role" in root ||
				"summary" in root ||
				looksLikeAgentLabFindings(root.findings)),
	);
}

function looksLikeAgentLabFindings(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.some((item) => {
			const finding = asRecord(item);
			return Boolean(finding && "category" in finding);
		})
	);
}

function findingFromAgentLabReport(
	finding: AgentLabFinding,
	context: LabFindingParserContext,
): ParsedLabFinding {
	const affectedFiles = finding.affectedFiles ?? [];
	return {
		id: `${context.labRunId}-${slug(finding.title)}`,
		projectId: context.projectId,
		title: finding.title,
		description: finding.description,
		severity: finding.severity,
		confidence: finding.confidence,
		evidence: finding.evidence,
		affectedFiles,
		dedupeKey: dedupeKey(context, finding.title, affectedFiles),
		...(finding.proposal
			? { proposal: proposalFromAgentLab(finding.proposal) }
			: {}),
	};
}

function proposalFromAgentLab(proposal: AgentLabProposal): ParsedLabProposal {
	return {
		summary: proposal.summary,
		details: proposal.steps.join("\n"),
	};
}

function normalizeFinding(
	finding: JsonRecord | undefined,
	context: LabFindingParserContext,
	rootProposal?: JsonRecord,
): ParsedLabFinding | undefined {
	if (!finding) return undefined;
	const title = stringValue(finding.title);
	const description = stringValue(finding.description);
	const evidence = stringValue(finding.evidence);
	if (!title || !description || !evidence) return undefined;

	const affectedFiles = stringArrayValue(
		finding.affectedFiles ?? finding.affected_files,
	);
	const normalized: ParsedLabFinding = {
		id: `${context.labRunId}-${slug(title)}`,
		projectId: context.projectId,
		title,
		description,
		severity: severityValue(finding.severity),
		confidence: confidenceValue(finding.confidence),
		evidence,
		suspectedCause: stringValue(
			finding.suspectedCause ?? finding.suspected_cause,
		),
		affectedFiles,
		dedupeKey: dedupeKey(context, title, affectedFiles),
	};

	const proposal = normalizeProposal(
		asRecord(finding.proposal) ?? rootProposal,
	);
	if (proposal) normalized.proposal = proposal;
	return normalized;
}

function normalizeProposal(
	proposal: JsonRecord | undefined,
): ParsedLabProposal | undefined {
	if (!proposal) return undefined;
	const summary = stringValue(proposal.summary);
	if (!summary) return undefined;
	return {
		proposalType: proposalTypeValue(
			proposal.proposalType ?? proposal.proposal_type,
		),
		summary,
		details: stringValue(proposal.details),
		priority: numberValue(proposal.priority),
	};
}

function parseTextFindings(
	output: string,
	context: LabFindingParserContext,
): ParsedLabFinding[] {
	if (hasNoFindingLanguage(output)) return [];
	const lines = output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	const evidenceLine = lines.find((line) =>
		/(\berror\b|\bfail(?:ed|ure)?\b|exit(?:ed)? with code|exception|stack trace)/iu.test(
			line,
		),
	);
	if (!evidenceLine) return [];

	const titleLine = lines.find((line) =>
		/(hallazgo|finding|error|failed|failure|exception)/iu.test(line),
	);
	const title = cleanTextTitle(titleLine ?? evidenceLine);
	const description = lines.slice(0, 6).join(" ");
	if (!title || !description) return [];

	const affectedFiles = extractFilePaths(output);
	return [
		{
			id: `${context.labRunId}-${slug(title)}`,
			projectId: context.projectId,
			title,
			description,
			severity: severityFromText(output),
			confidence: "low",
			evidence: evidenceLine,
			affectedFiles,
			dedupeKey: dedupeKey(context, title, affectedFiles),
		},
	];
}

function asRecord(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(item): item is string =>
				typeof item === "string" && item.trim().length > 0,
		)
		.map((item) => item.trim());
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: undefined;
}

function severityValue(value: unknown): FindingSeverity {
	return typeof value === "string" && SEVERITIES.has(value as FindingSeverity)
		? (value as FindingSeverity)
		: "info";
}

function confidenceValue(value: unknown): FindingConfidence {
	return typeof value === "string" &&
		CONFIDENCES.has(value as FindingConfidence)
		? (value as FindingConfidence)
		: "low";
}

function proposalTypeValue(value: unknown): ProposalType | undefined {
	return typeof value === "string" && PROPOSAL_TYPES.has(value as ProposalType)
		? (value as ProposalType)
		: undefined;
}

function hasNoFindingLanguage(output: string): boolean {
	return /\b(no|sin)\s+(failure|failures|error|errors|hallazgos?|findings?|problemas?|issues?)\b/iu.test(
		output,
	);
}

function severityFromText(output: string): FindingSeverity {
	if (/\bcritical\b/iu.test(output)) return "critical";
	if (/\bmedium\b/iu.test(output)) return "medium";
	if (/\blow\b/iu.test(output)) return "low";
	return "info";
}

function extractFilePaths(output: string): string[] {
	const matches =
		output.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|sql)/giu) ?? [];
	return [...new Set(matches.map((match) => match.replace(/\\/gu, "/")))];
}

function dedupeKey(
	context: LabFindingParserContext,
	title: string,
	affectedFiles: string[],
): string {
	return [context.projectId, context.agentId, slug(title), ...affectedFiles]
		.filter(Boolean)
		.join(":");
}

function slug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function cleanTextTitle(value: string): string {
	return value
		.replace(/^[-*\s]*(hallazgo|finding)\s*:?\s*/iu, "")
		.slice(0, 120);
}
