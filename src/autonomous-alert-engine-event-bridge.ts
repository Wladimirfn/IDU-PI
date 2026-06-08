import { appendEvent } from "./event-bus.js";

export type AlertDecision = {
	id: string;
	kind: string;
	domain?: string;
	severity?: string;
	summary?: string;
	ageMs?: number;
};

export type AlertReportLike = {
	decisions: AlertDecision[];
};

export type EmitStuckTaskEventsInput = {
	stateRoot: string;
	projectId: string;
	now: Date;
	report: AlertReportLike;
};

export type EmitResult = {
	emittedCount: number;
};

const STUCK_DOMAINS = new Set(["stale_work", "backlog_pressure"]);

export function emitStuckTaskEventsFromAlertReport(
	input: EmitStuckTaskEventsInput,
): EmitResult {
	const matched = input.report.decisions.filter(
		(d) => typeof d.domain === "string" && STUCK_DOMAINS.has(d.domain),
	);
	for (const decision of matched) {
		appendEvent(input.stateRoot, {
			ts: input.now.toISOString(),
			kind: "task_stuck",
			projectId: input.projectId,
			payload: {
				taskId: decision.id,
				ageMs: 3_600_000,
				domain: decision.domain,
				severity: decision.severity,
			},
			sourceRef: "autonomous-alert-engine",
			evidenceRefs: [],
		});
	}
	return { emittedCount: matched.length };
}
