import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { getIduConfigPath, IDU_HOME } from "./config.js";

export interface ArbitrationOption {
	id: string;
	description: string;
	isHighRiskMitigation?: boolean;
}

export interface ArbitrationInput {
	stateSummary: string;
	options: ArbitrationOption[];
	confidenceThreshold?: number;
	apiKey?: string;
	endpoint?: string;
	model?: string;
	timeoutMs?: number;
	fetchFn?: typeof fetch;
	cwd?: string;
	/**
	 * When true, skips the local Kev probe and the cloud tier entirely and goes
	 * straight to the deterministic Risk-First policy (zero network I/O).
	 */
	offline?: boolean;
}

export interface ArbitrationDecision {
	selectedOptionId: string;
	confidence: number;
	source: "kev_local" | "jev_cloud" | "jev" | "deterministic_fallback";
	requiresHumanReview: boolean;
	reason: string;
	rawProbabilities?: Record<string, number>;
}

export const DEFAULT_TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_JEV_TIMEOUT_MS = 10_000;

function isLocalEndpoint(endpoint: string): boolean {
	try {
		const hostname = new URL(endpoint).hostname;
		return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
	} catch {
		return false;
	}
}

const TOKEN_LIKE_PATTERN =
	/(sk-[A-Za-z0-9_-]{8,}|apikey_[A-Za-z0-9_-]{8,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,})/g;

/**
 * Sanitizes a remote error body or exception message before it lands in
 * decision.reason, which an orchestrator LLM consumes (S3). Strips
 * credential-shaped substrings and truncates.
 */
export function redactErrorDetail(text: string, maxLen = 100): string {
	return text
		.replace(TOKEN_LIKE_PATTERN, "[redacted]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLen);
}

/**
 * Clamps an arbitrary threshold input into [0, 1], falling back to the default
 * on NaN/non-numeric values (I).
 */
export function normalizeThreshold(value: unknown): number {
	const n = typeof value === "number" ? value : parseFloat(String(value));
	if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE_THRESHOLD;
	return Math.min(1, Math.max(0, n));
}

const HIGH_RISK_PATTERN = /\b(risks?|riesgos?|deudas?|debts?|regresiones?|regresions?)\b/i;

/**
 * Word-boundary heuristic for the Risk-First policy: matches "risk", "deuda",
 * etc. as whole words only, so "asterisk" no longer triggers a false positive
 * like the old substring check did (G).
 */
export function looksLikeHighRiskMitigation(text: string): boolean {
	return HIGH_RISK_PATTERN.test(text);
}

function parseDotEnvFile(filePath: string, targetKey: string): string | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const content = readFileSync(filePath, "utf8");
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const match = trimmed.match(new RegExp(`^(?:export\\s+)?${targetKey}\\s*=\\s*(.*)$`));
			if (match) {
				let val = match[1].trim();
				if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
					val = val.slice(1, -1);
				}
				if (val) return val;
			}
		}
	} catch {
		// Ignore unreadable .env file
	}
	return undefined;
}

/**
 * Where a TypeSafe setting was read from. The arbitration router needs this,
 * not just the value: whether a bearer token may be sent to an endpoint
 * depends on who wrote the endpoint.
 */
export type TypeSafeSettingSource =
	| "explicit"
	| "env"
	| "project-dotenv"
	| "idu-dotenv"
	| "config"
	| "default";

export interface ResolvedTypeSafeSetting {
	value: string;
	source: TypeSafeSettingSource;
	/** The .env file the value came from, for the two dotenv sources. */
	file?: string;
}

/**
 * Searches for a key in .env files:
 * 1. Checks dir/.env directly.
 * 2. Climbs up parent directories up to git root or filesystem root.
 * 3. Falls back to global ~/.idu/.env.
 *
 * Steps 1 and 2 are "project-dotenv": files inside the repository being worked
 * on, which whoever wrote that repository controls. Step 3 is "idu-dotenv",
 * owned by the user of this machine.
 */
function findInDotEnv(targetKey: string, dir: string = process.cwd()): ResolvedTypeSafeSetting | undefined {
	let currentDir = resolve(dir);
	const directFile = join(currentDir, ".env");
	const directVal = parseDotEnvFile(directFile, targetKey);
	if (directVal) return { value: directVal, source: "project-dotenv", file: directFile };

	const root = parse(currentDir).root;
	while (true) {
		// Stop AT the git root: the repo owner controls everything inside it, but
		// the parent tree belongs to the machine. The check must run before the
		// parent read or exactly one .env above the root leaks in (S5).
		if (existsSync(join(currentDir, ".git")) || currentDir === root) break;
		const parent = dirname(currentDir);
		if (parent === currentDir) break;
		const parentFile = join(parent, ".env");
		const val = parseDotEnvFile(parentFile, targetKey);
		if (val) return { value: val, source: "project-dotenv", file: parentFile };
		currentDir = parent;
	}

	const iduFile = join(IDU_HOME, ".env");
	const iduEnvVal = parseDotEnvFile(iduFile, targetKey);
	if (iduEnvVal) return { value: iduEnvVal, source: "idu-dotenv", file: iduFile };

	return undefined;
}

/**
 * Resolves the TypeSafe/Kev API endpoint with fallback order:
 * 1. Explicitly passed endpoint
 * 2. process.env.TYPESAFE_ENDPOINT or process.env.JEV_ENDPOINT
 * 3. .env file (dir, parent tree, or ~/.idu/.env)
 * 4. ~/.idu/config.json under typesafe.endpoint
 * 5. DEFAULT_TYPESAFE_ENDPOINT (https://api.typesafe.ai/v1/systemone)
 */
export function resolveTypeSafeEndpointDetails(explicitEndpoint?: string, cwd?: string): ResolvedTypeSafeSetting {
	if (explicitEndpoint && explicitEndpoint.trim()) {
		return { value: explicitEndpoint.trim(), source: "explicit" };
	}

	const envEndpoint = process.env.TYPESAFE_ENDPOINT || process.env.JEV_ENDPOINT;
	if (envEndpoint && envEndpoint.trim()) {
		return { value: envEndpoint.trim(), source: "env" };
	}

	const dotEnvEndpoint = findInDotEnv("TYPESAFE_ENDPOINT", cwd) || findInDotEnv("JEV_ENDPOINT", cwd);
	if (dotEnvEndpoint) {
		return dotEnvEndpoint;
	}

	try {
		const configPath = getIduConfigPath();
		if (existsSync(configPath)) {
			const raw = readFileSync(configPath, "utf8");
			const parsed = JSON.parse(raw);
			const candidate = parsed?.typesafe?.endpoint;
			// ~/.idu/config.json is writable by delegated workers; only trust an https
			// endpoint from it so the bearer token can never be steered to a local or
			// plain-http host (S2).
			if (typeof candidate === "string" && candidate.trim().startsWith("https://")) {
				return { value: candidate.trim(), source: "config" };
			}
		}
	} catch {
		// Ignore unreadable or corrupt config
	}

	return { value: DEFAULT_TYPESAFE_ENDPOINT, source: "default" };
}

export function resolveTypeSafeEndpoint(explicitEndpoint?: string, cwd?: string): string {
	return resolveTypeSafeEndpointDetails(explicitEndpoint, cwd).value;
}

/**
 * Resolves the TypeSafe API key with fallback order:
 * 1. Explicitly passed parameter
 * 2. process.env.TYPESAFE_API_KEY or process.env.JEV_API_KEY
 * 3. .env file in cwd, parent directory tree, or ~/.idu/.env
 * 4. ~/.idu/config.json under typesafe.apiKey or typesafeApiKey
 */
export function resolveTypeSafeApiKeyDetails(explicitKey?: string, cwd?: string): ResolvedTypeSafeSetting | undefined {
	if (explicitKey && explicitKey.trim()) {
		return { value: explicitKey.trim(), source: "explicit" };
	}

	const envKey = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
	if (envKey && envKey.trim()) {
		return { value: envKey.trim(), source: "env" };
	}

	const dotEnvKey = findInDotEnv("TYPESAFE_API_KEY", cwd) || findInDotEnv("JEV_API_KEY", cwd);
	if (dotEnvKey) {
		return dotEnvKey;
	}

	try {
		const configPath = getIduConfigPath();
		if (existsSync(configPath)) {
			const raw = readFileSync(configPath, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed?.typesafe?.apiKey && typeof parsed.typesafe.apiKey === "string") {
				return { value: parsed.typesafe.apiKey.trim(), source: "config" };
			}
			if (parsed?.typesafeApiKey && typeof parsed.typesafeApiKey === "string") {
				return { value: parsed.typesafeApiKey.trim(), source: "config" };
			}
		}
	} catch {
		// Ignore unreadable or corrupt config
	}

	return undefined;
}

export function resolveTypeSafeApiKey(explicitKey?: string, cwd?: string): string | undefined {
	return resolveTypeSafeApiKeyDetails(explicitKey, cwd)?.value;
}

/**
 * The endpoint the cloud bearer token may actually be sent to.
 *
 * A local or plain-http candidate never receives it (S1, S2). Neither does an
 * endpoint read from a .env inside the project tree, unless the key came from
 * that very same file (S6). The project tree belongs to whoever wrote the
 * repository: a cloned repo that commits `TYPESAFE_ENDPOINT=https://elsewhere`
 * would otherwise receive the key the user keeps in ~/.idu/.env or in their
 * environment, together with the state summary. When the repository supplies
 * both the endpoint and the key, nothing of the user's is at stake.
 *
 * Pure: no I/O, so it is directly unit-testable.
 */
export function selectCloudEndpoint(
	endpoint: ResolvedTypeSafeSetting,
	key: Pick<ResolvedTypeSafeSetting, "source" | "file">,
): string {
	if (isLocalEndpoint(endpoint.value)) return DEFAULT_TYPESAFE_ENDPOINT;
	if (!endpoint.value.startsWith("https://")) return DEFAULT_TYPESAFE_ENDPOINT;
	if (endpoint.source === "project-dotenv") {
		const sameFile = key.source === "project-dotenv" && key.file !== undefined && key.file === endpoint.file;
		if (!sameFile) return DEFAULT_TYPESAFE_ENDPOINT;
	}
	return endpoint.value;
}

/**
 * Deterministic arbitration fallback used when Jev is unavailable or unconfigured.
 * Prioritizes high-risk mitigation first; falls back to the first available option.
 * A hardcoded policy has no calibrated confidence, so it always escalates to human
 * review when the configured threshold exceeds its nominal confidence (A).
 */
export function arbitrateDeterministically(input: ArbitrationInput): ArbitrationDecision {
	if (!input.options || input.options.length === 0) {
		throw new Error("Cannot arbitrate without candidate options");
	}

	const threshold = normalizeThreshold(input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);

	const highRisk = input.options.find((opt) => opt.isHighRiskMitigation);
	if (highRisk) {
		const confidence = 1.0;
		return {
			selectedOptionId: highRisk.id,
			confidence,
			source: "deterministic_fallback",
			requiresHumanReview: confidence < threshold,
			reason: `Risk-first policy: selected '${highRisk.id}' because it mitigates high-risk regression debt.`,
		};
	}

	const defaultOption = input.options[0];
	const confidence = 0.8;
	return {
		selectedOptionId: defaultOption.id,
		confidence,
		source: "deterministic_fallback",
		requiresHumanReview: confidence < threshold,
		reason: `Sequential policy: selected '${defaultOption.id}' by default order.`,
	};
}

/**
 * Evaluates options using TypeSafe's System One (Jev) API or local Kev.
 * Returns calibrated probabilities and confidence scores.
 */
export async function arbitrateWithJev(
	input: ArbitrationInput,
	apiKey: string,
): Promise<ArbitrationDecision> {
	if (!input.options || input.options.length === 0) {
		throw new Error("Cannot arbitrate without candidate options");
	}

	const fetchImpl = input.fetchFn || globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		return {
			...arbitrateDeterministically(input),
			reason: "globalThis.fetch unavailable, fell back to deterministic arbitration.",
		};
	}

	const endpoint = resolveTypeSafeEndpoint(input.endpoint, input.cwd);
	const threshold = normalizeThreshold(input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
	const model = input.model || DEFAULT_JEV_MODEL;
	const timeoutMs = input.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS;

	const criteria: Record<string, string> = {};
	for (const opt of input.options) {
		criteria[opt.id] = opt.description;
	}

	const payload = {
		model,
		state: input.stateSummary,
		questions: {
			next_action: {
				type: "choice",
				instructions: "Which task or action should be executed next based on current state and regression risk?",
				criteria,
			},
		},
	};

	try {
		const res = await fetchImpl(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			const fallback = arbitrateDeterministically(input);
			return {
				...fallback,
				reason: `Jev HTTP ${res.status} error (${redactErrorDetail(errText)}). Fell back to deterministic arbitration: ${fallback.reason}`,
			};
		}

		const data = (await res.json()) as {
			answers?: {
				next_action?: {
					type?: string;
					choice?: string;
					confidence?: number;
					probabilities?: Record<string, number>;
				};
			};
		};

		const answer = data?.answers?.next_action;
		const chosen = answer?.choice;
		const confidence = typeof answer?.confidence === "number" ? answer.confidence : 0;
		const probabilities = answer?.probabilities;

		if (!chosen || !Object.hasOwn(criteria, chosen)) {
			const fallback = arbitrateDeterministically(input);
			return {
				...fallback,
				reason: `Jev returned unrecognized choice '${redactErrorDetail(String(chosen), 40)}'. Fell back to deterministic arbitration.`,
			};
		}

		const meetsThreshold = confidence >= threshold;

		// Only option-id keys pass through: rawProbabilities goes to the
		// orchestrator verbatim otherwise, and the remote body may carry
		// arbitrary strings (S3 residual).
		const cleanProbabilities: Record<string, number> = {};
		if (probabilities && typeof probabilities === "object") {
			for (const opt of input.options) {
				const v = (probabilities as Record<string, unknown>)[opt.id];
				if (typeof v === "number" && Number.isFinite(v)) {
					cleanProbabilities[opt.id] = v;
				}
			}
		}

		return {
			selectedOptionId: chosen,
			confidence,
			source: "jev",
			requiresHumanReview: !meetsThreshold,
			reason: meetsThreshold
				? `Jev autonomous decision: selected '${chosen}' with confidence ${(confidence * 100).toFixed(1)}% (>= ${(threshold * 100).toFixed(0)}%).`
				: `Jev low-confidence decision: selected '${chosen}' with confidence ${(confidence * 100).toFixed(1)}% (< ${(threshold * 100).toFixed(0)}%). Escalating to human.`,
			rawProbabilities: cleanProbabilities,
		};
	} catch (err: unknown) {
		const fallback = arbitrateDeterministically(input);
		const msg = err instanceof Error ? err.message : String(err);
		return {
			...fallback,
			reason: `Jev network error (${redactErrorDetail(msg)}). Fell back to deterministic arbitration: ${fallback.reason}`,
		};
	}
}

export const DEFAULT_LOCAL_KEV_ENDPOINT = "http://127.0.0.1:8009/v1/systemone";
export const DEFAULT_LOCAL_KEV_HEALTH = "http://127.0.0.1:8009/v1/models";

/**
 * Probes whether a local Kev server is running and ready on port 8009.
 */
export async function isLocalKevAlive(
	healthUrl = DEFAULT_LOCAL_KEV_HEALTH,
	fetchImpl: typeof fetch = globalThis.fetch,
	timeoutMs = 250,
): Promise<boolean> {
	if (typeof fetchImpl !== "function") return false;
	try {
		const res = await fetchImpl(healthUrl, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Main 3-tier arbitration router:
 * 1. Tier 1: Local Kev GPU server (if running on localhost:8009 or explicit endpoint).
 * 2. Tier 2: Cloud TypeSafe Jev API (if TYPESAFE_API_KEY is configured).
 * 3. Tier 3: Deterministic Risk-First fallback (offline, zero-cost, resilient).
 */
export async function arbitrate(input: ArbitrationInput): Promise<ArbitrationDecision> {
	if (input.offline) {
		return arbitrateDeterministically(input);
	}
	const fetchImpl = input.fetchFn || globalThis.fetch;
	const endpointDetails = resolveTypeSafeEndpointDetails(input.endpoint, input.cwd);
	const resolvedEndpoint = endpointDetails.value;
	const isTargetingLocal = isLocalEndpoint(resolvedEndpoint);

	// 1. If explicitly pointed to local Kev OR if default local Kev is active on port 8009:
	if (isTargetingLocal) {
		let probeUrl = DEFAULT_LOCAL_KEV_HEALTH;
		try {
			const parsed = new URL(resolvedEndpoint);
			parsed.pathname = parsed.pathname.replace(/\/systemone$/, "") + "/models";
			probeUrl = parsed.toString();
		} catch {
			// Unparseable endpoint; keep the default health URL.
		}
		const localAlive = await isLocalKevAlive(probeUrl, fetchImpl);
		if (localAlive) {
			const res = await arbitrateWithJev(
				{ ...input, endpoint: resolvedEndpoint },
				input.apiKey || "local",
			);
			return res.source === "deterministic_fallback" ? res : { ...res, source: "kev_local" };
		}
		// Kev is down but the resolved endpoint is local: fall through to the cloud
		// tier with the DEFAULT cloud endpoint, never re-send the local URL (S1).
	} else if (!input.endpoint) {
		// Opportunistically check if local Kev is alive before hitting the cloud
		const localAlive = await isLocalKevAlive(DEFAULT_LOCAL_KEV_HEALTH, fetchImpl);
		if (localAlive) {
			const res = await arbitrateWithJev(
				{ ...input, endpoint: DEFAULT_LOCAL_KEV_ENDPOINT },
				input.apiKey || "local",
			);
			return res.source === "deterministic_fallback" ? res : { ...res, source: "kev_local" };
		}
	}

	// 2. Cloud TypeSafe Jev API — always the cloud endpoint, even when the resolved
	// endpoint was a local Kev URL that turned out to be offline (S1). A non-https
	// cloud candidate never receives the bearer token: fall back to the default
	// https endpoint instead (S2, same trust rule as ~/.idu/config.json). An
	// endpoint the project's own .env chose only receives a key from that same
	// file (S6); see selectCloudEndpoint.
	const cloudKey = resolveTypeSafeApiKeyDetails(input.apiKey, input.cwd);
	if (cloudKey) {
		const cloudEndpoint = selectCloudEndpoint(endpointDetails, cloudKey);
		const res = await arbitrateWithJev(
			{ ...input, endpoint: cloudEndpoint },
			cloudKey.value,
		);
		return res.source === "deterministic_fallback" ? res : { ...res, source: "jev_cloud" };
	}

	// 3. Deterministic Risk-First Policy
	return arbitrateDeterministically(input);
}
