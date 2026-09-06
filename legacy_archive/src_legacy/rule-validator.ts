import type { AgentLabFinding, AgentLabReport } from "./agentlab-contract.js";
import type { ProjectBlueprint } from "./project-blueprint.js";
import type { ProjectFlows } from "./project-flows.js";

export type RuleValidationSeverity = "critical" | "high" | "medium" | "low";

export type RuleValidationFailure = {
	ruleId: string;
	severity: RuleValidationSeverity;
	message: string;
	field?: string;
};

export type RuleValidationWarning = {
	ruleId: string;
	message: string;
	field?: string;
};

export type RuleValidationResult = {
	ok: boolean;
	failures: RuleValidationFailure[];
	warnings: RuleValidationWarning[];
};

type FindingWithRuleIds = AgentLabFinding & { ruleIds?: string[] };

export function validateAgentLabReportAgainstRules(
	report: AgentLabReport,
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): RuleValidationResult {
	const aggregate: RuleValidationResult = {
		ok: true,
		failures: [],
		warnings: [],
	};
	for (const finding of report.findings) {
		const result = validateFindingAgainstRules(finding, blueprint, flows);
		aggregate.failures.push(...result.failures);
		aggregate.warnings.push(...result.warnings);
	}
	aggregate.ok = aggregate.failures.length === 0;
	return aggregate;
}

export function validateFindingAgainstRules(
	finding: FindingWithRuleIds,
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): RuleValidationResult {
	const failures: RuleValidationFailure[] = [];
	const warnings: RuleValidationWarning[] = [];

	if (!nonEmpty(finding.title)) {
		failures.push({
			ruleId: "finding.title.required",
			severity: "high",
			field: "title",
			message: "Finding title is required.",
		});
	}
	if (!nonEmpty(finding.description)) {
		failures.push({
			ruleId: "finding.description.required",
			severity: "high",
			field: "description",
			message: "Finding description is required.",
		});
	}
	if (!nonEmpty(finding.evidence)) {
		failures.push({
			ruleId: "finding.evidence.required",
			severity: "high",
			field: "evidence",
			message: "Finding evidence is required.",
		});
	}

	if (
		isHighRisk(finding.severity) &&
		finding.proposal?.requiresHumanApproval !== true
	) {
		failures.push({
			ruleId: "proposal.humanApproval.required",
			severity: "critical",
			field: "proposal.requiresHumanApproval",
			message:
				"High/critical findings require proposal.requiresHumanApproval true.",
		});
	}

	const proposalText = proposalSearchText(finding);
	if (/\bcommit\b/iu.test(proposalText) && /\blab\b/iu.test(proposalText)) {
		failures.push({
			ruleId: "lab.commit.forbidden",
			severity: "critical",
			field: "proposal",
			message: "Proposal must not commit from lab context.",
		});
	}
	if (/\bpush\b/iu.test(proposalText) && /\blab\b/iu.test(proposalText)) {
		failures.push({
			ruleId: "lab.push.forbidden",
			severity: "critical",
			field: "proposal",
			message: "Proposal must not push from lab context.",
		});
	}
	if (
		/(modify|modificar|write|edit|cambiar).*\b(repo real|real repo)\b|\b(repo real|real repo)\b.*(modify|modificar|write|edit|cambiar)/iu.test(
			proposalText,
		) &&
		/\b(clone|clon)\b/iu.test(proposalText) &&
		finding.proposal?.requiresHumanApproval !== true
	) {
		failures.push({
			ruleId: "realRepo.humanApproval.required",
			severity: "critical",
			field: "proposal.requiresHumanApproval",
			message:
				"Modifying the real repo from clone context requires human approval.",
		});
	}

	for (const action of blueprint.forbiddenActions) {
		if (matchesRule(proposalText, action)) {
			failures.push({
				ruleId: `blueprint.forbiddenActions.${slug(action)}`,
				severity: "critical",
				field: "proposal",
				message: `Proposal violates blueprint forbidden action: ${action}`,
			});
		}
	}
	for (const invariant of flows.invariants) {
		if (matchesRule(proposalText, invariant)) {
			failures.push({
				ruleId: `flows.invariants.${slug(invariant)}`,
				severity: "critical",
				field: "proposal",
				message: `Proposal violates project flow invariant: ${invariant}`,
			});
		}
	}
	for (const transition of flows.forbiddenTransitions) {
		if (matchesRule(proposalText, transition)) {
			failures.push({
				ruleId: `flows.forbiddenTransitions.${slug(transition)}`,
				severity: "critical",
				field: "proposal",
				message: `Proposal violates forbidden project flow transition: ${transition}`,
			});
		}
	}

	validateFunctionalMapReferences(finding, flows, warnings);
	validateFunctionalMapChanges(finding, flows, failures, warnings);

	for (const ruleId of finding.ruleIds ?? []) {
		if (!knownRuleIds(blueprint, flows).has(ruleId)) {
			warnings.push({
				ruleId,
				field: "ruleIds",
				message: `Unknown ruleId referenced by finding: ${ruleId}`,
			});
		}
	}

	return { ok: failures.length === 0, failures, warnings };
}

function proposalSearchText(finding: AgentLabFinding): string {
	const proposal = finding.proposal;
	return [proposal?.summary, ...(proposal?.steps ?? []), proposal?.risk]
		.filter((part): part is string => typeof part === "string")
		.join("\n");
}

function findingSearchText(finding: AgentLabFinding): string {
	return [
		finding.title,
		finding.description,
		finding.evidence,
		proposalSearchText(finding),
	]
		.filter((part): part is string => typeof part === "string")
		.join("\n");
}

function validateFunctionalMapReferences(
	finding: AgentLabFinding,
	flows: ProjectFlows,
	warnings: RuleValidationWarning[],
): void {
	const text = findingSearchText(finding);
	const proposalText = proposalSearchText(finding);
	const knownModules = new Set(
		flows.modules.flatMap((module) => [
			normalize(module.id),
			normalize(module.name),
		]),
	);
	const knownScreens = new Set(
		flows.screens.flatMap((screen) => [
			normalize(screen.id),
			normalize(screen.path),
		]),
	);
	const knownDataStores = new Set(
		flows.dataStores.flatMap((store) => [
			normalize(store.id),
			...store.tables.map((table) => normalize(table)),
		]),
	);
	const knownUiElements = new Set(
		flows.uiElements.flatMap((element) => [
			normalize(element.id),
			...(element.selector ? [normalize(element.selector)] : []),
			...(element.label ? [normalize(element.label)] : []),
		]),
	);

	for (const mention of collectFunctionalMentions(text, "module")) {
		if (!knownModules.has(normalize(mention))) {
			pushUniqueWarning(warnings, {
				ruleId: "flows.module.unknown",
				field: "finding",
				message: `Finding references module not defined in project-flows: ${mention}`,
			});
		}
	}
	for (const mention of collectScreenMentions(text)) {
		if (!knownScreens.has(normalize(mention))) {
			pushUniqueWarning(warnings, {
				ruleId: "flows.screen.unknown",
				field: "finding",
				message: `Finding references screen not defined in project-flows: ${mention}`,
			});
		}
	}
	for (const mention of collectDataStoreMentions(proposalText)) {
		if (!knownDataStores.has(normalize(mention))) {
			pushUniqueWarning(warnings, {
				ruleId: "flows.dataStore.unknown",
				field: "proposal",
				message: `Proposal references dataStore not defined in project-flows: ${mention}`,
			});
		}
	}
	for (const mention of collectUiElementMentions(proposalText)) {
		if (!knownUiElements.has(normalize(mention))) {
			pushUniqueWarning(warnings, {
				ruleId: "flows.uiElement.unknown",
				field: "proposal",
				message: `Proposal references uiElement not defined in project-flows: ${mention}`,
			});
		}
	}
}

function validateFunctionalMapChanges(
	finding: AgentLabFinding,
	flows: ProjectFlows,
	failures: RuleValidationFailure[],
	warnings: RuleValidationWarning[],
): void {
	const proposalText = proposalSearchText(finding);
	const normalizedProposal = normalize(proposalText);
	const protectedChange = mentionsProtectedFunctionalMapPart(
		normalizedProposal,
		flows,
	);
	if (
		protectedChange &&
		isHighRisk(finding.severity) &&
		finding.proposal?.requiresHumanApproval !== true
	) {
		failures.push({
			ruleId: "flows.protectedChange.approvalRequired",
			severity: "critical",
			field: "proposal.requiresHumanApproval",
			message:
				"High/critical proposals that change flow, moduleConnection, or dataStore require human approval.",
		});
	}

	const contradiction = contradictsExistingFlow(normalizedProposal, flows);
	if (!contradiction) return;
	if (isHighRisk(finding.severity)) {
		failures.push({
			ruleId: "flows.flow.contradiction",
			severity: "high",
			field: "proposal",
			message: `Proposal contradicts existing project flow: ${contradiction}`,
		});
		return;
	}
	pushUniqueWarning(warnings, {
		ruleId: "flows.flow.contradiction",
		field: "proposal",
		message: `Proposal may contradict existing project flow: ${contradiction}`,
	});
}

function mentionsProtectedFunctionalMapPart(
	normalizedProposal: string,
	flows: ProjectFlows,
): boolean {
	return (
		flows.dataStores.some((store) =>
			containsNormalized(normalizedProposal, store.id),
		) ||
		flows.flows.some(
			(flow) =>
				containsNormalized(normalizedProposal, flow.id) ||
				containsNormalized(normalizedProposal, flow.name),
		) ||
		flows.moduleConnections.some(
			(connection) =>
				containsNormalized(normalizedProposal, connection.fromModule) &&
				containsNormalized(normalizedProposal, connection.toModule),
		)
	);
}

function contradictsExistingFlow(
	normalizedProposal: string,
	flows: ProjectFlows,
): string | undefined {
	if (
		!/\b(skip|bypass|remove|replace|ignore|saltar|omitir|eliminar|reemplazar)\b/iu.test(
			normalizedProposal,
		)
	) {
		return undefined;
	}
	for (const flow of flows.flows) {
		const flowParts = [
			flow.id,
			flow.name,
			flow.trigger,
			...flow.steps.flatMap((step) => [step.from, step.to]),
		];
		if (
			flowParts.some((part) => containsNormalized(normalizedProposal, part))
		) {
			return flow.id;
		}
	}
	return undefined;
}

function collectFunctionalMentions(text: string, qualifier: string): string[] {
	return [
		...uniqueMatches(
			text,
			new RegExp(`\\b([\\p{L}0-9][\\p{L}0-9-]*)\\s+${qualifier}\\b`, "giu"),
		),
		...uniqueMatches(
			text,
			new RegExp(`\\b${qualifier}\\s+([\\p{L}0-9][\\p{L}0-9-]*)\\b`, "giu"),
		),
	];
}

function collectScreenMentions(text: string): string[] {
	return [
		...collectFunctionalMentions(text, "screen"),
		...uniqueMatches(text, /(?:^|\s)(\/[a-z0-9][a-z0-9/_:-]*)/giu),
	];
}

function collectDataStoreMentions(text: string): string[] {
	return [
		...uniqueMatches(
			text,
			/\b([a-z0-9]+(?:-[a-z0-9]+)*(?:-store|-db|-database|database))\b/giu,
		),
		...collectFunctionalMentions(text, "dataStore"),
		...collectFunctionalMentions(text, "database"),
	];
}

function collectUiElementMentions(text: string): string[] {
	return [
		...uniqueMatches(
			text,
			/\b([a-z0-9]+(?:-[a-z0-9]+)*(?:-button|-form|-table|-dashboard|-card|-link|-modal|-tab))\b/giu,
		),
		...collectFunctionalMentions(text, "button"),
		...collectFunctionalMentions(text, "uiElement"),
	];
}

function uniqueMatches(text: string, regex: RegExp): string[] {
	const matches = new Set<string>();
	for (const match of text.matchAll(regex)) {
		const value = match[1]?.trim();
		if (value && !NOISY_FUNCTIONAL_MENTIONS.has(normalize(value))) {
			matches.add(value);
		}
	}
	return [...matches];
}

const NOISY_FUNCTIONAL_MENTIONS = new Set([
	"fix",
	"update",
	"fails",
	"handling",
	"refresh",
	"the",
	"this",
]);

function containsNormalized(normalizedText: string, value: string): boolean {
	const normalizedValue = normalize(value);
	return normalizedValue.length > 0 && normalizedText.includes(normalizedValue);
}

function pushUniqueWarning(
	warnings: RuleValidationWarning[],
	warning: RuleValidationWarning,
): void {
	if (
		warnings.some(
			(existing) =>
				existing.ruleId === warning.ruleId &&
				existing.message === warning.message,
		)
	) {
		return;
	}
	warnings.push(warning);
}

function matchesRule(text: string, rule: string): boolean {
	const normalizedRule = normalize(rule);
	const normalizedText = normalize(text);
	if (normalizedRule.includes("commit") && normalizedText.includes("commit"))
		return true;
	if (normalizedRule.includes("push") && normalizedText.includes("push"))
		return true;
	if (
		(normalizedRule.includes("repo real") ||
			normalizedRule.includes("real repo")) &&
		(normalizedText.includes("repo real") ||
			normalizedText.includes("real repo"))
	) {
		return true;
	}
	return meaningfulTerms(normalizedRule).every((term) =>
		normalizedText.includes(term),
	);
}

function meaningfulTerms(normalizedRule: string): string[] {
	return normalizedRule
		.split(/[^a-z0-9]+/u)
		.filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
}

const STOP_WORDS = new Set([
	"cannot",
	"pueden",
	"deben",
	"hacer",
	"without",
	"nunca",
	"never",
	"from",
	"with",
	"para",
]);

function knownRuleIds(
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): Set<string> {
	return new Set([
		"finding.title.required",
		"finding.description.required",
		"finding.evidence.required",
		"proposal.humanApproval.required",
		"lab.commit.forbidden",
		"lab.push.forbidden",
		"realRepo.humanApproval.required",
		...blueprint.forbiddenActions.map(
			(rule) => `blueprint.forbiddenActions.${slug(rule)}`,
		),
		...flows.invariants.map((rule) => `flows.invariants.${slug(rule)}`),
		...flows.forbiddenTransitions.map(
			(rule) => `flows.forbiddenTransitions.${slug(rule)}`,
		),
		"flows.module.unknown",
		"flows.screen.unknown",
		"flows.dataStore.unknown",
		"flows.uiElement.unknown",
		"flows.protectedChange.approvalRequired",
		"flows.flow.contradiction",
	]);
}

function isHighRisk(severity: string): boolean {
	return severity === "high" || severity === "critical";
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function normalize(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "");
}

function slug(value: string): string {
	return normalize(value)
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}
