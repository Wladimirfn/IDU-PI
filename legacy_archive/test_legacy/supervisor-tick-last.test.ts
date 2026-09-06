import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runCliCommand } from "../src/cli.js";
import {
	formatLastTick,
	parseLastTick,
	TickParseError,
} from "../src/supervisor-tick-last.js";

const START_TS = "2026-08-09T14:46:48-04:00";
const NOW_TS = "2026-08-09T14:49:48-04:00";

// Hermetic env for the in-process CLI: loadConfig fails fast with
// "Missing required env var: DEFAULT_CWD" (#487) before the handler can
// run, and it stats DEFAULT_CWD — so it must be a REAL directory.
// Locally a developer shell already has it; clean CI does not.
const HERMETIC_CWD = mkdtempSync(join(tmpdir(), "tick-last-cwd-"));
process.env.DEFAULT_CWD = process.env.DEFAULT_CWD ?? HERMETIC_CWD;
process.env.ALLOWED_ROOTS = process.env.ALLOWED_ROOTS ?? HERMETIC_CWD;

// Clean up the temp dirs THIS FILE created — tracked by path, never by
// globbing tmpdir() for a prefix. A prefix sweep deletes directories the
// run does not own: with two concurrent runs of this file (a mutation
// battery alongside `pnpm test`), one run empties the other's in-use dirs
// and the failure surfaces with no visible cause. Measured: a foreign
// `tick-last-*` dir created before the suite was gone after it.
// The leak-guard in CI fails the suite if temp entries grow without cleanup.
const createdTempDirs: string[] = [HERMETIC_CWD];

after(() => {
	for (const dir of createdTempDirs) {
		try {
			rmSync(dir, { recursive: true });
		} catch (err) {
			// Not `force: true`: that swallows ENOTEMPTY/EBUSY, which in this
			// repo is the known shape of a deferred write rehydrating a
			// directory after teardown. The leak-guard is the enforcement
			// layer; this line is the diagnosis.
			const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
			process.stderr.write(`[tick-last-cleanup] ${code}: ${dir}\n`);
		}
	}
});

function makeTempLog(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "tick-last-"));
	createdTempDirs.push(dir);
	const path = join(dir, "supervisor-tick.log");
	writeFileSync(path, content);
	return path;
}

function tickLine(ts: string, content: string): string {
	return `${ts} ${content}`;
}

type BuildOpts = {
	changedFiles?: number;
	sensorImpulses?: number;
	addWatermark?: boolean;
	unknownCronField?: boolean;
	unknownOutputField?: boolean;
	warnings?: string[];
	blockingInjection?: boolean;
	shouldEscalate?: boolean;
	escalationCritical?: number;
	escalationTotal?: number;
	dwe0190?: boolean;
};

function buildTick(ts: string, opts: BuildOpts = {}): string[] {
	const lines: string[] = [];
	lines.push(tickLine(ts, "STEP Idu-pi supervisor tick - interval=60min, trigger_engine=0"));
	lines.push(tickLine(ts, "interval_minutes=60 trigger_engine=0"));
	lines.push(tickLine(ts, "automaticov1_exit=0"));
	let cron = `cron_preflight_exit=0 changed_files=${opts.changedFiles ?? 0}`;
	if (opts.addWatermark) cron += " watermark_sha=dc9614f5b watermark_base=dc9614f5b";
	if (opts.unknownCronField) cron += " some_future_field=42";
	lines.push(tickLine(ts, cron));
	let output = `cron_preflight_output: Cron preflight: sensorImpulses=${opts.sensorImpulses ?? 0} supervisorAdvisory=null`;
	if (opts.dwe0190) output = `(node:73908) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true` + " | " + output;
	if (opts.unknownOutputField) output += " extra_output_token=1";
	lines.push(tickLine(ts, output));
	let pending = "pending_injections_query: Pending Injections ? count=5 ack=false |";
	if (opts.blockingInjection) pending += " | ? BLOCKING: warning objective_reminder ? pull `idu_pending_injections` and act";
	const objSeverity = opts.blockingInjection ? "warning" : "info";
	pending += " |   - hygiene_sensor severity=info summary=\"junk file\"";
	pending += ` |   - objective_reminder severity=${objSeverity} summary="refresh objective"`;
	for (const sev of opts.warnings ?? []) {
		pending += ` |   - supervisor_categorize severity=${sev} summary="0 critical, 1 medium, 6 low"`;
	}
	lines.push(tickLine(ts, pending));
	lines.push(tickLine(ts, "user_escalation_exit=0"));
	const esc = opts.shouldEscalate ? "true" : "false";
	lines.push(
		tickLine(
			ts,
			`user_escalation_output: User escalation: shouldEscalate=${esc} critical=${opts.escalationCritical ?? 0} total=${opts.escalationTotal ?? 16} hoursSince=0.0`,
		),
	);
	lines.push(tickLine(ts, "next_run=2026-08-09T15:47:40.5707537-04:00"));
	return lines;
}

function buildLog(...blocks: string[][]): string {
	return blocks.map((b) => b.join("\n")).join("\n") + "\n";
}

// --- Pure parser/format tests -------------------------------------------------

test("lenient parse: watermark + unknown cron field + unknown output field don't break it", () => {
	const log = buildLog(
		buildTick(START_TS, {
			changedFiles: 3,
			sensorImpulses: 2,
			addWatermark: true,
			unknownCronField: true,
			unknownOutputField: true,
		}),
	);
	const tick = parseLastTick(log);
	assert.equal(tick.cronPreflightExit, 0);
	assert.equal(tick.changedFiles, 3);
	assert.equal(tick.sensorImpulses, 2);
	assert.equal(tick.automaticov1Exit, 0);
});

test("formatting: first line is timestamp+age; three lines in order", () => {
	// TZ WARNING: the display comes from the log line's own wall-clock
	// components (startedAtWall), NOT from host-local Date getters. This
	// test passes green with the TZ bug reverted on any -04:00 machine —
	// only a UTC runner (CI) catches it. Do not "simplify" back to
	// formatTimestamp(local getters).
	const log = buildLog(buildTick(START_TS, { changedFiles: 3, sensorImpulses: 3 }));
	const tick = parseLastTick(log);
	const out = formatLastTick(tick, { now: new Date(NOW_TS) });
	const lines = out.split("\n");
	assert.equal(lines[0], "último tick: 2026-08-09 14:46 (hace 3 min)");
	const idxRan = lines.findIndex((l) => l.startsWith("automaticov1_exit="));
	const idxFound = lines.findIndex((l) => l.startsWith("changed_files=3"));
	const idxAction = lines.findIndex((l) => l.startsWith("acción:"));
	assert.ok(idxRan !== -1 && idxFound !== -1 && idxAction !== -1);
	assert.ok(idxRan < idxFound && idxFound < idxAction, "three lines out of order");
	assert.match(lines[1], /automaticov1_exit=0 cron_preflight_exit=0/);
	assert.match(lines[2], /changed_files=3 · sensorImpulses=3 · escalación: 0 críticas, 16 total/);
});

test("invariant noise hidden by default, shown with --verbose", () => {
	const log = buildLog(buildTick(START_TS, { dwe0190: true, warnings: ["warning"] }));
	const tick = parseLastTick(log);
	const plain = formatLastTick(tick, { now: new Date(NOW_TS) });
	assert.doesNotMatch(plain, /DEP0190/);
	assert.doesNotMatch(plain, /residual/);
	assert.doesNotMatch(plain, /pending_injections_query/);
	const verbose = formatLastTick(tick, { verbose: true, now: new Date(NOW_TS) });
	assert.match(verbose, /DEP0190/);
	assert.match(verbose, /residual/);
});

test("incomplete last block (truncated, no next_run) → fail hard", () => {
	const lines = buildTick(START_TS, {});
	const truncated = lines.slice(0, -1).join("\n"); // drop next_run
	assert.throws(() => parseLastTick(truncated), TickParseError);
});

test("incomplete last block (missing whole cron_preflight line) → fail hard", () => {
	// Removes the ENTIRE cron line (which also carries changed_files=).
	// This proves a structurally-mangled block fails hard via SOME guard;
	// it does NOT attribute the throw to the cron guard specifically —
	// with the cron guard dead, the changed_files guard catches it instead.
	// Attribution for the cron guard lives in the token-level test below.
	const lines = buildTick(START_TS, {});
	const missing = lines.filter((l) => !/cron_preflight_exit=/.test(l)).join("\n");
	assert.throws(() => parseLastTick(missing), TickParseError);
});

test("log with no tick block at all → fail hard", () => {
	assert.throws(() => parseLastTick("irrelevant noise line\n"), TickParseError);
});

// --- Fail-hard guards: EVERY required field has a live test ------------------
// Audit #495: only 3 of 8 guards had coverage. The automaticov1_exit guard
// is not theoretical — it fires on 1 of 45 real blocks in the deploy log.
// Mutating any of these guards to `?? 0` must kill one of these tests.
// Each test pins the guard's message so we know WHICH guard fires; if a
// case ever throws a different guard's message, that is a real hole, not a
// test to adjust.

function throwsGuard(fn: () => unknown, msg: RegExp): void {
	assert.throws(fn, (err: unknown) => err instanceof TickParseError && msg.test((err as Error).message));
}

test("bloque sin automaticov1_exit → fail hard", () => {
	const mangled = buildTick(START_TS, {})
		.filter((l) => !l.includes("automaticov1_exit="))
		.join("\n");
	throwsGuard(() => parseLastTick(mangled), /falta automaticov1_exit/);
});

test("bloque sin cron_preflight_exit (solo ese token) → fail hard", () => {
	// Remove ONLY the token, keeping changed_files=0 on the same line.
	// Line-level filtering also removes changed_files= and would be caught
	// by that guard instead — killing the cron guard alone stays green
	// under a line-level test (found by single-guard mutation, audit #495).
	const mangled = buildLog(buildTick(START_TS, {})).replace("cron_preflight_exit=0 ", "");
	throwsGuard(() => parseLastTick(mangled), /falta cron_preflight_exit/);
});

test("bloque sin changed_files (solo ese token) → fail hard", () => {
	// Remove ONLY the token, keeping cron_preflight_exit=0, so the guard
	// under test is the changed_files one and not the cron one.
	const mangled = buildLog(buildTick(START_TS, {})).replace(" changed_files=0", "");
	throwsGuard(() => parseLastTick(mangled), /falta changed_files/);
});

test("bloque sin sensorImpulses (solo ese token) → fail hard", () => {
	const mangled = buildLog(buildTick(START_TS, {})).replace(" sensorImpulses=0", "");
	throwsGuard(() => parseLastTick(mangled), /falta sensorImpulses/);
});

test("bloque sin línea user_escalation_output → fail hard", () => {
	const mangled = buildTick(START_TS, {})
		.filter((l) => !l.includes("user_escalation_output:"))
		.join("\n");
	throwsGuard(() => parseLastTick(mangled), /falta la línea de user_escalation/);
});

test("bloque con timestamp ilegible en la línea de inicio → fail hard", () => {
	// Keeps interval_minutes= (the marker guard does NOT fire); the guard
	// under test is the timestamp one.
	const mangled = buildTick(START_TS, {})
		.map((l) => (l.includes("interval_minutes=") ? l.replace(START_TS, "not-a-timestamp") : l))
		.join("\n");
	throwsGuard(() => parseLastTick(mangled), /no tiene timestamp legible/);
});

test("bloque sin línea interval_minutes → fail hard (guard del marcador)", () => {
	// The STEP line remains but has no `interval_minutes=` — this case
	// documents that the START-MARKER guard fires here, not the timestamp one.
	const mangled = buildTick(START_TS, {})
		.filter((l) => !l.includes("interval_minutes=60 trigger_engine=0"))
		.join("\n");
	throwsGuard(() => parseLastTick(mangled), /no hay ningún bloque de tick/);
});

test("actionable: info hygiene/objective_reminder are NOT actionable", () => {
	const log = buildLog(buildTick(START_TS, {}));
	const tick = parseLastTick(log);
	const out = formatLastTick(tick, { now: new Date(NOW_TS) });
	assert.match(out, /acción: nada que hacer/);
});

test("actionable: a warning injection counts", () => {
	const log = buildLog(buildTick(START_TS, { warnings: ["warning"] }));
	const tick = parseLastTick(log);
	const out = formatLastTick(tick, { now: new Date(NOW_TS) });
	assert.match(out, /acción: 1 advertencia \(supervisor_categorize\)/);
});

test("actionable: blocking injection counts (BLOCKING prefix is not double-counted)", () => {
	const log = buildLog(
		buildTick(START_TS, { blockingInjection: true, warnings: ["warning"] }),
	);
	const tick = parseLastTick(log);
	// one warning injection + one blocking objective_reminder in the list
	// (the `? BLOCKING: warning ... ?` prefix carries no `- type severity=`)
	assert.equal(tick.injections.filter((i) => i.severity !== "info").length, 2);
	const out = formatLastTick(tick, { now: new Date(NOW_TS) });
	assert.match(out, /acción: 2 \(/);
	assert.match(out, /objective_reminder/);
	assert.match(out, /supervisor_categorize/);
});

test("actionable: user escalation shouldEscalate/critical counts", () => {
	const log = buildLog(buildTick(START_TS, { shouldEscalate: true }));
	const tick = parseLastTick(log);
	const out = formatLastTick(tick, { now: new Date(NOW_TS) });
	assert.match(out, /acción: 1 \(user_escalation\)/);
});

// --- CLI wiring tests ---------------------------------------------------------

test("CLI: log not configured → exit non-zero, error mentions IDU_PI_TICK_LOG", async () => {
	const prev = process.env.IDU_PI_TICK_LOG;
	delete process.env.IDU_PI_TICK_LOG;
	try {
		const result = await runCliCommand(["idu-supervisor-tick-last"]);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /IDU_PI_TICK_LOG/);
	} finally {
		if (prev === undefined) delete process.env.IDU_PI_TICK_LOG;
		else process.env.IDU_PI_TICK_LOG = prev;
	}
});

test("CLI: --log flag resolves the file", async () => {
	const logPath = makeTempLog(buildLog(buildTick(START_TS, {})));
	const result = await runCliCommand(["idu-supervisor-tick-last", "--log", logPath]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /último tick:/);
});

test("CLI: IDU_PI_TICK_LOG env var resolves the file", async () => {
	const logPath = makeTempLog(buildLog(buildTick(START_TS, {})));
	const prev = process.env.IDU_PI_TICK_LOG;
	process.env.IDU_PI_TICK_LOG = logPath;
	try {
		const result = await runCliCommand(["idu-supervisor-tick-last"]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /último tick:/);
	} finally {
		if (prev === undefined) delete process.env.IDU_PI_TICK_LOG;
		else process.env.IDU_PI_TICK_LOG = prev;
	}
});

test("CLI: missing log file → fail hard", async () => {
	const result = await runCliCommand([
		"idu-supervisor-tick-last",
		"--log",
		join(tmpdir(), "does-not-exist-tick.log"),
	]);
	assert.equal(result.exitCode, 1);
	assert.match(result.stderr, /No existe el archivo de log del tick/);
});

test("CLI: alias supervisor-tick-last works", async () => {
	const logPath = makeTempLog(buildLog(buildTick(START_TS, {})));
	const result = await runCliCommand(["supervisor-tick-last", "--log", logPath]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /último tick:/);
});

test("CLI: --verbose passes through to reveal residual DEP0190", async () => {
	const logPath = makeTempLog(buildLog(buildTick(START_TS, { dwe0190: true })));
	const result = await runCliCommand([
		"idu-supervisor-tick-last",
		"--log",
		logPath,
		"--verbose",
	]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /DEP0190/);
	assert.ok(existsSync(logPath));
});