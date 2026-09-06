import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	openSync,
	closeSync,
	renameSync,
	createWriteStream,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	IDU_LOCKS_DIR,
	IDU_LOGS_DIR,
	IDU_RUNTIME_DIR,
	IDU_SESSIONS_DIR,
	ensureIduDirectories,
	getProfile,
	loadIduConfig,
	loadProfilesConfig,
} from "./config.js";
import { buildWorkerArgs, checkCliAvailable, unwrapCmdExecutable } from "./cmdline.js";
import type {
	CapabilitiesResult,
	DelegateRequest,
	DelegateResult,
	RunRecord,
	RunStatus,
	SessionTreeEntry,
} from "./types.js";

const activeProcesses = new Map<string, { process: ChildProcess; record: RunRecord }>();
const SESSION_TREE_PATH = join(IDU_SESSIONS_DIR, "tree.json");

export function killProcessTree(child: ChildProcess, reason = "termination"): void {
	if (!child.pid) return;

	if (process.platform === "win32") {
		// Reliable process tree termination on Windows (cmd.exe wrapper + child processes)
		try {
			execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		} catch {
			try {
				child.kill("SIGKILL");
			} catch {
				// best effort
			}
		}
		return;
	}

	// POSIX: process group kill with escalation
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		try {
			child.kill("SIGTERM");
		} catch {
			// best effort
		}
	}

	const escalationTimer = setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) {
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				try {
					child.kill("SIGKILL");
				} catch {
					// best effort
				}
			}
		}
	}, 5_000);
	escalationTimer.unref();
}

function generateRunId(profile: string): string {
	const now = new Date();
	const datePart = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const rand = Math.random().toString(36).slice(2, 6);
	return `IDU-${datePart}-${profile}-${rand}`;
}

export function isUuid(str: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

export function aliasToUuid(alias: string): string {
	if (isUuid(alias)) return alias;
	const hash = createHash("sha256").update(alias).digest("hex");
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function getSessionKey(cwd: string, sessionId: string): string {
	return `${resolve(cwd)}::${sessionId}`;
}

export function loadSessionTree(): Record<string, SessionTreeEntry> {
	ensureIduDirectories();
	if (!existsSync(SESSION_TREE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(SESSION_TREE_PATH, "utf8"));
	} catch {
		return {};
	}
}

export function saveSessionTree(tree: Record<string, SessionTreeEntry>): void {
	ensureIduDirectories();
	const tmpPath = `${SESSION_TREE_PATH}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(tree, null, 2), "utf8");
	renameSync(tmpPath, SESSION_TREE_PATH);
}

export interface SessionLockHandle {
	lockPath: string;
	updatePid?: (newPid: number) => void;
	release: () => void;
}

export function acquireSessionLock(sessionId: string, cwd: string, currentPid: number): SessionLockHandle {
	ensureIduDirectories();
	const cwdHash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 8);
	const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const lockPath = join(IDU_LOCKS_DIR, `sess_${cwdHash}_${safeName}.lock`);
	const ownerPids = new Set<number>([currentPid]);

	const writeLockFile = (): boolean => {
		try {
			const fd = openSync(lockPath, "wx");
			writeFileSync(
				fd,
				JSON.stringify({ pid: currentPid, cwd: resolve(cwd), time: new Date().toISOString() }),
				"utf8",
			);
			closeSync(fd);
			return true;
		} catch (err: any) {
			if (err.code === "EEXIST") {
				return false;
			}
			throw err;
		}
	};

	if (!writeLockFile()) {
		// Existing lock found, check if process is alive
		let lockData: { pid?: number; cwd?: string; time?: string } = {};
		let isCorrupted = false;

		try {
			const raw = readFileSync(lockPath, "utf8");
			lockData = JSON.parse(raw);
			if (typeof lockData.pid !== "number") {
				isCorrupted = true;
			}
		} catch {
			isCorrupted = true;
		}

		if (isCorrupted) {
			// Remove corrupt or unparseable lock and retry acquisition
			try {
				unlinkSync(lockPath);
			} catch {
				// best effort
			}
			if (!writeLockFile()) {
				throw new Error(`Failed to acquire lock after removing corrupted lock for "${sessionId}".`);
			}
		} else if (lockData.pid) {
			try {
				process.kill(lockData.pid, 0);
				// Process is alive! Concurrency violation
				throw new Error(
					`Session "${sessionId}" is currently in use by active process (PID ${lockData.pid}). Use fork=true to branch or wait for completion.`,
				);
			} catch (err: any) {
				if (err.code === "EPERM") {
					// On Windows, EPERM means process is ALIVE with different permissions/elevation!
					// DO NOT STEAL THE LOCK!
					throw new Error(
						`Session "${sessionId}" is currently in use by active process (PID ${lockData.pid}). Use fork=true to branch or wait for completion.`,
					);
				} else if (err.code === "ESRCH") {
					// Process is dead: remove stale lock and retry acquisition
					try {
						unlinkSync(lockPath);
					} catch {
						// ignore
					}
					if (!writeLockFile()) {
						throw new Error(`Failed to acquire reclaimed session lock for "${sessionId}".`);
					}
				} else {
					throw err;
				}
			}
		}
	}

	return {
		lockPath,
		updatePid: (newPid: number) => {
			ownerPids.add(newPid);
			try {
				writeFileSync(
					lockPath,
					JSON.stringify({ pid: newPid, cwd: resolve(cwd), time: new Date().toISOString() }),
					"utf8",
				);
			} catch {
				// best effort
			}
		},
		release: () => {
			try {
				if (existsSync(lockPath)) {
					const raw = readFileSync(lockPath, "utf8");
					const data = JSON.parse(raw);
					if (data.pid && ownerPids.has(data.pid)) {
						unlinkSync(lockPath);
					}
				}
			} catch {
				// best effort
			}
		},
	};
}

export function extractCleanSummary(stdout: string, harness = ""): string {
	if (!stdout) return "";

	const trimmed = stdout.trim();

	// Try parsing NDJSON lines (OpenCode / Claude stream-json)
	const lines = trimmed.split("\n");
	const assistantTexts: string[] = [];
	let definitiveResult = "";

	for (const line of lines) {
		const l = line.trim();
		if (!l.startsWith("{") || !l.endsWith("}")) continue;
		try {
			const parsed = JSON.parse(l);

			// Claude final result event has the highest priority
			if (parsed.type === "result" && typeof parsed.result === "string" && parsed.result.trim()) {
				definitiveResult = parsed.result.trim();
			}

			// OpenCode NDJSON events
			if (parsed.type === "text") {
				if (typeof parsed.text === "string" && parsed.text) {
					assistantTexts.push(parsed.text);
				} else if (parsed.part && typeof parsed.part.text === "string" && parsed.part.text) {
					assistantTexts.push(parsed.part.text);
				}
			} else if (parsed.type === "agent_message" && typeof parsed.message === "string") {
				assistantTexts.push(parsed.message);
			} else if (parsed.type === "message" && parsed.role === "assistant") {
				if (typeof parsed.content === "string") {
					assistantTexts.push(parsed.content);
				} else if (Array.isArray(parsed.content)) {
					for (const c of parsed.content) {
						if (c?.type === "text" && c.text) assistantTexts.push(c.text);
					}
				}
			}

			// Claude stream-json events
			if (parsed.type === "assistant" && parsed.message?.content) {
				if (Array.isArray(parsed.message.content)) {
					for (const c of parsed.message.content) {
						if (c?.type === "text" && c.text) assistantTexts.push(c.text);
					}
				}
			}
		} catch {
			// not valid JSON line, ignore
		}
	}

	if (definitiveResult) {
		return definitiveResult;
	}

	if (assistantTexts.length > 0) {
		// If multiple messages, find the last substantial text block (the final answer/report)
		const lastSubstantial = [...assistantTexts].reverse().find((t) => t.length > 100);
		if (lastSubstantial) {
			return lastSubstantial.trim();
		}
		return assistantTexts[assistantTexts.length - 1].trim();
	}

	// Plain-text fallback: strip wrapper header and footer markers
	const cleaned = trimmed
		.replace(/^=== IDU RUN START:[^=]+===\s*[\r\n]+(?:[^\r\n]+[\r\n]+){1,6}={20,}[\r\n]+/i, "")
		.replace(/[\r\n]+=== PROCESS (?:CLOSED|EXITED|ERROR)[^\r\n]*===[\r\n]*$/i, "")
		.trim();

	return cleaned;
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

	public listSessions(): SessionTreeEntry[] {
		const tree = loadSessionTree();
		return Object.values(tree).sort(
			(a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
		);
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

		// 3. Resolve session continuity and hierarchy (The Universal Triad: id / resume / fork)
		const workingDir = request.workingDir || process.cwd();
		const tree = loadSessionTree();

		let requestedSessionId = request.sessionId?.trim();
		let parentSessionId = request.parentSessionId?.trim();
		let isResumed = false;
		let effectiveSessionId: string;

		const isClaude = profile.harness === "claude" || profile.harness === "claude-code";

		if (requestedSessionId) {
			// For Claude, session ID must be a valid UUID v4; if alias given, map deterministically
			if (isClaude && !isUuid(requestedSessionId)) {
				requestedSessionId = aliasToUuid(requestedSessionId);
			}
			if (isClaude && parentSessionId && !isUuid(parentSessionId)) {
				parentSessionId = aliasToUuid(parentSessionId);
			}

			const sessionKey = getSessionKey(workingDir, requestedSessionId);
			const sessionExists = Boolean(tree[sessionKey]);

			if (request.fork) {
				// Fork: Create a new session branching from requestedSessionId
				parentSessionId = requestedSessionId;
				effectiveSessionId = isClaude
					? randomUUID()
					: `fork-${requestedSessionId.slice(0, 8)}-${randomUUID().slice(0, 6)}`;
				isResumed = false;
			} else if (sessionExists) {
				// Resume: Continue existing conversation in workingDir
				effectiveSessionId = requestedSessionId;
				isResumed = true;
			} else {
				// New session with user-specified or pre-allocated UUID
				effectiveSessionId = requestedSessionId;
				isResumed = false;
			}
		} else {
			// Fresh session: generate new UUID v4
			effectiveSessionId = randomUUID();
			isResumed = false;
		}

		// 4. Resolve native CLI session IDs if present (e.g. OpenCode ses_... IDs)
		const sessionKey = requestedSessionId ? getSessionKey(workingDir, requestedSessionId) : "";
		const existingEntry = sessionKey ? tree[sessionKey] : undefined;
		const nativeSessionId = existingEntry?.nativeSessionId;

		let parentNativeSessionId: string | undefined;
		if (parentSessionId) {
			const parentKey = getSessionKey(workingDir, parentSessionId);
			parentNativeSessionId = tree[parentKey]?.nativeSessionId;
		}

		// 5. Build command line with session flags
		const runId = generateRunId(request.profile);
		const { command: rawCommand, args: rawArgs } = buildWorkerArgs(
			profile,
			request.task,
			request.contextFiles,
			config,
			{
				sessionId: effectiveSessionId,
				parentSessionId,
				nativeSessionId,
				parentNativeSessionId,
				isResumed,
				fork: Boolean(request.fork),
			},
		);
		const { command, args, isShell } = unwrapCmdExecutable(rawCommand, rawArgs);

		const startedAt = new Date().toISOString();
		const logPath = join(IDU_LOGS_DIR, `${runId}.log`);
		const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
		const pidPath = join(IDU_RUNTIME_DIR, `${runId}.pid`);

		const record: RunRecord = {
			runId,
			sessionId: effectiveSessionId,
			parentSessionId,
			isResumed,
			request,
			profile,
			command,
			args,
			status: "pending",
			exitCode: null,
			startedAt,
			logPath,
		};

		// 5. Acquire session concurrency lock (prevent race conditions on the same session in workingDir)
		const sessionLock = acquireSessionLock(effectiveSessionId, workingDir, process.pid);

		// 6. Setup environment with ONE ORCHESTRATOR RULE markers
		const env = {
			...process.env,
			IDU_WORKER: "true",
			IDU_PARENT: request.parentOrchestrator || "idu-router",
			IDU_ALLOW_DELEGATION: "false",
			IDU_RUN_ID: runId,
			IDU_PROFILE: request.profile,
			IDU_SESSION_ID: effectiveSessionId,
		};

		// 7. Initialize log file
		ensureIduDirectories();
		const logStream = createWriteStream(logPath, { flags: "a" });
		const header = [
			`=== IDU RUN START: ${runId} ===`,
			`Time: ${startedAt}`,
			`Session: ${effectiveSessionId} (Resumed: ${isResumed}, Parent: ${parentSessionId || "none"})`,
			`Harness: ${profile.harness} | Model: ${profile.model || "default"}`,
			`Command: ${command} ${args.join(" ")}`,
			`WorkingDir: ${workingDir}`,
			`===========================================`,
			"",
			"",
		].join("\n");
		logStream.write(header);

		let stdoutBuffer = "";
		let stderrBuffer = "";

		let child: ChildProcess;
		try {
			child = spawn(command, args, {
				cwd: workingDir,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				shell: isShell,
				windowsHide: true,
			});
		} catch (spawnErr: any) {
			sessionLock.release();
			record.status = "failed";
			record.error = spawnErr.message;
			record.completedAt = new Date().toISOString();
			writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");
			throw spawnErr;
		}

		record.pid = child.pid;
		record.status = "running";
		writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");

		if (child.pid) {
			writeFileSync(pidPath, child.pid.toString(), "utf8");
			// Update lock file with actual child PID
			sessionLock.updatePid?.(child.pid);
		}

		activeProcesses.set(runId, { process: child, record });

		const effectiveTimeoutMs = request.timeoutMs ?? profile.timeoutMs ?? config.defaultTimeoutMs;
		const effectiveIdleTimeoutMs = profile.idleTimeoutMs ?? (profile.streams ? 300_000 : 0);
		let effectiveHardCapMs: number;
		if (request.timeoutMs === 0 || profile.hardCapMs === 0) {
			effectiveHardCapMs = 0; // Explicitly disabled
		} else if (profile.hardCapMs !== undefined) {
			effectiveHardCapMs = profile.hardCapMs;
		} else {
			effectiveHardCapMs = Math.max(effectiveTimeoutMs, 14_400_000); // 4 hours default
		}
		const startupGraceMs = profile.startupGraceMs ?? Math.max(effectiveIdleTimeoutMs, 120_000);
		const startMs = new Date(startedAt).getTime();

		const MAX_BUFFER = 8 * 1024 * 1024; // 8MB memory cap
		let lastActivityTime = Date.now();
		let firstByteReceived = false;
		let totalBytesEmitted = 0;
		let lastDiskSyncTime = 0;

		const onChunkReceived = (chunk: Buffer, isStderr: boolean) => {
			const text = chunk.toString();
			if (isStderr) {
				stderrBuffer += text;
				if (stderrBuffer.length > MAX_BUFFER) {
					stderrBuffer = stderrBuffer.slice(-MAX_BUFFER);
				}
			} else {
				stdoutBuffer += text;
				if (stdoutBuffer.length > MAX_BUFFER) {
					stdoutBuffer = stdoutBuffer.slice(-MAX_BUFFER);
				}
			}
			logStream.write(chunk);

			totalBytesEmitted += chunk.length;
			lastActivityTime = Date.now();
			firstByteReceived = true;
			record.lastActivityAt = new Date().toISOString();
			record.bytesEmitted = totalBytesEmitted;

			// Throttled heartbeat to session file on disk (every 10s)
			const now = Date.now();
			if (now - lastDiskSyncTime > 10_000) {
				lastDiskSyncTime = now;
				try {
					writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");
				} catch {
					// best effort
				}
			}
		};

		child.stdout?.on("data", (chunk: Buffer) => onChunkReceived(chunk, false));
		child.stderr?.on("data", (chunk: Buffer) => onChunkReceived(chunk, true));

		const completionPromise = new Promise<DelegateResult>((resolve) => {
			let watchdogTimer: NodeJS.Timeout | null = null;
			let fallbackKillTimer: NodeJS.Timeout | null = null;
			let isResolved = false;

			const finishWithResult = () => {
				if (isResolved) return;
				isResolved = true;
				if (watchdogTimer) clearInterval(watchdogTimer);
				if (fallbackKillTimer) clearTimeout(fallbackKillTimer);
				this.cleanupRun(runId, pidPath, sessionPath, record, sessionLock, stdoutBuffer);
				resolve(this.buildResult(record, stdoutBuffer, stderrBuffer, Boolean(request.verbose)));
			};

			const triggerTimeout = (reason: string) => {
				if (record.status !== "running") return;
				record.status = "timeout";
				record.error = `Execution timed out: ${reason}`;
				killProcessTree(child, reason);

				// Fallback safety: force resolve if process does not emit close within 10s of kill
				fallbackKillTimer = setTimeout(() => {
					if (!isResolved) {
						record.completedAt = new Date().toISOString();
						finishWithResult();
					}
				}, 10_000);
				fallbackKillTimer.unref();
			};

			// Setup watchdog interval
			watchdogTimer = setInterval(() => {
				if (record.status !== "running") return;
				const now = Date.now();
				const elapsedTotal = now - startMs;

				// 1. Mandatory Hard Cap check (if enabled > 0)
				if (effectiveHardCapMs > 0 && elapsedTotal > effectiveHardCapMs) {
					triggerTimeout(`exceeded hard cap of ${effectiveHardCapMs}ms (${Math.round(effectiveHardCapMs / 60000)}m)`);
					return;
				}

				// 2. Profiles with streaming enabled: check inactivity
				if (profile.streams && effectiveIdleTimeoutMs > 0) {
					const allowedSilence = firstByteReceived ? effectiveIdleTimeoutMs : startupGraceMs;
					const silentDuration = now - lastActivityTime;
					if (silentDuration > allowedSilence) {
						triggerTimeout(`inactivity for ${silentDuration}ms without output (idle limit ${allowedSilence}ms)`);
						return;
					}
				} else if (!profile.streams && effectiveTimeoutMs > 0) {
					// Non-streaming profiles: check total elapsed duration against profile/request timeout
					if (elapsedTotal > effectiveTimeoutMs) {
						triggerTimeout(`reached timeout limit of ${effectiveTimeoutMs}ms`);
						return;
					}
				}
			}, 5_000);
			watchdogTimer.unref();

			child.on("error", (err) => {
				record.status = "failed";
				record.error = err.message;
				record.completedAt = new Date().toISOString();
				logStream.write(`\n\n=== PROCESS ERROR: ${err.message} ===\n`);
				logStream.end();
				finishWithResult();
			});

			child.on("close", (code) => {
				record.exitCode = code;
				if (record.status !== "timeout") {
					record.status = code === 0 ? "completed" : "failed";
				}
				record.completedAt = new Date().toISOString();
				const cleanSummary = extractCleanSummary(stdoutBuffer, profile.harness);
				if (record.status !== "timeout") {
					record.resultSummary =
						cleanSummary || stdoutBuffer.slice(-2000).trim() || `Process exited with code ${code}`;
				}
				logStream.write(`\n\n=== PROCESS CLOSED WITH CODE ${code} ===\n`);
				logStream.end();
				finishWithResult();
			});
		});

		if (asyncExecution) {
			return {
				runId,
				sessionId: effectiveSessionId,
				parentSessionId,
				isResumed,
				profile: request.profile,
				harness: profile.harness,
				model: profile.model,
				status: "running",
				exitCode: null,
				summary: `Worker started in background with PID ${child.pid}`,
				startedAt,
				logPath,
			};
		}

		return await completionPromise;
	}

	public getStatus(runId: string): RunRecord | null {
		let record: RunRecord | null = null;
		const inMem = activeProcesses.get(runId);
		if (inMem) {
			record = inMem.record;
		} else {
			const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
			if (!existsSync(sessionPath)) return null;

			try {
				record = JSON.parse(readFileSync(sessionPath, "utf8")) as RunRecord;
			} catch {
				return null;
			}
		}

		if (record && record.status === "running" && record.pid) {
			try {
				process.kill(record.pid, 0);
			} catch (err: any) {
				if (err.code === "ESRCH") {
					record.status = "failed";
					record.completedAt = record.completedAt || new Date().toISOString();
					record.error = record.error || "Process PID no longer exists";
					const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
					try {
						writeFileSync(sessionPath, JSON.stringify(record, null, 2), "utf8");
					} catch {
						// ignore
					}
				}
			}
		}

		if (record) {
			const start = new Date(record.startedAt).getTime();
			const now = Date.now();
			record.elapsedMs = (record.completedAt ? new Date(record.completedAt).getTime() : now) - start;
			if (record.lastActivityAt) {
				record.secondsSinceLastActivity = Math.round((now - new Date(record.lastActivityAt).getTime()) / 1000);
			}
			if (record.status === "running") {
				const idleSec = record.secondsSinceLastActivity ?? 0;
				record.health = idleSec > 300 ? "idle_warning" : "healthy";
			} else if (record.status === "completed") {
				record.health = "completed";
			} else {
				record.health = "interrupted";
			}
		}

		return record;
	}

	public getResult(runId: string, verbose = false): DelegateResult | null {
		const status = this.getStatus(runId);
		if (!status) return null;

		let stdout = "";
		let stderr = "";
		if (existsSync(status.logPath)) {
			stdout = readFileSync(status.logPath, "utf8");
		}

		return this.buildResult(status, stdout, stderr, verbose);
	}

	public async waitForCompletion(
		runId: string,
		timeoutMs = 900_000,
		verbose = false,
	): Promise<DelegateResult | null> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const status = this.getStatus(runId);
			if (!status) return null;
			if (status.status !== "running" && status.status !== "pending") {
				return this.getResult(runId, verbose);
			}
			await new Promise((r) => setTimeout(r, 1_500));
		}
		return this.getResult(runId, verbose);
	}

	private cleanupRun(
		runId: string,
		pidPath: string,
		sessionPath: string,
		record: RunRecord,
		sessionLock?: SessionLockHandle | null,
		stdoutBuffer?: string,
	): void {
		activeProcesses.delete(runId);
		if (sessionLock) {
			sessionLock.release();
		}
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

		// Only update session tree if the process actually spawned and ran
		if (record.pid) {
			try {
				const workingDir = record.request.workingDir || process.cwd();
				const key = getSessionKey(workingDir, record.sessionId);
				const tree = loadSessionTree();
				const entry: SessionTreeEntry = tree[key] || {
					sessionId: record.sessionId,
					parentSessionId: record.parentSessionId,
					profile: record.request.profile,
					harness: record.profile.harness,
					workingDir,
					createdAt: record.startedAt,
					lastActiveAt: record.completedAt || record.startedAt,
					turnCount: 0,
					runs: [],
				};
				if (!entry.nativeSessionId && stdoutBuffer) {
					if (record.profile.harness === "opencode") {
						const match = stdoutBuffer.match(/"sessionID"\s*:\s*"([^"]+)"/);
						if (match) {
							entry.nativeSessionId = match[1];
						}
					} else if (record.profile.harness === "antigravity") {
						const match = stdoutBuffer.match(/"conversationId"\s*:\s*"([^"]+)"/);
						if (match) {
							entry.nativeSessionId = match[1];
						}
					}
				}
				entry.lastActiveAt = record.completedAt || new Date().toISOString();
				entry.turnCount += 1;
				if (!entry.runs.includes(record.runId)) {
					entry.runs.push(record.runId);
				}
				tree[key] = entry;
				saveSessionTree(tree);
			} catch {
				// best effort
			}
		}
	}

	private buildResult(
		record: RunRecord,
		stdout: string,
		stderr: string,
		verbose = false,
	): DelegateResult {
		const start = new Date(record.startedAt).getTime();
		const end = record.completedAt ? new Date(record.completedAt).getTime() : Date.now();
		const cleanSummary = record.resultSummary || extractCleanSummary(stdout, record.profile.harness);
		const interrupted = record.status === "timeout" || record.status === "failed";
		const isPartial = interrupted && Boolean(cleanSummary);

		let summaryText = cleanSummary || record.error || `Worker status: ${record.status}`;
		if (interrupted && record.error && cleanSummary) {
			summaryText = `[${record.status.toUpperCase()}: ${record.error}]\n\n${cleanSummary}`;
		}

		const res: DelegateResult = {
			runId: record.runId,
			sessionId: record.sessionId,
			parentSessionId: record.parentSessionId,
			isResumed: record.isResumed,
			profile: record.request.profile,
			harness: record.profile.harness,
			model: record.profile.model,
			status: record.status,
			exitCode: record.exitCode,
			summary: summaryText,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
			durationMs: end - start,
			logPath: record.logPath,
			error: record.error,
			partial: isPartial,
			resumeHint: interrupted ? record.sessionId : undefined,
			lastActivityAt: record.lastActivityAt,
			bytesEmitted: record.bytesEmitted,
		};
		if (verbose) {
			res.stdout = stdout.trim();
			res.stderr = stderr.trim();
		}
		return res;
	}
}
