import { NAN_BASE_URL } from "../src/nan-auth.js";
import type { BenchmarkModelSpec } from "./types.js";

export { NAN_BASE_URL };

/**
 * The 9 requested Nan provider models in canonical reporting order.
 * Verified live against https://api.nan.builders/v1/models.
 */
export const BENCHMARK_MODELS: BenchmarkModelSpec[] = [
	{
		id: "deepseek-v4-flash",
		displayName: "DeepSeek V4.1 Flash 1017",
		providerModelId: "deepseek-v4-flash",
		pricePer1M: null,
	},
	{
		id: "hy4",
		displayName: "HYL",
		providerModelId: "hy4",
		pricePer1M: null,
	},
	{
		id: "deepseek-v4-pro",
		displayName: "DeepSeek V4 Pro",
		providerModelId: "deepseek-v4-pro",
		pricePer1M: null,
	},
	{
		id: "kimi-k3.1-pro",
		displayName: "Kimi K3.1 Pro",
		providerModelId: "kimi-k3.1-pro",
		pricePer1M: null,
	},
	{
		id: "glm5.3",
		displayName: "GLM-5.3",
		providerModelId: "glm5.3",
		pricePer1M: null,
	},
	{
		id: "glm5.3-flash",
		displayName: "GLM-5.3-Flash",
		providerModelId: "glm5.3-flash",
		pricePer1M: null,
	},
	{
		id: "mimo-v2.6-flash",
		displayName: "MiMo-V2.6-Flash",
		providerModelId: "mimo-v2.6-flash",
		pricePer1M: null,
	},
	{
		id: "qwen3.8-flash",
		displayName: "Qwen3.8 Flash",
		providerModelId: "qwen3.8-flash",
		pricePer1M: null,
	},
	{
		id: "qwen3.8-max",
		displayName: "Qwen 3.8 Max",
		providerModelId: "qwen3.8-max",
		pricePer1M: null,
	},
];

/**
 * All 10 IDU-PI terminal harnesses evaluated during capability probing.
 * Controlled benchmark runs exclude harnesses whose backend protocol is incompatible
 * with Nan (/v1/chat/completions or /v1/responses), recording them transparently as
 * `unsupported` in capability reports.
 */
export const ALL_HARNESSES = [
	"opencode",
	"pi",
	"gentle-shell",
	"commandcode",
	"mcode",
	"qwen",
	"codex",
	"kimi",
	"claude",
	"antigravity",
] as const;

export type HarnessId = (typeof ALL_HARNESSES)[number];

export interface PricingSchedule {
	[modelId: string]: {
		input: number;
		output: number;
		cachedInput?: number;
	};
}

export function estimateCostFromPricing(
	modelId: string,
	tokens: {
		inputTokens: number | null;
		outputTokens: number | null;
		cacheReadTokens: number | null;
	},
	pricing?: PricingSchedule,
): number | null {
	const table = pricing?.[modelId] ?? BENCHMARK_MODELS.find((m) => m.id === modelId)?.pricePer1M;
	if (!table) return null;
	if (tokens.inputTokens === null || tokens.outputTokens === null) return null;

	const cached = Math.max(0, Math.min(tokens.cacheReadTokens ?? 0, tokens.inputTokens));
	const uncachedIn = Math.max(0, tokens.inputTokens - cached);
	const cachedRate = table.cachedInput ?? table.input;
	const usd =
		(uncachedIn * table.input + cached * cachedRate + tokens.outputTokens * table.output) /
		1_000_000;
	return Number(usd.toFixed(8));
}
