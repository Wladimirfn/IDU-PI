import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * scripts/install.mjs had no coverage at all until #linux-compat, which is how it
 * shipped writing `idu-pi.cmd` and `idu-pi.ps1` on every platform: the CLI ran on
 * Linux, the installer produced two files no POSIX shell can execute, and
 * `$HOME/AppData/Local/...` appeared in users' home directories.
 *
 * These tests pin the platform-conditional shim contract. The heavy steps
 * (pnpm install, build, mcp-init) are skipped through the installer's own
 * IDU_PI_INSTALL_TEST_SKIP_COMMANDS seam, so a run only exercises file layout.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const INSTALLER = join(repoRoot, "scripts", "install.mjs");
const IS_WINDOWS = process.platform === "win32";

const MOCK_TOOLS = JSON.stringify({
	node: "v24.0.0",
	git: "2.50.0",
	corepack: "0.30.0",
	pnpm: "11.1.3",
});

function runInstaller(
	args: string[],
	extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync(process.execPath, [INSTALLER, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			IDU_PI_INSTALL_MOCK_TOOLS: MOCK_TOOLS,
			...extraEnv,
		},
	});
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
	};
}

test("installer plan lists the shim files this platform actually writes", () => {
	const { status, stdout } = runInstaller(["--dry-run"]);
	assert.equal(status, 0);
	if (IS_WINDOWS) {
		assert.match(stdout, /idu-pi\.cmd/u, "Windows plan must include the .cmd shim");
		assert.match(stdout, /idu-pi\.ps1/u, "Windows plan must include the .ps1 shim");
		return;
	}
	assert.match(stdout, /[\\/]idu-pi$/mu, "POSIX plan must include a bare idu-pi shim");
	assert.doesNotMatch(
		stdout,
		/idu-pi\.cmd/u,
		"a POSIX install must never announce a Windows shim",
	);
});

test("POSIX install writes an executable idu-pi shim", { skip: IS_WINDOWS }, () => {
	const shimDir = mkdtempSync(join(tmpdir(), "idu-shim-"));
	try {
		const { status, stdout, stderr } = runInstaller(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			// The shim dir on PATH is what the installer checks before it offers to
			// edit anything; it also keeps the run non-interactive.
			PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
		});
		assert.equal(status, 0, `${stdout}\n${stderr}`);

		const shim = join(shimDir, "idu-pi");
		assert.ok(existsSync(shim), `expected ${shim} to exist`);
		assert.equal(
			existsSync(join(shimDir, "idu-pi.cmd")),
			false,
			"POSIX install must not write a Windows shim",
		);

		const content = readFileSync(shim, "utf8");
		assert.ok(content.startsWith("#!/bin/sh\n"), `bad shebang: ${content}`);

		const mode = statSync(shim).mode & 0o777;
		assert.equal(
			mode & 0o111,
			0o111,
			`shim is not executable (mode ${mode.toString(8)})`,
		);

		// The shim has to actually launch the CLI, not just exist.
		const launched = spawnSync(shim, ["--help"], { encoding: "utf8" });
		assert.equal(launched.status, 0, launched.stderr ?? "");
		assert.match(launched.stdout ?? "", /idu|usage/iu);
	} finally {
		rmSync(shimDir, { recursive: true, force: true });
	}
});

test("Windows install writes the .cmd and .ps1 shims", { skip: !IS_WINDOWS }, () => {
	const shimDir = mkdtempSync(join(tmpdir(), "idu-shim-"));
	try {
		const { status, stdout, stderr } = runInstaller(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
		});
		assert.equal(status, 0, `${stdout}\n${stderr}`);
		assert.ok(existsSync(join(shimDir, "idu-pi.cmd")), "expected idu-pi.cmd");
		assert.ok(existsSync(join(shimDir, "idu-pi.ps1")), "expected idu-pi.ps1");
	} finally {
		rmSync(shimDir, { recursive: true, force: true });
	}
});
