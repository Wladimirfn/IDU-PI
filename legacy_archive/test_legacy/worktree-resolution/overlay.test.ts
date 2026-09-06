import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalDirectory } from "../../src/config.js";
import {
	resolveWorktreeOverlay,
	type WorktreeGitRunner,
} from "../../src/mcp-server.js";
import type { ProjectRegistry } from "../../src/projects.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A real, committed git repository (the "main repo"). */
function makeMainRepo(): string {
	const repo = mkdtempSync(join(tmpdir(), "wt-resolver-main-"));
	git(["init"], repo);
	git(["config", "user.email", "test@example.com"], repo);
	git(["config", "user.name", "Test"], repo);
	git(["config", "core.autocrlf", "false"], repo);
	writeFileSync(join(repo, "README.md"), "base\n", "utf8");
	git(["add", "."], repo);
	git(["commit", "-m", "init"], repo);
	return repo;
}

/** A real linked worktree of `mainRepo` on a new branch. */
function makeWorktree(mainRepo: string): string {
	const wt = mkdtempSync(join(tmpdir(), "wt-resolver-wt-"));
	rmSync(wt, { recursive: true, force: true });
	git(["worktree", "add", wt, "-b", "feature-x"], mainRepo);
	return wt;
}

/**
 * On-disk fixture for deterministic injected-runner tests. Creates real
 * directories so canonicalDirectory()/realpath resolve without hitting git,
 * while the git answers themselves are supplied by an injected runner.
 */
function injectedFixture() {
	const base = mkdtempSync(join(tmpdir(), "wt-resolver-inj-"));
	const mainRepo = join(base, "main");
	const mainGit = join(mainRepo, ".git");
	const candidate = join(base, "candidate");
	mkdirSync(mainRepo, { recursive: true });
	mkdirSync(mainGit, { recursive: true });
	mkdirSync(candidate, { recursive: true });
	// A worktree exposes `.git` as a file; existsSync passes for a directory too.
	mkdirSync(join(candidate, ".git"), { recursive: true });
	return { base, mainRepo, mainGit, candidate };
}

function registryWith(
	mainPath: string,
	mainId: string,
	stateRoot?: string,
): ProjectRegistry {
	return {
		activeProjectId: mainId,
		projects: [
			{
				id: mainId,
				name: mainId,
				path: mainPath,
				stateRoot: stateRoot ?? null,
				lastSessionFile: null,
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Helper return shape + happy path (injected runner)
// ---------------------------------------------------------------------------

test("overlay resolves a worktree to its registered parent governance identity", () => {
	const fx = injectedFixture();
	const registry = registryWith(fx.mainRepo, "parent-proj");
	const runGit: WorktreeGitRunner = (args, cwd) => {
		if (args.includes("--git-common-dir")) return `${fx.mainGit}\n`;
		if (args.includes("--show-toplevel")) return `${cwd}\n`;
		if (args.includes("list")) return `worktree ${fx.candidate}\nHEAD x\n`;
		return "";
	};

	const result = resolveWorktreeOverlay({
		candidatePath: fx.candidate,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	assert.equal(result.resolved, true);
	assert.equal(result.projectId, "parent-proj");
	// Governance identity comes from the registered parent, NOT the worktree.
	assert.equal(result.projectPath, fx.mainRepo);
	// effectiveCwd is the canonical worktree path.
	assert.equal(result.effectiveCwd, canonicalDirectory(fx.candidate));
	// stateRoot is derived from the parent project when not registered.
	assert.equal(result.stateRoot, join(fx.base, "projects", "parent-proj"));
});

test("overlay reuses the registered stateRoot when present", () => {
	const fx = injectedFixture();
	const registeredStateRoot = join(fx.base, "projects", "parent-proj");
	const registry = registryWith(
		fx.mainRepo,
		"parent-proj",
		registeredStateRoot,
	);
	const runGit: WorktreeGitRunner = (args, cwd) => {
		if (args.includes("--git-common-dir")) return `${fx.mainGit}\n`;
		if (args.includes("--show-toplevel")) return `${cwd}\n`;
		if (args.includes("list")) return `worktree ${fx.candidate}\n`;
		return "";
	};

	const result = resolveWorktreeOverlay({
		candidatePath: fx.candidate,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	assert.equal(result.resolved, true);
	assert.equal(result.stateRoot, registeredStateRoot);
});

// ---------------------------------------------------------------------------
// T-Symlink-Foreign — A3 show-toplevel round-trip blocks symlink bypass
// ---------------------------------------------------------------------------

test("T-Symlink-Foreign: a show-toplevel that does not round-trip to the candidate is rejected", () => {
	const fx = injectedFixture();
	const foreign = join(fx.base, "foreign");
	mkdirSync(foreign, { recursive: true });
	const registry = registryWith(fx.mainRepo, "parent-proj");
	const runGit: WorktreeGitRunner = (args) => {
		if (args.includes("--git-common-dir")) return `${fx.mainGit}\n`;
		// show-toplevel points elsewhere (the effect of a symlink into a foreign repo)
		if (args.includes("--show-toplevel")) return `${foreign}\n`;
		if (args.includes("list")) return `worktree ${fx.candidate}\n`;
		return "";
	};

	const result = resolveWorktreeOverlay({
		candidatePath: fx.candidate,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	// A3 guard fails: toplevel canonical != candidate canonical.
	assert.equal(result.resolved, false);
	assert.equal(result.effectiveCwd, undefined);
});

// ---------------------------------------------------------------------------
// T-Crafted-Sibling — porcelain membership blocks a crafted sibling
// ---------------------------------------------------------------------------

test("T-Crafted-Sibling: a matching common-dir without porcelain membership is rejected", () => {
	const fx = injectedFixture();
	const sibling = join(fx.base, "sibling");
	mkdirSync(sibling, { recursive: true });
	mkdirSync(join(sibling, ".git"), { recursive: true });
	const registry = registryWith(fx.mainRepo, "parent-proj");
	const runGit: WorktreeGitRunner = (args, cwd) => {
		// Sibling claims the same common-dir as the registered parent...
		if (args.includes("--git-common-dir")) return `${fx.mainGit}\n`;
		if (args.includes("--show-toplevel")) return `${cwd}\n`;
		// ...but the registered parent does NOT list the sibling as a worktree.
		if (args.includes("list")) return `worktree ${fx.mainRepo}\nHEAD x\n`;
		return "";
	};

	const result = resolveWorktreeOverlay({
		candidatePath: sibling,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	assert.equal(result.resolved, false);
});

// ---------------------------------------------------------------------------
// T-NonGit-Cwd — a non-git cwd never invokes git
// ---------------------------------------------------------------------------

test("T-NonGit-Cwd: a directory without .git fails closed without invoking git", () => {
	const nonGit = mkdtempSync(join(tmpdir(), "wt-resolver-nongit-"));
	const registry = registryWith(nonGit, "x");
	let invoked = false;
	const runGit: WorktreeGitRunner = () => {
		invoked = true;
		return "";
	};

	const result = resolveWorktreeOverlay({
		candidatePath: nonGit,
		registry,
		workspaceRoot: nonGit,
		runGit,
	});

	assert.equal(result.resolved, false);
	assert.equal(invoked, false);
	rmSync(nonGit, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T-Exit-Nonzero — a subprocess nonzero exit fails closed
// ---------------------------------------------------------------------------

test("T-Exit-Nonzero: a git subprocess that exits nonzero fails closed", () => {
	const fx = injectedFixture();
	const registry = registryWith(fx.mainRepo, "parent-proj");
	const runGit: WorktreeGitRunner = () => {
		throw new Error("fatal: not a git repository (exit status 128)");
	};

	const result = resolveWorktreeOverlay({
		candidatePath: fx.candidate,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	assert.equal(result.resolved, false);
});

// ---------------------------------------------------------------------------
// T-Timeout — a mid-resolution timeout fails closed
// ---------------------------------------------------------------------------

test("T-Timeout: a git timeout mid-resolution fails closed", () => {
	const fx = injectedFixture();
	const registry = registryWith(fx.mainRepo, "parent-proj");
	let calls = 0;
	const runGit: WorktreeGitRunner = (args) => {
		calls += 1;
		if (args.includes("--git-common-dir")) return `${fx.mainGit}\n`;
		// --show-toplevel hangs and is killed by the bounded runner.
		throw new Error("git rev-parse timed out");
	};

	const result = resolveWorktreeOverlay({
		candidatePath: fx.candidate,
		registry,
		workspaceRoot: fx.base,
		runGit,
	});

	assert.equal(result.resolved, false);
	assert.ok(calls >= 1, "the overlay must attempt at least one git call");
});

// ---------------------------------------------------------------------------
// Real-git integration — proves the default (execFileSync) path resolves
// ---------------------------------------------------------------------------

test("real git: overlay resolves a genuine worktree to its parent with the default runner", () => {
	const mainRepo = makeMainRepo();
	const worktree = makeWorktree(mainRepo);
	const workspaceRoot = mkdtempSync(join(tmpdir(), "wt-resolver-ws-"));
	const registry = registryWith(mainRepo, "parent-proj");

	try {
		const result = resolveWorktreeOverlay({
			candidatePath: worktree,
			registry,
			workspaceRoot,
		});

		assert.equal(result.resolved, true);
		assert.equal(result.projectId, "parent-proj");
		assert.equal(result.projectPath, mainRepo);
		assert.equal(result.effectiveCwd, canonicalDirectory(worktree));
	} finally {
		try {
			git(["worktree", "remove", "--force", worktree], mainRepo);
		} catch {
			// best-effort cleanup
		}
		rmSync(mainRepo, { recursive: true, force: true });
		rmSync(workspaceRoot, { recursive: true, force: true });
	}
});

test("real git: exact-match project is unaffected (candidate is the main repo itself)", () => {
	const mainRepo = makeMainRepo();
	const workspaceRoot = mkdtempSync(join(tmpdir(), "wt-resolver-ws-"));
	const registry = registryWith(mainRepo, "parent-proj");

	try {
		const result = resolveWorktreeOverlay({
			candidatePath: mainRepo,
			registry,
			workspaceRoot,
		});

		// The main repo shares its own common-dir and lists itself as a worktree,
		// so the overlay legitimately resolves it to the registered parent.
		assert.equal(result.resolved, true);
		assert.equal(result.projectPath, mainRepo);
		assert.equal(result.effectiveCwd, canonicalDirectory(mainRepo));
	} finally {
		rmSync(mainRepo, { recursive: true, force: true });
		rmSync(workspaceRoot, { recursive: true, force: true });
	}
});

// Silence unused-import linter for existsSync (kept for fixture clarity).
void existsSync;
