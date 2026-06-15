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

const SCRIPT_PATH = resolve("scripts/idu-supervisor-tick.ps1");

type ScriptResult = { stdout: string; stderr: string; code: number | null };

async function runScript(
	scriptPath: string,
	env: Record<string, string | undefined>,
	timeoutMs = 30_000,
): Promise<ScriptResult> {
	try {
		const { stdout, stderr } = await execFile(
			"pwsh",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
			{
				env: { ...process.env, ...env },
				timeout: timeoutMs,
				windowsHide: true,
			},
		);
		return { stdout, stderr, code: 0 };
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
	const fakeScript = join(fakeScriptsDir, "idu-supervisor-tick.ps1");
	writeFileSync(fakeScript, readFileSync(SCRIPT_PATH, "utf8"), "utf8");
	return {
		fakeRoot,
		fakeScript,
		cleanup: () => rmSync(fakeRoot, { recursive: true, force: true }),
	};
}

test("skip-list does NOT include 'node' (regression: self-matching bug)", () => {
	assert.ok(
		existsSync(SCRIPT_PATH),
		`expected ${SCRIPT_PATH} to exist for the static check`,
	);
	const source = readFileSync(SCRIPT_PATH, "utf8");
	const match = source.match(/\$cliNames\s*=\s*@\(\s*([\s\S]+?)\s*\)/u);
	assert.ok(match, `could not find $cliNames array literal in the script`);
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
		`regression: 'node' must NOT be in the skip-list (it would self-match the script's own child process). Got: [${names.join(", ")}]`,
	);
	for (const expected of ["pi", "opencode", "opencode-go", "opencode-zen"]) {
		assert.ok(
			names.includes(expected),
			`expected '${expected}' in skip-list, got: [${names.join(", ")}]`,
		);
	}
});

test("script honours the trigger-disabled opt-in and exits silently (no output, no log)", async () => {
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

test("script proceeds past skip checks when no interactive CLI is open and trigger is default-enabled", async () => {
	const { fakeRoot, fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		// No IDU_PI_TICK_STATE_ROOT → trigger opt-in check is skipped.
		// No trigger file → even if stateRoot were set, default is enabled.
		// The fake root has no tsconfig.json, so tsc will fail and the
		// script will exit 1 — but it must have PROCEEDED past the skip
		// checks (no "skipped:" reason in stdout).
		const result = await runScript(fakeScript, {});
		assert.match(
			result.stdout,
			/tsc falló/u,
			`expected script to reach tsc and fail (proves it proceeded past the skip checks), got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: CLI active/u,
			`script must not skip with 'skipped: CLI active' when no CLI is open, got: ${result.stdout}`,
		);
		assert.doesNotMatch(
			result.stdout,
			/skipped: trigger disabled by user/u,
			`script must not skip with 'skipped: trigger disabled by user' when no trigger file is present, got: ${result.stdout}`,
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
		const result = await runScript(fakeScript, {
			IDU_PI_TICK_STATE_ROOT: fakeStateRoot,
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
	} finally {
		cleanup();
	}
});

test("IDU_PI_TICK_FORCE=1 bypasses the CLI-active check (override still works)", async () => {
	const { fakeScript, cleanup } = copyScriptToTempRoot();
	try {
		// With IDU_PI_TICK_FORCE=1 the script should never log
		// "skipped: CLI active" even if a `pi` process were running.
		// We don't need to actually have a `pi` process — the force
		// flag short-circuits the CLI check. The script will then
		// proceed to tsc and fail (no tsconfig.json in fake root).
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
			/skipped: CLI active/u,
			`IDU_PI_TICK_FORCE=1 must bypass the CLI check, got: ${result.stdout}`,
		);
	} finally {
		cleanup();
	}
});
