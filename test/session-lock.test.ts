import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { acquireSessionLock } from "../src/process-manager.js";

/** A pid that belonged to a process that has already exited. */
function deadPid(): number {
	const res = spawnSync(process.execPath, ["-e", ""]);
	assert.ok(res.pid, "could not spawn a throwaway process");
	return res.pid;
}

/** Where acquireSessionLock puts the lock, found by taking and releasing it once. */
function lockPathFor(sessionId: string, cwd: string): string {
	const probe = acquireSessionLock(sessionId, cwd, process.pid);
	probe.release();
	return probe.lockPath;
}

function cleanup(lockPath: string): void {
	for (const p of [lockPath, `${lockPath}.reclaim`]) {
		try {
			unlinkSync(p);
		} catch {
			/* not there */
		}
	}
}

test("a lock from a dead process is reclaimed", () => {
	const lockPath = lockPathFor("lock-dead-owner", process.cwd());
	try {
		writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), time: new Date().toISOString() }), "utf8");
		const lock = acquireSessionLock("lock-dead-owner", process.cwd(), process.pid);
		assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, process.pid);
		lock.release();
		assert.equal(existsSync(lockPath), false);
	} finally {
		cleanup(lockPath);
	}
});

test("an unreadable lock that is still fresh is not stolen", () => {
	const lockPath = lockPathFor("lock-fresh-torn", process.cwd());
	try {
		// What the old two-step create left visible for a moment: an empty file.
		writeFileSync(lockPath, "", "utf8");
		assert.throws(() => acquireSessionLock("lock-fresh-torn", process.cwd(), process.pid), /is currently in use/);
		assert.equal(readFileSync(lockPath, "utf8"), "", "the lock must be left exactly as it was");
	} finally {
		cleanup(lockPath);
	}
});

test("an unreadable lock past the grace period is treated as debris and reclaimed", () => {
	const lockPath = lockPathFor("lock-old-torn", process.cwd());
	try {
		writeFileSync(lockPath, "{ not json", "utf8");
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);
		const lock = acquireSessionLock("lock-old-torn", process.cwd(), process.pid);
		assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, process.pid);
		lock.release();
	} finally {
		cleanup(lockPath);
	}
});

test("a reclaim already in progress elsewhere is waited on, never raced", () => {
	const lockPath = lockPathFor("lock-reclaim-held", process.cwd());
	const stalePid = deadPid();
	try {
		writeFileSync(lockPath, JSON.stringify({ pid: stalePid }), "utf8");
		// Another process is mid-reclaim: it holds the reclaim mutex.
		writeFileSync(`${lockPath}.reclaim`, "12345", "utf8");
		assert.throws(
			() => acquireSessionLock("lock-reclaim-held", process.cwd(), process.pid),
			/being reclaimed by another idu-pi process/,
		);
		assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, stalePid, "nothing may be replaced without the mutex");
	} finally {
		cleanup(lockPath);
	}
});

test("updatePid replaces the lock whole, keeping release working", () => {
	const lock = acquireSessionLock("lock-update-pid", process.cwd(), process.pid);
	try {
		lock.updatePid?.(424242);
		assert.equal(JSON.parse(readFileSync(lock.lockPath, "utf8")).pid, 424242);
		lock.release();
		assert.equal(existsSync(lock.lockPath), false, "a pid handed over by this handle is still ours to release");
	} finally {
		cleanup(lock.lockPath);
	}
});

test("several processes reclaiming the same dead lock at once: exactly one wins", async () => {
	const sessionId = "lock-reclaim-race";
	const cwd = process.cwd();
	const lockPath = lockPathFor(sessionId, cwd);
	const contenders = 6;
	const pmUrl = new URL("../src/process-manager.js", import.meta.url).href;
	// Each contender waits for the same instant, tries once and reports on one
	// line. A winner then keeps the lock (by staying alive) until this test
	// closes its stdin, which only happens once every contender has reported.
	// A fixed hold time would let a contender that started late under load find
	// the winner already gone and win too, failing the test for the wrong reason.
	const script = `
		const { acquireSessionLock } = await import(${JSON.stringify(pmUrl)});
		const startAt = Number(process.argv[1]);
		while (Date.now() < startAt) {}
		try {
			acquireSessionLock(${JSON.stringify(sessionId)}, ${JSON.stringify(cwd)}, process.pid);
			console.log("won");
			process.stdin.resume();
			await new Promise((r) => process.stdin.on("end", r));
		} catch (err) {
			console.log("lost: " + err.message.split("\\n")[0]);
		}
	`;

	try {
		writeFileSync(lockPath, JSON.stringify({ pid: deadPid() }), "utf8");

		const startAt = Date.now() + 1_500;
		const children = Array.from({ length: contenders }, () =>
			spawn(process.execPath, ["--input-type=module", "-e", script, String(startAt)], {
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		const firstLines = children.map(
			(child) =>
				new Promise<string>((resolveLine) => {
					let out = "";
					const done = () => resolveLine(out.split("\n")[0].trim());
					child.stdout.on("data", (d) => {
						out += d;
						if (out.includes("\n")) done();
					});
					child.stderr.on("data", (d) => (out += d));
					child.on("close", done);
				}),
		);
		const outputs = await Promise.all(firstLines);
		const closed = children.map((child) => new Promise((r) => (child.exitCode !== null ? r(null) : child.on("close", r))));
		for (const child of children) child.stdin.end();
		await Promise.all(closed);

		const winners = outputs.filter((o) => o === "won");
		assert.equal(winners.length, 1, `exactly one contender may hold the lock, got:\n${outputs.join("\n")}`);
		for (const o of outputs.filter((x) => x !== "won")) {
			assert.match(o, /^lost: Session .* (is currently in use|is being reclaimed)/);
		}
	} finally {
		cleanup(lockPath);
	}
});
