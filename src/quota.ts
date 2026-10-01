import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { unwrapCmdExecutable } from "./cmdline.js";
import { loadIduConfig } from "./config.js";
import { QUOTA_CACHE_PATH, readJsonFile, writeJsonAtomic } from "./json-file.js";
import type { QuotaMeter, QuotaModelAvailability, QuotaSnapshot, QuotaWindow } from "./types.js";

/**
 * Reads quota for the accounts behind the installed CLIs.
 *
 * idu-pi holds no credentials. Every source borrows the session that already
 * exists on this machine: the token or key is read from the CLI's own auth
 * store at probe time, used for exactly one request, and discarded. Nothing
 * here returns a credential, writes one, or logs one.
 *
 * Why ask the CLI instead of scraping its files: a CLI knows its own account
 * state, and every CLI here already displays it. Measured 2026-10-01:
 *
 *   claude  session 16% used, week 58% used
 *   agy     97% weekly on Gemini models, 100% on Claude/GPT
 *   cmdc    5h 0.09% of 14 credits, week 16% of 35
 *   codex   plan plus, 5h 0%, week 79%, plus per-model availability
 *
 * A CLI with no headless quota path still produces a snapshot, one whose
 * `unknownReason` says so. Every CLI in the user's config appears. Silence is
 * not an acceptable answer here, because a missing entry reads as "nobody
 * asked" and an unknown entry reads as "we asked and it could not tell us".
 *
 * Probing is never automatic, and it is cached, because two of the four
 * sources cost a model call: an uncached full read takes about eleven seconds
 * and spends quota to report quota.
 */

/** Never surface a caught error message. See the note on `readJsonFile`. */
const REASON_UNREADABLE_AUTH = "auth.json ilegible o ausente";
const REASON_ENDPOINT = "el endpoint no respondio";
const REASON_NETWORK = "fallo la consulta de red";
const REASON_NO_PROBE = "este harness no expone cuota en modo headless";
const REASON_NO_QUOTA_LINES = "la salida no contiene lineas de cuota";

export interface QuotaSource {
	/** Stable id, also the `source` field of the snapshot. */
	id: string;
	/** The CLI whose credentials and endpoint are used. Matches a config key. */
	harness: string;
	/** Whether this machine has what the source needs. Never makes a request. */
	available(): boolean;
	read(now?: number): Promise<QuotaSnapshot>;
}

/** Default lifetime of a cached read. Ten minutes is shorter than every window
 * these providers report, so a stale hit can never be the reason a dispatch
 * was refused, and long enough that a busy turn reads the cache. */
export const QUOTA_CACHE_TTL_MS = 600_000;

function unknownSnapshot(id: string, harness: string, reason: string, now: number, stale = false): QuotaSnapshot {
	return {
		source: id,
		harness,
		billingModel: null,
		plan: null,
		meters: {},
		capturedAt: new Date(now).toISOString(),
		stale,
		unknownReason: reason,
	};
}

function clampPercent(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	return null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Epoch milliseconds to ISO, or null when the value cannot be a real reset.
 *
 * The range check is not paranoia. Providers send epoch SECONDS (codex) while
 * cmdc sends MILLISECONDS, and a 0 or a 1e300 will happily go through
 * `new Date()`: the first becomes 1970, the second throws a RangeError that
 * used to take the whole source down with it and discard the windows that were
 * fine. A reset in 1970 is worse than no reset, because a caller may schedule
 * against it.
 */
function resetIso(epochMs: number | null, now: number): string | null {
	if (epochMs === null) return null;
	if (epochMs < 1_577_836_800_000) return null; // before 2020: a unit mix-up, not a date
	if (epochMs > now + 400 * 86_400_000) return null; // over a year out: not a reset
	const date = new Date(epochMs);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function windowOf(remainingPercent: number | null, epochMs: number | null, windowSeconds: number | null, now: number): QuotaWindow {
	const resetsAt = resetIso(epochMs, now);
	return {
		remainingPercent,
		resetsAt,
		resetsInSeconds: resetsAt ? Math.round((new Date(resetsAt).getTime() - now) / 1000) : null,
		windowSeconds,
	};
}

// ---------------------------------------------------------------- codex

/**
 * codex: `GET https://chatgpt.com/backend-api/wham/usage` with the token from
 * `~/.codex/auth.json`. Reports USED percentages and reset times in epoch
 * SECONDS, which is the detail worth stating: cmdc's reset is in milliseconds,
 * and mixing the two produces a 1970 date.
 */
export function parseCodexUsagePayload(payload: unknown, now: number): QuotaSnapshot {
	const root = asRecord(payload);
	const rateLimit = asRecord(root?.rate_limit);
	if (!rateLimit) return unknownSnapshot("codex", "codex", REASON_NO_QUOTA_LINES, now);

	const primary = asRecord(rateLimit.primary_window) ?? {};
	const secondary = asRecord(rateLimit.secondary_window) ?? {};
	const usedOf = (raw: Record<string, unknown>) => {
		const used = num(raw.used_percent);
		return used === null ? null : clampPercent(100 - used);
	};

	const meter: QuotaMeter = {
		id: "plan",
		label: "ChatGPT plan",
		windows: {
			"5h": windowOf(usedOf(primary), num(primary.reset_at) === null ? null : num(primary.reset_at)! * 1000, num(primary.limit_window_seconds), now),
			week: windowOf(usedOf(secondary), num(secondary.reset_at) === null ? null : num(secondary.reset_at)! * 1000, num(secondary.limit_window_seconds), now),
		},
	};

	// The endpoint also answers, per model, whether that model is usable right
	// now. That is more actionable than a percentage and nothing else here has
	// it, so it is kept rather than flattened away.
	const modelUsage = asRecord(root?.model_usage);
	if (modelUsage) {
		const models: Record<string, QuotaModelAvailability> = {};
		for (const [name, raw] of Object.entries(modelUsage)) {
			const entry = asRecord(raw);
			const available = entry?.available;
			models[name] = {
				available: typeof available === "boolean" ? available : null,
				note: typeof entry?.credits_would_enable === "boolean" && entry.credits_would_enable ? "requiere créditos" : null,
			};
		}
		if (Object.keys(models).length > 0) meter.models = models;
	}

	// Same rule as the other parsers: a table of question marks is not an
	// answer. Without a single percentage there is no quota to report, and
	// saying so beats printing "5h ?" and letting the reader assume zero.
	const withNumbers = Object.values(meter.windows).some((w) => w.remainingPercent !== null);
	if (!withNumbers) {
		return unknownSnapshot("codex", "codex", "la respuesta no trajo porcentajes de cuota", now);
	}

	return {
		source: "codex",
		harness: "codex",
		billingModel: "plan",
		plan: typeof root?.plan_type === "string" ? root.plan_type : null,
		meters: { plan: meter },
		capturedAt: new Date(now).toISOString(),
		stale: false,
		unknownReason: null,
	};
}

function readCodexToken(): { token: string; accountId: string | null } | null {
	const path = join(homedir(), ".codex", "auth.json");
	if (!existsSync(path)) return null;
	try {
		const auth = asRecord(JSON.parse(readFileSync(path, "utf8")));
		const tokens = asRecord(auth?.tokens);
		const token = tokens?.access_token ?? tokens?.id_token;
		if (typeof token !== "string" || token.length === 0) return null;

		// The account id is a claim inside the JWT; the usage endpoint needs it
		// to pick the right account when the token spans several.
		let accountId: string | null = null;
		try {
			const claims = asRecord(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()));
			const claim = asRecord(claims?.["https://api.openai.com/auth"]);
			accountId = typeof claim?.chatgpt_account_id === "string" ? claim.chatgpt_account_id : null;
		} catch {
			// A token that is not a JWT is not a reason to skip the request.
		}
		return { token, accountId };
	} catch {
		// Fixed reason, never the parse error: a JSON error quotes the raw text
		// around the failure, which in this file is the key itself.
		return null;
	}
}

export const codexQuotaSource: QuotaSource = {
	id: "codex",
	harness: "codex",
	available: () => readCodexToken() !== null,
	async read(now = Date.now()) {
		const auth = readCodexToken();
		if (!auth) return unknownSnapshot("codex", "codex", REASON_UNREADABLE_AUTH, now);

		const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
		if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;
		try {
			const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
			if (!res.ok) return unknownSnapshot("codex", "codex", REASON_ENDPOINT, now);
			return parseCodexUsagePayload(await res.json(), now);
		} catch {
			return unknownSnapshot("codex", "codex", REASON_NETWORK, now);
		}
	},
};

// ----------------------------------------------------------------- cmdc

/**
 * cmdc: `GET https://api.commandcode.ai/alpha/billing/credits` with the key
 * from `~/.commandcode/auth.json`. Reports USED over a CAP in credit units, and
 * the reset is epoch MILLISECONDS.
 *
 * Found by reading the CLI's own statusline module
 * (`~/.commandcode/mods/cmdc-statusline-plus.ts`), not from documentation. The
 * statusline is the proof the data is fetchable: something has to fill it.
 */
export function parseCmdcCreditsPayload(payload: unknown, now: number): QuotaSnapshot {
	const root = asRecord(payload);
	const limits = asRecord(root?.windowLimits);
	if (!limits) return unknownSnapshot("cmdc", "commandcode", REASON_NO_QUOTA_LINES, now);

	const windows: Record<string, QuotaWindow> = {};
	for (const [label, key] of [
		["5h", "fiveHour"],
		["week", "weekly"],
	] as const) {
		const raw = asRecord(limits[key]);
		if (!raw) continue;
		const used = num(raw.used);
		const cap = num(raw.cap);
		// Only with a real cap. A `used` with no denominator has no percentage,
		// and inventing one is how a 0.0126-credit run reads as exhausted.
		const remaining =
			used !== null && cap !== null && cap > 0 ? clampPercent(100 - (used / cap) * 100) : null;
		windows[label] = windowOf(remaining, num(raw.resetAt), null, now);
	}

	// An empty table is not an answer, and neither is a table of question marks.
	// If nothing came back with a percentage, the caller gets a stated reason
	// instead, which is the one output this module exists to make impossible.
	const withNumbers = Object.values(windows).filter((w) => w.remainingPercent !== null);
	if (withNumbers.length === 0) {
		return unknownSnapshot("cmdc", "commandcode", "la respuesta no trajo porcentajes de cuota", now);
	}

	return {
		source: "cmdc",
		harness: "commandcode",
		billingModel: "plan",
		plan: null,
		meters: { plan: { id: "plan", label: "creditos del plan", windows } },
		capturedAt: new Date(now).toISOString(),
		stale: false,
		unknownReason: null,
	};
}

export const cmdcQuotaSource: QuotaSource = {
	id: "cmdc",
	harness: "commandcode",
	available: () => existsSync(join(homedir(), ".commandcode", "auth.json")),
	async read(now = Date.now()) {
		const path = join(homedir(), ".commandcode", "auth.json");
		const auth = readJsonFile<{ apiKey?: unknown }>(path);
		if (!auth || typeof auth.apiKey !== "string" || auth.apiKey.length === 0) {
			return unknownSnapshot("cmdc", "commandcode", REASON_UNREADABLE_AUTH, now);
		}
		try {
			const res = await fetch("https://api.commandcode.ai/alpha/billing/credits", {
				headers: { Authorization: `Bearer ${auth.apiKey}` },
			});
			if (!res.ok) return unknownSnapshot("cmdc", "commandcode", REASON_ENDPOINT, now);
			return parseCmdcCreditsPayload(await res.json(), now);
		} catch {
			return unknownSnapshot("cmdc", "commandcode", REASON_NETWORK, now);
		}
	},
};

// ----------------------------------------------------------------- claude

const MONTHS: Record<string, number> = {
	jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
	jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Offset of a named IANA zone from UTC, in ms, at a given instant. */
function zoneOffsetMs(zone: string, at: Date): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: zone, hour12: false,
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	}).formatToParts(at);
	const map: Record<string, string> = {};
	for (const p of parts) map[p.type] = p.value;
	const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, (+map.hour) % 24, +map.minute, +map.second);
	return asUtc - at.getTime();
}

/**
 * Turns "Oct 5, 8pm (America/Santiago)" into an instant.
 *
 * Two details are load-bearing and both came from real output rather than from
 * the obvious shape of it. The minutes are OPTIONAL: the 5h window prints
 * "11:40pm" and the weekly one prints "8pm", and a regex that demands H:MM
 * drops the weekly reset to null without saying so. And the field is validated
 * rather than normalised: "Oct 32" must not become November 2nd, and "25:99pm"
 * must not become 17:39. A reset time that is plausible but wrong schedules
 * work into a window that is already closed, so anything doubtful returns null.
 */
export function parseClaudeResetStamp(text: string, now: number): string | null {
	const m = /^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)\s*$/i.exec(text);
	if (!m) return null;

	const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
	if (month === undefined) return null;

	const day = Number.parseInt(m[2], 10);
	const hour12 = Number.parseInt(m[3], 10);
	const minute = m[4] === undefined ? 0 : Number.parseInt(m[4], 10);
	if (day < 1 || day > 31) return null;
	if (hour12 < 1 || hour12 > 12) return null;
	if (minute < 0 || minute > 59) return null;

	let hour = hour12 % 12;
	if (/pm/i.test(m[5])) hour += 12;

	// The year is not in the text. A reset well in the past belongs to next
	// year's window rather than to a timestamp long gone.
	const build = (year: number): Date | null => {
		const naive = Date.UTC(year, month, day, hour, minute);
		let guess = new Date(naive);
		for (let i = 0; i < 2; i++) {
			let offset: number;
			try {
				offset = zoneOffsetMs(m[6], guess);
			} catch {
				return null;
			}
			guess = new Date(naive - offset);
		}
		return guess;
	};

	let stamp = build(new Date(now).getUTCFullYear());
	if (stamp === null) return null;
	if (stamp.getTime() < now - 6 * 3_600_000) {
		const next = build(new Date(now).getUTCFullYear() + 1);
		if (next === null) return null;
		stamp = next;
	}
	return stamp.toISOString();
}

/**
 * claude: `claude -p "/usage"`. Prose, not JSON, and it reports USED.
 *
 * Real output, both lines, verbatim from 2026-10-01. Note the missing minutes
 * on the second one:
 *   Current session: 16% used · resets Oct 1, 11:40pm (America/Santiago)
 *   Current week (all models): 58% used · resets Oct 5, 8pm (America/Santiago)
 */
export function parseClaudeUsageText(text: string, now: number): QuotaSnapshot {
	const windows: Record<string, QuotaWindow> = {};
	const line = /^Current\s+(session|week[^:]*):\s*(\d+(?:\.\d+)?)%\s*used\s*[·•]\s*resets\s+(.+)$/gim;

	for (const match of text.matchAll(line)) {
		const label = /^session/i.test(match[1]) ? "5h" : "week";
		const used = Number.parseFloat(match[2]);
		if (!Number.isFinite(used)) continue;
		const resetsAt = parseClaudeResetStamp(match[3].trim(), now);
		const epochMs = resetsAt ? new Date(resetsAt).getTime() : null;
		windows[label] = windowOf(clampPercent(100 - used), epochMs, null, now);
	}

	if (Object.keys(windows).length === 0) {
		return unknownSnapshot("claude", "claude", REASON_NO_QUOTA_LINES, now);
	}
	return {
		source: "claude",
		harness: "claude",
		// The output opens with "using your subscription to power your Claude
		// Code usage", which is the plan naming its own meter.
		billingModel: /subscription/i.test(text) ? "plan" : null,
		plan: null,
		meters: { plan: { id: "plan", label: "Claude Code subscription", windows } },
		capturedAt: new Date(now).toISOString(),
		stale: false,
		unknownReason: null,
	};
}

export const claudeQuotaSource: QuotaSource = {
	id: "claude",
	harness: "claude",
	available: () => existsSync(join(homedir(), ".claude")),
	async read(now = Date.now()) {
		const text = await runProbe("claude", ["-p", "/usage"]);
		return text === null ? unknownSnapshot("claude", "claude", REASON_NO_QUOTA_LINES, now) : parseClaudeUsageText(text, now);
	},
};

// -------------------------------------------------------------------- agy

/**
 * agy: `agy -p "/usage"`. Tab separated, and it reports REMAINING, so nothing is
 * subtracted here. Real output, verbatim:
 *
 *   Gemini Models	Weekly Limit Remaining	98%	2026-10-07T16:10:50Z
 *   Gemini Models	Five Hour Limit Remaining	98%	2026-10-02T02:47:33Z
 *   Claude and GPT models	Weekly Limit Remaining	100%	2026-10-08T22:05:18Z
 *
 * Two rows share a window label but not a meter: Gemini and Claude/GPT are
 * separate pools inside one binary. Keeping them as two meters is the whole
 * point of the shape, because a consumer asking for the 5h window on this
 * account has to know which pool it means.
 *
 * A row that does not fit the four-column shape is dropped, and a run where
 * every row is dropped becomes `unknown` with a reason rather than a table of
 * nulls. So a change in the CLI's output format shows up as a visible
 * degradation instead of silently missing numbers.
 */
export function parseAgyUsageTsv(text: string, now: number): QuotaSnapshot {
	const byMeter = new Map<string, Record<string, QuotaWindow>>();
	const labels = new Map<string, string>();

	for (const raw of text.split(/\r?\n/)) {
		const cols = raw.split("\t").map((c) => c.trim());
		if (cols.length < 4) continue;

		const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(cols[2]);
		if (!percent) continue;
		const windowLabel = /weekly/i.test(cols[1]) ? "week" : /five\s*hour/i.test(cols[1]) ? "5h" : null;
		if (!windowLabel) continue;

		const id = slug(cols[0]);
		labels.set(id, cols[0]);
		const windows = byMeter.get(id) ?? {};
		const resetMs = Date.parse(cols[3]);
		windows[windowLabel] = windowOf(
			clampPercent(Number.parseFloat(percent[1])),
			Number.isFinite(resetMs) ? resetMs : null,
			null,
			now,
		);
		byMeter.set(id, windows);
	}

	if (byMeter.size === 0) return unknownSnapshot("agy", "antigravity", REASON_NO_QUOTA_LINES, now);

	const meters: Record<string, QuotaMeter> = {};
	for (const [id, windows] of byMeter) meters[id] = { id, label: labels.get(id) ?? id, windows };

	return {
		source: "agy",
		harness: "antigravity",
		billingModel: "plan",
		plan: null,
		meters,
		capturedAt: new Date(now).toISOString(),
		stale: false,
		unknownReason: null,
	};
}

function slug(label: string): string {
	return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const agyQuotaSource: QuotaSource = {
	id: "agy",
	harness: "antigravity",
	available: () => existsSync(join(homedir(), ".gemini")),
	async read(now = Date.now()) {
		const text = await runProbe("antigravity", ["-p", "/usage"]);
		return text === null ? unknownSnapshot("agy", "antigravity", REASON_NO_QUOTA_LINES, now) : parseAgyUsageTsv(text, now);
	},
};

// ------------------------------------------------------------------ probe

/**
 * Runs one CLI's own quota command and returns its raw output.
 *
 * The command path comes from the user's own `~/.idu/config.json`, the same map
 * that decides where a worker runs from, so a probe cannot drift from the binary
 * it is asking. `unwrapCmdExecutable` is what makes this work on Windows:
 * `claude.cmd` is an npm shim, not an executable, and spawning one without a
 * shell fails with EINVAL.
 */
function runProbe(cliKey: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		let resolved;
		try {
			const configured = loadIduConfig().clis[cliKey]?.command ?? cliKey;
			resolved = unwrapCmdExecutable(configured, args);
		} catch {
			resolve(null);
			return;
		}
		execFile(
			resolved.command,
			resolved.args,
			{ timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: resolved.isShell },
			(_err, stdout) => {
				const text = (stdout ?? "").trim();
				resolve(text.length > 0 ? text : null);
			},
		);
	});
}

// ----------------------------------------------------------------- driver

/** Sources that actually know how to ask. Everything else reports unknown. */
export const QUOTA_SOURCES: QuotaSource[] = [
	codexQuotaSource,
	cmdcQuotaSource,
	claudeQuotaSource,
	agyQuotaSource,
];

function noSourceFor(harness: string): QuotaSnapshot {
	return unknownSnapshot(harness, harness, REASON_NO_PROBE, Date.now());
}

/**
 * Every configured CLI, one snapshot each, in one pass. A CLI without a probe
 * appears as unknown instead of vanishing.
 */
async function readAllLive(now: number): Promise<QuotaSnapshot[]> {
	let keys: string[];
	try {
		keys = Object.keys(loadIduConfig().clis);
	} catch {
		keys = QUOTA_SOURCES.map((s) => s.harness);
	}

	const results = await Promise.all(QUOTA_SOURCES.map((source) => source.read(now)));

	return keys.map((harness) => {
		const match = results.find((snap) => snap.harness === harness);
		return match ?? noSourceFor(harness);
	});
}

export interface ReadQuotaOptions {
	/** Ignore the cache and spend a live call. */
	fresh?: boolean;
	/** Cache lifetime. Defaults to QUOTA_CACHE_TTL_MS. */
	ttlMs?: number;
	/** Where the cache lives. Overridden in tests so a unit test never writes
	 * into the real ~/.idu/runtime. */
	cachePath?: string;
	now?: number;
}

interface QuotaCacheFile {
	version: 1;
	cachedAt: string;
	snapshots: QuotaSnapshot[];
}

/**
 * Cache reads, split out from `readQuotaSnapshots` so they can be tested
 * without a live call. A unit test that probes four accounts spends six model
 * calls and takes fifteen seconds, which is not what a unit test is for.
 */
export function readCacheIfFresh(cachePath: string, now: number, ttlMs: number): QuotaSnapshot[] | null {
	const cached = readJsonFile<QuotaCacheFile>(cachePath);
	if (cached?.version !== 1 || !Array.isArray(cached.snapshots)) return null;
	const age = now - Date.parse(cached.cachedAt);
	if (!Number.isFinite(age) || age < 0 || age >= ttlMs) return null;

	// Valid JSON is not a valid cache. A hand-edited file, a half-written one
	// from another writer, or a future schema version would otherwise reach the
	// formatter as a snapshot with no `meters`, and crash the command that was
	// only trying to print a cache hit. Dropping what is unusable here is what
	// makes a bad cache a performance problem rather than a correctness one.
	const usable = cached.snapshots.filter(isUsableSnapshot);
	if (usable.length === 0) return null;

	return usable.map((snap) => ({ ...snap, stale: true }));
}

/**
 * The minimum shape the formatter relies on. Deliberately structural and
 * shallow: this guards the cache boundary, it does not re-validate a source.
 */
function isUsableSnapshot(value: unknown): value is QuotaSnapshot {
	if (!value || typeof value !== "object") return false;
	const snap = value as Partial<QuotaSnapshot>;
	return (
		typeof snap.source === "string" &&
		typeof snap.harness === "string" &&
		!!snap.meters &&
		typeof snap.meters === "object" &&
		!Array.isArray(snap.meters)
	);
}

/** Cache writes never take the caller down with them. */
export function writeCache(cachePath: string, snapshots: QuotaSnapshot[], now: number): void {
	try {
		writeJsonAtomic(cachePath, { version: 1, cachedAt: new Date(now).toISOString(), snapshots } satisfies QuotaCacheFile);
	} catch {
		// A cache that cannot be written is a performance problem, not a
		// correctness one. The readings are still returned to the caller.
	}
}

/**
 * Reads every configured CLI's quota, in parallel, from cache when it is warm.
 *
 * The cache exists because the probe is not free: two of the sources run a
 * model, and a cold read takes about eleven seconds. Without it this could
 * only ever be a command a person remembers to type, which is exactly the
 * administration the user does not want.
 */
export async function readQuotaSnapshots(options: ReadQuotaOptions = {}): Promise<QuotaSnapshot[]> {
	const now = options.now ?? Date.now();
	const ttl = options.ttlMs ?? QUOTA_CACHE_TTL_MS;
	const cachePath = options.cachePath ?? QUOTA_CACHE_PATH;

	if (!options.fresh) {
		const cached = readCacheIfFresh(cachePath, now, ttl);
		if (cached) return cached;
	}

	const snapshots = await readAllLive(now);
	writeCache(cachePath, snapshots, now);
	return snapshots;
}

// ----------------------------------------------------------------- format

const WINDOW_ORDER = ["5h", "week"];

function orderWindows(windows: Record<string, QuotaWindow>): Array<[string, QuotaWindow]> {
	return Object.entries(windows).sort((a, b) => {
		const ia = WINDOW_ORDER.indexOf(a[0]);
		const ib = WINDOW_ORDER.indexOf(b[0]);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	});
}

function relative(seconds: number | null): string {
	if (seconds === null) return "sin reinicio conocido";
	const s = Math.max(0, seconds);
	if (s < 90) return `reinicia en ${s}s`;
	const mins = Math.round(s / 60);
	if (mins < 90) return `reinicia en ${mins}m`;
	const hours = Math.floor(mins / 60);
	const rem = mins % 60;
	if (hours < 36) return `reinicia en ${hours}h${rem ? ` ${rem}m` : ""}`;
	return `reinicia en ${Math.round(hours / 24)}d`;
}

const BILLING_LABEL: Record<string, string> = {
	plan: "plan (no es dinero)",
	api: "API facturada (es dinero)",
	subscription: "suscripcion (no es dinero)",
};

/** One block per source. Says why, rather than implying a number of zero. */
export function formatQuota(snapshots: QuotaSnapshot[]): string {
	if (snapshots.length === 0) return "quota: sin fuentes configuradas";

	const blocks = snapshots.map((snap) => {
		if (snap.unknownReason) {
			return `  ${snap.harness.padEnd(13)} unknown — ${snap.unknownReason}`;
		}

		const meterLines: string[] = [];
		for (const meter of Object.values(snap.meters ?? {})) {
			const parts = orderWindows(meter.windows).map(([label, w]) => {
				const pct = w.remainingPercent === null ? "?" : `${w.remainingPercent}%`;
				return `${label} ${pct} left, ${relative(w.resetsInSeconds)}`;
			});
			const meterLabel = Object.keys(snap.meters).length > 1 ? `${meter.label}: ` : "";
			meterLines.push(`    ${meterLabel}${parts.join(" | ")}`);

			if (meter.models) {
				const blocked = Object.entries(meter.models).filter(([, m]) => m.available === false).map(([n]) => n);
				if (blocked.length > 0) meterLines.push(`    modelos no disponibles ahora: ${blocked.join(", ")}`);
			}
		}

		const billing = snap.billingModel ? BILLING_LABEL[snap.billingModel] ?? snap.billingModel : "tipo de cobro no informado";
		const plan = snap.plan ? ` ${snap.plan}` : "";
		const stale = snap.stale ? " [cache]" : "";
		return `  ${snap.harness.padEnd(13)}${stale}${plan} — ${billing}\n${meterLines.join("\n")}`;
	});

	return `quota restante, leido de la cuenta de cada CLI:\n${blocks.join("\n")}`;
}
