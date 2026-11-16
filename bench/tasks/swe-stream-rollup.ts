import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkTaskDef, EvalCheckResult, TaskEvalResult } from "../types.js";
import { runIsolatedNodeCommand, runIsolatedNodeModuleCheck } from "./eval-subprocess.js";

const PARSER_BUGGY = `export function parseEvents(text) {
  const events = [];
  for (const line of text.split("\\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed);
    events.push({
      id: obj.id,
      tenant: obj.tenant,
      ts: Number(obj.ts),
      value: obj.value || null,
      tags: obj.tags && typeof obj.tags === "object" ? obj.tags : {},
    });
  }
  return events;
}
`;

const WINDOW_BUGGY = `export class WatermarkTracker {
  constructor(watermarkSlackMs = 5000) {
    this.slackMs = watermarkSlackMs;
    this.maxTs = -Infinity;
    this.seen = new Set();
  }

  accept(event) {
    if (this.seen.has(event.id)) {
      return { accepted: false, reason: "duplicate" };
    }
    if (event.ts < this.maxTs) {
      return { accepted: false, reason: "late" };
    }
    this.maxTs = event.ts;
    this.seen.add(event.id);
    return { accepted: true };
  }
}
`;

const ROLLUP_BUGGY = `const DEFAULT_META = { region: "global", flags: [] };

export function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function rollupBuckets(events, bucketSizeMs = 1000) {
  const buckets = new Map();
  for (const ev of events) {
    if (ev.value === null || typeof ev.value !== "number") continue;
    const bucketStart = Math.floor(ev.ts / bucketSizeMs) * bucketSizeMs;
    const key = ev.tenant + "::" + bucketStart;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tenant: ev.tenant,
        bucketStart,
        values: [],
        meta: DEFAULT_META,
      };
      buckets.set(key, bucket);
    }
    bucket.values.push(ev.value);
    if (ev.tags?.region) bucket.meta.region = ev.tags.region;
    if (ev.tags?.flag && !bucket.meta.flags.includes(ev.tags.flag)) {
      bucket.meta.flags.push(ev.tags.flag);
    }
  }

  return [...buckets.values()]
    .map((b) => ({
      tenant: b.tenant,
      bucketStart: b.bucketStart,
      count: b.values.length,
      sum: b.values.reduce((acc, x) => acc + x, 0),
      median: median(b.values),
      meta: b.meta,
    }))
    .sort((a, b) => a.bucketStart - b.bucketStart || a.tenant.localeCompare(b.tenant));
}
`;

const INDEX_JS = `import { parseEvents } from "./parser.mjs";
import { WatermarkTracker } from "./window.mjs";
import { rollupBuckets } from "./rollup.mjs";

export { parseEvents, WatermarkTracker, rollupBuckets };

export function processEventStream(ndjsonText, options = {}) {
  const { watermarkSlackMs = 5000, bucketSizeMs = 1000 } = options;
  const parsed = parseEvents(ndjsonText);
  const tracker = new WatermarkTracker(watermarkSlackMs);
  const accepted = [];
  let droppedLate = 0;
  let droppedDuplicate = 0;

  for (const ev of parsed) {
    const decision = tracker.accept(ev);
    if (decision.accepted) {
      accepted.push(ev);
    } else if (decision.reason === "late") {
      droppedLate += 1;
    } else if (decision.reason === "duplicate") {
      droppedDuplicate += 1;
    }
  }

  return {
    acceptedCount: accepted.length,
    droppedLate,
    droppedDuplicate,
    buckets: rollupBuckets(accepted, bucketSizeMs),
  };
}
`;

const BASIC_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { processEventStream } from "../src/index.mjs";

test("processEventStream handles ordered positive events", () => {
  const input = [
    JSON.stringify({ id: "1", tenant: "acme", ts: 1000, value: 10 }),
    JSON.stringify({ id: "2", tenant: "acme", ts: 1500, value: 20 }),
    JSON.stringify({ id: "3", tenant: "acme", ts: 1800, value: 30 }),
  ].join("\\n");
  const res = processEventStream(input, { watermarkSlackMs: 5000, bucketSizeMs: 1000 });
  assert.equal(res.acceptedCount, 3);
  assert.equal(res.droppedLate, 0);
  assert.equal(res.buckets.length, 1);
  assert.equal(res.buckets[0].sum, 60);
  assert.equal(res.buckets[0].median, 20);
});
`;

const PARSER_ORACLE = `export function parseEvents(text) {
  const clean = text.replace(/^\\uFEFF/, "").replace(/\\r\\n?/g, "\\n");
  const events = [];
  for (const line of clean.split("\\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed);
    const val = typeof obj.value === "number" && Number.isFinite(obj.value) ? obj.value : null;
    events.push({
      id: obj.id,
      tenant: obj.tenant,
      ts: Number(obj.ts),
      value: val,
      tags: obj.tags && typeof obj.tags === "object" ? obj.tags : {},
    });
  }
  return events;
}
`;

const WINDOW_ORACLE = `export class WatermarkTracker {
  constructor(watermarkSlackMs = 5000) {
    this.slackMs = watermarkSlackMs;
    this.maxTs = -Infinity;
    this.seen = new Set();
  }

  accept(event) {
    if (this.seen.has(event.id)) {
      return { accepted: false, reason: "duplicate" };
    }
    const cutoff = this.maxTs === -Infinity ? -Infinity : this.maxTs - this.slackMs;
    if (event.ts < cutoff) {
      return { accepted: false, reason: "late" };
    }
    if (event.ts > this.maxTs) {
      this.maxTs = event.ts;
    }
    this.seen.add(event.id);
    return { accepted: true };
  }
}
`;

const ROLLUP_ORACLE = `export function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rollupBuckets(events, bucketSizeMs = 1000) {
  const buckets = new Map();
  for (const ev of events) {
    if (ev.value === null || typeof ev.value !== "number") continue;
    const bucketStart = Math.floor(ev.ts / bucketSizeMs) * bucketSizeMs;
    const key = ev.tenant + "::" + bucketStart;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tenant: ev.tenant,
        bucketStart,
        values: [],
        meta: { region: "global", flags: [] },
      };
      buckets.set(key, bucket);
    }
    bucket.values.push(ev.value);
    if (ev.tags?.region) bucket.meta.region = ev.tags.region;
    if (ev.tags?.flag && !bucket.meta.flags.includes(ev.tags.flag)) {
      bucket.meta.flags.push(ev.tags.flag);
    }
  }

  return [...buckets.values()]
    .map((b) => ({
      tenant: b.tenant,
      bucketStart: b.bucketStart,
      count: b.values.length,
      sum: b.values.reduce((acc, x) => acc + x, 0),
      median: median(b.values),
      meta: b.meta,
    }))
    .sort((a, b) => a.bucketStart - b.bucketStart || a.tenant.localeCompare(b.tenant));
}
`;

export const sweStreamRollupTask: BenchmarkTaskDef = {
	id: "swe-01-stream-rollup",
	category: "swe-bench",
	title: "Multi-Module Stream Rollup & Watermark Bugfix",
	description:
		"Fix falsy numeric-zero parsing, non-monotonic watermark late-event filtering, shared bucket metadata mutation, and even-length median across 3 modules.",
	timeoutMs: 180_000,
	protectedPaths: ["src/index.mjs", "test/basic.test.mjs"],
	fixtureFiles: {
		"package.json": JSON.stringify(
			{
				name: "swe-01-stream-rollup",
				type: "module",
				private: true,
				scripts: { test: "node --test test/basic.test.mjs" },
			},
			null,
			2,
		) + "\n",
		"src/parser.mjs": PARSER_BUGGY,
		"src/window.mjs": WINDOW_BUGGY,
		"src/rollup.mjs": ROLLUP_BUGGY,
		"src/index.mjs": INDEX_JS,
		"test/basic.test.mjs": BASIC_TEST,
	},
	oraclePatchFiles: {
		"src/parser.mjs": PARSER_ORACLE,
		"src/window.mjs": WINDOW_ORACLE,
		"src/rollup.mjs": ROLLUP_ORACLE,
	},
	prompt: [
		"You are working in the `swe-01-stream-rollup` repository.",
		"Inspect `src/parser.mjs`, `src/window.mjs`, `src/rollup.mjs`, `src/index.mjs`, and `test/basic.test.mjs`.",
		"",
		"Requirements:",
		"1. Do NOT modify `src/index.mjs` or `test/basic.test.mjs`.",
		"2. Fix all edge-case bugs across `src/parser.mjs`, `src/window.mjs`, and `src/rollup.mjs`:",
		"   - `parseEvents`: preserve valid numeric `value === 0` (must NOT coerce `0` to `null`) and handle UTF-8 BOM / CRLF.",
		"   - `WatermarkTracker.accept`: keep `maxTs` monotonic (`maxTs = Math.max(maxTs, event.ts)`); accept out-of-order events within `[maxTs - slackMs, maxTs]` and drop only events strictly with `event.ts < maxTs - slackMs` as `late`.",
		"   - `rollupBuckets` / `median`: each bucket must get an isolated fresh `meta` object (`{ region: 'global', flags: [] }`) with no shared mutable state across tenants/buckets, and `median` of even-length sorted arrays must return the exact arithmetic mean of the two middle elements.",
		"3. Ensure `node --test test/basic.test.mjs` passes (you may add temporary checks during verification, or verify via node, leaving `test/basic.test.mjs` untouched).",
	].join("\n"),
	async evaluate(sandboxDir: string): Promise<TaskEvalResult> {
		const checks: EvalCheckResult[] = [];
		const forbiddenTouches: string[] = [];

		for (const rel of sweStreamRollupTask.protectedPaths ?? []) {
			const expected = sweStreamRollupTask.fixtureFiles[rel];
			const actual = existsSync(join(sandboxDir, rel)) ? readFileSync(join(sandboxDir, rel), "utf8") : null;
			const ok = actual === expected;
			if (!ok) forbiddenTouches.push(rel);
			checks.push({ name: `protected:${rel}`, kind: "hygiene", passed: ok });
		}

		// PASS_TO_PASS
		const passRes = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["--test", "test/basic.test.mjs"],
			timeoutMs: 15_000,
		});
		checks.push({
			name: "pass_to_pass:basic_test",
			kind: "pass_to_pass",
			passed: passRes.passed,
			detail: passRes.detail,
		});

		// FAIL_TO_PASS: multi-bug unseen test cases
		const f1Res = await runIsolatedNodeModuleCheck({
			sandboxDir,
			timeoutMs: 15_000,
			scriptBody: `
				const idxUrl = pathToFileURL(join(sandboxDir, "src/index.mjs")).href;
				const { processEventStream } = await import(idxUrl);

				const stream = [
					JSON.stringify({ id: "e1", tenant: "t1", ts: 10_000, value: 10, tags: { region: "us", flag: "alpha" } }),
					JSON.stringify({ id: "e2", tenant: "t1", ts: 10_200, value: 0, tags: { region: "us" } }),
					JSON.stringify({ id: "e3", tenant: "t1", ts: 8_000, value: 30 }),
					JSON.stringify({ id: "e4", tenant: "t1", ts: 8_500, value: 40 }),
					JSON.stringify({ id: "e2", tenant: "t1", ts: 10_500, value: 999 }),
					JSON.stringify({ id: "e5", tenant: "t2", ts: 10_100, value: 50 }),
					JSON.stringify({ id: "e6", tenant: "t1", ts: 4_000, value: 99 }),
				].join("\\r\\n");

				const res = processEventStream("\\uFEFF" + stream, { watermarkSlackMs: 5000, bucketSizeMs: 1000 });
				assert.equal(res.acceptedCount, 5, "e1,e2,e3,e4,e5 must be accepted (including ts=8000 within slack and value=0)");
				assert.equal(res.droppedDuplicate, 1);
				assert.equal(res.droppedLate, 1);

				const b8 = res.buckets.find((b) => b.bucketStart === 8000 && b.tenant === "t1");
				assert.ok(b8);
				assert.equal(b8.median, 35);
				assert.equal(b8.meta.region, "global", "t1 bucket 8000 must not share meta object with bucket 10000");
				assert.deepEqual(b8.meta.flags, []);

				const b10t1 = res.buckets.find((b) => b.bucketStart === 10_000 && b.tenant === "t1");
				assert.ok(b10t1);
				assert.equal(b10t1.count, 2, "numeric value 0 must be counted");
				assert.equal(b10t1.sum, 10);
				assert.equal(b10t1.median, 5);
				assert.equal(b10t1.meta.region, "us");
				assert.deepEqual(b10t1.meta.flags, ["alpha"]);

				const b10t2 = res.buckets.find((b) => b.bucketStart === 10_000 && b.tenant === "t2");
				assert.ok(b10t2);
				assert.equal(b10t2.meta.region, "global");
				assert.deepEqual(b10t2.meta.flags, []);
			`,
		});
		checks.push({
			name: "fail_to_pass:zero_watermark_meta_even_median",
			kind: "fail_to_pass",
			passed: f1Res.passed,
			detail: f1Res.detail,
		});

		const failChecks = checks.filter((c) => c.kind === "fail_to_pass");
		const passChecks = checks.filter((c) => c.kind === "pass_to_pass");
		const failPassed = failChecks.filter((c) => c.passed).length;
		const passPassed = passChecks.filter((c) => c.passed).length;
		const broken = passChecks.length - passPassed;
		const hygiene = forbiddenTouches.length === 0;

		return {
			resolved: failPassed === failChecks.length && hygiene,
			failToPassPassed: failPassed,
			failToPassTotal: failChecks.length,
			regressionsClean: broken === 0 && hygiene,
			passToPassPassed: passPassed,
			passToPassTotal: passChecks.length,
			brokenPreExistingCount: broken,
			forbiddenTouches,
			checks,
		};
	},
};
