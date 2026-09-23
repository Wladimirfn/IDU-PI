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
	mkdirSync,
	createWriteStream,
	readdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
	RunnerSpec,
	SessionTreeEntry,
} from "./types.js";

const SESSION_TREE_PATH = join(IDU_SESSIONS_DIR, "tree.json");

export function writeJsonAtomic(filePath: string, data: any): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const tmpPath = `${filePath}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");

	let retries = 5;
	while (retries > 0) {
		try {
			renameSync(tmpPath, filePath);
			return;
		} catch (err: any) {
			retries--;
			if (retries === 0) {
				try {
					writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
					try {
						unlinkSync(tmpPath);
					} catch {}
					return;
				} catch {
					throw err;
				}
			}
			const start = Date.now();
			while (Date.now() - start < 15) {}
		}
	}
}

export function isProcessAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: any) {
		if (err.code === "EPERM") return true;
		if (err.code === "ESRCH") return false;
		return false;
	}
}

export function getRunnerScriptPath(): string {
	const jsPath = fileURLToPath(new URL("./runner.js", import.meta.url));
	if (existsSync(jsPath)) return jsPath;
	const distJsPath = resolve(process.cwd(), "dist/src/runner.js");
	if (existsSync(distJsPath)) return distJsPath;
	return jsPath;
}

export function killProcessTree(child: ChildProcess | number, reason = "termination"): void {
	const pid = typeof child === "number" ? child : child.pid;
	if (!pid) return;

	if (process.platform === "win32") {
		// Reliable process tree termination on Windows (cmd.exe wrapper + child processes)
		try {
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
		} catch {
			if (typeof child !== "number") {
				try {
					child.kill("SIGKILL");
				} catch {
					// best effort
				}
			}
		}
		return;
	}

	// POSIX: process group kill with escalation
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort
		}
	}

	const escalationTimer = setTimeout(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// best effort
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
	writeJsonAtomic(SESSION_TREE_PATH, tree);
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

	// Try parsing NDJSON lines (OpenCode / Claude stream-json / Command Code json)
	const lines = trimmed.split("\n");
	const assistantTexts: string[] = [];
	let definitiveResult = "";
	let cmdcStreamedText = "";
	const normalizedHarness = harness.toLowerCase();
	const isCmdc = normalizedHarness === "commandcode" || normalizedHarness === "cmdc";

	for (const line of lines) {
		const l = line.trim();
		if (!l.startsWith("{") || !l.endsWith("}")) continue;
		try {
			const parsed = JSON.parse(l);

			// Claude final result event has the highest priority
			if (parsed.type === "result" && typeof parsed.result === "string" && parsed.result.trim()) {
				definitiveResult = parsed.result.trim();
			}

			// Command Code (cmdc) final result event
			if (parsed.type === "result") {
				if (typeof parsed.finalText === "string" && parsed.finalText.trim()) {
					definitiveResult = parsed.finalText.trim();
				} else if (parsed.error && typeof parsed.error.message === "string" && parsed.error.message.trim()) {
					definitiveResult = `Command Code error: ${parsed.error.message.trim()}`;
				}
			}

			// Command Code (cmdc) event stream (run_end or text_delta)
			if (parsed.type === "event" && parsed.event) {
				if (parsed.event.type === "run_end" && typeof parsed.event.result?.finalText === "string" && parsed.event.result.finalText.trim()) {
					definitiveResult = parsed.event.result.finalText.trim();
				} else if (parsed.event.type === "text_delta" && typeof parsed.event.delta === "string") {
					cmdcStreamedText += parsed.event.delta;
				}
			}

			// Antigravity (agy) result events (stream-json or json)
			if (parsed.event === "result" && typeof parsed.result?.response === "string" && parsed.result.response.trim()) {
				definitiveResult = parsed.result.response.trim();
			} else if (typeof parsed.response === "string" && parsed.response.trim()) {
				definitiveResult = parsed.response.trim();
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

	if (cmdcStreamedText.trim()) {
		assistantTexts.push(cmdcStreamedText.trim());
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

	// If the harness is cmdc/commandcode, or output is an unparsed NDJSON stream, never leak raw NDJSON
	if (isCmdc || (cleaned.startsWith("{") && cleaned.endsWith("}") && cleaned.includes("\n{"))) {
		return "";
	}

	return cleaned;
}

export interface SddGuardCheckResult {
	blocked: boolean;
	reason?: string;
	change?: string;
	workUnit?: string;
}

export function checkActiveSddAttempt(workingDir: string, taskPrompt?: string): SddGuardCheckResult {
	// 1. Explicit task prompt heuristics for SDD implementation / Work Units
	if (taskPrompt) {
		const sddPattern = /\b(?:sdd-attempt acquire|sdd-apply|Work Unit:\s*["']?([^"'\n]+)["']?|WU\d+|implement(?:ing)?\s+(?:WU\d+|work unit))\b/i;
		const match = taskPrompt.match(sddPattern);
		if (match) {
			return {
				blocked: true,
				reason: `Task explicitly targets SDD implementation / Work Unit ("${match[0]}").`,
				workUnit: match[1] || match[0],
			};
		}
	}

	// 2. Active SDD attempt on disk via openspec/changes
	const openspecChangesDir = join(workingDir, "openspec", "changes");
	if (!existsSync(openspecChangesDir)) {
		return { blocked: false };
	}

	try {
		const entries = readdirSync(openspecChangesDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);

		let candidateChanges = entries;
		if (taskPrompt) {
			const mentioned = entries.filter((c) => taskPrompt.includes(c));
			if (mentioned.length > 0) {
				candidateChanges = mentioned;
			}
		}

		for (const change of candidateChanges) {
			try {
				const stdout = execFileSync("gentle-ai", ["sdd-attempt", "status", "--cwd", workingDir, "--change", change], {
					encoding: "utf8",
					timeout: 2000,
					stdio: ["ignore", "pipe", "ignore"],
				});
				const status = JSON.parse(stdout);
				if (status.active_attempt && status.active_attempt.outcome === "running") {
					return {
						blocked: true,
						change,
						workUnit: status.active_attempt.work_unit || `ordinal ${status.active_attempt.ordinal}`,
						reason: `Active SDD attempt is currently running for change "${change}" (Work Unit: "${status.active_attempt.work_unit || status.active_attempt.ordinal}").`,
					};
				}
			} catch {
				// gentle-ai not installed or call failed, continue
			}
		}
	} catch {
		// best effort
	}

	return { blocked: false };
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

		// 3. SDD WORK UNIT IMPLEMENTATION GUARD: Enforce local implementation ownership
		const workingDir = request.workingDir || process.cwd();
		if (profile.permissions === "workspace") {
			const sddCheck = checkActiveSddAttempt(workingDir, request.task);
			if (sddCheck.blocked) {
				throw new Error(
					`SDD WORK UNIT IMPLEMENTATION VIOLATION: ${sddCheck.reason} Delegating workspace mutation (profile: "${request.profile}") to an external CLI worker is blocked. Primary implementation must be performed locally by the active orchestrator or local SDD phase subagents (sdd-apply). Use read-only/advisory profiles (e.g. "architecture") for external review.`,
				);
			}
		}

		// 4. Resolve session continuity and hierarchy (The Universal Triad: id / resume / fork)
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
		const runnerPidPath = join(IDU_RUNTIME_DIR, `${runId}.runner.pid`);
		const specPath = join(IDU_RUNTIME_DIR, `${runId}.spec.json`);

		const record: RunRecord = {
			runId,
			sessionId: effectiveSessionId,
			parentSessionId,
			isResumed,
			request,
			profile,
			command,
			args,
			status: "running",
			exitCode: null,
			startedAt,
			logPath,
		};

		// 6. Acquire session concurrency lock (prevent race conditions on the same session in workingDir)
		const sessionLock = acquireSessionLock(effectiveSessionId, workingDir, process.pid);

		// 7. Setup environment overrides with ONE ORCHESTRATOR RULE markers
		const runnerEnv: Record<string, string> = {
			IDU_WORKER: "true",
			IDU_PARENT: request.parentOrchestrator || "idu-router",
			IDU_ALLOW_DELEGATION: "false",
			IDU_RUN_ID: runId,
			IDU_PROFILE: request.profile,
			IDU_SESSION_ID: effectiveSessionId,
		};

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

		// 8. Build runner spec
		const spec: RunnerSpec = {
			runId,
			sessionId: effectiveSessionId,
			parentSessionId,
			harness: profile.harness,
			command,
			args,
			workingDir,
			env: runnerEnv,
			logPath,
			sessionPath,
			pidPath,
			runnerPidPath,
			specPath,
			lockPath: sessionLock.lockPath,
			startedAt,
			timeoutMs: effectiveTimeoutMs,
			idleTimeoutMs: effectiveIdleTimeoutMs,
			hardCapMs: effectiveHardCapMs,
			startupGraceMs,
			streams: profile.streams,
			verbose: request.verbose,
			shell: isShell,
		};

		ensureIduDirectories();
		writeJsonAtomic(specPath, spec);
		writeJsonAtomic(sessionPath, record);

		// 9. Spawn detached runner daemon
		const runnerScript = getRunnerScriptPath();
		let runnerProcess: ChildProcess;
		try {
			runnerProcess = spawn(process.execPath, [runnerScript, "--spec", specPath], {
				cwd: workingDir,
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			runnerProcess.unref();
		} catch (spawnErr: any) {
			sessionLock.release();
			record.status = "failed";
			record.error = spawnErr.message;
			record.completedAt = new Date().toISOString();
			writeJsonAtomic(sessionPath, record);
			throw spawnErr;
		}

		record.runnerPid = runnerProcess.pid;
		writeJsonAtomic(sessionPath, record);
		if (runnerProcess.pid) {
			sessionLock.updatePid?.(runnerProcess.pid);
		}

		if (asyncExecution) {
			const instructionMsg = `Worker process is RUNNING in background daemon (runId: ${runId}). DO NOT end your turn saying you will check back later. Execute this command now in your terminal tool to stay blocked without token bloat until completion:\nnode dist/src/cli.js wait ${runId} --timeout 540000\nIf the command exits with code 124 (timeout) and the worker is still healthy, re-invoke it to continue waiting. DO NOT use --follow (it dumps raw logs and bloats prompt tokens).`;
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
				summary: `Worker started in background daemon with runner PID ${runnerProcess.pid || "unknown"}. Wait silently using:\n  node dist/src/cli.js wait ${runId} --timeout 540000`,
				startedAt,
				logPath,
				instruction: instructionMsg,
			};
		}

		const waitTimeout = (effectiveHardCapMs > 0 ? effectiveHardCapMs : effectiveTimeoutMs) || 900_000;
		const result = await this.waitForCompletion(runId, waitTimeout, request.verbose);
		return result || this.buildResult(record, "", "", Boolean(request.verbose));
	}

	public getStatus(runId: string): RunRecord | null {
		const sessionPath = join(IDU_SESSIONS_DIR, `${runId}.json`);
		if (!existsSync(sessionPath)) return null;

		let record: RunRecord | null = null;
		try {
			record = JSON.parse(readFileSync(sessionPath, "utf8")) as RunRecord;
		} catch {
			return null;
		}

		if (record && (record.status === "running" || record.status === "pending")) {
			const runnerAlive = record.runnerPid ? isProcessAlive(record.runnerPid) : false;
			const workerAlive = record.pid ? isProcessAlive(record.pid) : false;

			if ((record.runnerPid || record.pid) && !runnerAlive && !workerAlive) {
				let recoveredCode: number | null = null;
				let logText = "";
				if (existsSync(record.logPath)) {
					try {
						logText = readFileSync(record.logPath, "utf8");
						const match = logText.match(/=== PROCESS CLOSED WITH CODE (\d+|null) ===/);
						if (match) {
							recoveredCode = match[1] === "null" ? 1 : parseInt(match[1], 10);
						}
					} catch {
						// best effort
					}
				}

				if (recoveredCode !== null) {
					record.exitCode = recoveredCode;
					record.status = recoveredCode === 0 ? "completed" : "failed";
					const clean = extractCleanSummary(logText, record.profile?.harness || "");
					record.resultSummary = clean || `Process exited with code ${recoveredCode}`;
				} else {
					record.status = "failed";
					record.error = record.error || "Worker process terminated unexpectedly";
				}
				record.completedAt = record.completedAt || new Date().toISOString();
				writeJsonAtomic(sessionPath, record);
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
