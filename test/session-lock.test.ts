import test from "node:test";
import assert from "node:assert/strict";
import { acquireSessionLock, reclaimStaleLock } from "../src/process-manager.js";

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

test("updatePid leaves the lock file parseable for concurrent readers", async () => {
	const { readFileSync } = await import("node:fs");
	const sessionId = "update-pid-parseable-session";
	const lock = acquireSessionLock(sessionId, process.cwd(), process.pid);

	lock.updatePid?.(process.pid + 1);

	const parsed = JSON.parse(readFileSync(lock.lockPath, "utf8"));
	assert.equal(parsed.pid, process.pid + 1, "the rename write must land the new pid intact");
	lock.release();
});
