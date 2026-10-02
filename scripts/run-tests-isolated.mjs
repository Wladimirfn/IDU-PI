#!/usr/bin/env node
/**
 * Runs the test suite against a throwaway IDU_HOME.
 *
 * Why this exists: idu-pi keeps its decision ledger, quota cache, session tree,
 * locks and logs under `~/.idu`. Several tests exercise code that writes there,
 * so a plain `node --test` wrote into the developer's real ledger on every run.
 * That is not hypothetical: seven `test-proj` entries had accumulated in a real
 * `decision_ledger.json`, one per run, and each carried the next id so the
 * numbering never showed the gap.
 *
 * This is the same pattern `Sistema_de_mantencion-RCM` uses for the mirror-image
 * problem, where the tests were writing to a production database and had to be
 * switched off entirely with an opt-in flag. Here the state is cheap and
 * disposable, so isolation is on by default instead.
 *
 * It is a wrapper rather than a shell line because setting an environment
 * variable per-command is not portable to Windows, which is where this runs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(repoRoot, "dist", "test");

if (!existsSync(testDir)) {
	console.error(`No compiled tests at ${testDir}. Run the TypeScript build first.`);
	process.exit(1);
}

// Listed explicitly rather than globbed: a shell glob is not portable to
// Windows, and handing node the file list keeps the command identical on both.
const files = readdirSync(testDir)
	.filter((name) => name.endsWith(".test.js"))
	.sort()
	.map((name) => join(testDir, name));

if (files.length === 0) {
	console.error(`No *.test.js files in ${testDir}.`);
	process.exit(1);
}

const isolatedHome = mkdtempSync(join(tmpdir(), "idu-test-home-"));

try {
	const res = spawnSync(process.execPath, ["--test", ...files], {
		stdio: "inherit",
		env: { ...process.env, IDU_HOME: isolatedHome },
	});
	process.exit(res.status === null ? 1 : res.status);
} finally {
	try {
		rmSync(isolatedHome, { recursive: true, force: true });
	} catch {
		// A temp directory left behind is a nuisance, not a failure.
	}
}
