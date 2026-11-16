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
	inputTokens: ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "inputTokensUsed", "input"],
	outputTokens: ["output_tokens", "outputTokens", "completion_tokens", "completionTokens", "outputTokensUsed", "output"],
	reasoningTokens: [
		"reasoning_tokens",
		"reasoningTokens",
		"thinking_tokens",
		"thinkingTokens",
		"reasoning_output_tokens",
		"reasoning",
	],
	cacheReadTokens: [
		"cache_read_tokens",
		"cacheReadTokens",
		"cached_input_tokens",
		"cachedInputTokens",
		"cache_read_input_tokens",
		"cacheRead",
		"cached",
	],
	cacheWriteTokens: ["cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens", "cacheWrite"],
	totalTokens: ["total_tokens", "totalTokens", "totalTokensUsed", "total"],
};

const COST_ALIASES = ["cost_usd", "costUsd", "total_cost_usd", "totalCostUsd", "cost"];
const NESTED_CONTAINER_KEYS = ["data", "event", "result", "message", "response", "turn", "part"];

interface UsageSample {
	tokens: Partial<TokenUsage>;
	reportedCostUsd: number | null;
}

function emptyTokens(): TokenUsage {
	return {
		inputTokens: null,
		outputTokens: null,
		reasoningTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		totalTokens: null,
	};
}

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

	// OpenCode emits cache: { read, write } inside part.tokens.
	const cacheObj = asRecord(source.cache);
	if (cacheObj) {
		if (out.cacheReadTokens === undefined) {
			const read = firstNumber(cacheObj, ["read"]);
			if (read !== null) out.cacheReadTokens = read;
		}
		if (out.cacheWriteTokens === undefined) {
			const write = firstNumber(cacheObj, ["write"]);
			if (write !== null) out.cacheWriteTokens = write;
		}
	}

	// OpenAI Responses & Chat Completions place cached / reasoning inside *_details.
	if (out.cacheReadTokens === undefined) {
		const inDetails = asRecord(source.input_tokens_details) ?? asRecord(source.prompt_tokens_details);
		if (inDetails) {
			const cached = firstNumber(inDetails, ["cached_tokens", "cachedTokens"]);
			if (cached !== null) out.cacheReadTokens = cached;
		}
	}
	if (out.reasoningTokens === undefined) {
		const outDetails = asRecord(source.output_tokens_details) ?? asRecord(source.completion_tokens_details);
		if (outDetails) {
			const reasoning = firstNumber(outDetails, ["reasoning_tokens", "reasoningTokens"]);
			if (reasoning !== null) out.reasoningTokens = reasoning;
		}
	}

	return out;
}

function readCostFromSource(source: UsageSource | null | undefined): number | null {
	if (!source) return null;
	const direct = firstNumber(source, COST_ALIASES);
	if (direct !== null) return direct;

	// Pi emits usage.cost = { input, output, ..., total, totalFromProvider }.
	// When totalFromProvider === false — or on Pi's zero-initialized struct on
	// pending/retry frames lacking totalFromProvider: true — total is 0 even
	// though provider cost is unknown.
	const costObj = asRecord(source.cost);
	if (costObj) {
		if (costObj.totalFromProvider === false) return null;
		const total = firstNumber(costObj, ["total", "total_usd", "usd"]);
		if (total !== null) {
			if (total === 0 && costObj.totalFromProvider !== true && "cacheRead" in costObj) {
				return null;
			}
			return total;
		}
	}
	return null;
}

function buildSample(usageSource: UsageSource | null | undefined, outerSource?: UsageSource | null): UsageSample | null {
	if (!usageSource && !outerSource) return null;
	const tokens = usageSource ? readTokenFields(usageSource) : {};
	const cost = readCostFromSource(usageSource) ?? readCostFromSource(outerSource);
	if (Object.keys(tokens).length === 0 && cost === null) return null;
	return { tokens, reportedCostUsd: cost };
}

function hasAnyToken(sample: UsageSample | null): sample is UsageSample {
	return sample !== null && Object.keys(sample.tokens).length > 0;
}

/**
 * Walks an unknown payload for generic `{ usage }` objects as fallback when no
 * known harness stream event type matches.
 */
function collectGenericCandidates(payload: unknown, depth: number, found: UsageSource[]): void {
	if (depth > 8 || found.length > 64) return;

	if (Array.isArray(payload)) {
		for (const item of payload) collectGenericCandidates(item, depth + 1, found);
		return;
	}

	const record = asRecord(payload);
	if (!record) return;

	const usage = asRecord(record.usage);
	if (usage) found.push(usage);

	for (const key of NESTED_CONTAINER_KEYS) {
		if (key in record) collectGenericCandidates(record[key], depth + 1, found);
	}
}

interface EventBuckets {
	terminalSnapshots: UsageSample[];
	stepDeltas: UsageSample[];
	piMessageFallbacks: UsageSample[];
	genericFallbacks: UsageSample[];
	seenAssistantIndices: Map<string, number>;
}

function classifyEvent(record: UsageSource, buckets: EventBuckets): void {
	const type = typeof record.type === "string" ? record.type : "";
	const eventName = typeof record.event === "string" ? record.event : "";

	// 1. Terminal cumulative snapshots (last writer wins over per-step deltas).
	if (type === "result" || eventName === "result") {
		const sample = buildSample(asRecord(record.usage) ?? asRecord(record.stats), record);
		if (hasAnyToken(sample)) {
			buckets.terminalSnapshots.push(sample);
			return;
		}
	}

	if (type === "exec.completed" || type === "exec.result") {
		const resultObj = asRecord(record.result);
		const sample = buildSample(asRecord(resultObj?.usage) ?? asRecord(record.usage), resultObj ?? record);
		if (hasAnyToken(sample)) {
			buckets.terminalSnapshots.push(sample);
			return;
		}
		// mcode sometimes leaves exec.completed.result.usage as {}; let turn.completed win.
		if (resultObj || "usage" in record) return;
	}

	// 2. Events to skip explicitly so Pi / streaming wrappers never double-count.
	if (type === "message_start" || type === "message_update" || type === "agent_end") {
		return;
	}

	// 3. Per-step delta emitters.
	if (type === "step_finish") {
		const part = asRecord(record.part);
		const sample = buildSample(asRecord(part?.tokens) ?? asRecord(record.usage), part ?? record);
		if (sample) buckets.stepDeltas.push(sample);
		return;
	}

	if (type === "turn_end" || type === "message_end") {
		const msg = asRecord(record.message);
		if (msg && msg.role !== "user" && msg.role !== "toolResult") {
			const sample = buildSample(asRecord(msg.usage), msg);
			if (sample) {
				if (type === "turn_end") buckets.stepDeltas.push(sample);
				else buckets.piMessageFallbacks.push(sample);
			}
		}
		return;
	}

	if (type === "event") {
		const inner = asRecord(record.event);
		if (inner?.type === "turn_end") {
			const msg = asRecord(inner.message);
			const sample = buildSample(asRecord(msg?.usage) ?? asRecord(inner.usage), inner);
			if (sample) buckets.stepDeltas.push(sample);
			return;
		}
	}

	if (type === "turn.completed" || type === "step_update") {
		const sample = buildSample(asRecord(record.usage), record);
		if (sample) buckets.stepDeltas.push(sample);
		return;
	}

	if (type === "assistant") {
		const msg = asRecord(record.message);
		const msgId = typeof msg?.id === "string" ? msg.id : "";
		const sample = buildSample(asRecord(msg?.usage) ?? asRecord(record.usage), record);
		if (!sample) return;
		if (msgId) {
			const existingIdx = buckets.seenAssistantIndices.get(msgId);
			if (existingIdx !== undefined) {
				// Replace partial streaming chunk for the same message ID once richer tokens arrive.
				if (hasAnyToken(sample)) {
					buckets.stepDeltas[existingIdx] = sample;
				}
				return;
			}
			if (hasAnyToken(sample)) {
				buckets.seenAssistantIndices.set(msgId, buckets.stepDeltas.length);
			}
		}
		buckets.stepDeltas.push(sample);
		return;
	}

	// 4. Generic fallback for unknown harnesses or synthetic fixtures.
	const found: UsageSource[] = [];
	collectGenericCandidates(record, 0, found);
	for (const usage of found) {
		const sample = buildSample(usage, null);
		if (sample) buckets.genericFallbacks.push(sample);
	}
}

function sumSamples(samples: UsageSample[]): { tokens: TokenUsage; reportedCostUsd: number | null } {
	const tokens = emptyTokens();
	let cost: number | null = null;
	for (const sample of samples) {
		for (const field of Object.keys(ALIASES) as Array<keyof TokenUsage>) {
			const val = sample.tokens[field];
			if (typeof val === "number") {
				tokens[field] = (tokens[field] ?? 0) + val;
			}
		}
		if (sample.reportedCostUsd !== null) {
			cost = (cost ?? 0) + sample.reportedCostUsd;
		}
	}
	return { tokens, reportedCostUsd: cost };
}

function mergeLastWins(samples: UsageSample[]): { tokens: TokenUsage; reportedCostUsd: number | null } {
	const tokens = emptyTokens();
	let cost: number | null = null;
	for (const sample of samples) {
		for (const field of Object.keys(ALIASES) as Array<keyof TokenUsage>) {
			const val = sample.tokens[field];
			if (typeof val === "number") tokens[field] = val;
		}
		if (sample.reportedCostUsd !== null) cost = sample.reportedCostUsd;
	}
	return { tokens, reportedCostUsd: cost };
}

export function extractUsage(stdout: string, harness = ""): UsageReport {
	const empty = emptyTokens();

	if (!stdout) {
		return { harness, tokens: empty, reportedCostUsd: null, captured: false, incomplete: true };
	}

	const buckets: EventBuckets = {
		terminalSnapshots: [],
		stepDeltas: [],
		piMessageFallbacks: [],
		genericFallbacks: [],
		seenAssistantIndices: new Map<string, number>(),
	};

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (
			!trimmed.startsWith("{") ||
			!(
				trimmed.includes("usage") ||
				trimmed.includes("tokens") ||
				trimmed.includes("Tokens") ||
				trimmed.includes("cost") ||
				trimmed.includes("stats")
			)
		) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed);
			const record = asRecord(parsed);
			if (record) classifyEvent(record, buckets);
		} catch {
			// A malformed line is not a reason to abandon the rest of the log.
		}
	}

	let aggregated: { tokens: TokenUsage; reportedCostUsd: number | null } | null = null;
	if (buckets.terminalSnapshots.length > 0) {
		aggregated = mergeLastWins(buckets.terminalSnapshots);
	} else if (buckets.stepDeltas.length > 0) {
		aggregated = sumSamples(buckets.stepDeltas);
	} else if (buckets.piMessageFallbacks.length > 0) {
		aggregated = sumSamples(buckets.piMessageFallbacks);
	} else if (buckets.genericFallbacks.length > 0) {
		aggregated = mergeLastWins(buckets.genericFallbacks);
	}

	if (!aggregated) {
		return { harness, tokens: empty, reportedCostUsd: null, captured: false, incomplete: true };
	}

	const { tokens, reportedCostUsd } = aggregated;
	const reportedBeforeSynth = Object.values(tokens).filter((v) => v !== null).length;
	if (reportedBeforeSynth === 0 && reportedCostUsd === null) {
		return { harness, tokens: empty, reportedCostUsd: null, captured: false, incomplete: true };
	}

	// Only synthesise a total when the harness gave us input and output. Reasoning
	// is already included inside output tokens across providers, so never double-add it.
	if (tokens.totalTokens === null && tokens.inputTokens !== null && tokens.outputTokens !== null) {
		tokens.totalTokens = tokens.inputTokens + tokens.outputTokens;
	}

	const reportedFields = Object.values(tokens).filter((v) => v !== null).length;
	const incomplete = reportedFields < Object.keys(ALIASES).length;

	return {
		harness,
		tokens,
		reportedCostUsd,
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
