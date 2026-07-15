import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { chmod as fsChmod, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { hostname, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LockDiagnostics = {
	lockPath: string;
	holderPid?: number;
	holderHost?: string;
	holderStartedAt?: string;
	holderState?:
		| "verified-dead"
		| "alive"
		| "permission-denied"
		| "remote-host"
		| "malformed"
		| "unknown";
	observedError?: string;
};

export type FileLockAcquireResult =
	| { ok: true; lockPath: string; token: string }
	| { ok: false; code: "LOCK_TIMEOUT"; diagnostics: LockDiagnostics }
	| { ok: false; code: "LOCK_IO_ERROR"; diagnostics: LockDiagnostics };

export type FileLockHandle = { lockPath: string; token: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOCK_TIMEOUT_DEFAULT_MS = 2000;
export const LOCK_TIMEOUT_MIN_MS = 100;
export const LOCK_TIMEOUT_MAX_MS = 10_000;

const DEFAULT_POLL_MS = 25;

// Strict integer-string regex. Rejects values like "2.5", "2e3", "2000ms",
// "0x1", "+1500", and "abc" that Number() + Number.isInteger() would wrongly
// accept (e.g. Number("2e3") === 2000). Only an optional leading minus
// followed by base-10 digits passes.
const LOCK_TIMEOUT_INT_RE = /^-?\d+$/u;

/**
 * Resolve the bounded lock-acquire timeout from `IDU_LOCK_TIMEOUT_MS`
 * (spec #3098 rev4, design #3099 rev3).
 *
 * - Missing / non-integer-string / unparseable → LOCK_TIMEOUT_DEFAULT_MS.
 * - Valid integer below LOCK_TIMEOUT_MIN_MS → clamped up.
 * - Valid integer above LOCK_TIMEOUT_MAX_MS → clamped down.
 * - Valid integer inside [MIN, MAX] → passed through unchanged.
 *
 * `IDU_LOCK_TIMEOUT_MS` is the ONLY configuration source. No CLI flag, config
 * file, MCP argument, or function argument overrides the env-derived value.
 */
export function resolveLockTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const raw = env.IDU_LOCK_TIMEOUT_MS;
	if (typeof raw !== "string" || !LOCK_TIMEOUT_INT_RE.test(raw)) {
		return LOCK_TIMEOUT_DEFAULT_MS;
	}
	const parsed = Number(raw);
	if (parsed < LOCK_TIMEOUT_MIN_MS) return LOCK_TIMEOUT_MIN_MS;
	if (parsed > LOCK_TIMEOUT_MAX_MS) return LOCK_TIMEOUT_MAX_MS;
	return parsed;
}

// ---------------------------------------------------------------------------
// No-reclaim invariant (owner safety decision — spec #3098 rev3, design #3099 rev2)
// ---------------------------------------------------------------------------
//
// This helper NEVER renames, unlinks, force-deletes, recreates, or otherwise
// takes over an existing lockfile — not for verified-dead local PIDs, not for
// age, not for malformed content, not ever.  A paused-but-alive holder could
// resume after any automatic reclamation and write concurrently, which is the
// exact lost-update this change exists to prevent.  Every existing lockfile
// yields a bounded LOCK_TIMEOUT (or LOCK_IO_ERROR for genuine filesystem
// failure) with diagnostic metadata safe for operator triage.  Stale lockfile
// cleanup is explicit and out of band (operator or maintenance command).
//
// The diagnostic pid probe (`process.kill(pid, 0)`) classifies the holder
// state for operator information ONLY — its result NEVER enters any control-
// flow conditional that could trigger reclamation.
//
// The bounded acquire timeout is resolved by `resolveLockTimeoutMs()` from
// the IDU_LOCK_TIMEOUT_MS env variable ONLY (spec #3098 rev4). No CLI flag,
// config file, MCP argument, or function argument overrides it. See the
// resolver JSDoc for the strict-integer-regex + clamp rationale.
//
// ---------------------------------------------------------------------------

/**
 * Acquire an exclusive cross-process lock on `targetPath` by atomically
 * creating `${targetPath}.lock` via O_EXCL (`open(..., "wx")`).
 *
 * The lockfile stores `{ pid, startedAt, token, host }`.
 *
 * - Free path → creates lockfile, returns `{ ok: true, lockPath, token }`.
 * - Existing lockfile (ANY reason) → polls until `timeoutMs`, then returns
 *   `{ ok: false, code: "LOCK_TIMEOUT", diagnostics }`.  The lockfile is
 *   NEVER touched.
 * - Genuine filesystem error → returns
 *   `{ ok: false, code: "LOCK_IO_ERROR", diagnostics }` immediately.
 */
export async function acquireExclusiveFileLock(
	targetPath: string,
	options?: { timeoutMs?: number; pollMs?: number },
): Promise<FileLockAcquireResult> {
	const timeoutMs = options?.timeoutMs ?? resolveLockTimeoutMs();
	const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
	const lockPath = `${targetPath}.lock`;

	// Ensure the parent directory of the lockfile exists.
	try {
		mkdirSync(dirname(lockPath), { recursive: true });
	} catch {
		// If dir creation fails, openSync below will surface LOCK_IO_ERROR.
	}

	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const token = randomUUID();
		const content = JSON.stringify({
			pid: process.pid,
			startedAt: new Date().toISOString(),
			token,
			host: hostname(),
		});

		// Maintenance kernel gate: held ONLY around the O_EXCL lock creation so
		// the CLI cleanup path cannot classify-then-delete a lock mid-acquire.
		// The writer (supervisor-response-history) is unaware of this gate.
		const remaining = Math.max(0, deadline - Date.now());
		const gate = await acquireMaintenanceLock(lockPath, remaining);
		if (!gate.ok) {
			if (gate.code === "MAINTENANCE_IO_ERROR") {
				return {
					ok: false,
					code: "LOCK_IO_ERROR",
					diagnostics: buildDiagnostics(
						lockPath,
						gate.diagnostics.lastError?.code,
					),
				};
			}
			// MAINTENANCE_BUSY — gate contended; check overall deadline.
			if (deadline - Date.now() <= 0) {
				return {
					ok: false,
					code: "LOCK_TIMEOUT",
					diagnostics: buildDiagnostics(lockPath, undefined),
				};
			}
			await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
			continue;
		}

		// Under gate: attempt O_EXCL creation of the normal .lock.
		const createResult = tryCreateExclusive(lockPath, content);
		await gate.handle.release();

		if (createResult.kind === "created") {
			return { ok: true, lockPath, token };
		}
		if (createResult.kind === "io_error") {
			return {
				ok: false,
				code: "LOCK_IO_ERROR",
				diagnostics: buildDiagnostics(lockPath, createResult.error),
			};
		}

		// createResult.kind === "exists" — poll until timeout.  NEVER reclaim.
		if (deadline - Date.now() <= 0) {
			return {
				ok: false,
				code: "LOCK_TIMEOUT",
				diagnostics: buildDiagnostics(lockPath, undefined),
			};
		}
		await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
	}
}

// ---------------------------------------------------------------------------
// releaseExclusiveFileLock
// ---------------------------------------------------------------------------

/**
 * Release a previously acquired lock.  The lockfile is deleted ONLY if the
 * on-disk `token` matches the supplied token (per-acquire ownership).
 *
 * - Missing lockfile → idempotent success (no throw).
 * - Token mismatch → no-op success (does NOT delete another holder's lock).
 * - Unparseable lockfile → no-op success (cannot verify ownership).
 *
 * Safety: the token is a per-acquire `crypto.randomUUID()` known only to the
 * acquiring caller.  Under the no-takeover model no other process can modify
 * the lockfile, so release can only delete the holder's own lock.
 */
export async function releaseExclusiveFileLock(
	handle: FileLockHandle,
): Promise<void> {
	const { lockPath, token } = handle;

	let raw: string;
	try {
		raw = readFileSync(lockPath, "utf8");
	} catch {
		return; // missing or unreadable — idempotent success
	}

	let meta: unknown;
	try {
		meta = JSON.parse(raw);
	} catch {
		return; // unparseable — don't delete what we can't verify
	}

	if (
		typeof meta === "object" &&
		meta !== null &&
		!Array.isArray(meta) &&
		"token" in meta &&
		(meta as Record<string, unknown>).token === token
	) {
		try {
			unlinkSync(lockPath);
		} catch {
			// best-effort
		}
	}
	// token mismatch or missing token field → no-op
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CreateResult =
	| { kind: "created" }
	| { kind: "exists" }
	| { kind: "io_error"; error: string };

/**
 * Attempt to create `lockPath` with O_EXCL and write `content`.
 */
function tryCreateExclusive(
	lockPath: string,
	content: string,
): CreateResult {
	let fd: number | null = null;
	let opened = false;
	try {
		fd = openSync(lockPath, "wx");
		opened = true;
		writeFileSync(fd, content, "utf8");
		return { kind: "created" };
	} catch (error: unknown) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") return { kind: "exists" };
		// We created the file but failed to write — clean up our partial file.
		if (opened) {
			try { closeSync(fd!); fd = null; } catch { /* ignore */ }
			try { unlinkSync(lockPath); } catch { /* leave for operator */ }
		}
		return { kind: "io_error", error: code ?? String(error) };
	} finally {
		if (fd !== null) {
			try { closeSync(fd); } catch { /* ignore */ }
		}
	}
}

/**
 * Build diagnostic metadata from the lockfile at `lockPath`.
 *
 * The pid probe (`process.kill(pid, 0)`) is DIAGNOSTIC ONLY — its result
 * classifies `holderState` for operator triage and NEVER enters any control-
 * flow conditional.  There is no reclaim path regardless of the result.
 */
function buildDiagnostics(
	lockPath: string,
	observedError: string | undefined,
): LockDiagnostics {
	const diagnostics: LockDiagnostics = { lockPath };
	if (observedError) {
		diagnostics.observedError = observedError;
	}

	let raw: string;
	try {
		raw = readFileSync(lockPath, "utf8");
	} catch {
		return diagnostics; // lockfile missing or unreadable
	}

	let meta: unknown;
	try {
		meta = JSON.parse(raw);
	} catch {
		diagnostics.holderState = "malformed";
		return diagnostics;
	}

	if (!isRecord(meta)) {
		diagnostics.holderState = "malformed";
		return diagnostics;
	}

	const { pid, host, startedAt } = meta;

	if (typeof startedAt === "string" && startedAt.length > 0) {
		diagnostics.holderStartedAt = startedAt;
	}
	if (typeof host === "string" && host.length > 0) {
		diagnostics.holderHost = host;
	}

	if (!isPositiveInteger(pid)) {
		diagnostics.holderState = "malformed";
		return diagnostics;
	}

	diagnostics.holderPid = pid;

	if (typeof host === "string" && host !== hostname()) {
		diagnostics.holderState = "remote-host";
		return diagnostics;
	}

	// Local pid — probe liveness for diagnostics ONLY (never triggers reclaim).
	try {
		process.kill(pid, 0);
		diagnostics.holderState = "alive";
	} catch (error: unknown) {
		const probeCode = (error as NodeJS.ErrnoException).code;
		if (probeCode === "ESRCH") {
			diagnostics.holderState = "verified-dead";
		} else if (probeCode === "EPERM") {
			diagnostics.holderState = "permission-denied";
		} else {
			diagnostics.holderState = "unknown";
		}
	}

	return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ---------------------------------------------------------------------------
// CLI-only safe lockfile cleanup primitives
// (spec #3098 rev4 "CLI-only safe lockfile cleanup surface", design #3099 rev3)
// ---------------------------------------------------------------------------
//
// These primitives power the explicit, human-invoked CLI cleanup surface.
// They are NEVER called from any automatic code path (acquire / persist /
// postflight). The pid probe here is the ONLY place a process.kill(pid, 0)
// result gates an action (deletion eligibility) — and only under an explicit
// destructive-confirmation flag. The automatic acquire path remains no-reclaim
// under every condition (see the invariant block above).

export type LockfileVerdict =
	| "eligible:verified-dead-local"
	| "refused:alive-local"
	| "refused:remote-host"
	| "refused:malformed"
	| "refused:pid-probe-error"
	| "refused:malformed-pid";

export type LockfileListing = {
	lockPath: string;
	holderPid?: number;
	holderHost?: string;
	holderStartedAt?: string;
	verdict: LockfileVerdict;
};

export type CleanupAction =
	| { lockPath: string; action: "deleted"; pid: number; startedAt?: string }
	| {
			lockPath: string;
			action: "refused";
			verdict: LockfileVerdict;
			reason: string;
	  };

export type CleanupResult = { actions: CleanupAction[]; exitCode: number };

/**
 * Classify a single lockfile into a deletion-eligibility verdict.
 *
 * Read-only: never deletes, renames, or modifies the lockfile.
 *
 * Verdict matrix (spec #3098 rev4):
 * - parseable JSON, current host, positive-integer pid, `process.kill(pid, 0)`
 *   → ESRCH  → `eligible:verified-dead-local`
 * - same but probe succeeds (alive or pid-recycled) → `refused:alive-local`
 * - host differs from current hostname → `refused:remote-host`
 * - non-JSON / not an object / missing required fields → `refused:malformed`
 * - pid missing / zero / negative / non-integer → `refused:malformed-pid`
 * - pid probe errors with anything other than ESRCH (e.g. EPERM)
 *   → `refused:pid-probe-error`
 */
export function classifyLockfile(lockPath: string): LockfileListing {
	const listing: LockfileListing = {
		lockPath,
		verdict: "refused:malformed",
	};

	let raw: string;
	try {
		raw = readFileSync(lockPath, "utf8");
	} catch {
		return { ...listing, verdict: "refused:malformed" };
	}

	let meta: unknown;
	try {
		meta = JSON.parse(raw);
	} catch {
		return { ...listing, verdict: "refused:malformed" };
	}

	if (!isRecord(meta)) {
		return { ...listing, verdict: "refused:malformed" };
	}

	const { pid, host, startedAt } = meta;

	if (typeof startedAt === "string" && startedAt.length > 0) {
		listing.holderStartedAt = startedAt;
	}
	if (typeof host === "string" && host.length > 0) {
		listing.holderHost = host;
	}

	if (!isPositiveInteger(pid)) {
		return { ...listing, verdict: "refused:malformed-pid" };
	}

	listing.holderPid = pid;

	// Eligibility requires host === current hostname. A missing host field
	// (tampered/corrupt lockfile) cannot satisfy "current host" → malformed.
	if (typeof host !== "string") {
		return { ...listing, verdict: "refused:malformed" };
	}
	if (host !== hostname()) {
		return { ...listing, verdict: "refused:remote-host" };
	}

	// Local pid — probe liveness. This is the ONLY place the pid probe gates
	// an action (deletion eligibility), per the explicit CLI cleanup surface.
	try {
		process.kill(pid, 0);
		return { ...listing, verdict: "refused:alive-local" };
	} catch (error: unknown) {
		const probeCode = (error as NodeJS.ErrnoException).code;
		if (probeCode === "ESRCH") {
			return { ...listing, verdict: "eligible:verified-dead-local" };
		}
		// EPERM or any other error → cannot verify dead → refuse.
		return { ...listing, verdict: "refused:pid-probe-error" };
	}
}

/**
 * Read-only listing of every `*.lock` file in `dir`, each with a
 * deletion-eligibility verdict. Never deletes, renames, or modifies any
 * lockfile. A missing directory yields an empty list (no throw).
 */
export function listLockfiles(dir: string): LockfileListing[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((name) => name.endsWith(".lock"))
		.map((name) => classifyLockfile(join(dir, name)))
		.sort((a, b) => a.lockPath.localeCompare(b.lockPath));
}

/**
 * Cleanup stale lockfiles in `dir`.
 *
 * - `confirmDelete: false` → every entry is reported as `refused` with a
 *   "requires --confirm" reason; nothing is deleted; exit code 0.
 * - `confirmDelete: true` → a lockfile is deleted ONLY when its verdict is
 *   `eligible:verified-dead-local` (parseable JSON, current host, positive
 *   pid, `process.kill(pid, 0)` → ESRCH). Every other holder is refused and
 *   left untouched. The exit code is 1 if any entry was refused, else 0.
 *
 * Never deletes alive, remote-host, permission-denied, pid-recycled,
 * malformed, malformed-pid, or unverified holders.
 */
export async function cleanupStaleLockfiles(
	dir: string,
	opts: {
		confirmDelete: boolean;
		/** Test/diagnostic hook: invoked after listing, before destructive phase. */
		onAfterListing?: (dir: string) => void;
	},
): Promise<CleanupResult> {
	const listings = listLockfiles(dir);
	opts.onAfterListing?.(dir);
	const actions: CleanupAction[] = [];

	for (const entry of listings) {
		if (entry.verdict === "eligible:verified-dead-local") {
			if (opts.confirmDelete) {
				// Maintenance kernel gate: held around classify/revalidate/delete
				// so acquireExclusiveFileLock cannot create a lock mid-delete.
				const gate = await acquireMaintenanceLock(
					entry.lockPath,
					resolveLockTimeoutMs(),
				);
				if (!gate.ok) {
					actions.push({
						lockPath: entry.lockPath,
						action: "refused",
						verdict: entry.verdict,
						reason: "coordination gate unavailable (concurrent acquire/cleanup)",
					});
					continue;
				}
				// Re-classify under gate to defeat TOCTOU.
				const current = classifyLockfile(entry.lockPath);
				if (
					current.verdict !== "eligible:verified-dead-local" ||
					current.holderPid !== entry.holderPid ||
					current.holderHost !== entry.holderHost
				) {
					actions.push({
						lockPath: entry.lockPath,
						action: "refused",
						verdict: current.verdict,
						reason: "identity changed under coordination gate (TOCTOU protection)",
					});
					await gate.handle.release();
					continue;
				}
				try {
					unlinkSync(entry.lockPath);
					actions.push({
						lockPath: entry.lockPath,
						action: "deleted",
						pid: entry.holderPid as number,
						startedAt: entry.holderStartedAt,
					});
				} catch (error: unknown) {
					actions.push({
						lockPath: entry.lockPath,
						action: "refused",
						verdict: entry.verdict,
						reason: `delete failed: ${
							(error as NodeJS.ErrnoException).code ?? String(error)
						}`,
					});
				}
				await gate.handle.release();
			} else {
				actions.push({
					lockPath: entry.lockPath,
					action: "refused",
					verdict: entry.verdict,
					reason: "deletion requires --confirm",
				});
			}
		} else {
			actions.push({
				lockPath: entry.lockPath,
				action: "refused",
				verdict: entry.verdict,
				reason: refusalReason(entry.verdict),
			});
		}
	}

	const refusedCount = actions.filter((a) => a.action === "refused").length;
	// In confirm mode any refusal is a non-zero exit (operator must inspect).
	// In read-only mode the listing is informational → exit 0.
	const exitCode = opts.confirmDelete && refusedCount > 0 ? 1 : 0;
	return { actions, exitCode };
}

function refusalReason(verdict: LockfileVerdict): string {
	switch (verdict) {
		case "refused:alive-local":
			return "holder process is alive (or pid has been recycled by another process)";
		case "refused:remote-host":
			return "holder host differs from the current host";
		case "refused:malformed":
			return "lockfile is unreadable, non-JSON, or missing required fields";
		case "refused:malformed-pid":
			return "holder pid is missing, zero, negative, or non-integer";
		case "refused:pid-probe-error":
			return "pid liveness probe failed (EPERM or unknown error); cannot verify dead";
		default:
			return "not eligible for deletion";
	}
}

// ───────────────────────────────────────────────────────────────────────────
// MAINTENANCE GATE — node:net kernel primitive (spec #3098 rev7, design #3099 rev6)
// ───────────────────────────────────────────────────────────────────────────
//
// Zero-dependency cross-process maintenance exclusivity via a kernel-released
// node:net server endpoint. Hold = "kernel endpoint bound to this process";
// release = server.close() (+ POSIX socket unlink); crash = kernel teardown.
// No file-based coordination gate, no reap evidence files, no rename, no
// TTL/PID liveness. Both acquireExclusiveFileLock and cleanupStaleLockfiles
// acquire/release this SAME gate around their critical sections so the writer
// stays unaware.
//
// ─── MAINTENANCE GATE START ───

const IS_WIN = platform() === "win32";
const MAINT_POLL_MS = 25;

/**
 * Dependency-injection seam for the POSIX socket-permission hardening step
 * (verify report #3260 warning 1). Lets tests exercise the chmod path and its
 * failure/cleanup behaviour deterministically on any host. All fields are
 * optional and default to the real filesystem/kernel operations.
 */
export type MaintenanceSocketDeps = {
	/** chmod the bound socket path; defaults to node:fs/promises chmod. */
	chmod?: (path: string, mode: number) => Promise<void>;
	/** unlink used in the chmod-failure cleanup; defaults to node:fs/promises unlink. */
	unlink?: (path: string) => Promise<void>;
	/** platform predicate; defaults to the module IS_WIN constant. */
	isWindows?: () => boolean;
};

export interface MaintenanceHandle {
	release(): Promise<void>;
	readonly endpoint: string;
}

export interface MaintenanceDiagnostics {
	platform: NodeJS.Platform;
	endpoint: string;
	lastError?: { code?: string; message: string };
	elapsedMs: number;
}

export type MaintenanceAcquireResult =
	| { ok: true; handle: MaintenanceHandle; endpoint: string }
	| {
			ok: false;
			code: "MAINTENANCE_BUSY";
			diagnostics: MaintenanceDiagnostics;
	  }
	| {
			ok: false;
			code: "MAINTENANCE_IO_ERROR";
			diagnostics: MaintenanceDiagnostics;
	  };

function hashLockPath(canonicalLockPath: string): string {
	return createHash("sha256").update(canonicalLockPath).digest("hex");
}

/**
 * Derive the deterministic kernel endpoint for a canonical lockPath.
 *
 * Windows: `\\.\pipe\idu-pi-maint-<sha256hex>` (full 64 hex; ≤256 chars).
 * POSIX:   `${tmpdir()}/idu-pi-maint-<sha256hex[0:16]>.sock` (≤108 chars).
 *
 * Stable across processes and runs (same lockPath → byte-identical endpoint).
 */
export function deriveMaintenanceEndpoint(
	canonicalLockPath: string,
): string {
	const hash = hashLockPath(canonicalLockPath);
	if (IS_WIN) {
		return `\\\\.\\pipe\\idu-pi-maint-${hash}`;
	}
	// POSIX: tmpdir + truncated hash (socket path-limit safe, hash-isolated).
	return `${tmpdir()}/idu-pi-maint-${hash.slice(0, 16)}.sock`;
}

/**
 * Try to bind a fresh node:net server to the endpoint.
 *
 * Returns `acquired` (with the bound server), `busy` (EADDRINUSE), or `io`
 * (any other error — fail-closed).
 */
function tryListen(
	endpoint: string,
): Promise<
	| { kind: "acquired"; server: Server }
	| { kind: "busy" }
	| { kind: "io"; error: { code?: string; message: string } }
> {
	return new Promise((resolve) => {
		const server = createServer();
		let settled = false;
		const onListening = () => {
			if (settled) return;
			settled = true;
			resolve({ kind: "acquired", server });
		};
		const onError = (err: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			try {
				server.close();
			} catch {
				/* not listening — nothing to close */
			}
			if (err.code === "EADDRINUSE") {
				resolve({ kind: "busy" });
			} else {
				resolve({
					kind: "io",
					error: { code: err.code, message: err.message },
				});
			}
		};
		server.once("listening", onListening);
		server.once("error", onError);
		server.listen(endpoint);
	});
}

/**
 * POSIX connect-probe: determine whether a live listener exists at the
 * endpoint. `connected` = live (busy); `ECONNREFUSED` = stale path (holder
 * crashed, path survived); anything else = fail-closed.
 */
function connectProbe(
	endpoint: string,
): Promise<"connected" | "ECONNREFUSED" | string> {
	return new Promise((resolve) => {
		const socket = createConnection(endpoint);
		let settled = false;
		const done = (val: string) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(val);
		};
		socket.once("connect", () => done("connected"));
		socket.once("error", (err: NodeJS.ErrnoException) =>
			done(err.code ?? "UNKNOWN"),
		);
		// Bounded timeout so the probe never hangs.
		const timer = setTimeout(() => done("PROBE_TIMEOUT"), 500);
		socket.once("close", () => clearTimeout(timer));
	});
}

/** Unlink a path, ignoring ENOENT (already gone), using the real fs.unlink. */
async function safeUnlinkPath(path: string): Promise<void> {
	return safeUnlinkPathDeps(path);
}

/**
 * Deps-aware unlink that ignores ENOENT. Falls back to the real fs.unlink when
 * no seam is provided. Used both by the regular cleanup paths and by the
 * chmod-failure recovery so the failure path is platform-safe under test.
 */
async function safeUnlinkPathDeps(
	path: string,
	deps?: MaintenanceSocketDeps,
): Promise<void> {
	const unlinkFn = deps?.unlink ?? unlink;
	try {
		await unlinkFn(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

/** Close a server, swallowing the synchronous ERR_SERVER_NOT_RUNNING edge case. */
function closeServerQuiet(server: Server): Promise<void> {
	return new Promise((resolve) => {
		try {
			server.close(() => resolve());
		} catch {
			resolve();
		}
	});
}

/**
 * Harden a freshly bound POSIX Unix-socket endpoint to 0o600 BEFORE exposing an
 * ok maintenance handle (verify report #3260 warning 1). tmpdir is
 * world-writable; without tightening perms another local user could
 * symlink-attack the predicted socket path.
 *
 * - Windows: named pipe — no filesystem chmod; return acquired unchanged.
 * - POSIX:   chmod the socket path to 0o600. On failure, close the server,
 *            unlink the stale socket (ENOENT-safe), and return an io result so
 *            the caller maps it to MAINTENANCE_IO_ERROR — an ok handle is NEVER
 *            exposed on chmod failure.
 */
async function hardenAcquired(
	server: Server,
	endpoint: string,
	deps?: MaintenanceSocketDeps,
): Promise<
	| { kind: "acquired"; server: Server }
	| { kind: "io"; error: { code?: string; message: string } }
> {
	const isWin = deps?.isWindows?.() ?? IS_WIN;
	if (isWin) return { kind: "acquired", server };
	const chmodFn = deps?.chmod ?? ((p, m) => fsChmod(p, m));
	try {
		await chmodFn(endpoint, 0o600);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		// Never expose the handle: tear down the listener, remove the stale
		// socket path, and fail closed with the observed error.
		await closeServerQuiet(server);
		await safeUnlinkPathDeps(endpoint, deps);
		return {
			kind: "io",
			error: {
				code: e.code ?? "ECHMOD",
				message: `chmod 0600 failed: ${e.message}`,
			},
		};
	}
	return { kind: "acquired", server };
}

/**
 * Single acquisition attempt. On EADDRINUSE:
 * - Windows → busy (pipe namespace; no filesystem cleanup).
 * - POSIX   → connect-probe:
 *     connected    → busy (live listener)
 *     ECONNREFUSED → unlink stale socket path, retry bind exactly once
 *     other        → IO fail-closed (no unlink-retry)
 */
async function attemptAcquire(
	endpoint: string,
	deps?: MaintenanceSocketDeps,
): Promise<
	| { kind: "acquired"; server: Server }
	| { kind: "busy" }
	| { kind: "io"; error: { code?: string; message: string } }
> {
	const first = await tryListen(endpoint);
	if (first.kind === "acquired") return hardenAcquired(first.server, endpoint, deps);
	if (first.kind === "io") return first;

	// EADDRINUSE — disambiguate by platform.
	if (IS_WIN) return { kind: "busy" };

	const probe = await connectProbe(endpoint);
	if (probe === "connected") return { kind: "busy" };
	if (probe === "ECONNREFUSED") {
		// Dead socket path — unlink then retry bind exactly once.
		await safeUnlinkPath(endpoint);
		const retry = await tryListen(endpoint);
		if (retry.kind === "acquired") return hardenAcquired(retry.server, endpoint, deps);
		return retry;
	}
	return {
		kind: "io",
		error: { code: probe, message: `connect-probe error: ${probe}` },
	};
}

function makeMaintenanceHandle(
	server: Server,
	endpoint: string,
): MaintenanceHandle {
	let released = false;
	return {
		endpoint,
		async release(): Promise<void> {
			if (released) return;
			released = true;
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
			// POSIX: clean up the socket file (ENOENT-safe).
			// Windows: no filesystem cleanup — pipe is kernel-managed.
			if (!IS_WIN) {
				await safeUnlinkPath(endpoint);
			}
		},
	};
}

/**
 * Acquire maintenance exclusivity for `canonicalLockPath` via a node:net
 * kernel endpoint. Bounded poll until `timeoutMs`.
 *
 * Returns `ok` with a `MaintenanceHandle` on success, `MAINTENANCE_BUSY` on
 * contention/timeout, or `MAINTENANCE_IO_ERROR` on genuine failure.
 */
export async function acquireMaintenanceLock(
	canonicalLockPath: string,
	timeoutMs: number,
	deps?: MaintenanceSocketDeps,
): Promise<MaintenanceAcquireResult> {
	const endpoint = deriveMaintenanceEndpoint(canonicalLockPath);
	const startMs = Date.now();
	const deadline = startMs + timeoutMs;
	let lastError: { code?: string; message: string } | undefined;

	for (;;) {
		const outcome = await attemptAcquire(endpoint, deps);
		if (outcome.kind === "acquired") {
			return {
				ok: true,
				handle: makeMaintenanceHandle(outcome.server, endpoint),
				endpoint,
			};
		}
		if (outcome.kind === "io") {
			return {
				ok: false,
				code: "MAINTENANCE_IO_ERROR",
				diagnostics: {
					platform: platform(),
					endpoint,
					lastError: outcome.error,
					elapsedMs: Date.now() - startMs,
				},
			};
		}
		// busy → bounded poll
		lastError = { code: "EADDRINUSE", message: "endpoint in use" };
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return {
				ok: false,
				code: "MAINTENANCE_BUSY",
				diagnostics: {
					platform: platform(),
					endpoint,
					lastError,
					elapsedMs: Date.now() - startMs,
				},
			};
		}
		await sleep(Math.min(MAINT_POLL_MS, remaining));
	}
}

// ─── MAINTENANCE GATE END ───
