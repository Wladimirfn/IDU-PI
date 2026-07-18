import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalDirectory } from "../../src/config.js";
import { resolveMcpProjectContext } from "../../src/mcp-server.js";
import {
	projectEnroll,
	projectInstallStatus,
} from "../../src/idu-installer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeBaseWithMainRepo(): { base: string; mainRepo: string } {
	const base = mkdtempSync(join(tmpdir(), "wt-wire-base-"));
	const mainRepo = join(base, "main");
	git(["init", mainRepo], base);
	git(["config", "user.email", "test@example.com"], mainRepo);
	git(["config", "user.name", "Test"], mainRepo);
	git(["config", "core.autocrlf", "false"], mainRepo);
	writeFileSync(join(mainRepo, "README.md"), "base\n", "utf8");
	git(["add", "."], mainRepo);
	git(["commit", "-m", "init"], mainRepo);
	return { base, mainRepo };
}

function addWorktree(mainRepo: string, base: string): string {
	const worktree = join(base, "wt");
	git(["worktree", "add", worktree, "-b", "feature-x"], mainRepo);
	return worktree;
}

const ENV_KEYS = [
	"DEFAULT_CWD",
	"ALLOWED_ROOTS",
	"AGENT_WORKSPACE_ROOT",
	"IDU_PI_REGISTRY_PATH",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
	const snapshot: Record<string, string | undefined> = {};
	for (const key of ENV_KEYS) snapshot[key] = process.env[key];
	return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const key of ENV_KEYS) {
		if (snapshot[key] === undefined) delete process.env[key];
		else process.env[key] = snapshot[key];
	}
}

// ---------------------------------------------------------------------------
// resolveMcpProjectContext — exact-match-first contract
// ---------------------------------------------------------------------------

test("exact-match-first: an exactly registered path resolves without effectiveCwd (overlay skipped)", () => {
	const { base, mainRepo } = makeBaseWithMainRepo();
	const workspaceRoot = join(base, "workspace");
	const registryPath = join(base, "registry", "projects.json");
	projectEnroll({
		projectPath: mainRepo,
		projectId: "main-proj",
		workspaceRoot,
		allowedRoots: [base],
		registryPath,
	});
	const snapshot = snapshotEnv();
	try {
		process.env.DEFAULT_CWD = base;
		process.env.ALLOWED_ROOTS = base;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.IDU_PI_REGISTRY_PATH = registryPath;

		const resolution = resolveMcpProjectContext(mainRepo);

		assert.equal(resolution.status, "registered_project");
		assert.equal(resolution.projectId, "main-proj");
		assert.equal(resolution.projectPath, canonicalDirectory(mainRepo));
		// Overlay is NOT consulted on exact match → no effectiveCwd.
		assert.equal(resolution.effectiveCwd, undefined);
	} finally {
		restoreEnv(snapshot);
		try {
			git(["worktree", "prune"], mainRepo);
		} catch {
			// best-effort
		}
		rmSync(base, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// resolveMcpProjectContext — worktree overlay wiring (end-to-end)
// ---------------------------------------------------------------------------

test("resolveMcpProjectContext: a worktree resolves to parent governance with effectiveCwd", () => {
	const { base, mainRepo } = makeBaseWithMainRepo();
	const worktree = addWorktree(mainRepo, base);
	const workspaceRoot = join(base, "workspace");
	const registryPath = join(base, "registry", "projects.json");
	projectEnroll({
		projectPath: mainRepo,
		projectId: "main-proj",
		workspaceRoot,
		allowedRoots: [base],
		registryPath,
	});
	const snapshot = snapshotEnv();
	try {
		process.env.DEFAULT_CWD = base;
		process.env.ALLOWED_ROOTS = base;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.IDU_PI_REGISTRY_PATH = registryPath;

		const resolution = resolveMcpProjectContext(worktree);

		assert.equal(resolution.status, "registered_project");
		// Governance identity comes from the enrolled parent, not the worktree.
		assert.equal(resolution.projectId, "main-proj");
		assert.equal(resolution.projectPath, canonicalDirectory(mainRepo));
		// The worktree path is surfaced as the effective cwd for git operations.
		assert.equal(resolution.effectiveCwd, canonicalDirectory(worktree));
	} finally {
		restoreEnv(snapshot);
		try {
			git(["worktree", "remove", "--force", worktree], mainRepo);
		} catch {
			// best-effort
		}
		rmSync(base, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// T-Parity-Installer — projectInstallStatus read-path overlay parity
// ---------------------------------------------------------------------------

test("T-Parity-Installer: projectInstallStatus resolves a worktree to its parent with effectiveCwd", () => {
	const { base, mainRepo } = makeBaseWithMainRepo();
	const worktree = addWorktree(mainRepo, base);
	const workspaceRoot = join(base, "workspace");
	const registryPath = join(base, "registry", "projects.json");
	const enroll = projectEnroll({
		projectPath: mainRepo,
		projectId: "main-proj",
		workspaceRoot,
		allowedRoots: [base],
		registryPath,
	});
	try {
		const status = projectInstallStatus({
			projectPath: worktree,
			workspaceRoot,
			allowedRoots: [base],
			registryPath,
			mcpAvailable: false,
		});

		// The worktree is recognized as the registered parent project.
		assert.equal(status.registered, true);
		assert.equal(status.projectId, "main-proj");
		// Governance stateRoot comes from the enrolled parent.
		assert.equal(status.stateRoot, enroll.project.stateRoot);
		// The worktree path is surfaced as the effective cwd.
		assert.equal(status.effectiveCwd, canonicalDirectory(worktree));
	} finally {
		try {
			git(["worktree", "remove", "--force", worktree], mainRepo);
		} catch {
			// best-effort
		}
		rmSync(base, { recursive: true, force: true });
	}
});
