import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
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
import { checkSessionHarnessAffinity, resolveHardCapMs, resolveSessionProfile, shouldCountTurn } from "./session-policy.js";
import { aliasToUuid, findOwnerSessionEntry, getSessionKey, isUuid } from "./session-ids.js";
import { extractCleanSummary } from "./summary.js";
import { buildWorkerArgs, checkCliAvailable, unwrapCmdExecutable } from "./cmdline.js";
import { extractUsage } from "./usage.js";
import { readQuotaSnapshots } from "./quota.js";
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
const SESSION_TREE_LOG_PATH = join(IDU_SESSIONS_DIR, "tree.jsonl");

// Imported for local use and re-exported so the existing import path keeps
// working. The implementation moved out to break a cycle with the quota layer.
import { writeJsonAtomic } from "./json-file.js";
export { writeJsonAtomic } from "./json-file.js";

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

/**
 * The session tree is a log of upserts, not a document.
 *
 * It used to be one JSON object rewritten in full by every finished run. Two
 * runs finishing at the same time (which `idu_delegate_parallel` produces on
 * purpose) read the same tree, both wrote, and one session vanished. And a
 * reader that caught the file mid-rewrite got unparseable JSON, was handed an
 * empty object, and then wrote that object back over everything.
 *
 * An append has neither failure. Every run appends one line; a line that does
 * not parse costs one run's record, never the file.
 */
export function loadSessionTree(): Record<string, SessionTreeEntry> {
	ensureIduDirectories();
	migrateSessionTreeJson();

	if (!existsSync(SESSION_TREE_LOG_PATH)) return {};
	const out: Record<string, SessionTreeEntry> = {};
	let raw: string;
	try {
		raw = readFileSync(SESSION_TREE_LOG_PATH, "utf8");
	} catch {
		return {};
	}
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const record = JSON.parse(trimmed) as { key?: unknown; entry?: unknown };
			if (typeof record?.key !== "string" || !record.entry || typeof record.entry !== "object") continue;
			out[record.key] = record.entry as SessionTreeEntry;
		} catch {
			/* one torn line costs one run's record, not the tree */
		}
	}
	return out;
}

/**
 * Records one session entry by appending it. The caller must not load, mutate
 * and save: that shape is what loses entries when two writers overlap, and
 * verifying after the write does not help because the loser already returned.
 */
export function upsertSessionTreeEntry(key: string, entry: SessionTreeEntry): void {
	ensureIduDirectories();
	migrateSessionTreeJson();
	appendFileSync(SESSION_TREE_LOG_PATH, `${JSON.stringify({ key, entry })}\n`, "utf8");
}

/**
 * Brings a `tree.json` written by the previous format over, once. The old file
 * is renamed rather than deleted, and an unreadable one is left untouched.
 */
function migrateSessionTreeJson(): void {
	if (!existsSync(SESSION_TREE_PATH)) return;
	if (existsSync(SESSION_TREE_LOG_PATH) && readFileSyncSafe(SESSION_TREE_LOG_PATH) !== "") return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(SESSION_TREE_PATH, "utf8"));
	} catch {
		// Torn legacy file. Leaving it in place keeps it recoverable by hand;
		// writing an empty log over it would destroy it.
		return;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

	const payload = Object.entries(parsed as Record<string, SessionTreeEntry>)
		.map(([key, entry]) => `${JSON.stringify({ key, entry })}\n`)
		.join("");
	if (payload) appendFileSync(SESSION_TREE_LOG_PATH, payload, "utf8");
	try {
		renameSync(SESSION_TREE_PATH, `${SESSION_TREE_PATH}.migrated-${randomUUID().slice(0, 8)}`);
	} catch {
		/* migration already succeeded; leaving the old file is the safe outcome */
	}
}

function readFileSyncSafe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export interface SessionLockHandle {
	lockPath: string;
	token: string;
	updatePid?: (newPid: number) => void;
	release: () => void;
}

/**
 * Remove a stale session lock without racing another reclaimer.
 *
 * Deleting the file directly is check-then-act: two processes can both decide
 * the lock is stale, and the second deletes the fresh lock the first just
 * wrote. rename() is atomic on the same volume, so only one process can move
 * the file and the loser gets ENOENT instead of stealing.
 */
export function reclaimStaleLock(lockPath: string): boolean {
	const quarantine = `${lockPath}.stale-${process.pid}-${randomUUID().slice(0, 8)}`;
	try {
		renameSync(lockPath, quarantine);
	} catch {
		return false;
	}
	try {
		unlinkSync(quarantine);
	} catch {
		// best effort: a leftover quarantine file is inert
	}
	return true;
}

export function acquireSessionLock(sessionId: string, cwd: string, currentPid: number): SessionLockHandle {
	ensureIduDirectories();
	const cwdHash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 8);
	const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const lockPath = join(IDU_LOCKS_DIR, `sess_${cwdHash}_${safeName}.lock`);
	const ownerPids = new Set<number>([currentPid]);

	const lockToken = randomUUID();
	const lockBody = (pid: number): string =>
		JSON.stringify({ pid, cwd: resolve(cwd), time: new Date().toISOString(), token: lockToken });

	const writeLockFile = (): boolean => {
		try {
			const fd = openSync(lockPath, "wx");
			writeFileSync(fd, lockBody(currentPid), "utf8");
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
			// Claim the corrupt lock atomically. A direct unlink lets two
			// processes both decide it is stale, and the later one deletes the
			// fresh lock the earlier one just wrote.
			if (!reclaimStaleLock(lockPath) || !writeLockFile()) {
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
					// Process is dead: claim the stale lock atomically, then retry.
					// The loser of the claim must not delete the winner's fresh lock.
					if (!reclaimStaleLock(lockPath) || !writeLockFile()) {
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
		token: lockToken,
		updatePid: (newPid: number) => {
			ownerPids.add(newPid);
			try {
				// Replace by rename instead of truncate-then-write: a concurrent
				// reader must never see a half-written lock and call it corrupt.
				const tmpPath = `${lockPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
				writeFileSync(tmpPath, lockBody(newPid), "utf8");
				renameSync(tmpPath, lockPath);
			} catch {
				// best effort
			}
		},
		release: () => {
			// Move the lock aside, then decide. Reading before deleting let a
			// reclaimer replace the file between the check and the unlink, so a
			// process could delete a lock it does not own.
			const quarantine = `${lockPath}.release-${process.pid}-${randomUUID().slice(0, 8)}`;
			try {
				renameSync(lockPath, quarantine);
			} catch {
				return; // nothing to release
			}
			let ours = false;
			try {
				const data = JSON.parse(readFileSync(quarantine, "utf8"));
				ours = data.token === lockToken || (typeof data.pid === "number" && ownerPids.has(data.pid));
			} catch {
				ours = false;
			}
			try {
				if (ours) unlinkSync(quarantine);
				else renameSync(quarantine, lockPath); // not ours: put it back untouched
			} catch {
				// best effort
			}
		},
	};
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

	public async getCapabilities(options: { includeQuota?: boolean; freshQuota?: boolean } = {}): Promise<CapabilitiesResult> {
		const config = loadIduConfig();
		const { profiles } = loadProfilesConfig();

		const installedClis = Object.entries(config.clis).map(([name, def]) => ({
			name,
			command: def.command,
			available: checkCliAvailable(def.command),
		}));

		const result: CapabilitiesResult = {
			installedClis,
			profiles,
			// Reported as always-on regardless of what ~/.idu/config.json holds.
			// Echoing the file here would let `idu status` print DISABLED while
			// delegation was still being refused, which is the kind of small lie
			// that turns into a real incident later.
			oneOrchestratorRule: {
				enabled: true,
				allowRecursiveDelegation: false,
				configurable: false,
			},
		};

		// Opt-in, and cached. Two of the quota sources run a model, so this is
		// never filled as a side effect of asking what the harness can do. Note
		// that "no probe" is not "no work": checkCliAvailable above shells out to
		// `where`/`which` for every configured CLI, which is a preexisting cost
		// of discovery and not part of the quota layer.
		if (options.includeQuota) {
			result.quota = await readQuotaSnapshots({ fresh: options.freshQuota === true });
		}

		return result;
	}

	public listSessions(): SessionTreeEntry[] {
		const tree = loadSessionTree();
		return Object.values(tree).sort(
			(a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
		);
	}

	public async delegate(request: DelegateRequest, asyncExecution = false): Promise<DelegateResult> {
		const config = loadIduConfig();

		// 1. ONE ORCHESTRATOR RULE: refuse to delegate from inside a worker.
		//
		// This is a CONVENTION ENFORCED AGAINST MISTAKES, not a security
		// boundary, and the earlier comment here called it "fail-closed", which
		// was simply false. IDU_WORKER is an environment variable the worker
		// itself owns. It can unset it, set it to "false", or never propagate it,
		// and the guard cannot tell the difference. Measured on 2026-10-01: a
		// delegated Pi worker that ran `$env:IDU_WORKER="false"` before calling
		// this CLI spawned a nested worker, no complaint. Editing
		// ~/.idu/config.json used to switch the rule off outright, which is why
		// neither key is read here any more.
		//
		// What it does buy, which is worth having: a worker that has no idea it
		// inherited the marker cannot walk into a loop by accident, and the
		// refusal lands in the run log where a post-mortem can find it.
		//
		// The MCP filter hides the same tools, but it is not a second defence:
		// isWorkerProcess() in mcp-server.ts is this same predicate, so a worker
		// that clears the variable gets the full catalogue and calls through.
		// Both surfaces rest on one cooperative identity contract. SECURITY.md
		// carries the measured numbers.
		//
		// Closing this against a worker that controls its own shell means taking
		// authority away from that worker (a supervisor process with
		// authenticated IPC, or a separate OS user), not a sharper predicate
		// here. See SECURITY.md for the full list of what the loop costs.
		if (process.env.IDU_WORKER === "true") {
			throw new Error(
				`ONE ORCHESTRATOR RULE VIOLATION: Current process is already an active worker (IDU_RUN_ID: ${process.env.IDU_RUN_ID}). Recursive sub-delegation is disallowed.`,
			);
		}

		// 2. Resolve the session owner BEFORE resolving the profile, so a
		// resume without an explicit --profile can inherit the session's own
		// profile instead of falling back to a global default that belongs to
		// a different harness.
		const workingDir = request.workingDir || process.cwd();
		const tree = loadSessionTree();

		// A Claude alias is persisted under its deterministic UUID, so looking up
		// the raw alias alone silently misses the session and drops profile
		// inheritance. Accept both spellings.
		const ownerEntry = findOwnerSessionEntry(tree, workingDir, request.sessionId);

		let profileName = request.profile;
		const resolution = resolveSessionProfile(request.profile, ownerEntry, {
			profileExplicit: request.profileExplicit,
			fork: request.fork,
		});
		profileName = resolution.profileName;

		// 3. Validate profile
		const profile = getProfile(profileName);
		if (!profile) {
			throw new Error(
				`Profile "${profileName}" not found in ~/.idu/profiles.json. Available profiles: ${Object.keys(loadProfilesConfig().profiles).join(", ")}`,
			);
		}
		if (resolution.inherited) {
			console.error(
				`[info] resuming session "${request.sessionId}" without --profile: inheriting its profile "${profileName}" (harness "${profile.harness}") over the default "${request.profile}".`,
			);
		}

		// 4. SDD WORK UNIT IMPLEMENTATION GUARD: Enforce local implementation ownership
		if (profile.permissions === "workspace") {
			const sddCheck = checkActiveSddAttempt(workingDir, request.task);
			if (sddCheck.blocked) {
				throw new Error(
					`SDD WORK UNIT IMPLEMENTATION VIOLATION: ${sddCheck.reason} Delegating workspace mutation (profile: "${request.profile}") to an external CLI worker is blocked. Primary implementation must be performed locally by the active orchestrator or local SDD phase subagents (sdd-apply). Use read-only/advisory profiles (e.g. "architecture") for external review.`,
				);
			}
		}

		// 5. Resolve session continuity and hierarchy (The Universal Triad: id / resume / fork)

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

		// 6. Resolve native CLI session IDs if present (e.g. OpenCode ses_... IDs)
		const sessionKey = requestedSessionId ? getSessionKey(workingDir, requestedSessionId) : "";
		const existingEntry = sessionKey ? tree[sessionKey] : undefined;
		const nativeSessionId = existingEntry?.nativeSessionId;

		// 6b. Session affinity guard (Option A).
		// A session is owned by the harness that created it. Resuming it
		// under a different harness silently drops the native session id and
		// inflates the turn count, which is how a run against the wrong CLI
		// ends up reported as a real conversational turn. Refused BEFORE
		// spawn, so nothing is billed and no state is written.
		const affinityError = checkSessionHarnessAffinity(
			existingEntry,
			requestedSessionId ?? "",
			{ harness: profile.harness, profileName },
			request.force,
		);
		if (affinityError) {
			throw new Error(affinityError);
		}
		if (
			existingEntry?.harness &&
			profile.harness &&
			existingEntry.harness !== profile.harness &&
			request.force
		) {
			console.error(
				`[warn] --force: resuming session "${requestedSessionId}" (harness "${existingEntry.harness}") under a different harness "${profile.harness}". Native session continuity is lost.`,
			);
		}

		let parentNativeSessionId: string | undefined;
		if (parentSessionId) {
			const parentKey = getSessionKey(workingDir, parentSessionId);
			parentNativeSessionId = tree[parentKey]?.nativeSessionId;
		}

		// 7. Build command line with session flags
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
		const { command, args } = unwrapCmdExecutable(rawCommand, rawArgs);

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

		// 8. Acquire session concurrency lock (prevent race conditions on the same session in workingDir)
		const sessionLock = acquireSessionLock(effectiveSessionId, workingDir, process.pid);

		// 9. Setup environment overrides with ONE ORCHESTRATOR RULE markers
		const runnerEnv: Record<string, string> = {
			IDU_WORKER: "true",
			IDU_PARENT: request.parentOrchestrator || "idu-router",
			IDU_ALLOW_DELEGATION: "false",
			IDU_RUN_ID: runId,
			IDU_PROFILE: profileName,
			IDU_SESSION_ID: effectiveSessionId,
		};

		const effectiveTimeoutMs = request.timeoutMs ?? profile.timeoutMs ?? config.defaultTimeoutMs;
		const effectiveIdleTimeoutMs = profile.idleTimeoutMs ?? (profile.streams ? 300_000 : 0);
		// Shared with getStatus on purpose: the reader and the runner must agree
		// on what the cap is, or reading a run can end it.
		const effectiveHardCapMs = resolveHardCapMs({
			requestTimeoutMs: request.timeoutMs,
			profileHardCapMs: profile.hardCapMs,
			profileTimeoutMs: effectiveTimeoutMs,
		});
		const startupGraceMs = profile.startupGraceMs ?? Math.max(effectiveIdleTimeoutMs, 120_000);

		// 10. Build runner spec
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
			lockToken: sessionLock.token,
			startedAt,
			timeoutMs: effectiveTimeoutMs,
			idleTimeoutMs: effectiveIdleTimeoutMs,
			hardCapMs: effectiveHardCapMs,
			startupGraceMs,
			streams: profile.streams,
			verbose: request.verbose,
		};

		ensureIduDirectories();
		writeJsonAtomic(specPath, spec);
		writeJsonAtomic(sessionPath, record);

		// 11. Spawn detached runner daemon
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
			const instructionMsg = `Worker process is RUNNING in background daemon (runId: ${runId}). DO NOT end your turn saying you will check back later. Execute this command now in your terminal tool to stay blocked without token bloat until completion:\nidu-pi wait ${runId} --timeout 540000\nIf the command exits with code 124 (timeout) and the worker is still healthy, re-invoke it to continue waiting. DO NOT use --follow (it dumps raw logs and bloats prompt tokens).`;
			return {
				runId,
				sessionId: effectiveSessionId,
				parentSessionId,
				isResumed,
				profile: profileName,
				harness: profile.harness,
				model: profile.model,
				status: "running",
				exitCode: null,
				summary: `Worker started in background daemon with runner PID ${runnerProcess.pid || "unknown"}. Wait silently using:\n  idu-pi wait ${runId} --timeout 540000`,
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

		// One clock reading and one cap for the whole function. Sampling `now`
		// twice could let the recovery gate and the health block disagree across
		// a cap boundary, producing a record that says `running` and
		// `interrupted` at the same time.
		const observedAt = Date.now();
		const startTime = record ? new Date(record.startedAt).getTime() : NaN;
		const capMs = record
			? resolveHardCapMs({
					requestTimeoutMs: record.request?.timeoutMs,
					profileHardCapMs: record.profile?.hardCapMs,
					profileTimeoutMs: record.profile?.timeoutMs,
				})
			: 0;
		// isFinite matters: a corrupt or future startedAt yields a negative
		// elapsed time, and that must never read as "past the cap".
		const pastCap = capMs > 0 && Number.isFinite(startTime) && observedAt - startTime > capMs;

		if (record && (record.status === "running" || record.status === "pending")) {
			const runnerAlive = record.runnerPid ? isProcessAlive(record.runnerPid) : false;
			const workerAlive = record.pid ? isProcessAlive(record.pid) : false;
			const anyPidRecorded = Boolean(record.runnerPid || record.pid);
			// A run that never recorded a pid produced no evidence of death, and the
			// old gate demanded a pid before it would look at anything, so such a
			// record stayed `running` forever. Measured: one from 63 hours earlier,
			// with no pid and no log left, still claimed to be running. The clock is
			// the only signal available for that case, exactly as it is for health.

			// One rule, matching the one health already uses. Past the cap the clock
			// decides on its own: the runner enforces that cap, so a run beyond it
			// cannot still be working, and pids that survive are somebody else
			// entirely. Inside the cap, every recorded pid gone is positive
			// evidence of death. A run with no pid at all inside the cap is the one
			// case left open, and it is left open on purpose: absence of evidence
			// is not evidence of death.
			const unreconcilable = pastCap || (anyPidRecorded && !runnerAlive && !workerAlive);
			if (unreconcilable) {
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
					// Persist usage here too, not only in buildResult. This is the
					// recovery path for a worker that died before the normal
					// completion handler ran, and without it the numbers would
					// only exist for runs that finished cleanly.
					const recoveredUsage = extractUsage(logText, record.profile?.harness || "");
					if (recoveredUsage.captured) record.usage = recoveredUsage;
				} else {
					record.status = "failed";
					// Say which of the two cases this was. "Unexpectedly" is honest for a
					// worker whose processes vanished, and vague for a record that never
					// had a pid to lose; conflating them is the same kind of imprecision
					// this recovery path exists to remove.
					record.error = record.error
						|| (pastCap
							? "Run is past its hard cap and left no exit marker behind"
							: "Worker process terminated unexpectedly");
				}
				record.completedAt = record.completedAt || new Date().toISOString();
				writeJsonAtomic(sessionPath, record);
			}
		}

		if (record) {
			const now = observedAt;
			record.elapsedMs = (record.completedAt ? new Date(record.completedAt).getTime() : now) - startTime;
			if (record.lastActivityAt) {
				record.secondsSinceLastActivity = Math.round((now - new Date(record.lastActivityAt).getTime()) / 1000);
			}
			if (record.status === "running") {
				// Two independent signals, because neither one alone is sound.
				//
				// Log silence is not death. `lastActivityAt` only advances when
				// the log grows, and a worker streaming a reasoning model can emit
				// nothing for many minutes while it genuinely works. That is why
				// `idle_warning` was removed as a verdict instead of kept.
				//
				// Process liveness is not identity either, which is the harder
				// lesson. Windows recycles pids aggressively and low numbers land
				// on long-lived system processes. Measured on 2026-10-02: a run
				// from 159 hours earlier reported running and healthy because its
				// recorded pids 1200 and 4780 were by then csrss and svchost. A
				// live pid is evidence that *something* holds that number, not
				// that the worker we started still does.
				//
				// The clock is what holds. A worker cannot outrun the cap its own
				// profile sets, and that check needs no pid at all, so it decides
				// alone once the cap is passed. Pids are consulted only while the
				// run is still inside its cap, where a match means something.
				let alive = false;
				if (!pastCap) {
					alive =
						(record.runnerPid ? isProcessAlive(record.runnerPid) : false) ||
						(record.pid ? isProcessAlive(record.pid) : false);
				}
				// Past the cap nothing but the clock is trusted. Inside the cap a
				// recorded pid set that is entirely gone is positive evidence of
				// death, while a record carrying no pid at all is missing evidence,
				// not a dead worker, and keeps whatever its author claimed.
				const anyPidRecorded = Boolean(record.runnerPid || record.pid);
				const dead = pastCap || (anyPidRecorded && !alive);
				record.health = dead ? "interrupted" : "healthy";
			} else if (record.status === "completed") {
				record.health = "completed";
			} else if (record.status === "pending") {
				// A run that has not started yet is neither finished nor broken, and
				// falling through to `interrupted` is how a queued worker got
				// reported as a dead one. Found by adversarial review.
				record.health = "pending";
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

		// Token usage, normalised across harness conventions. This is what the
		// harness reported, not an estimate: a field it never emits stays null.
		const usage = extractUsage(stdout, record.profile.harness);

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
		if (usage.captured) res.usage = usage;
		if (verbose) {
			res.stdout = stdout.trim();
			res.stderr = stderr.trim();
		}
		return res;
	}

	/**
	 * What the delegations actually consumed, read back from the persisted
	 * records.
	 *
	 * `perHarness` keeps the totals separate on purpose: a subscription plan
	 * and a metered API bill are different currencies and must never be added
	 * into one number. A harness that reported nothing shows `tokens: null`,
	 * not zero, so "free" and "unreported" stay distinguishable.
	 */
	public summarizeUsage(limit = 50): {
		runs: number;
		byHarness: Record<
			string,
			{ runs: number; inputTokens: number; outputTokens: number; reasoningTokens: number; unreported: number }
		>;
	} {
		const byHarness: Record<
			string,
			{ runs: number; inputTokens: number; outputTokens: number; reasoningTokens: number; unreported: number }
		> = {};

		const records = this.listSessions()
			.flatMap((entry) => entry.runs)
			.slice(0, limit)
			.map((runId) => this.getStatus(runId))
			.filter((r): r is RunRecord => Boolean(r));

		for (const record of records) {
			const harness = record.profile?.harness || "unknown";
			const bucket = (byHarness[harness] ??= {
				runs: 0,
				inputTokens: 0,
				outputTokens: 0,
				reasoningTokens: 0,
				unreported: 0,
			});
			bucket.runs += 1;
			const u = record.usage;
			if (!u?.captured) {
				bucket.unreported += 1;
				continue;
			}
			bucket.inputTokens += u.tokens.inputTokens ?? 0;
			bucket.outputTokens += u.tokens.outputTokens ?? 0;
			bucket.reasoningTokens += u.tokens.reasoningTokens ?? 0;
		}

		return { runs: records.length, byHarness };
	}
}
