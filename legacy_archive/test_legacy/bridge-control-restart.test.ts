import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { execFile as execFileCb, execSync as execSyncCb, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);
const execSync = execSyncCb;

const BRIDGE_CONTROL_PATH = resolve("scripts/bridge-control.ps1");
const START_BRIDGE_PATH = resolve("scripts/start-bridge.ps1");

type ScriptResult = {
	stdout: string;
	stderr: string;
	code: number | null;
};

async function runScript(
	scriptPath: string,
	fakeBin: string,
	timeoutMs = 90_000,
): Promise<ScriptResult> {
	const childEnv = { ...process.env };
	const pathKey = Object.keys(childEnv).find(
		(key) => key.toLowerCase() === "path",
	) ?? "PATH";
	childEnv[pathKey] = `${fakeBin}${delimiter}${childEnv[pathKey] ?? ""}`;
	try {
		const { stdout, stderr } = await execFile(
			"pwsh",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", "restart"],
			{ env: childEnv, timeout: timeoutMs, windowsHide: true },
		);
		return { stdout, stderr, code: 0 };
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; code?: unknown };
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			code: typeof e.code === "number" ? e.code : null,
		};
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPidFromFile(root: string): number | null {
	const pidfile = join(root, "bridge.pid");
	if (!existsSync(pidfile)) return null;
	try {
		const raw = readFileSync(pidfile, "utf8").trim();
		const pid = Number.parseInt(raw, 10);
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function hardKillProcessTree(pid: number): void {
	try {
		execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", timeout: 5000 });
	} catch {
		// Process already gone — desired end state.
	}
}

/**
 * Kill every process tied to a fake root so the temp dir can be removed.
 * The detached wrapper powershell (Start-Process of start-bridge.ps1) keeps
 * the root as its cwd and holds the dir handle even after the node bridge is
 * killed; taskkill on the node PID alone does not reach that parent. So we
 * also taskkill any powershell whose command line references this root.
 */
function killRootProcesses(root: string, pids: number[]): void {
	for (const pid of pids) {
		if (pid > 0) hardKillProcessTree(pid);
	}
	const script = [
		"Get-CimInstance Win32_Process |",
		`Where-Object { $_.Name -match 'powershell' -and $_.CommandLine -and $_.CommandLine.Contains('${root}') } |`,
		"ForEach-Object { taskkill /F /T /PID $_.ProcessId | Out-Null }",
	].join(" ");
	try {
		execSync(`powershell -NoProfile -Command "${script}"`, {
			stdio: "ignore",
			timeout: 10_000,
		});
	} catch {
		// No matching wrapper processes — desired end state.
	}
}

/**
 * Build a hermetic fake bridge root. `start-bridge.ps1` is copied, and the
 * fake `dist/src/index.js` is a real node program that writes `bridge.pid`
 * with its own PID to the repo root (process.cwd(), which start-bridge.ps1
 * sets via Set-Location $Root) and then sleeps ~30s so it stays alive long
 * enough for the survival assertion and cleanup.
 */
function buildFakeRoot(opts: { fakeKind?: "healthy" | "no-pidfile" } = {}): {
	fakeBin: string;
	root: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "bridge-control-restart-"));
	const scriptsDir = join(root, "scripts");
	mkdirSync(scriptsDir, { recursive: true });
	const distDir = join(root, "dist", "src");
	mkdirSync(distDir, { recursive: true });

	copyFileSync(BRIDGE_CONTROL_PATH, join(scriptsDir, "bridge-control.ps1"));
	copyFileSync(START_BRIDGE_PATH, join(scriptsDir, "start-bridge.ps1"));

	// start-bridge.ps1 does real setup work before reaching `& node`. Make a
	// hermetic root that satisfies each guard so it can proceed to launch:
	//   .env present        → skips `node scripts/setup-env.mjs`
	//   node_modules present → skips `corepack pnpm install`
	//   fake corepack.cmd   → `corepack pnpm build` exits 0 (no real tsc)
	writeFileSync(join(root, ".env"), "NODE_ENV=test\n", "utf8");
	mkdirSync(join(root, "node_modules"), { recursive: true });
	const fakeBin = join(root, "test-bin");
	mkdirSync(fakeBin, { recursive: true });
	writeFileSync(join(fakeBin, "corepack.cmd"), "@exit /b 0\r\n", "utf8");

	const kind = opts.fakeKind ?? "healthy";
	if (kind === "no-pidfile") {
		// A real node program that writes NO pidfile and exits immediately.
		writeFileSync(
			join(distDir, "index.js"),
			"process.exit(0);\n",
			"utf8",
		);
	} else {
		writeFileSync(
			join(distDir, "index.js"),
			[
				"const fs = require('node:fs');",
				"fs.writeFileSync('bridge.pid', String(process.pid), 'utf8');",
				"setTimeout(() => {}, 30000);",
			].join("\n"),
			"utf8",
		);
	}

	return {
		fakeBin,
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("restart launches the bridge detached so it survives its invocator dying (issue #493)", async () => {
	const { root, fakeBin, cleanup } = buildFakeRoot();
	const spawnedPids: number[] = [];
	try {
		const result = await runScript(join(root, "scripts", "bridge-control.ps1"), fakeBin);

		assert.equal(
			result.code,
			0,
			`restart must exit 0 on success, got ${result.code}; stdout=${result.stdout}; stderr=${result.stderr}`,
		);
		assert.match(
			result.stdout,
			/Bridge alive PID \d+/u,
			`restart must log "Bridge alive PID <n>", got: ${result.stdout}`,
		);

		// The invocator (the test's pwsh via execFile) has already exited by
		// now — runScript resolved. THE KEY ASSERTION: the detached bridge
		// node process must still be alive with the invocator gone.
		const pid = readPidFromFile(root);
		assert.ok(pid !== null, "expected bridge.pid to be written by the fake bridge");
		spawnedPids.push(pid);
		assert.ok(
			isProcessAlive(pid),
			`bridge node process PID ${pid} must still be alive after the invocator exited`,
		);

		// Sanity: the PID we found is a real node process, not a recycled PID.
		const name = execSync(
			`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName"`,
			{ encoding: "utf8", timeout: 5000 },
		)
			.trim()
			.toLowerCase();
		assert.ok(
			name.includes("node"),
			`expected detached survivor to be a node process, got process name '${name}'`,
		);
	} finally {
		killRootProcesses(root, spawnedPids);
		cleanup();
	}
});

test("restart reports failure (exit 1) when the bridge does not come up (no live pidfile)", async () => {
	const { root, fakeBin, cleanup } = buildFakeRoot({ fakeKind: "no-pidfile" });
	try {
		const result = await runScript(join(root, "scripts", "bridge-control.ps1"), fakeBin);
		assert.equal(
			result.code,
			1,
			`restart must exit 1 when no live pidfile appears, got ${result.code}; stdout=${result.stdout}; stderr=${result.stderr}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/Bridge alive/u,
			`restart must not claim success when the bridge failed to come up, got: ${result.stdout}`,
		);
	} finally {
		cleanup();
	}
});

test("restart does not falsely report success on a stale pidfile with a live (recycled) PID", async () => {
	// Reproduces the #493 false-success hole: Stop-Process -Force does not run
	// graceful shutdown, so deletePidfile never fires and the old bridge.pid
	// survives on disk. Its PID was just freed — if Windows recycles it, the
	// PID alone reads as alive. We pre-seed a STALE bridge.pid pointing at a
	// live dummy process, and the fake bridge never comes up (no fresh
	// pidfile). The mtime-freshness check must reject the stale file and exit
	// 1; the old Get-Process-only logic would falsely exit 0.
	const { root, fakeBin, cleanup } = buildFakeRoot({ fakeKind: "no-pidfile" });
	const dummy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	const dummyPid = dummy.pid;
	writeFileSync(join(root, "bridge.pid"), String(dummyPid), "utf8");
	try {
		const result = await runScript(join(root, "scripts", "bridge-control.ps1"), fakeBin);
		assert.equal(
			result.code,
			1,
			`restart must NOT report success on a stale pidfile with a live recycled PID, got ${result.code}; stdout=${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/Bridge alive/u,
			`restart must not claim success when only a stale pidfile is present, got: ${result.stdout}`,
		);
	} finally {
		if (dummyPid) hardKillProcessTree(dummyPid);
		killRootProcesses(root, []);
		cleanup();
	}
});

test("restart branch uses Start-Process (detached) and confirms via bridge.pid, not the foreground & pattern", () => {
	const source = readFileSync(BRIDGE_CONTROL_PATH, "utf8");
	const restartBranch = source.slice(source.indexOf("if ($Action -eq 'restart')"));

	assert.match(
		restartBranch,
		/Start-Process\s+-FilePath\s+'powershell\.exe'/u,
		"restart branch must launch the bridge detached via Start-Process",
	);
	assert.ok(
		!restartBranch.includes("& powershell"),
		"restart branch must not use the foreground '& powershell' pattern",
	);
	assert.match(
		restartBranch,
		/bridge\.pid/u,
		"restart branch must read bridge.pid to confirm the bridge is alive",
	);
	assert.match(
		restartBranch,
		/Get-Process -Id/u,
		"restart branch must verify the pidfile PID is a live process",
	);
});