/**
 * sweep-command.ts — the orchestrator-side tool that takes a hygiene
 * advisory and proposes what to do. STRICTLY advisory — idu-pi never
 * deletes files in the user's repo from this module.
 *
 * Two modes (territoriality split):
 *   - `advisory` (default, exposed via CLI/MCP): proposes `rm <exact-path>`
 *     per vetted path in the user's repo. The orchestrator runs them.
 *   - `auto` (internal, NOT exposed via CLI/MCP): allows paths in
 *     `<stateRoot>/tmp/**` only. Used by the cron preflight to clean
 *     idu-pi's own scratch.
 *
 * SECURITY REFINEMENT (auditor-flagged, non-negotiable):
 *   - We NEVER propose `find -name 'pattern' -delete`. That re-evaluates
 *     the glob at sweep time and can grab files the sensor NEVER vetted
 *     (TOCTOU + over-broad). The sensor's findings[].path is the
 *     source of truth; the sweep proposes per-path `rm <exact-path>`.
 *   - Re-validates at sweep time: territoriality, pattern still matches,
 *     file still exists, symlink target inside repo.
 *   - The user's repo is the orchestrator's territory. idu-pi does NOT
 *     touch it. idu-pi only cleans its own `<stateRoot>/tmp/**`.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
	compileJunkPatterns,
	globToRegex,
	loadJunkPatterns,
} from "./junk-patterns.js";
import type { SensorResult } from "./hygiene-sensor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SweepMode = "advisory" | "auto";

export type SkippedReason =
	| "file no longer exists"
	| "pattern no longer matches"
	| "path resolves outside repo"
	| "territory: stateRoot"
	| "territory: .git"
	| "territory: .idu"
	| "territory: node_modules";

export type SkippedEntry = { path: string; reason: SkippedReason };

export type PlanSweepInput = {
	sensorOutput: SensorResult;
	stateRoot: string;
	repoPath: string;
	now?: Date;
	mode?: SweepMode;
};

export type PlanSweepResult = {
	/** Exact absolute paths to delete. */
	paths: string[];
	/** Suggested `rm <path>` per vetted path. NEVER `find -delete`. */
	commands: string[];
	/** Paths that failed re-validation, with reason. */
	skipped: SkippedEntry[];
	/** ISO timestamp of the revalidation. */
	revalidatedAt: string;
	/** Echo of the sensor's findings (idempotent input). */
	sensorSnapshot: {
		ts: string;
		findings: { path: string; pattern: string; fingerprint: string }[];
	};
};

// ---------------------------------------------------------------------------
// Core: planSweep
// ---------------------------------------------------------------------------

/**
 * Take a sensor output and produce a structured sweep plan.
 *
 * For each finding, re-validates:
 *   1. Territoriality: path is inside the user's repo (advisory) or
 *      inside <stateRoot>/tmp (auto). Otherwise SKIP.
 *   2. Protected dirs (.git, .idu, node_modules): always SKIP in both modes.
 *   3. Realpath: symlink target must be inside the user's repo. SKIP otherwise.
 *   4. Existence: file must still exist. SKIP otherwise.
 *   5. Pattern: file must still match a junk pattern. SKIP otherwise.
 *
 * The proposed commands are PER-PATH `rm <exact-path>` (shell-escaped).
 * NEVER `find -delete`. The path comes from `findings[].path` — the
 * sensor's exact snapshot. The sweep does not re-discover.
 */
export function planSweep(input: PlanSweepInput): PlanSweepResult {
	const mode: SweepMode = input.mode ?? "advisory";
	const now = (input.now ?? new Date()).toISOString();
	const stateRoot = input.stateRoot;
	const repoPath = input.repoPath;

	// Compile the junk patterns once for re-validation.
	const patterns = loadJunkPatterns(stateRoot);
	const compiled = compileJunkPatterns(patterns);
	const regexes = compiled.patterns.map(globToRegex);

	const paths: string[] = [];
	const commands: string[] = [];
	const skipped: SkippedEntry[] = [];

	for (const finding of input.sensorOutput.findings) {
		const absolutePath = finding.path;
		const reason = revalidate({
			path: absolutePath,
			repoPath,
			stateRoot,
			mode,
			regexes,
		});
		if (reason) {
			skipped.push({ path: absolutePath, reason });
			continue;
		}
		paths.push(absolutePath);
		// CRITICAL: per-path explicit `rm`. NEVER `find -delete`.
		commands.push(`rm ${shellEscape(absolutePath)}`);
	}

	return {
		paths,
		commands,
		skipped,
		revalidatedAt: now,
		sensorSnapshot: {
			ts: input.sensorOutput.now,
			findings: input.sensorOutput.findings.map((f) => ({
				path: f.path,
				pattern: f.pattern,
				fingerprint: f.fingerprint,
			})),
		},
	};
}

// ---------------------------------------------------------------------------
// Re-validation
// ---------------------------------------------------------------------------

function revalidate(input: {
	path: string;
	repoPath: string;
	stateRoot: string;
	mode: SweepMode;
	regexes: RegExp[];
}): SkippedReason | null {
	const { path: p, repoPath, stateRoot, mode, regexes } = input;

	// 1. Territoriality (mode-specific)
	if (mode === "advisory") {
		// In advisory mode, paths inside stateRoot are SKIPPED.
		// (idu-pi auto-cleans those via the internal `auto` mode.)
		if (isUnder(p, stateRoot)) {
			return "territory: stateRoot";
		}
	} else {
		// In auto mode, only <stateRoot>/tmp is allowed. Everything else
		// is SKIP (the user's repo is orchestrator territory).
		const tmpDir = join(stateRoot, "tmp");
		if (!isUnder(p, tmpDir)) {
			return "territory: stateRoot";
		}
	}

	// 2. Protected dirs (both modes)
	for (const dir of [".git", ".idu", "node_modules"]) {
		if (isUnder(p, join(repoPath, dir))) {
			// .git, .idu, node_modules — the dedupe makes the second-or-later
			// repeated return the same reason. We use `as SkippedReason` to
			// satisfy the type union.
			return `territory: ${dir}` as SkippedReason;
		}
	}

	// 3. Realpath: symlink target must be inside user's repo (advisory only)
	//    For stateRoot/tmp (auto mode), we trust the path; idu-pi owns it.
	if (mode === "advisory") {
		let real: string;
		try {
			real = realpathSync(p);
		} catch {
			// Realpath failed — likely the file no longer exists. We
			// continue and let the existence check below report the right
			// reason.
			real = p;
		}
		if (real !== p) {
			if (!isUnder(real, repoPath)) {
				return "path resolves outside repo";
			}
		}
	}

	// 4. Existence
	if (!existsSync(p)) {
		return "file no longer exists";
	}

	// 5. Pattern still matches (no false positives) — only in advisory mode
	//    Auto mode operates on idu-pi's own stateRoot/tmp, where the
	//    sensor already verified the patterns. We trust the sensor's
	//    snapshot in our own territory.
	if (mode === "advisory") {
		const relativePath = relative(repoPath, p).split(sep).join("/");
		const matches = regexes.some((re) => re.test(relativePath));
		if (!matches) {
			return "pattern no longer matches";
		}
	}

	return null;
}

/** True if `child` is the same as `parent` or under it. */
function isUnder(child: string, parent: string): boolean {
	if (child === parent) return true;
	return child.startsWith(parent + sep);
}

// ---------------------------------------------------------------------------
// shellEscape — safe single-quoting for `rm` command output
// ---------------------------------------------------------------------------

/**
 * Quote a path for shell. Single-quote with escaped single quotes.
 * Paths without shell-special characters pass through unquoted.
 */
export function shellEscape(path: string): string {
	if (!/[^A-Za-z0-9_\-./]/.test(path)) return path;
	return `'${path.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// autoCleanStateRoot (INTERNAL — only called by cron preflight)
// ---------------------------------------------------------------------------

export type AutoCleanResult = {
	cleaned: string[];
	errors: { path: string; message: string }[];
};

/**
 * idu-pi IS the owner of <stateRoot>/tmp. It can clean directly.
 * This is INTERNAL — not exposed via CLI or MCP. The cron preflight
 * calls this if a hygiene advisory points to stateRoot/tmp.
 *
 * Safety: this function NEVER touches the user's repo. It only operates
 * inside <stateRoot>/tmp. If the tmp dir doesn't exist, it's a no-op.
 */
export function autoCleanStateRoot(stateRoot: string): AutoCleanResult {
	const cleaned: string[] = [];
	const errors: { path: string; message: string }[] = [];

	const tmpDir = join(stateRoot, "tmp");
	if (!existsSync(tmpDir)) return { cleaned, errors };

	// Make sure tmpDir exists (it does, per the check above). Defensive
	// mkdirSync for callers that pass a stateRoot that doesn't have tmp.
	try {
		mkdirSync(tmpDir, { recursive: true });
	} catch {
		// Already exists or permission denied — let the readdir fail
		// and report the error.
	}

	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(tmpDir, { withFileTypes: true });
	} catch (err) {
		errors.push({ path: tmpDir, message: (err as Error).message });
		return { cleaned, errors };
	}

	for (const entry of entries) {
		const fullPath = join(tmpDir, entry.name);
		try {
			// Stat first to make sure we know what we're removing.
			statSync(fullPath);
			if (entry.isDirectory()) {
				rmSync(fullPath, { recursive: true, force: true });
			} else {
				unlinkSync(fullPath);
			}
			cleaned.push(fullPath);
		} catch (err) {
			errors.push({ path: fullPath, message: (err as Error).message });
		}
	}

	return { cleaned, errors };
}
