import type { AgentLabFinding } from "./agentlab-contract.js";
import type { ParsedLabFinding } from "./lab-finding-parser.js";
import { loadProjectBlueprint } from "./project-blueprint.js";
import { loadProjectFlows } from "./project-flows.js";
import {
	validateFindingAgainstRules,
	type RuleValidationResult,
} from "./rule-validator.js";

export type LabFindingRuleValidator = (
	finding: ParsedLabFinding,
) => RuleValidationResult;

export type LabRuleValidationDecision = {
	finding: ParsedLabFinding;
	proposalAllowed: boolean;
	warnings: string[];
	failures: string[];
};

export function createLabFindingRuleValidator(
	projectPath: string,
	stateRoot: string,
): LabFindingRuleValidator {
	const blueprint = loadProjectBlueprint(stateRoot);
	// Slice 4/5: flows reads from stateRoot (same as blueprint).
	const flows = loadProjectFlows(stateRoot);
	return (finding) =>
		validateFindingAgainstRules(
			parsedFindingToAgentLabFinding(finding),
			blueprint,
			flows,
		);
}

export function validateParsedLabFindingForPersistence(
	finding: ParsedLabFinding,
	validator: LabFindingRuleValidator | undefined,
): LabRuleValidationDecision {
	if (!validator) {
		return {
			finding,
			proposalAllowed: true,
			warnings: [],
			failures: [],
		};
	}
	const result = validator(finding);
	const criticalFailures = result.failures.filter(
		(failure) => failure.severity === "critical" || failure.severity === "high",
	);
	return {
		finding,
		proposalAllowed: criticalFailures.length === 0,
		warnings: result.warnings.map((warning) => warning.message),
		failures: result.failures.map((failure) => failure.message),
	};
}

function parsedFindingToAgentLabFinding(
	finding: ParsedLabFinding,
): AgentLabFinding {
	const proposal = finding.proposal
		? {
				summary: finding.proposal.summary,
				steps: finding.proposal.details
					? finding.proposal.details
							.split(/\r?\n/u)
							.map((step) => step.trim())
							.filter(Boolean)
					: [finding.proposal.summary],
				risk: finding.proposal.risk ?? "Unknown.",
				requiresHumanApproval: finding.proposal.requiresHumanApproval ?? false,
			}
		: undefined;
	const affectedFiles = finding.affectedFiles ?? [];
	return {
		title: finding.title,
		description: finding.description,
		evidence: finding.evidence ?? "No parser evidence available.",
		severity: finding.severity,
		confidence: finding.confidence,
		category: "general",
		...(proposal ? { proposal } : {}),
		...(affectedFiles.length > 0 ? { affectedFiles } : {}),
	};
}
