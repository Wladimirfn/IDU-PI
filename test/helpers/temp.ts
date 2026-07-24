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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

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
			} catch {
				// best-effort; ignore EBUSY on Windows during shutdown
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
 * Eagerly remove a tracked temp dir. Mostly for tests that want to free disk
 * space during a long suite; the afterEach sweep would clean them anyway.
 *
 * On EBUSY (Windows file lock), the dir stays in `tracked` so the exit
 * sweep retries it.
 */
export function cleanupTempDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
		tracked.delete(dir);
	} catch {
		// keep in set; sweep will retry on exit
	}
}

/**
 * Count of currently tracked (un-cleaned) temp dirs. Exported for diagnostics
 * and the script-level leak guard wrapper.
 */
export function getTrackedTempDirCount(): number {
	return tracked.size;
}

/**
 * Auto-cleanup after every test in this process. node:test only registers
 * the afterEach for the file that imported this module; each test file
 * runs in its own process so the Set is per-process.
 *
 * Successful removes delete from `tracked` so the exit sweep does not
 * re-run them. EBUSY survivors stay in the set for the exit sweep to retry.
 */
test.afterEach(() => {
	for (const dir of tracked) {
		try {
			rmSync(dir, { recursive: true, force: true });
			tracked.delete(dir);
		} catch {
			// keep in set; exit sweep will retry
		}
	}
});
