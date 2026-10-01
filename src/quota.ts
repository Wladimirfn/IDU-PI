import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { unwrapCmdExecutable } from "./cmdline.js";
import { loadIduConfig } from "./config.js";
import type { QuotaSnapshot, QuotaWindow } from "./types.js";

/**
 * Reads quota for the accounts behind the installed CLIs.
 *
 * idu-pi holds no credentials. Every source borrows the session that already
 * exists on this machine: the token or key is read from the CLI's own auth
 * store at probe time, used for exactly one request, and discarded. Nothing in
 * this file returns a credential, writes one, or logs one.
 *
 * Why ask the CLI instead of scraping its files: a CLI knows its own account
 * state, and every CLI here already displays it. Claude answers `/usage` in
 * prose, agy answers in TSV, and two others have an account endpoint that the
 * CLI itself calls. Measured 2026-10-01:
 *
 *   claude  session 9% used, week 57% used
 *   agy     98% weekly on Gemini models, 100% on Claude/GPT
 *   cmdc    5h 0% of 14 credits, week 16% of 35
 *   codex   plan plus, 5h 0%, week 79%, plus per-model availability
 *
 * A CLI with no headless quota path yields a snapshot whose `unknownReason`
 * says so. It never yields zeroes: a 0 meaning "exhausted" and a 0 meaning
 * "not measured" look the same on screen and lead to opposite decisions.
 *
 * Probing is never automatic. Two of the four sources cost a model call to
 * answer, so a caller has to ask for this explicitly.
 */

export interface QuotaSource {
	/** Stable id, also the `source` field of the snapshot. */
	id: string;
	/** The CLI whose credentials and endpoint are used. */
	harness: string;
	/** Whether this machine has what the source needs. Never makes a request. */
	available(): boolean;
	read(now?: number): Promise<QuotaSnapshot>;
}

const UNKNOWN_TEMPLATE = (id: string, harness: string, reason: string, now: number): QuotaSnapshot => ({
	source: id,
	harness,
	billingModel: null,
	plan: null,
	windows: {},
	capturedAt: new Date(now).toISOString(),
	unknownReason: reason,
});

function iso(epochMs: number): string {
	return new Date(epochMs).toISOString();
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

// ---------------------------------------------------------------- codex

/**
 * codex: `GET https://chatgpt.com/backend-api/wham/usage` with the token from
 * `~/.codex/auth.json`. Reports USED percentages and reset times in epoch
 * SECONDS, which is the detail that makes this worth stating: cmdc's reset is
 * in milliseconds, and mixing the two produces a 1970 date.
 */
export function parseCodexUsagePayload(payload: unknown, now: number): QuotaSnapshot {
	const root = asRecord(payload);
	const rateLimit = asRecord(root?.rate_limit);
	if (!rateLimit) {
		return UNKNOWN_TEMPLATE("codex", "codex", "payload sin rate_limit", now);
	}

	const windows: Record<string, QuotaWindow> = {};
	const primaries: Array<[string, Record<string, unknown>]> = [
		["5h", asRecord(rateLimit.primary_window) ?? {}],
		["week", asRecord(rateLimit.secondary_window) ?? {}],
	];
	for (const [label, raw] of primaries) {
		const used = num(raw.used_percent);
		const resetSeconds = num(raw.reset_at);
		windows[label] = {
			remainingPercent: used === null ? null : clampPercent(100 - used),
			resetsAt: resetSeconds === null ? null : iso(resetSeconds * 1000),
			windowSeconds: num(raw.limit_window_seconds),
		};
	}

	return {
		source: "codex",
		harness: "codex",
		// The endpoint is the ChatGPT account endpoint, so this is a plan
		// subscription and not a metered API key. The payload says so too.
		billingModel: "plan",
		plan: typeof root?.plan_type === "string" ? root.plan_type : null,
		windows,
		capturedAt: iso(now),
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

		// The account id is a claim inside the JWT. The usage endpoint needs it
		// to pick the right account when the token spans several.
		let accountId: string | null = null;
		try {
			const claims = asRecord(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()));
			const claim = asRecord(claims?.["https://api.openai.com/auth"]);
			accountId = typeof claim?.chatgpt_account_id === "string" ? claim.chatgpt_account_id : null;
		} catch {
			// A token that is not a JWT is not a reason to skip the request; the
			// account id is only a hint the endpoint may need.
		}
		return { token, accountId };
	} catch {
		return null;
	}
}

export const codexQuotaSource: QuotaSource = {
	id: "codex",
	harness: "codex",
	available: () => readCodexToken() !== null,
	async read(now = Date.now()) {
		const auth = readCodexToken();
		if (!auth) return UNKNOWN_TEMPLATE("codex", "codex", "sin token de sesion en ~/.codex/auth.json", now);

		const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
		if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;

		try {
			const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
			if (!res.ok) return UNKNOWN_TEMPLATE("codex", "codex", `endpoint respondio ${res.status}`, now);
			return parseCodexUsagePayload(await res.json(), now);
		} catch (err) {
			return UNKNOWN_TEMPLATE("codex", "codex", `fallo la consulta: ${(err as Error).message}`, now);
		}
	},
};

// ----------------------------------------------------------------- cmdc

/**
 * cmdc: `GET https://api.commandcode.ai/alpha/billing/credits` with the key
 * from `~/.commandcode/auth.json`. Reports USED over a CAP in credit units, and
 * the reset is epoch MILLISECONDS.
 *
 * This endpoint was found by reading the CLI's own statusline module
 * (`~/.commandcode/mods/cmdc-statusline-plus.ts`), not from documentation. The
 * statusline is the proof that the data is fetchable: something has to fill it.
 */
export function parseCmdcCreditsPayload(payload: unknown, now: number): QuotaSnapshot {
	const root = asRecord(payload);
	const limits = asRecord(root?.windowLimits);
	if (!limits) return UNKNOWN_TEMPLATE("cmdc", "commandcode", "payload sin windowLimits", now);

	const windows: Record<string, QuotaWindow> = {};
	for (const [label, key] of [
		["5h", "fiveHour"],
		["week", "weekly"],
	] as const) {
		const raw = asRecord(limits[key]);
		if (!raw) continue;
		const used = num(raw.used);
		const cap = num(raw.cap);
		// Only compute a percentage when the cap is actually known. A used
		// value without a cap has no denominator, and guessing one is how a
		// 0.0126 credit run turns into "100% used".
		const remaining =
			used !== null && cap !== null && cap > 0 ? clampPercent(100 - (used / cap) * 100) : null;
		const resetMs = num(raw.resetAt);
		windows[label] = { remainingPercent: remaining, resetsAt: resetMs === null ? null : iso(resetMs), windowSeconds: null };
	}

	return {
		source: "cmdc",
		harness: "commandcode",
		billingModel: "plan",
		plan: null,
		windows,
		capturedAt: iso(now),
		unknownReason: null,
	};
}

export const cmdcQuotaSource: QuotaSource = {
	id: "cmdc",
	harness: "commandcode",
	available: () => existsSync(join(homedir(), ".commandcode", "auth.json")),
	async read(now = Date.now()) {
		const path = join(homedir(), ".commandcode", "auth.json");
		if (!existsSync(path)) {
			return UNKNOWN_TEMPLATE("cmdc", "commandcode", "sin ~/.commandcode/auth.json", now);
		}
		try {
			const { apiKey } = asRecord(JSON.parse(readFileSync(path, "utf8"))) ?? {};
			if (typeof apiKey !== "string" || apiKey.length === 0) {
				return UNKNOWN_TEMPLATE("cmdc", "commandcode", "auth.json sin apiKey", now);
			}
			const res = await fetch("https://api.commandcode.ai/alpha/billing/credits", {
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			if (!res.ok) return UNKNOWN_TEMPLATE("cmdc", "commandcode", `endpoint respondio ${res.status}`, now);
			return parseCmdcCreditsPayload(await res.json(), now);
		} catch (err) {
			return UNKNOWN_TEMPLATE("cmdc", "commandcode", `fallo la consulta: ${(err as Error).message}`, now);
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
 * Turns "Oct 1, 11:39pm (America/Santiago)" into an instant.
 *
 * Two passes are enough to settle a DST boundary: the first guess uses the
 * offset that applies at the naive time, the second uses the offset that
 * actually applies at the instant that guess produced. Returns null rather
 * than a guess when the text does not parse, because a plausible wrong reset
 * time is worse than no reset time: it schedules work into a window that is
 * already closed.
 */
export function parseClaudeResetStamp(text: string, now: number): string | null {
	const m = /([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*\(([^)]+)\)/i.exec(text);
	if (!m) return null;
	const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
	if (month === undefined) return null;

	let hour = +m[3] % 12;
	if (/pm/i.test(m[5])) hour += 12;

	// The year is not in the text. A reset already well in the past belongs to
	// next year's window, not to a timestamp twenty years gone.
	let year = new Date(now).getUTCFullYear();
	const build = (y: number) => {
		const naive = Date.UTC(y, month, +m[2], hour, +m[4]);
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
	let stamp = build(year);
	if (stamp === null) return null;
	if (stamp.getTime() < now - 6 * 3_600_000) {
		const next = build(year + 1);
		if (next === null) return null;
		stamp = next;
	}
	return stamp.toISOString();
}

/**
 * claude: `claude -p "/usage"`. Prose, not JSON, and it reports USED.
 *
 * Real output:
 *   Current session: 9% used · resets Oct 1, 11:39pm (America/Santiago)
 *   Current week (all models): 57% used · resets Oct 5, 7:59pm (America/Santiago)
 */
export function parseClaudeUsageText(text: string, now: number): QuotaSnapshot {
	const windows: Record<string, QuotaWindow> = {};
	const line = /^Current\s+(session|week[^:]*):\s*(\d+(?:\.\d+)?)%\s*used\s*[·•]\s*resets\s+(.+)$/gim;

	for (const match of text.matchAll(line)) {
		const label = /^session/i.test(match[1]) ? "5h" : "week";
		const used = Number.parseFloat(match[2]);
		if (!Number.isFinite(used)) continue;
		windows[label] = {
			remainingPercent: clampPercent(100 - used),
			resetsAt: parseClaudeResetStamp(match[3].trim(), now),
			windowSeconds: null,
		};
	}

	if (Object.keys(windows).length === 0) {
		return UNKNOWN_TEMPLATE("claude", "claude", "la salida no contiene lineas de cuota", now);
	}
	return {
		source: "claude",
		harness: "claude",
		// The output itself opens with "using your subscription to power your
		// Claude Code usage", which is the plan telling you which meter it is.
		billingModel: /subscription/i.test(text) ? "plan" : null,
		plan: null,
		windows,
		capturedAt: iso(now),
		unknownReason: null,
	};
}

export const claudeQuotaSource: QuotaSource = {
	id: "claude",
	harness: "claude",
	available: () => existsSync(join(homedir(), ".claude")),
	async read(now = Date.now()) {
		const text = await runProbe("claude", ["-p", "/usage"]);
		return text === null
			? UNKNOWN_TEMPLATE("claude", "claude", "la sonda no devolvio salida", now)
			: parseClaudeUsageText(text, now);
	},
};

// -------------------------------------------------------------------- agy

/**
 * agy: `agy -p "/usage"`. Tab separated, and it reports REMAINING, so nothing
 * is subtracted here. Real output:
 *
 *   Gemini Models	Weekly Limit Remaining	98%	2026-10-07T16:10:50Z
 *   Claude and GPT models	Five Hour Limit Remaining	98%	2026-10-02T02:47:33Z
 *
 * agy separates two meters inside one binary, so the snapshot keys windows by
 * "family:window". A single "5h" number would have hidden that Gemini and
 * Claude draw from different accounts.
 */
export function parseAgyUsageTsv(text: string, now: number): QuotaSnapshot {
	const windows: Record<string, QuotaWindow> = {};
	for (const raw of text.split(/\r?\n/)) {
		const cols = raw.split("\t").map((c) => c.trim());
		if (cols.length < 4) continue;

		const percent = /^(\d+(?:\.\d+)?)%$/.exec(cols[2]);
		if (!percent) continue;
		const windowLabel = /weekly/i.test(cols[1]) ? "week" : /five\s*hour/i.test(cols[1]) ? "5h" : null;
		if (!windowLabel) continue;

		const resetMs = Date.parse(cols[3]);
		const key = `${cols[0]}:${windowLabel}`;
		windows[key] = {
			remainingPercent: clampPercent(Number.parseFloat(percent[1])),
			resetsAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
			windowSeconds: null,
		};
	}

	if (Object.keys(windows).length === 0) {
		return UNKNOWN_TEMPLATE("agy", "antigravity", "la salida no contiene filas de cuota", now);
	}
	return {
		source: "agy",
		harness: "antigravity",
		billingModel: "plan",
		plan: null,
		windows,
		capturedAt: iso(now),
		unknownReason: null,
	};
}

export const agyQuotaSource: QuotaSource = {
	id: "agy",
	harness: "antigravity",
	available: () => existsSync(join(homedir(), ".gemini")),
	async read(now = Date.now()) {
		const text = await runProbe("agy", ["-p", "/usage"]);
		return text === null
			? UNKNOWN_TEMPLATE("agy", "antigravity", "la sonda no devolvio salida", now)
			: parseAgyUsageTsv(text, now);
	},
};

// ------------------------------------------------------------------ probe

/**
 * Runs one CLI's own quota command and returns its raw output.
 *
 * The command path comes from the user's own `~/.idu/config.json`, the same map
 * that decides where a worker runs from, so a probe cannot drift from the
 * binary it is supposed to be asking. `unwrapCmdExecutable` is what makes this
 * work on Windows: `claude.cmd` is an npm shim, not an executable, and spawning
 * one without a shell fails with EINVAL.
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
			{
				timeout: 120_000,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
				shell: resolved.isShell,
			},
			(_err, stdout) => {
				const text = (stdout ?? "").trim();
				resolve(text.length > 0 ? text : null);
			},
		);
	});
}

export const QUOTA_SOURCES: QuotaSource[] = [
	codexQuotaSource,
	cmdcQuotaSource,
	claudeQuotaSource,
	agyQuotaSource,
];

/**
 * Reads every source in parallel and returns one snapshot each. A source that
 * fails returns a snapshot explaining the failure, never a zeroed one, so the
 * caller can tell "cannot answer" from "answered zero".
 */
export async function readQuotaSnapshots(now = Date.now()): Promise<QuotaSnapshot[]> {
	return Promise.all(QUOTA_SOURCES.map((source) => source.read(now)));
}

/** One line per source. Says why, rather than implying a number of zero. */
export function formatQuota(snapshots: QuotaSnapshot[]): string {
	if (snapshots.length === 0) return "quota: sin fuentes configuradas";
	const lines = snapshots.map((s) => {
		if (s.unknownReason) return `  ${s.harness.padEnd(13)} unknown (${s.unknownReason})`;
		const parts = Object.entries(s.windows).map(([label, w]) => {
			const pct = w.remainingPercent === null ? "?" : `${w.remainingPercent}%`;
			const reset = w.resetsAt ? ` -> ${w.resetsAt}` : "";
			return `${label} ${pct} left${reset}`;
		});
		const plan = s.plan ? ` [${s.plan}]` : "";
		return `  ${s.harness.padEnd(13)}${plan} ${parts.join(" | ")}`;
	});
	return `quota (remaining, read from each CLI's own account):\n${lines.join("\n")}`;
}
