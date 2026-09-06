/**
 * cli-supervisor-responses.ts — operator-facing read surface for the
 * supervisor response history JSONL
 * (`${stateRoot}/reports/idu-supervisor-responses.jsonl`). Mirrors the
 * shape of `cli-model-invocation-status.ts`: build → format → parseArgs
 * + a top-level CLI wrapper that the dispatch in `src/cli.ts` calls.
 *
 * Spec #3098 rev4 / design #3099 rev3 / tasks #3100 rev7 WU-2 — the
 * write side (`consultSupervisor` → `recordSupervisorResponseDeferred`)
 * lands the JSONL line; this module reads it back for operators.
 *
 * The file is OPTIONAL on disk: a missing or empty history is a normal
 * "no supervisor consults yet" state, NOT an error.
 */

import {
	readSupervisorResponseHistory,
	supervisorResponseHistoryPath,
	type SupervisorResponseHistoryEntry,
} from "./supervisor-response-history.js";

export const DEFAULT_SUPERVISOR_RESPONSES_LIMIT = 10;
const QUESTION_SUMMARY_MAX = 80;
const RESPONSE_PREVIEW_MAX = 80;
const ERROR_MESSAGE_MAX = 80;
const ELLIPSIS = "…";

export type SupervisorResponsesReport = {
	generatedAt: string;
	stateRoot: string;
	path: string;
	limit: number;
	returnedCount: number;
	entries: SupervisorResponseHistoryEntry[];
};

export type BuildSupervisorResponsesOptions = {
	limit?: number;
};

export type ParseSupervisorResponsesArgsResult = {
	options: BuildSupervisorResponsesOptions;
	stateRootOverride?: string;
};

export function buildSupervisorResponsesReport(input: {
	stateRoot: string;
	options?: BuildSupervisorResponsesOptions;
}): SupervisorResponsesReport {
	const limit = parseLimit(input.options?.limit);
	const entries = readSupervisorResponseHistory(input.stateRoot, limit);
	return {
		generatedAt: new Date().toISOString(),
		stateRoot: input.stateRoot,
		path: supervisorResponseHistoryPath(input.stateRoot),
		limit,
		returnedCount: entries.length,
		entries,
	};
}

function parseLimit(raw: number | undefined): number {
	if (raw === undefined || raw === null) return DEFAULT_SUPERVISOR_RESPONSES_LIMIT;
	if (!Number.isInteger(raw) || raw < 0) {
		throw new Error(
			`--limit inválido: "${String(raw)}". Usá un entero no-negativo.`,
		);
	}
	return raw;
}

function truncate(value: string | undefined, max: number): string | undefined {
	if (value === undefined) return undefined;
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1)}${ELLIPSIS}`;
}

function formatEntryLine(entry: SupervisorResponseHistoryEntry): string {
	const ts = entry.timestamp;
	const status = entry.status;
	const role = entry.role;
	if (status === "error") {
		const err = truncate(entry.error, ERROR_MESSAGE_MAX) ?? "(no error message)";
		return `  ${ts}  ${status.padEnd(7)}  ${role.padEnd(28)}  err="${err}"`;
	}
	const preview = truncate(entry.response, RESPONSE_PREVIEW_MAX) ?? "";
	const question = truncate(entry.questionSummary, QUESTION_SUMMARY_MAX) ?? "";
	return `  ${ts}  ${status.padEnd(7)}  ${role.padEnd(28)}  q="${question}"  out="${preview}"`;
}

export function formatSupervisorResponses(
	report: SupervisorResponsesReport,
): string {
	const lines: string[] = [];
	lines.push(`Supervisor Responses — last ${report.limit}`);
	lines.push(
		`StateRoot: ${report.stateRoot} · file: ${report.path}`,
	);
	lines.push(`Generated at: ${report.generatedAt}`);
	lines.push("");
	if (report.entries.length === 0) {
		lines.push("no supervisor responses yet");
		lines.push("");
		lines.push(`Total: 0 entries. (limit: ${report.limit})`);
		return lines.join("\n");
	}
	for (const entry of report.entries) {
		lines.push(formatEntryLine(entry));
	}
	lines.push("");
	lines.push(`Total: ${report.returnedCount} entr${report.returnedCount === 1 ? "y" : "ies"}.`);
	return lines.join("\n");
}

/**
 * Parse CLI args for `idu-supervisor-responses`. Accepted:
 *   --limit <n>          limit entries (default 10)
 *   --state-root <path>  override the active project's stateRoot
 *
 * Unknown flags throw so the dispatcher surfaces a clean error.
 */
export function parseSupervisorResponsesArgs(
	rawArgs: readonly string[],
): ParseSupervisorResponsesArgsResult {
	const args = [...rawArgs];
	let limit: number | undefined;
	let stateRootOverride: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--limit") {
			const value = args[i + 1];
			const parsed = Number.parseInt(value ?? "", 10);
			if (!Number.isFinite(parsed) || parsed < 0) {
				throw new Error(`--limit inválido: "${value}"`);
			}
			limit = parsed;
			i++;
			continue;
		}
		if (arg === "--state-root") {
			const value = args[i + 1];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error("--state-root requiere un valor");
			}
			stateRootOverride = value;
			i++;
			continue;
		}
		throw new Error(
			`Flag desconocido para idu-supervisor-responses: ${arg}`,
		);
	}
	return {
		options: limit !== undefined ? { limit } : {},
		...(stateRootOverride !== undefined ? { stateRootOverride } : {}),
	};
}