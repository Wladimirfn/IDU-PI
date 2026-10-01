import test from "node:test";
import assert from "node:assert/strict";
import {
	parseCodexUsagePayload,
	parseCmdcCreditsPayload,
	parseClaudeUsageText,
	parseClaudeResetStamp,
	parseAgyUsageTsv,
	formatQuota,
} from "../src/quota.js";

/**
 * Every fixture below is a real payload, captured on 2026-10-01 from this
 * machine. Nothing here touches the network: the parsers are pure, and that is
 * the property that makes them testable at all. The live sources are a
 * separate concern and the reason the parsing lives apart from the fetching.
 */

const FIXED_NOW = Date.parse("2026-10-01T20:00:00Z");

// ------------------------------------------------------------------ codex

// Verbatim shape from GET chatgpt.com/backend-api/wham/usage, with the
// session token planted in the payload on purpose so the last test can prove
// the parser does not carry it through.
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
	access_token: "sk-planted-credential-that-must-not-escape",
};

test("codex: used percentages become REMAINING and epoch seconds become ISO", () => {
	const snap = parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW);

	assert.equal(snap.source, "codex");
	assert.equal(snap.billingModel, "plan");
	assert.equal(snap.plan, "plus");
	assert.equal(snap.unknownReason, null);

	// 0% used is 100% remaining. Getting this backwards is the single most
	// dangerous bug in this file, and it is silent.
	assert.equal(snap.windows["5h"].remainingPercent, 100);
	assert.equal(snap.windows["week"].remainingPercent, 21);

	// 1790911264 is epoch SECONDS for codex. Read as milliseconds it would land
	// in 1970, which is how these two providers' units get mixed up.
	assert.equal(snap.windows["5h"].resetsAt, new Date(1790911264 * 1000).toISOString());
	assert.equal(snap.windows["5h"].windowSeconds, 18000);
	assert.equal(snap.windows["week"].windowSeconds, 604800);
});

test("codex: a payload without rate_limit is unknown, never zero", () => {
	const snap = parseCodexUsagePayload({ plan_type: "plus" }, FIXED_NOW);

	assert.deepEqual(snap.windows, {});
	assert.ok(snap.unknownReason, "an unanswerable probe must say so");
	// All-or-nothing on purpose. Reporting a plan name next to an empty window
	// list reads like a partial answer, and a caller might treat it as one.
	assert.equal(snap.plan, null);
});

test("codex: a missing used_percent leaves that window null rather than 0", () => {
	const snap = parseCodexUsagePayload(
		{ plan_type: "plus", rate_limit: { primary_window: { limit_window_seconds: 18000 } } },
		FIXED_NOW,
	);
	assert.equal(snap.windows["5h"].remainingPercent, null);
	assert.equal(snap.windows["5h"].resetsAt, null);
});

// ------------------------------------------------------------------- cmdc

// Verbatim shape from GET api.commandcode.ai/alpha/billing/credits. Note the
// reset is epoch MILLISECONDS here, unlike codex.
const CMDC_FIXTURE = {
	limited: {},
	exceeded: null,
	fiveHour: null,
	windowLimits: {
		fiveHour: { used: 0.012596241, cap: 14, resetAt: 1790909797296 },
		weekly: { used: 5.6167867396, cap: 35, resetAt: 1791060927610 },
	},
	apiKey: "cc-planted-credential-that-must-not-escape",
};

test("cmdc: used over cap becomes REMAINING, milliseconds stay milliseconds", () => {
	const snap = parseCmdcCreditsPayload(CMDC_FIXTURE, FIXED_NOW);

	assert.equal(snap.source, "cmdc");
	assert.equal(snap.unknownReason, null);
	// 0.0126 of 14 credits is 0.09% spent, so 99.91% left. Rounding that up to
	// a clean 100 would be the kind of tidy lie this file exists to avoid.
	assert.equal(snap.windows["5h"].remainingPercent, 99.91);
	assert.equal(snap.windows["week"].remainingPercent, 83.95);

	// 1790909797296 is already milliseconds. Dividing it by 1000 would report a
	// reset in 1970 and send the caller to a window that closed long ago.
	assert.equal(snap.windows["5h"].resetsAt, new Date(1790909797296).toISOString());
	assert.equal(snap.windows["week"].resetsAt, new Date(1791060927610).toISOString());
});

test("cmdc: used without a cap is null, not zero and not a guess", () => {
	const snap = parseCmdcCreditsPayload(
		{ windowLimits: { fiveHour: { used: 3, resetAt: 1790909797296 } } },
		FIXED_NOW,
	);
	// No denominator means no percentage. A 0 here would read as "exhausted"
	// and route work away from a model with three credits left.
	assert.equal(snap.windows["5h"].remainingPercent, null);
	assert.equal(snap.windows["5h"].resetsAt, new Date(1790909797296).toISOString());
});

test("cmdc: a payload without windowLimits is unknown", () => {
	const snap = parseCmdcCreditsPayload({ credits: { balance: "0" } }, FIXED_NOW);
	assert.deepEqual(snap.windows, {});
	assert.ok(snap.unknownReason);
});

// ---------------------------------------------------------- cross-source

test("both directions agree: a USED provider and a REMAINING provider report the same state", () => {
	// The whole reason QuotaWindow is documented as "always remaining". Same
	// account state, expressed two ways: codex says 21% used, agy says 79%
	// remaining. If either parser flips sign, this is the test that fails.
	const codex = parseCodexUsagePayload(
		{ plan_type: "plus", rate_limit: { secondary_window: { used_percent: 21 } } },
		FIXED_NOW,
	);
	const agy = parseAgyUsageTsv(
		"Gemini Models\tWeekly Limit Remaining\t79%\t2026-10-07T16:10:50Z",
		FIXED_NOW,
	);

	assert.equal(codex.windows["week"].remainingPercent, 79);
	assert.equal(agy.windows["Gemini Models:week"].remainingPercent, 79);
});

test("no parser carries a credential through", () => {
	// Both fixtures above carry a planted secret. A parser that echoed the
	// payload, or a snapshot type with a spare field, would leak it into logs
	// and into anything that serialises capabilities.
	for (const snap of [
		parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW),
		parseCmdcCreditsPayload(CMDC_FIXTURE, FIXED_NOW),
	]) {
		const serialised = JSON.stringify(snap);
		assert.doesNotMatch(serialised, /sk-planted/);
		assert.doesNotMatch(serialised, /cc-planted/);
		assert.doesNotMatch(serialised, /credential/);
	}
});

// ------------------------------------------------------------------ agy

// Verbatim output of `agy -p /usage`.
const AGY_FIXTURE = [
	"Gemini Models\tWeekly Limit Remaining\t98%\t2026-10-07T16:10:50Z",
	"Gemini Models\tFive Hour Limit Remaining\t98%\t2026-10-02T02:47:33Z",
	"Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-08T22:05:18Z",
	"Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-02T03:05:18Z",
].join("\n");

test("agy: TSV rows parse and keep two separate meters apart", () => {
	const snap = parseAgyUsageTsv(AGY_FIXTURE, FIXED_NOW);

	assert.equal(snap.source, "agy");
	assert.equal(snap.harness, "antigravity");
	assert.equal(snap.unknownReason, null);

	// agy already reports remaining, so nothing is subtracted.
	assert.equal(snap.windows["Gemini Models:week"].remainingPercent, 98);
	assert.equal(snap.windows["Gemini Models:5h"].remainingPercent, 98);
	assert.equal(snap.windows["Claude and GPT models:week"].remainingPercent, 100);

	// The key carries the family because these are two different accounts
	// inside one binary. Collapsing them into a single "week" would hide that.
	assert.equal(Object.keys(snap.windows).length, 4);
	assert.ok(!("week" in snap.windows));

	assert.equal(snap.windows["Gemini Models:week"].resetsAt, "2026-10-07T16:10:50.000Z");
});

test("agy: prose or noise is unknown, not a zeroed table", () => {
	const snap = parseAgyUsageTsv("Error: unknown command '/usage'", FIXED_NOW);
	assert.deepEqual(snap.windows, {});
	assert.ok(snap.unknownReason);
});

// ---------------------------------------------------------------- claude

// Verbatim output of `claude -p /usage`.
const CLAUDE_FIXTURE = [
	"You are currently using your subscription to power your Claude Code usage",
	"",
	"Current session: 9% used · resets Oct 1, 11:39pm (America/Santiago)",
	"Current week (all models): 57% used · resets Oct 5, 7:59pm (America/Santiago)",
].join("\n");

test("claude: prose lines parse, used becomes remaining, billing model comes from the text", () => {
	const snap = parseClaudeUsageText(CLAUDE_FIXTURE, FIXED_NOW);

	assert.equal(snap.source, "claude");
	assert.equal(snap.billingModel, "plan", "the first line says it is a subscription");
	assert.equal(snap.unknownReason, null);

	assert.equal(snap.windows["5h"].remainingPercent, 91);
	assert.equal(snap.windows["week"].remainingPercent, 43);
});

test("claude: the reset stamp round-trips through the zone it names", () => {
	const isoOut = parseClaudeResetStamp("Oct 1, 11:39pm (America/Santiago)", FIXED_NOW);
	assert.ok(isoOut, "a well formed stamp must parse");

	// Read it back in the same zone. Asserting the round trip rather than a
	// hardcoded UTC string keeps this correct across DST: the zone's offset
	// changes, and a test that froze the UTC side would be wrong twice a year.
	const back = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Santiago",
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(isoOut));
	assert.match(back, /10\/01\/2026/, `round trip landed on ${back}`);
	assert.match(back, /23:39/, `round trip landed on ${back}`);
});

test("claude: an unparseable stamp yields null rather than a plausible wrong date", () => {
	assert.equal(parseClaudeResetStamp("soon", FIXED_NOW), null);
	assert.equal(parseClaudeResetStamp("Oct 1, 11:39pm (Not/AZone)", FIXED_NOW), null);
	assert.equal(parseClaudeResetStamp("Fbr 1, 11:39pm (America/Santiago)", FIXED_NOW), null);
});

test("claude: output without quota lines is unknown", () => {
	const snap = parseClaudeUsageText("Error: not logged in", FIXED_NOW);
	assert.deepEqual(snap.windows, {});
	assert.ok(snap.unknownReason);
});

// --------------------------------------------------------------- format

test("formatQuota states the reason for an unknown source instead of showing a zero", () => {
	const out = formatQuota([
		parseCodexUsagePayload(CODEX_FIXTURE, FIXED_NOW),
		parseAgyUsageTsv("Error: unknown command '/usage'", FIXED_NOW),
	]);

	assert.match(out, /codex.*5h 100% left/s, out);
	// The agy line has to name its failure. A bare "0%" is indistinguishable
	// from a model that is genuinely out of credit.
	assert.match(out, /antigravity\s+unknown \(/s, out);
	assert.doesNotMatch(out, /antigravity\s+0%/s, out);
});

test("formatQuota renders a missing percentage as ?, not 0", () => {
	const out = formatQuota([
		parseCmdcCreditsPayload({ windowLimits: { weekly: { used: 3, resetAt: 1791060927610 } } }, FIXED_NOW),
	]);
	assert.match(out, /week \? left/, out);
});
