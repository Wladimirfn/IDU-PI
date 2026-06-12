import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { appendEvent } from "./event-bus.js";

export type AlertDecision = {
	id: string;
	kind?: string;
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

type SeenState = {
	version: 1;
	seen: Record<string, string>;
};

const STUCK_EVENTS_SEEN_FILENAME = "stuck-events-seen.json";
const SEEN_RETENTION_MS = 2 * 60 * 60 * 1000;
const STUCK_DOMAINS = new Set(["stale_work", "backlog", "backlog_pressure"]);

export function emitStuckTaskEventsFromAlertReport(
	input: EmitStuckTaskEventsInput,
): EmitResult {
	const matched = input.report.decisions.filter(
		(d) => typeof d.domain === "string" && STUCK_DOMAINS.has(d.domain),
	);
	if (matched.length === 0) return { emittedCount: 0 };

	const nowIso = input.now.toISOString();
	const state = pruneSeenState(readSeenState(input.stateRoot), input.now);
	let emittedCount = 0;
	for (const decision of matched) {
		const domain =
			typeof decision.domain === "string"
				? decision.domain
				: (decision.kind ?? "unknown");
		const seenKey = stuckSeenKey(decision.id, domain, input.now);
		if (state.seen[seenKey]) continue;
		appendEvent(input.stateRoot, {
			ts: nowIso,
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
		state.seen[seenKey] = nowIso;
		emittedCount += 1;
	}
	writeSeenState(input.stateRoot, state);
	return { emittedCount };
}

function stuckEventsSeenPath(stateRoot: string): string {
	return join(resolve(stateRoot), STUCK_EVENTS_SEEN_FILENAME);
}

function readSeenState(stateRoot: string): SeenState {
	const path = stuckEventsSeenPath(stateRoot);
	if (!existsSync(path)) return emptySeenState();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		const seen = parsed.seen;
		if (typeof seen !== "object" || seen === null) return emptySeenState();
		const normalized: Record<string, string> = {};
		for (const [key, value] of Object.entries(seen)) {
			if (typeof value === "string") normalized[key] = value;
		}
		return { version: 1, seen: normalized };
	} catch {
		return emptySeenState();
	}
}

function writeSeenState(stateRoot: string, state: SeenState): void {
	const path = stuckEventsSeenPath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	renameSync(tmpPath, path);
}

function pruneSeenState(state: SeenState, now: Date): SeenState {
	const cutoffMs = now.getTime() - SEEN_RETENTION_MS;
	const seen: Record<string, string> = {};
	for (const [key, timestamp] of Object.entries(state.seen)) {
		const timestampMs = Date.parse(timestamp);
		if (Number.isFinite(timestampMs) && timestampMs >= cutoffMs) {
			seen[key] = timestamp;
		}
	}
	return { version: 1, seen };
}

function stuckSeenKey(taskId: string, domain: string, now: Date): string {
	return `${taskId}|${domain}|${now.toISOString().slice(0, 13)}`;
}

function emptySeenState(): SeenState {
	return { version: 1, seen: {} };
}
