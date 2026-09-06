import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import {
	IDU_LOGS_DIR,
	IDU_RUNTIME_DIR,
	IDU_SESSIONS_DIR,
	ensureIduDirectories,
	getProfile,
	loadIduConfig,
	loadProfilesConfig,
} from "./config.js";
import { buildWorkerArgs, checkCliAvailable } from "./cmdline.js";
import type {
	CapabilitiesResult,
	DelegateRequest,
	DelegateResult,
	RunRecord,
	RunStatus,
} from "./types.js";

const activeProcesses = new Map<string, { process: ChildProcess; record: RunRecord }>();

function generateRunId(profile: string): string {
	const now = new Date();
	const datePart = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const rand = Math.random().toString(36).slice(2, 6);
	return `IDU-${datePart}-${profile}-${rand}`;
}

export class CrossCliProcessManager {
	private static instance: CrossCliProcessManager;

	private constructor() {
		ensureIduDirectories();
	}

	public static getInstance(): CrossCliProcessManager {
		if (!CrossCliProcessManager.instance) {
			CrossCliProcessManager.instance = new CrossCliProcessManager();
		}
		return CrossCliProcessManager.instance;
	}

	public getCapabilities(): CapabilitiesResult {
		const config = loadIduConfig();
		const { profiles } = loadProfilesConfig();

		const installedClis = Object.entries(config.clis).map(([name, def]) => ({
			name,
			command: def.command,
			available: checkCliAvailable(def.command),
		}));

		return {
			installedClis,
			profiles,
			oneOrchestratorRule: config.oneOrchestratorRule,
		};
	}

	public async delegate(request: DelegateRequest, asyncExecution = false): Promise<DelegateResult> {
		const config = loadIduConfig();

		// 1. ONE ORCHESTRATOR RULE: Enforce non-recursion
		if (
			config.oneOrchestratorRule.enabled &&
			!config.oneOrchestratorRule.allowRecursiveDelegation
		) {
			if (process.env.IDU_WORKER === "true" && process.env.IDU_ALLOW_DELEGATION === "false") {
				throw new Error(
					`ONE ORCHESTRATOR RULE VIOLATION: Current process is already an active worker (IDU_RUN_ID: ${process.env.IDU_RUN_ID}). Recursive sub-delegation is disallowed.`,
				);
			}
		}

		// 2. Validate profile
		const profile = getProfile(request.profile);
		if (!profile) {
			throw new Error(
				`Profile "${request.profile}" not found in ~/.idu/profiles.json. Available profiles: ${Object.keys(loadProfilesConfig().profiles).join(", ")}`,
			);
		}

		// 3. Build command line
		const runId = generateRunId(request.profile);
		const workingDir = request.workingDir || process.cwd();
		const { command, args } = buildWorkerArgs(profile, request.task, request.contextFiles, config);

		const startedAt = new Date().toISOString();
		const logPath = join(IDU_LOGS_DIR, `${runId}.log`);
		const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
		const pidPath = join(IDU_RUNTIME_DIR, `${runId}.pid`);

		const record: RunRecord = {
			runId,
			request,
			profile,
			command,
			args,
			status: "pending",
			exitCode: null,
			startedAt,
			logPath,
		};

		// 4. Injected environment variables (The anti-recursion boundary)
		const env: NodeJS.ProcessEnv = {
			...process.env,
			IDU_WORKER: "true",
			IDU_PARENT: request.parentOrchestrator || "orchestrator",
			IDU_ALLOW_DELEGATION: "false",
			IDU_RUN_ID: runId,
			IDU_PROFILE: request.profile,
			IDU_HARNESS: profile.harness,
			IDU_MODEL: profile.model || "",
		};

		// 5. Spawn child process
		const logStream = createWriteStream(logPath, { flags: "a" });
		logStream.write(`=== IDU RUN START: ${runId} ===\n`);
		logStream.write(`Time: ${startedAt}\n`);
		logStream.write(`Harness: ${profile.harness} | Model: ${profile.model || "default"}\n`);
		logStream.write(`Command: ${command} ${args.join(" ")}\n`);
		logStream.write(`WorkingDir: ${workingDir}\n`);
		logStream.write(`===========================================\n\n`);

		let stdoutBuffer = "";
		let stderrBuffer = "";

		const isCmd = process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"));
		const child = spawn(command, args, {
			cwd: workingDir,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			shell: isCmd,
			windowsHide: true,
		});

		record.pid = child.pid;
		record.status = "running";
		writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");

		if (child.pid) {
			writeFileSync(pidPath, child.pid.toString(), "utf8");
		}

		activeProcesses.set(runId, { process: child, record });

		child.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdoutBuffer += text;
			logStream.write(chunk);
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderrBuffer += text;
			logStream.write(chunk);
		});

		const timeoutMs = request.timeoutMs ?? config.defaultTimeoutMs;

		const completionPromise = new Promise<DelegateResult>((resolve) => {
			let timer: NodeJS.Timeout | null = null;
			if (timeoutMs > 0) {
				timer = setTimeout(() => {
					if (record.status === "running") {
						record.status = "timeout";
						record.error = `Execution timed out after ${timeoutMs}ms`;
						try {
							child.kill("SIGTERM");
						} catch {
							// best effort
						}
					}
				}, timeoutMs);
			}

			child.on("error", (err) => {
				if (timer) clearTimeout(timer);
				record.status = "failed";
				record.error = err.message;
				record.completedAt = new Date().toISOString();
				logStream.write(`\n\n=== PROCESS ERROR: ${err.message} ===\n`);
				logStream.end();
				this.cleanupRun(runId, pidPath, sessionPath, record);
				resolve(this.buildResult(record, stdoutBuffer, stderrBuffer));
			});

			child.on("close", (code) => {
				if (timer) clearTimeout(timer);
				record.exitCode = code;
				if (record.status !== "timeout") {
					record.status = code === 0 ? "completed" : "failed";
				}
				record.completedAt = new Date().toISOString();
				record.resultSummary = stdoutBuffer.slice(-2000).trim() || `Process exited with code ${code}`;
				logStream.write(`\n\n=== PROCESS CLOSED WITH CODE ${code} ===\n`);
				logStream.end();
				this.cleanupRun(runId, pidPath, sessionPath, record);
				resolve(this.buildResult(record, stdoutBuffer, stderrBuffer));
			});
		});

		if (asyncExecution) {
			return {
				runId,
				profile: request.profile,
				harness: profile.harness,
				model: profile.model,
				status: "running",
				exitCode: null,
				stdout: "",
				stderr: "",
				summary: `Worker started in background with PID ${child.pid}`,
				startedAt,
				logPath,
			};
		}

		return await completionPromise;
	}

	public getStatus(runId: string): RunRecord | null {
		const inMem = activeProcesses.get(runId);
		if (inMem) return inMem.record;

		const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
		if (!existsSync(sessionPath)) return null;

		try {
			return JSON.parse(readFileSync(sessionPath, "utf8")) as RunRecord;
		} catch {
			return null;
		}
	}

	public getResult(runId: string): DelegateResult | null {
		const status = this.getStatus(runId);
		if (!status) return null;

		let stdout = "";
		let stderr = "";
		if (existsSync(status.logPath)) {
			const fullLog = readFileSync(status.logPath, "utf8");
			stdout = fullLog.slice(-10000); // Last 10KB
		}

		return this.buildResult(status, stdout, stderr);
	}

	private cleanupRun(
		runId: string,
		pidPath: string,
		sessionPath: string,
		record: RunRecord,
	): void {
		activeProcesses.delete(runId);
		if (existsSync(pidPath)) {
			try {
				unlinkSync(pidPath);
			} catch {
				// best effort
			}
		}
		try {
			writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");
		} catch {
			// best effort
		}
	}

	private buildResult(record: RunRecord, stdout: string, stderr: string): DelegateResult {
		const start = new Date(record.startedAt).getTime();
		const end = record.completedAt ? new Date(record.completedAt).getTime() : Date.now();
		return {
			runId: record.runId,
			profile: record.request.profile,
			harness: record.profile.harness,
			model: record.profile.model,
			status: record.status,
			exitCode: record.exitCode,
			stdout: stdout.trim(),
			stderr: stderr.trim(),
			summary: record.resultSummary || record.error || `Worker status: ${record.status}`,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
			durationMs: end - start,
			logPath: record.logPath,
		};
	}
}
