import type {
	AutonomyAssessment,
	BenchmarkRunRecord,
	CellStats,
	InteractionResidual,
	MarginalRanking,
	RecommendationEntry,
	TaskCategory,
} from "./types.js";

function mean(nums: number[]): number | null {
	if (nums.length === 0) return null;
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function percentile(nums: number[], p: number): number | null {
	if (nums.length === 0) return null;
	const sorted = [...nums].sort((a, b) => a - b);
	const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
	return sorted[idx];
}

export function median(nums: number[]): number | null {
	if (nums.length === 0) return null;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function iqr(nums: number[]): number | null {
	if (nums.length === 0) return null;
	const q1 = percentile(nums, 0.25);
	const q3 = percentile(nums, 0.75);
	if (q1 === null || q3 === null) return null;
	return q3 - q1;
}

export function coefficientOfVariation(nums: number[]): number | null {
	if (nums.length < 2) return null;
	const m = mean(nums);
	if (m === null || m <= 0) return null;
	const variance = nums.reduce((acc, x) => acc + (x - m) ** 2, 0) / (nums.length - 1);
	return Math.sqrt(variance) / m;
}

/**
 * Numerically stable exact combinatoric estimator for pass@k = 1 - C(n-c, k)/C(n, k).
 */
export function computePassAtK(n: number, c: number, k: number): number {
	if (n <= 0 || k <= 0) return 0;
	const kk = Math.min(k, n);
	if (c <= 0) return 0;
	if (n - c < kk) return 1;
	let prod = 1;
	for (let i = 0; i < kk; i++) {
		prod *= (n - c - i) / (n - i);
	}
	return 1 - prod;
}

/** Deterministic PRNG (Mulberry32) so bootstrap confidence intervals are reproducible. */
function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function bootstrapRateCi(
	outcomes: boolean[],
	resamples = 1000,
	seed = 20261114,
): { low: number; high: number } {
	const n = outcomes.length;
	if (n === 0) return { low: 0, high: 0 };
	if (n === 1) {
		const v = outcomes[0] ? 1 : 0;
		return { low: v, high: v };
	}
	const rand = mulberry32(seed);
	const means: number[] = [];
	for (let b = 0; b < resamples; b++) {
		let hits = 0;
		for (let i = 0; i < n; i++) {
			if (outcomes[Math.floor(rand() * n)]) hits += 1;
		}
		means.push(hits / n);
	}
	means.sort((a, b) => a - b);
	return {
		low: means[Math.floor(0.025 * resamples)] ?? 0,
		high: means[Math.floor(0.975 * resamples)] ?? 1,
	};
}

const PROMPT_OR_BLOCK_PATTERNS = [
	/waiting for permission/i,
	/requires user confirmation/i,
	/please run ["']?(?:cmdc|codex|kimi|opencode) login/i,
	/Not authenticated/i,
	/CreateProcessAsUserW failed/i,
	/approval policy/i,
];

export function assessAutonomy(params: {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	spawnError?: string;
}): AutonomyAssessment {
	const { exitCode, timedOut, stdout, stderr, spawnError } = params;
	const combined = `${stderr}\n${stdout.slice(-4000)}`;
	const blockerMatch = PROMPT_OR_BLOCK_PATTERNS.find((re) => re.test(combined));
	const hungOrPrompted = Boolean(timedOut || blockerMatch);
	const crashed = Boolean(spawnError) || (exitCode !== null && exitCode !== 0 && !timedOut);

	let blockerReason: string | undefined;
	if (spawnError) blockerReason = `Spawn error: ${spawnError}`;
	else if (timedOut) blockerReason = "Timed out before clean worker exit";
	else if (blockerMatch) blockerReason = `Detected blocker signal: ${combined.match(blockerMatch)?.[0] ?? "blocked"}`;
	else if (exitCode !== 0) blockerReason = `Non-zero exit code (${String(exitCode)})`;

	return {
		autonomous: !timedOut && !hungOrPrompted && !crashed && exitCode === 0,
		timedOut,
		hungOrPrompted,
		crashed,
		exitCode,
		blockerReason,
	};
}

function computeCompositeScore(metrics: {
	resolutionRate: number;
	cleanRegressionRate: number;
	autonomyRate: number;
	passPowK: number;
}): number {
	// Weighted dimensionless quality index out of 100 emphasizing Resolution & Regression safety first.
	return Number(
		(
			100 *
			(0.45 * metrics.resolutionRate +
				0.2 * metrics.cleanRegressionRate +
				0.15 * metrics.autonomyRate +
				0.2 * metrics.passPowK)
		).toFixed(2),
	);
}

export function summarizeCellStats(records: BenchmarkRunRecord[], category: TaskCategory | "all" = "all"): CellStats[] {
	const filtered = category === "all" ? records : records.filter((r) => r.category === category);
	const byCell = new Map<string, BenchmarkRunRecord[]>();
	for (const r of filtered) {
		if (!r.supported) continue;
		const key = `${r.harness}::${r.model}`;
		const list = byCell.get(key) ?? [];
		list.push(r);
		byCell.set(key, list);
	}

	const stats: CellStats[] = [];
	for (const [key, group] of byCell.entries()) {
		const [harness, model] = key.split("::");
		const n = group.length;
		const resolvedCount = group.filter((r) => r.resolved).length;
		const resolutionRate = resolvedCount / n;
		const cleanRegressionRate = group.filter((r) => r.regressionsClean).length / n;
		const autonomyRate = group.filter((r) => r.autonomy.autonomous).length / n;

		// Group per task inside this cell to measure true per-task pass@1, pass^k, and empirical all-pass rate.
		const byTask = new Map<string, BenchmarkRunRecord[]>();
		for (const r of group) {
			const tl = byTask.get(r.taskId) ?? [];
			tl.push(r);
			byTask.set(r.taskId, tl);
		}
		const taskGroups = [...byTask.values()];
		const kTrials = Math.max(1, Math.min(...taskGroups.map((tg) => tg.length)));
		const passAt1Vals = taskGroups.map((tg) => tg.filter((r) => r.resolved).length / tg.length);
		const passAtKVals = taskGroups.map((tg) => computePassAtK(tg.length, tg.filter((r) => r.resolved).length, kTrials));
		const passPowKVals = taskGroups.map((tg) => Math.pow(tg.filter((r) => r.resolved).length / tg.length, kTrials));
		const empAllPassVals = taskGroups.map((tg) => (tg.every((r) => r.resolved) ? 1 : 0));

		const passAt1 = mean(passAt1Vals) ?? 0;
		const passAtK = mean(passAtKVals) ?? 0;
		const passPowK = mean(passPowKVals) ?? 0;
		const empiricalAllPassRate = mean(empAllPassVals) ?? 0;

		const durations = group.map((r) => r.efficiency.durationMs).filter((d) => Number.isFinite(d));
		const totalToks = group.map((r) => r.efficiency.totalTokens).filter((t): t is number => t !== null);
		const inToks = group.map((r) => r.efficiency.inputTokens).filter((t): t is number => t !== null);
		const outToks = group.map((r) => r.efficiency.outputTokens).filter((t): t is number => t !== null);
		const costs = group
			.map((r) => r.efficiency.estimatedCostUsd ?? r.efficiency.reportedCostUsd)
			.filter((c): c is number => c !== null);

		const telemetryCoverageRate = group.filter((r) => r.efficiency.totalTokens !== null).length / n;
		const compositeScore = computeCompositeScore({
			resolutionRate,
			cleanRegressionRate,
			autonomyRate,
			passPowK,
		});

		stats.push({
			key,
			harness,
			model,
			category,
			n,
			kTrials,
			resolvedCount,
			resolutionRate,
			cleanRegressionRate,
			autonomyRate,
			passAt1,
			passAtK,
			passPowK,
			empiricalAllPassRate,
			medianDurationMs: median(durations),
			p90DurationMs: percentile(durations, 0.9),
			iqrDurationMs: iqr(durations),
			durationCv: coefficientOfVariation(durations),
			medianTotalTokens: median(totalToks),
			meanTotalTokens: mean(totalToks),
			medianInputTokens: median(inToks),
			medianOutputTokens: median(outToks),
			meanEstimatedCostUsd: mean(costs),
			telemetryCoverageRate,
			compositeScore,
		});
	}

	return stats.sort(
		(a, b) =>
			b.resolutionRate - a.resolutionRate ||
			b.compositeScore - a.compositeScore ||
			(a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity),
	);
}

export function summarizeMarginalAxis(
	records: BenchmarkRunRecord[],
	axis: "model" | "harness",
	category: TaskCategory | "all" = "all",
): MarginalRanking[] {
	const filtered = records.filter((r) => r.supported && (category === "all" || r.category === category));
	const byKey = new Map<string, BenchmarkRunRecord[]>();
	for (const r of filtered) {
		const k = axis === "model" ? r.model : r.harness;
		const list = byKey.get(k) ?? [];
		list.push(r);
		byKey.set(k, list);
	}

	const rankings: MarginalRanking[] = [];
	for (const [name, group] of byKey.entries()) {
		const n = group.length;
		const bools = group.map((r) => r.resolved);
		const resolutionRate = bools.filter(Boolean).length / n;
		const ci = bootstrapRateCi(bools);
		const cleanRegressionRate = group.filter((r) => r.regressionsClean).length / n;
		const autonomyRate = group.filter((r) => r.autonomy.autonomous).length / n;

		// Per-(peer, task) pass^k averaged across cells so variance on small k reflects true repeatability.
		const subCells = new Map<string, BenchmarkRunRecord[]>();
		for (const r of group) {
			const sk = `${axis === "model" ? r.harness : r.model}::${r.taskId}`;
			const arr = subCells.get(sk) ?? [];
			arr.push(r);
			subCells.set(sk, arr);
		}
		const passPowK =
			mean(
				[...subCells.values()].map((sc) => Math.pow(sc.filter((r) => r.resolved).length / sc.length, sc.length)),
			) ?? resolutionRate;

		const durations = group.map((r) => r.efficiency.durationMs).filter((d) => Number.isFinite(d));
		const toks = group.map((r) => r.efficiency.totalTokens).filter((t): t is number => t !== null);
		const costs = group
			.map((r) => r.efficiency.estimatedCostUsd ?? r.efficiency.reportedCostUsd)
			.filter((c): c is number => c !== null);

		rankings.push({
			name,
			n,
			resolutionRate,
			ciLow: ci.low,
			ciHigh: ci.high,
			cleanRegressionRate,
			autonomyRate,
			passPowK,
			medianDurationMs: median(durations),
			meanTotalTokens: mean(toks),
			meanEstimatedCostUsd: mean(costs),
			telemetryCoverageRate: group.filter((r) => r.efficiency.totalTokens !== null).length / n,
			compositeScore: computeCompositeScore({
				resolutionRate,
				cleanRegressionRate,
				autonomyRate,
				passPowK,
			}),
		});
	}

	return rankings.sort(
		(a, b) =>
			b.resolutionRate - a.resolutionRate ||
			b.compositeScore - a.compositeScore ||
			(a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity),
	);
}

/**
 * Separates additive Model + Harness effects from genuine interaction effects:
 * residual(h, m) = observed(h, m) - (mean(h) + mean(m) - grandMean).
 */
export function computeInteractionResiduals(cells: CellStats[]): InteractionResidual[] {
	if (cells.length === 0) return [];
	const grandMean = mean(cells.map((c) => c.resolutionRate)) ?? 0;

	const harnessMeans = new Map<string, number>();
	for (const h of new Set(cells.map((c) => c.harness))) {
		harnessMeans.set(h, mean(cells.filter((c) => c.harness === h).map((c) => c.resolutionRate)) ?? 0);
	}
	const modelMeans = new Map<string, number>();
	for (const m of new Set(cells.map((c) => c.model))) {
		modelMeans.set(m, mean(cells.filter((c) => c.model === m).map((c) => c.resolutionRate)) ?? 0);
	}

	return cells
		.map((c) => {
			const rowMean = harnessMeans.get(c.harness) ?? grandMean;
			const colMean = modelMeans.get(c.model) ?? grandMean;
			const expectedAdditiveRate = rowMean + colMean - grandMean;
			return {
				harness: c.harness,
				model: c.model,
				observedRate: c.resolutionRate,
				expectedAdditiveRate,
				residual: c.resolutionRate - expectedAdditiveRate,
				n: c.n,
			};
		})
		.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
}

export const TASK_CATEGORY_ORDER: readonly TaskCategory[] = [
	"terminal-bench",
	"swe-bench",
	"audit-bench",
	"consult-bench",
	"explore-bench",
	"design-bench",
];

/** Returns the distinct task categories present in `records` in canonical order. */
export function getPresentCategories(records: BenchmarkRunRecord[]): TaskCategory[] {
	const seen = new Set(records.map((r) => r.category));
	return TASK_CATEGORY_ORDER.filter((cat) => seen.has(cat));
}

export function buildRecommendations(records: BenchmarkRunRecord[]): RecommendationEntry[] {
	const out: RecommendationEntry[] = [];
	const scopes: Array<TaskCategory | "overall"> = ["overall", ...getPresentCategories(records)];

	for (const scope of scopes) {
		const cells = summarizeCellStats(records, scope === "overall" ? "all" : scope);
		if (cells.length === 0) continue;

		const bestOverall = [...cells].sort(
			(a, b) =>
				b.compositeScore - a.compositeScore ||
				b.resolutionRate - a.resolutionRate ||
				(a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity),
		)[0];
		out.push({
			category: scope,
			criterion: "best_overall",
			harness: bestOverall.harness,
			model: bestOverall.model,
			resolutionRate: bestOverall.resolutionRate,
			passPowK: bestOverall.passPowK,
			medianDurationMs: bestOverall.medianDurationMs,
			meanTotalTokens: bestOverall.meanTotalTokens,
			note: `Highest composite score (${bestOverall.compositeScore}) across resolution, regressions, autonomy & repeatability.`,
		});

		const passing = cells.filter((c) => c.resolutionRate >= 0.5);
		const pool = passing.length > 0 ? passing : cells;

		const fastest = [...pool].sort(
			(a, b) => (a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity) || b.resolutionRate - a.resolutionRate,
		)[0];
		out.push({
			category: scope,
			criterion: "fastest",
			harness: fastest.harness,
			model: fastest.model,
			resolutionRate: fastest.resolutionRate,
			passPowK: fastest.passPowK,
			medianDurationMs: fastest.medianDurationMs,
			meanTotalTokens: fastest.meanTotalTokens,
			note: `Lowest median latency (${fastest.medianDurationMs ?? "n/a"}ms) among >=50% passing cells.`,
		});

		const withTokens = pool.filter((c) => c.meanTotalTokens !== null || c.meanEstimatedCostUsd !== null);
		if (withTokens.length > 0) {
			const economical = [...withTokens].sort(
				(a, b) =>
					(a.meanTotalTokens ?? Infinity) - (b.meanTotalTokens ?? Infinity) ||
					(a.meanEstimatedCostUsd ?? Infinity) - (b.meanEstimatedCostUsd ?? Infinity),
			)[0];
			out.push({
				category: scope,
				criterion: "most_economical",
				harness: economical.harness,
				model: economical.model,
				resolutionRate: economical.resolutionRate,
				passPowK: economical.passPowK,
				medianDurationMs: economical.medianDurationMs,
				meanTotalTokens: economical.meanTotalTokens,
				note: `Lowest mean token usage (${economical.meanTotalTokens ? Math.round(economical.meanTotalTokens) : "n/a"} tokens) among >=50% passing cells.`,
			});
		}

		const reliable = [...cells].sort(
			(a, b) =>
				b.passPowK - a.passPowK ||
				b.cleanRegressionRate - a.cleanRegressionRate ||
				(a.durationCv ?? Infinity) - (b.durationCv ?? Infinity),
		)[0];
		out.push({
			category: scope,
			criterion: "most_reliable",
			harness: reliable.harness,
			model: reliable.model,
			resolutionRate: reliable.resolutionRate,
			passPowK: reliable.passPowK,
			medianDurationMs: reliable.medianDurationMs,
			meanTotalTokens: reliable.meanTotalTokens,
			note: `Highest repeatability pass^k=${(reliable.passPowK * 100).toFixed(1)}% with ${(reliable.cleanRegressionRate * 100).toFixed(1)}% clean regressions.`,
		});
	}

	return out;
}
