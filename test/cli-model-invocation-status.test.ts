import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCliCommand } from "../src/cli.js";
import { createCliRuntime } from "../src/cli.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { addProject, loadRegistry, saveRegistry } from "../src/projects.js";
import type { IduModelRoleId } from "../src/model-invocation-log.js";

// Set up a hermetic environment so `createCliRuntime` resolves
// without leaking state into other test files in the same node --test
// process.
const HERMETIC_ROOT = mkdtempSync(
	join(tmpdir(), "idu-cli-model-invocation-env-"),
);
const HERMETIC_PROJECT = join(HERMETIC_ROOT, "project");
const HERMETIC_WORKSPACE = join(HERMETIC_ROOT, "workspace");
mkdirSync(HERMETIC_PROJECT, { recursive: true });
mkdirSync(HERMETIC_WORKSPACE, { recursive: true });
process.env.DEFAULT_CWD = HERMETIC_PROJECT;
process.env.ALLOWED_ROOTS = HERMETIC_ROOT;
process.env.AGENT_WORKSPACE_ROOT = HERMETIC_WORKSPACE;
process.env.IDU_PI_REGISTRY_PATH = join(
	HERMETIC_ROOT,
	"registry",
	"projects.json",
);
process.env.TELEGRAM_BOT_TOKEN = "cli-model-invocation-status-test-token";
delete process.env.ALLOWED_USER_ID;

type SeedRow = {
	role: IduModelRoleId;
	status: "success" | "failure" | "skipped";
	promptChars: number;
	responseChars: number;
	model: string;
	provider?: string;
	errorMessage?: string;
	ts?: string;
};

const tempRoots: string[] = [];

function tempDir(): string {
	// Place test scratch dirs under HERMETIC_ROOT so the
	// projectPath lives inside ALLOWED_ROOTS (which is the same
	// directory). This keeps each test hermetic while passing
	// `isAllowedCwd` in `createCliRuntime`.
	const dir = mkdtempSync(join(HERMETIC_ROOT, "scratch-"));
	tempRoots.push(dir);
	return dir;
}

/**
 * Build a hermetic CliRuntime rooted in `stateRoot`. The runtime
 * resolves to a fresh project in `stateRoot/projects/<id>` so the
 * `labDbPath` lives under our tmp dir. We then seed `lab.db` with
 * controlled rows via `appendInvocation`.
 */
function seedRuntimeWithInvocations(
	stateRoot: string,
	projectId: string,
	projectPath: string,
	rows: SeedRow[],
): ReturnType<typeof createCliRuntime> {
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(join(stateRoot, "projects", projectId), { recursive: true });
	const labDbPath = join(stateRoot, "projects", projectId, "lab.db");
	applyMigrations(labDbPath);
	const repository = new LabDbRepository(labDbPath);
	for (const row of rows) {
		repository.appendInvocation({
			role: row.role,
			provider: row.provider ?? "opencode-go",
			model: row.model,
			status: row.status,
			promptChars: row.promptChars,
			responseChars: row.responseChars,
			errorMessage: row.errorMessage,
			ts: row.ts,
		});
	}
	// Register the project so `createCliRuntime` finds an active project.
	process.env.AGENT_WORKSPACE_ROOT = stateRoot;
	const registryPath = join(stateRoot, "registry.json");
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	process.env.DEFAULT_CWD = projectPath;
	// Use createIfMissing: false so the registry starts empty and only
	// contains the seeded project. Otherwise `loadRegistry` would
	// auto-create a `{ id: "default", path: projectPath }` entry that
	// would win the `resolveRuntimeProject` `find` over the seeded
	// projectId and make the runtime read `stateRoot/projects/default/lab.db`.
	const registry = loadRegistry(projectPath, [HERMETIC_ROOT], {
		registryPath,
		createIfMissing: false,
	});
	addProject(registry, projectId, projectPath, [HERMETIC_ROOT]);
	registry.activeProjectId = projectId;
	saveRegistry(registry, registryPath);
	return createCliRuntime({ projectPath });
}

test("cli idu-model-invocation-status prints last 50 invocations grouped by role (default)", async () => {
	const stateRoot = tempDir();
	const projectId = "hermetic-pi-bridge";
	const projectPath = join(stateRoot, "repo");
	const rows: SeedRow[] = [
		{
			role: "supervisor-main",
			status: "success",
			promptChars: 412,
			responseChars: 901,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:45:11.000Z",
		},
		{
			role: "supervisor-main",
			status: "success",
			promptChars: 178,
			responseChars: 302,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:42:05.000Z",
		},
		{
			role: "supervisor-main",
			status: "failure",
			promptChars: 89,
			responseChars: 0,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:38:00.000Z",
			errorMessage: "ENOENT pi-cli",
		},
		{
			role: "agentlab-security",
			status: "success",
			promptChars: 2120,
			responseChars: 1402,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:30:00.000Z",
		},
		{
			role: "agentlab-architecture",
			status: "success",
			promptChars: 320,
			responseChars: 540,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:25:00.000Z",
		},
	];
	const runtime = seedRuntimeWithInvocations(
		stateRoot,
		projectId,
		projectPath,
		rows,
	);

	const result = await runCliCommand(["idu-model-invocation-status"], runtime);

	assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
	// The output must show the role groupings (▸ prefix) and column headers.
	assert.match(result.stdout, /▸ supervisor-main/u);
	assert.match(result.stdout, /▸ agentlab-security/u);
	assert.match(result.stdout, /▸ agentlab-architecture/u);
	// Columns required by REQ-B5-3: ts, role, provider, model, status, prompt_chars, response_chars.
	assert.match(result.stdout, /opencode-go\/deepseek-v4-pro/u);
	assert.match(result.stdout, /success/u);
	assert.match(result.stdout, /failure/u);
	// On failure rows the error_message replaces `out=...`.
	assert.match(result.stdout, /ENOENT pi-cli/u);
	// Total at the bottom.
	assert.match(result.stdout, /Total: 5 invocations across 3 roles\./u);
});

test("cli idu-model-invocation-status respects --limit N", async () => {
	const stateRoot = tempDir();
	const projectId = "hermetic-pi-bridge";
	const projectPath = join(stateRoot, "repo");
	const rows = Array.from({ length: 5 }, (_, index) => ({
		role: "supervisor-main" as const,
		status: "success" as const,
		promptChars: 100 + index,
		responseChars: 200 + index,
		model: "opencode-go/deepseek-v4-pro",
		ts: new Date(Date.UTC(2026, 5, 8, 13, 30 - index)).toISOString(),
	}));
	const runtime = seedRuntimeWithInvocations(
		stateRoot,
		projectId,
		projectPath,
		rows,
	);

	const result = await runCliCommand(
		["idu-model-invocation-status", "--limit", "2"],
		runtime,
	);

	assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
	// The supervisor-main group must contain only 2 rows.
	const groupMatch = /▸ supervisor-main[\s\S]*?(?=▸|Total:)/u.exec(
		result.stdout,
	);
	assert.ok(groupMatch, "expected supervisor-main group in output");
	const groupText = groupMatch[0];
	const linesWithStatus = groupText
		.split("\n")
		.filter((line) => /^\s*\d{4}-\d{2}-\d{2}T/u.test(line));
	assert.equal(linesWithStatus.length, 2);
	// Total reflects the limit (2) too.
	assert.match(result.stdout, /Total: 2 invocations across 1 roles?\./u);
});

test("cli idu-model-invocation-status --role filters to that role only", async () => {
	const stateRoot = tempDir();
	const projectId = "hermetic-pi-bridge";
	const projectPath = join(stateRoot, "repo");
	const rows: SeedRow[] = [
		{
			role: "supervisor-main",
			status: "success",
			promptChars: 100,
			responseChars: 200,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:45:11.000Z",
		},
		{
			role: "agentlab-security",
			status: "success",
			promptChars: 300,
			responseChars: 400,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:46:11.000Z",
		},
		{
			role: "agentlab-architecture",
			status: "success",
			promptChars: 500,
			responseChars: 600,
			model: "opencode-go/deepseek-v4-pro",
			ts: "2026-06-08T13:47:11.000Z",
		},
	];
	const runtime = seedRuntimeWithInvocations(
		stateRoot,
		projectId,
		projectPath,
		rows,
	);

	const result = await runCliCommand(
		["idu-model-invocation-status", "--role", "agentlab-security"],
		runtime,
	);

	assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
	assert.match(result.stdout, /▸ agentlab-security/u);
	assert.doesNotMatch(result.stdout, /▸ supervisor-main/u);
	assert.doesNotMatch(result.stdout, /▸ agentlab-architecture/u);
	assert.match(result.stdout, /Total: 1 invocations across 1 roles?\./u);
});

test("cli idu-model-invocation-status with empty lab.db prints a clean message and exits 0", async () => {
	const stateRoot = tempDir();
	const projectId = "hermetic-pi-bridge";
	const projectPath = join(stateRoot, "repo");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(join(stateRoot, "projects", projectId), { recursive: true });
	const labDbPath = join(stateRoot, "projects", projectId, "lab.db");
	applyMigrations(labDbPath);

	process.env.AGENT_WORKSPACE_ROOT = stateRoot;
	const registryPath = join(stateRoot, "registry.json");
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	process.env.DEFAULT_CWD = projectPath;
	const registry = loadRegistry(projectPath, [HERMETIC_ROOT], {
		registryPath,
		createIfMissing: true,
	});
	addProject(registry, projectId, projectPath, [HERMETIC_ROOT]);
	registry.activeProjectId = projectId;
	saveRegistry(registry, registryPath);
	const runtime = createCliRuntime({ projectPath });

	const result = await runCliCommand(["idu-model-invocation-status"], runtime);

	assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
	assert.match(result.stdout, /no invocations yet/u);
});

test("cli idu-model-invocation-status with a corrupt lab.db exits non-zero and reports a clear error", async () => {
	const stateRoot = tempDir();
	const projectId = "hermetic-pi-bridge";
	const projectPath = join(stateRoot, "repo");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(join(stateRoot, "projects", projectId), { recursive: true });
	const labDbPath = join(stateRoot, "projects", projectId, "lab.db");
	// Seed a non-SQLite file at the lab.db path.
	writeFileSync(labDbPath, "this is not a valid sqlite database", "utf8");

	process.env.AGENT_WORKSPACE_ROOT = stateRoot;
	const registryPath = join(stateRoot, "registry.json");
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	process.env.DEFAULT_CWD = projectPath;
	const registry = loadRegistry(projectPath, [HERMETIC_ROOT], {
		registryPath,
		createIfMissing: false,
	});
	addProject(registry, projectId, projectPath, [HERMETIC_ROOT]);
	registry.activeProjectId = projectId;
	saveRegistry(registry, registryPath);
	const runtime = createCliRuntime({ projectPath });

	const result = await runCliCommand(["idu-model-invocation-status"], runtime);

	assert.notEqual(result.exitCode, 0);
	assert.ok(
		/lab\.db|unreadable|corrupt|not a database|SQLite|sqlite/i.test(
			result.stderr,
		),
		`stderr did not mention lab.db: ${result.stderr}`,
	);
});

test.after(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
	await rm(HERMETIC_ROOT, { recursive: true, force: true });
});
