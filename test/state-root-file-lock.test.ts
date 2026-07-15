import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
	acquireExclusiveFileLock,
	acquireMaintenanceLock,
	cleanupStaleLockfiles,
	deriveMaintenanceEndpoint,
	releaseExclusiveFileLock,
	resolveLockTimeoutMs,
} from "../src/state-root-file-lock.js";
import * as lockModule from "../src/state-root-file-lock.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const LOCK_SRC_PATH = join(REPO_ROOT, "src", "state-root-file-lock.ts");

function tempDir(prefix = "idu-lock-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read mtimeMs and ctimeMs for a path.  Used to prove the lockfile is
 * byte-for-byte untouched (no rename-aside, no recreate, no overwrite).
 */
function timestamps(path: string): { mtimeMs: number; ctimeMs: number; size: number } {
	const stat = statSync(path);
	return { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size };
}

// ---------------------------------------------------------------------------
// Task 1.1 — Acquire on free path
// ---------------------------------------------------------------------------

test("acquire on free path returns ok with parseable {pid, startedAt, token, host}", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 1000,
			pollMs: 25,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;

		const expectedLockPath = `${targetPath}.lock`;
		assert.equal(result.lockPath, expectedLockPath);
		assert.equal(typeof result.token, "string");
		assert.ok(result.token.length > 0);

		const lockData = JSON.parse(
			readFileSync(result.lockPath, "utf8"),
		) as Record<string, unknown>;
		assert.equal(lockData.pid, process.pid);
		assert.equal(typeof lockData.startedAt, "string");
		assert.ok((lockData.startedAt as string).length > 0);
		assert.equal(lockData.token, result.token);
		assert.equal(lockData.host, hostname());

		await releaseExclusiveFileLock({
			lockPath: result.lockPath,
			token: result.token,
		});
		assert.equal(existsSync(result.lockPath), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.2 — Concurrent acquirers serialize (exactly one ok, one LOCK_TIMEOUT)
// ---------------------------------------------------------------------------

test("concurrent acquirers on same path: exactly one ok, other LOCK_TIMEOUT, no silent overwrite", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");

		const results = await Promise.all([
			acquireExclusiveFileLock(targetPath, { timeoutMs: 300, pollMs: 25 }),
			acquireExclusiveFileLock(targetPath, { timeoutMs: 300, pollMs: 25 }),
		]);

		const oks = results.filter((r) => r.ok);
		const fails = results.filter((r) => !r.ok);

		assert.equal(oks.length, 1, "exactly one acquirer must succeed");
		assert.equal(fails.length, 1, "exactly one acquirer must fail");

		const fail = fails[0]!;
		assert.equal(fail.ok, false);
		if (!fail.ok) {
			assert.equal(fail.code, "LOCK_TIMEOUT");
			// Diagnostics must be present on the failure result.
			assert.equal(typeof fail.diagnostics, "object");
			assert.equal(fail.diagnostics.lockPath, `${targetPath}.lock`);
		}

		// Release the winner so the temp dir can be cleaned up.
		const winner = oks[0]!;
		if (winner.ok) {
			await releaseExclusiveFileLock({
				lockPath: winner.lockPath,
				token: winner.token,
			});
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.3 — Verified-dead LOCAL pid is NEVER reclaimed (CORRECTED from #3108)
//
// The previous implementation (#3108) reclaimed verified-dead local pids via
// rename + O_EXCL recreate.  The corrected spec (#3098 rev3) and design
// (#3099 rev2) make the safety posture explicit: NO automatic reclamation
// under any condition.  A paused-but-alive holder could resume after reclaim
// and write concurrently — the exact lost-update this change exists to prevent.
// ---------------------------------------------------------------------------

test("verified-dead LOCAL pid is NEVER reclaimed: LOCK_TIMEOUT + lockfile byte-identical + mtime/ctime unchanged", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 60000);"],
			{ stdio: "ignore" },
		);
		const childPid = child.pid!;
		await sleep(150);

		child.kill("SIGKILL");
		await sleep(150);

		// Confirm the child is actually dead (ESRCH).
		let dead = false;
		try {
			process.kill(childPid, 0);
		} catch (err) {
			dead = (err as NodeJS.ErrnoException).code === "ESRCH";
		}
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child; cannot verify dead-pid case");
			return;
		}

		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		const originalContent = {
			pid: childPid,
			startedAt: new Date(Date.now() - 3_600_000).toISOString(),
			token: "old-dead-token",
			host: hostname(),
		};
		const originalJson = JSON.stringify(originalContent);
		writeFileSync(lockPath, originalJson);
		await sleep(10); // let filesystem timestamps settle
		const before = timestamps(lockPath);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 200,
			pollMs: 25,
		});

		// MUST time out — never reclaim, even for a verified-dead local pid.
		assert.equal(result.ok, false, "must NOT reclaim verified-dead pid");
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			// Diagnostics must surface the verified-dead state.
			assert.equal(result.diagnostics.holderState, "verified-dead");
			assert.equal(result.diagnostics.holderPid, childPid);
			assert.equal(result.diagnostics.lockPath, lockPath);
		}

		// Lockfile must be completely untouched — no rename-aside, no recreate.
		assert.equal(existsSync(lockPath), true);
		assert.equal(readFileSync(lockPath, "utf8"), originalJson);
		const after = timestamps(lockPath);
		assert.equal(after.mtimeMs, before.mtimeMs, "mtime must not change");
		assert.equal(after.ctimeMs, before.ctimeMs, "ctime must not change");
		assert.equal(after.size, before.size, "size must not change");
	} finally {
		try { child?.kill("SIGKILL"); } catch { /* already dead */ }
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.4 — Alive local pid never reclaimed regardless of startedAt age
// ---------------------------------------------------------------------------

test("alive local pid never reclaimed regardless of startedAt age (suspended-but-alive)", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		const originalContent = {
			pid: process.pid,
			startedAt: new Date(Date.now() - 86_400_000).toISOString(),
			token: "alive-old-token",
			host: hostname(),
		};
		writeFileSync(lockPath, JSON.stringify(originalContent));
		await sleep(10);
		const before = timestamps(lockPath);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "alive");
			assert.equal(result.diagnostics.holderPid, process.pid);
		}

		assert.equal(existsSync(lockPath), true);
		const after = JSON.parse(readFileSync(lockPath, "utf8"));
		assert.deepEqual(after, originalContent);
		const afterStat = timestamps(lockPath);
		assert.equal(afterStat.mtimeMs, before.mtimeMs);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.5 — Malformed / non-JSON / missing-fields / zero-pid lockfile
// ---------------------------------------------------------------------------

test("malformed non-JSON lockfile returns LOCK_TIMEOUT, no force-delete", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		const garbage = "this is not json {{{";
		writeFileSync(lockPath, garbage);
		await sleep(10);
		const before = timestamps(lockPath);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "malformed");
			assert.equal(result.diagnostics.lockPath, lockPath);
		}

		assert.equal(existsSync(lockPath), true, "must not force-delete");
		assert.equal(readFileSync(lockPath, "utf8"), garbage);
		const afterStat = timestamps(lockPath);
		assert.equal(afterStat.mtimeMs, before.mtimeMs);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("lockfile with missing required fields returns LOCK_TIMEOUT, no force-delete", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		writeFileSync(lockPath, JSON.stringify({ foo: "bar" }));

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "malformed");
		}

		assert.equal(existsSync(lockPath), true, "must not force-delete");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("lockfile with zero pid returns LOCK_TIMEOUT, no reclaim", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: 0,
				startedAt: new Date().toISOString(),
				token: "zero-pid-token",
				host: hostname(),
			}),
		);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "malformed");
		}
		assert.equal(existsSync(lockPath), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.6 — Remote-host lockfile → LOCK_TIMEOUT, no reclaim
// ---------------------------------------------------------------------------

test("remote-host lockfile (host !== os.hostname()) returns LOCK_TIMEOUT, no reclaim", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				startedAt: new Date().toISOString(),
				token: "remote-token",
				host: "A-COMPLETELY-DIFFERENT-HOST",
			}),
		);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "remote-host");
			assert.equal(result.diagnostics.holderHost, "A-COMPLETELY-DIFFERENT-HOST");
		}

		assert.equal(existsSync(lockPath), true, "must not force-delete");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.7 — PID-recycled holder (alive pid from a different process)
// ---------------------------------------------------------------------------

test("PID-recycled holder (alive pid from different process) returns LOCK_TIMEOUT", async () => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 60000);"],
			{ stdio: "ignore" },
		);
		await sleep(150);

		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: child.pid,
				startedAt: new Date().toISOString(),
				token: "recycled-token",
				host: hostname(),
			}),
		);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			// Recycled pid appears alive to process.kill(pid, 0).
			assert.equal(result.diagnostics.holderState, "alive");
		}
		assert.equal(existsSync(lockPath), true);
	} finally {
		try { child?.kill("SIGKILL"); } catch { /* ignore */ }
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.8 — EPERM from process.kill(pid, 0) → LOCK_TIMEOUT, no reclaim
// ---------------------------------------------------------------------------

test("EPERM from process.kill(pid, 0) returns LOCK_TIMEOUT, no reclaim", async (t) => {
	let epermPid: number | null = null;
	for (const candidate of [4, 1]) {
		try {
			process.kill(candidate, 0);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EPERM") {
				epermPid = candidate;
				break;
			}
		}
	}
	if (epermPid === null) {
		t.skip("No EPERM-triggering system pid found on this platform");
		return;
	}

	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: epermPid,
				startedAt: new Date().toISOString(),
				token: "eperm-token",
				host: hostname(),
			}),
		);

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 150,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "LOCK_TIMEOUT");
			assert.equal(result.diagnostics.holderState, "permission-denied");
		}
		assert.equal(existsSync(lockPath), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.9 — Genuine filesystem failure → LOCK_IO_ERROR (NOT LOCK_TIMEOUT)
// ---------------------------------------------------------------------------

test("genuine filesystem failure (parent path blocked by file) returns LOCK_IO_ERROR with diagnostics", async () => {
	const dir = tempDir();
	try {
		// Create a regular file where a directory is expected, so the
		// lockfile path cannot be created.  This triggers a genuine I/O
		// error (ENOTDIR / ENOENT / EACCES) distinct from EEXIST.
		const blocker = join(dir, "blocker");
		writeFileSync(blocker, "not a dir");
		const targetPath = join(blocker, "nested", "data.jsonl");

		const result = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 500,
			pollMs: 25,
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(
				result.code,
				"LOCK_IO_ERROR",
				"must be LOCK_IO_ERROR, not LOCK_TIMEOUT, for genuine FS failure",
			);
			assert.equal(typeof result.diagnostics, "object");
			assert.equal(result.diagnostics.lockPath, `${targetPath}.lock`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.10 — Diagnostic metadata present on EVERY failure result
// ---------------------------------------------------------------------------

test("diagnostics present on every failure result with lockPath and applicable holder fields", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const lockPath = `${targetPath}.lock`;

		// Scenario 1: well-formed alive holder — all fields populated.
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				startedAt: "2026-01-01T00:00:00.000Z",
				token: "diag-test-token",
				host: hostname(),
			}),
		);
		const r1 = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 100,
			pollMs: 25,
		});
		assert.equal(r1.ok, false);
		if (!r1.ok) {
			const d = r1.diagnostics;
			assert.equal(d.lockPath, lockPath);
			assert.equal(d.holderPid, process.pid);
			assert.equal(d.holderHost, hostname());
			assert.equal(d.holderStartedAt, "2026-01-01T00:00:00.000Z");
			assert.equal(d.holderState, "alive");
		}

		// Scenario 2: malformed — lockPath + holderState only.
		rmSync(lockPath, { force: true });
		writeFileSync(lockPath, "{{garbage}}");
		const r2 = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 100,
			pollMs: 25,
		});
		assert.equal(r2.ok, false);
		if (!r2.ok) {
			assert.equal(r2.diagnostics.lockPath, lockPath);
			assert.equal(r2.diagnostics.holderState, "malformed");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.11 — No-reclaim invariant: no reclaim API surface; lockfile
// untouched for every failure case.
// ---------------------------------------------------------------------------

test("no-reclaim invariant: helper exposes no reclaim/rename/forceDelete/staleMs API surface", () => {
	const reclaimSurface = [
		"canReclaim",
		"reclaimStaleLock",
		"renameLockAside",
		"forceDelete",
		"forceDeleteLock",
		"staleMs",
		"staleMsDefault",
	];
	for (const name of reclaimSurface) {
		assert.equal(
			name in lockModule,
			false,
			`module must NOT export reclaim-oriented "${name}"`,
		);
	}
});

// ---------------------------------------------------------------------------
// Task 1.12 — Token-gated release: mismatch no-op, missing idempotent
// ---------------------------------------------------------------------------

test("token-gated release: mismatched token is no-op; missing lockfile is idempotent success", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");

		const acquired = await acquireExclusiveFileLock(targetPath, {
			timeoutMs: 1000,
			pollMs: 25,
		});
		assert.equal(acquired.ok, true);
		if (!acquired.ok) return;

		const { lockPath, token: correctToken } = acquired;

		// Release with WRONG token → no-op success, lockfile still present.
		await releaseExclusiveFileLock({ lockPath, token: "wrong-token" });
		assert.equal(
			existsSync(lockPath),
			true,
			"mismatched token must NOT delete lockfile",
		);

		// Release with CORRECT token → lockfile deleted.
		await releaseExclusiveFileLock({ lockPath, token: correctToken });
		assert.equal(
			existsSync(lockPath),
			false,
			"correct token must delete lockfile",
		);

		// Release again (lockfile already missing) → idempotent success, no throw.
		await releaseExclusiveFileLock({ lockPath, token: correctToken });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Task 1.13 [NEW r6] — resolveLockTimeoutMs: missing/non-integer → 2000 default
//
// Spec #3098 rev4 "IDU_LOCK_TIMEOUT_MS env-only configuration": non-integer
// or missing values fall back to the documented default of 2000 ms. The strict
// integer-string regex `/^-?\d+$/` rejects values that Number()+isInteger
// would wrongly accept (e.g. Number("2e3")===2000).
// ---------------------------------------------------------------------------

test("resolveLockTimeoutMs returns 2000 (default) for missing or non-integer values", () => {
	const expectedDefault = 2000;
	const cases: Array<{ label: string; env: NodeJS.ProcessEnv }> = [
		{ label: "missing key", env: {} },
		{ label: "empty string", env: { IDU_LOCK_TIMEOUT_MS: "" } },
		{ label: "alpha garbage", env: { IDU_LOCK_TIMEOUT_MS: "abc" } },
		{ label: "decimal float", env: { IDU_LOCK_TIMEOUT_MS: "2.5" } },
		{ label: "scientific notation", env: { IDU_LOCK_TIMEOUT_MS: "2e3" } },
		{ label: "trailing unit", env: { IDU_LOCK_TIMEOUT_MS: "2000ms" } },
		{ label: "literal NaN string", env: { IDU_LOCK_TIMEOUT_MS: "NaN" } },
		{ label: "leading whitespace", env: { IDU_LOCK_TIMEOUT_MS: " 1500" } },
		{ label: "plus sign", env: { IDU_LOCK_TIMEOUT_MS: "+1500" } },
		{ label: "hex notation", env: { IDU_LOCK_TIMEOUT_MS: "0x1" } },
	];
	for (const { label, env } of cases) {
		assert.equal(
			resolveLockTimeoutMs(env),
			expectedDefault,
			`non-integer "${label}" must fall back to default 2000`,
		);
	}
});

// ---------------------------------------------------------------------------
// Task 1.14 [NEW r6] — resolveLockTimeoutMs: clamp to [100, 10000]
// ---------------------------------------------------------------------------

test("resolveLockTimeoutMs clamps out-of-range integers and passes in-range through", () => {
	const clampCases: Array<{ input: string; expected: number }> = [
		{ input: "50", expected: 100 },
		{ input: "0", expected: 100 },
		{ input: "-5", expected: 100 },
		{ input: "99", expected: 100 },
		{ input: "30000", expected: 10000 },
		{ input: "60000", expected: 10000 },
		{ input: "10000000", expected: 10000 },
		{ input: "1500", expected: 1500 },
		{ input: "5000", expected: 5000 },
		{ input: "100", expected: 100 },
		{ input: "101", expected: 101 },
		{ input: "10000", expected: 10000 },
		{ input: "9999", expected: 9999 },
	];
	for (const { input, expected } of clampCases) {
		assert.equal(
			resolveLockTimeoutMs({ IDU_LOCK_TIMEOUT_MS: input }),
			expected,
			`input "${input}" must resolve to ${expected}`,
		);
	}
});

// ---------------------------------------------------------------------------
// Task 1.15 [NEW r6] — resolveLockTimeoutMs: env is the ONLY config source
//
// No alternative source (CLI flag, config-file key, MCP argument, function
// argument) may override the env-derived value. The resolver reads ONLY
// IDU_LOCK_TIMEOUT_MS from the env object; all other keys are inert.
// ---------------------------------------------------------------------------

test("resolveLockTimeoutMs honors IDU_LOCK_TIMEOUT_MS only and ignores all other sources", () => {
	// Env value wins; other env keys (simulating CLI flags / config files) are inert.
	assert.equal(
		resolveLockTimeoutMs({
			IDU_LOCK_TIMEOUT_MS: "1500",
			TIMEOUT_FLAG: "9999",
			LOCK_TIMEOUT: "9999",
		}),
		1500,
		"only IDU_LOCK_TIMEOUT_MS is read; other keys ignored",
	);

	// When IDU_LOCK_TIMEOUT_MS is absent, the default applies regardless of
	// how many unrelated keys are present.
	assert.equal(
		resolveLockTimeoutMs({ CLI_LOCK_TIMEOUT: "9999", MCP_TIMEOUT: "9999" }),
		2000,
		"unrelated keys never substitute for IDU_LOCK_TIMEOUT_MS",
	);

	// The resolver exposes no override parameter: it accepts only the env
	// object. A valid in-range env value is returned verbatim.
	assert.equal(
		resolveLockTimeoutMs({ IDU_LOCK_TIMEOUT_MS: "5000" }),
		5000,
	);
});

// ===========================================================================
// Phase 1 — AST bans: no file-based maintenance/reap surface (spec #3098 rev7)
// ===========================================================================

test("AST ban: no '.lock.maintenance' or '.reaped.' literal in state-root-file-lock.ts", () => {
	const src = readFileSync(LOCK_SRC_PATH, "utf8");
	assert.ok(
		!/\.maintenance\b/u.test(src),
		"source must not reference a '.maintenance' file path (file-based gate removed)",
	);
	assert.ok(
		!/\.reaped\b/u.test(src),
		"source must not reference '.reaped' evidence files (reap surface removed)",
	);
});

test("AST ban: no fs.rename/renameSync in state-root-file-lock.ts", () => {
	const src = readFileSync(LOCK_SRC_PATH, "utf8");
	// Ban rename CALLS (with parens), not the word in comments.
	assert.ok(
		!/renameSync\s*\(|fs\.rename\s*\(|\.rename\s*\(/u.test(src),
		"source must not call renameSync/fs.rename (rename-based gate recovery prohibited)",
	);
});

test("AST ban: no startedAt/process.kill/mtime/TTL in maintenance gate section (CLI matrix excluded)", () => {
	const src = readFileSync(LOCK_SRC_PATH, "utf8");
	const start = src.indexOf("MAINTENANCE GATE START");
	const end = src.indexOf("MAINTENANCE GATE END");
	assert.ok(start !== -1 && end !== -1 && start < end, "maintenance gate section markers must exist");
	const gateSection = src.slice(start, end);
	// The maintenance gate acquire/hold/release flow must not branch on PID
	// liveness, TTL, age, mtime, or startedAt. Only EADDRINUSE + connect-probe
	// decide gate state. (The CLI verified-dead matrix in classifyLockfile is
	// OUTSIDE this section and explicitly excluded.)
	assert.ok(
		!/\bprocess\.kill\b/u.test(gateSection),
		"maintenance gate section must not use process.kill (no PID liveness in gate flow)",
	);
	assert.ok(
		!/\bstartedAt\b/u.test(gateSection),
		"maintenance gate section must not reference startedAt (no age/TTL in gate flow)",
	);
	assert.ok(
		!/\bstatSync\b/u.test(gateSection),
		"maintenance gate section must not use statSync (no mtime in gate flow)",
	);
});

test("AST ban: no reapRename/renameBack/deleteIsolated/verifyDead family dispatch in state-root-file-lock.ts", () => {
	const src = readFileSync(LOCK_SRC_PATH, "utf8");
	const bannedFns = ["reapRename", "renameBack", "deleteIsolated", "verifyDead", "reapMaintenanceOrReaped"];
	for (const fn of bannedFns) {
		assert.ok(
			!src.includes(fn),
			`source must not define or call '${fn}' (reap family removed)`,
		);
	}
});

// ===========================================================================
// Phase 3 — Integration: no file-gate artifacts from acquireExclusiveFileLock
// ===========================================================================

test("integration: acquireExclusiveFileLock happy path writes no .lock.maintenance or .reaped.* artifacts", async () => {
	const dir = tempDir();
	try {
		const targetPath = join(dir, "data.jsonl");
		const result = await acquireExclusiveFileLock(targetPath, { timeoutMs: 1000, pollMs: 25 });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		// After acquire, the only lock-related file should be the normal .lock.
		const entries = readdirSync(dir);
		const lockFiles = entries.filter((n) => n.includes(".lock"));
		assert.ok(lockFiles.includes("data.jsonl.lock"), "normal .lock created");
		const banned = entries.filter(
			(n) => n.includes(".lock.maintenance") || n.includes(".reaped."),
		);
		assert.deepEqual(banned, [], "no .lock.maintenance or .reaped.* artifacts");
		await releaseExclusiveFileLock({ lockPath: result.lockPath, token: result.token });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("integration: N acquire/release cycles leave no .lock.maintenance or .reaped.* in lockfile dir", async () => {
	const dir = tempDir();
	try {
		for (let i = 0; i < 3; i++) {
			const targetPath = join(dir, `cycle-${i}.jsonl`);
			const r = await acquireExclusiveFileLock(targetPath, { timeoutMs: 1000, pollMs: 25 });
			if (r.ok) await releaseExclusiveFileLock({ lockPath: r.lockPath, token: r.token });
		}
		const entries = readdirSync(dir);
		const banned = entries.filter(
			(n) => n.includes(".lock.maintenance") || n.includes(".reaped."),
		);
		assert.deepEqual(banned, [], "no maintenance/reaped artifacts after N cycles");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("integration: cleanupStaleLockfiles refused while maintenance gate held by concurrent process", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		// Create a verified-dead lockfile (eligible for cleanup).
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], { stdio: "ignore" });
		const childPid = child.pid!;
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);
		let dead = false;
		try { process.kill(childPid, 0); } catch (err) { dead = (err as NodeJS.ErrnoException).code === "ESRCH"; }
		if (!dead) { t.skip("platform does not report ESRCH"); return; }

		const lockPath = join(dir, "dead.lock");
		writeFileSync(lockPath, JSON.stringify({
			pid: childPid, startedAt: "2026-01-01T00:00:00.000Z", token: "dead", host: hostname(),
		}));

		// Hold the maintenance kernel gate (simulating a concurrent acquireExclusiveFileLock).
		const gate = await acquireMaintenanceLock(lockPath, 5000);
		if (!gate.ok) { t.skip("could not acquire maintenance gate for test"); return; }

		// Run cleanup with confirm — must be refused because the gate is busy.
		const result = await cleanupStaleLockfiles(dir, { confirmDelete: true });
		const victim = result.actions.find((a) => a.lockPath === lockPath);
		assert.ok(victim, "dead lockfile has an action");
		assert.equal(victim!.action, "refused", "cleanup must be refused while gate is held");
		assert.ok(
			/gate|coordination|busy/iu.test(victim!.action === "refused" ? victim!.reason : ""),
			"refusal reason must mention gate contention",
		);
		assert.equal(existsSync(lockPath), true, "dead lockfile must survive (gate blocked deletion)");

		await gate.handle.release();
	} finally {
		try { child?.kill("SIGKILL"); } catch { /* */ }
		rmSync(dir, { recursive: true, force: true });
	}
});

// ===========================================================================
// Phase 2 — endpoint derivation via public exports
// ===========================================================================

test("deriveMaintenanceEndpoint: stable SHA-256 hash endpoint matches acquireMaintenanceLock endpoint", async () => {
	const lockPath = join(tempDir(), "derive-test.lock");
	const ep = deriveMaintenanceEndpoint(lockPath);
	const result = await acquireMaintenanceLock(lockPath, 1000);
	if (result.ok) {
		assert.equal(result.endpoint, ep, "acquired endpoint must match derived endpoint");
		await result.handle.release();
	}
});
