import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { validateAllBenchmarkTasks } from "../bench/runner.js";
import { buildHarnessInvocation, prepareTaskSandbox } from "../bench/isolation.js";
import { BENCHMARK_MODELS } from "../bench/matrix.config.js";
import { BENCHMARK_TASKS } from "../bench/tasks/registry.js";
import {
	assessAutonomy,
	bootstrapRateCi,
	buildRecommendations,
	computeInteractionResiduals,
	computePassAtK,
	summarizeCellStats,
	summarizeMarginalAxis,
} from "../bench/stats.js";
import { renderMarkdownReport, renderHtmlReport } from "../bench/report.js";
import type { BenchmarkRunRecord } from "../bench/types.js";

/** Prepends deterministic mock CLI binaries to PATH so CI runners without global CLIs exercise full invocation builders. */
function withMockBenchCliBinaries(cliNames: string[], fn: () => void): void {
	const binDir = mkdtempSync(join(tmpdir(), "idu-bench-mockbin-"));
	const prevPath = process.env.PATH ?? "";
	try {
		if (process.platform === "win32") {
			writeFileSync(join(binDir, "stub-cli.mjs"), "// mock cli entry\n", "utf8");
			for (const name of cliNames) {
				writeFileSync(
					join(binDir, `${name}.cmd`),
					`@ECHO off\r\n"node.exe" "%~dp0stub-cli.mjs" %*\r\n`,
					"utf8",
				);
			}
		} else {
			for (const name of cliNames) {
				const p = join(binDir, name);
				writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
				chmodSync(p, 0o755);
			}
		}
		process.env.PATH = `${binDir}${delimiter}${prevPath}`;
		fn();
	} finally {
		process.env.PATH = prevPath;
		rmSync(binDir, { recursive: true, force: true });
	}
}

test("all Terminal-Bench, SWE-bench, and non-browser Role benchmark tasks fail baseline cleanly and pass oracle without regressions", async () => {
	const nonBrowserTasks = BENCHMARK_TASKS.filter((t) => t.id !== "design-01-3d-benchmark-explainer");
	const result = await validateAllBenchmarkTasks(nonBrowserTasks);
	assert.equal(result.items.length, 7);
	for (const item of result.items) {
		assert.equal(item.baselinePassToPassOk, true, `${item.taskId} baseline must pass PASS_TO_PASS checks: ${item.details.join("; ")}`);
		assert.equal(item.baselineFailToPassBlocked, true, `${item.taskId} baseline must NOT pass hidden FAIL_TO_PASS checks`);
		assert.equal(item.oracleResolved, true, `${item.taskId} oracle must pass all FAIL_TO_PASS checks: ${item.details.join("; ")}`);
		assert.equal(item.oracleRegressionsClean, true, `${item.taskId} oracle must leave zero regressions`);
	}
});

test("design-01-3d-benchmark-explainer fails baseline cleanly and passes full Playwright oracle render", async (t) => {
	const designTask = BENCHMARK_TASKS.find((t) => t.id === "design-01-3d-benchmark-explainer");
	assert.ok(designTask);
	const { tryLoadPlaywright } = await import("../bench/tasks/design-3d-explainer.js");
	const pw = await tryLoadPlaywright();
	if (!pw) {
		t.skip("Playwright is not installed in this environment");
		return;
	}
	const result = await validateAllBenchmarkTasks([designTask]);
	assert.equal(result.items.length, 1);
	const item = result.items[0];
	assert.equal(item.baselinePassToPassOk, true, `design-01 baseline PASS_TO_PASS: ${item.details.join("; ")}`);
	assert.equal(item.baselineFailToPassBlocked, true, "design-01 baseline must NOT resolve");
	assert.equal(item.oracleResolved, true, `design-01 oracle must resolve: ${item.details.join("; ")}`);
	assert.equal(item.oracleRegressionsClean, true, "design-01 oracle must leave zero regressions");
});

test("buildHarnessInvocation isolates env and marks non-Nan harnesses unsupported", () => {
	const sb = prepareTaskSandbox(BENCHMARK_TASKS[0], "TEST_SENTINEL");
	const baseDir = sb.sandboxDir.replace(/[/\\]repo$/, "");
	try {
		withMockBenchCliBinaries(["pi", "gentle-shell"], () => {
			const model = BENCHMARK_MODELS[0];

			const piInv = buildHarnessInvocation({
				harness: "pi",
				model,
				prompt: "Fix bugs",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
			});
			assert.equal(piInv.supported, true);
			assert.ok(piInv.env.PI_CODING_AGENT_DIR?.startsWith(sb.isolationRoot));
			assert.ok(piInv.env.IDU_HOME?.startsWith(sb.isolationRoot));
			assert.equal(piInv.env.IDU_WORKER, undefined);
			assert.ok(piInv.args.includes("--no-extensions"));
			assert.ok(piInv.args.includes("--no-context-files"));

			const gsInv = buildHarnessInvocation({
				harness: "gentle-shell",
				model,
				prompt: "Fix bugs",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
			});
			assert.equal(gsInv.supported, true);
			assert.ok(gsInv.env.GENTLE_SHELL_HOME?.startsWith(sb.isolationRoot));
			assert.ok(gsInv.env.GENTLE_PI_CONFIG_HOME?.startsWith(sb.isolationRoot));

			const claudeInv = buildHarnessInvocation({
				harness: "claude",
				model,
				prompt: "Fix bugs",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
			});
			assert.equal(claudeInv.supported, false);
			assert.match(claudeInv.unsupportedReason ?? "", /404|Anthropic/i);

			const agyInv = buildHarnessInvocation({
				harness: "antigravity",
				model,
				prompt: "Fix bugs",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
			});
			assert.equal(agyInv.supported, false);
		});
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
	}
});

test("stats module computes pass@k, pass^k, marginal effects, interaction residuals, and preserves missing telemetry", () => {
	assert.equal(computePassAtK(3, 0, 3), 0);
	assert.equal(computePassAtK(3, 3, 1), 1);
	// 1 - C(2, 2)/C(3, 2) = 1 - 1/3 = 2/3
	assert.ok(Math.abs(computePassAtK(3, 1, 2) - 2 / 3) < 1e-9);

	const ci = bootstrapRateCi([true, true, false, true, false]);
	assert.ok(ci.low >= 0 && ci.low <= 0.6 && ci.high >= 0.6 && ci.high <= 1);

	const autoBlocked = assessAutonomy({
		exitCode: 0,
		timedOut: false,
		stdout: "Waiting for permission from user",
		stderr: "",
	});
	assert.equal(autoBlocked.autonomous, false);
	assert.equal(autoBlocked.hungOrPrompted, true);

	const makeRec = (
		harness: string,
		model: string,
		taskId: string,
		trialIndex: number,
		resolved: boolean,
		durationMs: number,
		tokens: number | null,
	): BenchmarkRunRecord => ({
		schemaVersion: 1,
		runId: `${harness}-${model}-${taskId}-${trialIndex}`,
		batchId: "unit-batch",
		track: "controlled",
		trialIndex,
		taskId,
		category: taskId.startsWith("tb") ? "terminal-bench" : "swe-bench",
		harness,
		model,
		supported: true,
		resolved,
		failToPassPassed: resolved ? 2 : 0,
		failToPassTotal: 2,
		regressionsClean: true,
		passToPassPassed: 1,
		passToPassTotal: 1,
		brokenPreExistingCount: 0,
		forbiddenTouches: [],
		autonomy: { autonomous: true, timedOut: false, hungOrPrompted: false, crashed: false, exitCode: 0 },
		efficiency: {
			durationMs,
			inputTokens: tokens ? Math.floor(tokens * 0.8) : null,
			outputTokens: tokens ? Math.floor(tokens * 0.2) : null,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			totalTokens: tokens,
			reportedCostUsd: null,
			estimatedCostUsd: null,
			telemetryComplete: tokens !== null,
			telemetrySource: tokens !== null ? "stream-usage" : "synthetic-none",
		},
		changedFiles: ["src/analyze.mjs"],
		sentinelLeaked: false,
		summaryPreview: "Done",
		timestamp: new Date().toISOString(),
	});

	const records: BenchmarkRunRecord[] = [
		makeRec("pi", "deepseek-v4-flash", "tb-01", 1, true, 10000, 1200),
		makeRec("pi", "deepseek-v4-flash", "tb-01", 2, true, 12000, 1300),
		makeRec("kimi", "deepseek-v4-flash", "tb-01", 1, true, 9000, null),
		makeRec("kimi", "deepseek-v4-flash", "tb-01", 2, false, 9500, null),
		makeRec("pi", "hy4", "swe-01", 1, true, 15000, 2000),
		makeRec("kimi", "hy4", "swe-01", 1, true, 11000, null),
	];

	const cells = summarizeCellStats(records, "all");
	assert.equal(cells.length, 4);

	const kimiFlash = cells.find((c) => c.harness === "kimi" && c.model === "deepseek-v4-flash");
	assert.ok(kimiFlash);
	assert.equal(kimiFlash.resolutionRate, 0.5);
	assert.equal(kimiFlash.passPowK, 0.25);
	assert.equal(kimiFlash.meanTotalTokens, null, "unreported tokens must remain null cleanly");
	assert.equal(kimiFlash.telemetryCoverageRate, 0);

	const harnesses = summarizeMarginalAxis(records, "harness", "all");
	assert.equal(harnesses[0].name, "pi");
	assert.equal(harnesses[0].resolutionRate, 1);

	const residuals = computeInteractionResiduals(cells);
	assert.equal(residuals.length, 4);

	const recs = buildRecommendations(records);
	assert.ok(recs.some((r) => r.category === "overall" && r.criterion === "best_overall"));

	const md = renderMarkdownReport({
		batchId: "unit-batch",
		track: "controlled",
		generatedAt: "2026-11-14T20:00:00Z",
		userConfigUntouched: true,
		probes: [],
		records,
	});
	assert.match(md, /# IDU-PI Multi-Harness & Nan Model Benchmark Report/);

	const html = renderHtmlReport({
		batchId: "unit-batch",
		track: "controlled",
		generatedAt: "2026-11-14T20:00:00Z",
		userConfigUntouched: true,
		probes: [],
		records,
	});
	assert.match(html, /Harness × Model Heatmap/);
});

test("runIsolatedNodeModuleCheck terminates infinite microtask loops without stalling the caller", async () => {
	const { runIsolatedNodeModuleCheck } = await import("../bench/tasks/eval-subprocess.js");
	let timerFired = false;
	const timer = setTimeout(() => {
		timerFired = true;
	}, 20);

	const res = await runIsolatedNodeModuleCheck({
		sandboxDir: process.cwd(),
		timeoutMs: 300,
		scriptBody: `
			while (true) {
				await Promise.resolve();
			}
		`,
	});
	clearTimeout(timer);
	assert.equal(res.passed, false);
	assert.match(res.detail ?? "", /timed out after 300ms/i);
	assert.equal(timerFired, true, "caller event loop must remain responsive during isolated eval");
});

test("collectGitChangedFiles preserves full relative paths when git porcelain has a leading status space", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { execFileSync } = await import("node:child_process");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { collectGitChangedFiles } = await import("../bench/isolation.js");

	const dir = mkdtempSync(join(tmpdir(), "idu-git-status-"));
	try {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "backoff.mjs"), "export const x = 1;\n", "utf8");
		execFileSync("git", ["init"], { cwd: dir, windowsHide: true });
		execFileSync("git", ["config", "user.email", "bench@example.com"], { cwd: dir, windowsHide: true });
		execFileSync("git", ["config", "user.name", "Bench"], { cwd: dir, windowsHide: true });
		execFileSync("git", ["add", "."], { cwd: dir, windowsHide: true });
		execFileSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });

		writeFileSync(join(dir, "src", "backoff.mjs"), "export const x = 2;\n", "utf8");
		writeFileSync(join(dir, "src", "new.mjs"), "export const y = 3;\n", "utf8");
		const files = collectGitChangedFiles(dir);
		assert.ok(files.includes("src/backoff.mjs"), `expected src/backoff.mjs, got ${JSON.stringify(files)}`);
		assert.ok(files.includes("src/new.mjs"), `expected src/new.mjs, got ${JSON.stringify(files)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("computeInteractionResiduals keeps unclamped additive expected rates so residuals sum cleanly", () => {
	const makeCell = (harness: string, model: string, rate: number): Parameters<typeof computeInteractionResiduals>[0][number] => ({
		key: `${harness}::${model}`,
		harness,
		model,
		category: "all",
		n: 1,
		kTrials: 1,
		resolvedCount: rate >= 0.5 ? 1 : 0,
		resolutionRate: rate,
		cleanRegressionRate: 1,
		autonomyRate: 1,
		passAt1: rate,
		passAtK: rate,
		passPowK: rate,
		empiricalAllPassRate: rate,
		medianDurationMs: 1000,
		p90DurationMs: 1000,
		iqrDurationMs: 0,
		durationCv: 0,
		medianTotalTokens: null,
		meanTotalTokens: null,
		medianInputTokens: null,
		medianOutputTokens: null,
		meanEstimatedCostUsd: null,
		telemetryCoverageRate: 0,
		compositeScore: rate,
	});
	const cells = [
		makeCell("h1", "m1", 0.9),
		makeCell("h1", "m2", 0.9),
		makeCell("h2", "m1", 0.9),
		makeCell("h2", "m2", 0.1),
	];
	const residuals = computeInteractionResiduals(cells);
	const h1m1 = residuals.find((r) => r.harness === "h1" && r.model === "m1");
	assert.ok(h1m1 && Math.abs(h1m1.expectedAdditiveRate - 1.1) < 1e-9);
	const sum = residuals.reduce((acc, r) => acc + r.residual, 0);
	assert.ok(Math.abs(sum) < 1e-9, `expected zero-sum residuals, got ${sum}`);
});

test("runIsolatedNodeCommand strips API keys and IDU_ variables from evaluation subprocesses", async () => {
	const { runIsolatedNodeCommand } = await import("../bench/tasks/eval-subprocess.js");
	const prevNan = process.env.NAN_API_KEY;
	const prevIdu = process.env.IDU_WORKER;
	process.env.NAN_API_KEY = "secret-nan-key";
	process.env.IDU_WORKER = "true";
	try {
		const res = await runIsolatedNodeCommand({
			cwd: process.cwd(),
			args: ["-e", "console.log(JSON.stringify({ nan: process.env.NAN_API_KEY ?? null, idu: process.env.IDU_WORKER ?? null }))"],
		});
		assert.equal(res.passed, true);
		assert.equal(JSON.parse(res.stdout.trim()).nan, null);
		assert.equal(JSON.parse(res.stdout.trim()).idu, null);
	} finally {
		if (prevNan === undefined) delete process.env.NAN_API_KEY;
		else process.env.NAN_API_KEY = prevNan;
		if (prevIdu === undefined) delete process.env.IDU_WORKER;
		else process.env.IDU_WORKER = prevIdu;
	}
});

test("buildHarnessInvocation applies read-only flags when permissionMode is read-only", () => {
	const auditTask = BENCHMARK_TASKS.find((t) => t.id === "audit-01-security-race");
	assert.ok(auditTask);
	const sb = prepareTaskSandbox(auditTask, "READONLY_SENTINEL");
	const baseDir = sb.sandboxDir.replace(/[/\\]repo$/, "");
	try {
		withMockBenchCliBinaries(["pi", "gentle-shell", "opencode", "qwen", "codex"], () => {
			const model = BENCHMARK_MODELS[0];

			const piRo = buildHarnessInvocation({
				harness: "pi",
				model,
				prompt: "Audit only",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
				permissionMode: "read-only",
			});
			assert.equal(piRo.supported, true);
			const toolsIdx = piRo.args.indexOf("--tools");
			assert.ok(toolsIdx >= 0 && piRo.args[toolsIdx + 1] === "read,grep,find,ls");

			const gsRo = buildHarnessInvocation({
				harness: "gentle-shell",
				model,
				prompt: "Audit only",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
				permissionMode: "read-only",
			});
			assert.equal(gsRo.supported, true);
			assert.ok(gsRo.args.includes("--tools"));

			const ocRo = buildHarnessInvocation({
				harness: "opencode",
				model,
				prompt: "Audit only",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
				permissionMode: "read-only",
			});
			assert.equal(ocRo.supported, true);
			assert.equal(ocRo.args.includes("--auto"), false);

			const qwRo = buildHarnessInvocation({
				harness: "qwen",
				model,
				prompt: "Audit only",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
				permissionMode: "read-only",
			});
			assert.equal(qwRo.supported, true);
			assert.equal(qwRo.args.includes("-y"), false);
			assert.ok(qwRo.args.includes("--approval-mode") && qwRo.args.includes("plan"));

			const cxRo = buildHarnessInvocation({
				harness: "codex",
				model,
				prompt: "Audit only",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
				permissionMode: "read-only",
			});
			assert.equal(cxRo.supported, true);
			if (process.platform === "win32") {
				assert.ok(cxRo.args.includes("--dangerously-bypass-approvals-and-sandbox"));
				assert.ok(gsRo.env.PSModuleAnalysisCachePath?.startsWith(sb.isolationRoot));
			} else {
				assert.ok(cxRo.args.includes("-s") && cxRo.args.includes("read-only"));
				assert.equal(cxRo.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
			}
		});
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
	}
});

test("audit-01-security-race penalizes safe decoy false-positives and workspace mutations", async () => {
	const auditTask = BENCHMARK_TASKS.find((t) => t.id === "audit-01-security-race");
	assert.ok(auditTask && auditTask.oracleSummary);
	const sb = prepareTaskSandbox(auditTask, "AUDIT_TEST_SENTINEL");
	try {
		const oracleJsonText = auditTask.oracleSummary.match(/```json\s*([\s\S]*?)```/)?.[1] ?? "{}";
		const mutatedPayload = JSON.parse(oracleJsonText) as { findings: Array<Record<string, unknown>> };
		mutatedPayload.findings.push({
			bugClass: "SQL_INJECTION",
			file: "src/safe-query.mjs",
			symbol: "buildAuditLookupQuery",
			line: 8,
			severity: "high",
			explanation: "False positive blaming parameterized whitelist query.",
		});
		const decoyRes = await auditTask.evaluate(sb.sandboxDir, {
			summary: "```json\n" + JSON.stringify(mutatedPayload) + "\n```",
			changedFiles: [],
		});
		assert.equal(decoyRes.regressionsClean, false);
		assert.equal(decoyRes.resolved, false);

		const dirtyRes = await auditTask.evaluate(sb.sandboxDir, {
			summary: auditTask.oracleSummary,
			changedFiles: ["src/auth-session.mjs"],
		});
		assert.equal(dirtyRes.regressionsClean, false);
		assert.equal(dirtyRes.resolved, false);
		assert.deepEqual(dirtyRes.forbiddenTouches, ["src/auth-session.mjs"]);
	} finally {
		sb.cleanup();
	}
});

test("buildRecommendations and renderMarkdownReport dynamically include role categories when present", () => {
	const baseRec = (category: BenchmarkRunRecord["category"], harness: string, model: string, resolved: boolean): BenchmarkRunRecord => ({
		schemaVersion: 1,
		runId: `${harness}-${model}-${category}`,
		batchId: "role-batch",
		track: "controlled",
		trialIndex: 1,
		taskId: `${category}-01`,
		category,
		harness,
		model,
		supported: true,
		resolved,
		failToPassPassed: resolved ? 2 : 0,
		failToPassTotal: 2,
		regressionsClean: true,
		passToPassPassed: 1,
		passToPassTotal: 1,
		brokenPreExistingCount: 0,
		forbiddenTouches: [],
		autonomy: { autonomous: true, timedOut: false, hungOrPrompted: false, crashed: false, exitCode: 0 },
		efficiency: {
			durationMs: 12000,
			inputTokens: 1000,
			outputTokens: 300,
			reasoningTokens: null,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			totalTokens: 1300,
			reportedCostUsd: null,
			estimatedCostUsd: null,
			telemetryComplete: true,
			telemetrySource: "stream-usage",
		},
		changedFiles: [],
		sentinelLeaked: false,
		summaryPreview: "Done",
		timestamp: new Date().toISOString(),
	});

	const records = [
		baseRec("audit-bench", "pi", "hy4", true),
		baseRec("consult-bench", "opencode", "qwen3.8-max", true),
		baseRec("explore-bench", "pi", "glm5.3-flash", true),
		baseRec("design-bench", "opencode", "kimi-k3.1-pro", true),
	];

	const recs = buildRecommendations(records);
	assert.ok(recs.some((r) => r.category === "audit-bench" && r.model === "hy4"));
	assert.ok(recs.some((r) => r.category === "consult-bench" && r.model === "qwen3.8-max"));
	assert.ok(recs.some((r) => r.category === "explore-bench" && r.model === "glm5.3-flash"));
	assert.ok(recs.some((r) => r.category === "design-bench" && r.model === "kimi-k3.1-pro"));

	const md = renderMarkdownReport({
		batchId: "role-batch",
		track: "controlled",
		generatedAt: "2026-11-15T12:00:00Z",
		userConfigUntouched: true,
		probes: [],
		records,
	});
	assert.match(md, /Audit-Bench Subset \(Read-Only\)/);
	assert.match(md, /Design-Bench Subset \(3D Composition\)/);
	assert.doesNotMatch(md, /Terminal-Bench Subset/);
});

test("extractLastJsonValue recovers minor JSON escapes/brackets and respects root expectedKeys", async () => {
	const { extractLastJsonValue } = await import("../bench/tasks/eval-helpers.js");

	// Exact mcode + deepseek-v4-flash unescaped inner quotes pattern:
	const withUnescapedQuotes = [
		"Analysis complete.",
		"```json",
		"{",
		'  "findings": [',
		"    {",
		'      "bugClass": "FAIL_OPEN_AUTH",',
		'      "file": "src/auth-session.mjs",',
		'      "explanation": "An attacker crafts `{"alg":"none"}.{"role":"admin"}` to bypass signature check."',
		"    }",
		"  ],",
		'  "safeReviewedFiles": ["src/safe-query.mjs"]',
		"}",
		"```",
	].join("\n");
	const recoveredQuotes = extractLastJsonValue<{ findings?: Array<{ bugClass?: string }> }>(withUnescapedQuotes, ["findings"]);
	assert.equal(recoveredQuotes?.findings?.[0]?.bugClass, "FAIL_OPEN_AUTH");

	// Exact mcode + qwen3.8-max stray closing `]` + trailing comma pattern:
	const withExtraBracket = [
		"```json",
		"{",
		'  "findings": [',
		'    { "bugClass": "TOCTOU_RACE", "file": "src/rate-limiter.mjs", },',
		"  ],",
		'  "safeReviewedFiles": ["src/safe-query.mjs", "src/safe-cache.mjs"]',
		"]",
		"}",
		"```",
	].join("\n");
	const recoveredBracket = extractLastJsonValue<{ findings?: Array<{ bugClass?: string }>; safeReviewedFiles?: string[] }>(withExtraBracket, ["findings"]);
	assert.equal(recoveredBracket?.findings?.[0]?.bugClass, "TOCTOU_RACE");
	assert.deepEqual(recoveredBracket?.safeReviewedFiles, ["src/safe-query.mjs", "src/safe-cache.mjs"]);

	// Inner sub-object without root keys must return null when expectedKeys are supplied:
	const innerOnly = 'Text with stray item {"bugClass":"TIMING_ATTACK","file":"src/webhook-verify.mjs"} only.';
	assert.equal(extractLastJsonValue(innerOnly, ["findings"]), null);
});

test("StreamLineCapture discards massive transient delta spam while preserving final events and usage", async () => {
	const { StreamLineCapture } = await import("../bench/isolation.js");
	const cap = new StreamLineCapture(128 * 1024, 5);
	const spamDelta = JSON.stringify({
		type: "message_update",
		assistantMessageEvent: { type: "text_delta", delta: "x".repeat(900) },
	});
	// Exceed 3 MiB of transient updates across chunk boundaries
	for (let i = 0; i < 3500; i++) {
		cap.pushChunk(`${spamDelta}\n`);
	}
	const finalEvent = JSON.stringify({
		type: "exec.completed",
		result: { type: "exec.result", output: "FINAL_OK", usage: { inputTokens: 120, outputTokens: 30 } },
	});
	cap.pushChunk(`${finalEvent.slice(0, 40)}`);
	cap.pushChunk(`${finalEvent.slice(40)}\n`);

	const res = cap.finalize();
	assert.equal(res.droppedTransientCount, 3500);
	assert.ok(res.text.includes('"output":"FINAL_OK"'), "final exec.completed must remain intact");
	assert.ok(res.text.length < 16_000, `expected compacted output < 16 KB, got ${res.text.length}`);
});

test("collectGitChangedFiles detects committed edits against baseRef and gentle-shell runs in child mode", async () => {
	const { writeFileSync, rmSync } = await import("node:fs");
	const { execFileSync } = await import("node:child_process");
	const { join } = await import("node:path");
	const { collectGitChangedFiles } = await import("../bench/isolation.js");

	const sb = prepareTaskSandbox(BENCHMARK_TASKS[0], "COMMIT_SENTINEL");
	const baseDir = sb.sandboxDir.replace(/[/\\]repo$/, "");
	try {
		writeFileSync(join(sb.sandboxDir, "index.html"), "<html>ok</html>\n", "utf8");
		execFileSync("git", ["add", "index.html"], { cwd: sb.sandboxDir, windowsHide: true });
		execFileSync("git", ["commit", "-q", "-m", "worker auto commit"], { cwd: sb.sandboxDir, windowsHide: true });

		assert.deepEqual(collectGitChangedFiles(sb.sandboxDir), [], "plain status is empty after commit");
		const withBase = collectGitChangedFiles(sb.sandboxDir, sb.initialCommitSha);
		assert.ok(withBase.includes("index.html"), `expected committed index.html in diff, got ${JSON.stringify(withBase)}`);

		withMockBenchCliBinaries(["gentle-shell"], () => {
			const gsInv = buildHarnessInvocation({
				harness: "gentle-shell",
				model: BENCHMARK_MODELS[0],
				prompt: "Inspect",
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: "nan-test-key",
			});
			assert.equal(gsInv.supported, true);
			assert.equal(gsInv.env.GENTLE_PI_AGENTS_CHILD, "1");
			assert.equal(gsInv.env.GENTLE_PI_AUTONOMOUS_MODE, "1");
		});
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
	}
});

test("StreamLineCapture discards wrapped Command Code message_update spam and consult-01 accepts available_at non-blocking phrasing", async () => {
	const { rmSync } = await import("node:fs");
	const { StreamLineCapture } = await import("../bench/isolation.js");
	const cap = new StreamLineCapture(64 * 1024, 5);
	const wrappedSpam = JSON.stringify({
		type: "event",
		event: { type: "message_update", content: [{ type: "thinking", thinking: "y".repeat(900) }] },
	});
	for (let i = 0; i < 600; i++) {
		cap.pushChunk(`${wrappedSpam}\n`);
	}
	const runEnd = JSON.stringify({
		type: "event",
		event: { type: "run_end", result: { finalText: '{"ok":true}' } },
	});
	cap.pushChunk(`${runEnd}\n`);
	const captured = cap.finalize();
	assert.equal(captured.droppedTransientCount, 600);
	assert.ok(captured.text.includes('"finalText":"{\\"ok\\":true}"'));

	const consultTask = BENCHMARK_TASKS.find((t) => t.id === "consult-01-arch-tradeoff")!;
	const sb = prepareTaskSandbox(consultTask, "CONSULT_REGEX_SENTINEL");
	const baseDir = sb.sandboxDir.replace(/[/\\]repo$/, "");
	try {
		const validAltAnswer = [
			"```json",
			JSON.stringify({
				rootCauses: [
					{ causeId: "NON_ATOMIC_CLAIM", file: "src/job-dispatcher.mjs", symbol: "JobDispatcher.pollAndRun", explanation: "Concurrent workers read the same pending jobs without an atomic lease." },
					{ causeId: "HOL_BACKOFF_BLOCKING", file: "src/job-dispatcher.mjs", symbol: "JobDispatcher.dispatchSingleJob", explanation: "Inline sleep stalls the batch poll loop behind one retry backoff." },
					{ causeId: "NON_IDEMPOTENT_LEDGER", file: "src/ledger-store.mjs", symbol: "LedgerStore.recordCompletion", explanation: "Appends duplicate completions and grows seenKeys Set unboundedly." },
				],
				recommendedDesign: {
					claimMechanism: "Claim atomically with UPDATE ... FOR UPDATE SKIP LOCKED RETURNING * and lease TTL.",
					retryScheduling: "Write available_at=now()+backoff and continue immediately so backoff does not block other jobs.",
					idempotencyStrategy: "Enforce unique constraint on idempotency_key with INSERT ON CONFLICT DO NOTHING and bound caches.",
					primaryTradeoff: "Adds database write contention and lease tuning overhead in exchange for correctness.",
				},
				nonCulpritFiles: ["src/metrics-reporter.mjs"],
			}),
			"```",
		].join("\n");
		const res = await consultTask.evaluate(sb.sandboxDir, {
			changedFiles: [],
			summary: validAltAnswer,
		});
		assert.equal(res.resolved, true, `expected consult-01 to resolve valid available_at phrasing: ${JSON.stringify(res.checks)}`);
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
	}
});
