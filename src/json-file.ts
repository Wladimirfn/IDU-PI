import { dirname, join } from "node:path";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { IDU_RUNTIME_DIR } from "./config.js";

/**
 * Write-then-rename, with a bounded retry for the Windows case where a reader
 * still holds the target open.
 *
 * Lives in its own module rather than in process-manager because the quota
 * cache needs it too, and process-manager already imports the quota layer.
 * Importing it back from there would close a cycle between two modules that
 * both matter.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
	writeTextAtomic(filePath, JSON.stringify(data, null, 2));
}

/** writeJsonAtomic for content that is already text. */
export function writeTextAtomic(filePath: string, text: string): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, text, "utf8");

	let retries = 5;
	while (retries > 0) {
		try {
			renameSync(tmpPath, filePath);
			return;
		} catch (err: unknown) {
			retries--;
			if (retries === 0) {
				// Last resort: overwrite in place. Atomicity is lost, but losing
				// the write entirely is worse than a torn read that a reader will
				// see as a parse error and retry.
				try {
					writeFileSync(filePath, text, "utf8");
					try {
						unlinkSync(tmpPath);
					} catch {
						/* the temp file is already orphaned */
					}
					return;
				} catch {
					throw err;
				}
			}
			const start = Date.now();
			while (Date.now() - start < 15) {
				/* brief spin, the lock is typically released in microseconds */
			}
		}
	}
}

/** Reads a JSON file, or null when it is missing, unreadable, or not valid. */
export function readJsonFile<T>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as T;
	} catch {
		// Deliberately does not surface the parse error. A JSON error message
		// quotes the surrounding raw text, and these files can sit next to
		// credentials. See src/quota.ts for the same rule applied there.
		return null;
	}
}

/** Thrown when a file mutex stays held past the caller's timeout. */
export class FileMutexBusyError extends Error {
	constructor(mutexPath: string) {
		super(`Timed out waiting for ${mutexPath}; another idu-pi process is holding it.`);
		this.name = "FileMutexBusyError";
	}
}

/** Blocks this thread for `ms` without spinning the CPU. */
export function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `fn` while holding an exclusive file mutex at `mutexPath`.
 *
 * For short read-then-write sections shared between processes (the session
 * lock's reclaim, the decision ledger's id, the session tree's compaction),
 * where an append or an exclusive create alone cannot hold the invariant.
 *
 * The mutex is a file created with O_EXCL. A holder that crashed leaves it
 * behind, so one older than `staleMs` is broken. Holders only keep it for a
 * few milliseconds, which is why a short `staleMs` is safe: a section that
 * legitimately ran for seconds would be the bug.
 */
export function withFileMutex<T>(
	mutexPath: string,
	fn: () => T,
	opts: { timeoutMs?: number; staleMs?: number } = {},
): T {
	const timeoutMs = opts.timeoutMs ?? 2_000;
	const staleMs = opts.staleMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;
	const dir = dirname(mutexPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	for (;;) {
		try {
			const fd = openSync(mutexPath, "wx");
			try {
				writeSync(fd, String(process.pid));
			} finally {
				closeSync(fd);
			}
			break;
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
		}
		try {
			if (Date.now() - statSync(mutexPath).mtimeMs > staleMs) {
				unlinkSync(mutexPath);
				continue;
			}
		} catch {
			// Released between our create and our stat: just try again.
			continue;
		}
		if (Date.now() > deadline) throw new FileMutexBusyError(mutexPath);
		sleepSync(10);
	}

	try {
		return fn();
	} finally {
		try {
			unlinkSync(mutexPath);
		} catch {
			/* already gone; nothing to release */
		}
	}
}

export const QUOTA_CACHE_PATH = join(IDU_RUNTIME_DIR, "quota-cache.json");
