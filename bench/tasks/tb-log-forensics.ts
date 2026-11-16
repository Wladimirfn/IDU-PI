import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchmarkTaskDef, EvalCheckResult, TaskEvalResult } from "../types.js";
import { runIsolatedNodeCommand } from "./eval-subprocess.js";

const SERVICES_CSV = [
	"service,owner,sla_ms",
	"auth,security-team,120",
	'billing,"payments, core",250',
	"search,discovery,180",
	"",
].join("\r\n");

const LOG_NODE_A =
	"\uFEFF" +
	[
		JSON.stringify({ reqId: "req-01", ts: 1000, service: "auth", ok: false, durationMs: 220 }),
		JSON.stringify({ reqId: "req-01", ts: 1500, service: "auth", ok: true, durationMs: 90 }),
		JSON.stringify({ reqId: "req-02", ts: 1100, service: "billing", ok: true, durationMs: 310 }),
		JSON.stringify({ reqId: "req-03", ts: 1200, service: "search", ok: false, durationMs: 140 }),
		JSON.stringify({ reqId: "req-04", ts: 1300, service: "billing", ok: false, durationMs: 260 }),
		JSON.stringify({ reqId: "req-05", ts: 1400, service: "edge-proxy", ok: true, durationMs: 45 }),
		"",
	].join("\r\n");

const LOG_NODE_B = [
	JSON.stringify({ reqId: "req-04", ts: 2200, service: "billing", ok: true, durationMs: 190 }),
	JSON.stringify({ reqId: "req-06", ts: 2300, service: "auth", ok: true, durationMs: 150 }),
	JSON.stringify({ reqId: "req-07", ts: 2400, service: "billing", ok: true, durationMs: 100 }),
	JSON.stringify({ reqId: "req-08", ts: 2500, service: "search", ok: true, durationMs: 210 }),
	'{"reqId":"req-corrupt","ts":2600,"serv',
	"",
].join("\n");

const BUGGY_ANALYZE_MJS = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseCsv(text) {
  const lines = text.trim().split("\\n").slice(1);
  const map = new Map();
  for (const line of lines) {
    if (!line) continue;
    const [service, owner, sla] = line.split(",");
    map.set(service, { owner, slaMs: Number(sla) });
  }
  return map;
}

export function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(0.95 * sorted.length)] ?? sorted[sorted.length - 1];
}

export function analyzeLogs(logsDir, servicesCsvPath) {
  const servicesMeta = parseCsv(readFileSync(servicesCsvPath, "utf8"));
  const files = readdirSync(logsDir).filter((f) => f.endsWith(".jsonl"));
  const seen = new Map();
  let totalRawLinesParsed = 0;
  let malformedLinesSkipped = 0;

  for (const file of files) {
    const raw = readFileSync(join(logsDir, file), "utf8");
    for (const line of raw.split("\\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      totalRawLinesParsed += 1;
      if (!seen.has(obj.reqId)) {
        seen.set(obj.reqId, obj);
      }
    }
  }

  const byService = new Map();
  for (const rec of seen.values()) {
    const list = byService.get(rec.service) ?? [];
    list.push(rec);
    byService.set(rec.service, list);
  }

  const services = [];
  for (const [service, items] of byService.entries()) {
    const meta = servicesMeta.get(service) ?? { owner: null, slaMs: null };
    const durations = items.map((x) => x.durationMs);
    services.push({
      service,
      owner: meta.owner,
      slaMs: meta.slaMs,
      count: items.length,
      errorCount: items.filter((x) => !x.ok).length,
      slaBreachCount: meta.slaMs === null ? 0 : items.filter((x) => x.durationMs > meta.slaMs).length,
      p95DurationMs: p95(durations),
    });
  }

  return {
    totalRawLinesParsed,
    uniqueRequests: seen.size,
    malformedLinesSkipped,
    services,
  };
}
`;

const BIN_CLI_MJS = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeLogs } from "../scripts/analyze.mjs";

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const inDir = resolve(getArg("--in", "logs"));
const outFile = resolve(getArg("--out", "out/report.json"));
const csvFile = resolve(getArg("--services", "config/services.csv"));

const report = analyzeLogs(inDir, csvFile);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(report, null, 2) + "\\n", "utf8");
`;

const SMOKE_TEST_MJS = `import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeLogs } from "../scripts/analyze.mjs";

test("analyzeLogs summarizes a single clean LF log file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-smoke-"));
  try {
    writeFileSync(join(dir, "services.csv"), "service,owner,sla_ms\\napi,core,100\\n", "utf8");
    writeFileSync(
      join(dir, "sample.jsonl"),
      [
        JSON.stringify({ reqId: "r1", ts: 10, service: "api", ok: true, durationMs: 50 }),
        JSON.stringify({ reqId: "r2", ts: 20, service: "api", ok: false, durationMs: 120 }),
      ].join("\\n") + "\\n",
      "utf8",
    );
    const out = analyzeLogs(dir, join(dir, "services.csv"));
    assert.equal(out.uniqueRequests, 2);
    assert.equal(out.malformedLinesSkipped, 0);
    assert.equal(out.services.length, 1);
    assert.equal(out.services[0].owner, "core");
    assert.equal(out.services[0].errorCount, 1);
    assert.equal(out.services[0].slaBreachCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
`;

const ORACLE_ANALYZE_MJS = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

export function parseCsv(text) {
  const clean = text.replace(/^\\uFEFF/, "").replace(/\\r\\n?/g, "\\n");
  const lines = clean.trim().split("\\n").slice(1);
  const map = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const [service, owner, sla] = parseCsvLine(line);
    if (!service) continue;
    const parsedSla = sla === undefined || sla === "" ? null : Number(sla);
    map.set(service, {
      owner: owner || "unassigned",
      slaMs: parsedSla !== null && Number.isFinite(parsedSla) ? parsedSla : null,
    });
  }
  return map;
}

export function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

export function analyzeLogs(logsDir, servicesCsvPath) {
  const servicesMeta = parseCsv(readFileSync(servicesCsvPath, "utf8"));
  const files = readdirSync(logsDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort((a, b) => a.localeCompare(b));
  const seen = new Map();
  let totalRawLinesParsed = 0;
  let malformedLinesSkipped = 0;

  for (const file of files) {
    const raw = readFileSync(join(logsDir, file), "utf8").replace(/^\\uFEFF/, "");
    for (const line of raw.split(/\\r?\\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        malformedLinesSkipped += 1;
        continue;
      }
      if (!obj || typeof obj.reqId !== "string" || typeof obj.ts !== "number") {
        malformedLinesSkipped += 1;
        continue;
      }
      totalRawLinesParsed += 1;
      const prev = seen.get(obj.reqId);
      if (!prev || obj.ts >= prev.ts) {
        seen.set(obj.reqId, obj);
      }
    }
  }

  const byService = new Map();
  for (const rec of seen.values()) {
    const list = byService.get(rec.service) ?? [];
    list.push(rec);
    byService.set(rec.service, list);
  }

  const services = [];
  for (const service of [...byService.keys()].sort((a, b) => a.localeCompare(b))) {
    const items = byService.get(service);
    const meta = servicesMeta.get(service) ?? { owner: "unassigned", slaMs: null };
    const durations = items.map((x) => x.durationMs);
    services.push({
      service,
      owner: meta.owner,
      slaMs: meta.slaMs,
      count: items.length,
      errorCount: items.filter((x) => !x.ok).length,
      slaBreachCount: meta.slaMs === null ? 0 : items.filter((x) => x.durationMs > meta.slaMs).length,
      p95DurationMs: p95(durations),
    });
  }

  return {
    totalRawLinesParsed,
    uniqueRequests: seen.size,
    malformedLinesSkipped,
    services,
  };
}
`;

export const tbLogForensicsTask: BenchmarkTaskDef = {
	id: "tb-01-log-forensics",
	category: "terminal-bench",
	title: "Log Forensics & Resilient CLI Pipeline",
	description:
		"Fix BOM/CRLF CSV parsing with quoted commas, cross-shard reqId deduplication (latest ts wins), truncated JSONL resilience, nearest-rank p95, and generate out/report.json.",
	timeoutMs: 180_000,
	protectedPaths: ["config/services.csv", "logs/node-a.jsonl", "logs/node-b.jsonl", "test/smoke.test.mjs"],
	fixtureFiles: {
		"package.json": JSON.stringify(
			{
				name: "tb-log-forensics",
				type: "module",
				private: true,
				scripts: { test: "node --test test/smoke.test.mjs" },
			},
			null,
			2,
		) + "\n",
		"config/services.csv": SERVICES_CSV,
		"logs/node-a.jsonl": LOG_NODE_A,
		"logs/node-b.jsonl": LOG_NODE_B,
		"scripts/analyze.mjs": BUGGY_ANALYZE_MJS,
		"bin/cli.mjs": BIN_CLI_MJS,
		"test/smoke.test.mjs": SMOKE_TEST_MJS,
	},
	oraclePatchFiles: {
		"scripts/analyze.mjs": ORACLE_ANALYZE_MJS,
		"out/report.json":
			JSON.stringify(
				{
					totalRawLinesParsed: 10,
					uniqueRequests: 8,
					malformedLinesSkipped: 1,
					services: [
						{ service: "auth", owner: "security-team", slaMs: 120, count: 2, errorCount: 0, slaBreachCount: 1, p95DurationMs: 150 },
						{ service: "billing", owner: "payments, core", slaMs: 250, count: 3, errorCount: 0, slaBreachCount: 1, p95DurationMs: 310 },
						{ service: "edge-proxy", owner: "unassigned", slaMs: null, count: 1, errorCount: 0, slaBreachCount: 0, p95DurationMs: 45 },
						{ service: "search", owner: "discovery", slaMs: 180, count: 2, errorCount: 1, slaBreachCount: 1, p95DurationMs: 210 },
					],
				},
				null,
				2,
			) + "\n",
	},
	prompt: [
		"You are working in the `tb-log-forensics` repository.",
		"Inspect `scripts/analyze.mjs`, `bin/cli.mjs`, `config/services.csv`, `logs/*.jsonl`, and `test/smoke.test.mjs`.",
		"",
		"Requirements:",
		"1. Do NOT modify `config/services.csv`, `logs/*`, or `test/smoke.test.mjs`.",
		"2. Fix `scripts/analyze.mjs` so `analyzeLogs(logsDir, servicesCsvPath)` and `node bin/cli.mjs --in logs --out out/report.json` handle:",
		"   - UTF-8 BOM (`\\uFEFF`) and CRLF/LF line endings in both `.jsonl` and CSV files.",
		'   - Quoted CSV fields containing commas (e.g. `billing,"payments, core",250`).',
		"   - Malformed or truncated non-empty JSON lines: count them in `malformedLinesSkipped` without crashing; ignore blank lines.",
		"   - Deduplicate requests globally across `.jsonl` files (sorted alphabetically) by `reqId`, keeping the record with the highest numeric `ts` (ties broken by later encounter).",
		'   - Nearest-rank `p95DurationMs` (`sorted[Math.max(0, Math.ceil(0.95 * n) - 1)]`).',
		'   - Sort `services` alphabetically by `service` name; default missing `owner` to `"unassigned"` and missing `slaMs` to `null`.',
		"3. Run `node bin/cli.mjs --in logs --out out/report.json` so `out/report.json` is written on disk.",
		"4. Run `node --test test/smoke.test.mjs` and confirm it passes.",
	].join("\n"),
	async evaluate(sandboxDir: string): Promise<TaskEvalResult> {
		const checks: EvalCheckResult[] = [];
		const forbiddenTouches: string[] = [];

		// 1. Hygiene: protected input files must remain byte-identical
		for (const rel of tbLogForensicsTask.protectedPaths ?? []) {
			const expected = tbLogForensicsTask.fixtureFiles[rel];
			const actual = existsSync(join(sandboxDir, rel)) ? readFileSync(join(sandboxDir, rel), "utf8") : null;
			const ok = actual === expected;
			if (!ok) forbiddenTouches.push(rel);
			checks.push({
				name: `protected:${rel}`,
				kind: "hygiene",
				passed: ok,
				detail: ok ? undefined : "Protected input/test file was modified or deleted",
			});
		}

		// 2. PASS_TO_PASS: pre-existing smoke tests
		const passRes = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["--test", "test/smoke.test.mjs"],
			timeoutMs: 15_000,
		});
		checks.push({
			name: "pass_to_pass:smoke_test",
			kind: "pass_to_pass",
			passed: passRes.passed,
			detail: passRes.detail,
		});

		// 3. FAIL_TO_PASS (1): out/report.json exists and matches exact oracle schema + numbers
		let outCheckOk = false;
		let outCheckDetail: string | undefined;
		try {
			const raw = readFileSync(join(sandboxDir, "out/report.json"), "utf8");
			const parsed = JSON.parse(raw);
			const expected = JSON.parse(tbLogForensicsTask.oraclePatchFiles["out/report.json"]);
			assert.deepEqual(parsed, expected);
			outCheckOk = true;
		} catch (err) {
			outCheckDetail = err instanceof Error ? err.message : String(err);
		}
		checks.push({
			name: "fail_to_pass:out_report_exact",
			kind: "fail_to_pass",
			passed: outCheckOk,
			detail: outCheckDetail,
		});

		// 4. FAIL_TO_PASS (2): unseen adversarial input executed dynamically via bin/cli.mjs
		let advOk = false;
		let advDetail: string | undefined;
		const advDir = mkdtempSync(join(tmpdir(), "tb-eval-adv-"));
		try {
			const advLogs = join(advDir, "logs");
			mkdirSync(advLogs, { recursive: true });
			const advCsv = '\uFEFFservice,owner,sla_ms\r\n"edge, gw","platform, ops",50\r\nauth,sec,100\r\n';
			writeFileSync(join(advDir, "services.csv"), advCsv, "utf8");
			writeFileSync(
				join(advLogs, "1.jsonl"),
				'\uFEFF{"reqId":"a","ts":100,"service":"edge, gw","ok":false,"durationMs":90}\r\n{"reqId":"b","ts":10,"service":"newsvc","ok":true,"durationMs":12}\r\nbad_json\r\n',
				"utf8",
			);
			writeFileSync(
				join(advLogs, "2.jsonl"),
				'{"reqId":"a","ts":100,"service":"edge, gw","ok":true,"durationMs":40}\n{"reqId":"c","ts":50,"service":"auth","ok":true,"durationMs":100}\n{"reqId":"d","ts":60,"service":"auth","ok":true,"durationMs":101}\n{"reqId":"cut"\n',
				"utf8",
			);
			const advOut = join(advDir, "adv-out.json");
			const cliRes = await runIsolatedNodeCommand({
				cwd: sandboxDir,
				args: ["bin/cli.mjs", "--in", advLogs, "--services", join(advDir, "services.csv"), "--out", advOut],
				timeoutMs: 15_000,
			});
			if (!cliRes.passed) {
				throw new Error(cliRes.detail || "CLI run failed");
			}
			const got = JSON.parse(readFileSync(advOut, "utf8"));
			assert.deepEqual(got, {
				totalRawLinesParsed: 5,
				uniqueRequests: 4,
				malformedLinesSkipped: 2,
				services: [
					{ service: "auth", owner: "sec", slaMs: 100, count: 2, errorCount: 0, slaBreachCount: 1, p95DurationMs: 101 },
					{ service: "edge, gw", owner: "platform, ops", slaMs: 50, count: 1, errorCount: 0, slaBreachCount: 0, p95DurationMs: 40 },
					{ service: "newsvc", owner: "unassigned", slaMs: null, count: 1, errorCount: 0, slaBreachCount: 0, p95DurationMs: 12 },
				],
			});
			advOk = true;
		} catch (err) {
			advDetail = err instanceof Error ? err.message : String(err);
		} finally {
			rmSync(advDir, { recursive: true, force: true });
		}
		checks.push({
			name: "fail_to_pass:adversarial_cli_run",
			kind: "fail_to_pass",
			passed: advOk,
			detail: advDetail,
		});

		const failToPassChecks = checks.filter((c) => c.kind === "fail_to_pass");
		const passToPassChecks = checks.filter((c) => c.kind === "pass_to_pass");
		const failToPassPassed = failToPassChecks.filter((c) => c.passed).length;
		const passToPassPassed = passToPassChecks.filter((c) => c.passed).length;
		const brokenPreExistingCount = passToPassChecks.length - passToPassPassed;
		const hygieneClean = forbiddenTouches.length === 0;

		return {
			resolved: failToPassPassed === failToPassChecks.length && hygieneClean,
			failToPassPassed,
			failToPassTotal: failToPassChecks.length,
			regressionsClean: brokenPreExistingCount === 0 && hygieneClean,
			passToPassPassed,
			passToPassTotal: passToPassChecks.length,
			brokenPreExistingCount,
			forbiddenTouches,
			checks,
		};
	},
};
