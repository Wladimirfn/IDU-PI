import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { assertSafeArtifactName } from "./birth-artifacts.js";

export type EventKind =
	| "task_stuck"
	| "task_created"
	| "intention_registered"
	| "intention_decision_pending"
	| "intention_blocked"
	| "objective_reminder_due"
	| "bibliotecario_research_requested"
	| "agentlab_finding_ready"
	| "queue_proposal_added"
	| "master_plan_drift"
	| "lab_write";

export type Event = {
	ts: string;
	kind: string; // EventKind union, but kept as string for lenient validation
	projectId: string;
	payload: Record<string, unknown>;
	sourceRef: string;
	evidenceRefs: string[];
	ownerId?: string;
};

export type ReadEventsOptions = {
	since?: string;
	until?: string;
	kindFilter?: string;
	limit?: number;
};

export type EventBusConfig = {
	eventsMaxLines: number;
	ownerId?: string;
};

const DEFAULT_EVENTS_MAX_LINES = 10_000;

// Module-level idempotency: per-stateRoot set of hashes
// (key: {ts}|{kind}|{stableStringify(payload)}).
const seenHashesByRoot = new Map<string, Set<string>>();

export function resolveEventsPath(stateRoot: string): string {
	return join(stateRoot, "events.jsonl");
}

export function appendEvent(
	stateRoot: string,
	event: Event,
	config: Partial<EventBusConfig> = {},
): void {
	const maxLines = config.eventsMaxLines ?? DEFAULT_EVENTS_MAX_LINES;
	const ownerId = config.ownerId;
	// Path-safety guard: validate the kind field against artifact-name rules.
	// The kind flows into the JSONL payload and is consumed downstream as a
	// string; rejecting `..`, `/` or `\` in the kind prevents accidental path
	// traversal if a downstream tool ever resolves refs from evidenceRefs.
	assertSafeArtifactName(event.kind);
	const enriched: Event = ownerId
		? { ...event, ownerId: event.ownerId ?? ownerId }
		: event;
	const hash = computeEventHash(enriched);
	let seen = seenHashesByRoot.get(stateRoot);
	if (!seen) {
		seen = new Set<string>();
		seenHashesByRoot.set(stateRoot, seen);
	}
	if (seen.has(hash)) return;
	seen.add(hash);
	const filePath = resolveEventsPath(stateRoot);
	if (!existsSync(filePath)) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, "", "utf8");
	}
	appendFileSync(filePath, `${JSON.stringify(enriched)}\n`, "utf8");
	enforceCap(filePath, maxLines);
}

export function readEvents(
	stateRoot: string,
	options: ReadEventsOptions = {},
): Event[] {
	const filePath = resolveEventsPath(stateRoot);
	if (!existsSync(filePath)) return [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	if (!raw.trim()) return [];
	const sinceMs = options.since ? Date.parse(options.since) : undefined;
	const untilMs = options.until ? Date.parse(options.until) : undefined;
	const limit = options.limit;
	const out: Event[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: Event;
		try {
			parsed = JSON.parse(line) as Event;
		} catch {
			continue;
		}
		if (options.kindFilter && parsed.kind !== options.kindFilter) continue;
		const tsMs = Date.parse(parsed.ts);
		if (Number.isFinite(sinceMs) && Number.isFinite(tsMs) && tsMs < (sinceMs as number)) continue;
		if (Number.isFinite(untilMs) && Number.isFinite(tsMs) && tsMs > (untilMs as number)) continue;
		out.push(parsed);
		if (typeof limit === "number" && out.length >= limit) break;
	}
	return out;
}

function computeEventHash(event: Event): string {
	const payload = `${event.ts}|${event.kind}|${stableStringify(event.payload)}`;
	return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
	return `{${parts.join(",")}}`;
}

function enforceCap(filePath: string, maxLines: number): void {
	if (!existsSync(filePath)) return;
	const raw = readFileSync(filePath, "utf8");
	const lines = raw.split("\n").filter((line) => line.length > 0);
	if (lines.length <= maxLines) return;
	const kept = lines.slice(-maxLines);
	writeFileSync(filePath, `${kept.join("\n")}\n`, "utf8");
}

export type LabWriteOperation = "insert" | "update" | "delete";

export type LabWriteEventPayload = {
	table: string;
	operation: LabWriteOperation;
	rowId: string;
	role?: string;
};

/**
 * Audit-trail helper for `lab.db` writes. Wraps `appendEvent` and
 * stamps the event with `kind: "lab_write"`, `sourceRef: "lab-db"`,
 * and the caller-supplied `projectId`.
 *
 * The payload contract is regression-pinned by tests:
 * `{ table, operation, rowId, role? }`.
 */
export function appendLabWriteEvent(
	stateRoot: string,
	payload: LabWriteEventPayload,
	projectId: string,
): void {
	appendEvent(stateRoot, {
		ts: new Date().toISOString(),
		kind: "lab_write",
		projectId,
		payload: { ...payload },
		sourceRef: "lab-db",
		evidenceRefs: [],
	});
}
