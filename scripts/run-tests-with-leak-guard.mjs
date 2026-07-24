#!/usr/bin/env node
// scripts/run-tests-with-leak-guard.mjs
//
// Wrapper that runs the test suite once, measures the temp-dir delta in
// $TMPDIR around it, and exits non-zero on regression.
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
//   This wrapper counts around the whole `node --test` invocation, so the
//   delta is the actual cross-process count of leaked temp dirs produced
//   by the full suite run. It also catches temp dirs that the suite's
//   spawned child processes (e.g. CLI smoke tests) create, which an
//   in-process helper could never see.
//
// Usage:
//   node scripts/run-tests-with-leak-guard.mjs
//   LEAK_GUARD_THRESHOLD=5 node scripts/run-tests-with-leak-guard.mjs
//
// The threshold env var lets CI tolerate a small number of "expected"
// leaks during a partial migration. Default is 0 (any leak fails the gate).

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const TRACKED_PREFIXES = [
	"idu-",
	"agentlab-",
	"agentlab-review-",
	"bibliotecario-",
	// Add more repo-specific prefixes here as the migration discovers them.
];

function countTrackedInTmpdir() {
	let count = 0;
	let entries;
	try {
		entries = readdirSync(tmpdir());
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (TRACKED_PREFIXES.some((p) => entry.startsWith(p))) count++;
	}
	return count;
}

const THRESHOLD = parseInt(process.env.LEAK_GUARD_THRESHOLD ?? "0", 10);
const TEST_GLOB =
	process.env.LEAK_GUARD_TEST_GLOB ??
	"dist/test/*.test.js dist/test/**/*.test.js";

const before = countTrackedInTmpdir();
console.log(
	`[leak-guard] tracked-prefix entries in ${tmpdir()} before suite: ${before}`,
);

const result = spawnSync(
	process.execPath,
	["--test", ...TEST_GLOB.split(" ")],
	{
		stdio: "inherit",
	},
);
const suiteFailed = result.status !== 0;

const after = countTrackedInTmpdir();
const delta = after - before;
console.log(
	`[leak-guard] tracked-prefix entries after suite: ${after} (delta ${
		delta >= 0 ? "+" : ""
	}${delta})`,
);

if (suiteFailed) {
	console.error(
		`[leak-guard] suite failed with status ${
			result.status ?? 1
		}; skipping leak assertion (the suite already failed).`,
	);
	process.exit(result.status ?? 1);
}

if (delta > THRESHOLD) {
	console.error(
		`[leak-guard] LEAK DETECTED: ${delta} new entries in ${tmpdir()} matching tracked prefixes (threshold ${THRESHOLD}).`,
	);
	console.error(
		`[leak-guard] Inspect recent test changes; new mkdtemp calls must go through test/helpers/temp.ts.`,
	);
	process.exit(1);
}

process.exit(0);
