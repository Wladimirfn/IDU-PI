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
//   (the current working directory). Each untracked file is checked against
//   (a) exact state-machine basenames and (b) state-machine extensions. No
//   substring matching: substring matches false-positive on legitimate
//   source files whose names happen to contain the token (e.g.
//   `src/role-engine-guard.ts` matched `role-engine` and made the guard a
//   paper tiger that would get loosened the first time it blocked real
//   work). The match is exact on the basename for the precise signal, and
//   extension-based for the *.db / *.sqlite families. A hit makes this
//   script exit 1 with a clear error message that names the leaked file.
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
//                                                   checking repo root..."
//                                                   and
//                                                   "[repo-root-leak-guard]
//                                                   no leaks"
//
// Exit codes:
//   0 — no leaks
//   1 — one or more state-machine files in the repo root
//   2 — could not run `git ls-files` (rare; e.g. not a git repo)

import { spawnSync } from "node:child_process";

// Exact basenames that are themselves state-machine output. Matched first
// (the more specific signal) so the error message names the leak precisely.
const EXACT_BASENAMES = new Set([
	"idu-session-state.json",
	"lab.db", // also caught by the EXTENSIONS check below; included here so the
	// error message can name it precisely if it ever appears untracked.
	"role-rails.json",
	"role-engine-config.json",
	"role-engine-status.json",
	"master-plan-cache.json",
	"lab-cache.json",
	"trigger-engine-config.json",
]);

// File extensions that always indicate state-machine output. A file's
// extension is the part after the LAST dot, lower-cased; so `foo.bar.db`
// has extension `db`, `foo.db-journal` has extension `db-journal`. The
// SQLite suffixes (sqlite, sqlite-journal, sqlite-shm, sqlite-wal) cover
// the same family in case the lab.db ever migrates to SQLite.
const EXTENSIONS = new Set([
	"db",
	"db-journal",
	"db-shm",
	"db-wal",
	"sqlite",
	"sqlite-journal",
	"sqlite-shm",
	"sqlite-wal",
]);

function basename(filepath) {
	const idx = Math.max(filepath.lastIndexOf("/"), filepath.lastIndexOf("\\"));
	return idx >= 0 ? filepath.slice(idx + 1) : filepath;
}

function extensionOf(basename) {
	const idx = basename.lastIndexOf(".");
	return idx >= 0 ? basename.slice(idx + 1).toLowerCase() : "";
}

function isStateMachine(basename) {
	if (EXACT_BASENAMES.has(basename)) return true;
	if (EXTENSIONS.has(extensionOf(basename))) return true;
	return false;
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
	isStateMachine(basename(filepath)),
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
