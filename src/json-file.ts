import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");

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
					writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
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

export const QUOTA_CACHE_PATH = join(IDU_RUNTIME_DIR, "quota-cache.json");
