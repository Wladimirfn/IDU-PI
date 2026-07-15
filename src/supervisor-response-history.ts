import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	acquireExclusiveFileLock,
	releaseExclusiveFileLock,
	type LockDiagnostics,
} from "./state-root-file-lock.js";

export const SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES = 50;
export const SUPERVISOR_RESPONSE_HISTORY_QUESTION_MAX = 240;
export const SUPERVISOR_RESPONSE_HISTORY_RESPONSE_MAX = 4_000;
export const SUPERVISOR_RESPONSE_HISTORY_ERROR_MAX = 240;

export type SupervisorResponseStatus = "success" | "error";

export type SupervisorResponseHistoryEntry = {
	timestamp: string;
	role: string;
	provider?: string;
	model?: string;
	status: SupervisorResponseStatus;
	questionSummary: string;
	response?: string;
	error?: string;
};

export type SupervisorResponseRecordInput = {
	stateRoot: string;
	role: string;
	question: string;
	result: {
		ok: boolean;
		role: string;
		response: string;
		model: string;
		provider: string;
		promptChars: number;
		elapsedMs: number;
		reason?: string;
	};
	timestamp?: string;
	now?: Date;
};

export type SupervisorResponseRecordResult =
	| { ok: true; path: string }
	| {
			ok: false;
			path: string;
			error: string;
			/**
			 * Diagnostics from the file lock when the failure is a lock-acquire failure
			 * (LOCK_TIMEOUT / LOCK_IO_ERROR). Absent for other write errors.
			 */
			lockDiagnostics?: LockDiagnostics;
	  };

/**
 * A single deferred-persistence failure surfaced by `flushSupervisorResponseHistory`.
 * One record per deferred entry in the deferred-log (spec #3098 rev4, design #3099 rev3).
 */
export type DeferredFlushFailure = {
	entryId: string;
	errorCode: "LOCK_TIMEOUT" | "LOCK_IO_ERROR";
	diagnostics: LockDiagnostics;
};

/**
 * Typed aggregate result of `flushSupervisorResponseHistory`. The function is TOTAL —
 * it never throws. Missing/empty/unreadable/malformed logs all yield a typed result.
 *
 * - `ok: true` → the deferred log was read cleanly (or absent/empty); `deferredCount`
 *   equals `failures.length`.
 * - `ok: false` with `FLUSH_IO_ERROR` → a real I/O failure reading the log.
 * - `ok: false` with `FLUSH_PARSE_ERROR` → a deferred-log line could not be parsed;
 *   `deferredCount`/`failures` reflect entries parsed before the malformed line.
 */
export type FlushSupervisorResponseHistoryResult =
	| { ok: true; deferredCount: number; failures: DeferredFlushFailure[] }
	| {
			ok: false;
			errorCode: "FLUSH_IO_ERROR" | "FLUSH_PARSE_ERROR";
			deferredCount: number;
			failures: DeferredFlushFailure[];
	  };

const SAFE_LABEL_RE = /[^A-Za-z0-9._:/-]/gu;
const MAX_LABEL_LENGTH = 96;
const MAX_QUESTION_FALLBACK = "consult without question";
const MAX_ERROR_FALLBACK = "consult failed without error message";

// In-process serialization queue: ensures that concurrent calls to
// recordSupervisorResponse within a single MCP process never interleave
// their read-modify-write cycles. Cross-process serialization is provided
// by acquireExclusiveFileLock inside persistWithRetention.
let writeChain: Promise<unknown> = Promise.resolve();

// In-process serialization queue for deferred-failure log appends. The append runs OUTSIDE
// writeChain (it executes after a write settles), so concurrent deferred appends within one
// process could otherwise interleave. This chain serializes them.
let deferredAppendChain: Promise<unknown> = Promise.resolve();

const pendingSupervisorResponseWrites = new Set<
	Promise<SupervisorResponseRecordResult>
>();

export function supervisorResponseHistoryPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-supervisor-responses.jsonl");
}

/**
 * Deferred-persistence failure log path. Sibling of the history file.
 *
 * Lock-acquire failures from `persistWithRetention` (LOCK_TIMEOUT / LOCK_IO_ERROR) are appended
 * here by `writeDeferredFailure` (task 2.4) so `flushSupervisorResponseHistory` can aggregate them.
 * The log is append-only and disposable: `flushSupervisorResponseHistory` consumes it (truncates to
 * empty) after a clean read (task e), and a missing/empty log is treated as zero-count success.
 *
 * (spec #3098 rev4, design #3099 rev3 — tasks #3100 rev7 WU-2.)
 */
export function supervisorResponseDeferredLogPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-supervisor-responses.deferred.jsonl");
}

export function buildSupervisorResponseHistoryEntryFromConsult(
	input: SupervisorResponseRecordInput,
	now?: Date,
): SupervisorResponseHistoryEntry {
	const ts = (now ?? input.now ?? new Date()).toISOString();
	const summary = boundQuestionSummary(input.question);
	const role = sanitizeLabel(input.result.role || input.role);
	if (input.result.ok) {
		return {
			timestamp: ts,
			role,
			...(input.result.provider
				? { provider: sanitizeLabel(input.result.provider) }
				: {}),
			...(input.result.model
				? { model: sanitizeLabel(input.result.model) }
				: {}),
			status: "success",
			questionSummary: summary,
			response: boundResponseBody(input.result.response),
		};
	}
	return {
		timestamp: ts,
		role,
		status: "error",
		questionSummary: summary,
		error: boundErrorMessage(input.result.reason, input.result.response),
	};
}

export async function recordSupervisorResponse(
	stateRoot: string,
	entry: SupervisorResponseHistoryEntry,
): Promise<SupervisorResponseRecordResult> {
	const path = supervisorResponseHistoryPath(stateRoot);
	// Serialize all writes within this process: chain each write so the
	// read-modify-write cycle of the next call starts only after the
	// previous rename completes.
	const run = writeChain.then(
		() => persistWithRetention(stateRoot, path, entry),
		() => persistWithRetention(stateRoot, path, entry),
	);
	writeChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

async function persistWithRetention(
	stateRoot: string,
	path: string,
	entry: SupervisorResponseHistoryEntry,
): Promise<SupervisorResponseRecordResult> {
	// Ensure the parent directory of both the history file and the lockfile exists
	// BEFORE acquiring the lock (the lockfile is a sibling of `path`).
	try {
		await mkdir(dirname(path), { recursive: true });
	} catch (error) {
		return {
			ok: false,
			path,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// Cross-process exclusive lock around the read-modify-write cycle. The
	// in-process writeChain (see recordSupervisorResponse) still serializes
	// concurrent calls within ONE process; this lock additionally serializes
	// writes ACROSS processes sharing the same stateRoot. Together they make
	// lost updates impossible.
	const acquire = await acquireExclusiveFileLock(path);
	if (!acquire.ok) {
		return {
			ok: false,
			path,
			error: acquire.code,
			lockDiagnostics: acquire.diagnostics,
		};
	}
	const handle = { lockPath: acquire.lockPath, token: acquire.token };

	try {
		const existing = readSupervisorResponseHistoryRaw(stateRoot);
		const merged = [...existing, entry].sort((a, b) =>
			b.timestamp.localeCompare(a.timestamp),
		);
		const retained = merged.slice(0, SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES);
		const content =
			retained.map((e) => JSON.stringify(e)).join("\n") + "\n";
		await writeTempAndRename(path, content);
		return { ok: true, path };
	} catch (error) {
		return {
			ok: false,
			path,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await releaseExclusiveFileLock(handle);
	}
}

async function writeTempAndRename(
	finalPath: string,
	content: string,
): Promise<void> {
	const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tempPath, content, "utf8");
	try {
		await rename(tempPath, finalPath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

export function recordSupervisorResponseDeferred(
	stateRoot: string,
	input: SupervisorResponseRecordInput,
): void {
	const entry = buildSupervisorResponseHistoryEntryFromConsult(input);
	// Chain the deferred-failure append INTO the tracked write promise so flush — which awaits
	// pending writes before reading the log (ordering invariant, task 3.4) — observes any appended
	// deferred line in the SAME flush cycle. Only lock-acquire failures (LOCK_TIMEOUT /
	// LOCK_IO_ERROR, signalled by result.lockDiagnostics) are appended; other write errors are not.
	const write = recordSupervisorResponse(stateRoot, entry).then(
		async (result) => {
			if (!result.ok && result.lockDiagnostics) {
				const errorCode: "LOCK_TIMEOUT" | "LOCK_IO_ERROR" =
					result.error === "LOCK_TIMEOUT"
						? "LOCK_TIMEOUT"
						: "LOCK_IO_ERROR";
				await writeDeferredFailure(
					stateRoot,
					entry,
					errorCode,
					result.lockDiagnostics,
				).catch(() => undefined);
			}
			return result;
		},
	);
	pendingSupervisorResponseWrites.add(write);
	void write.finally(() => pendingSupervisorResponseWrites.delete(write));
}

/**
 * Append one deferred-persistence failure line to the deferred log
 * (`${stateRoot}/reports/idu-supervisor-responses.deferred.jsonl`). Best-effort: the deferred log
 * is disposable and never throws to the caller. (task 2.4 — Phase 2 deferred-log append.)
 *
 * The line shape is `{ entryId, timestamp, role, errorCode, diagnostics }`; `timestamp` and `role`
 * are persisted for traceability but only `entryId` / `errorCode` / `diagnostics` are surfaced by
 * the flush aggregate (see parseDeferredLine).
 */
function writeDeferredFailure(
	stateRoot: string,
	entry: SupervisorResponseHistoryEntry,
	errorCode: "LOCK_TIMEOUT" | "LOCK_IO_ERROR",
	diagnostics: LockDiagnostics,
): Promise<void> {
	const deferredPath = supervisorResponseDeferredLogPath(stateRoot);
	const run = deferredAppendChain.then(async () => {
		await mkdir(dirname(deferredPath), { recursive: true });
		const line =
			JSON.stringify({
				entryId: buildDeferredEntryId(entry),
				timestamp: entry.timestamp,
				role: entry.role,
				errorCode,
				diagnostics,
			}) + "\n";
		await appendFile(deferredPath, line, "utf8");
	});
	// Keep the chain settled so a later append is not blocked by a rejected one.
	deferredAppendChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

/**
 * Deterministic identifier for a deferred-failure line, derived from the attempted entry.
 * Stable across re-derivation from the same entry so callers/tests can predict it.
 */
function buildDeferredEntryId(entry: SupervisorResponseHistoryEntry): string {
	return `${entry.timestamp}#${entry.role}`;
}

/**
 * Flush the deferred supervisor-response write queue and aggregate any deferred
 * persistence failures. TOTAL: never throws (spec #3098 rev4, design #3099 rev3,
 * tasks #3100 rev7 WU-2 Phase 3).
 *
 * `stateRoot` is optional and resolves the deferred-failure log path
 * (`${stateRoot}/reports/idu-supervisor-responses.deferred.jsonl`). When omitted,
 * flush awaits pending writes and returns a zero-count success — there is no
 * stateRoot-relative log to read. This keeps the pre-WU-2 zero-arg call sites
 * back-compatible (task 3.6: callers that awaited flush keep working; none read
 * the result today).
 *
 * Ordering invariant (task 3.4): pending writes are awaited BEFORE the deferred
 * log is read, so the aggregate reflects any failures deferred by in-flight writes.
 */
export async function flushSupervisorResponseHistory(
	stateRoot?: string,
): Promise<FlushSupervisorResponseHistoryResult> {
	// Ordering invariant (task 3.4): settle every in-flight write before reading the
	// deferred log so the aggregate reflects failures deferred by those writes. Because the
	// deferred-failure append is chained INTO each tracked write promise (task 2.4), every
	// append has also settled by the time this resolves.
	await Promise.allSettled([...pendingSupervisorResponseWrites]);
	if (!stateRoot) {
		return { ok: true, deferredCount: 0, failures: [] };
	}
	const deferredLogPath = supervisorResponseDeferredLogPath(stateRoot);
	const result = readDeferredLogAggregate(deferredLogPath);
	// Consume the deferred log ONLY on a clean read (task e). On FLUSH_IO_ERROR / FLUSH_PARSE_ERROR
	// the log is left intact so the malformed/unreadable state is not silently lost — a retry
	// re-flush observes the same input. The truncate is best-effort and never throws: the log is
	// disposable and any new in-flight append (within this process) was already awaited above.
	if (result.ok) {
		await consumeDeferredLog(deferredLogPath);
	}
	return result;
}

/**
 * Truncate the deferred-failure log back to empty after a successful flush so a subsequent flush
 * returns zero-count (task e). Writing an empty string (rather than unlink) keeps the file present
 * and idempotent across repeated flushes. Best-effort: failures are swallowed because the log is
 * disposable and its absence/emptiness is treated identically by readDeferredLogAggregate.
 */
async function consumeDeferredLog(deferredLogPath: string): Promise<void> {
	try {
		await writeFile(deferredLogPath, "", "utf8");
	} catch {
		// Swallow: a missing/unwritable deferred log is harmless — the next read treats it
		// as absent/empty and returns { ok: true, deferredCount: 0, failures: [] }.
	}
}

/**
 * Read and aggregate the deferred-persistence failure log NON-DESTRUCTIVELY.
 * (task 3.7 — split into `readDeferredLogAggregate` + `parseDeferredLine`.)
 *
 * - ENOENT (missing file) → { ok: true, 0, [] } — absence is not an error.
 * - Empty file → { ok: true, 0, [] }.
 * - Any other read error (ENOTDIR, EACCES, EISDIR, …) → { ok: false, FLUSH_IO_ERROR, 0, [] }.
 * - A line that fails to parse / validate → { ok: false, FLUSH_PARSE_ERROR, <parsed-so-far>, [...] }.
 * - All lines valid → { ok: true, <count>, [...] }.
 */
function readDeferredLogAggregate(
	deferredLogPath: string,
): FlushSupervisorResponseHistoryResult {
	let content: string;
	try {
		content = readFileSync(deferredLogPath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// A missing deferred log is the normal state — not an error.
		if (code === "ENOENT") {
			return { ok: true, deferredCount: 0, failures: [] };
		}
		return {
			ok: false,
			errorCode: "FLUSH_IO_ERROR",
			deferredCount: 0,
			failures: [],
		};
	}

	const lines = content
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return { ok: true, deferredCount: 0, failures: [] };
	}

	const failures: DeferredFlushFailure[] = [];
	for (const line of lines) {
		const parsed = parseDeferredLine(line);
		if (parsed === undefined) {
			return {
				ok: false,
				errorCode: "FLUSH_PARSE_ERROR",
				deferredCount: failures.length,
				failures,
			};
		}
		failures.push(parsed);
	}
	return { ok: true, deferredCount: failures.length, failures };
}

/**
 * Parse one deferred-log line into a `DeferredFlushFailure`, or `undefined` if the
 * line is malformed (non-JSON, or missing `entryId` / a valid `errorCode` /
 * a `diagnostics` object with a non-empty `lockPath`). (task 3.7.)
 *
 * `timestamp` and `role` from the persisted line are intentionally NOT surfaced —
 * `DeferredFlushFailure` exposes only `entryId`, `errorCode`, and `diagnostics`.
 */
function parseDeferredLine(
	line: string,
): DeferredFlushFailure | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const { entryId, errorCode, diagnostics } = value;
	if (typeof entryId !== "string" || entryId.trim().length === 0) {
		return undefined;
	}
	if (errorCode !== "LOCK_TIMEOUT" && errorCode !== "LOCK_IO_ERROR") {
		return undefined;
	}
	if (!isLockDiagnostics(diagnostics)) return undefined;
	return {
		entryId,
		errorCode,
		diagnostics,
	};
}

/**
 * Structural guard for a `LockDiagnostics` payload persisted in the deferred log.
 * `lockPath` is the only required field; all others are optional.
 */
function isLockDiagnostics(value: unknown): value is LockDiagnostics {
	return (
		isRecord(value) &&
		typeof value.lockPath === "string" &&
		value.lockPath.length > 0
	);
}

export function readSupervisorResponseHistory(
	stateRoot: string,
	limit: number = SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES,
): SupervisorResponseHistoryEntry[] {
	const entries = readSupervisorResponseHistoryRaw(stateRoot);
	if (limit > 0 && entries.length > limit) {
		return entries.slice(0, limit);
	}
	return entries;
}

function readSupervisorResponseHistoryRaw(
	stateRoot: string,
): SupervisorResponseHistoryEntry[] {
	const path = supervisorResponseHistoryPath(stateRoot);
	if (!existsSync(path)) return [];
	try {
		const lines = readFileSync(path, "utf8")
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean);
		const parsed = lines.flatMap((line) => {
			try {
				const value: unknown = JSON.parse(line);
				const entry = parseSupervisorResponseEntry(value);
				return entry ? [entry] : [];
			} catch {
				return [];
			}
		});
		parsed.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		return parsed;
	} catch {
		return [];
	}
}

function parseSupervisorResponseEntry(
	value: unknown,
): SupervisorResponseHistoryEntry | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.timestamp !== "string" || !value.timestamp.trim())
		return undefined;
	if (typeof value.role !== "string" || !value.role.trim()) return undefined;
	if (value.status !== "success" && value.status !== "error") return undefined;
	if (
		typeof value.questionSummary !== "string" ||
		!value.questionSummary.trim()
	)
		return undefined;
	return {
		timestamp: value.timestamp,
		role: sanitizeLabel(value.role),
		...(typeof value.provider === "string" && value.provider.trim()
			? { provider: sanitizeLabel(value.provider) }
			: {}),
		...(typeof value.model === "string" && value.model.trim()
			? { model: sanitizeLabel(value.model) }
			: {}),
		status: value.status,
		questionSummary: boundQuestionSummary(value.questionSummary),
		...(typeof value.response === "string" && value.response.trim()
			? { response: boundResponseBody(value.response) }
			: {}),
		...(typeof value.error === "string" && value.error.trim()
			? { error: boundErrorMessage(undefined, value.error) }
			: {}),
	};
}

function boundQuestionSummary(question: string): string {
	const normalized = question.replace(/\s+/gu, " ").trim();
	if (!normalized) return MAX_QUESTION_FALLBACK;
	if (normalized.length <= SUPERVISOR_RESPONSE_HISTORY_QUESTION_MAX)
		return normalized;
	return `${normalized.slice(0, SUPERVISOR_RESPONSE_HISTORY_QUESTION_MAX - 1)}…`;
}

function boundResponseBody(response: string): string {
	if (!response) return "";
	if (response.length <= SUPERVISOR_RESPONSE_HISTORY_RESPONSE_MAX)
		return response;
	return `${response.slice(0, SUPERVISOR_RESPONSE_HISTORY_RESPONSE_MAX - 1)}…`;
}

function boundErrorMessage(
	reason: string | undefined,
	fallback: string,
): string {
	const candidate =
		reason && reason.trim() ? reason.trim() : (fallback || "").trim();
	const base = candidate || MAX_ERROR_FALLBACK;
	if (base.length <= SUPERVISOR_RESPONSE_HISTORY_ERROR_MAX) return base;
	return `${base.slice(0, SUPERVISOR_RESPONSE_HISTORY_ERROR_MAX - 1)}…`;
}

function sanitizeLabel(value: string): string {
	const sanitized = value
		.trim()
		.replace(SAFE_LABEL_RE, "_")
		.slice(0, MAX_LABEL_LENGTH);
	return sanitized || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
