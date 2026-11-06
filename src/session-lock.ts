import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ensureIduDirectories, IDU_LOCKS_DIR } from "./config.js";
import { errorCode } from "./errors.js";

export interface SessionLockHandle {
	lockPath: string;
	token: string;
	updatePid?: (newPid: number) => void;
	release: () => void;
}

/**
 * Remove a stale session lock without racing another reclaimer.
 *
 * Deleting the file directly is check-then-act: two processes can both decide
 * the lock is stale, and the second deletes the fresh lock the first just
 * wrote. rename() is atomic on the same volume, so only one process can move
 * the file and the loser gets ENOENT instead of stealing.
 */
export function reclaimStaleLock(lockPath: string): boolean {
	const quarantine = `${lockPath}.stale-${process.pid}-${randomUUID().slice(0, 8)}`;
	try {
		renameSync(lockPath, quarantine);
	} catch {
		return false;
	}
	try {
		unlinkSync(quarantine);
	} catch {
		// best effort: a leftover quarantine file is inert
	}
	return true;
}

export function acquireSessionLock(sessionId: string, cwd: string, currentPid: number): SessionLockHandle {
	ensureIduDirectories();
	const cwdHash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 8);
	const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const lockPath = join(IDU_LOCKS_DIR, `sess_${cwdHash}_${safeName}.lock`);
	const ownerPids = new Set<number>([currentPid]);

	const lockToken = randomUUID();
	const lockBody = (pid: number): string =>
		JSON.stringify({ pid, cwd: resolve(cwd), time: new Date().toISOString(), token: lockToken });

	const writeLockFile = (): boolean => {
		try {
			const fd = openSync(lockPath, "wx");
			writeFileSync(fd, lockBody(currentPid), "utf8");
			closeSync(fd);
			return true;
		} catch (err) {
			if (errorCode(err) === "EEXIST") {
				return false;
			}
			throw err;
		}
	};

	if (!writeLockFile()) {
		// Existing lock found, check if process is alive
		let lockData: { pid?: number; cwd?: string; time?: string } = {};
		let isCorrupted = false;

		try {
			const raw = readFileSync(lockPath, "utf8");
			lockData = JSON.parse(raw);
			if (typeof lockData.pid !== "number") {
				isCorrupted = true;
			}
		} catch {
			isCorrupted = true;
		}

		if (isCorrupted) {
			// Claim the corrupt lock atomically. A direct unlink lets two
			// processes both decide it is stale, and the later one deletes the
			// fresh lock the earlier one just wrote.
			if (!reclaimStaleLock(lockPath) || !writeLockFile()) {
				throw new Error(`Failed to acquire lock after removing corrupted lock for "${sessionId}".`);
			}
		} else if (lockData.pid) {
			try {
				process.kill(lockData.pid, 0);
				// Process is alive! Concurrency violation
				throw new Error(
					`Session "${sessionId}" is currently in use by active process (PID ${lockData.pid}). Use fork=true to branch or wait for completion.`,
				);
			} catch (err) {
				if (errorCode(err) === "EPERM") {
					// On Windows, EPERM means process is ALIVE with different permissions/elevation!
					// DO NOT STEAL THE LOCK!
					throw new Error(
						`Session "${sessionId}" is currently in use by active process (PID ${lockData.pid}). Use fork=true to branch or wait for completion.`,
					);
				} else if (errorCode(err) === "ESRCH") {
					// Process is dead: claim the stale lock atomically, then retry.
					// The loser of the claim must not delete the winner's fresh lock.
					if (!reclaimStaleLock(lockPath) || !writeLockFile()) {
						throw new Error(`Failed to acquire reclaimed session lock for "${sessionId}".`);
					}
				} else {
					throw err;
				}
			}
		}
	}

	return {
		lockPath,
		token: lockToken,
		updatePid: (newPid: number) => {
			ownerPids.add(newPid);
			try {
				// Replace by rename instead of truncate-then-write: a concurrent
				// reader must never see a half-written lock and call it corrupt.
				const tmpPath = `${lockPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
				writeFileSync(tmpPath, lockBody(newPid), "utf8");
				renameSync(tmpPath, lockPath);
			} catch {
				// best effort
			}
		},
		release: () => {
			// Move the lock aside, then decide. Reading before deleting let a
			// reclaimer replace the file between the check and the unlink, so a
			// process could delete a lock it does not own.
			const quarantine = `${lockPath}.release-${process.pid}-${randomUUID().slice(0, 8)}`;
			try {
				renameSync(lockPath, quarantine);
			} catch {
				return; // nothing to release
			}
			let ours = false;
			try {
				const data = JSON.parse(readFileSync(quarantine, "utf8"));
				ours = data.token === lockToken || (typeof data.pid === "number" && ownerPids.has(data.pid));
			} catch {
				ours = false;
			}
			try {
				if (ours) unlinkSync(quarantine);
				else renameSync(quarantine, lockPath); // not ours: put it back untouched
			} catch {
				// best effort
			}
		},
	};
}
