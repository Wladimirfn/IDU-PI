#!/usr/bin/env node
import {
	readFileSync,
	writeFileSync,
	openSync,
	closeSync,
	writeSync,
	statSync,
	unlinkSync,
	existsSync,
} from "node:fs";
import { spawn } from "node:child_process";
import type { RunnerSpec, RunRecord, SessionTreeEntry } from "./types.js";
import {
	writeJsonAtomic,
	killProcessTree,
	extractCleanSummary,
	loadSessionTree,
	saveSessionTree,
	getSessionKey,
} from "./process-manager.js";

function parseArgs(): string {
	const args = process.argv.slice(2);
	const specIndex = args.indexOf("--spec");
	if (specIndex === -1 || !args[specIndex + 1]) {
		console.error("Error: --spec <specPath> is required");
		process.exit(1);
	}
	return args[specIndex + 1];
}

async function runDaemon(): Promise<void> {
	const specPath = parseArgs();
	if (!existsSync(specPath)) {
		console.error(`Error: Spec file not found: ${specPath}`);
		process.exit(1);
	}

	let spec: RunnerSpec;
	try {
		spec = JSON.parse(readFileSync(specPath, "utf8"));
	} catch (err: any) {
		console.error(`Error: Failed to parse spec file: ${err.message}`);
		process.exit(1);
	}

	const runnerPid = process.pid;

	if (spec.runnerPidPath) {
		try {
			writeFileSync(spec.runnerPidPath, String(runnerPid), "utf8");
		} catch {
			// best effort
		}
	}

	let record: RunRecord;
	if (existsSync(spec.sessionPath)) {
		try {
			record = JSON.parse(readFileSync(spec.sessionPath, "utf8"));
		} catch {
			record = createInitialRecord(spec, runnerPid);
		}
	} else {
		record = createInitialRecord(spec, runnerPid);
	}

	record.runnerPid = runnerPid;
	writeJsonAtomic(spec.sessionPath, record);

	let logFd: number;
	try {
		logFd = openSync(spec.logPath, "a");
	} catch (err: any) {
		record.status = "failed";
		record.error = `Failed to open log file: ${err.message}`;
		record.completedAt = new Date().toISOString();
		writeJsonAtomic(spec.sessionPath, record);
		process.exit(1);
	}

	try {
		const stat = statSync(spec.logPath);
		if (stat.size === 0) {
			const header = [
				`=== IDU RUN START: ${spec.runId} ===`,
				`Time: ${spec.startedAt || new Date().toISOString()}`,
				`Session: ${spec.sessionId} (Parent: ${spec.parentSessionId || "none"})`,
				`Harness: ${spec.harness}`,
				`Command: ${spec.command} ${spec.args.join(" ")}`,
				`WorkingDir: ${spec.workingDir}`,
				`Runner PID: ${runnerPid}`,
				`===========================================`,
				"",
				"",
			].join("\n");
			writeSync(logFd, header);
		}
	} catch {
		// best effort
	}

	const isShell =
		spec.shell ??
		(process.platform === "win32" &&
			(spec.command.endsWith(".cmd") || spec.command.endsWith(".bat")));

	let child: ReturnType<typeof spawn>;
	try {
		child = spawn(spec.command, spec.args, {
			cwd: spec.workingDir,
			env: {
				...process.env,
				...spec.env,
			},
			stdio: ["ignore", logFd, logFd],
			shell: isShell,
			windowsHide: true,
		});
	} catch (spawnErr: any) {
		record.status = "failed";
		record.error = spawnErr.message;
		record.completedAt = new Date().toISOString();
		writeJsonAtomic(spec.sessionPath, record);
		cleanupFiles(spec);
		try {
			closeSync(logFd);
		} catch {}
		process.exit(1);
	}

	const childPid = child.pid;
	record.pid = childPid;
	record.status = "running";
	writeJsonAtomic(spec.sessionPath, record);

	if (childPid) {
		try {
			writeFileSync(spec.pidPath, String(childPid), "utf8");
		} catch {
			// best effort
		}

		if (spec.lockPath && existsSync(spec.lockPath)) {
			try {
				const lockContent = JSON.parse(readFileSync(spec.lockPath, "utf8"));
				lockContent.workerPid = childPid;
				writeFileSync(spec.lockPath, JSON.stringify(lockContent, null, 2), "utf8");
			} catch {
				// best effort
			}
		}
	}

	const startMs = Date.now();
	let lastActivityTime = Date.now();
	let firstByteReceived = false;
	let lastKnownLogSize = 0;
	try {
		lastKnownLogSize = statSync(spec.logPath).size;
	} catch {}

	let isCompleted = false;
	let watchdogTimer: NodeJS.Timeout | null = null;
	let fallbackTimer: NodeJS.Timeout | null = null;

	const finalize = (
		exitCode: number | null,
		overrideStatus?: "completed" | "failed" | "timeout",
		errorMsg?: string,
	) => {
		if (isCompleted) return;
		isCompleted = true;

		if (watchdogTimer) clearInterval(watchdogTimer);
		if (fallbackTimer) clearTimeout(fallbackTimer);

		record.exitCode = exitCode;
		record.completedAt = new Date().toISOString();

		if (overrideStatus) {
			record.status = overrideStatus;
		} else if (record.status !== "timeout") {
			record.status = exitCode === 0 ? "completed" : "failed";
		}

		if (errorMsg) {
			record.error = errorMsg;
		}

		let fullOutput = "";
		try {
			fullOutput = readFileSync(spec.logPath, "utf8");
		} catch {
			// best effort
		}

		const cleanSummary = extractCleanSummary(fullOutput, spec.harness);
		if (record.status !== "timeout") {
			record.resultSummary =
				cleanSummary ||
				(exitCode === 0
					? "Task completed successfully"
					: `Process exited with code ${exitCode}`);
		}

		try {
			const tree = loadSessionTree();
			const key = getSessionKey(spec.workingDir, spec.sessionId);
			const entry: SessionTreeEntry = tree[key] || {
				sessionId: spec.sessionId,
				parentSessionId: spec.parentSessionId,
				profile: record.request?.profile || "unknown",
				harness: spec.harness,
				workingDir: spec.workingDir,
				createdAt: record.startedAt,
				lastActiveAt: record.completedAt,
				turnCount: 0,
				runs: [],
			};
			if (!entry.nativeSessionId && fullOutput) {
				if (spec.harness === "opencode") {
					const m = fullOutput.match(/"sessionID"\s*:\s*"([^"]+)"/);
					if (m) entry.nativeSessionId = m[1];
				} else if (spec.harness === "antigravity") {
					const m = fullOutput.match(/"conversationId"\s*:\s*"([^"]+)"/);
					if (m) entry.nativeSessionId = m[1];
				}
			}
			entry.lastActiveAt = record.completedAt;
			entry.turnCount += 1;
			if (!entry.runs.includes(spec.runId)) {
				entry.runs.push(spec.runId);
			}
			tree[key] = entry;
			saveSessionTree(tree);
		} catch {
			// best effort
		}

		writeJsonAtomic(spec.sessionPath, record);

		try {
			const closeMsg = `\n\n=== PROCESS CLOSED WITH CODE ${exitCode} ===\n`;
			writeSync(logFd, closeMsg);
		} catch {
			// best effort
		}

		try {
			closeSync(logFd);
		} catch {}

		cleanupFiles(spec);
		process.exit(record.status === "completed" ? 0 : 1);
	};

	const triggerTimeout = (reason: string) => {
		if (record.status !== "running") return;
		record.status = "timeout";
		record.error = `Execution timed out: ${reason}`;
		if (childPid) {
			killProcessTree(childPid, reason);
		}

		fallbackTimer = setTimeout(() => {
			finalize(null, "timeout", `Execution timed out: ${reason}`);
		}, 10_000);
		fallbackTimer.unref();
	};

	let lastDiskSync = Date.now();

	watchdogTimer = setInterval(() => {
		if (isCompleted) return;

		const now = Date.now();
		const elapsedTotal = now - startMs;

		try {
			const currentSize = statSync(spec.logPath).size;
			if (currentSize > lastKnownLogSize) {
				lastActivityTime = now;
				firstByteReceived = true;
				record.lastActivityAt = new Date().toISOString();
				record.bytesEmitted = currentSize;
				lastKnownLogSize = currentSize;
			}
		} catch {
			// best effort
		}

		if (now - lastDiskSync > 10_000) {
			lastDiskSync = now;
			writeJsonAtomic(spec.sessionPath, record);
		}

		if (spec.hardCapMs && spec.hardCapMs > 0 && elapsedTotal > spec.hardCapMs) {
			triggerTimeout(
				`exceeded hard cap of ${spec.hardCapMs}ms (${Math.round(spec.hardCapMs / 60000)}m)`,
			);
			return;
		}

		if (spec.streams && spec.idleTimeoutMs && spec.idleTimeoutMs > 0) {
			const allowedSilence = firstByteReceived
				? spec.idleTimeoutMs
				: spec.startupGraceMs || 120_000;
			const silentDuration = now - lastActivityTime;
			if (silentDuration > allowedSilence) {
				triggerTimeout(
					`inactivity for ${silentDuration}ms without output (idle limit ${allowedSilence}ms)`,
				);
				return;
			}
		} else if (!spec.streams && spec.timeoutMs && spec.timeoutMs > 0) {
			if (elapsedTotal > spec.timeoutMs) {
				triggerTimeout(`reached timeout limit of ${spec.timeoutMs}ms`);
				return;
			}
		}
	}, 3_000);
	watchdogTimer.unref();

	child.on("error", (err) => {
		finalize(null, "failed", err.message);
	});

	child.on("close", (code) => {
		finalize(code);
	});
}

function createInitialRecord(spec: RunnerSpec, runnerPid: number): RunRecord {
	return {
		runId: spec.runId,
		sessionId: spec.sessionId,
		parentSessionId: spec.parentSessionId,
		isResumed: false,
		request: {
			task: "",
			profile: "",
			workingDir: spec.workingDir,
		},
		profile: {
			harness: spec.harness,
		},
		command: spec.command,
		args: spec.args,
		runnerPid,
		status: "running",
		exitCode: null,
		startedAt: spec.startedAt || new Date().toISOString(),
		logPath: spec.logPath,
	};
}

function cleanupFiles(spec: RunnerSpec): void {
	if (spec.lockPath && existsSync(spec.lockPath)) {
		try {
			unlinkSync(spec.lockPath);
		} catch {}
	}
	if (spec.pidPath && existsSync(spec.pidPath)) {
		try {
			unlinkSync(spec.pidPath);
		} catch {}
	}
	if (spec.runnerPidPath && existsSync(spec.runnerPidPath)) {
		try {
			unlinkSync(spec.runnerPidPath);
		} catch {}
	}
	if (spec.specPath && existsSync(spec.specPath)) {
		try {
			unlinkSync(spec.specPath);
		} catch {}
	}
}

runDaemon().catch((err) => {
	console.error("Fatal runner daemon error:", err);
	process.exit(1);
});
