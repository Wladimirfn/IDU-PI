/**
 * lockfile-cleanup-command.test.ts — WU-3 tests for the CLI-only safe
 * lockfile cleanup surface (spec #3098 rev4, design #3099 rev3).
 *
 * Coverage:
 *   - classifyLockfile: every verdict (eligible + all refused variants)
 *   - listLockfiles: read-only, deletes nothing
 *   - cleanupStaleLockfiles: confirm-gated, verified-dead-gated delete
 *   - runLockCleanup: command-level output + exit codes
 *   - parseLockCleanupArgs: flag parsing
 *   - structural invariant: cleanup is CLI-only (no production auto-caller)
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
import {
	classifyLockfile,
	cleanupStaleLockfiles,
	listLockfiles,
} from "../src/state-root-file-lock.js";
import {
	parseLockCleanupArgs,
	runLockCleanup,
} from "../src/lockfile-cleanup-command.js";

function tempDir(prefix = "idu-lockcleanup-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeLock(
	dir: string,
	name: string,
	content: Record<string, unknown> | string,
): string {
	const lockPath = join(dir, name);
	writeFileSync(lockPath, typeof content === "string" ? content : JSON.stringify(content));
	return lockPath;
}

// ---------------------------------------------------------------------------
// classifyLockfile — verdict matrix
// ---------------------------------------------------------------------------

test("classifyLockfile: verified-dead local pid → eligible:verified-dead-local", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		const childPid = child.pid!;
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);

		let dead = false;
		try {
			process.kill(childPid, 0);
		} catch (err) {
			dead = (err as NodeJS.ErrnoException).code === "ESRCH";
		}
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child");
			return;
		}

		const lockPath = writeLock(dir, "hist.lock", {
			pid: childPid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "dead-token",
			host: hostname(),
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "eligible:verified-dead-local");
		assert.equal(listing.lockPath, lockPath);
		assert.equal(listing.holderPid, childPid);
		assert.equal(listing.holderHost, hostname());
		assert.equal(listing.holderStartedAt, "2026-01-01T00:00:00.000Z");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* already dead */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: alive local pid → refused:alive-local", () => {
	const dir = tempDir();
	try {
		const lockPath = writeLock(dir, "hist.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "alive-token",
			host: hostname(),
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:alive-local");
		assert.equal(listing.holderPid, process.pid);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: remote host → refused:remote-host", () => {
	const dir = tempDir();
	try {
		const lockPath = writeLock(dir, "hist.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "remote-token",
			host: "A-DIFFERENT-HOST",
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:remote-host");
		assert.equal(listing.holderHost, "A-DIFFERENT-HOST");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: non-JSON garbage → refused:malformed", () => {
	const dir = tempDir();
	try {
		const lockPath = writeLock(dir, "hist.lock", "{{not json");
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:malformed");
		assert.equal(listing.holderPid, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: JSON but missing host (valid pid) → refused:malformed", () => {
	const dir = tempDir();
	try {
		// Valid positive pid but no host field: cannot satisfy "current host"
		// eligibility gate → structural malformation (not pid-specific).
		const lockPath = writeLock(dir, "hist.lock", {
			pid: 12345,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "x",
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:malformed");
		assert.equal(listing.holderPid, 12345);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: JSON array (not an object) → refused:malformed", () => {
	const dir = tempDir();
	try {
		const lockPath = writeLock(dir, "hist.lock", [1, 2, 3] as unknown as Record<string, unknown>);
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:malformed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: zero / negative / missing pid → refused:malformed-pid", () => {
	const dir = tempDir();
	try {
		for (const pid of [0, -1] as const) {
			const lockPath = writeLock(dir, `z${pid}.lock`, {
				pid,
				startedAt: "2026-01-01T00:00:00.000Z",
				token: "x",
				host: hostname(),
			});
			assert.equal(
				classifyLockfile(lockPath).verdict,
				"refused:malformed-pid",
				`pid ${pid} must be refused:malformed-pid`,
			);
		}
		// Missing pid field entirely.
		const lockPath = writeLock(dir, "missing.lock", {
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "x",
			host: hostname(),
		});
		assert.equal(classifyLockfile(lockPath).verdict, "refused:malformed-pid");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: EPERM pid probe → refused:pid-probe-error", async (t) => {
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
		const lockPath = writeLock(dir, "hist.lock", {
			pid: epermPid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "eperm-token",
			host: hostname(),
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:pid-probe-error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("classifyLockfile: PID-recycled (alive child) → refused:alive-local", async () => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		await sleep(150);
		const lockPath = writeLock(dir, "hist.lock", {
			pid: child.pid,
			startedAt: new Date().toISOString(),
			token: "recycled-token",
			host: hostname(),
		});
		const listing = classifyLockfile(lockPath);
		assert.equal(listing.verdict, "refused:alive-local");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* ignore */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// listLockfiles — read-only, deletes nothing
// ---------------------------------------------------------------------------

test("listLockfiles: read-only listing of *.lock with verdicts; non-.lock ignored; deletes nothing", () => {
	const dir = tempDir();
	try {
		writeLock(dir, "alive.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "a",
			host: hostname(),
		});
		writeLock(dir, "garbage.lock", "{{bad");
		writeFileSync(join(dir, "not-a-lock.json"), "{}");
		const before = timestamps(join(dir, "alive.lock"));

		const listings = listLockfiles(dir);
		assert.equal(listings.length, 2, "only *.lock files listed");
		const verdicts = listings.map((l) => l.verdict).sort();
		assert.ok(verdicts.includes("refused:alive-local"));
		assert.ok(verdicts.includes("refused:malformed"));

		// Read-only: the alive lockfile is untouched.
		const after = timestamps(join(dir, "alive.lock"));
		assert.equal(after.mtimeMs, before.mtimeMs);
		assert.equal(existsSync(join(dir, "alive.lock")), true);
		assert.equal(existsSync(join(dir, "garbage.lock")), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("listLockfiles: missing directory returns empty list (no throw)", () => {
	assert.deepEqual(listLockfiles(join(tmpdir(), "does-not-exist-lockcleanup")), []);
});

// ---------------------------------------------------------------------------
// cleanupStaleLockfiles — confirm-gated, verified-dead-gated delete
// ---------------------------------------------------------------------------

test("cleanupStaleLockfiles: confirmDelete=false refuses all, deletes nothing, exit 0", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		const childPid = child.pid!;
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);
		let dead = false;
		try {
			process.kill(childPid, 0);
		} catch (err) {
			dead = (err as NodeJS.ErrnoException).code === "ESRCH";
		}
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child");
			return;
		}

		const deadLock = writeLock(dir, "dead.lock", {
			pid: childPid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "d",
			host: hostname(),
		});

		const result = await cleanupStaleLockfiles(dir, { confirmDelete: false });
		assert.equal(result.exitCode, 0);
		const allRefused = result.actions.every((a) => a.action === "refused");
		assert.ok(allRefused, "no-confirm mode refuses every entry");
		assert.equal(existsSync(deadLock), true, "dead lockfile must NOT be deleted without confirm");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* already dead */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cleanupStaleLockfiles: confirmDelete=true deletes ONLY verified-dead, exit 0", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		const childPid = child.pid!;
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);
		let dead = false;
		try {
			process.kill(childPid, 0);
		} catch (err) {
			dead = (err as NodeJS.ErrnoException).code === "ESRCH";
		}
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child");
			return;
		}

		const deadLock = writeLock(dir, "dead.lock", {
			pid: childPid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "d",
			host: hostname(),
		});
		const aliveLock = writeLock(dir, "alive.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "a",
			host: hostname(),
		});

		const result = await cleanupStaleLockfiles(dir, { confirmDelete: true });
		const deleted = result.actions.filter((a) => a.action === "deleted");
		const refused = result.actions.filter((a) => a.action === "refused");
		assert.equal(deleted.length, 1, "exactly the verified-dead lockfile deleted");
		assert.equal(deleted[0]!.lockPath, deadLock);
		assert.equal(deleted[0]!.pid, childPid);
		assert.ok(refused.length >= 1, "alive lockfile refused");
		assert.equal(existsSync(deadLock), false, "dead lockfile deleted");
		assert.equal(existsSync(aliveLock), true, "alive lockfile untouched");
		// All-eligible batch (only the dead one) → exit 0 since the alive is
		// legitimately refused; exit code reflects any refusal.
		assert.equal(result.exitCode, 1, "non-zero because the alive entry was refused");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* already dead */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cleanupStaleLockfiles: confirmDelete=true on all-eligible batch exits 0", async (t) => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		const childPid = child.pid!;
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);
		let dead = false;
		try {
			process.kill(childPid, 0);
		} catch (err) {
			dead = (err as NodeJS.ErrnoException).code === "ESRCH";
		}
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child");
			return;
		}

		writeLock(dir, "dead.lock", {
			pid: childPid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "d",
			host: hostname(),
		});

		const result = await cleanupStaleLockfiles(dir, { confirmDelete: true });
		assert.equal(result.actions.length, 1);
		assert.equal(result.actions[0]!.action, "deleted");
		assert.equal(result.exitCode, 0, "no refusals → exit 0");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* already dead */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cleanupStaleLockfiles: confirmDelete=true refuses pid-recycled (alive) holder, exit 1", async () => {
	const dir = tempDir();
	let child: ReturnType<typeof spawn> | null = null;
	try {
		child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000);"], {
			stdio: "ignore",
		});
		await sleep(150);
		const lockPath = writeLock(dir, "recycled.lock", {
			pid: child.pid,
			startedAt: new Date().toISOString(),
			token: "r",
			host: hostname(),
		});

		const result = await cleanupStaleLockfiles(dir, { confirmDelete: true });
		assert.equal(result.exitCode, 1);
		const recycled = result.actions.find((a) => a.lockPath === lockPath);
		assert.ok(recycled, "recycled lockfile has an action");
		assert.equal(recycled!.action, "refused");
		assert.equal(recycled!.verdict, "refused:alive-local");
		assert.equal(existsSync(lockPath), true, "recycled lockfile must NOT be deleted");
	} finally {
		try {
			child?.kill("SIGKILL");
		} catch {
			/* ignore */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// runLockCleanup — command-level output + exit codes
// ---------------------------------------------------------------------------

test("runLockCleanup: read-only mode lists verdicts, deletes nothing, exit 0", async () => {
	const dir = tempDir();
	try {
		writeLock(dir, "alive.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "a",
			host: hostname(),
		});
		const result = await runLockCleanup({ targetDir: dir, confirm: false });
		assert.equal(result.exitCode, 0);
		assert.ok(result.stdout.includes("alive.lock"), "listing names the lockfile");
		assert.ok(result.stdout.includes("refused:alive-local"), "listing shows verdict");
		assert.ok(/read-only/iu.test(result.stdout), "output flags read-only mode");
		assert.equal(existsSync(join(dir, "alive.lock")), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runLockCleanup: confirm=true with only refusals exits 1 and deletes nothing", async () => {
	const dir = tempDir();
	try {
		const aliveLock = writeLock(dir, "alive.lock", {
			pid: process.pid,
			startedAt: "2026-01-01T00:00:00.000Z",
			token: "a",
			host: hostname(),
		});
		const result = await runLockCleanup({ targetDir: dir, confirm: true });
		assert.equal(result.exitCode, 1);
		assert.ok(result.stdout.includes("refused"), "refusal surfaced");
		assert.equal(existsSync(aliveLock), true, "alive lockfile untouched even with confirm");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runLockCleanup: empty directory → exit 0, no lockfiles", async () => {
	const dir = tempDir();
	try {
		const result = await runLockCleanup({ targetDir: dir, confirm: false });
		assert.equal(result.exitCode, 0);
		assert.ok(/no lockfiles/iu.test(result.stdout), "reports none found");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// parseLockCleanupArgs
// ---------------------------------------------------------------------------

test("parseLockCleanupArgs: defaults to read-only (confirm=false) with no flags", () => {
	assert.deepEqual(parseLockCleanupArgs([]), { confirm: false });
});

test("parseLockCleanupArgs: --confirm sets confirm=true", () => {
	assert.deepEqual(parseLockCleanupArgs(["--confirm"]), { confirm: true });
});

test("parseLockCleanupArgs: --state-root <path> captures stateRoot", () => {
	assert.deepEqual(parseLockCleanupArgs(["--state-root", "/tmp/x"]), {
		confirm: false,
		stateRoot: "/tmp/x",
	});
});

test("parseLockCleanupArgs: --state-root=<path> form captured", () => {
	assert.deepEqual(parseLockCleanupArgs(["--state-root=/var/sr"]), {
		confirm: false,
		stateRoot: "/var/sr",
	});
});

test("parseLockCleanupArgs: --confirm plus --state-root together", () => {
	assert.deepEqual(parseLockCleanupArgs(["--confirm", "--state-root", "/sr"]), {
		confirm: true,
		stateRoot: "/sr",
	});
});

// ---------------------------------------------------------------------------
// Structural invariant: cleanup is CLI-only (no production auto-caller)
// ---------------------------------------------------------------------------

test("structural invariant: cleanup primitives are never called from the automatic acquire path", () => {
	// The lock module source must not reference cleanup inside acquire.
	// HERE is dist/test; the .ts sources live at the repo root.
	const repoRoot = join(HERE, "..", "..");
	const src = readFileSync(
		join(repoRoot, "src", "state-root-file-lock.ts"),
		"utf8",
	);
	const acquireBlock = src.slice(
		src.indexOf("export async function acquireExclusiveFileLock"),
		src.indexOf("export async function releaseExclusiveFileLock"),
	);
	assert.ok(
		!/cleanupStaleLockfiles|classifyLockfile|listLockfiles/u.test(acquireBlock),
		"acquire must not call cleanup primitives",
	);
});

test("structural invariant: runLockCleanup has no production caller outside the CLI dispatch surface", () => {
	const repoRoot = join(HERE, "..", "..");
	const srcDir = join(repoRoot, "src");
	const allowed = new Set(
		[
			join(srcDir, "lockfile-cleanup-command.ts"),
			join(srcDir, "cli", "single", "handlers.ts"),
		].map((p) => relative(repoRoot, p).replace(/\\/gu, "/")),
	);
	const offenders: string[] = [];
	for (const file of walkTs(srcDir)) {
		const rel = relative(repoRoot, file).replace(/\\/gu, "/");
		const text = readFileSync(file, "utf8");
		if (/from\s+["'].*lockfile-cleanup-command/u.test(text) && !allowed.has(rel)) {
			offenders.push(rel);
		}
	}
	assert.deepEqual(offenders, [], "runLockCleanup must only be imported by the CLI surface");
});

// TOCTOU: dead lock swapped for a live one between listing and delete → survives (refused).
test("cleanupStaleLockfiles: dead lock replaced by live under gate → survives, refused", async (t) => {
	const dir = tempDir();
	const child = spawn(process.execPath, ["-e", "setInterval(()=>{},6e4)"], {
		stdio: "ignore",
	});
	const childPid = child.pid!;
	try {
		await sleep(150);
		child.kill("SIGKILL");
		await sleep(150);
		let dead = false;
		try { process.kill(childPid, 0); } catch (err) { dead = (err as NodeJS.ErrnoException).code === "ESRCH"; }
		if (!dead) {
			t.skip("platform does not report ESRCH for killed child");
			return;
		}

		const lockPath = writeLock(dir, "victim.lock", {
			pid: childPid, startedAt: "2026-01-01T00:00:00.000Z", token: "dead", host: hostname(),
		});

		const result = await cleanupStaleLockfiles(dir, {
			confirmDelete: true,
			onAfterListing: () => {
				// Between listing and delete, another process swaps the dead lock for a LIVE one.
				rmSync(lockPath, { force: true });
				writeLock(dir, "victim.lock", {
					pid: process.pid, startedAt: new Date().toISOString(), token: "live-replacement", host: hostname(),
				});
			},
		});

		const victim = result.actions.find((a) => a.lockPath === lockPath);
		assert.ok(victim, "victim lockfile has an action");
		assert.equal(victim!.action, "refused", "live replacement must NOT be deleted (TOCTOU)");
		assert.equal(existsSync(lockPath), true, "live replacement lockfile survives");
		assert.equal(result.exitCode, 1, "refusal → non-zero exit");
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already dead */
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

// Path confinement: --confirm must refuse before deletion when targetDir escapes allowedRoot.
test("runLockCleanup: confirm with external targetDir outside allowedRoot → refused, exit 1", async () => {
	const allowed = tempDir("idu-allowed-");
	const outside = tempDir("idu-outside-");
	try {
		const result = await runLockCleanup({ targetDir: outside, confirm: true, allowedRoot: allowed });
		assert.equal(result.exitCode, 1);
		assert.ok(/REFUSED|escapes/iu.test(result.stdout), "signals path-confinement refusal");
	} finally {
		rmSync(allowed, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("runLockCleanup: confirm with symlink escaping allowedRoot → refused", async (t) => {
	const allowed = tempDir("idu-allowed-");
	const outside = tempDir("idu-outside-");
	const link = join(allowed, "escaped-link");
	try {
		try { symlinkSync(outside, link); } catch { t.skip("symlink creation not supported on this platform"); return; }
		const result = await runLockCleanup({ targetDir: join(link, "reports"), confirm: true, allowedRoot: allowed });
		assert.equal(result.exitCode, 1);
		assert.ok(/REFUSED|escapes/iu.test(result.stdout), "symlink escape refused");
	} finally {
		rmSync(allowed, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

function walkTs(dir: string): string[] {
	const out: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkTs(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

function timestamps(path: string): { mtimeMs: number } {
	return { mtimeMs: statSync(path).mtimeMs };
}
