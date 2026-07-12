import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
	| { ok: false; path: string; error: string };

const SAFE_LABEL_RE = /[^A-Za-z0-9._:/-]/gu;
const MAX_LABEL_LENGTH = 96;
const MAX_QUESTION_FALLBACK = "consult without question";
const MAX_ERROR_FALLBACK = "consult failed without error message";

// In-process serialization queue: ensures that concurrent calls to
// recordSupervisorResponse within a single MCP process never interleave
// their read-modify-write cycles. See "Multi-process assessment" test
// for the documented cross-process limitation.
let writeChain: Promise<unknown> = Promise.resolve();

const pendingSupervisorResponseWrites = new Set<
	Promise<SupervisorResponseRecordResult>
>();

export function supervisorResponseHistoryPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-supervisor-responses.jsonl");
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
	try {
		await mkdir(dirname(path), { recursive: true });
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
	const write = recordSupervisorResponse(stateRoot, entry);
	pendingSupervisorResponseWrites.add(write);
	void write.finally(() => pendingSupervisorResponseWrites.delete(write));
}

export async function flushSupervisorResponseHistory(): Promise<void> {
	await Promise.allSettled([...pendingSupervisorResponseWrites]);
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
