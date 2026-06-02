import type {
	EvidenceGateway,
	EvidenceRequiredAction,
} from "./evidence-gateways.js";
import type { OrchestratorAdvisory } from "./orchestrator-advisory.js";

export type DecisionEnvelope = {
	version: 1;
	authority: "advisory";
	tool: string;
	recommendation: string;
	severity: string;
	confidence: number;
	summary: string;
	requiresHuman: boolean;
	orchestratorDecisionRequired: boolean;
	allowedToProceed: boolean;
	evidenceRefs: string[];
	requiredActions: EvidenceRequiredAction[];
	suggestedAgentLabs: string[];
	nextActions: string[];
	advisoryOnly: true;
};

type DecisionEnvelopeInput = {
	tool: string;
	recommendation?: string;
	severity?: string;
	confidence?: number;
	summary: string;
	requiresHuman?: boolean;
	orchestratorDecisionRequired?: boolean;
	allowedToProceed?: boolean;
	evidenceRefs?: string[];
	requiredActions?: EvidenceRequiredAction[];
	suggestedAgentLabs?: string[];
	nextActions?: string[];
	evidenceGateways?: EvidenceGateway[];
};

export function buildDecisionEnvelope(
	input: DecisionEnvelopeInput,
): DecisionEnvelope {
	const gatewayActions = requiredActionsFromGateways(input.evidenceGateways ?? []);
	const requiredActions = [...gatewayActions, ...(input.requiredActions ?? [])];
	const gatewayAllowed = allowedToProceedFromGateways(input.evidenceGateways ?? []);
	const hasBlockingAction = requiredActions.some((action) => action.blocking);
	const requiresHuman = input.requiresHuman ?? hasHumanRequired(requiredActions);
	return {
		version: 1,
		authority: "advisory",
		tool: input.tool,
		recommendation: input.recommendation ?? recommendationFromActions(requiredActions),
		severity: input.severity ?? severityFromActions(requiredActions),
		confidence: input.confidence ?? 0.7,
		summary: input.summary,
		requiresHuman,
		orchestratorDecisionRequired:
			input.orchestratorDecisionRequired ??
			(requiresHuman || requiredActions.length > 0),
		allowedToProceed:
			input.allowedToProceed ?? (gatewayAllowed && !hasBlockingAction),
		evidenceRefs: unique([
			...(input.evidenceRefs ?? []),
			...evidenceRefsFromGateways(input.evidenceGateways ?? []),
		]),
		requiredActions,
		suggestedAgentLabs: unique(input.suggestedAgentLabs ?? []),
		nextActions: unique(input.nextActions ?? []),
		advisoryOnly: true,
	};
}

export function decisionEnvelopeFromAdvisory(
	tool: string,
	advisory: OrchestratorAdvisory,
	evidenceGateways: EvidenceGateway[] = [],
): DecisionEnvelope {
	return buildDecisionEnvelope({
		tool,
		recommendation: advisory.recommendation,
		severity: advisory.severity,
		confidence: advisory.confidence,
		summary: advisory.summary,
		requiresHuman: advisory.requiresHuman,
		orchestratorDecisionRequired: advisory.requiresHuman,
		evidenceRefs: advisory.evidenceRefs,
		suggestedAgentLabs: advisory.suggestedAgentLabs,
		nextActions: advisory.recommendedNext,
		evidenceGateways,
	});
}

export function decisionEnvelopeFromEvidence(
	tool: string,
	summary: string,
	evidenceGateways: EvidenceGateway[],
	input: Partial<Omit<DecisionEnvelopeInput, "tool" | "summary" | "evidenceGateways">> = {},
): DecisionEnvelope {
	return buildDecisionEnvelope({
		tool,
		summary,
		evidenceGateways,
		...input,
	});
}

function requiredActionsFromGateways(
	gateways: EvidenceGateway[],
): EvidenceRequiredAction[] {
	return gateways.flatMap((gateway) => gateway.requiredActions);
}

function allowedToProceedFromGateways(gateways: EvidenceGateway[]): boolean {
	return gateways.length === 0
		? true
		: gateways.every((gateway) => gateway.allowedToProceed);
}

function evidenceRefsFromGateways(gateways: EvidenceGateway[]): string[] {
	return gateways.flatMap((gateway) => [
		`gateway:${gateway.id}`,
		...gateway.evidence.map((item) => `${item.source}:${item.id}`),
	]);
}

function hasHumanRequired(actions: EvidenceRequiredAction[]): boolean {
	return actions.some(
		(action) => action.owner === "human" || /human|approval|confirm/i.test(action.action),
	);
}

function recommendationFromActions(actions: EvidenceRequiredAction[]): string {
	if (actions.some((action) => action.blocking)) return "block";
	if (actions.length > 0) return "warn";
	return "allow";
}

function severityFromActions(actions: EvidenceRequiredAction[]): string {
	if (actions.some((action) => action.blocking)) return "needs_approval";
	if (actions.length > 0) return "warning";
	return "info";
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}
