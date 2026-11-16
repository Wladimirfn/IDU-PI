import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_EVAL_TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 64 * 1024;

export interface IsolatedCommandResult {
	passed: boolean;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	detail?: string;
}

function appendCapped(chunks: Buffer[], chunk: Buffer, currentBytes: { value: number }): void {
	if (currentBytes.value >= MAX_CAPTURE_BYTES) return;
	const remaining = MAX_CAPTURE_BYTES - currentBytes.value;
	chunks.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
	currentBytes.value += Math.min(chunk.length, remaining);
}

function terminateTree(pid: number | undefined): void {
	if (!pid || pid <= 0) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => {
			// Best-effort process tree kill; process may already have exited.
		});
		return;
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Process may already have exited.
	}
}

function buildEvalEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	const secretPrefixes = ["IDU_", "NAN_", "OPENAI_", "ANTHROPIC_", "GEMINI_", "MISTRAL_", "MINIMAX_", "ZHIPU_", "MOONSHOT_"];
	for (const key of Object.keys(env)) {
		if (secretPrefixes.some((prefix) => key.startsWith(prefix))) {
			delete env[key];
		}
	}
	return env;
}

/**
 * Runs a Node subprocess asynchronously with a hard timeout and full process-tree cleanup,
 * preventing infinite loops or microtask starvation in worker code from stalling the runner.
 */
export function runIsolatedNodeCommand(params: {
	cwd: string;
	args: string[];
	timeoutMs?: number;
}): Promise<IsolatedCommandResult> {
	const timeoutMs = params.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
	return new Promise((resolve) => {
		let settled = false;
		let timedOut = false;
		let postExitTimer: NodeJS.Timeout | undefined;
		let forceResolveTimer: NodeJS.Timeout | undefined;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		const outBytes = { value: 0 };
		const errBytes = { value: 0 };

		const finish = (code: number | null, errMessage?: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			if (postExitTimer) clearTimeout(postExitTimer);
			if (forceResolveTimer) clearTimeout(forceResolveTimer);

			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			const passed = !timedOut && !errMessage && code === 0;
			let detail: string | undefined;
			if (!passed) {
				if (timedOut) {
					detail = `Evaluation timed out after ${timeoutMs}ms`;
				} else if (errMessage) {
					detail = errMessage;
				} else {
					const combined = (stderr || stdout).trim();
					detail = combined || `Subprocess exited with code ${code ?? "null"}`;
				}
			}
			resolve({ passed, stdout, stderr, timedOut, detail });
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(process.execPath, params.args, {
				cwd: params.cwd,
				env: buildEvalEnv(),
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			resolve({ passed: false, stdout: "", stderr: msg, timedOut: false, detail: msg });
			return;
		}

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			terminateTree(child.pid);
			forceResolveTimer = setTimeout(() => finish(null), 1500);
		}, timeoutMs);

		child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdoutChunks, chunk, outBytes));
		child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderrChunks, chunk, errBytes));
		child.on("error", (err) => finish(null, err.message));
		child.on("exit", (code) => {
			// Guard against detached grandchild processes keeping stdio pipes open.
			postExitTimer = setTimeout(() => {
				terminateTree(child.pid);
				finish(code);
			}, 1000);
		});
		child.on("close", (code) => finish(code));
	});
}

/**
 * Evaluates a worker module inside an isolated temporary ESM runner script so untrusted code
 * cannot stall the benchmark runner event loop, pollute ESM caches, or leak open handles.
 */
export async function runIsolatedNodeModuleCheck(params: {
	sandboxDir: string;
	scriptBody: string;
	timeoutMs?: number;
}): Promise<{ passed: boolean; detail?: string }> {
	const tempDir = mkdtempSync(join(tmpdir(), "idu-eval-check-"));
	const scriptPath = join(tempDir, "check.mjs");
	const wrapped = [
		'import assert from "node:assert/strict";',
		'import { mkdtempSync, rmSync, writeFileSync } from "node:fs";',
		'import { tmpdir } from "node:os";',
		'import { join } from "node:path";',
		'import { pathToFileURL } from "node:url";',
		"",
		"const sandboxDir = process.argv[2];",
		"async function run() {",
		params.scriptBody,
		"}",
		"",
		"try {",
		"  await run();",
		"} catch (err) {",
		"  console.error(err instanceof Error ? err.message : String(err));",
		"  process.exitCode = 1;",
		"}",
		"",
	].join("\n");

	try {
		writeFileSync(scriptPath, wrapped, "utf8");
		const res = await runIsolatedNodeCommand({
			cwd: params.sandboxDir,
			args: [scriptPath, params.sandboxDir],
			timeoutMs: params.timeoutMs,
		});
		return {
			passed: res.passed,
			detail: res.detail,
		};
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
