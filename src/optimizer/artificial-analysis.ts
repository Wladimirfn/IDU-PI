import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getIduHome } from "../config.js";
import { writeJsonAtomic } from "../json-file.js";
import type { AaMatchResult, AaModelMetrics } from "./types.js";

export const AA_V2_MODELS_URL = "https://artificialanalysis.ai/api/v2/language/models";
export const AA_LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models";
export const AA_MODELS_URL = "https://artificialanalysis.ai/models";
export const AA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export interface AaCatalogResult {
	models: AaModelMetrics[];
	source: "aa-v2-api" | "aa-ssr-catalog" | "cached" | "unavailable";
	fetchedAt: string | null;
	warning?: string;
}

export interface FetchAaCatalogOptions {
	fresh?: boolean;
	apiKey?: string;
	cachePath?: string;
	ttlMs?: number;
	fetchImpl?: typeof fetch;
	now?: number;
}

interface AaCacheFile {
	fetchedAt: string;
	source: "aa-v2-api" | "aa-ssr-catalog";
	models: AaModelMetrics[];
}

function asFiniteNumber(val: unknown): number | null {
	return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function computeBlendedPrice(inUsd: number | null, outUsd: number | null, explicit?: unknown): number | null {
	const direct = asFiniteNumber(explicit);
	if (direct !== null) return direct;
	if (inUsd === null && outUsd === null) return null;
	const i = inUsd ?? outUsd ?? 0;
	const o = outUsd ?? inUsd ?? 0;
	return Number(((3 * i + o) / 4).toFixed(4));
}

function meanDefined(values: Array<number | null | undefined>): number | null {
	const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
	if (nums.length === 0) return null;
	return nums.reduce((acc, v) => acc + v, 0) / nums.length;
}

function normalizeCodingScore(obj: Record<string, unknown>, scores?: Record<string, unknown>): number | null {
	const s = scores ?? {};
	const candidates = [
		asFiniteNumber(obj.codingIndex),
		asFiniteNumber(obj.frontierCode20),
		asFiniteNumber(obj.frontierCode),
		asFiniteNumber(obj.terminalBench40),
		asFiniteNumber(obj.livecodebench),
		asFiniteNumber(s["frontiercode-2-0"]),
		asFiniteNumber(s["frontiercode"]),
		asFiniteNumber(s["terminalbench-4-0"]),
		asFiniteNumber(s["terminalbench-2-1"]),
		asFiniteNumber(s["livecodebench"]),
	].filter((v): v is number => v !== null);
	if (candidates.length === 0) return null;
	// Sub-benchmarks in AA SSR scores are 0..1 fractions; API v2 coding_index can be 0..100.
	const normalized = candidates.map((v) => (v <= 1.2 ? v * 100 : v));
	return Number((normalized.reduce((a, b) => a + b, 0) / normalized.length).toFixed(2));
}

function normalizeVisual3dScore(obj: Record<string, unknown>, scores?: Record<string, unknown>): number | null {
	const s = scores ?? {};
	const avg = meanDefined([
		asFiniteNumber(obj.aa3dElo),
		asFiniteNumber(obj.code2videoElo),
		asFiniteNumber(s["aa-3d"]),
		asFiniteNumber(s["code2video-aa"]),
	]);
	return avg === null ? null : Number(avg.toFixed(2));
}

/**
 * Extracts escaped JSON objects embedded inside Next.js `self.__next_f.push` RSC
 * scripts on Artificial Analysis public pages. Keeps extraction bounded and safe.
 */
function extractRscJsonObjects(html: string, anchorField: string): Array<Record<string, unknown>> {
	const escapedAnchor = `\\"${anchorField}\\":`;
	const plainAnchor = `"${anchorField}":`;
	const useEscaped = html.includes(escapedAnchor);
	const needle = useEscaped ? escapedAnchor : plainAnchor;
	if (!html.includes(needle)) return [];

	const results: Array<Record<string, unknown>> = [];
	const seenRanges = new Set<number>();
	let idx = 0;
	while ((idx = html.indexOf(needle, idx)) !== -1) {
		let depth = 0;
		let start = -1;
		for (let i = idx; i >= 0; i--) {
			const ch = html[i];
			if (ch === "}") depth++;
			else if (ch === "{") {
				if (depth === 0) {
					start = i;
					break;
				}
				depth--;
			}
		}
		if (start !== -1 && !seenRanges.has(start)) {
			seenRanges.add(start);
			depth = 0;
			let end = -1;
			for (let i = start; i < html.length; i++) {
				const ch = html[i];
				if (ch === "{") depth++;
				else if (ch === "}") {
					depth--;
					if (depth === 0) {
						end = i + 1;
						break;
					}
				}
			}
			if (end > start) {
				try {
					const rawSlice = html.slice(start, end);
					const unescaped = useEscaped ? rawSlice.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : rawSlice;
					const obj = JSON.parse(unescaped);
					if (obj && typeof obj === "object" && !Array.isArray(obj)) {
						results.push(obj as Record<string, unknown>);
					}
				} catch {
					// Skip malformed/partial object slices cleanly.
				}
			}
		}
		idx += needle.length;
	}
	return results;
}

export function parseAaLeaderboardHtml(html: string): AaModelMetrics[] {
	const byKey = new Map<string, AaModelMetrics>();
	for (const obj of extractRscJsonObjects(html, "outputSpeed")) {
		const name = typeof obj.name === "string" ? obj.name.trim() : "";
		if (!name) continue;
		const id = typeof obj.slug === "string" && obj.slug ? obj.slug : typeof obj.id === "string" && obj.id ? obj.id : slugifyModelName(name);
		const scores = obj.scores && typeof obj.scores === "object" ? (obj.scores as Record<string, unknown>) : undefined;
		const inPrice = asFiniteNumber(obj.price1mInputTokens);
		const outPrice = asFiniteNumber(obj.price1mOutputTokens);
		const metric: AaModelMetrics = {
			id,
			name,
			creator: typeof obj.modelCreatorName === "string" ? obj.modelCreatorName : undefined,
			intelligenceIndex: asFiniteNumber(obj.intelligenceIndex),
			codingScore: normalizeCodingScore(obj, scores),
			visual3dScore: normalizeVisual3dScore(obj, scores),
			outputSpeedTokPerSec: asFiniteNumber(obj.outputSpeed),
			ttftSeconds: asFiniteNumber(obj.timeToFirstToken),
			timePerTaskSeconds: asFiniteNumber(obj.intelligenceIndexTimePerTask),
			price1mInputUsd: inPrice,
			price1mOutputUsd: outPrice,
			price1mBlendedUsd: computeBlendedPrice(inPrice, outPrice, obj.price1mBlended0To3To1),
			contextWindowTokens: asFiniteNumber(obj.contextWindowTokens),
			isReasoning: typeof obj.isReasoning === "boolean" ? obj.isReasoning : undefined,
			source: "aa-ssr-catalog",
		};
		byKey.set(slugifyModelName(name), metric);
	}
	return [...byKey.values()];
}

export function parseAaV2ApiPayload(payload: unknown): AaModelMetrics[] {
	const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
	const rows = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
	const models: AaModelMetrics[] = [];
	for (const raw of rows) {
		if (!raw || typeof raw !== "object") continue;
		const item = raw as Record<string, unknown>;
		const name = typeof item.name === "string" ? item.name.trim() : "";
		const slug = typeof item.slug === "string" ? item.slug.trim() : typeof item.id === "string" ? item.id.trim() : "";
		if (!name && !slug) continue;
		const evals = item.evaluations && typeof item.evaluations === "object" ? (item.evaluations as Record<string, unknown>) : {};
		const pricing = item.pricing && typeof item.pricing === "object" ? (item.pricing as Record<string, unknown>) : {};
		const creator = item.model_creator && typeof item.model_creator === "object" ? (item.model_creator as Record<string, unknown>) : {};
		const inPrice = asFiniteNumber(pricing.price_1m_input_tokens ?? item.price_1m_input_tokens);
		const outPrice = asFiniteNumber(pricing.price_1m_output_tokens ?? item.price_1m_output_tokens);
		models.push({
			id: slug || slugifyModelName(name),
			name: name || slug,
			creator: typeof creator.name === "string" ? creator.name : undefined,
			intelligenceIndex: asFiniteNumber(evals.artificial_analysis_intelligence_index ?? item.intelligence_index),
			codingScore: asFiniteNumber(evals.artificial_analysis_coding_index ?? item.coding_index),
			visual3dScore: null,
			outputSpeedTokPerSec: asFiniteNumber(item.median_output_tokens_per_second),
			ttftSeconds: asFiniteNumber(item.median_time_to_first_token_seconds),
			timePerTaskSeconds: null,
			price1mInputUsd: inPrice,
			price1mOutputUsd: outPrice,
			price1mBlendedUsd: computeBlendedPrice(inPrice, outPrice, pricing.price_1m_blended_3_to_1),
			contextWindowTokens: asFiniteNumber(item.context_window_tokens),
			source: "aa-v2-api",
		});
	}
	return models;
}

async function fetchTextWithTimeout(url: string, headers: Record<string, string>, fetchImpl: typeof fetch, timeoutMs = 12_000): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(url, { headers, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchArtificialAnalysisCatalog(options: FetchAaCatalogOptions = {}): Promise<AaCatalogResult> {
	const now = options.now ?? Date.now();
	const ttlMs = options.ttlMs ?? AA_CACHE_TTL_MS;
	const cachePath = options.cachePath ?? join(getIduHome(), "cache", "aa-models.json");
	const fetchImpl = options.fetchImpl ?? fetch;

	let cached: AaCacheFile | null = null;
	if (existsSync(cachePath)) {
		try {
			cached = JSON.parse(readFileSync(cachePath, "utf8")) as AaCacheFile;
		} catch {
			cached = null;
		}
	}

	if (!options.fresh && cached?.fetchedAt && Array.isArray(cached.models) && cached.models.length > 0) {
		const age = now - new Date(cached.fetchedAt).getTime();
		if (Number.isFinite(age) && age >= 0 && age <= ttlMs) {
			return {
				models: cached.models.map((m) => ({ ...m, source: "cached" })),
				source: "cached",
				fetchedAt: cached.fetchedAt,
			};
		}
	}

	const apiKey = options.apiKey?.trim() || process.env.AA_API_KEY?.trim();
	if (apiKey) {
		try {
			const res = await fetchTextWithTimeout(
				AA_V2_MODELS_URL,
				{ "x-api-key": apiKey, Accept: "application/json" },
				fetchImpl,
			);
			if (res.ok) {
				const parsed = parseAaV2ApiPayload(await res.json());
				if (parsed.length > 0) {
					const fetchedAt = new Date(now).toISOString();
					mkdirSync(dirname(cachePath), { recursive: true });
					writeJsonAtomic(cachePath, { fetchedAt, source: "aa-v2-api", models: parsed });
					return { models: parsed, source: "aa-v2-api", fetchedAt };
				}
			}
		} catch {
			// Fall through cleanly to keyless SSR catalog.
		}
	}

	try {
		const res = await fetchTextWithTimeout(
			AA_LEADERBOARD_URL,
			{ "User-Agent": "Mozilla/5.0", Accept: "text/html,application/xhtml+xml" },
			fetchImpl,
		);
		if (res.ok) {
			const html = await res.text();
			const models = parseAaLeaderboardHtml(html);
			if (models.length > 0) {
				const fetchedAt = new Date(now).toISOString();
				mkdirSync(dirname(cachePath), { recursive: true });
				writeJsonAtomic(cachePath, { fetchedAt, source: "aa-ssr-catalog", models });
				return { models, source: "aa-ssr-catalog", fetchedAt };
			}
		}
	} catch (err) {
		if (cached?.models?.length) {
			return {
				models: cached.models.map((m) => ({ ...m, source: "cached" })),
				source: "cached",
				fetchedAt: cached.fetchedAt,
				warning: `Artificial Analysis network refresh failed (${err instanceof Error ? err.message : String(err)}); using stale cache from ${cached.fetchedAt}.`,
			};
		}
		return {
			models: [],
			source: "unavailable",
			fetchedAt: null,
			warning: `Artificial Analysis unavailable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	if (cached?.models?.length) {
		return {
			models: cached.models.map((m) => ({ ...m, source: "cached" })),
			source: "cached",
			fetchedAt: cached.fetchedAt,
			warning: `Artificial Analysis returned empty dataset; using cached models from ${cached.fetchedAt}.`,
		};
	}

	return {
		models: [],
		source: "unavailable",
		fetchedAt: null,
		warning: "Artificial Analysis catalog unavailable and no local cache found.",
	};
}

export function slugifyModelName(input: string): string {
	return input
		.toLowerCase()
		.replace(/^custom_provider:/, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const KNOWN_ALIASES: Record<string, string[]> = {
	opus: ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"],
	sonnet: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"],
	haiku: ["claude-haiku-5-5", "claude-haiku-4-5"],
	hy4: ["tencent-hy4", "hunyuan-4", "hy4"],
	"deepseek-v4-flash": ["deepseek-v4-1-flash-1017", "deepseek-v4-flash"],
	"deepseek-v4-pro": ["deepseek-v4-pro", "deepseek-v4-pro-0424"],
	"gemini-4-argon": ["gemini-4-argon", "gemini-4-carbon"],
	"gemini-4-hydrogen": ["gemini-4-hydrogen"],
	"gemini-3.8-flash": ["gemini-3-8-flash"],
};

export function normalizeModelKeyForAa(rawModelId: string): string {
	let s = rawModelId.trim().toLowerCase();
	s = s.replace(/^custom_provider:/, "");
	// Drop single or nested provider prefixes (e.g. `nan/kimi-k3.1-pro`, `alibaba-coding-plan/qwen3.5-plus`).
	if (s.includes("/")) {
		s = s.split("/").pop() ?? s;
	}
	// Strip runtime effort / pricing modifiers (`#high`, `:free`, `(max)`).
	s = s.replace(/#[a-z0-9-]+$/i, "").replace(/:[a-z0-9-]+$/i, "");
	s = s.replace(/\s*\([^)]*\)\s*/g, " ");
	s = s.replace(/-(?:high|xhigh|medium|low|fast|max|preview)$/i, "");
	return slugifyModelName(s);
}

function stripReasoningSuffixFromAaName(aaName: string): string {
	return slugifyModelName(aaName.replace(/\s*\([^)]*\)\s*$/g, ""));
}

/**
 * Matches a CLI/provider model ID against the Artificial Analysis catalog without
 * silently confusing unrelated sizes/tiers.
 */
export function matchAaModel(rawModelId: string, catalog: AaModelMetrics[]): AaMatchResult {
	const normalizedQuery = normalizeModelKeyForAa(rawModelId);
	if (!normalizedQuery || catalog.length === 0) {
		return { matched: null, confidence: "unmatched", normalizedQuery };
	}

	const preferredReasoning = /(high|xhigh|max|pro|opus|argon|carbon|hydrogen)/i.test(rawModelId);
	const pickBestVariant = (candidates: AaModelMetrics[]): AaModelMetrics => {
		if (candidates.length === 1) return candidates[0];
		return [...candidates].sort((a, b) => {
			if (preferredReasoning && Boolean(a.isReasoning) !== Boolean(b.isReasoning)) {
				return a.isReasoning ? -1 : 1;
			}
			const iqDiff = (b.intelligenceIndex ?? -1) - (a.intelligenceIndex ?? -1);
			if (Math.abs(iqDiff) > 0.01) return iqDiff;
			return (b.outputSpeedTokPerSec ?? -1) - (a.outputSpeedTokPerSec ?? -1);
		})[0];
	};

	const exactHits = catalog.filter(
		(m) => slugifyModelName(m.id) === normalizedQuery || slugifyModelName(m.name) === normalizedQuery,
	);
	if (exactHits.length > 0) {
		return { matched: pickBestVariant(exactHits), confidence: "exact", normalizedQuery };
	}

	const normHits = catalog.filter((m) => stripReasoningSuffixFromAaName(m.name) === normalizedQuery);
	if (normHits.length > 0) {
		return { matched: pickBestVariant(normHits), confidence: "normalized", normalizedQuery };
	}

	for (const [aliasKey, targets] of Object.entries(KNOWN_ALIASES)) {
		if (normalizedQuery === aliasKey || normalizedQuery.startsWith(`${aliasKey}-`)) {
			for (const t of targets) {
				const hit = catalog.filter((m) => stripReasoningSuffixFromAaName(m.name).startsWith(t) || slugifyModelName(m.id).startsWith(t));
				if (hit.length > 0) {
					return { matched: pickBestVariant(hit), confidence: "normalized", normalizedQuery };
				}
			}
		}
	}

	// Token overlap family fallback (requires >=2 shared non-trivial tokens or version token match).
	const qTokens = normalizedQuery.split("-").filter((t) => t.length >= 2);
	if (qTokens.length >= 2) {
		const familyMatches = catalog
			.map((m) => {
				const mTokens = new Set(stripReasoningSuffixFromAaName(m.name).split("-").filter((t) => t.length >= 2));
				const overlap = qTokens.filter((t) => mTokens.has(t)).length;
				const ratio = overlap / Math.max(qTokens.length, mTokens.size);
				return { m, overlap, ratio };
			})
			.filter((x) => x.overlap >= 2 && x.ratio >= 0.6)
			.sort((a, b) => b.ratio - a.ratio || (b.m.intelligenceIndex ?? -1) - (a.m.intelligenceIndex ?? -1));
		if (familyMatches.length > 0) {
			return { matched: familyMatches[0].m, confidence: "family", normalizedQuery };
		}
	}

	return { matched: null, confidence: "unmatched", normalizedQuery };
}
