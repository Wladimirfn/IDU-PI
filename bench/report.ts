import {
	buildRecommendations,
	computeInteractionResiduals,
	getPresentCategories,
	summarizeCellStats,
	summarizeMarginalAxis,
} from "./stats.js";
import type {
	BenchmarkRunRecord,
	BenchmarkTrack,
	CapabilityProbeEntry,
	CellStats,
	MarginalRanking,
	TaskCategory,
} from "./types.js";

const CATEGORY_TITLES: Record<TaskCategory, string> = {
	"terminal-bench": "Terminal-Bench Subset",
	"swe-bench": "SWE-bench Subset",
	"audit-bench": "Audit-Bench Subset (Read-Only)",
	"consult-bench": "Consult-Bench Subset (Read-Only)",
	"explore-bench": "Explore-Bench Subset (Read-Only)",
	"design-bench": "Design-Bench Subset (3D Composition)",
};

function pct(v: number): string {
	return `${(v * 100).toFixed(1)}%`;
}

function fmtMs(v: number | null): string {
	if (v === null) return "n/a";
	return `${(v / 1000).toFixed(1)}s`;
}

function fmtNum(v: number | null): string {
	if (v === null) return "n/a";
	return Math.round(v).toLocaleString("en-US");
}

function fmtCost(v: number | null): string {
	if (v === null) return "n/a";
	return `$${v.toFixed(4)}`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface BenchmarkReportInput {
	batchId: string;
	track: BenchmarkTrack;
	generatedAt: string;
	userConfigUntouched: boolean;
	probes: CapabilityProbeEntry[];
	records: BenchmarkRunRecord[];
	notes?: string[];
}

export function renderMarkdownReport(input: BenchmarkReportInput): string {
	const { batchId, track, generatedAt, userConfigUntouched, probes, records, notes = [] } = input;
	const supportedRecords = records.filter((r) => r.supported);
	const modelRankings = summarizeMarginalAxis(records, "model", "all");
	const harnessRankings = summarizeMarginalAxis(records, "harness", "all");
	const cells = summarizeCellStats(records, "all");
	const presentCategories = getPresentCategories(records);
	const interactions = computeInteractionResiduals(cells).slice(0, 12);
	const recs = buildRecommendations(records);

	const lines: string[] = [];
	lines.push(`# IDU-PI Multi-Harness & Nan Model Benchmark Report`);
	lines.push("");
	lines.push(`- **Batch ID**: \`${batchId}\``);
	lines.push(`- **Track**: \`${track}\` (${track === "controlled" ? "isolated homes, zero host MCP/skills/taste, prompt & model parity; native harness tool loops" : "native host defaults"})`);
	lines.push(`- **Generated**: ${generatedAt}`);
	lines.push(`- **Total Executed Runs**: ${supportedRecords.length} (plus ${records.length - supportedRecords.length} skipped unsupported cells)`);
	lines.push(`- **Host Config Integrity (~/.idu SHA-256 unchanged)**: ${userConfigUntouched ? "VERIFIED" : "CHANGED"}`);
	lines.push(`- **Sentinel Leaks Detected**: ${records.filter((r) => r.sentinelLeaked).length}`);
	if (notes.length > 0) {
		for (const n of notes) lines.push(`- **Disclosure**: ${n}`);
	}
	lines.push("");

	lines.push("## 1. Recommended Selections per Category");
	lines.push("");
	lines.push("| Category | Criterion | Harness | Model | Resolution | pass^k | Median Time | Mean Tokens | Rationale |");
	lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |");
	for (const rec of recs) {
		lines.push(
			`| ${rec.category} | ${rec.criterion} | \`${rec.harness}\` | \`${rec.model}\` | ${pct(rec.resolutionRate)} | ${pct(rec.passPowK)} | ${fmtMs(rec.medianDurationMs)} | ${fmtNum(rec.meanTotalTokens)} | ${rec.note} |`,
		);
	}
	lines.push("");

	if (probes.length > 0) {
		lines.push("## 2. Harness Capability Probe (Nan BYOK)");
		lines.push("");
		lines.push("| Harness | Model | Capability | Latency | Exit | Telemetry Captured | Notes |");
		lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
		for (const p of probes) {
			lines.push(
				`| \`${p.harness}\` | \`${p.model}\` | **${p.supported}** | ${fmtMs(p.durationMs)} | ${p.exitCode ?? "null"} | ${p.usageCaptured ? "yes" : "no"} | ${p.reason ?? "ok"} |`,
			);
		}
		lines.push("");
	}

	const renderAxisTable = (title: string, label: string, rows: MarginalRanking[]) => {
		lines.push(title);
		lines.push("");
		lines.push(
			`| ${label} | n | Resolution (95% CI) | Clean Regressions | Autonomy | pass^k | Median Time | Mean Tokens | Mean Cost | Telemetry | Score |`,
		);
		lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
		for (const row of rows) {
			lines.push(
				`| \`${row.name}\` | ${row.n} | ${pct(row.resolutionRate)} (${pct(row.ciLow)}–${pct(row.ciHigh)}) | ${pct(row.cleanRegressionRate)} | ${pct(row.autonomyRate)} | ${pct(row.passPowK)} | ${fmtMs(row.medianDurationMs)} | ${fmtNum(row.meanTotalTokens)} | ${fmtCost(row.meanEstimatedCostUsd)} | ${pct(row.telemetryCoverageRate)} | ${row.compositeScore.toFixed(1)} |`,
			);
		}
		lines.push("");
	};

	renderAxisTable("## 3. Model Effect (Marginal across compatible harnesses)", "Model", modelRankings);
	renderAxisTable("## 4. Harness Effect (Marginal across tested Nan models)", "Harness", harnessRankings);

	const renderCellTable = (title: string, rows: CellStats[]) => {
		lines.push(title);
		lines.push("");
		lines.push(
			"| Harness | Model | n | Resolution | Regressions Clean | Autonomy | pass@1 | pass^k | Median Time | P90 Time | Mean Tokens | Score |",
		);
		lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
		for (const c of rows) {
			lines.push(
				`| \`${c.harness}\` | \`${c.model}\` | ${c.n} | ${pct(c.resolutionRate)} | ${pct(c.cleanRegressionRate)} | ${pct(c.autonomyRate)} | ${pct(c.passAt1)} | ${pct(c.passPowK)} | ${fmtMs(c.medianDurationMs)} | ${fmtMs(c.p90DurationMs)} | ${fmtNum(c.meanTotalTokens)} | ${c.compositeScore.toFixed(1)} |`,
			);
		}
		lines.push("");
	};

	renderCellTable("## 5. Full Harness x Model Matrix (All Tasks)", cells);
	presentCategories.forEach((cat, idx) => {
		const catCells = summarizeCellStats(records, cat);
		if (catCells.length > 0) {
			const letter = String.fromCharCode(97 + idx);
			renderCellTable(`### 5${letter}. ${CATEGORY_TITLES[cat]}`, catCells);
		}
	});

	if (interactions.length > 0) {
		lines.push("## 6. Top Harness x Model Interaction Residuals");
		lines.push("");
		lines.push("Positive residual means this specific harness+model pair performed ABOVE additive expectations (`observed - (harnessMean + modelMean - grandMean)`). Negative means harness friction held the model back.");
		lines.push("");
		lines.push("| Harness | Model | n | Observed | Expected Additive | Residual |");
		lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
		for (const ix of interactions) {
			const sign = ix.residual >= 0 ? "+" : "";
			lines.push(
				`| \`${ix.harness}\` | \`${ix.model}\` | ${ix.n} | ${pct(ix.observedRate)} | ${pct(ix.expectedAdditiveRate)} | ${sign}${pct(ix.residual)} |`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export function renderHtmlReport(input: BenchmarkReportInput): string {
	const modelRankings = summarizeMarginalAxis(input.records, "model", "all");
	const harnessRankings = summarizeMarginalAxis(input.records, "harness", "all");
	const cells = summarizeCellStats(input.records, "all");
	const recs = buildRecommendations(input.records);

	const harnesses = [...new Set(cells.map((c) => c.harness))];
	const models = [...new Set(cells.map((c) => c.model))];
	const cellMap = new Map(cells.map((c) => [`${c.harness}::${c.model}`, c]));

	const heatColor = (rate: number): string => {
		if (rate >= 0.85) return "rgba(34,197,94,0.28)";
		if (rate >= 0.5) return "rgba(234,179,8,0.25)";
		return "rgba(239,68,68,0.25)";
	};

	const matrixRows = harnesses
		.map((h) => {
			const tds = models
				.map((m) => {
					const c = cellMap.get(`${h}::${m}`);
					if (!c) return `<td class="muted">unsupported / n=0</td>`;
					return `<td style="background:${heatColor(c.resolutionRate)}"><strong>${pct(c.resolutionRate)}</strong><br><small>pass^k ${pct(c.passPowK)} · ${fmtMs(c.medianDurationMs)} · ${fmtNum(c.meanTotalTokens)} tok</small></td>`;
				})
				.join("");
			return `<tr><th><code>${escapeHtml(h)}</code></th>${tds}</tr>`;
		})
		.join("");

	const axisRows = (rows: MarginalRanking[]) =>
		rows
			.map(
				(r) =>
					`<tr><td><code>${escapeHtml(r.name)}</code></td><td>${r.n}</td><td><strong>${pct(r.resolutionRate)}</strong> <small>(${pct(r.ciLow)}–${pct(r.ciHigh)})</small></td><td>${pct(r.cleanRegressionRate)}</td><td>${pct(r.autonomyRate)}</td><td>${pct(r.passPowK)}</td><td>${fmtMs(r.medianDurationMs)}</td><td>${fmtNum(r.meanTotalTokens)}</td><td>${r.compositeScore.toFixed(1)}</td></tr>`,
			)
			.join("");

	const recCards = recs
		.filter((r) => r.criterion === "best_overall")
		.map(
			(r) =>
				`<div class="card"><div class="tag">${escapeHtml(r.category)} · Best Overall</div><div class="big">${escapeHtml(r.harness)} + ${escapeHtml(r.model)}</div><div class="meta">Resolution ${pct(r.resolutionRate)} · pass^k ${pct(r.passPowK)} · ${fmtMs(r.medianDurationMs)}</div></div>`,
		)
		.join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>IDU-PI Benchmark Report — ${escapeHtml(input.batchId)}</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --border:#334155; --fg:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; }
  body { margin:0; padding:28px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--fg); line-height:1.5; }
  h1,h2 { color:#f8fafc; margin-top:28px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:14px; margin:16px 0 28px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .tag { font-size:12px; color:var(--accent); text-transform:uppercase; letter-spacing:0.06em; }
  .big { font-size:18px; font-weight:700; margin:4px 0; }
  .meta { font-size:13px; color:var(--muted); }
  table { width:100%; border-collapse:collapse; margin:12px 0 28px; background:var(--card); border-radius:8px; overflow:hidden; font-size:13px; }
  th,td { border:1px solid var(--border); padding:8px 10px; text-align:left; vertical-align:top; }
  th { background:#0b1324; color:#cbd5e1; font-weight:600; }
  .muted { color:var(--muted); font-style:italic; }
  code { color:#7dd3fc; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  small { color:#cbd5e1; font-size:11px; }
</style>
</head>
<body>
<h1>IDU-PI Multi-Harness &amp; Nan Model Benchmark</h1>
<p class="meta">Batch <code>${escapeHtml(input.batchId)}</code> · Track <code>${escapeHtml(input.track)}</code> · Generated ${escapeHtml(input.generatedAt)} · Runs: ${input.records.filter((r) => r.supported).length} · ~/.idu untouched: ${String(input.userConfigUntouched)}</p>

<div class="grid">${recCards}</div>

<h2>Harness × Model Heatmap (Resolución · pass^k · Latency · Tokens)</h2>
<table>
<thead><tr><th>Harness</th>${models.map((m) => `<th><code>${escapeHtml(m)}</code></th>`).join("")}</tr></thead>
<tbody>${matrixRows}</tbody>
</table>

<h2>Model Effect (Marginal Across Harnesses)</h2>
<table>
<thead><tr><th>Model</th><th>n</th><th>Resolution (95% CI)</th><th>Clean Regressions</th><th>Autonomy</th><th>pass^k</th><th>Median Time</th><th>Mean Tokens</th><th>Score</th></tr></thead>
<tbody>${axisRows(modelRankings)}</tbody>
</table>

<h2>Harness Effect (Marginal Across Nan Models)</h2>
<table>
<thead><tr><th>Harness</th><th>n</th><th>Resolution (95% CI)</th><th>Clean Regressions</th><th>Autonomy</th><th>pass^k</th><th>Median Time</th><th>Mean Tokens</th><th>Score</th></tr></thead>
<tbody>${axisRows(harnessRankings)}</tbody>
</table>
</body>
</html>
`;
}
