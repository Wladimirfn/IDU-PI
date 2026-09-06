// test/liveness-check.test.ts
//
// Tests for the pure liveness check function. Each test creates temp files
// (log, rails, trigger) with controlled content and mtimes, then calls
// checkLiveness and asserts the resulting state.

import { test, describe } from "node:test";
import { strictEqual, ok } from "node:assert";
import { writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers/temp.js";
import {
	checkLiveness,
	formatLiveness,
	type LivenessInput,
} from "../src/liveness-check.js";

/**
 * Write content to a file and set its mtime to `minutesAgo` minutes in the
 * past relative to `now`.
 */
function writeFileWithAge(
	path: string,
	content: string,
	minutesAgo: number,
	now: Date,
): void {
	writeFileSync(path, content, "utf8");
	const ts = new Date(now.getTime() - minutesAgo * 60_000);
	utimesSync(path, ts, ts);
}

/**
 * Build a LivenessInput pointing at temp-dir files. Creates the parent
 * directory structure as needed.
 */
function makeInput(
	dir: string,
	opts: {
		logContent?: string;
		logAgeMin?: number;
		railsContent?: string;
		railsAgeMin?: number;
		triggerEnabled?: boolean | null; // null = don't create trigger file
		intervalMin?: number;
		now: Date;
	},
): LivenessInput {
	const logPath = join(dir, "logs", "supervisor-tick.log");
	const railsPath = join(dir, "role-rails.json");
	const triggerPath = join(dir, "supervisor-trigger.json");

	if (opts.logContent !== undefined) {
		mkdirSync(join(dir, "logs"), { recursive: true });
		writeFileWithAge(logPath, opts.logContent, opts.logAgeMin ?? 0, opts.now);
	}
	if (opts.railsContent !== undefined) {
		writeFileWithAge(
			railsPath,
			opts.railsContent,
			opts.railsAgeMin ?? 0,
			opts.now,
		);
	}
	if (opts.triggerEnabled !== null && opts.triggerEnabled !== undefined) {
		writeFileSync(
			triggerPath,
			JSON.stringify({ enabled: opts.triggerEnabled }),
			"utf8",
		);
	}

	return {
		logPath,
		railsPath,
		triggerPath: opts.triggerEnabled === null ? undefined : triggerPath,
		intervalMinutes: opts.intervalMin ?? 60,
		now: opts.now,
	};
}

const NOW = new Date("2026-07-31T10:00:00.000Z");

// Log line templates matching the real supervisor-tick.log format.
const TS = "2026-07-31T06:38:17.4170473-04:00";

const SKIP_LOG = [
	`${TS} STEP Trigger engine opt-in: disabled`,
	`${TS} trigger_opt_in: disabled`,
	`${TS} skipped: CLI active (opencode, opencode, opencode)`,
].join("\n");

const WORKED_LOG = (files: number) =>
	[
		`${TS} STEP Trigger engine opt-in: disabled`,
		`${TS} trigger_opt_in: disabled`,
		`${TS} automaticov1_exit=0`,
		`${TS} cron_preflight_exit=0 changed_files=${files}`,
		`${TS} user_escalation_exit=0`,
	].join("\n");

const TSC_FAIL_LOG = [
	`${TS} STEP Trigger engine opt-in: disabled`,
	`${TS} trigger_opt_in: disabled`,
	`${TS} tsc_failed: Error: tsc falló con exit code 1`,
].join("\n");

const RAILS_JSON = JSON.stringify(
	{ schemaVersion: 2, rails: {} },
	null,
	2,
);

describe("liveness-check", () => {
	test("alive + skip: fresh log with skip outcome", () => {
		const dir = makeTempDir("liveness-skip-");
		const input = makeInput(dir, {
			logContent: SKIP_LOG,
			logAgeMin: 30,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "alive");
		strictEqual(result.outcome, "skip");
		ok(result.detail?.includes("CLI active"));
	});

	test("alive + worked: fresh log with changed_files>0, fresh rails", () => {
		const dir = makeTempDir("liveness-worked-");
		const input = makeInput(dir, {
			logContent: WORKED_LOG(6),
			logAgeMin: 30,
			railsContent: RAILS_JSON,
			railsAgeMin: 30,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "alive");
		strictEqual(result.outcome, "worked");
	});

	test("alive + idle: fresh log with changed_files=0", () => {
		const dir = makeTempDir("liveness-idle-");
		const input = makeInput(dir, {
			logContent: WORKED_LOG(0),
			logAgeMin: 30,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "alive");
		strictEqual(result.outcome, "idle");
	});

	test("dead: log mtime > 3x interval (180min)", () => {
		const dir = makeTempDir("liveness-dead-");
		const input = makeInput(dir, {
			logContent: SKIP_LOG,
			logAgeMin: 200, // > 3×60 = 180
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "dead");
		ok(result.staleMinutes !== undefined && result.staleMinutes >= 200);
		strictEqual(result.thresholdMinutes, 180);
	});

	test("dead: log file does not exist", () => {
		const dir = makeTempDir("liveness-nolog-");
		const input = makeInput(dir, {
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "dead");
		ok(result.detail?.includes("not found"));
	});

	test("error: last tick had tsc_failed", () => {
		const dir = makeTempDir("liveness-error-");
		const input = makeInput(dir, {
			logContent: TSC_FAIL_LOG,
			logAgeMin: 30,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "error");
		ok(result.errorLine?.includes("tsc_failed"));
	});

	test("error: last tick had cron_preflight_exit != 0", () => {
		const dir = makeTempDir("liveness-pferr-");
		const errorLog = [
			`${TS} trigger_opt_in: disabled`,
			`${TS} cron_preflight_exit=1 changed_files=5`,
		].join("\n");
		const input = makeInput(dir, {
			logContent: errorLog,
			logAgeMin: 30,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "error");
	});

	test("work_gap: changed_files>0 but rails stale > 2x interval", () => {
		const dir = makeTempDir("liveness-wgap-");
		const input = makeInput(dir, {
			logContent: WORKED_LOG(12),
			logAgeMin: 30,
			railsContent: RAILS_JSON,
			railsAgeMin: 150, // > 2×60 = 120
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "work_gap");
		strictEqual(result.changedFiles, 12);
		ok(result.railsStaleMinutes !== undefined && result.railsStaleMinutes >= 150);
	});

	test("trigger_disabled: supervisor-trigger.json has enabled:false", () => {
		const dir = makeTempDir("liveness-trigdis-");
		const input = makeInput(dir, {
			logContent: SKIP_LOG,
			logAgeMin: 500, // would be dead, but trigger overrides
			triggerEnabled: false,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "trigger_disabled");
	});

	test("trigger_enabled: trigger file with enabled:true does not suppress", () => {
		const dir = makeTempDir("liveness-trigen-");
		const input = makeInput(dir, {
			logContent: SKIP_LOG,
			logAgeMin: 30,
			triggerEnabled: true,
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "alive");
	});

	test("no trigger file: normal case, proceeds to log check", () => {
		const dir = makeTempDir("liveness-notrig-");
		const input = makeInput(dir, {
			logContent: SKIP_LOG,
			logAgeMin: 30,
			triggerEnabled: null, // don't create
			now: NOW,
		});
		const result = checkLiveness(input);
		strictEqual(result.state, "alive");
	});

	test("formatLiveness: produces state-naming line for each state", () => {
		const cases: Parameters<typeof formatLiveness>[0][] = [
			{ state: "alive", outcome: "skip", detail: "CLI active" },
			{ state: "dead", detail: "no tick in 200min" },
			{ state: "error", detail: "tsc failed" },
			{ state: "work_gap", detail: "12 files, no model" },
			{ state: "trigger_disabled", detail: "opted out" },
		];
		for (const c of cases) {
			const line = formatLiveness(c);
			ok(line.startsWith("LIVENESS "), `Expected LIVENESS prefix: ${line}`);
			ok(line.includes(c.state), `Expected state name in output: ${line}`);
		}
	});
});
