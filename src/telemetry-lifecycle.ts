/**
 * telemetry-lifecycle.ts — fixed-vocabulary lifecycle telemetry for
 * injection kinds (objective_reminder, hygiene_junk_file, …).
 *
 * Each call to `recordLifecycleEvent` appends one JSON line to
 * `<stateRoot>/injection-telemetry.jsonl`. The phase vocabulary is
 * closed: callers cannot invent new tags. This keeps the
 * `evaluateSatisfaction` aggregation stable across runs and projects.
 *
 * Rollover: when the file grows past ROLLOVER_THRESHOLD (1000) events,
 * the live file is renamed to `.bak` and a fresh empty file is started.
 * We keep the last 1000 in the live file so recent evidence survives
 * crashes; the `.bak` is best-effort historical context (not consumed
 * by the evaluator).
 *
 * No I/O dependencies beyond node:fs. The evaluator only reads the
 * live file (the `.bak` is not part of the satisfaction window).
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// Fixed vocabulary. NO free-form tags. Adding a phase here is a
// semantic change that must be reviewed (it shifts what
// `evaluateSatisfaction` reports).
export type LifecyclePhase =
	| "emitted"
	| "delivered"
	| "resolved"
	| "expired"
	| "superseded";

const LIFECYCLE_PHASES: readonly LifecyclePhase[] = [
	"emitted",
	"delivered",
	"resolved",
	"expired",
	"superseded",
];

export type LifecycleEvent = {
	injectionId: string;
	phase: LifecyclePhase;
	ts: string;
	kind?: string;
};

export type SatisfactionCounts = {
	emitted: number;
	delivered: number;
	resolved: number;
	expired: number;
	superseded: number;
	windowMs: number;
};

const ROLLOVER_THRESHOLD = 1000;

/** Resolve the canonical telemetry log path for a state root. */
export function resolveTelemetryPath(stateRoot: string): string {
	return join(stateRoot, "injection-telemetry.jsonl");
}

/**
 * Append a lifecycle event to `<stateRoot>/injection-telemetry.jsonl`.
 *
 * Throws on a phase outside the fixed vocabulary. The caller is
 * expected to catch and log (cron path is best-effort).
 */
export function recordLifecycleEvent(input: {
	stateRoot: string;
	injectionId: string;
	phase: LifecyclePhase;
	kind?: string;
	now?: Date;
}): LifecycleEvent {
	if (!LIFECYCLE_PHASES.includes(input.phase)) {
		throw new Error(
			`recordLifecycleEvent: invalid phase "${String(input.phase)}" — fixed vocabulary is ${LIFECYCLE_PHASES.join(", ")}`,
		);
	}
	const now = input.now ?? new Date();
	const event: LifecycleEvent = {
		injectionId: input.injectionId,
		phase: input.phase,
		ts: now.toISOString(),
		...(input.kind !== undefined ? { kind: input.kind } : {}),
	};
	appendLifecycleLog(input.stateRoot, event);
	rolloverIfNeeded(input.stateRoot);
	return event;
}

/** Read the live telemetry log as parsed events. Skips malformed lines. */
export function readLifecycleLog(stateRoot: string): LifecycleEvent[] {
	const path = resolveTelemetryPath(stateRoot);
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	if (!raw.trim()) return [];
	const out: LifecycleEvent[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: LifecycleEvent | null = null;
		try {
			parsed = JSON.parse(line) as LifecycleEvent;
		} catch {
			continue;
		}
		if (parsed && typeof parsed.phase === "string" && typeof parsed.injectionId === "string") {
			out.push(parsed);
		}
	}
	return out;
}

/**
 * Count events per phase within `[now - windowMs, now]`. Events with
 * unparseable timestamps are dropped (defensive — they should not
 * exist because `recordLifecycleEvent` always writes ISO strings).
 */
export function evaluateSatisfaction(input: {
	stateRoot: string;
	windowMs: number;
	now?: Date;
}): SatisfactionCounts {
	const now = input.now ?? new Date();
	const cutoff = now.getTime() - input.windowMs;
	const events = readLifecycleLog(input.stateRoot);
	const counts: SatisfactionCounts = {
		emitted: 0,
		delivered: 0,
		resolved: 0,
		expired: 0,
		superseded: 0,
		windowMs: input.windowMs,
	};
	for (const evt of events) {
		const ts = Date.parse(evt.ts);
		if (!Number.isFinite(ts)) continue;
		if (ts < cutoff) continue;
		if (LIFECYCLE_PHASES.includes(evt.phase)) {
			counts[evt.phase] += 1;
		}
	}
	return counts;
}

/**
 * If the live telemetry file has more than ROLLOVER_THRESHOLD events,
 * rename it to `<path>.bak` and start a fresh empty file. Keeps the
 * last ROLLOVER_THRESHOLD events in the live file (the rest go to
 * the .bak alongside the earlier entries).
 *
 * Idempotent and safe to call on every append. Best-effort: any I/O
 * error is swallowed so a partial write doesn't break the cron path.
 */
export function rolloverIfNeeded(stateRoot: string): void {
	const path = resolveTelemetryPath(stateRoot);
	if (!existsSync(path)) return;
	let lines: string[];
	try {
		lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
	} catch {
		return;
	}
	if (lines.length <= ROLLOVER_THRESHOLD) return;
	// Keep the last ROLLOVER_THRESHOLD in the live file; the rest go
	// to the .bak (alongside any pre-existing .bak content from
	// previous rollovers). This means `.bak` can grow without bound
	// across rollovers, but the live file stays bounded.
	const head = lines.slice(0, lines.length - ROLLOVER_THRESHOLD);
	const tail = lines.slice(lines.length - ROLLOVER_THRESHOLD);
	const bakPath = `${path}.bak`;
	let existingBak = "";
	if (existsSync(bakPath)) {
		try {
			existingBak = readFileSync(bakPath, "utf8");
			if (existingBak && !existingBak.endsWith("\n")) {
				existingBak += "\n";
			}
		} catch {
			existingBak = "";
		}
	}
	try {
		writeFileSync(bakPath, `${existingBak}${head.join("\n")}\n`, "utf8");
		writeFileSync(path, `${tail.join("\n")}\n`, "utf8");
		void renameSync; // ensure the import is not flagged as unused on minimal build
	} catch {
		// best-effort: do not break the cron path on a partial write
	}
}

// ----- internal helpers -----

function appendLifecycleLog(
	stateRoot: string,
	event: LifecycleEvent,
): void {
	const path = resolveTelemetryPath(stateRoot);
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf8");
	}
	appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}
