/**
 * hygiene-emission.test.ts — tests for the cron preflight's hygiene
 * emission path. Closes forward obligation #1 from PR #153 audit.
 *
 * The contract:
 *   1. The cron preflight must run the hygiene sensor against the
 *      project's repo and EMIT one `hygiene_junk_file` injection per
 *      finding, calling `recordInjectionEmitted` for each.
 *   2. Dedup: a path that already has a pending `hygiene_junk_file`
 *      injection is NOT re-emitted.
 *   3. Cap (over PENDING, not per-tick): maximum N advisories of
 *      `hygiene_junk_file` alive at any time. If findings.length > N
 *      (where N is the cap minus existing pending), the extras are
 *      noted as a text annotation in the last emission's content
 *      ("+M más — corré sweep"). The annotation is NOT a tracked
 *      injection (otherwise it would never resolve).
 *   4. The INVARIANT (the point of the obligation): for EVERY
 *      `hygiene_junk_file` injection in `injections.jsonl`, there
 *      MUST be a corresponding `emitted` event for that injectionId.
 *      If emission is forgotten, the cron still creates the injection
 *      but the invariant fails. This is the test that catches the
 *      bug class PR #153 audit identified.
 */

import assert from "node:assert/strict";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { runCronPreflight } from "../src/cron-preflight.js";
import { readInjectionLifecycle } from "../src/telemetry-lifecycle.js";
import type { PromptForRoleResult } from "../src/agent-router.js";
import type { CronPreflightInput } from "../src/cron-preflight.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixture(): { stateRoot: string; repoPath: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "hygiene-emit-state-"));
	const repoPath = mkdtempSync(join(tmpdir(), "hygiene-emit-repo-"));
	return {
		stateRoot,
		repoPath,
		cleanup: () => {
			rmSync(stateRoot, { recursive: true, force: true });
			rmSync(repoPath, { recursive: true, force: true });
		},
	};
}

function readInjections(stateRoot: string): Array<Record<string, unknown>> {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function readHygieneInjections(stateRoot: string): Array<Record<string, unknown>> {
	return readInjections(stateRoot).filter((i) => i.kind === "hygiene_junk_file");
}

function emittedFor(stateRoot: string, injectionId: string): boolean {
	const events = readInjectionLifecycle(stateRoot, injectionId);
	return events.some((e) => e.phase === "emitted");
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
// THE INVARIANT (the obligation itself)
// ---------------------------------------------------------------------------

test("INVARIANT: every hygiene_junk_file injection has a corresponding `emitted` event", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		// Seed some junk
		writeFileSync(join(repoPath, "tmp-debug.mjs"), "// debug");
		writeFileSync(join(repoPath, ".DS_Store"), "junk");

		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});

		// CRITICAL INVARIANT
		const injections = readHygieneInjections(stateRoot);
		assert.ok(
			injections.length >= 2,
			"cron should have emitted at least 2 hygiene injections (tmp-debug.mjs, .DS_Store)",
		);
		for (const inj of injections) {
			const id = inj.injectionId as string;
			assert.ok(
				emittedFor(stateRoot, id),
				`INVARIANT FAILED: hygiene injection ${id} has NO emitted event`,
			);
		}
	} finally {
		cleanup();
	}
});

test("POSITIVE: cron with seeded junk emits 1 injection per path + 1 emitted event", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		writeFileSync(join(repoPath, "tmp-debug.mjs"), "// debug");

		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});

		const injections = readHygieneInjections(stateRoot);
		assert.equal(injections.length, 1, "exactly 1 hygiene injection");
		const id = injections[0].injectionId as string;
		assert.ok(emittedFor(stateRoot, id), "emitted event written");
		// The injection carries the path in meta so the evaluator can
		// construct the path-absent predicate.
		const meta = injections[0].meta as { path?: string; pattern?: string } | undefined;
		assert.ok(meta?.path, "meta.path is set");
		assert.equal(meta.path, join(repoPath, "tmp-debug.mjs"));
		assert.ok(meta.pattern, "meta.pattern is set");
	} finally {
		cleanup();
	}
});

test("DEDUP: cron twice with same junk emits 1 injection per path (not 2)", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		writeFileSync(join(repoPath, "tmp-debug.mjs"), "// debug");
		writeFileSync(join(repoPath, ".DS_Store"), "junk");

		// First tick
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		const firstCount = readHygieneInjections(stateRoot).length;
		assert.equal(firstCount, 2, "first tick emits 2 injections");

		// Second tick with the same junk (no files removed)
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		const secondCount = readHygieneInjections(stateRoot).length;
		assert.equal(
			secondCount,
			2,
			"second tick with same junk does NOT re-emit (dedup)",
		);

		// And exactly 2 emitted events total (one per injectionId)
		for (const inj of readHygieneInjections(stateRoot)) {
			const id = inj.injectionId as string;
			assert.ok(
				emittedFor(stateRoot, id),
				`each injection has its emitted event (id=${id})`,
			);
		}
	} finally {
		cleanup();
	}
});

test("DEDUP-after-clean: cron after junk removed (and orchestrator pulled) resolves the original injection", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		writeFileSync(join(repoPath, "tmp-debug.mjs"), "// debug");
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		const firstCount = readHygieneInjections(stateRoot).length;
		assert.equal(firstCount, 1, "first tick: 1 injection");

		const id = readHygieneInjections(stateRoot)[0].injectionId as string;

		// Simulate the orchestrator pulling the advisory (writes a
		// `delivered` event). The evaluator only processes advisories
		// in `delivered` phase — that's the natural flow.
		recordLifecycleEventHygieneDelivered(stateRoot, id);

		// Remove the junk — the path-absent predicate should be satisfied
		rmSync(join(repoPath, "tmp-debug.mjs"));

		// Second tick: the evaluator sees the `delivered` advisory,
		// checks the path-absent predicate (the file is gone), writes
		// `resolved` + markInjectionAcked.
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		const secondCount = readHygieneInjections(stateRoot).length;
		// Still 1 (the original), but now it has been resolved.
		assert.equal(secondCount, 1, "still 1 injection (original, now resolved)");
		const events = readInjectionLifecycle(stateRoot, id);
		const resolved = events.find((e) => e.phase === "resolved");
		assert.ok(resolved, "injection was resolved by path-absent predicate");
	} finally {
		cleanup();
	}
});

function recordLifecycleEventHygieneDelivered(
	stateRoot: string,
	injectionId: string,
): void {
	// Read the path from the injection's meta so the evaluator can
	// construct the path-absent predicate from the delivered event.
	const inj = readHygieneInjections(stateRoot).find(
		(i) => i.injectionId === injectionId,
	);
	const meta = inj?.meta as { path?: string } | undefined;
	const path = join(stateRoot, "injection-telemetry.jsonl");
	const event = {
		injectionId,
		phase: "delivered",
		ts: new Date().toISOString(),
		kind: "hygiene_junk_file",
		reason: "idu_pending_injections",
		path: meta?.path,
	};
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf8");
	}
	appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// CAP (over PENDING, not per-tick)
// ---------------------------------------------------------------------------

test("CAP: 501 findings → exactly 20 pending + annotation in last emission's content", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		// Seed 501 junk files
		for (let i = 0; i < 501; i++) {
			writeFileSync(
				join(repoPath, `tmp-${String(i).padStart(4, "0")}.mjs`),
				`// ${i}`,
			);
		}

		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});

		const injections = readHygieneInjections(stateRoot);
		assert.equal(
			injections.length,
			20,
			"cap: exactly 20 pending hygiene injections (N=20 default)",
		);

		// The annotation "+481 más — corré sweep" must appear in the
		// reason of the last emitted event.
		const hygieneInjections = readHygieneInjections(stateRoot);
		const lastId = hygieneInjections[hygieneInjections.length - 1]
			.injectionId as string;
		const lastEvents = readInjectionLifecycle(stateRoot, lastId);
		const lastEmitted = lastEvents.find((e) => e.phase === "emitted");
		assert.ok(lastEmitted, "last emitted event exists");
		const reason = lastEmitted.reason ?? "";
		assert.ok(
			reason.includes("+481") || reason.includes("+ 481"),
			`last emission must include '+481' annotation, got: ${reason}`,
		);
	} finally {
		cleanup();
	}
});

test("CAP: state is stable across ticks — second tick does not re-emit", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		for (let i = 0; i < 501; i++) {
			writeFileSync(
				join(repoPath, `tmp-${String(i).padStart(4, "0")}.mjs`),
				`// ${i}`,
			);
		}

		// First tick: emits 20, annotation says +481
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		assert.equal(readHygieneInjections(stateRoot).length, 20);

		// Second tick: nothing changed → still 20, no new emissions
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		assert.equal(
			readHygieneInjections(stateRoot).length,
			20,
			"second tick: still 20 (dedup, no new emissions)",
		);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Custom cap (per blueprint, N=20 configurable)
// ---------------------------------------------------------------------------

test("CAP: custom cap (N=5) limits to 5 pending", async () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		for (let i = 0; i < 10; i++) {
			writeFileSync(join(repoPath, `tmp-${i}.mjs`), `// ${i}`);
		}
		// The cron preflight takes an optional `hygieneCap` parameter.
		await runCronPreflight({
			projectPath: repoPath,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
			hygieneCap: 5,
		} as CronPreflightInput);
		const injections = readHygieneInjections(stateRoot);
		assert.equal(injections.length, 5, "custom cap N=5 honored");
	} finally {
		cleanup();
	}
});
