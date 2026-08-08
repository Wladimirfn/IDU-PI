import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);

const BOOTSTRAP_PATH = resolve("scripts/idu-supervisor-tick-bootstrap.ps1");

test("bootstrap uses $PSScriptRoot so the deployment directory is locatable (issue #483)", () => {
	// Issue #483: the cron task previously ran from the operator's
	// working checkout, which means whatever branch was checked out at
	// tick time was the production code. The fix is a deployment
	// directory (a separate clone on main) referenced by the cron
	// task's WorkingDir. For the bootstrap script to find the tick
	// script from inside that deployment directory, it must use
	// $PSScriptRoot — a hardcoded path to the operator's repo would
	// re-introduce the original bug.
	assert.ok(
		existsSync(BOOTSTRAP_PATH),
		`expected ${BOOTSTRAP_PATH} to exist for the static check`,
	);
	const source = readFileSync(BOOTSTRAP_PATH, "utf8");
	// The bootstrap must invoke the script via $PSScriptRoot (the
	// directory containing this bootstrap script). Hardcoded paths to
	// the operator's checkout re-create the bug.
	assert.ok(
		source.includes("$PSScriptRoot"),
		`regression: bootstrap must use $PSScriptRoot for locatability. The bootstrap currently has a hardcoded path that makes the deployment directory workaround fail. Source: ${source}`,
	);
	// The hardcoded path to the operator's checkout must NOT be present.
	// The path uses backslashes (Windows) — escape them in the regex.
	assert.ok(
		!/C:\\Users\\elmas\\pi-telegram-bridge\\scripts\\idu-supervisor-tick\.ps1/u.test(source),
		`regression: bootstrap must NOT hardcode the operator's repo path. The bootstrap's hardcoded path bypasses the deployment directory. Source: ${source}`,
	);
});

test("bootstrap sets the three environment variables the script depends on", () => {
	// The bootstrap sets IDU_PI_TICK_STATE_ROOT, AGENT_WORKSPACE_ROOT,
	// and IDU_PI_REGISTRY_PATH before invoking the script. These are
	// required for the script to find the watermark file, the lab.db
	// workspace, and the projects registry. If any disappear the tick
	// silently reads from wrong paths.
	const source = readFileSync(BOOTSTRAP_PATH, "utf8");
	for (const envVar of [
		"IDU_PI_TICK_STATE_ROOT",
		"AGENT_WORKSPACE_ROOT",
		"IDU_PI_REGISTRY_PATH",
	]) {
		assert.ok(
			source.includes(`$env:${envVar}`),
			`regression: bootstrap must set $env:${envVar} before invoking the script. Source: ${source}`,
		);
	}
});

test("bootstrap sets IDU_PI_DOTENV_PATH to the operator's single .env (issue #487)", () => {
	// Issue #487: the deployment directory never carries its own .env
	// (gitignored), so the compiled CLI's default dotenv resolution
	// fails the tick with "Missing required env var: DEFAULT_CWD". The
	// bootstrap points the loader at the operator's single .env — never
	// a copied deploy-side .env that would drift on token rotation.
	const source = readFileSync(BOOTSTRAP_PATH, "utf8");
	assert.match(
		source,
		/\$env:IDU_PI_DOTENV_PATH\s*=\s*"C:\\Users\\elmas\\pi-telegram-bridge\\.env"/u,
		`regression: bootstrap must point IDU_PI_DOTENV_PATH at the operator's single .env. Source: ${source}`,
	);
});

test("bootstrap invokes the script in its own directory (behavioral defense against bypass mutations)", async () => {
	// Behavioral defense (issue #483). The static check on
	// $PSScriptRoot covers the "bootstrap uses $PSScriptRoot" case.
	// The mutation that bypasses the static check is the bootstrap
	// keeps $PSScriptRoot but points elsewhere:
	//   & "$PSScriptRoot\..\..\pi-telegram-bridge\scripts\idu-supervisor-tick.ps1"
	// The static check passes (contains $PSScriptRoot, doesn't match
	// the hardcoded-path regex). The bootstrap still invokes the
	// operator's script, bypassing the deployment directory entirely.
	//
	// The behavioral fix: run the bootstrap alongside a stub script
	// that writes a sentinel. If the bootstrap invokes the stub (via
	// $PSScriptRoot), the sentinel is written. If the bootstrap points
	// elsewhere, the stub is not invoked and the sentinel is missing.
	//
	// Stub layout: identical to the deployment setup, with a fake
	// "operator's checkout" so we can detect the bypass mutation
	// running the operator's script instead of the stub.
	const tempDir = mkdtempSync(join(tmpdir(), "idu-tick-bootstrap-behavior-"));
	try {
		// Sentinel location: outside the scripts dirs so the stub
		// (or the bypass mutation's script) writes here.
		const sentinelPath = join(tempDir, "sentinel.txt");

		// Stub script: writes the sentinel.
		// Backslashes in the path are escaped for the embedded string.
		const stubScriptsDir = join(tempDir, "deploy", "scripts");
		mkdirSync(stubScriptsDir, { recursive: true });
		const sentinelEscaped = sentinelPath.replace(/\\/gu, "\\\\");
		writeFileSync(
			join(stubScriptsDir, "idu-supervisor-tick.ps1"),
			`Set-Content -Path "${sentinelEscaped}" -Value "executed" -NoNewline\nExit 0\n`,
			"utf8",
		);

		// Fake "operator's checkout" — if the bootstrap bypasses
		// $PSScriptRoot and points to the operator's checkout, this
		// is what the bootstrap would invoke. The fake operator's
		// script does NOT write the sentinel.
		const fakeOperatorScriptsDir = join(tempDir, "operator", "scripts");
		mkdirSync(fakeOperatorScriptsDir, { recursive: true });
		writeFileSync(
			join(fakeOperatorScriptsDir, "idu-supervisor-tick.ps1"),
			`Write-Host "fake operator script invoked (no sentinel written)"\nExit 0\n`,
			"utf8",
		);

		// Copy bootstrap to the stub's scripts dir.
		const fakeBootstrapPath = join(stubScriptsDir, "idu-supervisor-tick-bootstrap.ps1");
		writeFileSync(fakeBootstrapPath, readFileSync(BOOTSTRAP_PATH, "utf8"), "utf8");

		// Run the bootstrap.
		const result = await execFile(
			"pwsh",
			[
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				fakeBootstrapPath,
			],
			{ timeout: 30_000, windowsHide: true },
		);

		// The bootstrap should invoke the stub at the same directory
		// (deploy/scripts/idu-supervisor-tick.ps1). The bypass
		// mutation would invoke the fake operator's script instead.
		assert.ok(
			existsSync(sentinelPath),
			`bootstrap must invoke the script in its own directory (via $PSScriptRoot). The stub was not executed. The bootstrap may have resolved to a path outside its own directory. stdout: ${result.stdout}, stderr: ${result.stderr}`,
		);
		const sentinelContent = readFileSync(sentinelPath, "utf8").trim();
		assert.equal(
			sentinelContent,
			"executed",
			`stub invoked but did not write the expected sentinel. Got: ${sentinelContent}`,
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
