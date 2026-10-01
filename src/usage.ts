import type { TokenUsage, UsageReport } from "./types.js";

/**
 * Normalises token usage out of a worker log.
 *
 * Every harness reports usage its own way, and none of them agree:
 *
 *   antigravity: {"usage":{"input_tokens":N,"output_tokens":N,"thinking_tokens":N}}
 *   commandcode: {"usage":{"inputTokens":N,"outputTokens":N,"cacheReadTokens":N}}
 *   codex:       {"usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N}}
 *   opencode:    cost lives in the Console API, not in the run output
 *
 * So this reads defensively: it looks for whichever spelling is present, and
 * leaves the rest null. A null field means "this harness never told us", and
 * it must never be treated as zero.
 */

interface UsageSource {
	[key: string]: unknown;
}

const ALIASES: Record<keyof TokenUsage, string[]> = {
	inputTokens: ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "inputTokensUsed"],
	outputTokens: ["output_tokens", "outputTokens", "completion_tokens", "completionTokens", "outputTokensUsed"],
	reasoningTokens: [
		"reasoning_tokens",
		"reasoningTokens",
		"thinking_tokens",
		"thinkingTokens",
		"reasoning_output_tokens",
	],
	cacheReadTokens: [
		"cache_read_tokens",
		"cacheReadTokens",
		"cached_input_tokens",
		"cachedInputTokens",
		"cache_read_input_tokens",
	],
	cacheWriteTokens: ["cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens"],
	totalTokens: ["total_tokens", "totalTokens", "totalTokensUsed"],
};

const COST_ALIASES = ["cost_usd", "costUsd", "total_cost_usd", "totalCostUsd", "cost"];

function asRecord(value: unknown): UsageSource | null {
	if (value && typeof value === "object" && !Array.isArray(value)) return value as UsageSource;
	return null;
}

function firstNumber(source: UsageSource, keys: string[]): number | null {
	for (const key of keys) {
		const raw = source[key];
		if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	}
	return null;
}

function readTokenFields(source: UsageSource): Partial<TokenUsage> {
	const out: Partial<TokenUsage> = {};
	for (const [field, keys] of Object.entries(ALIASES) as Array<[keyof TokenUsage, string[]]>) {
		const value = firstNumber(source, keys);
		if (value !== null) out[field] = value;
	}
	return out;
}

/**
 * Walks the raw log for any object that carries a usage payload, and merges
 * what it finds. Last writer wins per field, which suits a run that emits one
 * terminal usage event. Summing instead would double-count a harness that
 * reports a running total on every turn.
 */
function collectCandidates(payload: unknown, depth: number, found: UsageSource[]): void {
	if (depth > 8 || found.length > 64) return;

	if (Array.isArray(payload)) {
		for (const item of payload) collectCandidates(item, depth + 1, found);
		return;
	}

	const record = asRecord(payload);
	if (!record) return;

	const usage = asRecord(record.usage);
	if (usage) found.push(usage);

	// Codex and friends nest the payload one level down under a data/event key.
	for (const key of ["data", "event", "result", "message", "response", "turn"]) {
		if (key in record) collectCandidates(record[key], depth + 1, found);
	}
}

export function extractUsage(stdout: string, harness = ""): UsageReport {
	const empty: TokenUsage = {
		inputTokens: null,
		outputTokens: null,
		reasoningTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		totalTokens: null,
	};

	if (!stdout) {
		return { harness, tokens: empty, reportedCostUsd: null, captured: false, incomplete: true };
	}

	const found: UsageSource[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{") || !trimmed.includes("usage")) continue;
		try {
			collectCandidates(JSON.parse(trimmed), 0, found);
		} catch {
			// A malformed line is not a reason to abandon the rest of the log.
		}
	}

	if (found.length === 0) {
		return { harness, tokens: empty, reportedCostUsd: null, captured: false, incomplete: true };
	}

	const merged: UsageSource = {};
	let cost: number | null = null;
	for (const usage of found) {
		Object.assign(merged, usage);
		const c = firstNumber(usage, COST_ALIASES);
		if (c !== null) cost = c;
	}

	const tokens: TokenUsage = { ...empty, ...readTokenFields(merged) } as TokenUsage;

	// Only synthesise a total when the harness gave us the parts. Never guess it
	// from a subset, because a missing field would then read as zero.
	if (tokens.totalTokens === null && tokens.inputTokens !== null && tokens.outputTokens !== null) {
		let sum = tokens.inputTokens + tokens.outputTokens;
		if (tokens.reasoningTokens !== null) sum += tokens.reasoningTokens;
		tokens.totalTokens = sum;
	}

	const reportedFields = Object.values(tokens).filter((v) => v !== null).length;
	const incomplete = reportedFields < Object.keys(ALIASES).length;

	return {
		harness,
		tokens,
		reportedCostUsd: cost,
		captured: true,
		incomplete,
	};
}

/** One-line, honest rendering. Says "not reported" rather than implying zero. */
export function formatUsage(usage: UsageReport | undefined): string {
	if (!usage || !usage.captured) {
		return `usage: not reported by ${usage?.harness || "this harness"}`;
	}
	const t = usage.tokens;
	const n = (v: number | null) => (v === null ? "?" : String(v));
	const parts = [`in ${n(t.inputTokens)}`, `out ${n(t.outputTokens)}`];
	if (t.reasoningTokens !== null) parts.push(`reasoning ${t.reasoningTokens}`);
	if (t.cacheReadTokens !== null) parts.push(`cache-read ${t.cacheReadTokens}`);
	parts.push(`total ${n(t.totalTokens)}`);
	const cost = usage.reportedCostUsd === null ? "cost not reported" : `$${usage.reportedCostUsd.toFixed(4)}`;
	return `usage (${usage.harness}): ${parts.join(", ")}, ${cost}`;
}
