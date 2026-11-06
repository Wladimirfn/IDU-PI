import { arbitrate, type ArbitrationDecision, type ArbitrationOption } from "./arbitration.js";
import { recordDecision } from "./decision-ledger.js";

export interface ArbitrationRunInput {
	/** Label used in the ledger message, e.g. "idu-pi arbitrate" or "idu_arbitrate". */
	label: string;
	/** Prefix of `decidedBy`, e.g. "cli-arbitrate". */
	decidedByPrefix: string;
	stateSummary: string;
	options: ArbitrationOption[];
	confidenceThreshold?: number;
	cwd?: string;
	apiKey?: string;
	endpoint?: string;
	offline?: boolean;
}

/**
 * Run an arbitration and leave its audit trail.
 *
 * The CLI and the MCP server used to carry this sequence twice, by hand. They
 * drifted: the CLI path recorded no decision at all until it was patched to
 * match. Keeping the trace in one place is what stops the next drift, because
 * adding a field to the record no longer means remembering to edit two files.
 */
export async function arbitrateAndRecord(input: ArbitrationRunInput): Promise<ArbitrationDecision> {
	const decision = await arbitrate({
		stateSummary: input.stateSummary,
		options: input.options,
		confidenceThreshold: input.confidenceThreshold,
		cwd: input.cwd,
		apiKey: input.apiKey,
		endpoint: input.endpoint,
		offline: input.offline,
	});

	recordDecision({
		projectId: "arbitration",
		decision: `${input.label} selected '${decision.selectedOptionId}' (source: ${decision.source}, confidence: ${decision.confidence}, humanReview: ${decision.requiresHumanReview}). Options: ${input.options.map((option) => option.id).join(", ")}. State: ${input.stateSummary.slice(0, 200)}`,
		decidedBy: `${input.decidedByPrefix}/${decision.source}`,
		targetKind: "arbitration-decision",
		targetId: decision.selectedOptionId,
	});

	return decision;
}
