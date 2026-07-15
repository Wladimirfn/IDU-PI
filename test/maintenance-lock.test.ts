/**
 * maintenance-lock.test.ts — node:net kernel primitive for maintenance exclusivity
 * (spec #3098 rev7, design #3099 rev6, tasks #3100 rev16).
 *
 * Coverage:
 *   - deriveMaintenanceEndpoint: hash stability, format, length bounds
 *   - acquireMaintenanceLock: first-try acquire, contention→BUSY, release→reacquire
 *   - crash-release: kernel teardown (Windows pipe gone / POSIX ECONNREFUSED→unlink)
 *   - IO error mapping: non-EADDRINUSE → MAINTENANCE_IO_ERROR
 *   - no `.lock.maintenance` / `.reaped.*` artifacts ever written
 */

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import {
	acquireMaintenanceLock,
	deriveMaintenanceEndpoint,
} from "../src/state-root-file-lock.js";

const IS_WIN = process.platform === "win32";
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_SRC = resolve(HERE, "..", "src", "state-root-file-lock.js");

function tempDir(prefix = "idu-maint-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// deriveMaintenanceEndpoint — hash stability + format
// ---------------------------------------------------------------------------

test("deriveMaintenanceEndpoint: same lockPath → byte-identical endpoint (stable across calls)", () => {
	const lockPath = join(tempDir(), "data.jsonl.lock");
	const a = deriveMaintenanceEndpoint(lockPath);
	const b = deriveMaintenanceEndpoint(lockPath);
	assert.equal(a, b, "endpoint must be deterministic for same lockPath");
});

test("deriveMaintenanceEndpoint: different lockPaths → different endpoints", () => {
	const d1 = tempDir();
	const d2 = tempDir();
	const a = deriveMaintenanceEndpoint(join(d1, "a.lock"));
	const b = deriveMaintenanceEndpoint(join(d2, "b.lock"));
	assert.notEqual(a, b, "different lockPaths must produce different endpoints");
});

test("deriveMaintenanceEndpoint: hash is 64 hex chars (SHA-256)", () => {
	const lockPath = join(tempDir(), "probe.lock");
	const ep = deriveMaintenanceEndpoint(lockPath);
	if (IS_WIN) {
		// Windows: \\.\pipe\idu-pi-maint-<64hex>
		assert.match(ep, /^\\\\\.\\pipe\\idu-pi-maint-[0-9a-f]{64}$/u);
		assert.ok(ep.length <= 256, `pipe name must be ≤256 chars, got ${ep.length}`);
	} else {
		// POSIX: ${tmpdir()}/idu-pi-maint-<16hex>.sock
		assert.match(ep, /\/idu-pi-maint-[0-9a-f]{16}\.sock$/u);
		assert.ok(ep.length <= 108, `socket path must be ≤108 chars (Linux), got ${ep.length}`);
	}
});

test("deriveMaintenanceEndpoint: Windows pipe ≤256 / POSIX path ≤108", () => {
	// Long lockPath still produces a bounded endpoint (hash is fixed-length).
	const longLockPath = join(tempDir(), "x".repeat(200), "deep", "data.jsonl.lock");
	const ep = deriveMaintenanceEndpoint(longLockPath);
	if (IS_WIN) {
		assert.ok(ep.length <= 256, `Windows pipe ≤256: ${ep.length}`);
	} else {
		assert.ok(ep.length <= 108, `POSIX socket ≤108: ${ep.length}`);
	}
});

// ---------------------------------------------------------------------------
// acquireMaintenanceLock — first-try acquire + release
// ---------------------------------------------------------------------------

test("acquireMaintenanceLock: first-try on free endpoint → ok with handle + endpoint", async () => {
	const lockPath = join(tempDir(), "free.lock");
	const result = await acquireMaintenanceLock(lockPath, 2000);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(typeof result.handle, "object");
	assert.equal(typeof result.endpoint, "string");
	assert.equal(result.endpoint, deriveMaintenanceEndpoint(lockPath));
	await result.handle.release();
});

test("acquireMaintenanceLock: after release, re-acquire succeeds", async () => {
	const lockPath = join(tempDir(), "release-reacquire.lock");
	const r1 = await acquireMaintenanceLock(lockPath, 2000);
	assert.equal(r1.ok, true);
	if (!r1.ok) return;
	await r1.handle.release();
	// Small delay for kernel teardown.
	await sleep(50);
	const r2 = await acquireMaintenanceLock(lockPath, 2000);
	assert.equal(r2.ok, true, "re-acquire after release must succeed");
	if (r2.ok) await r2.handle.release();
});

// ---------------------------------------------------------------------------
// acquireMaintenanceLock — contention → MAINTENANCE_BUSY (bounded)
// ---------------------------------------------------------------------------

test("acquireMaintenanceLock: second concurrent acquire → MAINTENANCE_BUSY (bounded, never hangs)", async () => {
	const lockPath = join(tempDir(), "contended.lock");
	const holder = await acquireMaintenanceLock(lockPath, 5000);
	assert.equal(holder.ok, true);
	if (!holder.ok) return;

	const start = Date.now();
	const contender = await acquireMaintenanceLock(lockPath, 300);
	const elapsed = Date.now() - start;

	assert.equal(contender.ok, false, "contender must not acquire while holder holds");
	if (!contender.ok) {
		assert.equal(contender.code, "MAINTENANCE_BUSY");
		assert.equal(typeof contender.diagnostics, "object");
		assert.equal(contender.diagnostics.platform, process.platform);
		assert.equal(contender.diagnostics.endpoint, deriveMaintenanceEndpoint(lockPath));
	}
	// Must be bounded — not much longer than the timeout.
	assert.ok(elapsed < 2000, `must not hang: elapsed=${elapsed}ms (timeout=300)`);

	await holder.handle.release();
});

// ---------------------------------------------------------------------------
// Crash-release — kernel teardown on SIGKILL
// ---------------------------------------------------------------------------

/**
 * Fork a child that acquires the maintenance gate and holds it until killed.
 * Returns the child process handle.
 */
async function forkHolder(lockPath: string, timeoutMs: number) {
	const childScript = `
import { acquireMaintenanceLock } from ${JSON.stringify(pathToFileURL(DIST_SRC).href)};
const lockPath = ${JSON.stringify(lockPath)};
const gate = await acquireMaintenanceLock(lockPath, ${timeoutMs});
if (gate.ok) {
  process.send("acquired:" + gate.endpoint);
} else {
  process.send("failed:" + gate.code);
}
`;
	const childFile = join(tmpdir(), `maint-holder-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
	writeFileSync(childFile, childScript);

	const child = fork(childFile, [], { stdio: "ignore" });
	const msg = await new Promise<string>((res, rej) => {
		const to = setTimeout(() => rej(new Error("child acquire timeout")), 10000);
		child.once("message", (m: unknown) => { clearTimeout(to); res(String(m)); });
		child.once("exit", () => { clearTimeout(to); rej(new Error("child exited before message")); });
	});
	if (!msg.startsWith("acquired:")) {
		throw new Error(`child failed to acquire: ${msg}`);
	}
	return { child, cleanup: () => { try { rmSync(childFile, { force: true }); } catch { /* */ } } };
}

test("acquireMaintenanceLock: Windows crash-release — holder SIGKILL → first-try rebind ok", async (t) => {
	if (!IS_WIN) { t.skip("Windows-specific: named pipe disappears on process death"); return; }
	const lockPath = join(tempDir(), "crash-win.lock");
	const { child, cleanup } = await forkHolder(lockPath, 30000);
	try {
		// Confirm contention while child holds.
		const busy = await acquireMaintenanceLock(lockPath, 300);
		assert.equal(busy.ok, false);
		if (!busy.ok) assert.equal(busy.code, "MAINTENANCE_BUSY");

		// Crash the holder.
		child.kill("SIGKILL");
		await new Promise((r) => child.once("exit", r));
		await sleep(300); // kernel teardown window

		// Re-acquire — pipe should be gone → first-try ok.
		const result = await acquireMaintenanceLock(lockPath, 2000);
		assert.equal(result.ok, true, "must re-acquire after Windows crash (kernel released pipe)");
		if (result.ok) await result.handle.release();
	} finally {
		try { child.kill("SIGKILL"); } catch { /* */ }
		cleanup();
	}
});

test("acquireMaintenanceLock: POSIX crash-release — holder SIGKILL → ECONNREFUSED → unlink + retry ok", async (t) => {
	if (IS_WIN) { t.skip("POSIX-specific: stale socket path recovered via ECONNREFUSED probe"); return; }
	const lockPath = join(tempDir(), "crash-posix.lock");
	const { child, cleanup } = await forkHolder(lockPath, 30000);
	try {
		const busy = await acquireMaintenanceLock(lockPath, 300);
		assert.equal(busy.ok, false);
		if (!busy.ok) assert.equal(busy.code, "MAINTENANCE_BUSY");

		child.kill("SIGKILL");
		await new Promise((r) => child.once("exit", r));
		await sleep(300);

		// Stale socket path should be recovered via connect-probe (ECONNREFUSED → unlink → retry).
		const result = await acquireMaintenanceLock(lockPath, 2000);
		assert.equal(result.ok, true, "must re-acquire after POSIX crash (stale path recovered)");
		if (result.ok) await result.handle.release();
	} finally {
		try { child.kill("SIGKILL"); } catch { /* */ }
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// IO error — non-EADDRINUSE → MAINTENANCE_IO_ERROR (POSIX only)
// ---------------------------------------------------------------------------

test("acquireMaintenanceLock: POSIX regular-file at socket path → MAINTENANCE_IO_ERROR", async (t) => {
	if (IS_WIN) { t.skip("POSIX-specific: regular file blocking socket bind"); return; }
	const lockPath = join(tempDir(), "io-error.lock");
	const ep = deriveMaintenanceEndpoint(lockPath);
	// Place a regular file where the socket would bind.
	try {
		writeFileSync(ep, "not a socket");
	} catch {
		t.skip("could not create blocker file");
		return;
	}
	try {
		const result = await acquireMaintenanceLock(lockPath, 500);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, "MAINTENANCE_IO_ERROR", "non-EADDRINUSE/probe error must be IO fail-closed");
		}
	} finally {
		try { rmSync(ep, { force: true }); } catch { /* */ }
	}
});

// ---------------------------------------------------------------------------
// No file-gate artifacts — `.lock.maintenance` / `.reaped.*` never created
// ---------------------------------------------------------------------------

test("acquireMaintenanceLock: N acquire/release cycles leave no .lock.maintenance or .reaped.* artifacts", async () => {
	const dir = tempDir();
	try {
		for (let i = 0; i < 5; i++) {
			const lockPath = join(dir, `cycle-${i}.jsonl.lock`);
			const r = await acquireMaintenanceLock(lockPath, 1000);
			if (r.ok) await r.handle.release();
		}
		// Inspect the lockfile directory — no maintenance/reaped artifacts.
		const { readdirSync } = await import("node:fs");
		const entries = readdirSync(dir);
		const banned = entries.filter((n) => n.includes(".lock.maintenance") || n.includes(".reaped."));
		assert.deepEqual(banned, [], "no .lock.maintenance or .reaped.* files permitted");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// W1 — POSIX chmod 0o600 hardening on the Unix socket endpoint
// (verify report #3260 warning 1). Platform-safe seams via dependency
// injection so the POSIX code path is exercised deterministically on every
// host. No new dependencies; no change to the Windows named-pipe path.
// ---------------------------------------------------------------------------

/**
 * Recorder factory: returns a chmod stub that records every invocation and an
 * unlink stub that records every cleanup. Both are pure (no filesystem touch),
 * making the POSIX hardening path testable on a Windows host.
 */
function makeChmodRecorder() {
	const chmodCalls: Array<{ path: string; mode: number }> = [];
	const unlinkCalls: string[] = [];
	const chmod = async (path: string, mode: number): Promise<void> => {
		chmodCalls.push({ path, mode });
	};
	const unlink = async (path: string): Promise<void> => {
		unlinkCalls.push(path);
	};
	return { chmod, unlink, chmodCalls, unlinkCalls };
}

test("W1: POSIX chmod 0o600 invoked on endpoint before returning ok maintenance handle", async () => {
	const lockPath = join(tempDir(), "w1-chmod-ok.lock");
	const rec = makeChmodRecorder();
	// Force the POSIX branch even on a Windows host: the endpoint is bound, then
	// the hardening seam must chmod it to 0o600 before ok is returned.
	const result = await acquireMaintenanceLock(lockPath, 2000, {
		isWindows: () => false,
		chmod: rec.chmod,
		unlink: rec.unlink,
	});
	// Release FIRST so a failing assertion never leaks a live server handle.
	if (result.ok) await result.handle.release();
	// The endpoint must have acquired...
	assert.equal(result.ok, true, "free endpoint must still acquire under POSIX seam");
	if (!result.ok) return;
	// ...and chmod must have run exactly once, on the bound endpoint, mode 0o600.
	assert.equal(rec.chmodCalls.length, 1, "POSIX must chmod the socket exactly once before ok");
	assert.equal(rec.chmodCalls[0].mode, 0o600, "socket perms must be hardened to 0o600");
	assert.equal(rec.chmodCalls[0].path, result.endpoint, "chmod must target the bound endpoint");
	// Ordering: ok is only observable AFTER chmod resolved, so a recorded call
	// with ok===true proves chmod happened before the handle was exposed.
});

test("W1: POSIX chmod failure closes server, unlinks socket, returns MAINTENANCE_IO_ERROR (never ok)", async () => {
	const lockPath = join(tempDir(), "w1-chmod-fail.lock");
	const ep = deriveMaintenanceEndpoint(lockPath);
	const rec = makeChmodRecorder();
	const chmodError = Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
	const result = await acquireMaintenanceLock(lockPath, 2000, {
		isWindows: () => false,
		chmod: async () => { throw chmodError; },
		unlink: rec.unlink,
	});
	// Release FIRST: if a bug ever yields ok here, do not leak the server.
	if (result.ok) await result.handle.release();
	// Never expose an ok handle on chmod failure — fail closed, typed IO error.
	assert.equal(result.ok, false, "chmod failure must never yield an ok handle");
	if (!result.ok) {
		assert.equal(result.code, "MAINTENANCE_IO_ERROR", "chmod failure must map to MAINTENANCE_IO_ERROR");
		assert.equal(result.diagnostics.lastError?.code, "EACCES", "observed error must be surfaced");
	}
	// Cleanup ran ENOENT-safe: the stale socket path was unlinked.
	assert.ok(
		rec.unlinkCalls.includes(ep),
		"chmod failure must unlink the socket path (ENOENT-safe cleanup)",
	);
	// The failed server must have been closed (not leaked as a live listener):
	// re-acquiring the same endpoint with a succeeding chmod must succeed. If the
	// server were still bound, the re-acquire would be MAINTENANCE_BUSY.
	const reacquire = await acquireMaintenanceLock(lockPath, 2000, {
		isWindows: () => false,
		chmod: rec.chmod,
		unlink: rec.unlink,
	});
	if (reacquire.ok) await reacquire.handle.release();
	assert.equal(reacquire.ok, true, "failed server must be closed so the endpoint is free to re-acquire");
});

test("W1: Windows named-pipe path skips chmod entirely (no filesystem chmod)", async () => {
	const lockPath = join(tempDir(), "w1-win-skip.lock");
	const rec = makeChmodRecorder();
	// Force the Windows branch: the named-pipe path must never call chmod.
	const result = await acquireMaintenanceLock(lockPath, 2000, {
		isWindows: () => true,
		chmod: rec.chmod,
		unlink: rec.unlink,
	});
	if (result.ok) await result.handle.release();
	assert.equal(result.ok, true, "free Windows endpoint must acquire");
	assert.equal(rec.chmodCalls.length, 0, "Windows named-pipe path must NEVER call chmod");
});
