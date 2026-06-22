import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatHygieneMigrateResult,
	parseHygieneMigrateArgs,
	runCliCommand,
	type CliRuntime,
} from "../src/cli.js";
import { callIduMcpTool } from "../src/mcp-server.js";
import { runIduBootstrap } from "../src/idu-bootstrap.js";
import type { BridgeConfig } from "../src/config.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-hygiene-cli-mcp-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function makeRepo(): { repoRoot: string; stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-hygiene-cli-mcp-"));
	const repoRoot = join(root, "repo");
	const stateRoot = join(root, "state");
	mkdirSync(repoRoot, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	return {
		repoRoot,
		stateRoot,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function writeJSON(path: string, obj: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

function fakeRuntime(repoRoot: string, stateRoot: string): CliRuntime {
	// The idu-hygiene-migrate case only reads projectPath + workspaceRoot
	// from the active runtime; the rest of CliRuntime is irrelevant for
	// these tests, so we cast through unknown to avoid building a full
	// fake runtime (see test/idu-cli.test.ts for the full mock).
	return {
		projectId: "hygiene-cli-mcp-test",
		projectPath: repoRoot,
		workspaceRoot: stateRoot,
	} as unknown as CliRuntime;
}

function makeConfig(root: string): BridgeConfig {
	return {
		telegramBotToken: "test-token",
		allowedUserId: 1,
		defaultCwd: root,
		allowedRoots: [root],
		agentWorkspaceRoot: join(root, "state"),
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

// =========================================================================
// Argument parser
// =========================================================================

test("parseHygieneMigrateArgs: accepts --repo-root <path>", () => {
	const parsed = parseHygieneMigrateArgs(["--repo-root", "C:/some/repo"]);
	assert.equal(parsed.repoRoot, "C:/some/repo");
});

test("parseHygieneMigrateArgs: accepts --repo-root=<path>", () => {
	const parsed = parseHygieneMigrateArgs(["--repo-root=C:/some/repo"]);
	assert.equal(parsed.repoRoot, "C:/some/repo");
});

test("parseHygieneMigrateArgs: no args -> empty object", () => {
	const parsed = parseHygieneMigrateArgs([]);
	assert.deepEqual(parsed, {});
});

test("parseHygieneMigrateArgs: throws on unknown flag", () => {
	assert.throws(
		() => parseHygieneMigrateArgs(["--unknown"]),
		/Flag desconocido/u,
	);
});

test("parseHygieneMigrateArgs: throws on --repo-root without value", () => {
	assert.throws(
		() => parseHygieneMigrateArgs(["--repo-root"]),
		/--repo-root requiere un valor/u,
	);
});

// =========================================================================
// CLI command
// =========================================================================

test("CLI idu-hygiene-migrate runs migrateHygieneLayout and returns moved/skipped/errors lines", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		// Seed legacy config/ with the 4 governance files
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });
		writeJSON(join(repoRoot, "config", "project-constitution.json"), {
			name: "const",
		});
		writeJSON(join(repoRoot, "config", "project-blueprint.json"), {
			name: "bp",
		});
		writeJSON(join(repoRoot, "config", "project-flows.json"), {
			name: "flows",
		});

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate", "--repo-root", repoRoot],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /moved: 4/u);
		assert.match(result.stdout, /skipped: 0/u);
		assert.match(result.stdout, /errors: 0/u);

		// All 4 files now in .idu/config/
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-core.json")),
		);
		assert.ok(
			existsSync(
				join(repoRoot, ".idu", "config", "project-constitution.json"),
			),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-blueprint.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-flows.json")),
		);
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate accepts --repo-root with = form", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate", `--repo-root=${repoRoot}`],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /moved: 1/u);
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate uses activeRuntime.projectPath when no --repo-root given", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /moved: 1/u);
		assert.match(result.stdout, new RegExp(`repoRoot: ${repoRoot.replace(/\\/gu, "\\\\")}`, "u"));
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate exit code 0 when no errors", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate", "--repo-root", repoRoot],
			runtime,
		);

		assert.equal(result.exitCode, 0);
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate prints Files: section when moved > 0", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate", "--repo-root", repoRoot],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Files:/u);
		assert.match(result.stdout, /project-core\.json/u);
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate alias hygiene-migrate works too", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["hygiene-migrate", "--repo-root", repoRoot],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /moved: 1/u);
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-migrate returns 0 when no legacy layout exists (idempotent)", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		const runtime = fakeRuntime(repoRoot, stateRoot);
		const result = await runCliCommand(
			["idu-hygiene-migrate", "--repo-root", repoRoot],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /moved: 0/u);
		assert.match(result.stdout, /skipped: 0/u);
		assert.match(result.stdout, /errors: 0/u);
	} finally {
		cleanup();
	}
});

test("formatHygieneMigrateResult includes moved, skipped, errors lines", () => {
	const text = formatHygieneMigrateResult("/repo", {
		moved: [{ from: "/repo/a", to: "/repo/.idu/a" }],
		skipped: [{ from: "/repo/b", reason: "test" }],
		errors: [],
	});
	assert.match(text, /repoRoot: \/repo/u);
	assert.match(text, /moved: 1/u);
	assert.match(text, /skipped: 1/u);
	assert.match(text, /errors: 0/u);
	assert.match(text, /Files:/u);
	assert.match(text, /Skipped:/u);
});

// =========================================================================
// MCP tool
// =========================================================================

function mcpOptions(repoRoot: string, stateRoot: string) {
	const runtime = fakeRuntime(repoRoot, stateRoot);
	const projectResolver = (): IduMcpProjectResolutionLike => ({
		status: "registered_project",
		projectId: "hygiene-cli-mcp-test",
		projectPath: repoRoot,
		stateRoot,
		safeNotes: [],
		errors: [],
	});
	const runtimeFactory = (): CliRuntime => runtime;
	return {
		runtimeFactory,
		projectResolver,
	};
}

// Minimal shape we need (matches IduMcpProjectResolution)
type IduMcpProjectResolutionLike = {
	status: string;
	projectId: string;
	projectPath: string;
	stateRoot: string;
	safeNotes: string[];
	errors: string[];
};

test("MCP idu_hygiene_migrate returns the full MigrationResult shape", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });
		writeJSON(join(repoRoot, "config", "project-constitution.json"), {
			name: "const",
		});

		const opts = mcpOptions(repoRoot, stateRoot);
		const result = await callIduMcpTool(
			"idu_hygiene_migrate",
			{ projectPath: repoRoot },
			opts as never,
		);

		assert.equal(result.tool, "idu_hygiene_migrate");
		assert.equal(result.ok, true);
		assert.match(result.summary, /moved=2/u);
		assert.match(result.summary, /skipped=0/u);
		assert.match(result.summary, /errors=0/u);

		const hygiene = (
			result.data as { hygiene?: { moved: unknown[]; skipped: unknown[]; errors: unknown[]; repoRoot: string } }
		).hygiene;
		assert.ok(hygiene, "expected `hygiene` payload in data");
		assert.equal(hygiene.repoRoot, repoRoot);
		assert.ok(Array.isArray(hygiene.moved));
		assert.ok(Array.isArray(hygiene.skipped));
		assert.ok(Array.isArray(hygiene.errors));
		assert.equal(hygiene.moved.length, 2);
		// Each moved entry has from + to
		for (const m of hygiene.moved as Array<{ from: string; to: string }>) {
			assert.equal(typeof m.from, "string");
			assert.equal(typeof m.to, "string");
		}
	} finally {
		cleanup();
	}
});

test("MCP idu_hygiene_migrate returns ok=false when no projectPath and runtime has no projectPath", async () => {
	const { stateRoot, cleanup } = makeRepo();
	try {
		// empty projectPath in args + runtime with empty projectPath
		const runtime = fakeRuntime("", stateRoot);
		const projectResolver = (): IduMcpProjectResolutionLike => ({
			status: "registered_project",
			projectId: "hygiene-cli-mcp-test",
			projectPath: "",
			stateRoot,
			safeNotes: [],
			errors: [],
		});
		const result = await callIduMcpTool(
			"idu_hygiene_migrate",
			{},
			{ runtimeFactory: () => runtime, projectResolver } as never,
		);
		assert.equal(result.ok, false);
		assert.equal(result.tool, "idu_hygiene_migrate");
		assert.match(result.summary, /requires/i);
	} finally {
		cleanup();
	}
});

test("MCP idu_hygiene_migrate is idempotent on second call", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRepo();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const opts = mcpOptions(repoRoot, stateRoot);
		const first = await callIduMcpTool(
			"idu_hygiene_migrate",
			{ projectPath: repoRoot },
			opts as never,
		);
		assert.match(first.summary, /moved=1/u);

		const second = await callIduMcpTool(
			"idu_hygiene_migrate",
			{ projectPath: repoRoot },
			opts as never,
		);
		assert.equal(second.ok, true);
		assert.match(second.summary, /moved=0/u);
	} finally {
		cleanup();
	}
});

// =========================================================================
// Bootstrap consent
// =========================================================================

test("Bootstrap consent: when .idu/ does not exist and consentGiven=false, throws", () => {
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "fresh-project");
		mkdirSync(projectPath, { recursive: true });
		assert.throws(
			() =>
				runIduBootstrap({
					projectPath,
					config: makeConfig(root),
					registryPath: join(root, "registry", "projects.json"),
					consentGiven: false,
				}),
			/Bootstrap cancelled: idu-pi requires consent/u,
		);
		// .idu/ was NOT created
		assert.equal(existsSync(join(projectPath, ".idu")), false);
	} finally {
		cleanup();
	}
});

test("Bootstrap consent: when .idu/ does not exist and consentGiven=undefined, also throws", () => {
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "fresh-project");
		mkdirSync(projectPath, { recursive: true });
		assert.throws(
			() =>
				runIduBootstrap({
					projectPath,
					config: makeConfig(root),
					registryPath: join(root, "registry", "projects.json"),
				}),
			/Bootstrap cancelled: idu-pi requires consent/u,
		);
	} finally {
		cleanup();
	}
});

test("Bootstrap consent: when .idu/ already exists, proceeds without explicit consent (implicit)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "project-with-idu");
		mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(projectPath, ".idu", "config", "project-core.json"),
			"{}",
			"utf8",
		);

		const result = runIduBootstrap({
			projectPath,
			config: makeConfig(root),
			registryPath: join(root, "registry", "projects.json"),
		});
		assert.ok(result.project);
		// Consent record was written
		const stateRoot = result.statePaths.stateRoot;
		const consentPath = join(stateRoot, "idu-bootstrap-consent.json");
		assert.ok(
			existsSync(consentPath),
			"consent record must be written to stateRoot",
		);
		const record = JSON.parse(readFileSync(consentPath, "utf8")) as {
			consentGiven: boolean;
			source: "explicit" | "implicit";
			iduDirExisted: boolean;
			ts: string;
		};
		assert.equal(record.consentGiven, true);
		assert.equal(record.source, "implicit");
		assert.equal(record.iduDirExisted, true);
		assert.ok(typeof record.ts === "string");
	} finally {
		cleanup();
	}
});

test("Bootstrap consent: explicit consentGiven=true records source='explicit'", () => {
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "fresh-project");
		mkdirSync(projectPath, { recursive: true });
		const result = runIduBootstrap({
			projectPath,
			config: makeConfig(root),
			registryPath: join(root, "registry", "projects.json"),
			consentGiven: true,
		});
		const stateRoot = result.statePaths.stateRoot;
		const consentPath = join(stateRoot, "idu-bootstrap-consent.json");
		assert.ok(existsSync(consentPath));
		const record = JSON.parse(readFileSync(consentPath, "utf8")) as {
			consentGiven: boolean;
			source: "explicit" | "implicit";
			iduDirExisted: boolean;
		};
		assert.equal(record.source, "explicit");
		assert.equal(record.iduDirExisted, false);
	} finally {
		cleanup();
	}
});

// =========================================================================
// Profile update
// =========================================================================

test("config/profiles/orchestrator.md contains Territory model keywords", () => {
	// Match the pattern from cli-commands-cold-start.test.ts:
	// import.meta.dirname is dist/test/, going up two levels reaches
	// the repo root where config/profiles/ lives.
	const profilePath = join(
		import.meta.dirname,
		"..",
		"..",
		"config",
		"profiles",
		"orchestrator.md",
	);
	assert.ok(existsSync(profilePath), `expected ${profilePath} to exist`);
	const contents = readFileSync(profilePath, "utf8");
	// The Territory model section must exist
	assert.match(contents, /##\s*Territory model/u);
	// Key keywords from the spec
	assert.match(contents, /stateRoot/u);
	assert.match(contents, /\.idu\//u);
	assert.match(contents, /idu-pi writes ONLY to two roots/u);
	assert.match(contents, /idu-pi never writes to/u);
	assert.match(contents, /consent/u);
	assert.match(contents, /idu-hygiene-migrate/u);
	assert.match(contents, /idu_hygiene_migrate/u);
	assert.match(contents, /Idempotent/u);
	assert.match(contents, /cross-device/u);
});
