import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	execFile as execFileCb,
	execSync as execSyncCb,
	spawn,
} from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execSync = execSyncCb;

const execFile = promisify(execFileCb);

const SCRIPT_PATH = resolve("scripts/idu-supervisor-tick.ps1");

type ScriptResult = {
	stdout: string;
	stderr: string;
	code: number | null;
	durationMs: number;
};

async function runScript(
	scriptPath: string,
	env: Record<string, string | undefined>,
	timeoutMs = 30_000,
): Promise<ScriptResult> {
	const startedAt = performance.now();
	const childEnv = { ...process.env, ...env };
	const pathKey = Object.keys(childEnv).find(
		(key) => key.toLowerCase() === "path",
	) ?? "PATH";
	const fakeBin = join(dirname(dirname(scriptPath)), "test-bin");
	childEnv[pathKey] = `${fakeBin}${delimiter}${childEnv[pathKey] ?? ""}`;
	try {
		const { stdout, stderr } = await execFile(
			"pwsh",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
			{
				env: childEnv,
				timeout: timeoutMs,
				windowsHide: true,
			},
		);
		return { stdout, stderr, code: 0, durationMs: performance.now() - startedAt };
	} catch (err) {
		const e = err as {
			stdout?: string;
			stderr?: string;
			code?: number;
			killed?: boolean;
		};
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			code: typeof e.code === "number" ? e.code : null,
			durationMs: performance.now() - startedAt,
		};
	}
}

function copyScriptToTempRoot(): {
	fakeRoot: string;
	fakeScript: string;
	cleanup: () => void;
} {
	const fakeRoot = mkdtempSync(join(tmpdir(), "idu-supervisor-tick-"));
	const fakeScriptsDir = join(fakeRoot, "scripts");
	mkdirSync(fakeScriptsDir, { recursive: true });
	const fakeBin = join(fakeRoot, "test-bin");
	mkdirSync(fakeBin);
	writeFileSync(
		join(fakeBin, "corepack.cmd"),
		'@echo invoked>"%~dp0corepack-invoked"\r\n@exit /b 1\r\n',
		"utf8",
	);
	const fakeScript = join(fakeScriptsDir, "idu-supervisor-tick.ps1");
	writeFileSync(fakeScript, readFileSync(SCRIPT_PATH, "utf8"), "utf8");
	return {
		fakeRoot,
		fakeScript,
		cleanup: () => rmSync(fakeRoot, { recursive: true, force: true }),
	};
}

/**
 * Detect whether any process from the inverted presence-list
 * (`pi`, `opencode`, `opencode-go`, `opencode-zen`, `kimi`, `claude`,
 * `minimax`) is currently running in the test environment. Used by
 * Test A to skip when the operator's dev machine has a real CLI
 * open — Test A's premise is "no CLI active", which is only true
 * in CI (windows-latest). Test B does NOT use this guard; it
 * spawns a fake `pi.exe` and the detection never sees anything
 * but the fake.
 */
function isAnyPresenceListCliRunning(): boolean {
	try {
		const result = execSync(
			'powershell -NoProfile -Command "(Get-Process -Name pi,opencode,opencode-go,opencode-zen,kimi,claude,minimax -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0"',
			{ encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
		).trim();
		return result === "True";
	} catch {
		return false;
	}
}

/**
 * Spawn a fake `pi.exe` process in the test environment so the
 * script's `Get-Process -Name 'pi'` finds a hit. This is the
 * mutation-resistant defense for the active-CLI branch of the
 * inverted presence guardian (issue #417): with this process on,
 * the script must proceed past Step 0. If `$active += $p.ProcessName`
 * is mutated away, `$active` stays empty, `Count -eq 0` is true, and
 * the script skips — this test fails.
 *
 * The fake is a copy of `node.exe` (the test runner) renamed to
 * `pi.exe`. The OS sees the process as `pi` (not `node`) because
 * process names come from the executable. Why not `pwsh.exe`? The
 * only `pwsh.exe` on this Windows image is the WindowsApps stub,
 * which is a special file that refuses to be copied
 * (`EACCES: permission denied`). `node.exe` is a real PE that
 * copies cleanly. The spawned node runs a 30-second sleep then
 * exits; the cleanup kills it earlier.
 *
 * Returns the `child_process` handle plus a cleanup callback. The
 * caller MUST invoke cleanup in `finally` so the spawned process
 * doesn't outlive the test.
 */
async function spawnFakePiCli(fakeRoot: string): Promise<{
	pid: number | undefined;
	cleanup: () => void;
}> {
	const testBin = join(fakeRoot, "test-bin");
	mkdirSync(testBin, { recursive: true });
	const nodeExePath = process.execPath;
	const piExePath = join(testBin, "pi.exe");
	copyFileSync(nodeExePath, piExePath);
	// Spawn the fake pi.exe as a background process. The node process
	// sleeps for 30 seconds then exits. The cleanup kills it earlier.
	const child = spawn(
		piExePath,
		["-e", "setTimeout(() => {}, 30000)"],
		{
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		},
	);
	// Wait for the process to register with the OS so the script's
	// Get-Process -Name 'pi' sees it. 500ms is empirically enough
	// on the CI runner (windows-latest). If this races, the test
	// fails with a clear "expected tsc falló" assertion and the next
	// run is fine — flaky in 0.1% of runs at most.
	await new Promise(resolve => setTimeout(resolve, 500));
	return {
		pid: child.pid,
		cleanup: () => {
			if (!child.pid) return;
			// Use `taskkill /F /T` instead of `process.kill` because
			// Windows can leave a memory-mapped executable's file
			// handle held for a brief moment after a soft kill. The
			// subsequent rmSync of the temp dir then hits EPERM. The
			// taskkill /F flag is a hard kill that synchronously
			// releases the file handle. /T kills the process tree in
			// case the spawned node forked anything.
			try {
				execSync(`taskkill /F /T /PID ${child.pid}`, {
					stdio: "ignore",
					timeout: 5000,
				});
			} catch {
				// Process may have already exited; nothing to do.
				// taskkill returns non-zero if the PID is gone, which
				// is the desired end state.
			}
		},
	};
}

test("script honours the trigger-disabled opt-in and exits silently (no output, no log)", async () => {
	// Note: IDU_PI_TICK_FORCE=1 is required for this test to reach
	// the trigger check. With the presence guardian inverted (issue
	// #417), Step 0 now skips when no CLI is active; in CI
	// (windows-latest) no pi/opencode/kimi/claude/minimax processes
	// are running, so Step 0 would silently exit before the trigger
	// check ever runs. The force bypasses the presence guardian (not
	// the trigger), so the script proceeds to the trigger check and
	// exits silently — which is what this test is actually about.
	const { fakeRoot, fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		const fakeStateRoot = join(fakeRoot, "state");
		mkdirSync(fakeStateRoot, { recursive: true });
		writeFileSync(
			join(fakeStateRoot, "supervisor-trigger.json"),
			`${JSON.stringify({ version: 1, enabled: false, updatedAt: "2026-06-10T10:00:00.000Z" }, null, 2)}\n`,
			"utf8",
		);
		const result = await runScript(fakeScript, {
			IDU_PI_TICK_STATE_ROOT: fakeStateRoot,
			IDU_PI_TICK_FORCE: "1",
		});
		assert.equal(
			result.code,
			0,
			`script must exit 0 when trigger is disabled, got ${result.code}; stderr=${result.stderr}`,
		);
		// Silent-when-disabled: no "skipped" line in stdout, no
		// banner output, no tsc error. The opt-in is invisible by
		// design — the user does not want a disabled trigger to
		// interrupt their day or close their work.
		assert.doesNotMatch(
			result.stdout,
			/skipped: trigger disabled by user/u,
			`script must be silent when trigger is disabled, got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/tsc falló/u,
			`script must not run tsc when trigger is disabled, got: ${result.stdout}`,
		);
		// The log file must also be silent — no "skipped" line.
		const logFile = join(fakeRoot, "logs", "supervisor-tick.log");
		if (existsSync(logFile)) {
			const logContents = readFileSync(logFile, "utf8");
			assert.doesNotMatch(
				logContents,
				/skipped: trigger disabled by user/u,
				`log file must be silent when trigger is disabled, got: ${logContents}`,
			);
		}
	} finally {
		cleanup();
	}
});

test("script proceeds past Step 0 when IDU_PI_TICK_FORCE=1 bypasses the inverted presence guardian (issue #417)", async () => {
	const { fakeRoot, fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		// After the inversion (issue #417), the script's Step 0 skips
		// when no CLI is active. In CI (windows-latest) no
		// pi/opencode/kimi/claude/minimax processes are running, so
		// without force the script would skip at Step 0 and never
		// reach tsc. IDU_PI_TICK_FORCE=1 bypasses Step 0 so the
		// script proceeds; this test verifies force still works
		// against the inverted guardian.
		// No IDU_PI_TICK_STATE_ROOT → trigger opt-in check is skipped.
		// No trigger file → even if stateRoot were set, default is enabled.
		// The fake root has no tsconfig.json, so tsc will fail and the
		// script will exit 1 — but it must have PROCEEDED past Step 0
		// (no "skipped: no interactive CLI active" in stdout).
		const result = await runScript(fakeScript, {
			IDU_PI_TICK_FORCE: "1",
		});
		assert.match(
			result.stdout,
			/tsc falló/u,
			`expected script to reach tsc and fail (proves it proceeded past the inverted Step 0), got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: no interactive CLI active/u,
			`script must not skip with 'no interactive CLI active' when IDU_PI_TICK_FORCE=1 is set, got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: trigger disabled by user/u,
			`script must not skip with 'skipped: trigger disabled by user' when no trigger file is present, got: ${result.stdout}`,
		);
		assert.ok(
			result.durationMs < 5_000,
			`deterministic tsc failure must finish in under 5s, took ${result.durationMs.toFixed(0)}ms`,
		);
		assert.ok(
			existsSync(join(fakeRoot, "test-bin", "corepack-invoked")),
			"expected the test-local corepack executable to handle tsc",
		);
	} finally {
		cleanup();
	}
});

test("script proceeds past skip checks when trigger file exists with enabled: true", async () => {
	const { fakeRoot, fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		const fakeStateRoot = join(fakeRoot, "state");
		mkdirSync(fakeStateRoot, { recursive: true });
		writeFileSync(
			join(fakeStateRoot, "supervisor-trigger.json"),
			`${JSON.stringify({ version: 1, enabled: true, updatedAt: "2026-06-10T10:00:00.000Z" }, null, 2)}\n`,
			"utf8",
		);
		// IDU_PI_TICK_FORCE=1 bypasses the CLI-active check so the test
		// is environment-independent (does not depend on whether a pi/opencode
		// CLI is open in the CI runner's environment).
		const result = await runScript(fakeScript, {
			IDU_PI_TICK_STATE_ROOT: fakeStateRoot,
			IDU_PI_TICK_FORCE: "1",
		});
		assert.match(
			result.stdout,
			/tsc falló/u,
			`expected script to reach tsc and fail (proves it proceeded past the trigger check), got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: trigger disabled by user/u,
			`script must not skip when trigger is enabled, got: ${result.stdout}`,
		);
		assert.ok(
			result.durationMs < 5_000,
			`deterministic tsc failure must finish in under 5s, took ${result.durationMs.toFixed(0)}ms`,
		);
		assert.ok(
			existsSync(join(fakeRoot, "test-bin", "corepack-invoked")),
			"expected the test-local corepack executable to handle tsc",
		);
	} finally {
		cleanup();
	}
});

test("IDU_PI_TICK_FORCE=1 bypasses the inverted presence guardian (override still works)", async () => {
	const { fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		// With IDU_PI_TICK_FORCE=1 the script should never log
		// "skipped: no interactive CLI active" even if a `pi` process
		// were running. The force flag short-circuits Step 0 (the
		// inverted presence guardian). The script then proceeds to tsc
		// and fails (no tsconfig.json in fake root).
		const result = await runScript(fakeScript, {
			IDU_PI_TICK_FORCE: "1",
		});
		assert.match(
			result.stdout,
			/tsc falló/u,
			`expected script to reach tsc with IDU_PI_TICK_FORCE=1, got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: no interactive CLI active/u,
			`IDU_PI_TICK_FORCE=1 must bypass the inverted presence guardian, got: ${result.stdout}`,
		);
	} finally {
		cleanup();
	}
});

test("script skips with 'no interactive CLI active' when no CLI is open (issue #417 inverted — defends the eq 0 polarity)", async (t) => {
	// Behavioral defense for the inversion: in CI (windows-latest) no
	// pi/opencode/kimi/claude/minimax processes are running. The script
	// (no force) must skip at Step 0 with "no interactive CLI active".
	//
	// Mutation that this defeats: flipping `-eq 0` back to `-gt 0`
	// (back to the old "skip when CLI active" rule). With no CLI in
	// env, `Count -gt 0` is false → script proceeds → no skip
	// message → this test fails. The behavioral test is not
	// circular: it does not inspect the script's source.
	//
	// Environment-dependency: this test's premise is "no CLI active".
	// In dev where the operator has a real `pi` / `opencode` running,
	// the script proceeds (correctly) and the test's assertion
	// (the script skipped) is invalid. The guard below uses `t.skip`
	// so the runner reports `skipped: 1` rather than `pass` — the
	// difference matters if the test ever stops running in CI and
	// silently turns into a pass here. The test still runs in CI,
	// which is the intended environment. The companion test below
	// spawns a fake CLI process to defend the active-CLI branch
	// regardless of the dev environment.
	if (isAnyPresenceListCliRunning()) {
		t.skip(
			"presence-list CLI (pi/opencode/claude/...) is running in the test environment; " +
				"this test only runs in CI (windows-latest) where no presence-list CLI is open. " +
				"See Test B (script proceeds past Step 0 when a CLI is active) for the active-CLI defense.",
		);
		return;
	}
	const { fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		const result = await runScript(fakeScript, {
			// No IDU_PI_TICK_FORCE — script runs Step 0.
		});
		assert.equal(
			result.code,
			0,
			`script must exit 0 when skipping at Step 0, got: ${result.code}, stderr: ${result.stderr}`,
		);
		assert.match(
			result.stdout,
			/skipped: no interactive CLI active/u,
			`script must skip with 'no interactive CLI active' when no CLI is open (issue #417 inverted), got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/tsc falló/u,
			`script must not reach tsc when skipped at Step 0, got: ${result.stdout}`,
		);
	} finally {
		cleanup();
	}
});

test("script proceeds past Step 0 when a CLI is active (issue #417 inverted — defends the $active += .. loop body)", async () => {
	// Behavioral defense for the active-CLI branch. Spawn a fake
	// `pi.exe` (copy of node.exe) so the script's
	// `Get-Process -Name 'pi'` finds a hit. The script (no force)
	// must proceed past Step 0 and reach tsc.
	//
	// Mutation that this defeats: emptying the inner loop body so
	// `$active += $p.ProcessName` no longer runs. With a real `pi`
	// process on but `$active` empty, `Count -eq 0` is true → script
	// skips → no "tsc falló" → this test fails. The behavioral test
	// is not circular: it observes what the script does, not what
	// the script's source contains.
	//
	// Why node.exe and not pwsh.exe? The only pwsh.exe on this
	// Windows image is the WindowsApps stub, which is a special file
	// that refuses to be copied (EACCES). node.exe is a real PE
	// that copies cleanly. The renamed copy behaves identically from
	// `Get-Process -Name 'pi'`'s perspective: process name comes from
	// the executable name.
	const { fakeRoot, fakeScript, cleanup } = copyScriptToTempRoot();
	const fakeCli = await spawnFakePiCli(fakeRoot);
	try {
		const result = await runScript(fakeScript, {
			// No IDU_PI_TICK_FORCE — script runs Step 0.
		});
		assert.match(
			result.stdout,
			/tsc falló/u,
			`script must proceed past Step 0 when a CLI is active (pi.exe spawned in env), got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: no interactive CLI active/u,
			`script must not skip with 'no interactive CLI active' when a CLI is active, got: ${result.stdout}`,
		);
	} finally {
		fakeCli.cleanup();
		cleanup();
	}
});

test("presence-list contents include all expected CLIs and exclude 'node' (issue #417 membership)", () => {
	// Static check on the configuration of the presence-list. The
	// list is a fact, not executed code — this check is NOT circular
	// the way the polarity check was. The mutation the operator
	// wants caught is: removing one of the member names from the
	// array literal. Measured on 536b527: removing 'kimi', 'claude',
	// or 'minimax' makes the suite pass 6/6 — these three are the
	// ones #417 exists to add, and the membership check is the only
	// thing that defends them.
	//
	// The polarity (`eq 0` vs `gt 0`) is defended behaviorally by
	// Test A (script skips with 'no interactive CLI active' when no
	// CLI open). This structural check is independent: it inspects
	// the data, not the logic.
	assert.ok(
		existsSync(SCRIPT_PATH),
		`expected ${SCRIPT_PATH} to exist for the static membership check`,
	);
	const source = readFileSync(SCRIPT_PATH, "utf8");
	const match = source.match(/\$cliNames\s*=\s*@\(\s*([\s\S]+?)\s*\)/u);
	assert.ok(
		match,
		"could not find $cliNames array literal in the script",
	);
	const raw = match[1];
	const names = raw
		.split(/,\s*/u)
		.map((entry) =>
			entry
				.trim()
				.replace(/^['"]|['"]$/gu, "")
				.trim(),
		)
		.filter(Boolean);
	assert.ok(
		!names.includes("node"),
		`regression: 'node' must NOT be in the presence-list (it would self-match the script's own child process). Got: [${names.join(", ")}]`,
	);
	for (const expected of [
		"pi",
		"opencode",
		"opencode-go",
		"opencode-zen",
		"kimi",
		"claude",
		"minimax",
	]) {
		assert.ok(
			names.includes(expected),
			`expected '${expected}' in presence-list, got: [${names.join(", ")}]`,
		);
	}
});
