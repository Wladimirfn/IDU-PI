/**
 * injection-store-write-coupling.test.ts — A.1 acceptance tests.
 *
 * The core invariant post-A.1: it is structurally impossible to append
 * an injection without emitting a corresponding `emitted` event. Every
 * write path goes through the central `appendInjection` in
 * `src/injection-store.ts`, which calls `recordInjectionEmitted`
 * internally. No caller emits manually.
 *
 * These tests pin the invariant from four angles:
 *   1. POSITIVE: appendInjection auto-emits (1 event per write).
 *   2. kind default: envelopes without `kind` → emitted with kind="unknown".
 *   3. NO DOUBLE-EMIT: previously-manual paths now produce exactly 1
 *      event (catches a regression where Step 3 was skipped).
 *   4. EX-BYPASS SITES: every emission surface emits (catches a
 *      regression where Step 4 was skipped and a callsite still uses
 *      a local `appendInjectionToFile` helper).
 *
 * References issue #184.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync as fsWriteFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { appendInjection, type Injection } from "../src/injection-store.js";
import { enqueueHygieneInjection } from "../src/hygiene-injection.js";
import { enqueueObjectiveReminder } from "../src/objective-injection.js";
import { runCronPreflight } from "../src/cron-preflight.js";
import type { PromptForRoleResult } from "../src/agent-router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-a1-coupling-"));
	roots.push(root);
	return root;
}

after(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function readTelemetry(stateRoot: string): Array<Record<string, unknown>> {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function countEmittedFor(
	stateRoot: string,
	injectionId: string,
): number {
	return readTelemetry(stateRoot).filter(
		(e) => e.injectionId === injectionId && e.phase === "emitted",
	).length;
}

function makeEnvelope(overrides: Partial<Injection> = {}): Injection {
	return {
		ts: "2026-06-26T10:00:00.000Z",
		triggerId: "a1_test",
		decisionEnvelope: {
			severity: "info",
			summary: "A.1 test envelope",
			options: ["ack"],
			evidenceRefs: [],
			orchestratorDecisionRequired: false,
		},
		injectionId: "a1-test-injection-1",
		acked: false,
		...overrides,
	};
}

const successPrompt = (
	output = "",
): ((
	_role: string,
	_message: string,
	_options: unknown,
) => Promise<PromptForRoleResult>) => {
	return async (
		_role: string,
		_message: string,
		_options: unknown,
	): Promise<PromptForRoleResult> => ({
		ok: true,
		output,
		provider: "test-provider",
		model: "test-model",
		role: "agentlab-ui-ux" as never,
	});
};

// ---------------------------------------------------------------------------
// Test 1 — POSITIVE: appendInjection auto-emits
// ---------------------------------------------------------------------------

test("A.1 write coupling: appendInjection auto-emits exactly one `emitted` event per write", () => {
	const root = freshRoot();
	const envelope = makeEnvelope({
		injectionId: "a1-test-emits-1",
		kind: "test_kind",
	});
	appendInjection(root, envelope);

	const events = readTelemetry(root);
	const emitted = events.filter(
		(e) =>
			e.injectionId === "a1-test-emits-1" && e.phase === "emitted",
	);
	assert.equal(emitted.length, 1, "exactly 1 emitted event per appendInjection");
	assert.equal(emitted[0].kind, "test_kind", "kind forwarded from envelope");
	assert.equal(
		emitted[0].injectionId,
		"a1-test-emits-1",
		"injectionId forwarded from envelope",
	);
});

// ---------------------------------------------------------------------------
// Test 2 — kind default: undefined → "unknown"
// ---------------------------------------------------------------------------

test("A.1 kind default: envelope without `kind` emits with kind=`unknown`", () => {
	const root = freshRoot();
	const envelope: Injection = makeEnvelope({
		injectionId: "a1-test-no-kind",
		// kind omitted on purpose (matches the legacy callers that
		// do not set it — see Injection.kind?: string comment).
	});
	delete (envelope as { kind?: string }).kind;
	appendInjection(root, envelope);

	const events = readTelemetry(root);
	const emitted = events.filter(
		(e) =>
			e.injectionId === "a1-test-no-kind" && e.phase === "emitted",
	);
	assert.equal(emitted.length, 1, "exactly 1 emitted event");
	assert.equal(emitted[0].kind, "unknown", "default kind is 'unknown'");
});

// ---------------------------------------------------------------------------
// Test 3 — NO DOUBLE-EMIT: previously-manual paths now emit exactly once
// ---------------------------------------------------------------------------

test("A.1 no-double-emit: runCronPreflight produces exactly 1 emitted event per cron-side injection", async () => {
	const root = freshRoot();
	const repoPath = mkdtempSync(join(tmpdir(), "a1-repo-"));
	roots.push(repoPath);

	// Seed junk so hygiene emission has something to do
	fsWriteFileSync(join(repoPath, "tmp-debug-a1.mjs"), "// debug");

	// No prior objective reminder state → Case 4 fresh → 1 injection
	await runCronPreflight({
		projectPath: repoPath,
		stateRoot: root,
		changedFiles: [],
		promptForRole: successPrompt(),
		now: new Date("2026-06-26T10:00:00Z"),
	});

	const injectionsFile = join(root, "injections.jsonl");
	const injections = readFileSync(injectionsFile, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as { injectionId: string });
	assert.ok(
		injections.length >= 2,
		"cron must have produced objective_reminder + hygiene_junk_file (>= 2 injections)",
	);

	for (const inj of injections) {
		const count = countEmittedFor(root, inj.injectionId);
		assert.equal(
			count,
			1,
			`injection ${inj.injectionId} must have exactly 1 emitted event (got ${count})`,
		);
	}
});

test("A.1 no-double-emit: enqueueObjectiveReminder produces exactly 1 emitted event", () => {
	const root = freshRoot();
	const result = enqueueObjectiveReminder({
		stateRoot: root,
		planObjective: "test objective",
		now: new Date("2026-06-26T10:00:00Z"),
	});
	assert.equal(result.reason, "fresh", "first call → fresh");
	assert.ok(result.injectionId, "fresh must produce an injectionId");
	const count = countEmittedFor(root, result.injectionId!);
	assert.equal(
		count,
		1,
		`fresh reminder must have exactly 1 emitted event (got ${count})`,
	);
});

// ---------------------------------------------------------------------------
// Test 4 — EX-BYPASS SITES: every emission surface emits
// ---------------------------------------------------------------------------

test("A.1 ex-bypass sites: every emission surface produces exactly 1 emitted event", () => {
	const root = freshRoot();

	// 1. Direct appendInjection (test_kind) — used by digest, trigger-engine,
	//    cli/alerts/helpers. The central writer auto-emits.
	const directId = "a1-direct-append-1";
	appendInjection(
		root,
		makeEnvelope({ injectionId: directId, kind: "test_kind" }),
	);
	assert.equal(
		countEmittedFor(root, directId),
		1,
		"direct appendInjection emits exactly 1",
	);

	// 2. enqueueObjectiveReminder — used to bypass via local
	//    appendInjectionToFile. After A.1, routes through central.
	const objResult = enqueueObjectiveReminder({
		stateRoot: root,
		planObjective: "test objective for ex-bypass",
		now: new Date("2026-06-26T10:00:00Z"),
	});
	assert.ok(objResult.injectionId, "objective reminder must enqueue");
	assert.equal(
		countEmittedFor(root, objResult.injectionId!),
		1,
		"objective reminder emits exactly 1 (ex-bypass site fixed)",
	);

	// 3. enqueueHygieneInjection — used to bypass via local
	//    appendInjectionToFile. After A.1, routes through central.
	const a = enqueueHygieneInjection({
		stateRoot: root,
		findingPath: "/tmp/junk-a.mjs",
		pattern: "tmp-*.mjs",
		now: new Date("2026-06-26T10:00:00Z"),
	});
	const b = enqueueHygieneInjection({
		stateRoot: root,
		findingPath: "/tmp/junk-b.mjs",
		pattern: "tmp-*.mjs",
		now: new Date("2026-06-26T10:00:00Z"),
	});
	assert.equal(countEmittedFor(root, a.injectionId), 1, "hygiene a: 1 emitted");
	assert.equal(countEmittedFor(root, b.injectionId), 1, "hygiene b: 1 emitted");
	const hygieneEvents = readTelemetry(root).filter(
		(e) => e.kind === "hygiene_junk_file" && e.phase === "emitted",
	);
	assert.equal(
		hygieneEvents.length,
		2,
		"hygiene emission produces exactly 1 emitted event per injection (ex-bypass site fixed)",
	);
});

// ---------------------------------------------------------------------------
// Bonus: telemetry log is non-empty for the appended injection, sanity check
// ---------------------------------------------------------------------------

test("A.1 telemetry log shape: emitted events have injectionId + phase + kind", () => {
	const root = freshRoot();
	appendInjection(
		root,
		makeEnvelope({
			injectionId: "a1-shape-check",
			kind: "shape_test",
		}),
	);
	const events = readTelemetry(root);
	assert.equal(events.length, 1);
	const e = events[0];
	assert.equal(typeof e.injectionId, "string");
	assert.equal(typeof e.phase, "string");
	assert.equal(typeof e.kind, "string");
	assert.equal(typeof e.ts, "string");
});
