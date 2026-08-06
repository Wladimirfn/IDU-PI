#!/usr/bin/env node
// scripts/run-tests-with-leak-guard.mjs
//
// Wrapper that runs the test suite once, snapshots the set of entries in
// $TMPDIR before and after, computes the set difference, and exits non-zero
// when the new entries exceed the threshold.
//
// Why a wrapper, not a meta-test:
//   The repo's test suite runs via `node --test dist/test/*.test.js ...`.
//   node:test spawns each test file in its own child process, in parallel.
//   An in-process meta-test that takes a baseline count, runs the rest of
//   the suite inline, and asserts the count afterwards is structurally
//   broken: (a) the meta-test's own file finishes before any other file
//   starts, so its "after" sample is microseconds after "before" and the
//   delta is always zero; (b) the other files run in parallel, so they
//   may write between the two samples and flake the gate randomly.
//
// Why set-difference, not an allowlist of prefixes:
//   The repo has 296+ unique mkdtempSync prefixes across 354 call sites.
//   An allowlist (the previous design) covered ~62% of the universe and was
//   blind to the rest — and gets stale the day someone writes a new test
//   with a fresh prefix. Set-difference captures 100% of the suite's
//   temp-dir output without any per-prefix knowledge.
//
//   The external noise in $TMPDIR is small (~3 unrelated entries on a
//   typical Windows box: Docker updater, VSCode setup, GUID-style files).
//   We filter those out with a small denylist of well-known non-test
//   patterns, not an allowlist.
//
// Usage:
//   node scripts/run-tests-with-leak-guard.mjs
//   LEAK_GUARD_THRESHOLD=5 node scripts/run-tests-with-leak-guard.mjs
//   LEAK_GUARD_DENYLIST_REGEX='^(vscode-|docker-)' node ...  (optional override)
//
// The threshold env var lets CI tolerate a small number of "expected"
// leaks during a partial migration. Default is 0 (any leak fails the gate).
//
// Guard ordering:
//   The wrapper runs three independent checks and reports ALL of them on
//   every run, regardless of which (if any) fail:
//     1. Suite — node --test spawns each file in its own process, in parallel.
//     2. $TMPDIR leak — set-difference of tmpdir entries before/after.
//     3. Repo-root untracked-leak — scripts/check-repo-root-untracked.mjs.
//
//   The repo-root guard runs AFTER `node --test` has returned AND AFTER the
//   $TMPDIR snapshot/compare, REGARDLESS of either outcome. The two leak
//   guards are independent surfaces (different directories, different
//   checks): a $TMPDIR leak must not hide a repo-root leak from the
//   operator or from CI, and vice versa. Both guards ALWAYS run.
//
//   The final exit code is the worst of the three outcomes (suite status,
//   $TMPDIR threshold breach, repo-root status), so a single failing guard
//   cannot mask another.

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const DENYLIST_PATTERNS = [
	// Docker Desktop updater leaves these around.
	/^docker/i,
	/^DockerDesktop/i,
	// VSCode installer / updater.
	/^vscode-/i,
	/^CodeSetup-/i,
	// Windows Setup / installer logs.
	/^Setup Log/i,
	// System-level GUID-style temp files (rare, but seen on some Windows boxes).
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i,
];

// Optional override: user can supply their own denylist regex via env.
// Use this to add project-specific noise patterns without editing this file.
const denylistFromEnv = process.env.LEAK_GUARD_DENYLIST_REGEX;
const extraDenylist = denylistFromEnv ? [new RegExp(denylistFromEnv)] : [];
const allDenylist = [...DENYLIST_PATTERNS, ...extraDenylist];

function isNoise(entry) {
	return allDenylist.some((re) => re.test(entry));
}

function snapshotTmpdir() {
	const set = new Set();
	let entries;
	try {
		entries = readdirSync(tmpdir());
	} catch {
		return set;
	}
	for (const entry of entries) isNoise(entry) ? null : set.add(entry);
	return set;
}

const THRESHOLD = parseInt(process.env.LEAK_GUARD_THRESHOLD ?? "0", 10);
const TEST_GLOB =
	process.env.LEAK_GUARD_TEST_GLOB ??
	"dist/test/*.test.js dist/test/**/*.test.js";

const before = snapshotTmpdir();
console.log(`[leak-guard] entries in ${tmpdir()} before suite: ${before.size}`);

const result = spawnSync(
	process.execPath,
	["--test", ...TEST_GLOB.split(" ")],
	{ stdio: "inherit" },
);
const suiteFailed = result.status !== 0;
const suiteExitCode = result.status ?? 1;

const after = snapshotTmpdir();
const newEntries = [...after].filter((e) => !before.has(e));
const removedEntries = [...before].filter((e) => !after.has(e));
// We use the absolute count of new entries, not net delta. The current
// suite (pre-migration) does not clean previously-leaked temp dirs from
// older runs, so `removed` is always 0; a net-delta formula would silently
// cancel new leaks against unrelated cleanup and produce false negatives.
const delta = newEntries.length;

console.log(
	`[leak-guard] entries after suite: ${after.size} (new ${newEntries.length}, removed ${removedEntries.length})`,
);

if (suiteFailed) {
	console.error(
		`[leak-guard] suite failed with status ${suiteExitCode}; leak guards still running below.`,
	);
}

let tmpdirExitCode = 0;
if (delta > THRESHOLD) {
	console.error(
		`[leak-guard] LEAK DETECTED: ${delta} new entries in ${tmpdir()} (threshold ${THRESHOLD}).`,
	);
	console.error(`[leak-guard] All ${newEntries.length} new entries:`);
	for (const e of newEntries) console.error(`  ${e}`);
	console.error(
		`[leak-guard] Inspect recent test changes; new mkdtemp calls must go through test/helpers/temp.ts.`,
	);
	tmpdirExitCode = 1;
} else if (newEntries.length > 0 && process.env.LEAK_GUARD_VERBOSE !== "0") {
	// When the guard passes but there are new entries, log their names so the
	// migration campaign has a directed map instead of blind churn. Set
	// LEAK_GUARD_VERBOSE=0 to suppress.
	console.log(
		`[leak-guard] ${newEntries.length} new entries (names for migration targeting):`,
	);
	for (const e of newEntries) console.log(`  ${e}`);
}

// Repo-root untracked-leak guard. Runs AFTER the suite has returned AND
// AFTER the $TMPDIR snapshot/compare, REGARDLESS of either outcome. The
// two leak guards are independent surfaces (different directories,
// different checks): a $TMPDIR leak must not hide a repo-root leak from
// the operator or from CI. node:test spawns each test file in its own
// child process and waits for all children to exit before returning, so
// by the time this guard runs every test has finished and any state write
// has hit disk (see the race-safety claim in
// scripts/check-repo-root-untracked.mjs lines 31-36).
//
// Spawned as a separate process so the guard's own argv, stderr, and exit
// codes stay self-contained — no risk of accidentally catching the
// wrapper's own temp-dir noise.
console.log(
	"[repo-root-leak-guard] checking repo root for untracked state-machine files...",
);
const repoRootGuard = spawnSync(
	process.execPath,
	[join(SCRIPT_DIR, "check-repo-root-untracked.mjs")],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const repoRootExitCode = repoRootGuard.status ?? 1;
if (repoRootExitCode !== 0) {
	if (repoRootGuard.stderr) process.stderr.write(repoRootGuard.stderr);
} else {
	console.log("[repo-root-leak-guard] no leaks");
}

// Final exit code: worst of (suite, $TMPDIR, repo-root). Each guard is an
// independent surface; a single failing guard must not mask another.
const exitCode = Math.max(
	suiteFailed ? suiteExitCode : 0,
	tmpdirExitCode,
	repoRootExitCode,
);

process.exit(exitCode);
