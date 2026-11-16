import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCleanSummary } from "../src/summary.js";
import { extractUsage } from "../src/usage.js";
import {
	ALL_HARNESSES,
	BENCHMARK_MODELS,
	estimateCostFromPricing,
	type PricingSchedule,
} from "./matrix.config.js";
import {
	buildHarnessInvocation,
	collectGitChangedFiles,
	prepareTaskSandbox,
	resolveNanApiKey,
	snapshotUserIduFiles,
	spawnIsolatedWorker,
} from "./isolation.js";
import { renderHtmlReport, renderMarkdownReport } from "./report.js";
import {
	assessAutonomy,
	buildRecommendations,
	computeInteractionResiduals,
	summarizeCellStats,
	summarizeMarginalAxis,
} from "./stats.js";
import { BENCHMARK_TASKS } from "./tasks/registry.js";
import type {
	BenchmarkModelSpec,
	BenchmarkRunRecord,
	BenchmarkTaskDef,
	BenchmarkTrack,
	CapabilityProbeEntry,
} from "./types.js";

const DEFAULT_RESULTS_ROOT = resolve(
	dirname(dirname(fileURLToPath(import.meta.url))),
	"..",
	"bench",
	"results",
);

export interface ValidationReportItem {
	taskId: string;
	baselinePassToPassOk: boolean;
	baselineFailToPassBlocked: boolean;
	oracleResolved: boolean;
	oracleRegressionsClean: boolean;
	details: string[];
}

export async function validateAllBenchmarkTasks(
	tasks: BenchmarkTaskDef[] = BENCHMARK_TASKS,
): Promise<{ ok: boolean; items: ValidationReportItem[] }> {
	const items: ValidationReportItem[] = [];

	for (const task of tasks) {
		const details: string[] = [];

		// 1. Baseline must pass smoke test and fail hidden verification
		const sbBase = prepareTaskSandbox(task, "VALIDATE_BASE");
		let baselineEval;
		try {
			baselineEval = await task.evaluate(sbBase.sandboxDir, {
				summary: "",
				stdout: "",
				stderr: "",
				changedFiles: [],
			});
		} finally {
			sbBase.cleanup();
		}
		if (!baselineEval.regressionsClean) {
			details.push(`Baseline failed PASS_TO_PASS/hygiene: ${JSON.stringify(baselineEval.checks)}`);
		}
		if (baselineEval.resolved) {
			details.push("Baseline unexpectedly passed hidden FAIL_TO_PASS checks without fix");
		}

		// 2. Oracle patch/response must pass ALL PASS_TO_PASS and FAIL_TO_PASS checks
		const sbOracle = prepareTaskSandbox(task, "VALIDATE_ORACLE");
		let oracleEval;
		try {
			for (const [rel, content] of Object.entries(task.oraclePatchFiles)) {
				const abs = join(sbOracle.sandboxDir, rel);
				mkdirSync(dirname(abs), { recursive: true });
				writeFileSync(abs, content, "utf8");
			}
			const oracleChanged = collectGitChangedFiles(sbOracle.sandboxDir, sbOracle.initialCommitSha);
			const oracleText = task.oracleSummary ?? "";
			oracleEval = await task.evaluate(sbOracle.sandboxDir, {
				summary: oracleText,
				stdout: oracleText,
				stderr: "",
				changedFiles: oracleChanged,
			});
		} finally {
			sbOracle.cleanup();
		}
		if (!oracleEval.resolved || !oracleEval.regressionsClean) {
			details.push(`Oracle failed verification: ${JSON.stringify(oracleEval.checks)}`);
		}

		items.push({
			taskId: task.id,
			baselinePassToPassOk: baselineEval.regressionsClean,
			baselineFailToPassBlocked: !baselineEval.resolved,
			oracleResolved: oracleEval.resolved,
			oracleRegressionsClean: oracleEval.regressionsClean,
			details,
		});
	}

	const ok = items.every(
		(it) => it.baselinePassToPassOk && it.baselineFailToPassBlocked && it.oracleResolved && it.oracleRegressionsClean,
	);
	return { ok, items };
}

export async function runCapabilityProbe(params: {
	harnesses: string[];
	model: BenchmarkModelSpec;
	track: BenchmarkTrack;
	apiKey: string;
	timeoutMs?: number;
}): Promise<CapabilityProbeEntry[]> {
	const { harnesses, model, track, apiKey, timeoutMs = 90_000 } = params;
	const prompt = "Read ping.txt and reply with its exact contents only.";
	const probeTask: BenchmarkTaskDef = {
		id: "capability-probe",
		category: "terminal-bench",
		title: "Capability Probe",
		description: "Quick read + output capability smoke test",
		timeoutMs,
		fixtureFiles: { "ping.txt": "PROBE_OK_NAN\n" },
		oraclePatchFiles: {},
		prompt,
		evaluate: async () => ({
			resolved: true,
			failToPassPassed: 1,
			failToPassTotal: 1,
			regressionsClean: true,
			passToPassPassed: 1,
			passToPassTotal: 1,
			brokenPreExistingCount: 0,
			forbiddenTouches: [],
			checks: [],
		}),
	};

	const results: CapabilityProbeEntry[] = [];
	for (const harness of harnesses) {
		const sb = prepareTaskSandbox(probeTask, "PROBE_SENTINEL");
		try {
			const inv = buildHarnessInvocation({
				harness,
				model,
				prompt,
				isolationRoot: sb.isolationRoot,
				track,
				apiKey,
			});
			if (!inv.supported) {
				results.push({
					harness,
					model: model.id,
					supported: "unsupported",
					durationMs: 0,
					exitCode: null,
					usageCaptured: false,
					reason: inv.unsupportedReason,
				});
				continue;
			}
			const out = await spawnIsolatedWorker({
				command: inv.command,
				args: inv.args,
				cwd: sb.sandboxDir,
				env: inv.env,
				timeoutMs,
			});
			const usage = extractUsage(out.stdout, harness);
			const summary = extractCleanSummary(out.stdout, harness);
			const ok = !out.timedOut && out.exitCode === 0 && /PROBE_OK_NAN/.test(`${summary}\n${out.stdout}`);
			results.push({
				harness,
				model: model.id,
				supported: ok ? "supported" : "unsupported",
				durationMs: out.durationMs,
				exitCode: out.exitCode,
				usageCaptured: usage.captured,
				reason: ok ? `protocol=${inv.apiProtocol}` : out.timedOut ? `timeout=${out.durationMs}ms` : out.spawnError || summary.slice(0, 160) || out.stderr.slice(0, 160) || `exit=${out.exitCode}`,
			});
		} finally {
			sb.cleanup();
		}
	}
	return results;
}

interface TrialWorkItem {
	trialIndex: number;
	task: BenchmarkTaskDef;
	harness: string;
	model: BenchmarkModelSpec;
}

function workKey(r: { track: string; harness: string; model: string; taskId: string; trialIndex: number }): string {
	return `${r.track}::${r.harness}::${r.model}::${r.taskId}::${r.trialIndex}`;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const i = cursor;
			cursor += 1;
			if (i >= items.length) return;
			await worker(items[i], i);
		}
	});
	await Promise.all(runners);
}

function loadRunsJsonl(path: string): BenchmarkRunRecord[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => JSON.parse(l) as BenchmarkRunRecord);
}

function writeReportsFromData(params: {
	batchDir: string;
	batchId: string;
	track: BenchmarkTrack;
	userConfigUntouched: boolean;
	probes: CapabilityProbeEntry[];
	records: BenchmarkRunRecord[];
	notes?: string[];
}): void {
	const { batchDir, batchId, track, userConfigUntouched, probes, records, notes } = params;
	const generatedAt = new Date().toISOString();
	const input = { batchId, track, generatedAt, userConfigUntouched, probes, records, notes };

	writeFileSync(join(batchDir, "report.md"), renderMarkdownReport(input), "utf8");
	writeFileSync(join(batchDir, "report.html"), renderHtmlReport(input), "utf8");
	writeFileSync(
		join(batchDir, "summary.json"),
		JSON.stringify(
			{
				batchId,
				track,
				generatedAt,
				userConfigUntouched,
				probes,
				recommendations: buildRecommendations(records),
				modelRankings: summarizeMarginalAxis(records, "model", "all"),
				harnessRankings: summarizeMarginalAxis(records, "harness", "all"),
				cells: summarizeCellStats(records, "all"),
				interactions: computeInteractionResiduals(summarizeCellStats(records, "all")),
			},
			null,
			2,
		),
		"utf8",
	);
}

function parseListFlag(args: string[], flag: string): string[] | null {
	const idx = args.indexOf(flag);
	if (idx === -1 || !args[idx + 1]) return null;
	return args[idx + 1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseValueFlag(args: string[], flag: string): string | null {
	const idx = args.indexOf(flag);
	return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(
			[
				"Usage: node dist/bench/runner.js [mode] [options]",
				"  --validate-tasks            Verify all tasks fail unpatched baseline and pass oracle",
				"  --probe                     Run live capability smoke probe across harnesses",
				"  --run                       Execute crossed CLI x Nan model benchmark matrix",
				"  --dry-run                   Print execution matrix without running workers",
				"  --report <batchDir>         Regenerate report.md, report.html, summary.json",
				"Options:",
				"  --track controlled|native   Isolation mode (default: controlled)",
				"  --harnesses h1,h2,...       Filter harnesses (default: ALL_HARNESSES)",
				"  --models m1,m2,...          Filter Nan models (default: all 9)",
				"  --tasks t1,t2,...           Filter tasks (default: all 4)",
				"  --trials N                  Trials per cell (default: 3)",
				"  --concurrency N             Max parallel isolated trials (default: 3)",
				"  --timeout-ms N              Override timeout per trial",
				"  --probe-model ID            Model used for --probe (default: deepseek-v4-flash)",
				"  --pricing-file PATH         Optional JSON map { modelId: { input, output, cachedInput } }",
				"  --resume PATH               Resume an existing batch directory",
			].join("\n"),
		);
		return;
	}

	if (args.includes("--validate-tasks")) {
		const res = await validateAllBenchmarkTasks();
		console.log(JSON.stringify(res, null, 2));
		if (!res.ok) process.exit(1);
		return;
	}

	const reportDir = parseValueFlag(args, "--report");
	if (reportDir) {
		const abs = resolve(reportDir);
		const runs = loadRunsJsonl(join(abs, "runs.jsonl"));
		const probes: CapabilityProbeEntry[] = existsSync(join(abs, "probes.json"))
			? (JSON.parse(readFileSync(join(abs, "probes.json"), "utf8")) as CapabilityProbeEntry[])
			: [];
		const metaPath = join(abs, "batch-meta.json");
		const existingSummaryPath = join(abs, "summary.json");
		let persistedUntouched: boolean | null = null;
		let persistedNotes: string[] | undefined;
		if (existsSync(metaPath)) {
			try {
				const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
					userConfigUntouched?: unknown;
					notes?: unknown;
				};
				if (typeof meta.userConfigUntouched === "boolean") {
					persistedUntouched = meta.userConfigUntouched;
				}
				if (Array.isArray(meta.notes)) {
					persistedNotes = meta.notes.filter((n): n is string => typeof n === "string");
				}
			} catch {
				// Ignore malformed metadata and fall back to existing summary.
			}
		}
		if (persistedUntouched === null && existsSync(existingSummaryPath)) {
			try {
				const prev = JSON.parse(readFileSync(existingSummaryPath, "utf8")) as { userConfigUntouched?: unknown };
				if (typeof prev.userConfigUntouched === "boolean") {
					persistedUntouched = prev.userConfigUntouched;
				}
			} catch {
				// Ignore malformed summary fallback.
			}
		}
		const batchId = runs[0]?.batchId || abs.split(/[/\\]/).pop() || "manual";
		const track: BenchmarkTrack = runs[0]?.track || "controlled";
		const notes = [...(persistedNotes ?? [])];
		if (persistedUntouched === null) {
			notes.push("No host-integrity metadata (batch-meta.json/summary.json) found during --report regeneration.");
		}
		writeReportsFromData({
			batchDir: abs,
			batchId,
			track,
			userConfigUntouched: persistedUntouched === true,
			probes,
			records: runs,
			notes,
		});
		console.log(`Generated reports in ${abs}`);
		return;
	}

	const trackRaw = parseValueFlag(args, "--track") ?? "controlled";
	if (trackRaw !== "controlled" && trackRaw !== "native") {
		throw new Error(`Invalid --track value: ${trackRaw}`);
	}
	const track: BenchmarkTrack = trackRaw;

	const harnessFilter = parseListFlag(args, "--harnesses");
	const harnesses = harnessFilter ?? [...ALL_HARNESSES];

	const modelFilter = parseListFlag(args, "--models");
	const models = modelFilter
		? BENCHMARK_MODELS.filter((m) => modelFilter.includes(m.id))
		: BENCHMARK_MODELS;

	const categoryFilter = parseListFlag(args, "--categories");
	const taskFilter = parseListFlag(args, "--tasks");
	const tasks = BENCHMARK_TASKS.filter((t) => {
		if (categoryFilter && !categoryFilter.includes(t.category)) return false;
		if (taskFilter && !taskFilter.includes(t.id)) return false;
		return true;
	});

	const trials = Math.max(1, Number(parseValueFlag(args, "--trials") ?? 3));
	const concurrency = Math.max(1, Number(parseValueFlag(args, "--concurrency") ?? 3));
	const timeoutOverrideMs = parseValueFlag(args, "--timeout-ms") ? Number(parseValueFlag(args, "--timeout-ms")) : null;

	let pricing: PricingSchedule | undefined;
	const pricingPath = parseValueFlag(args, "--pricing-file");
	if (pricingPath) {
		pricing = JSON.parse(readFileSync(resolve(pricingPath), "utf8")) as PricingSchedule;
	}

	if (args.includes("--dry-run")) {
		const totalPlanned = harnesses.length * models.length * tasks.length * trials;
		console.log(
			JSON.stringify(
				{
					track,
					harnesses,
					models: models.map((m) => m.id),
					tasks: tasks.map((t) => ({
						id: t.id,
						category: t.category,
						permissionMode: t.permissionMode ?? "workspace",
						timeoutMs: timeoutOverrideMs ?? t.timeoutMs,
					})),
					trials,
					concurrency,
					totalCells: harnesses.length * models.length * tasks.length,
					totalPlannedExecutions: totalPlanned,
				},
				null,
				2,
			),
		);
		return;
	}

	const apiKey = resolveNanApiKey();
	if (!apiKey) {
		throw new Error("NAN_API_KEY not found in environment or ~/.pi/agent/auth.json / ~/.minimax / ~/.kimi-code");
	}

	const beforeIdu = snapshotUserIduFiles();

	if (args.includes("--probe")) {
		const probeModelId = parseValueFlag(args, "--probe-model") ?? "deepseek-v4-flash";
		const probeModel = BENCHMARK_MODELS.find((m) => m.id === probeModelId) ?? BENCHMARK_MODELS[0];
		const probes = await runCapabilityProbe({
			harnesses,
			model: probeModel,
			track,
			apiKey,
		});
		const afterIdu = snapshotUserIduFiles();
		const untouched =
			beforeIdu.profilesSha256 === afterIdu.profilesSha256 &&
			beforeIdu.configSha256 === afterIdu.configSha256;
		console.log(JSON.stringify({ track, userConfigUntouched: untouched, probes }, null, 2));
		return;
	}

	if (!args.includes("--run")) {
		console.log("Pass --validate-tasks, --probe, --dry-run, --run, or --report <dir>. Use --help for options.");
		return;
	}

	const resumeArg = parseValueFlag(args, "--resume");
	const rawBatchIdArg = parseValueFlag(args, "--batch-id");
	const sanitizedBatchArg = rawBatchIdArg
		? rawBatchIdArg.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
		: "";
	const batchId = resumeArg
		? resolve(resumeArg).split(/[/\\]/).pop() || `batch-${Date.now()}`
		: sanitizedBatchArg || `nan-${track}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
	const batchDir = resumeArg ? resolve(resumeArg) : join(DEFAULT_RESULTS_ROOT, batchId);
	const logsDir = join(batchDir, "logs");
	mkdirSync(logsDir, { recursive: true });

	const runsPath = join(batchDir, "runs.jsonl");
	const probesPath = join(batchDir, "probes.json");

	const existing = loadRunsJsonl(runsPath);
	const doneKeys = new Set(existing.map((r) => workKey(r)));

	// 1. Run or load capability probe first
	const probeModel = models[0] ?? BENCHMARK_MODELS[0];
	const probes: CapabilityProbeEntry[] = existsSync(probesPath)
		? (JSON.parse(readFileSync(probesPath, "utf8")) as CapabilityProbeEntry[])
		: await runCapabilityProbe({ harnesses, model: probeModel, track, apiKey });
	writeFileSync(probesPath, JSON.stringify(probes, null, 2), "utf8");

	const supportedSet = new Set(probes.filter((p) => p.supported === "supported").map((p) => p.harness));
	const allRecords: BenchmarkRunRecord[] = [...existing];

	// Record explicit unsupported entries once (without retrying failed cells)
	for (const p of probes) {
		if (p.supported === "supported") continue;
		const recKey = workKey({ track, harness: p.harness, model: probeModel.id, taskId: tasks[0]?.id ?? "probe", trialIndex: 0 });
		if (doneKeys.has(recKey)) continue;
		const rec: BenchmarkRunRecord = {
			schemaVersion: 1,
			runId: `unsup-${p.harness}-${Date.now()}`,
			batchId,
			track,
			trialIndex: 0,
			taskId: tasks[0]?.id ?? "probe",
			category: tasks[0]?.category ?? "terminal-bench",
			harness: p.harness,
			model: probeModel.id,
			supported: false,
			unsupportedReason: p.reason,
			resolved: false,
			failToPassPassed: 0,
			failToPassTotal: 1,
			regressionsClean: true,
			passToPassPassed: 0,
			passToPassTotal: 0,
			brokenPreExistingCount: 0,
			forbiddenTouches: [],
			autonomy: { autonomous: false, timedOut: false, hungOrPrompted: false, crashed: false, exitCode: p.exitCode, blockerReason: p.reason },
			efficiency: {
				durationMs: p.durationMs,
				inputTokens: null,
				outputTokens: null,
				reasoningTokens: null,
				cacheReadTokens: null,
				cacheWriteTokens: null,
				totalTokens: null,
				reportedCostUsd: null,
				estimatedCostUsd: null,
				telemetryComplete: false,
				telemetrySource: "synthetic-none",
			},
			changedFiles: [],
			sentinelLeaked: false,
			summaryPreview: "",
			timestamp: new Date().toISOString(),
		};
		appendFileSync(runsPath, JSON.stringify(rec) + "\n", "utf8");
		allRecords.push(rec);
		doneKeys.add(recKey);
	}

	// Build crossed work schedule (Latin-square staggered across models & harnesses to
	// avoid hitting per-model concurrency limits like Nan's max 5 simultaneous requests).
	const activeHarnesses = harnesses.filter((h) => supportedSet.has(h));
	const workItems: TrialWorkItem[] = [];
	if (activeHarnesses.length > 0 && models.length > 0) {
		for (let trialIndex = 1; trialIndex <= trials; trialIndex++) {
			for (const task of tasks) {
				for (let round = 0; round < activeHarnesses.length; round++) {
					for (let mIdx = 0; mIdx < models.length; mIdx++) {
						const model = models[mIdx];
						const harness = activeHarnesses[(mIdx + round) % activeHarnesses.length];
						const key = workKey({ track, harness, model: model.id, taskId: task.id, trialIndex });
						if (doneKeys.has(key)) continue;
						workItems.push({ trialIndex, task, harness, model });
					}
				}
			}
		}
	}

	console.log(`Starting batch ${batchId}: ${workItems.length} pending trials (concurrency=${concurrency}, track=${track})`);

	let completedCount = 0;
	await runPool(workItems, concurrency, async (item) => {
		const runId = `${item.harness}_${item.model.id}_${item.task.id}_t${item.trialIndex}`;
		const sentinel = `IDU_SENTINEL_${runId}_${Math.random().toString(36).slice(2, 8)}`;
		const sb = prepareTaskSandbox(item.task, sentinel);

		try {
			const inv = buildHarnessInvocation({
				harness: item.harness,
				model: item.model,
				prompt: item.task.prompt,
				isolationRoot: sb.isolationRoot,
				track,
				apiKey,
				permissionMode: item.task.permissionMode ?? "workspace",
			});

			if (!inv.supported) {
				const rec: BenchmarkRunRecord = {
					schemaVersion: 1,
					runId,
					batchId,
					track,
					trialIndex: item.trialIndex,
					taskId: item.task.id,
					category: item.task.category,
					harness: item.harness,
					model: item.model.id,
					supported: false,
					unsupportedReason: inv.unsupportedReason,
					resolved: false,
					failToPassPassed: 0,
					failToPassTotal: 1,
					regressionsClean: true,
					passToPassPassed: 0,
					passToPassTotal: 0,
					brokenPreExistingCount: 0,
					forbiddenTouches: [],
					autonomy: { autonomous: false, timedOut: false, hungOrPrompted: false, crashed: false, exitCode: null, blockerReason: inv.unsupportedReason },
					efficiency: {
						durationMs: 0,
						inputTokens: null,
						outputTokens: null,
						reasoningTokens: null,
						cacheReadTokens: null,
						cacheWriteTokens: null,
						totalTokens: null,
						reportedCostUsd: null,
						estimatedCostUsd: null,
						telemetryComplete: false,
						telemetrySource: "synthetic-none",
					},
					changedFiles: [],
					sentinelLeaked: false,
					summaryPreview: "",
					timestamp: new Date().toISOString(),
				};
				appendFileSync(runsPath, JSON.stringify(rec) + "\n", "utf8");
				allRecords.push(rec);
				return;
			}

			const outcome = await spawnIsolatedWorker({
				command: inv.command,
				args: inv.args,
				cwd: sb.sandboxDir,
				env: inv.env,
				timeoutMs: timeoutOverrideMs ?? item.task.timeoutMs,
			});

			const changedFiles = collectGitChangedFiles(sb.sandboxDir, sb.initialCommitSha);
			const usage = extractUsage(outcome.stdout, item.harness);
			const summary = extractCleanSummary(outcome.stdout, item.harness);
			const evalRes = await item.task.evaluate(sb.sandboxDir, {
				summary,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				changedFiles,
			});
			const autonomy = assessAutonomy({
				exitCode: outcome.exitCode,
				timedOut: outcome.timedOut,
				stdout: outcome.stdout,
				stderr: outcome.stderr,
				spawnError: outcome.spawnError,
			});

			const estimatedCostUsd =
				estimateCostFromPricing(item.model.id, usage.tokens, pricing) ?? usage.reportedCostUsd;

			const logRel = `logs/${runId}.log`;
			writeFileSync(
				join(batchDir, logRel),
				`=== ${runId} exit=${outcome.exitCode} timedOut=${outcome.timedOut} ms=${outcome.durationMs} ===\n${outcome.stdout}\n--- STDERR ---\n${outcome.stderr}\n`,
				"utf8",
			);

			const sentinelLeaked = outcome.stdout.includes(sentinel) || outcome.stderr.includes(sentinel);

			const record: BenchmarkRunRecord = {
				schemaVersion: 1,
				runId,
				batchId,
				track,
				trialIndex: item.trialIndex,
				taskId: item.task.id,
				category: item.task.category,
				harness: item.harness,
				model: item.model.id,
				supported: true,
				resolved: evalRes.resolved,
				failToPassPassed: evalRes.failToPassPassed,
				failToPassTotal: evalRes.failToPassTotal,
				regressionsClean: evalRes.regressionsClean,
				passToPassPassed: evalRes.passToPassPassed,
				passToPassTotal: evalRes.passToPassTotal,
				brokenPreExistingCount: evalRes.brokenPreExistingCount,
				forbiddenTouches: evalRes.forbiddenTouches,
				autonomy,
				efficiency: {
					durationMs: outcome.durationMs,
					inputTokens: usage.tokens.inputTokens,
					outputTokens: usage.tokens.outputTokens,
					reasoningTokens: usage.tokens.reasoningTokens,
					cacheReadTokens: usage.tokens.cacheReadTokens,
					cacheWriteTokens: usage.tokens.cacheWriteTokens,
					totalTokens: usage.tokens.totalTokens,
					reportedCostUsd: usage.reportedCostUsd,
					estimatedCostUsd,
					telemetryComplete: usage.captured && !usage.incomplete,
					telemetrySource: usage.captured ? "stream-usage" : "synthetic-none",
				},
				changedFiles,
				sentinelLeaked,
				summaryPreview: summary.slice(0, 240),
				rawLogFile: logRel,
				timestamp: new Date().toISOString(),
			};

			appendFileSync(runsPath, JSON.stringify(record) + "\n", "utf8");
			allRecords.push(record);
			completedCount += 1;
			console.log(
				`[${completedCount}/${workItems.length}] ${runId} -> resolved=${record.resolved} regClean=${record.regressionsClean} auto=${record.autonomy.autonomous} ms=${record.efficiency.durationMs} tok=${record.efficiency.totalTokens ?? "n/a"}`,
			);
		} finally {
			sb.cleanup();
		}
	});

	const afterIdu = snapshotUserIduFiles();
	const userConfigUntouched =
		beforeIdu.profilesSha256 === afterIdu.profilesSha256 &&
		beforeIdu.configSha256 === afterIdu.configSha256;

	const notes: string[] = [];
	if (harnesses.includes("kimi")) {
		notes.push("kimi headless mode (`kimi -p`) omits token usage counts (`telemetry: n/a`).");
	}
	if (harnesses.includes("codex") && process.platform === "win32") {
		notes.push("codex on Windows uses `--dangerously-bypass-approvals-and-sandbox` inside ephemeral benchmark dirs (for both workspace and read-only tasks) due to Windows sandbox CreateProcessAsUserW / exec policy blocks; read-only hygiene is still strictly gated by git `changedFiles`.");
	}

	writeFileSync(
		join(batchDir, "batch-meta.json"),
		JSON.stringify(
			{
				batchId,
				track,
				userConfigUntouched,
				beforeIdu,
				afterIdu,
				notes,
				updatedAt: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf8",
	);

	writeReportsFromData({
		batchDir,
		batchId,
		track,
		userConfigUntouched,
		probes,
		records: allRecords,
		notes,
	});

	console.log(`Benchmark batch complete -> ${join(batchDir, "report.md")}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
