import test from "node:test";
import assert from "node:assert/strict";
import { acquireSessionLock, reclaimStaleLock } from "../src/session-lock.js";
import { cleanupFiles } from "../src/runner.js";
import type { RunnerSpec } from "../src/types.js";

test("reclaimStaleLock elects exactly one winner, so a slower reclaimer cannot steal a fresh lock", async () => {
	const { writeFileSync } = await import("node:fs");
	const cwd = process.cwd();
	const holder = acquireSessionLock("stale-claim-once-session", cwd, process.pid);

	// Simulate a crashed owner: the pid no longer exists.
	writeFileSync(
		holder.lockPath,
		JSON.stringify({ pid: 99999999, cwd, time: new Date().toISOString() }),
		"utf8",
	);

	assert.equal(reclaimStaleLock(holder.lockPath), true, "first reclaimer wins the claim");
	assert.equal(reclaimStaleLock(holder.lockPath), false, "second reclaimer must not claim the same file");

	const next = acquireSessionLock("stale-claim-once-session", cwd, process.pid);
	assert.ok(next, "the winner can acquire after the claim");
	next.release();
});

test("acquireSessionLock reclaims a stale lock whose owner is dead", async () => {
	const { writeFileSync } = await import("node:fs");
	const cwd = process.cwd();
	const sessionId = "dead-owner-reclaim-session";
	const holder = acquireSessionLock(sessionId, cwd, process.pid);

	writeFileSync(
		holder.lockPath,
		JSON.stringify({ pid: 99999999, cwd, time: new Date().toISOString() }),
		"utf8",
	);

	const next = acquireSessionLock(sessionId, cwd, process.pid);
	assert.ok(next, "a dead owner must not block a new acquisition");
	next.release();
});

test("acquireSessionLock reclaims a corrupt lock file", async () => {
	const { writeFileSync } = await import("node:fs");
	const cwd = process.cwd();
	const sessionId = "corrupt-lock-reclaim-session";
	const holder = acquireSessionLock(sessionId, cwd, process.pid);

	writeFileSync(holder.lockPath, "{ half-written", "utf8");

	const next = acquireSessionLock(sessionId, cwd, process.pid);
	assert.ok(next, "a corrupt lock must not block a new acquisition");
	next.release();
});

test("cleanupFiles releases only the lock this run still owns", async () => {
	const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");

	const dir = mkdtempSync(join(tmpdir(), "idu-cleanup-lock-"));
	try {
		const lockPath = join(dir, "sess.lock");
		const spec = {
			runId: "run-1",
			sessionId: "ses-1",
			harness: "claude",
			command: "node",
			args: [],
			workingDir: dir,
			env: {},
			logPath: join(dir, "run.log"),
			sessionPath: join(dir, "run.json"),
			pidPath: join(dir, "run.pid"),
			lockPath,
			lockToken: "ours",
		} as unknown as RunnerSpec;

		writeFileSync(lockPath, JSON.stringify({ pid: 12345, token: "theirs" }), "utf8");
		cleanupFiles(spec);
		assert.ok(existsSync(lockPath), "a lock another run owns must survive");

		writeFileSync(lockPath, JSON.stringify({ pid: 12345, token: "theirs" }), "utf8");
		cleanupFiles({ ...spec, lockToken: undefined } as RunnerSpec);
		assert.ok(existsSync(lockPath), "without a token, a foreign pid is not ours");

		writeFileSync(lockPath, JSON.stringify({ pid: 12345, token: "ours" }), "utf8");
		cleanupFiles(spec);
		assert.equal(existsSync(lockPath), false, "an owned lock is released");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("updatePid leaves the lock file parseable for concurrent readers", async () => {
	const { readFileSync } = await import("node:fs");
	const sessionId = "update-pid-parseable-session";
	const lock = acquireSessionLock(sessionId, process.cwd(), process.pid);

	lock.updatePid?.(process.pid + 1);

	const parsed = JSON.parse(readFileSync(lock.lockPath, "utf8"));
	assert.equal(parsed.pid, process.pid + 1, "the rename write must land the new pid intact");
	lock.release();
});
