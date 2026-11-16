import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkCliAvailable, unwrapCmdExecutable } from "../cmdline.js";
import { loadIduConfig, loadProfilesConfig } from "../config.js";
import { NAN_BASE_URL, resolveNanApiKey } from "../nan-auth.js";
import { readQuotaSnapshots } from "../quota.js";
import type { IduConfig, QuotaSnapshot } from "../types.js";
import type { BenchmarkRunRecord } from "../../bench/types.js";
import type {
	BillingModel,
	CliDiscoverySummary,
	DiscoveredModelCandidate,
	HistoricalBenchMetric,
	ProviderAuthSummary,
} from "./types.js";

export interface DiscoveryResult {
	clis: CliDiscoverySummary[];
	providers: ProviderAuthSummary[];
	quotas: QuotaSnapshot[];
	candidates: DiscoveredModelCandidate[];
	historicalMetrics: HistoricalBenchMetric[];
	warnings: string[];
}

export interface DiscoveryOptions {
	freshQuota?: boolean;
	skipLiveEndpoints?: boolean;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	benchResultsDir?: string;
	fetchImpl?: typeof fetch;
	readQuotaImpl?: typeof readQuotaSnapshots;
	execCliImpl?: (command: string, args: string[]) => string | null;
	checkCliImpl?: (command: string) => boolean;
}

const PLAN_PROVIDER_IDS = new Set([
	"openai-codex",
	"openai",
	"claude",
	"anthropic",
	"antigravity",
	"opencode-go",
	"alibaba-coding-plan",
	"zai-coding-plan",
	"kimi-for-coding",
	"kimi-coding",
	"kimi-code",
	"minimax",
	"minimax-coding-plan",
	"command-code",
	"commandcode",
	"commandcode-anth",
]);

const KNOWN_OPENAI_ENDPOINTS: Record<string, { url: string; authType: BillingModel; harnesses: string[] }> = {
	nan: {
		url: `${NAN_BASE_URL}/models`,
		authType: "api",
		harnesses: ["opencode", "pi", "gentle-shell", "commandcode", "mcode", "kimi", "qwen", "codex"],
	},
	openrouter: {
		url: "https://openrouter.ai/api/v1/models",
		authType: "api",
		harnesses: ["opencode", "pi"],
	},
	groq: {
		url: "https://api.groq.com/openai/v1/models",
		authType: "api",
		harnesses: ["pi"],
	},
	nvidia: {
		url: "https://integrate.api.nvidia.com/v1/models",
		authType: "api",
		harnesses: ["pi"],
	},
};

function stripJsonComments(input: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		const next = input[i + 1];
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			i++;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			i++;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < input.length && input[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		out += ch;
		i++;
	}
	return out.replace(/,\s*([}\]])/g, "$1");
}

function safeReadJson<T = Record<string, unknown>>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf8");
		return JSON.parse(stripJsonComments(raw)) as T;
	} catch {
		return null;
	}
}

function defaultExecCli(command: string, args: string[]): string | null {
	try {
		const unwrapped = unwrapCmdExecutable(command, args);
		return execFileSync(unwrapped.command, unwrapped.args, {
			encoding: "utf8",
			timeout: 8_000,
			windowsHide: true,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

async function fetchLiveEndpointModels(
	url: string,
	apiKey: string,
	fetchImpl: typeof fetch,
): Promise<{
	models: Array<{ id: string; contextWindow: number | null; inPer1M: number | null; outPer1M: number | null }>;
	error?: string;
}> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 4500);
	try {
		const res = await fetchImpl(url, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } : { Accept: "application/json" },
			signal: controller.signal,
		});
		if (!res.ok) {
			return { models: [], error: `HTTP ${res.status}` };
		}
		const payload = (await res.json()) as { data?: Array<Record<string, unknown>> };
		const rows = Array.isArray(payload?.data) ? payload.data : [];
		const models = rows
			.map((row) => {
				const id = typeof row.id === "string" ? row.id.trim() : "";
				if (!id) return null;
				const pricing = row.pricing && typeof row.pricing === "object" ? (row.pricing as Record<string, unknown>) : null;
				const inToken = pricing?.prompt !== undefined ? Number(pricing.prompt) : NaN;
				const outToken = pricing?.completion !== undefined ? Number(pricing.completion) : NaN;
				const maxIn = typeof row.max_input_tokens === "number" ? row.max_input_tokens : typeof row.context_length === "number" ? row.context_length : null;
				return {
					id,
					contextWindow: maxIn,
					inPer1M: Number.isFinite(inToken) ? Number((inToken * 1_000_000).toFixed(4)) : null,
					outPer1M: Number.isFinite(outToken) ? Number((outToken * 1_000_000).toFixed(4)) : null,
				};
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);
		return { models };
	} catch (err) {
		return { models: [], error: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
	}
}

function isAgentCapableModelId(modelId: string): boolean {
	return !/(?:embed|tts|whisper|moderation|audio|image-gen|safeguard|shield|guardrail|rerank|transcribe|realtime|:(?:batch|free-pool)$|\bstealth\/|\breflection\/)/i.test(
		modelId,
	);
}

function classifyBillingModel(provider: string): BillingModel {
	const norm = provider.trim().toLowerCase();
	if (PLAN_PROVIDER_IDS.has(norm) || /plan|subscription|oauth|coding/i.test(norm)) {
		return "plan";
	}
	return "api";
}

function extractSecretString(entry: unknown, env: NodeJS.ProcessEnv): string | null {
	if (typeof entry === "string" && entry.trim()) {
		if (entry.startsWith("env:") || /^\$\{?[A-Z0-9_]+\}?$/.test(entry)) {
			const envName = entry.replace(/^env:/, "").replace(/^\$\{?|\}?$/g, "");
			return env[envName]?.trim() || null;
		}
		return entry.trim();
	}
	if (entry && typeof entry === "object") {
		const rec = entry as Record<string, unknown>;
		for (const field of ["key", "apiKey", "token", "access", "api_key"]) {
			const val = rec[field];
			if (typeof val === "string" && val.trim()) {
				return extractSecretString(val, env);
			}
		}
	}
	return null;
}

function parseIniStyleModelIds(tomlText: string): Array<{ fullId: string; provider: string; modelId: string }> {
	const out: Array<{ fullId: string; provider: string; modelId: string }> = [];
	for (const match of tomlText.matchAll(/^\[models\."([^"]+)"\]/gm)) {
		const fullId = match[1].trim();
		const [provider, ...rest] = fullId.split("/");
		const modelId = rest.join("/") || fullId;
		out.push({ fullId, provider: rest.length > 0 ? provider : "kimi-code", modelId });
	}
	const defaultMatch = tomlText.match(/^\s*default_model\s*=\s*"([^"]+)"/m);
	if (defaultMatch?.[1]) {
		const fullId = defaultMatch[1].trim();
		if (!out.some((x) => x.fullId === fullId)) {
			const [provider, ...rest] = fullId.split("/");
			out.push({ fullId, provider: rest.length > 0 ? provider : "kimi-code", modelId: rest.join("/") || fullId });
		}
	}
	return out;
}

function parseMinimaxYamlModels(yamlText: string): Array<{ provider: string; modelId: string; displayName: string; contextWindow: number | null }> {
	const found: Array<{ provider: string; modelId: string; displayName: string; contextWindow: number | null }> = [];
	const defMatch = yamlText.match(/^defaultModel:\s*(.+)$/m);
	if (defMatch?.[1]) {
		const raw = defMatch[1].trim().replace(/^['"]|['"]$/g, "");
		if (raw && !raw.startsWith("custom_provider:")) {
			found.push({ provider: "minimax", modelId: raw, displayName: raw, contextWindow: null });
		}
	}
	const lines = yamlText.split(/\r?\n/);
	let currentSection = "";
	let inModels = false;
	for (const line of lines) {
		if (/^provider:\s*$/.test(line)) {
			currentSection = "minimax";
			inModels = false;
			continue;
		}
		if (/^custom_provider:\s*$/.test(line)) {
			currentSection = "custom";
			inModels = false;
			continue;
		}
		if (/^\s{4}models:\s*$/.test(line)) {
			inModels = true;
			continue;
		}
		if (inModels) {
			const mMatch = line.match(/^\s{6}([A-Za-z0-9._-]+):\s*$/);
			if (mMatch && currentSection === "minimax") {
				found.push({ provider: "minimax", modelId: mMatch[1], displayName: mMatch[1], contextWindow: null });
			}
			if (/^\S/.test(line)) {
				inModels = false;
			}
		}
	}
	return found;
}

function readHistoricalBenchmarkMetrics(resultsRoot: string): HistoricalBenchMetric[] {
	if (!existsSync(resultsRoot)) return [];
	const grouped = new Map<string, { batchId: string; records: BenchmarkRunRecord[] }>();
	let batchDirs: string[] = [];
	try {
		batchDirs = readdirSync(resultsRoot);
	} catch {
		return [];
	}
	for (const batch of batchDirs) {
		const runsFile = join(resultsRoot, batch, "runs.jsonl");
		if (!existsSync(runsFile)) continue;
		let raw = "";
		try {
			raw = readFileSync(runsFile, "utf8");
		} catch {
			continue;
		}
		for (const line of raw.split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const rec = JSON.parse(line) as BenchmarkRunRecord;
				if (!rec.supported) continue;
				const key = `${rec.harness}::${rec.model}::${rec.taskId}`;
				const bucket = grouped.get(key);
				if (!bucket) grouped.set(key, { batchId: rec.batchId || batch, records: [rec] });
				else bucket.records.push(rec);
			} catch {
				// Ignore malformed JSONL lines.
			}
		}
	}

	const metrics: HistoricalBenchMetric[] = [];
	for (const [, { batchId, records }] of grouped) {
		const sample = records[0];
		const n = records.length;
		const resolvedRate = records.filter((r) => r.resolved).length / n;
		const regressionsCleanRate = records.filter((r) => r.regressionsClean).length / n;
		const durations = records.map((r) => r.efficiency.durationMs).sort((a, b) => a - b);
		const medianDurationMs = durations[Math.floor(durations.length / 2)] ?? 0;
		const tokens = records.map((r) => r.efficiency.totalTokens).filter((v): v is number => typeof v === "number");
		const costs = records
			.map((r) => r.efficiency.estimatedCostUsd ?? r.efficiency.reportedCostUsd)
			.filter((v): v is number => typeof v === "number");
		metrics.push({
			harness: sample.harness,
			model: sample.model,
			taskId: sample.taskId,
			runs: n,
			resolvedRate,
			regressionsCleanRate,
			medianDurationMs,
			meanTokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
			meanCostUsd: costs.length ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)) : null,
			batchId,
		});
	}
	return metrics;
}

function summarizeCliQuota(harness: string, quotas: QuotaSnapshot[]): {
	planLabel: string | null;
	remainingPercent: number | null;
	quotaBilling: BillingModel | null;
	perModelAvailable: Record<string, boolean>;
} {
	const snap = quotas.find((q) => q.harness === harness || (harness === "antigravity" && q.source === "agy"));
	if (!snap) return { planLabel: null, remainingPercent: null, quotaBilling: null, perModelAvailable: {} };
	let minRemaining: number | null = null;
	const perModelAvailable: Record<string, boolean> = {};
	for (const meter of Object.values(snap.meters)) {
		for (const w of Object.values(meter.windows)) {
			if (typeof w.remainingPercent === "number") {
				minRemaining = minRemaining === null ? w.remainingPercent : Math.min(minRemaining, w.remainingPercent);
			}
		}
		if (meter.models) {
			for (const [mId, info] of Object.entries(meter.models)) {
				if (typeof info.available === "boolean") perModelAvailable[mId] = info.available;
			}
		}
	}
	const quotaBilling: BillingModel | null =
		snap.billingModel === "plan" || snap.billingModel === "subscription"
			? "plan"
			: snap.billingModel === "api"
				? "api"
				: null;
	return {
		planLabel: snap.plan,
		remainingPercent: minRemaining,
		quotaBilling,
		perModelAvailable,
	};
}

export async function discoverFleetCapabilities(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
	const home = options.homeDir ?? homedir();
	const env = options.env ?? process.env;
	const fetchImpl = options.fetchImpl ?? fetch;
	const readQuota = options.readQuotaImpl ?? readQuotaSnapshots;
	const execCli = options.execCliImpl ?? defaultExecCli;
	const checkCli = options.checkCliImpl ?? checkCliAvailable;
	const config: IduConfig = loadIduConfig();
	const { profiles } = loadProfilesConfig();
	const warnings: string[] = [];

	const cliAvail = new Map<string, { command: string; available: boolean }>();
	for (const [name, def] of Object.entries(config.clis)) {
		cliAvail.set(name, { command: def.command, available: checkCli(def.command) });
	}

	let quotas: QuotaSnapshot[] = [];
	try {
		quotas = await readQuota({ fresh: options.freshQuota === true });
	} catch (err) {
		warnings.push(`Could not read CLI quotas: ${err instanceof Error ? err.message : String(err)}`);
	}

	const providersMap = new Map<string, ProviderAuthSummary>();
	const keyMap = new Map<string, string>();
	const candidates: DiscoveredModelCandidate[] = [];
	const seenCandidates = new Set<string>();

	const addCandidate = (c: DiscoveredModelCandidate) => {
		if (!isAgentCapableModelId(c.modelId) || !isAgentCapableModelId(c.profileModel)) return;
		const k = `${c.harness}::${c.profileModel}`;
		if (seenCandidates.has(k)) return;
		seenCandidates.add(k);
		candidates.push(c);
	};

	const registerProvider = (p: ProviderAuthSummary, keyValue?: string | null) => {
		const existing = providersMap.get(p.provider);
		if (!existing) {
			providersMap.set(p.provider, p);
		} else {
			existing.harnessHints = [...new Set([...existing.harnessHints, ...p.harnessHints])];
		}
		if (keyValue && !keyMap.has(p.provider)) {
			keyMap.set(p.provider, keyValue);
		}
	};

	// 1. In-memory Nan key & local auth stores (keys are NEVER persisted or printed).
	const nanKey = resolveNanApiKey({ env, homeDir: home });
	if (nanKey) {
		registerProvider(
			{
				provider: "nan",
				harnessHints: ["pi", "gentle-shell", "opencode", "commandcode", "mcode", "kimi", "qwen", "codex"],
				authType: "api",
				source: "nan-auth",
				baseUrl: NAN_BASE_URL,
			},
			nanKey,
		);
	}

	const piAuth = safeReadJson<Record<string, unknown>>(join(home, ".pi", "agent", "auth.json"));
	if (piAuth) {
		for (const [prov, entry] of Object.entries(piAuth)) {
			const key = extractSecretString(entry, env);
			registerProvider(
				{
					provider: prov,
					harnessHints: ["pi", "gentle-shell"],
					authType: classifyBillingModel(prov),
					source: "~/.pi/agent/auth.json",
				},
				key,
			);
		}
	}

	const gsAuth = safeReadJson<Record<string, unknown>>(join(home, ".gentle-shell", "agent", "auth.json"));
	if (gsAuth) {
		for (const [prov, entry] of Object.entries(gsAuth)) {
			const key = extractSecretString(entry, env);
			registerProvider(
				{
					provider: prov,
					harnessHints: ["gentle-shell"],
					authType: classifyBillingModel(prov),
					source: "~/.gentle-shell/agent/auth.json",
				},
				key,
			);
		}
	}

	const cmdcAuth = safeReadJson<Record<string, unknown>>(join(home, ".commandcode", "auth.json"));
	const cmdcCfg = safeReadJson<Record<string, unknown>>(join(home, ".commandcode", "config.json"));
	const cmdcGlobalProvider = typeof cmdcCfg?.provider === "string" ? cmdcCfg.provider : "command-code";
	if (cmdcAuth) {
		for (const [k, v] of Object.entries(cmdcAuth)) {
			if (k === "userId" || k === "userName" || k === "keyName" || k === "authenticatedAt") continue;
			const provName = k === "apiKey" ? "command-code" : k;
			registerProvider(
				{
					provider: provName,
					harnessHints: ["commandcode"],
					authType: classifyBillingModel(provName),
					source: "~/.commandcode/auth.json",
				},
				extractSecretString(v, env),
			);
		}
	}

	const ocAuth = safeReadJson<Record<string, unknown>>(join(home, ".local", "share", "opencode", "auth.json"));
	const ocCfg =
		safeReadJson<Record<string, unknown>>(join(home, ".config", "opencode", "opencode.jsonc")) ??
		safeReadJson<Record<string, unknown>>(join(home, ".config", "opencode", "opencode.json"));
	const ocAuthedProviders = new Set<string>();
	if (ocAuth) {
		for (const [prov, v] of Object.entries(ocAuth)) {
			ocAuthedProviders.add(prov);
			registerProvider(
				{
					provider: prov,
					harnessHints: ["opencode"],
					authType: classifyBillingModel(prov),
					source: "~/.local/share/opencode/auth.json",
				},
				extractSecretString(v, env),
			);
		}
	}
	if (ocCfg && typeof ocCfg.provider === "object" && ocCfg.provider) {
		for (const prov of Object.keys(ocCfg.provider as Record<string, unknown>)) {
			ocAuthedProviders.add(prov);
		}
	}
	if (nanKey) ocAuthedProviders.add("nan");

	const codexAuth = safeReadJson<Record<string, unknown>>(join(home, ".codex", "auth.json"));
	if (codexAuth) {
		registerProvider({
			provider: "openai-codex",
			harnessHints: ["codex"],
			authType: codexAuth.auth_mode === "chatgpt" ? "plan" : "api",
			source: "~/.codex/auth.json",
		});
	}

	const claudeCreds = safeReadJson<Record<string, unknown>>(join(home, ".claude", ".credentials.json"));
	if (claudeCreds?.claudeAiOauth || existsSync(join(home, ".claude"))) {
		registerProvider({
			provider: "anthropic",
			harnessHints: ["claude"],
			authType: claudeCreds?.claudeAiOauth ? "plan" : "api",
			source: "~/.claude/.credentials.json",
		});
	}

	for (const [envKey, prov] of [
		["OPENROUTER_API_KEY", "openrouter"],
		["GROQ_API_KEY", "groq"],
		["NVIDIA_API_KEY", "nvidia"],
	] as const) {
		if (env[envKey]?.trim()) {
			registerProvider(
				{
					provider: prov,
					harnessHints: KNOWN_OPENAI_ENDPOINTS[prov]?.harnesses ?? ["pi"],
					authType: "api",
					source: `env:${envKey}`,
					baseUrl: KNOWN_OPENAI_ENDPOINTS[prov]?.url,
				},
				env[envKey]?.trim(),
			);
		}
	}

	// 2. Live OpenAI-compatible `/v1/models` queries (using keys strictly in memory).
	const liveModelsByProvider = new Map<string, Array<{ id: string; contextWindow: number | null; inPer1M: number | null; outPer1M: number | null }>>();
	if (!options.skipLiveEndpoints) {
		await Promise.all(
			Object.entries(KNOWN_OPENAI_ENDPOINTS).map(async ([prov, ep]) => {
				const key = keyMap.get(prov);
				if (!key) return;
				const summary = providersMap.get(prov);
				const live = await fetchLiveEndpointModels(ep.url, key, fetchImpl);
				if (summary) {
					summary.liveEndpointQueried = true;
					summary.baseUrl = ep.url;
					summary.liveModelCount = live.models.length;
					if (live.error) summary.discoveryNote = `Live endpoint error: ${live.error}`;
				}
				if (live.models.length > 0) {
					liveModelsByProvider.set(prov, live.models);
				}
			}),
		);
	}

	// Feed Nan live models into every Nan-compatible available harness.
	const nanModels = liveModelsByProvider.get("nan") ?? [];
	const fallbackNanIds = nanModels.length > 0
		? nanModels
		: ((safeReadJson<{ providers?: { nan?: { models?: Array<{ id: string; contextWindow?: number }> } } }>(
				join(home, ".pi", "agent", "models.json"),
			)?.providers?.nan?.models ?? []
		  ).map((m) => ({
				id: m.id,
				contextWindow: m.contextWindow ?? null,
				inPer1M: null,
				outPer1M: null,
			})));

	for (const m of fallbackNanIds) {
		const src = nanModels.length > 0 ? "live-endpoint" : "local-config";
		if (cliAvail.get("pi")?.available) {
			addCandidate({
				harness: "pi",
				provider: "nan",
				modelId: m.id,
				profileModel: m.id,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("gentle-shell")?.available) {
			addCandidate({
				harness: "gentle-shell",
				provider: "nan",
				modelId: m.id,
				profileModel: m.id,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("opencode")?.available && ocAuthedProviders.has("nan")) {
			addCandidate({
				harness: "opencode",
				provider: "nan",
				modelId: m.id,
				profileModel: `nan/${m.id}`,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("commandcode")?.available) {
			addCandidate({
				harness: "commandcode",
				provider: "nan",
				modelId: m.id,
				profileModel: `nan/${m.id}`,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("mcode")?.available) {
			addCandidate({
				harness: "mcode",
				provider: "nan",
				modelId: m.id,
				profileModel: `custom_provider:nan/${m.id}`,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("kimi")?.available) {
			addCandidate({
				harness: "kimi",
				provider: "nan",
				modelId: m.id,
				profileModel: `nan/${m.id}`,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("qwen")?.available) {
			addCandidate({
				harness: "qwen",
				provider: "nan",
				modelId: m.id,
				profileModel: m.id,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
		if (cliAvail.get("codex")?.available && nanKey) {
			addCandidate({
				harness: "codex",
				provider: "nan",
				modelId: m.id,
				profileModel: m.id,
				displayName: m.id,
				billingModel: "api",
				source: src,
				contextWindow: m.contextWindow,
				supportsToolCall: true,
			});
		}
	}

	// 3. OpenRouter / Groq / Nvidia live models on Pi (only if API key exists).
	for (const extraProv of ["openrouter", "groq", "nvidia"] as const) {
		const liveRows = liveModelsByProvider.get(extraProv) ?? [];
		if (liveRows.length > 0 && cliAvail.get("pi")?.available) {
			for (const row of liveRows) {
				addCandidate({
					harness: "pi",
					provider: extraProv,
					modelId: row.id,
					profileModel: row.id,
					displayName: row.id,
					billingModel: "api",
					source: "live-endpoint",
					contextWindow: row.contextWindow,
					inlinePricing:
						row.inPer1M !== null || row.outPer1M !== null ? { inputPer1M: row.inPer1M, outputPer1M: row.outPer1M } : undefined,
				});
			}
		}
	}

	// 4. Local Pi `models.json` configured providers (e.g. `commandcode` gateway models).
	const piModelsJson = safeReadJson<{
		providers?: Record<string, { baseUrl?: string; models?: Array<{ id: string; name?: string; contextWindow?: number; reasoning?: boolean; input?: string[]; cost?: { input?: number; output?: number } }> }>;
	}>(join(home, ".pi", "agent", "models.json"));
	if (piModelsJson?.providers) {
		for (const [prov, def] of Object.entries(piModelsJson.providers)) {
			if (prov === "nan" || !Array.isArray(def.models)) continue;
			const billing = classifyBillingModel(prov);
			for (const m of def.models) {
				if (cliAvail.get("pi")?.available && providersMap.has(prov)) {
					addCandidate({
						harness: "pi",
						provider: prov,
						modelId: m.id,
						profileModel: m.id,
						displayName: m.name ?? m.id,
						billingModel: billing,
						source: "local-config",
						contextWindow: m.contextWindow ?? null,
						reasoning: m.reasoning,
						inlinePricing: m.cost ? { inputPer1M: m.cost.input ?? null, outputPer1M: m.cost.output ?? null } : undefined,
					});
				}
				// Command Code gateway models when cmdc is authenticated on `command-code`.
				if (
					cliAvail.get("commandcode")?.available &&
					prov === "commandcode" &&
					cmdcGlobalProvider === "command-code" &&
					m.id.includes("/")
				) {
					addCandidate({
						harness: "commandcode",
						provider: "command-code",
						modelId: m.id,
						profileModel: m.id,
						displayName: m.name ?? m.id,
						billingModel: "plan",
						source: "local-config",
						contextWindow: m.contextWindow ?? null,
						reasoning: m.reasoning,
					});
				}
			}
		}
	}

	// 5. Command Code reasoningEffort models from `~/.commandcode/config.json`.
	if (cliAvail.get("commandcode")?.available && cmdcCfg?.reasoningEffort && typeof cmdcCfg.reasoningEffort === "object") {
		for (const mKey of Object.keys(cmdcCfg.reasoningEffort as Record<string, unknown>)) {
			const slashIdx = mKey.indexOf("/");
			const prov = slashIdx !== -1 ? mKey.slice(0, slashIdx) : "command-code";
			// Skip bare `gpt-*` OpenAI slugs when global cmdc provider is `command-code` (known 403 quirk).
			if (cmdcGlobalProvider === "command-code" && slashIdx === -1) continue;
			addCandidate({
				harness: "commandcode",
				provider: prov,
				modelId: slashIdx !== -1 ? mKey.slice(slashIdx + 1) : mKey,
				profileModel: mKey,
				displayName: mKey,
				billingModel: prov === "nan" ? "api" : "plan",
				source: "local-config",
				contextWindow: null,
			});
		}
	}

	// 6. OpenCode CLI live models (`opencode models`), filtered strictly to authenticated providers!
	if (cliAvail.get("opencode")?.available) {
		const ocOut = execCli(cliAvail.get("opencode")!.command, ["models"]);
		if (ocOut) {
			for (const line of ocOut.split(/\r?\n/)) {
				const full = line.trim();
				if (!full || !full.includes("/")) continue;
				const prov = full.slice(0, full.indexOf("/"));
				if (!ocAuthedProviders.has(prov)) continue;
				addCandidate({
					harness: "opencode",
					provider: prov,
					modelId: full.slice(full.indexOf("/") + 1),
					profileModel: full,
					displayName: full,
					billingModel: classifyBillingModel(prov),
					source: "cli-list",
					contextWindow: null,
					supportsToolCall: true,
				});
			}
		}
	}

	// 7. Antigravity CLI live models (`agy models`) + quota per model.
	if (cliAvail.get("antigravity")?.available) {
		const agyOut = execCli(cliAvail.get("antigravity")!.command, ["models"]);
		const agyQuota = summarizeCliQuota("antigravity", quotas);
		if (agyOut) {
			for (const line of agyOut.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || /^fetching /i.test(trimmed)) continue;
				const [idPart, labelPart] = trimmed.split("\t");
				const id = idPart?.trim();
				if (!id || id.includes(" ")) continue;
				addCandidate({
					harness: "antigravity",
					provider: "antigravity",
					modelId: id,
					profileModel: id,
					displayName: labelPart?.trim() || id,
					billingModel: "plan",
					source: "cli-list",
					contextWindow: null,
				});
			}
		} else if (Object.keys(agyQuota.perModelAvailable).length > 0) {
			for (const id of Object.keys(agyQuota.perModelAvailable)) {
				addCandidate({
					harness: "antigravity",
					provider: "antigravity",
					modelId: id,
					profileModel: id,
					displayName: id,
					billingModel: "plan",
					source: "quota",
					contextWindow: null,
				});
			}
		}
	}

	// 8. Claude Code (`opus`, `sonnet`, `haiku`).
	if (cliAvail.get("claude")?.available && providersMap.has("anthropic")) {
		const billing = providersMap.get("anthropic")!.authType;
		for (const id of ["opus", "sonnet", "haiku"]) {
			addCandidate({
				harness: "claude",
				provider: "anthropic",
				modelId: id,
				profileModel: id,
				displayName: `Claude ${id}`,
				billingModel: billing,
				source: "local-config",
				contextWindow: null,
			});
		}
	}

	// 9. Codex ChatGPT / OpenAI plan models (default from `.codex/config.toml` + quota/known OpenAI plan models).
	if (cliAvail.get("codex")?.available && providersMap.has("openai-codex")) {
		const codexCfgPath = join(home, ".codex", "config.toml");
		const codexCfg = existsSync(codexCfgPath) ? readFileSync(codexCfgPath, "utf8") : "";
		const modelMatch = codexCfg.match(/^\s*model\s*=\s*"([^"]+)"/m);
		const codexQuota = summarizeCliQuota("codex", quotas);
		const codexModelIds = new Set<string>(Object.keys(codexQuota.perModelAvailable));
		if (modelMatch?.[1]) codexModelIds.add(modelMatch[1]);
		if (codexModelIds.size === 0) {
			codexModelIds.add("gpt-6.1-terra");
			codexModelIds.add("gpt-6.1-sol");
		}
		for (const id of codexModelIds) {
			addCandidate({
				harness: "codex",
				provider: "openai-codex",
				modelId: id,
				profileModel: id,
				displayName: id,
				billingModel: providersMap.get("openai-codex")!.authType,
				source: codexQuota.perModelAvailable[id] !== undefined ? "quota" : "local-config",
				contextWindow: null,
			});
		}
	}

	// 10. MiniMax native config (`~/.minimax/config.yaml`) & Kimi native config (`~/.kimi-code/config.toml`).
	if (cliAvail.get("mcode")?.available && existsSync(join(home, ".minimax", "config.yaml"))) {
		const yamlText = readFileSync(join(home, ".minimax", "config.yaml"), "utf8");
		for (const m of parseMinimaxYamlModels(yamlText)) {
			// Skip known broken mcode native route `minimax-m3.1-flash`.
			if (/minimax-m3\.1-flash/i.test(m.modelId)) continue;
			addCandidate({
				harness: "mcode",
				provider: m.provider,
				modelId: m.modelId,
				profileModel: m.modelId,
				displayName: m.displayName,
				billingModel: "plan",
				source: "local-config",
				contextWindow: m.contextWindow,
			});
		}
	}
	if (cliAvail.get("kimi")?.available && existsSync(join(home, ".kimi-code", "config.toml"))) {
		const tomlText = readFileSync(join(home, ".kimi-code", "config.toml"), "utf8");
		for (const km of parseIniStyleModelIds(tomlText)) {
			addCandidate({
				harness: "kimi",
				provider: km.provider,
				modelId: km.modelId,
				profileModel: km.fullId,
				displayName: km.fullId,
				billingModel: km.provider === "nan" ? "api" : "plan",
				source: "local-config",
				contextWindow: null,
			});
		}
	}

	// 11. Seed currently configured profile combinations so incumbents always compete fairly!
	for (const prof of Object.values(profiles)) {
		if (!prof.model || !cliAvail.get(prof.harness)?.available) continue;
		const prov = prof.provider ?? (prof.model.includes("/") ? prof.model.split("/")[0] : prof.harness);
		const modelId = prof.model.replace(/^custom_provider:nan\//, "").replace(/^nan\//, "");
		addCandidate({
			harness: prof.harness,
			provider: prov,
			modelId,
			profileModel: prof.model,
			displayName: prof.model,
			billingModel: classifyBillingModel(prov),
			source: "local-config",
			contextWindow: null,
		});
	}

	// 12. Build per-CLI summaries.
	const clis: CliDiscoverySummary[] = [];
	for (const [harness, info] of cliAvail.entries()) {
		const qSummary = summarizeCliQuota(harness, quotas);
		const cliCandidates = candidates.filter((c) => c.harness === harness);
		const cliProviders = [...new Set(cliCandidates.map((c) => c.provider))];
		const billings = new Set(cliCandidates.map((c) => c.billingModel));
		const billingModel: CliDiscoverySummary["billingModel"] =
			billings.size > 1
				? "mixed"
				: billings.size === 1
					? ([...billings][0] as BillingModel)
					: qSummary.quotaBilling ?? "unknown";
		clis.push({
			harness,
			command: info.command,
			available: info.available,
			billingModel,
			planLabel: qSummary.planLabel,
			remainingPercent: qSummary.remainingPercent,
			authProviders: cliProviders,
			discoveredModelCount: cliCandidates.length,
		});
	}

	const resultsRoot = options.benchResultsDir ?? join(process.cwd(), "bench", "results");
	const historicalMetrics = readHistoricalBenchmarkMetrics(resultsRoot);

	return {
		clis,
		providers: [...providersMap.values()],
		quotas,
		candidates,
		historicalMetrics,
		warnings,
	};
}
