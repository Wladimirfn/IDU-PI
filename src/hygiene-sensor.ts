/**
 * hygiene-sensor.ts — walk a repo and report junk files matching the
 * canonical pattern set + per-project overrides.
 *
 * Inputs: stateRoot (where <stateRoot>/hygiene-patterns.json lives),
 * repoPath (the supervised project's working dir). The walker is bounded
 * by maxDepth (default 10) and maxFiles (default 50000) so it cannot run
 * away on pathological repos.
 *
 * Default exclusions (always skipped, regardless of patterns):
 *   - <repoPath>/.git/
 *   - <repoPath>/node_modules/
 *   - <repoPath>/.idu/        (idu-pi territory — don't scan our own governance)
 *   - <stateRoot>/             (state dir lives outside the repo)
 *
 * Performance: must complete in <2s for ~1k files on a typical machine.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
	compileJunkPatterns,
	globToRegex,
	loadJunkPatterns,
} from "./junk-patterns.js";

export type Finding = {
	/** Absolute path within repoPath (or absolute path under repoPath). */
	path: string;
	/** The pattern that matched (exact string from canonical/blocklist). */
	pattern: string;
	severity: "info";
	/** sha1 of the absolute path. Stable dedup key. */
	fingerprint: string;
};

export type SensorResult = {
	findings: Finding[];
	scannedPaths: number;
	matchedPaths: number;
	truncated: boolean;
	/** ISO timestamp of when the run completed. */
	now: string;
};

export type RunHygieneSensorInput = {
	stateRoot: string;
	repoPath: string;
	maxDepth?: number;
	maxFiles?: number;
	now?: Date;
};

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_FILES = 50_000;

const DEFAULT_EXCLUDED_DIR_NAMES = new Set([
	".git",
	"node_modules",
	".idu",
]);

/**
 * Run the hygiene sensor against a repo.
 *
 * - Reads `<stateRoot>/hygiene-patterns.json` (fail-safe).
 * - Walks `<repoPath>` recursively, honoring default exclusions.
 * - Matches each path against the compiled glob set.
 * - Returns findings + run metadata.
 *
 * The walker is bounded. If `maxFiles` is hit, the run stops and the
 * result is marked `truncated: true`. Callers should treat truncated
 * results as "incomplete — re-run later".
 */
export function runHygieneSensor(input: RunHygieneSensorInput): SensorResult {
	const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
	const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
	const now = input.now ?? new Date();
	const repoPath = input.repoPath;
	const stateRoot = input.stateRoot;

	const patterns = loadJunkPatterns(stateRoot);
	const compiled = compileJunkPatterns(patterns);
	const regexes = compiled.patterns.map((p) => ({
		pattern: p,
		re: globToRegex(p),
	}));
	// Allowlist is a path-level whitelist. A file path that matches an
	// allowlist glob is suppressed even if it would otherwise match a junk
	// pattern. This lets projects exempt legitimate files (e.g. a
	// whitelisted `tmp-debug.mjs` that the canonical `tmp-*.mjs` would
	// otherwise flag).
	const allowlistRegexes = patterns.allowlist.map((p) => ({
		pattern: p,
		re: globToRegex(p),
	}));

	const findings: Finding[] = [];
	let scannedPaths = 0;
	let matchedPaths = 0;
	let truncated = false;

	if (!existsSync(repoPath)) {
		return {
			findings: [],
			scannedPaths: 0,
			matchedPaths: 0,
			truncated: false,
			now: now.toISOString(),
		};
	}

	const stateAbs = safeRealpath(stateRoot);
	const repoAbs = safeRealpath(repoPath);

	walk(repoAbs, 0, maxDepth, maxFiles, {
		stateAbs,
		regexes,
		allowlistRegexes,
		onFile: (absolutePath) => {
			// Check BEFORE counting so scannedPaths never exceeds maxFiles.
			if (scannedPaths >= maxFiles) {
				truncated = true;
				return false;
			}
			scannedPaths += 1;
			// Compute the relative path from repo root, using forward slashes
			// for portable glob matching across OSes.
			const rel = toForwardSlash(relative(repoAbs, absolutePath));
			// Allowlist check first: if the path matches an allowlist glob,
			// skip it regardless of what junk patterns would say.
			for (const { re } of allowlistRegexes) {
				if (re.test(rel)) return true;
			}
			for (const { pattern, re } of regexes) {
				if (re.test(rel)) {
					matchedPaths += 1;
					findings.push({
						path: absolutePath,
						pattern,
						severity: "info",
						fingerprint: sha1(absolutePath),
					});
					break;
				}
			}
			return true;
		},
		shouldStop: () => truncated,
	});

	return {
		findings,
		scannedPaths,
		matchedPaths,
		truncated,
		now: now.toISOString(),
	};
}

type WalkCallbacks = {
	stateAbs: string;
	regexes: Array<{ pattern: string; re: RegExp }>;
	allowlistRegexes: Array<{ pattern: string; re: RegExp }>;
	onFile: (absolutePath: string) => boolean; // returns false to stop
	shouldStop: () => boolean;
};

/**
 * Recursive walker. Returns true to continue, false to stop early.
 *
 * Skips:
 *   - Default-excluded directory names (`.git`, `node_modules`, `.idu`).
 *   - Anything inside `<stateRoot>/` (if stateRoot lives inside repoPath).
 *   - Anything beyond `maxDepth`.
 *   - Anything after `maxFiles` files have been scanned.
 */
function walk(
	dir: string,
	depth: number,
	maxDepth: number,
	maxFiles: number,
	cb: WalkCallbacks,
): boolean {
	if (cb.shouldStop()) return false;
	if (depth > maxDepth) return true;
	if (!existsSync(dir)) return true;

	// If this directory is inside stateRoot, skip the whole subtree.
	if (isInside(dir, cb.stateAbs)) return true;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return true; // permission error etc. — skip and continue
	}

	for (const entry of entries) {
		if (cb.shouldStop()) return false;
		const fullPath = join(dir, entry);
		let stat;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}

		if (stat.isDirectory()) {
			if (DEFAULT_EXCLUDED_DIR_NAMES.has(entry)) continue;
			if (!walk(fullPath, depth + 1, maxDepth, maxFiles, cb)) return false;
			continue;
		}

		if (stat.isFile() || stat.isSymbolicLink()) {
			const keepGoing = cb.onFile(fullPath);
			if (!keepGoing) {
				// Caller signaled stop — propagate upward.
				return false;
			}
			// Belt-and-braces: if we somehow blew past maxFiles without
			// the onFile callback flagging it, stop now.
			if (cb.shouldStop()) return false;
		}
	}

	// Suppress unused-var lint for maxFiles (the onFile callback enforces it).
	void maxFiles;
	return true;
}

function sha1(input: string): string {
	return createHash("sha1").update(input).digest("hex");
}

function toForwardSlash(p: string): string {
	return p.split(sep).join("/");
}

function isInside(child: string, parent: string): boolean {
	if (child === parent) return true;
	const rel = relative(parent, child);
	if (!rel) return false;
	if (rel.startsWith("..")) return false;
	return true;
}

/**
 * best-effort realpath. Falls back to the input on error (permission,
 * cross-drive on Windows). Used so the stateRoot exclusion is robust
 * to symlinks/junctions.
 */
function safeRealpath(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}