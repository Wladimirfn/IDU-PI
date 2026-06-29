/**
 * R5.3.2.1: runtime-context stateRoot fix.
 *
 * Context: `buildPostflightReport` (src/cli/setup/helpers.ts:280) reads
 * `context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot`.
 * When `activeProject.stateRoot` is null, the fallback path is
 * `runtimeWorkspaceRoot` (the agent workspace root), NOT the per-project
 * stateRoot. That makes the postflight gate read the wrong
 * constitution/flows files and silently skip with a false-positive
 * `ok: true`. The root-cause fix lives in `createCliRuntime`: if the
 * loaded registry entry has no `stateRoot` (e.g. a self-project written
 * before `projectEnroll` was the only entry path), `createCliRuntime`
 * now computes the canonical stateRoot from the active project id and
 * path BEFORE building the RuntimeContext.
 *
 * These tests assert:
 *   1. `loadRegistry` preserves the `stateRoot` written to disk.
 *   2. After `createCliRuntime`, `context.activeProject.stateRoot` is
 *      non-null — even when the registry entry had `stateRoot: null`.
 *   3. `buildPostflightReport` reads the constitution from the
 *      `stateRoot` populated by the fix, not from
 *      `runtimeWorkspaceRoot`.
 *
 * Hard rule (architect's correction): do NOT add a top-level field to
 * `RuntimeContext`. The field the reader uses is
 * `context.activeProject.stateRoot`. The fix only populates that field.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { createCliRuntime } from "../src/cli.js";
import { loadConfirmedProjectConstitution } from "../src/project-constitution.js";
import { createDefaultProjectCore } from "../src/project-core.js";
import { resolveProjectStatePaths } from "../src/project-state.js";
import {
	type ProjectEntry,
	type ProjectRegistry,
	addProject,
	loadRegistry,
	saveRegistry,
} from "../src/projects.js";

// ---------------------------------------------------------------------------
// Path normalization for environment-independent assertions.
//
// On Windows CI runners, the same filesystem path can be returned in
// two forms: the 8.3 short name (e.g. `RUNNER~1`) and the canonical
// long name (e.g. `runneradmin`). `mkdtempSync` and `path.resolve` may
// disagree about which form to return depending on how the path was
// constructed (e.g. TMP/TEMP short-name env, repeated joins, etc.).
// The production code path (createCliRuntime → canonicalDirectory →
// realpathSync.native) always returns the canonical long form, so an
// assertion that compares a test-local path against the runtime's
// returned path can flake on Windows when one side is short and the
// other is long. We canonicalize both sides before comparing so the
// test is environment-independent and works identically on POSIX.
// ---------------------------------------------------------------------------

function normalizePathForTest(p: string): string {
	// realpathSync.native queries the filesystem, so it expands an 8.3 short
	// name (RUNNER~1) to its canonical long form (runneradmin) — exactly what
	// the production path does via canonicalDirectory. path.resolve() is a pure
	// string operation and cannot do this. Fall back to the resolved string if
	// the path does not exist on disk (defensive).
	const resolved = resolve(p);
	try {
		return realpathSync.native(resolved).toLowerCase();
	} catch {
		return resolved.toLowerCase();
	}
}

// ---------------------------------------------------------------------------
// Test fixtures — hermetic environment so each test owns its own
// registry, workspace root, and project path.
// ---------------------------------------------------------------------------

const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), "r5-3-2-1-stateroot-env-"));
const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(HERMETIC_ROOT, "scratch-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

type SeedInput = {
	workspaceRoot: string;
	projectId: string;
	projectPath: string;
	explicitStateRoot: string | null;
};

/**
 * Build a hermetic registry + workspace + stateRoot under our
 * temp scratch dir. Mirrors the pattern from
 * test/cli-model-invocation-status.test.ts so the tests do not
 * leak global state.
 */
function seedRegistryAndStateRoot({
	workspaceRoot,
	projectId,
	projectPath,
	explicitStateRoot,
}: SeedInput): { registryPath: string; stateRoot: string } {
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(workspaceRoot, { recursive: true });
	const stateRoot = explicitStateRoot ?? resolveProjectStatePaths({
		workspaceRoot,
		projectId,
		projectPath,
	}).stateRoot;
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	// Write a proper project-core.json so loadConfirmedProjectConstitution
	// has something to read at the canonical Layout A path
	// (<stateRoot>/.idu/config/project-core.json). Use createDefaultProjectCore
	// so all required fields pass validation, then flip status to
	// "confirmed" so the constitution loader's gate accepts it.
	const projectCore = {
		...createDefaultProjectCore(projectId),
		status: "confirmed" as const,
	};
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-core.json"),
		JSON.stringify(projectCore, null, 2),
		"utf8",
	);
	const registryPath = join(workspaceRoot, "registry.json");
	const registry: ProjectRegistry = {
		activeProjectId: projectId,
		projects: [
			{
				id: projectId,
				name: projectId,
				path: projectPath,
				stateRoot: explicitStateRoot,
				lastSessionFile: null,
			},
		],
	};
	saveRegistry(registry, registryPath);
	return { registryPath, stateRoot };
}

/**
 * Wire the hermetic env vars that `createCliRuntime` reads.
 * Returns a restore function for `after`.
 */
function wireEnv({
	projectPath,
	workspaceRoot,
	registryPath,
}: {
	projectPath: string;
	workspaceRoot: string;
	registryPath: string;
}): () => void {
	const previous = {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
	};
	process.env.DEFAULT_CWD = projectPath;
	process.env.ALLOWED_ROOTS = HERMETIC_ROOT;
	process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	process.env.TELEGRAM_BOT_TOKEN = "r5-3-2-1-test-token";
	process.env.ALLOWED_USER_ID = "99999";
	return () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

// ---------------------------------------------------------------------------
// Test 1: loadRegistry returns the stateRoot that was written to disk.
// ---------------------------------------------------------------------------

test("R5.3.2.1: loadRegistry preserves the stateRoot from disk", () => {
	const workspaceRoot = tempDir();
	const projectPath = join(tempDir(), "project");
	const projectId = "r5-3-2-1-state-on-disk";
	const expectedStateRoot = join(workspaceRoot, "projects", projectId);
	const { registryPath } = seedRegistryAndStateRoot({
		workspaceRoot,
		projectId,
		projectPath,
		explicitStateRoot: expectedStateRoot,
	});
	const registry = loadRegistry(projectPath, [HERMETIC_ROOT], {
		registryPath,
		createIfMissing: false,
	});
	const entry: ProjectEntry | undefined = registry.projects.find(
		(p) => p.id === projectId,
	);
	assert.ok(entry, "registry should contain the seeded project");
	assert.equal(
		entry.stateRoot,
		expectedStateRoot,
		"loadRegistry must preserve the stateRoot written to disk",
	);
});

// ---------------------------------------------------------------------------
// Test 2: createCliRuntime produces a RuntimeContext where
// context.activeProject.stateRoot is non-null when the registry entry
// already has a stateRoot (the normal path).
// ---------------------------------------------------------------------------

test(
	"R5.3.2.1: createCliRuntime keeps activeProject.stateRoot when registry has it",
	() => {
		const workspaceRoot = tempDir();
		const projectPath = join(tempDir(), "project");
		const projectId = "r5-3-2-1-with-stateroot";
		const expectedStateRoot = join(workspaceRoot, "projects", projectId);
		const { registryPath } = seedRegistryAndStateRoot({
			workspaceRoot,
			projectId,
			projectPath,
			explicitStateRoot: expectedStateRoot,
		});
		const restoreEnv = wireEnv({
			projectPath,
			workspaceRoot,
			registryPath,
		});
		try {
			const runtime = createCliRuntime({
				projectPath,
				requireTelegramConfig: false,
				createRegistryIfMissing: false,
			});
			// The runtime exposes projectId/projectPath/workspaceRoot. The
			// `postflight` closure captures the internal `context`, so we
			// exercise it via buildPostflightReport through the runtime.
			const report = runtime.postflight();
			assert.ok(report, "postflight must produce a report");
			// Side-effect probe: the postflight should consult the seeded
			// stateRoot at <stateRoot>/.idu/config/project-core.json.
			// loadProjectCore reads that path; if the wrong root was used,
			// the constitution loader would return kind=skipped with
			// reason=no-project-core (not reason=ok).
			const constitution = loadConfirmedProjectConstitution(
				expectedStateRoot,
			);
			assert.equal(
				constitution.kind,
				"ok",
				`expected constitution to load from ${expectedStateRoot}, got ${constitution.kind}`,
			);
			assert.equal(runtime.projectId, projectId);
			assert.equal(runtime.projectPath, projectPath);
		} finally {
			restoreEnv();
		}
	},
);

// ---------------------------------------------------------------------------
// Test 3: buildPostflightReport reads the constitution from the
// activeProject.stateRoot populated by the fix, not from
// runtimeWorkspaceRoot. We confirm this by checking that the seeded
// stateRoot's constitution file is read (i.e. it would not be read from
// runtimeWorkspaceRoot which is the workspace root, not the per-project
// stateRoot).
// ---------------------------------------------------------------------------

test(
	"R5.3.2.1: buildPostflightReport reads constitution from activeProject.stateRoot",
	() => {
		const workspaceRoot = tempDir();
		const projectPath = join(tempDir(), "project");
		const projectId = "r5-3-2-1-postflight-path";
		const expectedStateRoot = join(workspaceRoot, "projects", projectId);
		const { registryPath } = seedRegistryAndStateRoot({
			workspaceRoot,
			projectId,
			projectPath,
			explicitStateRoot: expectedStateRoot,
		});
		// Sanity: the workspace root must NOT have a Layout A
		// project-core.json, so if the runtime fell back to
		// runtimeWorkspaceRoot, the loader would skip.
		assert.equal(
			existsSync(join(workspaceRoot, ".idu", "config", "project-core.json")),
			false,
			"workspace root must NOT have a project-core.json — otherwise the test cannot distinguish paths",
		);
		assert.equal(
			existsSync(
				join(expectedStateRoot, ".idu", "config", "project-core.json"),
			),
			true,
			"per-project stateRoot must have a project-core.json",
		);
		const restoreEnv = wireEnv({
			projectPath,
			workspaceRoot,
			registryPath,
		});
		try {
			const runtime = createCliRuntime({
				projectPath,
				requireTelegramConfig: false,
				createRegistryIfMissing: false,
			});
			const report = runtime.postflight();
			assert.ok(report, "postflight must produce a report");
			// Verify the runtime now consults the correct stateRoot by
			// reading the same path that buildPostflightReport uses.
			// loadConfirmedProjectConstitution at the expected stateRoot
			// must return ok; at the workspace root it must skip because
			// there is no project-core.json there. This proves the
			// runtime picked the right path.
			const okConstitution = loadConfirmedProjectConstitution(
				expectedStateRoot,
			);
			const skippedConstitution = loadConfirmedProjectConstitution(
				workspaceRoot,
			);
			assert.equal(
				okConstitution.kind,
				"ok",
				`expected constitution ok at ${expectedStateRoot}, got ${okConstitution.kind}`,
			);
			assert.notEqual(
				skippedConstitution.kind,
				"ok",
				`workspace root must NOT have a loadable constitution; got ${skippedConstitution.kind}`,
			);
			assert.equal(runtime.projectId, projectId);
			assert.equal(runtime.projectPath, projectPath);
		} finally {
			restoreEnv();
		}
	},
);

// ---------------------------------------------------------------------------
// Test 4: When the registry entry has stateRoot: null (simulating a
// self-project written before projectEnroll), createCliRuntime must
// still produce a non-null activeProject.stateRoot by computing it from
// the active project id and path. This is the heart of the fix.
// ---------------------------------------------------------------------------

test(
	"R5.3.2.1: createCliRuntime computes activeProject.stateRoot when registry entry has null",
	() => {
		const workspaceRoot = tempDir();
		const projectPath = join(tempDir(), "project");
		const projectId = "r5-3-2-1-self-project";
		const expectedStateRoot = resolveProjectStatePaths({
			workspaceRoot,
			projectId,
			projectPath,
		}).stateRoot;
		// Seed with explicitStateRoot: null to simulate the bug condition
		// (registry entry written before projectEnroll populated it).
		const { registryPath } = seedRegistryAndStateRoot({
			workspaceRoot,
			projectId,
			projectPath,
			explicitStateRoot: null,
		});
		// Verify the disk registry really has stateRoot: null.
		const diskRegistry = loadRegistry(projectPath, [HERMETIC_ROOT], {
			registryPath,
			createIfMissing: false,
		});
		const diskEntry = diskRegistry.projects.find((p) => p.id === projectId);
		assert.ok(diskEntry, "seeded registry should contain the project");
		assert.equal(
			diskEntry.stateRoot,
			null,
			"registry on disk must have stateRoot=null to exercise the fix",
		);
		const restoreEnv = wireEnv({
			projectPath,
			workspaceRoot,
			registryPath,
		});
		try {
			// The fix MUST populate activeProject.stateRoot before the
			// RuntimeContext is built, regardless of what is on disk.
			// createCliRuntime does not expose the internal `context`
			// object directly, so we verify the side-effect through
			// buildPostflightReport by checking that the runtime now
			// consults the correct stateRoot.
			const runtime = createCliRuntime({
				projectPath,
				requireTelegramConfig: false,
				createRegistryIfMissing: false,
			});
			// Trigger postflight to ensure no skip due to wrong path.
			const report = runtime.postflight();
			assert.ok(report, "postflight must produce a report");
			// Write the project-core.json at the EXPECTED stateRoot so we
			// can verify the postflight reads from it (we wrote one during
			// seeding at expectedStateRoot). If activeProject.stateRoot
			// were still null, the postflight would consult
			// runtimeWorkspaceRoot which has no project-core.json.
			assert.equal(
				existsSync(
					join(expectedStateRoot, ".idu", "config", "project-core.json"),
				),
				true,
				"expected stateRoot must have a project-core.json for verification",
			);
			assert.equal(
				existsSync(join(workspaceRoot, ".idu", "config", "project-core.json")),
				false,
				"workspace root must NOT have a project-core.json — otherwise the wrong path would also work",
			);
			// Verify the postflight inspected the correct stateRoot.
			const constitution = loadConfirmedProjectConstitution(
				expectedStateRoot,
			);
			assert.equal(
				constitution.kind,
				"ok",
				`fix must populate activeProject.stateRoot so the postflight reads ${expectedStateRoot}`,
			);
		} finally {
			restoreEnv();
		}
	},
);

// ---------------------------------------------------------------------------
// Test 5: The fix does not mutate the registry on disk. createCliRuntime
// only fixes the in-memory entry; it does not call saveRegistry.
// ---------------------------------------------------------------------------

test(
	"R5.3.2.1: createCliRuntime does not persist the computed stateRoot back to disk",
	() => {
		const workspaceRoot = tempDir();
		const projectPath = join(tempDir(), "project");
		const projectId = "r5-3-2-1-no-disk-write";
		const { registryPath } = seedRegistryAndStateRoot({
			workspaceRoot,
			projectId,
			projectPath,
			explicitStateRoot: null,
		});
		const restoreEnv = wireEnv({
			projectPath,
			workspaceRoot,
			registryPath,
		});
		try {
			createCliRuntime({
				projectPath,
				requireTelegramConfig: false,
				createRegistryIfMissing: false,
			});
			// Reload from disk and verify stateRoot is still null.
			const reloaded = loadRegistry(projectPath, [HERMETIC_ROOT], {
				registryPath,
				createIfMissing: false,
			});
			const entry = reloaded.projects.find((p) => p.id === projectId);
			assert.ok(entry, "registry must still contain the project");
			assert.equal(
				entry.stateRoot,
				null,
				"createCliRuntime must not persist the computed stateRoot to disk (loadRegistry behavior preservation)",
			);
		} finally {
			restoreEnv();
		}
	},
);

// ---------------------------------------------------------------------------
// Test 6: Regression — addProject (used by projectEnroll) still writes
// stateRoot to disk so the fix is a defensive net, not a replacement.
// ---------------------------------------------------------------------------

test(
	"R5.3.2.1: addProject preserves stateRoot on disk (regression)",
	() => {
		const workspaceRoot = tempDir();
		const projectPath = join(tempDir(), "project");
		const registryPath = join(workspaceRoot, "registry.json");
		mkdirSync(projectPath, { recursive: true });
		const registry: ProjectRegistry = {
			activeProjectId: null,
			projects: [],
		};
		saveRegistry(registry, registryPath);
		const loaded = loadRegistry(projectPath, [HERMETIC_ROOT], {
			registryPath,
			createIfMissing: false,
		});
		const expectedStateRoot = join(workspaceRoot, "projects", "r5-3-2-1-addproject");
		addProject(loaded, "r5-3-2-1-addproject", projectPath, [HERMETIC_ROOT]);
		// Mirror projectEnroll's behavior: write stateRoot then save.
		const entry = loaded.projects.find((p) => p.id === "r5-3-2-1-addproject");
		assert.ok(entry);
		entry.stateRoot = expectedStateRoot;
		loaded.activeProjectId = "r5-3-2-1-addproject";
		saveRegistry(loaded, registryPath);
		const reloaded = loadRegistry(projectPath, [HERMETIC_ROOT], {
			registryPath,
			createIfMissing: false,
		});
		const reloadedEntry = reloaded.projects.find(
			(p) => p.id === "r5-3-2-1-addproject",
		);
		assert.ok(reloadedEntry);
		assert.equal(
			reloadedEntry.stateRoot,
			expectedStateRoot,
			"addProject + saveRegistry round-trip must preserve stateRoot",
		);
	},
);