/**
 * hygiene-injection.ts — emits `hygiene_junk_file` injections from the
 * hygiene sensor output. Closes forward obligation #1 from PR #153 audit.
 *
 * Contract (spec from the user, verbatim):
 *   - One injection per finding, with kind="hygiene_junk_file".
 *   - Dedup: if a pending `hygiene_junk_file` injection already exists
 *     for that path, skip.
 *   - Cap (over PENDING, not per-tick): maximum N advisories of
 *     `hygiene_junk_file` alive at any time. If findings.length > N
 *     (where N is the cap minus existing pending), the extras are
 *     noted as a text annotation in the last emission's reason
 *     ("+M más — corré sweep"). The annotation is NOT a tracked
 *     injection (otherwise it would never resolve).
 *   - recordInjectionEmitted is called for each emitted injection.
 *   - The "INVARIANT test" (the obligation): for every
 *     `hygiene_junk_file` injection in injections.jsonl, there MUST
 *     be a corresponding `emitted` event. This module guarantees that
 *     invariant by always calling recordInjectionEmitted immediately
 *     after appendInjection.
 *
 * Why the annotation is NOT an injection:
 *   The "+M más" is a count of paths the orchestrator should know
 *   about. If we emitted it as its own injection with no path, the
 *   defaultPredicateForKind would return null (no path to construct
 *   a path-absent predicate), the evaluator would skip it, and it
 *   would never resolve. That would leak advisories.
 *
 *   The correct shape: the "+M más" is a text annotation in the
 *   `reason` field of the LAST emitted event. The orchestrator sees
 *   it when it pulls `idu_pending_injections` and knows the cap
 *   bound. The annotation does not need to be tracked.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Injection } from "./injection-store.js";
import { recordInjectionEmitted } from "./cron-preflight.js";

/** Default cap for hygiene advisories alive at any time. */
export const DEFAULT_HYGIENE_CAP = 20;

/** Result of a hygiene emission tick. */
export type EmitHygieneInjectionsResult = {
	emitted: number;
	deduped: number;
	capped: number;
	annotation?: string;
};

/**
 * Enqueue a single hygiene injection for a finding. Appends the
 * injection to injections.jsonl and writes the `emitted` lifecycle
 * event with the path context (for the path-absent predicate).
 *
 * The invariant: every injection written here is immediately followed
 * by its emitted event. If this contract is broken, the obligation
 * test fails.
 */
export function enqueueHygieneInjection(input: {
	stateRoot: string;
	findingPath: string;
	pattern: string;
	now?: Date;
	annotation?: string;
}): { injectionId: string } {
	const now = input.now ?? new Date();
	const injectionId = `hyg-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
	const injection: Injection = {
		injectionId,
		kind: "hygiene_junk_file",
		triggerId: "hygiene_sensor",
		ts: now.toISOString(),
		decisionEnvelope: {
			severity: "info",
			summary: `Junk file matched pattern '${input.pattern}': ${input.findingPath}. Run \`idu-hygiene-sweep\` to clean up.`,
			options: ["sweep", "ack"],
			evidenceRefs: [`path:${input.findingPath}`],
			orchestratorDecisionRequired: false,
		},
		acked: false,
		meta: {
			path: input.findingPath,
			pattern: input.pattern,
		},
	};
	appendInjectionToFile(input.stateRoot, injection);
	// INVARIANT: emitted immediately after the injection is appended.
	// The path is included so the evaluator can construct the
	// path-absent predicate from the lifecycle log.
	recordInjectionEmitted({
		stateRoot: input.stateRoot,
		injectionId,
		kind: "hygiene_junk_file",
		reason: input.annotation,
		path: input.findingPath,
		now,
	});
	return { injectionId };
}

/**
 * Emit hygiene injections for the sensor's findings, with dedup and
 * cap. Returns counts for diagnostics.
 *
 * Algorithm:
 *   1. Count existing pending `hygiene_junk_file` injections → P.
 *   2. budget = cap - P.
 *   3. For each finding, if a pending injection already exists for
 *      that path, skip (dedup).
 *   4. If budget > 0, enqueue up to `budget` new injections.
 *   5. If findings.length > cap, annotate "+M más" in the last
 *      emission's reason.
 */
export function emitHygieneInjections(input: {
	stateRoot: string;
	findings: { path: string; pattern: string }[];
	cap?: number;
	now?: Date;
}): EmitHygieneInjectionsResult {
	const cap = input.cap ?? DEFAULT_HYGIENE_CAP;
	const now = input.now ?? new Date();

	// Step 1: count existing pending hygiene injections.
	const existing = readPendingHygienePaths(input.stateRoot);

	// Step 2: budget.
	const alreadyPending = existing.size;
	const budget = Math.max(0, cap - alreadyPending);

	// Pre-compute the annotation. The cap is over PENDING, so the count
	// of paths that will be over-cap is: total findings - (dedup hits
	// + budget). We do a first pass to count dedup so the annotation
	// is correct before we write any events.
	const dedupCount = input.findings.filter((f) => existing.has(f.path)).length;
	const overCap = input.findings.length - dedupCount - budget;
	const willAnnotate = overCap > 0;
	const annotation = willAnnotate
		? `+${overCap} más — corré \`idu-hygiene-sweep\``
		: undefined;

	let emitted = 0;
	let deduped = 0;
	let capped = 0;

	// Step 3-4: iterate, dedup, emit up to budget. The LAST emission
	// gets the annotation pre-computed (if any), so a single `emitted`
	// event per injectionId is enough — no follow-up rewrite needed.
	for (const finding of input.findings) {
		if (existing.has(finding.path)) {
			deduped++;
			continue;
		}
		if (emitted >= budget) {
			capped++;
			continue;
		}
		// If this is the LAST emission and we'll annotate, pass the
		// annotation through so it's on the first (and only) emitted
		// event for this injectionId.
		const isLastEmitted = emitted + 1 === budget && willAnnotate;
		enqueueHygieneInjection({
			stateRoot: input.stateRoot,
			findingPath: finding.path,
			pattern: finding.pattern,
			now,
			annotation: isLastEmitted ? annotation : undefined,
		});
		existing.add(finding.path);
		emitted++;
	}

	return { emitted, deduped, capped, annotation };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Read the set of paths that already have a pending hygiene injection. */
function readPendingHygienePaths(stateRoot: string): Set<string> {
	const out = new Set<string>();
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) return out;
	const raw = readFileSync(path, "utf8");
	if (!raw.trim()) return out;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as Injection;
			if (parsed.kind === "hygiene_junk_file" && parsed.acked === false) {
				const metaPath = parsed.meta?.path;
				if (typeof metaPath === "string") {
					out.add(metaPath);
				}
			}
		} catch {
			// skip malformed
		}
	}
	return out;
}

function appendInjectionToFile(stateRoot: string, injection: Injection): void {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf8");
	}
	appendFileSync(path, `${JSON.stringify(injection)}\n`, "utf8");
}
