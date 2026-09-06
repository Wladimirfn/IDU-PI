/**
 * Worktree-aware project resolution overlay — shared module (A15).
 *
 * Source-of-truth decision: the canonical implementation that lived in
 * src/mcp-server.ts as `resolveWorktreeOverlay` (PR #289) is the source of
 * truth. It is the FULLEST result shape: it returns
 *   { resolved, projectId, projectPath, stateRoot, effectiveCwd },
 * which is a strict superset of the two duplicated overlays it replaces:
 *   - src/cli.ts `resolveWorktreeOverlayRuntime`     -> { resolved, projectId, effectiveCwd }
 *   - src/idu-installer.ts `resolveWorktreeOverlayInstaller` -> { resolved, projectId, stateRoot, effectiveCwd }
 * Unifying on the fullest shape means every call site still reads exactly the
 * fields it always read; the extra keys are harmless unused entries on the
 * returned object. No caller's public API or return contract changes.
 *
 * The three originals were behaviorally identical in logic: same ordered git
 * probes (`.git` presence, `--git-common-dir`, `--show-toplevel` round-trip,
 * common-dir match, `worktree list --porcelain` membership), same fail-closed
 * try/catch, same canonical-directory comparison. Their private path-compare
 * helpers (`samePath` / `sameRuntimePath`) were also behaviorally identical
 * (win32 lower-case fold, else identity, then ===). `canonicalDirectory` was
 * already imported from ./config.js by all three.
 *
 * The overlay-internal helpers below (git runner, canonical-common-dir,
 * porcelain membership, samePath) are kept module-private here so this file is
 * self-contained. The former host files retain their own private `samePath` /
 * `sameRuntimePath` for their non-overlay code; deduplicating that project-wide
 * idiom is out of scope for A15 (it lives in 5+ files and would touch sources
 * this slice is forbidden to modify). See SDD worktree-aware-project-resolution.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalDirectory } from "./config.js";
import type { ProjectRegistry } from "./projects.js";

/**
 * Git runner used by the worktree overlay. Returns trimmed-able stdout and
 * throws on nonzero exit / timeout, mirroring execFileSync semantics so the
 * overlay can fail closed uniformly.
 */
export type WorktreeGitRunner = (args: string[], cwd: string) => string;

export type WorktreeOverlayInput = {
	candidatePath: string;
	registry: ProjectRegistry;
	workspaceRoot: string;
	runGit?: WorktreeGitRunner;
};

export type WorktreeOverlayResult = {
	resolved: boolean;
	projectId?: string;
	projectPath?: string;
	stateRoot?: string;
	effectiveCwd?: string;
};

// Subprocess budget for git probes. Bounds T-Timeout: a hanging git is killed
// and surfaces as a thrown error, which the overlay turns into fail-closed.
const WORKTREE_GIT_TIMEOUT_MS = 5000;

function defaultWorktreeGitRunner(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: WORKTREE_GIT_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

// git rev-parse --git-common-dir may return a relative path (e.g. ".git" for a
// main repo). Resolve it against the cwd it was run from before canonicalizing.
function canonicalCommonDir(raw: string, cwd: string): string {
	const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
	return canonicalDirectory(absolute);
}

function porcelainListsWorktree(
	porcelain: string,
	candidateCanonical: string,
	cwd: string,
): boolean {
	for (const line of porcelain.split(/\r?\n/u)) {
		if (!line.startsWith("worktree ")) continue;
		const entry = line.slice("worktree ".length).trim();
		if (!entry) continue;
		try {
			const absolute = isAbsolute(entry) ? entry : resolve(cwd, entry);
			if (samePath(canonicalDirectory(absolute), candidateCanonical)) {
				return true;
			}
		} catch {
			continue;
		}
	}
	return false;
}

// Overlay-internal path compare. Win32 is case-insensitive (lower-case fold),
// other platforms compare verbatim. Behaviorally identical to the former
// private samePath in mcp-server.ts / idu-installer.ts and sameRuntimePath in
// cli.ts; kept private here (see file header).
function samePath(left: string, right: string): boolean {
	return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

/**
 * Worktree-aware project resolution overlay (Option A).
 *
 * Runs ONLY after exact-match registry lookup fails. Verifies, in order:
 *  1. candidate is a git top-level (`.git` present),
 *  2. `git rev-parse --git-common-dir` of the candidate,
 *  3. A3: `git rev-parse --show-toplevel` round-trips back to the candidate
 *     (blocks symlink bypass into a foreign repo),
 *  4. a registered project shares the same canonical common-dir,
 *  5. the candidate appears in that project's `git worktree list --porcelain`
 *     (blocks a crafted sibling that merely fakes the common-dir).
 *
 * On success returns the parent project's governance identity (projectId,
 * projectPath, stateRoot) plus effectiveCwd = the canonical worktree path.
 * Any subprocess error, parse error, or membership failure fails closed
 * ({ resolved: false }); authority is NEVER inherited silently.
 *
 * A15 resolved the earlier duplication: this is now the single tested
 * implementation consumed by src/mcp-server.ts, src/cli.ts, and
 * src/idu-installer.ts.
 */
export function resolveWorktreeOverlay(
	input: WorktreeOverlayInput,
): WorktreeOverlayResult {
	const runGit = input.runGit ?? defaultWorktreeGitRunner;
	try {
		// 1. candidate must look like a git top-level (worktree or main repo).
		if (!existsSync(join(input.candidatePath, ".git"))) {
			return { resolved: false };
		}

		// 2. candidate common-dir.
		const commonDirRaw = runGit(
			["rev-parse", "--git-common-dir"],
			input.candidatePath,
		).trim();
		if (!commonDirRaw) return { resolved: false };

		// 3. A3: show-toplevel must round-trip to the candidate canonical path.
		const toplevelRaw = runGit(
			["rev-parse", "--show-toplevel"],
			input.candidatePath,
		).trim();
		if (!toplevelRaw) return { resolved: false };

		const candidateCanonical = canonicalDirectory(input.candidatePath);
		const toplevelCanonical = canonicalDirectory(
			isAbsolute(toplevelRaw)
				? toplevelRaw
				: resolve(input.candidatePath, toplevelRaw),
		);
		if (!samePath(candidateCanonical, toplevelCanonical)) {
			return { resolved: false };
		}

		const candidateCommonDir = canonicalCommonDir(
			commonDirRaw,
			input.candidatePath,
		);

		// 4-5. find a registered project with a matching common-dir AND porcelain
		// membership for the candidate.
		for (const project of input.registry.projects) {
			try {
				const regCommonRaw = runGit(
					["rev-parse", "--git-common-dir"],
					project.path,
				).trim();
				if (!regCommonRaw) continue;
				if (
					!samePath(
						canonicalCommonDir(regCommonRaw, project.path),
						candidateCommonDir,
					)
				) {
					continue;
				}
				const porcelain = runGit(
					["worktree", "list", "--porcelain"],
					project.path,
				);
				if (!porcelainListsWorktree(porcelain, candidateCanonical, project.path)) {
					continue;
				}
				return {
					resolved: true,
					projectId: project.id,
					projectPath: project.path,
					stateRoot:
						project.stateRoot ??
						join(input.workspaceRoot, "projects", project.id),
					effectiveCwd: candidateCanonical,
				};
			} catch {
				// Fail closed per-project; try the next registered project.
				continue;
			}
		}
		return { resolved: false };
	} catch {
		// Fail closed on any unhandled subprocess / parse error.
		return { resolved: false };
	}
}
