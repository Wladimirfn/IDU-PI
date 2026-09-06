import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeArtifactName } from "./birth-artifacts.js";
import { recordDecision } from "./decision-ledger.js";
import {
	recordLifecycleEvent,
	type LifecyclePhase,
} from "./telemetry-lifecycle.js";

export type InjectionSeverity = "info" | "warning" | "critical";

export type DecisionEnvelope = {
	severity: InjectionSeverity;
	summary: string;
	options: string[];
	evidenceRefs: string[];
	orchestratorDecisionRequired: boolean;
};

export type Injection = {
	ts: string;
	triggerId: string;
	decisionEnvelope: DecisionEnvelope;
	injectionId: string;
	acked: boolean;
	// Optional kind discriminator. The supervisor_advisory injections
	// are written with kind="supervisor_advisory". Other callers
	// (e.g. proposal outbox) may omit it.
	kind?: string;
	// Optional structured context for predicate resolution. The hygiene
	// emission path sets `meta.path` so the cron evaluator can
	// construct the `path-absent` predicate without re-discovering the
	// file. The hygiene emission path also sets `meta.reason` for the
	// last emission (cap annotation: "+N más — corré sweep"); the
	// central `appendInjection` propagates it into the `emitted`
	// lifecycle event's `reason` field. Other callers may omit meta.
	meta?: {
		path?: string;
		pattern?: string;
		reason?: string;
		[k: string]: unknown;
	};
};

export type ReadPendingInjectionsOptions = {
	since?: string;
};

export function resolveInjectionsPath(stateRoot: string): string {
	return join(stateRoot, "injections.jsonl");
}

/**
 * Write the `emitted` lifecycle event for a freshly-created injection.
 * Lived in `cron-preflight.ts` until A.1 — moved here next to
 * `appendInjection` so the WRITE coupling is structural: every
 * `appendInjection` auto-emits, no caller can forget.
 *
 * Both the reminder path and the hygiene sensor emission path use
 * this helper. Without it, the cron evaluator has nothing to evaluate
 * (the evaluator only looks at advisories whose latest phase is
 * `delivered`, but if `emitted` was never written, `delivered` was
 * never written either, and the evaluator iterates empty).
 */
export function recordInjectionEmitted(input: {
	stateRoot: string;
	injectionId: string;
	kind: string;
	reason?: string;
	path?: string;
	now?: Date;
}): void {
	recordLifecycleEvent({
		stateRoot: input.stateRoot,
		injectionId: input.injectionId,
		phase: "emitted",
		kind: input.kind,
		reason: input.reason,
		path: input.path,
		now: input.now ?? new Date(),
	});
}

/**
 * Append a single injection envelope to `injections.jsonl` and emit
 * the corresponding `emitted` lifecycle event in one atomic writer
 * call.
 *
 * INVARIANT (A.1): every `appendInjection` emits `emitted`. After this
 * slice, no caller needs to invoke `recordInjectionEmitted` manually
 * — the write side coupling is structural. Going through this
 * function is the only path that produces an injection, so the
 * invariant cannot leak.
 *
 * `kind` is optional on the envelope (some legacy callers omit it).
 * We default to `"unknown"` for the emitted event so the lifecycle
 * log always has a non-empty kind discriminator.
 *
 * `path` and `reason` are derived from `envelope.meta` when present
 * (the hygiene emission path stores `meta.path` for the path-absent
 * predicate, and `meta.reason` carries the "+N más — corré sweep"
 * cap annotation). This keeps the auto-emit semantically equivalent
 * to the prior manual emit.
 */
export function appendInjection(stateRoot: string, envelope: Injection): void {
	// Path-safety guard: triggerId flows into the envelope and may be consumed
	// downstream as a reference; reject `..`, `/` or `\` characters to keep
	// the trigger engine injection namespace controlled.
	assertSafeArtifactName(envelope.triggerId);
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, "", "utf8");
	}
	appendFileSync(filePath, `${JSON.stringify(envelope)}\n`, "utf8");
	// INVARIANT: callers must pass a current-or-future `ts`. A past timestamp
	// would break the latest-by-ts phase resolution in readPendingAdvisories
	// (the advisory could get stuck "pending"). No live bug today — all 6
	// callers pass `now`; this documents the contract for future callers.

	// Auto-emit: structurally impossible to write an injection without
	// its `emitted` event. Kind defaults to "unknown" for envelopes
	// that omit it (legacy callers). We honor the envelope's `ts`
	// for the emitted event so the event's logical time matches the
	// injection's logical time (important for tests and for
	// readPendingAdvisories ordering).
	const meta = (envelope.meta ?? {}) as {
		path?: string;
		reason?: string;
	};
	const emitNow = envelope.ts ? new Date(envelope.ts) : undefined;
	recordInjectionEmitted({
		stateRoot,
		injectionId: envelope.injectionId,
		kind: envelope.kind ?? "unknown",
		path: meta.path,
		reason: meta.reason,
		now: emitNow,
	});
}

export function readPendingInjections(
	stateRoot: string,
	options: ReadPendingInjectionsOptions = {},
): Injection[] {
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) return [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	if (!raw.trim()) return [];
	const sinceMs = options.since ? Date.parse(options.since) : undefined;
	const out: Injection[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: Injection;
		try {
			parsed = JSON.parse(line) as Injection;
		} catch {
			continue;
		}
		if (parsed.acked) continue;
		if (
			typeof sinceMs === "number" &&
			Number.isFinite(sinceMs) &&
			Date.parse(parsed.ts) < sinceMs
		)
			continue;
		out.push(parsed);
	}
	return out;
}

/**
 * Outcome of a markInjectionAcked call. Distinguishes the three states:
 *   - "acked"         : a real transition just happened (acked: false → true)
 *   - "already-acked" : the line existed but was already acked:true (no-op)
 *   - "not-found"     : no line with this injectionId exists
 *
 * Callers (idu_ack_advisory, the inline ack:true on idu_pending_injections)
 * use this to decide whether to write the `dismissed` lifecycle event:
 * only `acked` is a real transition; the other two are no-ops and should
 * NOT generate lifecycle noise.
 */
export type AckOutcome = "acked" | "not-found" | "already-acked";

/**
 * Mark an injection as acked and (when the call is a real transition)
 * emit the corresponding terminal lifecycle event.
 *
 * INVARIANT (A.2): when called with `options.phase` set, the terminal
 * event is emitted CONDITIONALLY on `outcome === "acked"`. For
 * `already-acked` and `not-found`, NO event is emitted — this prevents
 * phantom dismissals on no-op calls (the bug the #156 audit caught:
 * a routine `idu-ack-advisory` against a ghost-id or an already-acked
 * injection would otherwise still emit a `dismissed` event for an
 * injection that never transitioned).
 *
 * The cron exception: callers that emit their terminal event PRE-ACK
 * based on their own predicate evaluation (e.g. `cron-preflight.ts`
 * emits `expired` / `resolved` BEFORE the ack) MUST call WITHOUT
 * `options.phase` to avoid double-emit. The coupling is for
 * transition-driven terminals (user dismiss, supersede) where the
 * terminal IS the ack outcome. See cron-preflight.ts:260,288,319
 * (manual emits) and :271,299,332 (ack callsites that stay without
 * the third argument).
 */
export function markInjectionAcked(
	stateRoot: string,
	injectionId: string,
	options?: {
		phase?: LifecyclePhase;
		reason?: string;
		now?: Date;
	},
): AckOutcome {
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) return "not-found";
	const raw = readFileSync(filePath, "utf8");
	if (!raw.trim()) return "not-found";
	const lines = raw.split("\n").filter((line) => line.length > 0);
	let target: Injection | null = null;
	let alreadyAcked: boolean = false;
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as Injection;
			if (parsed.injectionId === injectionId) {
				if (parsed.acked) {
					alreadyAcked = true;
				} else {
					target = parsed;
				}
				break;
			}
		} catch {
			// skip malformed line
		}
	}
	if (alreadyAcked) return "already-acked";
	if (!target) return "not-found";
	const injection = target;
	// Record the decision FIRST so a ledger/DB failure is not
	// swallowed silently. If recordDecision throws, the injection
	// is left un-acked and the orchestrator can retry the ack.
	const dbPath = join(stateRoot, "lab.db");
	recordDecision(dbPath, {
		projectId: "default",
		decidedAt: new Date().toISOString(),
		decidedBy: "orchestrator",
		decision: "ack",
		targetKind: injection.triggerId ?? "injection",
		targetId: injectionId,
		profileRef: "config/profiles/orchestrator.md",
	});
	// Then update the injection file to mark it acked.
	const updated: string[] = lines.map((line) => {
		try {
			const parsed = JSON.parse(line) as Injection;
			if (parsed.injectionId === injectionId && !parsed.acked) {
				return JSON.stringify({ ...parsed, acked: true });
			}
			return line;
		} catch {
			return line;
		}
	});
	writeFileSync(filePath, `${updated.join("\n")}\n`, "utf8");

	// CRITICAL (A.2): conditional auto-emit on real transition.
	// outcome === "acked" is the ONLY branch where a terminal event
	// is written — "already-acked" and "not-found" produce NO event
	// (phantom-dismissal guard from the #156 audit). The `phase`
	// check distinguishes transition-driven callers (idu_ack_advisory,
	// inline ack:true, Case 3 superseded) from the cron exception
	// (which emits its terminal event BEFORE the ack and MUST NOT
	// double-emit; those callsites omit `options.phase`).
	//
	// `kind` is read from the injection itself (same source-of-truth
	// the A.1 auto-emit uses via `envelope.kind ?? "unknown"`) so
	// the terminal event carries the same discriminator as the
	// injection. Without this, the test contract
	// `assert.equal(evt.kind, "objective_reminder")` would fail.
	if (options?.phase) {
		recordLifecycleEvent({
			stateRoot,
			injectionId,
			phase: options.phase,
			kind: injection.kind,
			reason: options.reason,
			now: options.now,
		});
	}

	return "acked";
}
