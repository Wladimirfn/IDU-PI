// test/helpers/temp.ts
//
// Tracked-temp-dir helper for the test suite. Replaces direct
// `mkdtempSync(join(tmpdir(), prefix))` calls so failed tests cannot leak
// temp directories. See PR0 of the temp-leak saga (issue TBD) for context.
//
// node:test runs each test file in its own process by default, so the
// `tracked` Set is per-file (not global). The exit sweep and the
// afterEach cleanup both run inside that process. The
// scripts/run-tests-with-leak-guard.mjs wrapper measures the suite-wide
// delta in tmpdir() across the full run, which is the only reliable check
// because the cross-file view is not visible from in-process state.

import { mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

/**
 * Report a cleanup failure to stderr with the errno code. The code
 * distinguishes the two failure classes:
 *
 * - ENOTEMPTY — something recreated content (fire-and-forget write after
 *   teardown, the #342 shape).
 * - EBUSY — handle still open (OS/timing issue).
 *
 * Warns (does not throw) because the leak guard is the enforcement layer;
 * this function is diagnosis. The `[temp-cleanup]` prefix cross-references
 * with `[leak-guard]` entry names in CI logs (issue #346).
 *
 * Reports each dir at most once per context. A dir that fails to unlink stays
 * in `tracked`, so every later afterEach retries it — without this guard one
 * stuck directory would emit one line per remaining test in the file (77 in
 * test/idu-cli.test.ts), making a single failure look like dozens.
 */
const reportedCleanupFailures = new Set<string>();

function reportCleanupError(
	dir: string,
	error: unknown,
	context: string,
): void {
	const key = `${context}:${dir}`;
	if (reportedCleanupFailures.has(key)) return;
	reportedCleanupFailures.add(key);
	const code = (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
	process.stderr.write(`[temp-cleanup] ${context} ${code}: ${dir}\n`);
}

/**
 * Tracks every temp directory created via makeTempDir so they can be cleaned
 * up automatically. The set is process-wide for the duration of the test
 * file that imported this module.
 */
const tracked = new Set<string>();
let exitSweepInstalled = false;

function installExitSweep(): void {
	if (exitSweepInstalled) return;
	exitSweepInstalled = true;
	// Last-resort safety net: if a test killed the process before afterEach
	// ran (e.g. SIGKILL), this still cleans what we tracked. EBUSY survivors
	// stay in `tracked`; we re-attempt on the next exit (rare in practice).
	process.on("exit", () => {
		for (const dir of tracked) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch (error) {
				reportCleanupError(dir, error, "exit-sweep");
			}
		}
	});
}

/**
 * Create a tracked temp directory. The directory is registered for automatic
 * cleanup at the end of every test AND on process exit. Replaces direct
 * `mkdtempSync(join(tmpdir(), prefix))` calls so failures cannot leak temp
 * files.
 */
export function makeTempDir(prefix: string): string {
	installExitSweep();
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tracked.add(dir);
	return dir;
}

/**
 * Auto-cleanup after every test in this process. node:test only registers
 * the afterEach for the file that imported this module; each test file
 * runs in its own process so the Set is per-process.
 *
 * Uses async `rm()` rather than sync `rmSync()`. On Windows, a sync remove
 * called immediately after a test's own synchronous fs writes (e.g. a
 * StructuredTaskQueue's writeFileSync calls) hits transient EBUSY far more
 * often than an async remove: dispatching through libuv's thread pool adds
 * just enough scheduling delay for the OS to finish releasing the handle.
 * Measured on this repo: sync cleanup for idu-supervisor-hooks.test.ts
 * leaked in ~50% of runs; switching this hook to async rm() reproduced 0
 * leaks across repeated runs (matching the pre-migration `await rm()`
 * behavior this hook replaces).
 *
 * Successful removes delete from `tracked` so the exit sweep does not
 * re-run them. EBUSY survivors stay in the set for the exit sweep to retry.
 */
test.afterEach(async () => {
	for (const dir of tracked) {
		try {
			await rm(dir, { recursive: true, force: true });
			tracked.delete(dir);
		} catch (error) {
			reportCleanupError(dir, error, "afterEach");
		}
	}
});
