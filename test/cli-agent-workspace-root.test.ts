import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCliRuntime } from "../src/cli.js";
import { makeTempDir } from "./helpers/temp.js";

test("#423: CLI role clones use the global agent workspace root", async () => {
	const root = makeTempDir("idu-cli-agent-workspace-");
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "bridge-agents");
	const stateRoot = join(workspaceRoot, "projects", "project-a");
	const registryPath = join(workspaceRoot, "registry", "projects.json");
	const previous = {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		AGENT_WORKSPACE_MODE: process.env.AGENT_WORKSPACE_MODE,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		PI_BIN: process.env.PI_BIN,
	};

	try {
		mkdirSync(projectPath, { recursive: true });
		mkdirSync(join(workspaceRoot, "registry"), { recursive: true });
		mkdirSync(stateRoot, { recursive: true });
		writeFileSync(join(projectPath, "tracked.txt"), "fixture\n", "utf8");
		execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "Test"], {
			cwd: projectPath,
		});
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: projectPath,
		});
		execFileSync("git", ["add", "tracked.txt"], {
			cwd: projectPath,
			stdio: "ignore",
		});
		execFileSync("git", ["commit", "-m", "fixture"], {
			cwd: projectPath,
			stdio: "ignore",
		});

		writeFileSync(
			registryPath,
			JSON.stringify({
				activeProjectId: "project-a",
				projects: [
					{
						id: "project-a",
						name: "project-a",
						path: projectPath,
						stateRoot,
						lastSessionFile: null,
					},
				],
			}),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "model-assignments.json"),
			JSON.stringify({
				version: 1,
				assignments: { "agentlab-architecture": "test-provider/test-model" },
			}),
			"utf8",
		);

		process.env.DEFAULT_CWD = projectPath;
		process.env.ALLOWED_ROOTS = root;
		process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
		process.env.AGENT_WORKSPACE_MODE = "clone";
		process.env.IDU_PI_REGISTRY_PATH = registryPath;
		process.env.PI_BIN = join(root, "missing-pi-binary");

		const runtime = createCliRuntime({
			projectPath,
			requireTelegramConfig: false,
			createRegistryIfMissing: false,
		});
		assert.ok(runtime.promptForRole);
		await assert.rejects(runtime.promptForRole("agentlab-architecture", "audit"));

		assert.equal(
			existsSync(join(workspaceRoot, "workspaces", "project-a__agentlab-architecture")),
			true,
		);
		assert.equal(
			existsSync(join(stateRoot, "workspaces", "project-a__agentlab-architecture")),
			false,
		);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
