/**
 * telemetry-lifecycle.ts — recorder for the advisory lifecycle (#2467).
 *
 * Per #2467:
 * - 3-state lifecycle: emitted → delivered → resolved (or delivered-not-resolved)
 * - Pull marks `delivered` ONLY. Never `resolved` on pull.
 * - `resolved` is derived from the satisfaction-predicate evaluator (see
 *   satisfaction-predicate.ts) which runs in the OS cron tick.
 * - `dismissed` is set only via the `idu_ack_advisory` escape hatch.
 *
 * The vocabulary for lifecycle phases is FIXED:
 * - "emitted": written when the injection is created (by cron preflight)
 * - "delivered": written when the orchestrator pulls the advisory
 * - "resolved": written when the satisfaction-predicate evaluator determines
 *               the advisory's predicate is satisfied
 * - "dismissed": written when `idu_ack_advisory` is invoked explicitly
 * - "expired": reserved for past-window-and-stale
 * - "superseded": reserved for replaced by a newer injection
 *
 * The file is append-only JSONL at `<stateRoot>/injection-telemetry.jsonl`.
 * Rollover at 1k events (keep last 1k) to bound storage.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * FIXED vocabulary. NO free-form tags. Adding a new phase is intentional
 * friction (scope-creep guard).
 */
export type LifecyclePhase = "emitted" | "delivered" | "resolved" | "dismissed" | "expired" | "superseded";

export type LifecycleEvent = {
	injectionId: string;
	phase: LifecyclePhase;
	ts: string;
	kind?: string;
	reason?: string;
	// Optional path context. Set by the hygiene emission path so the
	// cron evaluator can construct the `path-absent` predicate from
	// the lifecycle log without re-discovering the file.
	path?: string;
};

/** Max events before rollover. */
const ROLLOVER_THRESHOLD = 1000;

/**
 * Record a lifecycle event. Appends one JSON line to
 * `<stateRoot>/injection-telemetry.jsonl`. Triggers rollover if needed.
 */
export function recordLifecycleEvent(input: {
	stateRoot: string;
	injectionId: string;
	phase: LifecyclePhase;
	kind?: string;
	reason?: string;
	path?: string;
	now?: Date;
}): LifecycleEvent {
	if (!isValidPhase(input.phase)) {
		throw new Error(`recordLifecycleEvent: invalid phase "${input.phase}". Valid: ${VALID_PHASES.join(", ")}`);
	}
	const event: LifecycleEvent = {
		injectionId: input.injectionId,
		phase: input.phase,
		ts: (input.now ?? new Date()).toISOString(),
		kind: input.kind,
		reason: input.reason,
		path: input.path,
	};
	appendLifecycleLog(input.stateRoot, event);
	rolloverIfNeeded(input.stateRoot);
	return event;
}

/**
 * Read all lifecycle events for a given injection, sorted by ts asc.
 * Used by the satisfaction-predicate evaluator in cron preflight.
 */
export function readInjectionLifecycle(stateRoot: string, injectionId: string): LifecycleEvent[] {
	const log = readLifecycleLog(stateRoot);
	return log
		.filter((e) => e.injectionId === injectionId)
		.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/**
 * Read all `delivered` injections that have NOT been resolved/dismissed.
 * Used by the cron preflight to find advisories awaiting predicate evaluation.
 */
export function readPendingAdvisories(stateRoot: string, windowMs?: number): LifecycleEvent[] {
	const log = readLifecycleLog(stateRoot);
	const seen = new Map<string, LifecycleEvent>();
	for (const event of log) {
		const current = seen.get(event.injectionId);
		if (!current || Date.parse(event.ts) >= Date.parse(current.ts)) {
			seen.set(event.injectionId, event);
		}
	}
	const pending: LifecycleEvent[] = [];
	for (const last of seen.values()) {
		if (last.phase !== "delivered") continue;
		// Optional: filter to those whose deliveredAt is within the last windowMs
		if (windowMs !== undefined) {
			const deliveredMs = Date.parse(last.ts);
			if (Date.now() - deliveredMs > windowMs) continue;
		}
		pending.push(last);
	}
	return pending;
}

/**
 * Read the MCP usage log from `<stateRoot>/logs/mcp-usage.jsonl` if it exists.
 * Returns `[]` if the file is missing or malformed.
 */
export function readMcpUsageLog(stateRoot: string): { tool: string; ts: string; args?: Record<string, unknown> }[] {
	const path = join(stateRoot, "logs", "mcp-usage.jsonl");
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf8");
		const out: { tool: string; ts: string; args?: Record<string, unknown> }[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as { tool?: unknown; ts?: unknown; args?: unknown };
				if (typeof obj.tool === "string" && typeof obj.ts === "string") {
					out.push({
						tool: obj.tool,
						ts: obj.ts,
						args: (typeof obj.args === "object" && obj.args !== null ? obj.args : undefined) as Record<string, unknown> | undefined,
					});
				}
			} catch {
				// skip malformed lines
			}
		}
		return out;
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_PHASES: readonly LifecyclePhase[] = ["emitted", "delivered", "resolved", "dismissed", "expired", "superseded"];

function isValidPhase(phase: string): phase is LifecyclePhase {
	return (VALID_PHASES as readonly string[]).includes(phase);
}

function appendLifecycleLog(stateRoot: string, event: LifecycleEvent): void {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	mkdirSync(stateRoot, { recursive: true });
	appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

function readLifecycleLog(stateRoot: string): LifecycleEvent[] {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf8");
		const out: LifecycleEvent[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as Record<string, unknown>;
				if (
					typeof obj.injectionId === "string" &&
					typeof obj.phase === "string" &&
					typeof obj.ts === "string"
				) {
					out.push(obj as LifecycleEvent);
				}
			} catch {
				// skip malformed lines
			}
		}
		return out;
	} catch {
		return [];
	}
}

function rolloverIfNeeded(stateRoot: string): void {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return;
	try {
		const raw = readFileSync(path, "utf8");
		const lines = raw.split("\n").filter((l) => l.trim());
		if (lines.length <= ROLLOVER_THRESHOLD) return;
		// Rollover: keep last ROLLOVER_THRESHOLD lines.
		// Move the OLD file to .bak and write a new one.
		const keep = lines.slice(-ROLLOVER_THRESHOLD).join("\n") + "\n";
		const bakPath = join(stateRoot, "injection-telemetry.jsonl.bak");
		renameSync(path, bakPath);
		writeFileSync(path, keep, "utf8");
		// keep mkdirSync imported (used in appendLifecycleLog)
		dirname;
	} catch {
		// Rollover failure is non-fatal
	}
}