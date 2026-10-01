import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseCodexUsagePayload,
	parseCmdcCreditsPayload,
	parseClaudeUsageText,
	parseClaudeResetStamp,
	parseAgyUsageTsv,
	formatQuota,
	readCacheIfFresh,
	writeCache,
	QUOTA_CACHE_TTL_MS,
} from "../src/quota.js";
import { readJsonFile } from "../src/json-file.js";
import type { QuotaSnapshot, QuotaWindow } from "../src/types.js";

/**
 * Every fixture below is a real payload, captured on 2026-10-01 from this
 * machine. Nothing here touches the network: the parsers are pure, and that is
 * what makes them testable at all.
 */

const FIXED_NOW = Date.parse("2026-10-01T20:00:00Z");

/** The windows of a snapshot's single meter, or {} when there is none. */
function onlyMeterWindows(snap: QuotaSnapshot): Record<string, QuotaWindow> {
	const meters = Object.values(snap.meters);
	return meters.length === 1 ? meters[0].windows : {};
}

// ------------------------------------------------------------------ codex

// Verbatim shape from GET chatgpt.com/backend-api/wham/usage, with a session
// token planted on purpose so the credential tests have something to catch.
const CODEX_FIXTURE = {
	user_id: "user_abc",
	plan_type: "plus",
	credits: { has_credits: false, balance: "0" },
	rate_limit: {
		allowed: true,
		limit_reached: false,
		primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1790911264 },
		secondary_window: { used_percent: 79, limit_window_seconds: 604800, reset_at: 1791058224 },
	},
	model_usage: {
		"gpt-6-astra": { available: true, available_at: null, credits_would_enable: false },
		"gpt-5.6-luna": { available: false, available_at: null, credits_would_enable: true },
	},
	access_token: "sk-planted-credential-that-must-not-escape",
};

test("codex: used becomes REMAINING, epoch seconds become ISO, and resetsInSeconds agrees", () => {
	const snap = parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW);
	const windows = onlyMeterWindows(snap);

	assert.equal(snap.source, "codex");
	assert.equal(snap.billingModel, "plan");
	assert.equal(snap.plan, "plus");
	assert.equal(snap.unknownReason, null);

	// 0% used is 100% remaining. Getting this backwards is the most dangerous
	// bug in this file, and it is silent.
	assert.equal(windows["5h"].remainingPercent, 100);
	assert.equal(windows["week"].remainingPercent, 21);

	// 1790911264 is epoch SECONDS for codex. Read as milliseconds it lands in
	// 1970, which is how these two providers' units get mixed up.
	assert.equal(windows["5h"].resetsAt, new Date(1790911264 * 1000).toISOString());
	assert.equal(windows["5h"].windowSeconds, 18000);
	assert.equal(windows["week"].windowSeconds, 604800);

	// The relative field must be consistent with the absolute one, or a caller
	// choosing between them gets two different answers.
	assert.equal(windows["5h"].resetsInSeconds, Math.round((1790911264 * 1000 - FIXED_NOW) / 1000));
});

test("codex: per-model availability is kept, not flattened away", () => {
	const snap = parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW);
	const models = snap.meters["plan"].models;

	assert.ok(models, "codex answers per model and nothing else does; that has to survive parsing");
	assert.equal(models["gpt-6-astra"].available, true);
	assert.equal(models["gpt-5.6-luna"].available, false);
	// Unavailable-because-it-needs-credits is a different fact from unavailable.
	assert.equal(models["gpt-5.6-luna"].note, "requiere créditos");
});

test("codex: an impossible reset leaves that field null and keeps the window", () => {
	// 0 and 1e300 both survive `new Date()` or explode on it. 1e300 used to
	// throw a RangeError that discarded the whole source, taking the valid
	// window with it; 0 used to report a reset in 1970, which is worse than
	// none because a caller may schedule against it.
	for (const resetAt of [0, -1, 1e300, 9e15]) {
		const snap = parseCodexUsagePayload(
			{ plan_type: "plus", rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: resetAt } } },
			FIXED_NOW,
		);
		const windows = onlyMeterWindows(snap);
		assert.equal(windows["5h"].remainingPercent, 90, `percentage survived reset_at=${resetAt}`);
		assert.equal(windows["5h"].resetsAt, null, `reset_at=${resetAt} must not become a date`);
		assert.equal(windows["5h"].resetsInSeconds, null);
	}
});

test("codex: a payload without rate_limit is unknown, never zero", () => {
	const snap = parseCodexUsagePayload({ plan_type: "plus" }, FIXED_NOW);
	assert.deepEqual(snap.meters, {});
	assert.ok(snap.unknownReason);
	// All-or-nothing on purpose: a plan name beside an empty meter reads like a
	// partial answer, and a caller might treat it as one.
	assert.equal(snap.plan, null);
});

// ------------------------------------------------------------------- cmdc

// Verbatim shape from GET api.commandcode.ai/alpha/billing/credits. The reset
// here is epoch MILLISECONDS, unlike codex.
const CMDC_FIXTURE = {
	limited: {},
	exceeded: null,
	windowLimits: {
		fiveHour: { used: 0.012596241, cap: 14, resetAt: 1790909797296 },
		weekly: { used: 5.6167867396, cap: 35, resetAt: 1791060927610 },
	},
	apiKey: "cc-planted-credential-that-must-not-escape",
};

test("cmdc: used over cap becomes REMAINING, milliseconds stay milliseconds", () => {
	const snap = parseCmdcCreditsPayload(CMDC_FIXTURE, FIXED_NOW);
	const windows = onlyMeterWindows(snap);

	assert.equal(snap.source, "cmdc");
	assert.equal(snap.unknownReason, null);
	// 0.0126 of 14 credits is 0.09% spent. Rounding that to a clean 100 would
	// be the kind of tidy lie this file exists to avoid.
	assert.equal(windows["5h"].remainingPercent, 99.91);
	assert.equal(windows["week"].remainingPercent, 83.95);

	// 1790909797296 is already milliseconds. Dividing by 1000 would report a
	// reset in 1970.
	assert.equal(windows["5h"].resetsAt, new Date(1790909797296).toISOString());
	assert.equal(windows["week"].resetsAt, new Date(1791060927610).toISOString());
});

test("cmdc: a lone window with used but no cap is unknown, not zero and not a guess", () => {
	// No denominator means no percentage, and a meter whose every window lacks
	// one has nothing to say, so it is reported as unknown with a reason rather
	// than as a table of question marks. The partly-readable case, where one
	// window has a cap and another does not, is covered under formatQuota.
	const snap = parseCmdcCreditsPayload({ windowLimits: { fiveHour: { used: 3, resetAt: 1790909797296 } } }, FIXED_NOW);

	assert.deepEqual(snap.meters, {});
	assert.ok(snap.unknownReason);
	assert.doesNotMatch(snap.unknownReason, /0%/);
});

test("cmdc: an empty windowLimits is unknown with a reason, not a blank line", () => {
	// This exact shape printed a line with neither a figure nor a reason, which
	// is the one output the module's own type says must not exist.
	for (const payload of [
		{ windowLimits: {} },
		{ windowLimits: { fiveHour: null } },
		{ windowLimits: { fiveHour: {}, weekly: {} } },
	]) {
		const snap = parseCmdcCreditsPayload(payload, FIXED_NOW);
		assert.deepEqual(snap.meters, {}, JSON.stringify(payload));
		assert.ok(snap.unknownReason, `no stated reason for ${JSON.stringify(payload)}`);
		assert.equal(snap.billingModel, null);
	}
});

// ------------------------------------------------------------------ cache

test("a corrupt JSON file yields null, never a message quoting its contents", () => {
	// This is the shape of the blocking finding: JSON.parse embeds the raw text
	// around the failure, and in ~/.commandcode/auth.json that text is the key.
	// A reader that surfaces the error would put "cc-LEAKME-" into `idu quota`
	// output and into the MCP JSON.
	const dir = mkdtempSync(join(tmpdir(), "idu-quota-"));
	try {
		const path = join(dir, "auth.json");
		writeFileSync(path, '{"apiKey": cc-LEAKME-PLEASE-NOT}', "utf8");

		assert.equal(readJsonFile(path), null);

		// And the reason the sources use for that case is a fixed string, so
		// there is nothing in it that came from the file.
		const snap = parseCodexUsagePayload({ plan_type: "plus" }, FIXED_NOW);
		assert.doesNotMatch(snap.unknownReason ?? "", /LEAKME/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("no parser carries a credential through", () => {
	// Both fixtures above carry a planted secret. A parser that echoed the
	// payload, or a snapshot with a spare field, would leak it into logs and
	// into anything that serialises capabilities.
	for (const snap of [
		parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW),
		parseCmdcCreditsPayload(CMDC_FIXTURE, FIXED_NOW),
	]) {
		const serialised = JSON.stringify(snap);
		assert.doesNotMatch(serialised, /sk-planted/);
		assert.doesNotMatch(serialised, /cc-planted/);
		assert.doesNotMatch(serialised, /credential-that/);
	}
});

test("a warm cache returns the same reading, marked as a cache hit", () => {
	// Exercised through the pure cache helpers rather than through
	// readQuotaSnapshots, because that would probe four live accounts and spend
	// six model calls. A unit test that hits the wire is not a unit test.
	const dir = mkdtempSync(join(tmpdir(), "idu-quota-cache-"));
	const cachePath = join(dir, "quota-cache.json");
	try {
		const fresh = [parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW)];

		assert.equal(readCacheIfFresh(cachePath, FIXED_NOW, QUOTA_CACHE_TTL_MS), null, "a cold cache is a miss");

		writeCache(cachePath, fresh, FIXED_NOW);
		const warm = readCacheIfFresh(cachePath, FIXED_NOW + 5_000, QUOTA_CACHE_TTL_MS);
		assert.ok(warm, "a warm cache is a hit");
		assert.ok(warm.every((s) => s.stale), "a cache hit must be labelled as such");
		assert.deepEqual(
			warm.map((s) => s.capturedAt),
			fresh.map((s) => s.capturedAt),
		);

		// Past the TTL it misses again, which is the point of having one: ten
		// minutes is shorter than every window these providers report.
		assert.equal(
			readCacheIfFresh(cachePath, FIXED_NOW + QUOTA_CACHE_TTL_MS + 1, QUOTA_CACHE_TTL_MS),
			null,
			"a stale cache must not answer",
		);

		// A clock that went backwards must not serve a future reading either.
		assert.equal(readCacheIfFresh(cachePath, FIXED_NOW - 60_000, QUOTA_CACHE_TTL_MS), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------- cross-source

test("both directions agree: a USED provider and a REMAINING provider report the same state", () => {
	// The reason QuotaWindow is documented as "always remaining". codex says
	// 21% used, agy says 79% remaining. If either parser flips sign, this is
	// the test that fails.
	const codex = onlyMeterWindows(
		parseCodexUsagePayload({ plan_type: "plus", rate_limit: { secondary_window: { used_percent: 21 } } }, FIXED_NOW),
	);
	const agy = parseAgyUsageTsv("Gemini Models\tWeekly Limit Remaining\t79%\t2026-10-07T16:10:50Z", FIXED_NOW);

	assert.equal(codex["week"].remainingPercent, 79);
	assert.equal(agy.meters["gemini-models"].windows["week"].remainingPercent, 79);
});

test("out-of-range percentages are clamped, never wrapped", () => {
	// A provider that reports 140% used is broken. Clamping says "spent";
	// wrapping to -40 would be a negative balance, which reads as generous.
	const used = onlyMeterWindows(
		parseCodexUsagePayload({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 140 } } }, FIXED_NOW),
	);
	assert.equal(used["5h"].remainingPercent, 0);

	const negative = onlyMeterWindows(
		parseCodexUsagePayload({ plan_type: "plus", rate_limit: { primary_window: { used_percent: -30 } } }, FIXED_NOW),
	);
	assert.equal(negative["5h"].remainingPercent, 100);
});

// ------------------------------------------------------------------ agy

// Verbatim output of `agy -p /usage`.
const AGY_FIXTURE = [
	"Gemini Models\tWeekly Limit Remaining\t98%\t2026-10-07T16:10:50Z",
	"Gemini Models\tFive Hour Limit Remaining\t98%\t2026-10-02T02:47:33Z",
	"Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-08T22:05:18Z",
	"Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-02T03:05:18Z",
].join("\n");

test("agy: two meters with the same window labels, kept apart", () => {
	const snap = parseAgyUsageTsv(AGY_FIXTURE, FIXED_NOW);

	assert.equal(snap.source, "agy");
	assert.equal(snap.harness, "antigravity");
	assert.equal(snap.unknownReason, null);

	// agy already reports remaining, so nothing is subtracted.
	assert.equal(snap.meters["gemini-models"].windows["week"].remainingPercent, 98);
	assert.equal(snap.meters["gemini-models"].windows["5h"].remainingPercent, 98);
	assert.equal(snap.meters["claude-and-gpt-models"].windows["week"].remainingPercent, 100);

	// The separation is the point. Flattening these into "Gemini Models:5h"
	// made windows["5h"] undefined for this harness, and buried the axis a
	// caller needs: which pool is draining.
	assert.equal(Object.keys(snap.meters).length, 2);
	assert.ok(snap.meters["gemini-models"].windows["5h"], "5h is addressable on its own meter");
	assert.ok(snap.meters["claude-and-gpt-models"].windows["5h"]);

	assert.equal(snap.meters["gemini-models"].windows["week"].resetsAt, "2026-10-07T16:10:50.000Z");
});

test("agy: a percentage with a space before the sign still parses", () => {
	const snap = parseAgyUsageTsv("Gemini Models\tWeekly Limit Remaining\t98 %\t2026-10-07T16:10:50Z", FIXED_NOW);
	assert.equal(snap.meters["gemini-models"].windows["week"].remainingPercent, 98);
});

test("agy: rows it cannot read become unknown, not a table of nulls", () => {
	for (const text of [
		"Error: unknown command '/usage'",
		"Gemini Models Weekly Limit Remaining 98% 2026-10-07T16:10:50Z", // spaces, no tabs
		"Gemini Models\tWeekly\tnot-a-number\t2026-10-07T16:10:50Z",
	]) {
		const snap = parseAgyUsageTsv(text, FIXED_NOW);
		assert.deepEqual(snap.meters, {}, text);
		assert.ok(snap.unknownReason, `no stated reason for: ${text}`);
	}
});

// ---------------------------------------------------------------- claude

// Verbatim output of `claude -p /usage`. The weekly line has NO MINUTES, which
// is the detail that a regex written from the session line alone gets wrong.
const CLAUDE_FIXTURE = [
	"You are currently using your subscription to power your Claude Code usage",
	"",
	"Current session: 16% used · resets Oct 1, 11:40pm (America/Santiago)",
	"Current week (all models): 58% used · resets Oct 5, 8pm (America/Santiago)",
].join("\n");

test("claude: both windows parse, including the one whose hour has no minutes", () => {
	const snap = parseClaudeUsageText(CLAUDE_FIXTURE, FIXED_NOW);
	const windows = onlyMeterWindows(snap);

	assert.equal(snap.source, "claude");
	assert.equal(snap.billingModel, "plan", "the first line says it is a subscription");
	assert.equal(snap.unknownReason, null);

	assert.equal(windows["5h"].remainingPercent, 84);
	assert.equal(windows["week"].remainingPercent, 42);

	// "8pm" has to become 20:00 local. A regex that demanded H:MM dropped this
	// one to null while still reporting the percentage, so the failure was
	// invisible in the number the caller was reading.
	const weekReset = windows["week"].resetsAt;
	assert.ok(weekReset, "a bare 8pm is a valid reset time, not a missing one");
	const back = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Santiago", hour12: false,
		year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
	}).format(new Date(weekReset));
	assert.match(back, /10\/05\/2026/, back);
	assert.match(back, /20:00/, back);
});

test("claude: the reset stamp round-trips through the zone it names", () => {
	const isoOut = parseClaudeResetStamp("Oct 1, 11:39pm (America/Santiago)", FIXED_NOW);
	assert.ok(isoOut, "a well formed stamp must parse");

	// Assert the round trip rather than a hardcoded UTC string: the zone's
	// offset changes with DST, and a test frozen on the UTC side would be wrong
	// twice a year.
	const back = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Santiago", hour12: false,
		year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
	}).format(new Date(isoOut));
	assert.match(back, /10\/01\/2026/, `round trip landed on ${back}`);
	assert.match(back, /23:39/, `round trip landed on ${back}`);
});

test("claude: an impossible stamp is rejected, not normalised into a wrong date", () => {
	// "Oct 32" used to roll over to November 2nd and "25:99pm" to 17:39. A
	// plausible wrong reset is worse than none: it schedules work into a window
	// that is already closed.
	for (const stamp of [
		"Oct 32, 8pm (America/Santiago)",
		"Oct 1, 25:99pm (America/Santiago)",
		"Oct 1, 0pm (America/Santiago)",
		"Oct 1, 8:61pm (America/Santiago)",
		"Oct 0, 8pm (America/Santiago)",
		"Oct 1, 8pm (Not/AZone)",
		"Fbr 1, 8pm (America/Santiago)",
		"soon",
		"Oct 1, 8pm",
	]) {
		assert.equal(parseClaudeResetStamp(stamp, FIXED_NOW), null, `should have been rejected: ${stamp}`);
	}
});

test("claude: twelve am and pm are not confused", () => {
	const noon = parseClaudeResetStamp("Oct 1, 12:00pm (America/Santiago)", FIXED_NOW);
	const midnight = parseClaudeResetStamp("Oct 2, 12:00am (America/Santiago)", FIXED_NOW);
	assert.ok(noon && midnight);
	assert.notEqual(noon, midnight);
	assert.ok(new Date(noon).getTime() < new Date(midnight).getTime());
});

test("claude: output without quota lines is unknown", () => {
	const snap = parseClaudeUsageText("Error: not logged in", FIXED_NOW);
	assert.deepEqual(snap.meters, {});
	assert.ok(snap.unknownReason);
});

// --------------------------------------------------------------- format

test("formatQuota states the reason for an unknown source instead of showing a zero", () => {
	const out = formatQuota([
		parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW),
		parseAgyUsageTsv("Error: unknown command '/usage'", FIXED_NOW),
	]);

	assert.match(out, /5h 100% left/, out);
	// The agy line has to name its failure. A bare "0%" is indistinguishable
	// from a model that is genuinely out of credit.
	assert.match(out, /antigravity\s+unknown — \S/, out);
	assert.doesNotMatch(out, /antigravity\s+\d+% left/, out);
});

test("formatQuota renders one window's missing percentage as ?, not 0", () => {
	// A meter can be partly readable. The 5h window has a cap, the weekly one
	// does not, so the weekly percentage is genuinely unknown and prints as a
	// question mark. The meter as a whole still has something to say, so it is
	// not degraded to `unknown`.
	const out = formatQuota([
		parseCmdcCreditsPayload(
			{
				windowLimits: {
					fiveHour: { used: 1, cap: 10, resetAt: 1790909797296 },
					weekly: { used: 3, resetAt: 1791060927610 },
				},
			},
			FIXED_NOW,
		),
	]);
	assert.match(out, /5h 90% left/, out);
	assert.match(out, /week \? left/, out);
	assert.doesNotMatch(out, /unknown/, out);
});

test("formatQuota shows the billing kind, because 21% of a plan is not 21% of money", () => {
	const out = formatQuota([parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW)]);
	assert.match(out, /plan \(no es dinero\)/, out);
	// And it is a plan, so the percentage reads against a rate limit that
	// refills on its own rather than against a balance being spent down.
	assert.match(out, /plus/, out);
});

test("formatQuota orders the short window before the weekly one, consistently", () => {
	// codex emitted primary before secondary and agy the other way round. A
	// human reading two lines should not have to relearn the order each time.
	const out = formatQuota([parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW), parseAgyUsageTsv(AGY_FIXTURE, FIXED_NOW)]);
	const agyBlock = out.slice(out.indexOf("antigravity"));
	assert.ok(agyBlock.indexOf("5h") < agyBlock.indexOf("week"), agyBlock);
});

test("formatQuota says when it is reading a cache", () => {
	const stale = { ...parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW), stale: true };
	assert.match(formatQuota([stale]), /\[cache\]/);
});

test("formatQuota lists a model that is unavailable right now", () => {
	const out = formatQuota([parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW)]);
	assert.match(out, /modelos no disponibles ahora: gpt-5\.6-luna/, out);
});

test("codex with no percentages is unknown, not a table of question marks", () => {
	// If codex ever renames used_percent, rate_limit still arrives and the
	// windows would print as "5h ? left". A question mark next to no reason
	// reads like a zero quota, which is the one output this layer exists to
	// make impossible. cmdc already fails this way; codex now does too.
	const renamed = parseCodexUsagePayload(
		{ plan_type: "plus", rate_limit: { primary_window: {}, secondary_window: {} } },
		FIXED_NOW,
	);
	assert.equal(renamed.unknownReason, "la respuesta no trajo porcentajes de cuota");
	assert.match(formatQuota([renamed]), /unknown — la respuesta no trajo porcentajes/);
});

test("a cache full of unusable entries is a miss, not a crash", () => {
	// Valid JSON with the wrong shape is still valid JSON. It must not reach
	// the formatter as a snapshot with no `meters` and take the command down.
	const dir = mkdtempSync(join(tmpdir(), "idu-quota-shape-"));
	const path = join(dir, "quota-cache.json");
	try {
		writeFileSync(path, JSON.stringify({ version: 1, cachedAt: new Date(FIXED_NOW).toISOString(), snapshots: [{}] }));
		assert.equal(readCacheIfFresh(path, FIXED_NOW, QUOTA_CACHE_TTL_MS), null);

		// One good entry among the bad is still worth reading.
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				cachedAt: new Date(FIXED_NOW).toISOString(),
				snapshots: [{}, parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW)],
			}),
		);
		const mixed = readCacheIfFresh(path, FIXED_NOW, QUOTA_CACHE_TTL_MS);
		assert.equal(mixed?.length, 1);
		assert.equal(mixed?.[0].source, "codex");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
