/**
 * verify-deploy.test.ts — scripts/verify-deploy.ps1 (issue #487).
 *
 * The deployed compile must boot its config before the installer/updater
 * reports success. These tests run the real verify-deploy.ps1 against a
 * fake deploy root with a fake `node` shim on PATH (same harness pattern
 * as idu-supervisor-tick-script.test.ts). The shim mirrors the real CLI
 * contract enforced by config.ts: when IDU_PI_DOTENV_PATH is set but the
 * file does not exist, the "CLI" fails early with a non-zero exit
 * ("install without .env -> RED").
 *
 * The verify script only defaults IDU_PI_DOTENV_PATH when the environment
 * provides no value, so each test drives it explicitly — deterministic on
 * dev machines AND in CI, where the operator's path does not exist.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);

const VERIFY_PATH = resolve("scripts/verify-deploy.ps1");

const FAKE_NODE_SHIM = [
	"@echo off",
	'echo %*>>"%~dp0verify-node-invoked.txt"',
	'if "%IDU_PI_DOTENV_PATH%"=="" goto checkexit',
	'if not exist "%IDU_PI_DOTENV_PATH%" (',
	"  echo fake-node: IDU_PI_DOTENV_PATH does not exist: %IDU_PI_DOTENV_PATH%",
	"  exit /b 9",
	")",
	":checkexit",
	'if "%IDU_PI_VERIFY_FAKE_NODE_EXIT%"=="" exit /b 0',
	"exit /b %IDU_PI_VERIFY_FAKE_NODE_EXIT%",
	"",
].join("\r\n");

type VerifyResult = {
	stdout: string;
	stderr: string;
	code: number | null;
};

function fakeDeployRoot(): {
	fakeRoot: string;
	fakeVerify: string;
	fakeBin: string;
	invokedLog: string;
	cleanup: () => void;
} {
	const fakeRoot = mkdtempSync(join(tmpdir(), "idu-verify-deploy-"));
	const scriptsDir = join(fakeRoot, "deploy", "scripts");
	const distDir = join(fakeRoot, "deploy", "dist", "src");
	mkdirSync(scriptsDir, { recursive: true });
	mkdirSync(distDir, { recursive: true });
	// The real CLI would be compiled here; the fake `node` shim replaces
	// the runtime, so the file only exists for the script's Test-Path
	// guard and to mirror the deploy layout.
	writeFileSync(join(distDir, "cli.js"), "// fake deployed cli", "utf8");
	const fakeVerify = join(scriptsDir, "verify-deploy.ps1");
	writeFileSync(fakeVerify, readFileSync(VERIFY_PATH, "utf8"), "utf8");
	const fakeBin = join(fakeRoot, "deploy", "test-bin");
	mkdirSync(fakeBin, { recursive: true });
	writeFileSync(join(fakeBin, "node.cmd"), FAKE_NODE_SHIM, "utf8");
	return {
		fakeRoot,
		fakeVerify,
		fakeBin,
		invokedLog: join(fakeBin, "verify-node-invoked.txt"),
		cleanup: () => rmSync(fakeRoot, { recursive: true, force: true }),
	};
}

async function runVerify(
	verifyPath: string,
	env: Record<string, string>,
): Promise<VerifyResult> {
	const childEnv = { ...process.env, ...env };
	// Prepend the fake `node` shim dir to PATH (pwsh command resolution
	// picks node.cmd from PATHEXT like node.exe).
	const pathKey = Object.keys(childEnv).find(
		(key) => key.toLowerCase() === "path",
	) ?? "PATH";
	const fakeBin = join(dirname(dirname(verifyPath)), "test-bin");
	childEnv[pathKey] = `${fakeBin}${delimiter}${childEnv[pathKey] ?? ""}`;
	try {
		const { stdout, stderr } = await execFile(
			"pwsh",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", verifyPath],
			{
				env: childEnv,
				timeout: 30_000,
				windowsHide: true,
			},
		);
		return { stdout, stderr, code: 0 };
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; code?: number };
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			code: typeof e.code === "number" ? e.code : null,
		};
	}
}

test("verify-deploy passes and runs the smoke command when the CLI exits 0", async () => {
	const { fakeVerify, invokedLog, cleanup } = fakeDeployRoot();
	const root = dirname(dirname(fakeVerify));
	try {
		const envPath = join(root, "env", ".env");
		mkdirSync(dirname(envPath), { recursive: true });
		writeFileSync(envPath, "DEFAULT_CWD=.", "utf8");
		const result = await runVerify(fakeVerify, {
			IDU_PI_DOTENV_PATH: envPath,
		});
		assert.equal(
			result.code,
			0,
			`verify must pass when the CLI boots; stdout=${result.stdout}, stderr=${result.stderr}`,
		);
		// The smoke command must actually be invoked (evidence the
		// deployed compile was exercised, not skipped).
		assert.ok(
			existsSync(invokedLog),
			"expected the fake node shim to be invoked",
		);
		const invocation = readFileSync(invokedLog, "utf8");
		assert.match(
			invocation,
			/cli\.js\s+status/u,
			`verify must run \`node <deploy>\\dist\\src\\cli.js status\`, got: ${invocation}`,
		);
	} finally {
		cleanup();
	}
});

test("verify-deploy exits non-zero when the CLI exits non-zero", async () => {
	const { fakeVerify, cleanup } = fakeDeployRoot();
	const root = dirname(dirname(fakeVerify));
	try {
		const envPath = join(root, "env", ".env");
		mkdirSync(dirname(envPath), { recursive: true });
		writeFileSync(envPath, "DEFAULT_CWD=no", "utf8");
		const result = await runVerify(fakeVerify, {
			IDU_PI_DOTENV_PATH: envPath,
			IDU_PI_VERIFY_FAKE_NODE_EXIT: "5",
		});
		assert.equal(
			result.code,
			5,
			`verify must propagate the CLI's non-zero exit, got code ${result.code}; stdout=${result.stdout}, stderr=${result.stderr}`,
		);
		assert.match(
			result.stdout,
			/failed to boot/u,
			`verify must print a visible failure, got: ${result.stdout}`,
		);
	} finally {
		cleanup();
	}
});

test("verify-deploy exits non-zero when IDU_PI_DOTENV_PATH points at a missing file (install without .env -> RED)", async () => {
	const { fakeVerify, cleanup } = fakeDeployRoot();
	const root = dirname(dirname(fakeVerify));
	try {
		const missingEnv = join(root, "env", "missing.env");
		const result = await runVerify(fakeVerify, {
			IDU_PI_DOTENV_PATH: missingEnv,
		});
		assert.notEqual(
			result.code,
			0,
			`verify must fail when the dotenv override is missing, got code ${result.code}; stdout=${result.stdout}`,
		);
		assert.match(
			result.stdout,
			/does not exist/u,
			`the failure must surface the missing .env, got stdout=${result.stdout} stderr=${result.stderr}`,
		);
	} finally {
		cleanup();
	}
});