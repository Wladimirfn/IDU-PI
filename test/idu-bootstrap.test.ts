import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runIduBootstrap } from "../src/idu-bootstrap.js";
import type { BridgeConfig } from "../src/config.js";

function config(root: string): BridgeConfig {
	return {
		telegramBotToken: "test-token",
		allowedUserId: 1,
		defaultCwd: root,
		allowedRoots: [root],
		agentWorkspaceRoot: join(root, ".idu-state"),
		piBin: "pi",
		piArgs: [],
		agentProfiles: [
			{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		],
		agentWorkspaceMode: "clone",
		iduGovernance: {
			mcpAuthorityMode: "advisory",
			agentLabMode: "audit_only",
			workspaceOwner: "orchestrator",
			autoRefreshLabProfiles: true,
		},
	};
}

test("idu bootstrap enrolls project and creates state, core, constitution, blueprint, and flows", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-bootstrap-"));
	const projectPath = join(root, "project-a");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	try {
		const result = runIduBootstrap({
			projectPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});
		assert.equal(result.project.id, "project-a");
		assert.equal(result.shouldRunPrepare, true);
		assert.equal(existsSync(registryPath), true);
		assert.equal(existsSync(result.statePaths.stateRoot), true);
		assert.equal(existsSync(result.statePaths.agentLabReportsDir), true);
		assert.ok(result.created.includes(result.statePaths.stateRoot));
		assert.ok(result.created.includes(result.statePaths.reportsDir));
		// Slice 3/5: core now lives under stateRoot (Layout A). bootstrap inline
		// writes there, loader reads from there.
		assert.equal(
			existsSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-core.json"),
			),
			true,
		);
		// Issue #172: constitution writer swapped from projectPath to stateRoot,
		// closing the Slice 1 split-brain (loader reads from stateRoot, writer
		// used to write to projectPath). Constitution now lives under stateRoot
		// alongside core.
		assert.equal(
			existsSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-constitution.json"),
			),
			true,
		);
		// Slice 4/5: blueprint AND flows now live under stateRoot.
		assert.equal(
			existsSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-blueprint.json"),
			),
			true,
		);
		assert.equal(
			existsSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-flows.json"),
			),
			true,
		);
		const core = JSON.parse(
			readFileSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-core.json"),
				"utf8",
			),
		) as { status: string };
		assert.equal(core.status, "draft");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu bootstrap fast path does not rerun prepare when checkpoint and config already exist", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-bootstrap-repeat-"));
	const projectPath = join(root, "project-b");
	mkdirSync(projectPath, { recursive: true });
	const registryPath = join(root, "registry", "projects.json");
	try {
		const first = runIduBootstrap({
			projectPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});
		assert.equal(first.shouldRunPrepare, true);
		const second = runIduBootstrap({
			projectPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});
		assert.equal(second.alreadyBootstrapped, true);
		assert.equal(second.shouldRunPrepare, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu bootstrap allocates unique id instead of hijacking same-basename project", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-bootstrap-collision-"));
	const firstPath = join(root, "a", "same-name");
	const secondPath = join(root, "b", "same-name");
	const registryPath = join(root, "registry", "projects.json");
	try {
		mkdirSync(firstPath, { recursive: true });
		mkdirSync(secondPath, { recursive: true });
		const first = runIduBootstrap({
			projectPath: firstPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});
		const second = runIduBootstrap({
			projectPath: secondPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});
		assert.equal(first.project.id, "same-name");
		assert.equal(second.project.id, "same-name-2");
		const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
			projects: Array<{ id: string; path: string }>;
		};
		assert.equal(registry.projects.length, 2);
		assert.equal(
			realpathSync.native(registry.projects[0]?.path ?? ""),
			realpathSync.native(firstPath),
		);
		assert.equal(
			realpathSync.native(registry.projects[1]?.path ?? ""),
			realpathSync.native(secondPath),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu bootstrap refuses paths outside allowed roots", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-bootstrap-deny-"));
	const outside = mkdtempSync(join(tmpdir(), "idu-outside-"));
	try {
		assert.throws(
			() =>
				runIduBootstrap({
					projectPath: outside,
					config: config(root),
					registryPath: join(root, "registry.json"),
					consentGiven: true,
				}),
			/Ruta fuera de ALLOWED_ROOTS/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

// Issue #172 split-brain guard: the constitution writer at idu-bootstrap.ts:217
// used to write to `<projectPath>/.idu/config/project-constitution.json`, but
// loadProjectConstitution reads from `<stateRoot>/config/...` (Slice 1).
// This created a live split-brain: fresh bootstrap created constitution where
// the loader did not read. The fix moved the writer to stateRoot.
test("idu bootstrap writes constitution only under stateRoot (split-brain)", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-bootstrap-constitution-split-"));
	const projectPath = join(root, "project-split-brain");
	mkdirSync(projectPath, { recursive: true });
	// config(root) places stateRoot at <root>/.idu-state, which is OUTSIDE
	// projectPath. This is the test-bed for the split-brain assertion.
	const registryPath = join(root, "registry", "projects.json");
	try {
		const result = runIduBootstrap({
			projectPath,
			config: config(root),
			registryPath,
			consentGiven: true,
		});

		// Constitution lives under stateRoot (Layout B path, matching the loader).
		assert.equal(
			existsSync(
				join(
					result.statePaths.stateRoot,
					".idu",
					"config",
					"project-constitution.json",
				),
			),
			true,
			"constitution must exist under stateRoot",
		);
		// Anti-split-brain: bootstrap must NOT have written constitution under
		// projectPath (the original bug). The loader reads from stateRoot; if
		// bootstrap writes to projectPath, the loader silently misses it.
		assert.equal(
			existsSync(
				join(projectPath, ".idu", "config", "project-constitution.json"),
			),
			false,
			"constitution must NOT exist under projectPath",
		);
		assert.equal(
			existsSync(
				join(projectPath, "config", "project-constitution.json"),
			),
			false,
			"constitution must NOT exist under projectPath Layout B",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
