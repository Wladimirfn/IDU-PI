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
		// Territory model: governance files live under <repo>/.idu/config/.
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-core.json")),
			true,
		);
		assert.equal(
			existsSync(
				join(projectPath, ".idu", "config", "project-constitution.json"),
			),
			true,
		);
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
			true,
		);
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-flows.json")),
			true,
		);
		const core = JSON.parse(
			readFileSync(
				join(projectPath, ".idu", "config", "project-core.json"),
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
