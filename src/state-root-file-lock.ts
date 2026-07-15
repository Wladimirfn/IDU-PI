import { randomUUID } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
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
	const gatePath = `${lockPath}.maintenance`;

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

		// Coordination gate (TOCTOU): briefly held during creation so cleanup can't unlink a lock mid-acquire.
		const gate = tryCreateExclusive(gatePath, content);
		if (gate.kind === "io_error") {
			return {
				ok: false,
				code: "LOCK_IO_ERROR",
				diagnostics: buildDiagnostics(lockPath, gate.error),
			};
		}
		if (gate.kind !== "created") {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return {
					ok: false,
					code: "LOCK_TIMEOUT",
					diagnostics: buildDiagnostics(lockPath, undefined),
				};
			}
			await sleep(Math.min(pollMs, remaining));
			continue;
		}

		const createResult = tryCreateExclusive(lockPath, content);
		try {
			unlinkSync(gatePath);
		} catch {
			/* gate already released */
		}
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
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return {
				ok: false,
				code: "LOCK_TIMEOUT",
				diagnostics: buildDiagnostics(lockPath, undefined),
			};
		}
		await sleep(Math.min(pollMs, remaining));
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
export function cleanupStaleLockfiles(
	dir: string,
	opts: {
		confirmDelete: boolean;
		/** Test/diagnostic hook: invoked after listing, before destructive phase. */
		onAfterListing?: (dir: string) => void;
	},
): CleanupResult {
	const listings = listLockfiles(dir);
	opts.onAfterListing?.(dir);
	const actions: CleanupAction[] = [];

	for (const entry of listings) {
		if (entry.verdict === "eligible:verified-dead-local") {
			if (opts.confirmDelete) {
				const gatePath = `${entry.lockPath}.maintenance`;
				const gate = tryCreateExclusive(
					gatePath,
					JSON.stringify({ pid: process.pid, ts: Date.now() }),
				);
				if (gate.kind !== "created") {
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
					try {
						unlinkSync(gatePath);
					} catch {
						/* gate released */
					}
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
				try {
					unlinkSync(gatePath);
				} catch {
					/* gate released */
				}
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
