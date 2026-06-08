import { appendEvent } from "./event-bus.js";

export type PreflightRisk = "low" | "medium" | "high" | "blocker" | "unknown";

export type PreflightReportLike = {
	risk?: PreflightRisk | string;
	request?: string;
	affectedAreas?: string[];
};

export type EmitIntentionRegisteredInput = {
	stateRoot: string;
	projectId: string;
	now: Date;
	report: PreflightReportLike;
};

export type EmitResult = {
	emittedCount: number;
};

const LOW_RISKS = new Set(["low"]);

export function emitIntentionRegisteredEvent(
	input: EmitIntentionRegisteredInput,
): EmitResult {
	const risk = (input.report.risk ?? "unknown") as string;
	if (LOW_RISKS.has(risk)) {
		return { emittedCount: 0 };
	}
	appendEvent(input.stateRoot, {
		ts: input.now.toISOString(),
		kind: "intention_registered",
		projectId: input.projectId,
		payload: {
			request: input.report.request ?? "",
			risk,
			affectedAreas: input.report.affectedAreas ?? [],
		},
		sourceRef: "project-preflight",
		evidenceRefs: [],
	});
	return { emittedCount: 1 };
}
