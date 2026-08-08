/**
 * config-dotenv-override.test.ts — IDU_PI_DOTENV_PATH override (issue #487).
 *
 * The dotenv resolution runs at module scope in src/config.ts, once per
 * process, so the override can't be patched through an in-process import
 * (the compiled module may already be cached by the test runner). Each
 * test spawns a fresh node process that imports the compiled config and
 * either boots loadConfig from the override file or fails at import time
 * when the override points at a missing file.
 *
 * Acceptance cases (issue #487):
 *  - override set + file exists -> loadConfig reads DEFAULT_CWD from that
 *    file (single source of truth for the deploy).
 *  - override set + file missing -> FAIL EARLY at import with a clear
 *    error ("install without .env -> RED", not a late
 *    "Missing required env var: DEFAULT_CWD").
 */

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
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);

const CONFIG_JS = resolve("dist/src/config.js");

type ProbeResult = {
	stdout: string;
	stderr: string;
	code: number | null;
};

function probeArgs(): string[] {
	const script = [
		`import { loadConfig } from ${JSON.stringify(pathToFileURL(CONFIG_JS).href)};`,
		`const config = loadConfig({ requireTelegram: false });`,
		`process.stdout.write("booted:" + config.defaultCwd);`,
	].join("\n");
	// --input-type=module allows top-level await and ESM import in -e.
	return ["--input-type=module", "-e", script];
}

async function runProbe(
	env: Record<string, string>,
): Promise<ProbeResult> {
	try {
		const { stdout, stderr } = await execFile(
			process.execPath,
			probeArgs(),
			{
				env: {
					PATH: process.env.PATH ?? "",
					SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
					...env,
				},
				windowsHide: true,
				timeout: 30_000,
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

test("IDU_PI_DOTENV_PATH override resolves and provides the config", async () => {
	assert.ok(
		existsSync(CONFIG_JS),
		`expected compiled ${CONFIG_JS} to exist (run the build first)`,
	);
	const root = mkdtempSync(join(tmpdir(), "idu-dotenv-override-ok-"));
	try {
		const envDir = join(root, "env");
		const workspace = join(root, "workspace");
		mkdirSync(envDir, { recursive: true });
		// DEFAULT_CWD must come from the override file, not from the
		// child env — otherwise the test can't tell the override apart
		// from a plain pass-through of the parent process env.
		const overridePath = join(root, ".env");
		writeFileSync(
			overridePath,
			[`DEFAULT_CWD=${envDir}`, `ALLOWED_ROOTS=${envDir}`].join("\n"),
			"utf8",
		);
		const result = await runProbe({
			IDU_PI_DOTENV_PATH: overridePath,
			AGENT_WORKSPACE_ROOT: workspace,
		});
		assert.equal(
			result.code,
			0,
			`config load with a valid override must succeed, stderr: ${result.stderr}`,
		);
		assert.equal(
			result.stdout,
			`booted:${envDir}`,
			`DEFAULT_CWD must be read from the override .env file, got: ${result.stdout}`,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("IDU_PI_DOTENV_PATH pointing at a missing file fails early (issue #487 acceptance)", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-dotenv-override-missing-"));
	try {
		const missingPath = join(root, "no-such.env");
		const result = await runProbe({
			IDU_PI_DOTENV_PATH: missingPath,
		});
		assert.notEqual(
			result.code,
			0,
			`a missing override file must fail the CLI boot (RED install), got code ${result.code}`,
		);
		assert.match(
			result.stderr,
			/IDU_PI_DOTENV_PATH/u,
			`early-fail error must name the env var, stderr: ${result.stderr}`,
		);
		assert.match(
			result.stderr,
			/does not exist/u,
			`early-fail error must be actionable (file does not exist), stderr: ${result.stderr}`,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});