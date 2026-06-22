// Regression test for the "tick no resuelve proyecto" bug (Wave 1 handoff).
//
// RED:  the bootstrap env (IDU_PI_TICK_STATE_ROOT + AGENT_WORKSPACE_ROOT,
//       no IDU_PI_REGISTRY_PATH) → "No hay proyecto activo" (L946).
// GREEN: bootstrap env + IDU_PI_REGISTRY_PATH pointing at a registry
//       that has the real project registered → resolves cleanly.
//
// Spawns `node dist/src/cli.js idu-run-cron-preflight` with the same env
// vars the scheduled task sets, to mirror the real tick context (no
// DEFAULT_CWD, no inherited shell env).
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);

const CLI_PATH = join(process.cwd(), "dist", "src", "cli.js");
const HAS_DIST = existsSync(CLI_PATH);

type CliResult = { stdout: string; stderr: string; code: number | null };

async function runCli(env: Record<string, string | undefined>): Promise<CliResult> {
	try {
		const { stdout, stderr } = await execFile(
			process.execPath,
			[CLI_PATH, "idu-run-cron-preflight"],
			{
				env: { ...process.env, ...env },
				timeout: 30_000,
				windowsHide: true,
			},
		);
		return { stdout, stderr, code: 0 };
	} catch (err) {
		const e = err as {
			stdout?: string;
			stderr?: string;
			code?: number;
		};
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			code: typeof e.code === "number" ? e.code : null,
		};
	}
}

function makeRegistryWithProject(): {
	registryPath: string;
	stateRoot: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "idu-tick-resolve-"));
	const registryPath = join(root, "registry", "projects.json");
	const stateRoot = join(root, "state");
	mkdirSync(join(root, "registry"), { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	writeFileSync(
		registryPath,
		`${JSON.stringify(
			{
				activeProjectId: "tick-test-project",
				projects: [
					{
						id: "tick-test-project",
						name: "tick-test-project",
						path: stateRoot,
						stateRoot,
						lastSessionFile: null,
					},
				],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return {
		registryPath,
		stateRoot,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test(
	"RED: bootstrap env WITHOUT IDU_PI_REGISTRY_PATH does NOT resolve the active project (L946)",
	{ skip: !HAS_DIST ? "dist/src/cli.js not built (run `npx tsc -p tsconfig.json`)" : undefined },
	async () => {
		const { stateRoot, cleanup } = makeRegistryWithProject();
		try {
			const result = await runCli({
				IDU_PI_TICK_STATE_ROOT: stateRoot,
				AGENT_WORKSPACE_ROOT: stateRoot,
			});
			const out = `${result.stdout}\n${result.stderr}`;
			assert.match(
				out,
				/No hay proyecto activo/u,
				`expected L946 'No hay proyecto activo' without IDU_PI_REGISTRY_PATH, got: ${out}`,
			);
		} finally {
			cleanup();
		}
	},
);

test(
	"GREEN: bootstrap env WITH IDU_PI_REGISTRY_PATH resolves the active project (no L946)",
	{ skip: !HAS_DIST ? "dist/src/cli.js not built (run `npx tsc -p tsconfig.json`)" : undefined },
	async () => {
		const { registryPath, stateRoot, cleanup } = makeRegistryWithProject();
		try {
			const result = await runCli({
				IDU_PI_TICK_STATE_ROOT: stateRoot,
				AGENT_WORKSPACE_ROOT: stateRoot,
				IDU_PI_REGISTRY_PATH: registryPath,
			});
			const out = `${result.stdout}\n${result.stderr}`;
			assert.doesNotMatch(
				out,
				/No hay proyecto activo/u,
				`tick with IDU_PI_REGISTRY_PATH must NOT hit L946, got: ${out}`,
			);
		} finally {
			cleanup();
		}
	},
);

test(
	"bootstrap script writes IDU_PI_REGISTRY_PATH pointing at <workspaceRoot>/registry/projects.json (script source contract)",
	async () => {
		const fs = await import("node:fs");
		const install = fs.readFileSync(
			join(process.cwd(), "scripts", "install-supervisor-tick.ps1"),
			"utf8",
		);
		assert.match(
			install,
			/`\$env:IDU_PI_REGISTRY_PATH\s*=\s*"\$RegistryPath"/u,
			"install-supervisor-tick.ps1 must set $env:IDU_PI_REGISTRY_PATH in the bootstrap heredoc (the lever that unblocks the tick)",
		);
		assert.match(
			install,
			/`\$env:AGENT_WORKSPACE_ROOT\s*=\s*"\$WorkspaceRoot"/u,
			"install-supervisor-tick.ps1 must set $env:AGENT_WORKSPACE_ROOT in the bootstrap heredoc (workspace context for the runtime)",
		);
		assert.match(
			install,
			/Split-Path -Parent \(Split-Path -Parent/u,
			"install-supervisor-tick.ps1 must climb the projects/<id> segment to derive the workspace root (two Split-Path -Parent calls)",
		);
		assert.match(
			install,
			/registry\/projects\.json/u,
			"install-supervisor-tick.ps1 must point IDU_PI_REGISTRY_PATH at <workspaceRoot>/registry/projects.json (onboarding convention)",
		);
	},
);
