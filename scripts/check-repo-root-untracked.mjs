#!/usr/bin/env node
// scripts/check-repo-root-untracked.mjs
//
// Repo-root untracked-leak guard for the test pipeline.
//
// Why this exists:
//   The session-store, lab-db, and role-engine state machines all write to a
//   per-project stateRoot. When tests exercise the "no stateRoot" branch with
//   the empty-string sentinel, a silent fallback to `process.cwd()` (the repo
//   root) used to deposit stray state-machine files there. The legacy path
//   `<repo>/reports/idu-session-state.json` was gitignored by .gitignore:31,
//   so the leak hid for years; after #471 the path changed to
//   `<repo>/idu-session-state.json`, which is NOT gitignored and therefore
//   shows up in `git status --porcelain -uall`.
//
// What this does:
//   Runs `git ls-files --others --exclude-standard` against the repo root
//   (the current working directory). Any output line whose basename matches a
//   state-machine pattern (idu-session-state, lab.db*, role-rails, role-engine,
//   master-plan-cache, lab-cache, *.db, *.db-journal, *.db-shm, *.db-wal,
//   *.sqlite, *.sqlite-journal, *.sqlite-shm, *.sqlite-wal) makes this script
//   exit 1 with a clear error message that names the leaked file.
//
// Why `git ls-files --others --exclude-standard` (not `git status --porcelain`):
//   - `ls-files` is the exact, deterministic set of files git would add on the
//     next `git add`. It is the "would this leak into a commit?" check.
//   - `status --porcelain` is noisier (it includes tracked-but-modified files
//     when they live in untracked paths) and conflates the leak signal with
//     unrelated working-tree state.
//
// Race safety:
//   This guard runs AFTER `node --test`. node:test spawns each test file in
//   its own child process and waits for all children to exit before returning
//   to the parent shell, so by the time this script runs every test has
//   finished and any state write that happened in a test has already hit
//   disk.
//
// Usage (wired into `pnpm test:guarded`):
//   1. tsc -p tsconfig.json
//   2. node scripts/copy-migrations.mjs
//   3. node scripts/run-tests-with-leak-guard.mjs   ← spawns this script
//                                                   after the $TMPDIR leak
//                                                   assertion, with the
//                                                   log lines
//                                                   "[repo-root-leak-guard]
//                                                   checking repo root…"
//                                                   and
//                                                   "[repo-root-leak-guard]
//                                                   no leaks"
//
// Exit codes:
//   0 — no leaks
//   1 — one or more state-machine files in the repo root
//   2 — could not run `git ls-files` (rare; e.g. not a git repo)

import { spawnSync } from "node:child_process";

// Filename patterns that indicate a state-machine leak into the repo root.
// Each entry is matched against the basename of every untracked file via
// `String.prototype.includes` (substring) or a regex (anchored).
const SUBSTRING_PATTERNS = [
	"idu-session-state",
	"lab.db", // also catches lab.db-journal / lab.db-shm / lab.db-wal via substring
	"role-rails",
	"role-engine",
	"master-plan-cache",
	"lab-cache",
];

const REGEX_PATTERNS = [
	/\.db$/u,
	/\.db-journal$/u,
	/\.db-shm$/u,
	/\.db-wal$/u,
	/\.sqlite$/u,
	/\.sqlite-journal$/u,
	/\.sqlite-shm$/u,
	/\.sqlite-wal$/u,
];

function matchesStateMachinePattern(basename) {
	for (const needle of SUBSTRING_PATTERNS) {
		if (basename.includes(needle)) return true;
	}
	for (const re of REGEX_PATTERNS) {
		if (re.test(basename)) return true;
	}
	return false;
}

function basename(filepath) {
	const idx = Math.max(filepath.lastIndexOf("/"), filepath.lastIndexOf("\\"));
	return idx >= 0 ? filepath.slice(idx + 1) : filepath;
}

const git = spawnSync(
	"git",
	["ls-files", "--others", "--exclude-standard"],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

if (git.error) {
	console.error(
		`[repo-leak-guard] could not run git: ${git.error.message}`,
	);
	process.exit(2);
}
if (git.status !== 0) {
	console.error(
		`[repo-leak-guard] git ls-files failed with status ${git.status}:`,
	);
	if (git.stderr) console.error(git.stderr);
	process.exit(2);
}

const untracked = git.stdout.split(/\r?\n/u).filter((line) => line.length > 0);

const leaks = untracked.filter((filepath) =>
	matchesStateMachinePattern(basename(filepath)),
);

if (leaks.length === 0) {
	process.exit(0);
}

console.error(
	"[repo-leak-guard] LEAK DETECTED: untracked state-machine files in repo root:",
);
for (const leak of leaks) {
	console.error(`  ${leak}`);
}
console.error(
	"Inspect the recent test changes; new state writes must go through a tempDir.",
);
process.exit(1);
