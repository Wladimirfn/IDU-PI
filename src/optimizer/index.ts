import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getIduHome } from "../config.js";
import { applyOptimization, proposeOptimization, runOptimizationBench } from "./runner.js";
import type { OptimizeApplyOutcome, OptimizeProposal, OptimizeRunResult } from "./types.js";

export * from "./types.js";
export * from "./artificial-analysis.js";
export * from "./discovery.js";
export * from "./roles.js";
export * from "./runner.js";

export function parseCsvFlag(args: string[], flag: string): string[] | undefined {
	const values: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== flag) continue;
		// Consume consecutive non-flag arguments so PowerShell unquoted `a,b` array args work seamlessly.
		for (let j = i + 1; j < args.length && !args[j].startsWith("-"); j++) {
			for (const item of args[j].split(",")) {
				const trimmed = item.trim();
				if (trimmed) values.push(trimmed);
			}
		}
	}
	return values.length > 0 ? [...new Set(values)] : undefined;
}

function parseIntFlag(args: string[], flag: string): number | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1 || !args[idx + 1]) return undefined;
	const n = Number.parseInt(args[idx + 1], 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function formatProposalMarkdown(proposal: OptimizeProposal): string {
	const lines: string[] = [];
	lines.push(`# IDU-PI Auto-Optimizer Proposal (${proposal.generatedAt})`);
	lines.push("");
	lines.push(
		`- **CLIs detectados**: ${proposal.clis.filter((c) => c.available).length}/${proposal.clis.length} | **Proveedores/Keys**: ${proposal.providers.length} | **Modelos descubiertos**: ${proposal.discoveredModelCount}`,
	);
	lines.push(
		`- **Artificial Analysis**: \`${proposal.aaSource}\` (${proposal.aaModelCount} modelos${proposal.aaFetchedAt ? `, cache ${proposal.aaFetchedAt}` : ""})`,
	);
	lines.push(
		`- **Mini-Bench Shortlist**: ${proposal.shortlist.length} celdas | **Costo API estimado**: ~$${proposal.estimatedTotalCostUsd.toFixed(4)} USD + ${proposal.estimatedPlanCalls} llamadas de plan | **Tiempo estimado**: ~${Math.ceil(proposal.estimatedDurationSec / 60)}m`,
	);
	lines.push("");
	lines.push("## 1. CLIs, Planes y Cuotas");
	lines.push("| CLI | Estado | Facturación | Plan / Cuota restante | Proveedores | Modelos |");
	lines.push("| --- | --- | --- | --- | --- | ---: |");
	for (const cli of proposal.clis) {
		const status = cli.available ? "OK" : "NOT FOUND";
		const quotaStr =
			cli.remainingPercent !== null
				? `${cli.planLabel ?? cli.billingModel} (${cli.remainingPercent.toFixed(0)}% libre)`
				: cli.planLabel ?? "-";
		lines.push(
			`| \`${cli.harness}\` | ${status} | ${cli.billingModel} | ${quotaStr} | ${cli.authProviders.join(", ") || "-"} | ${cli.discoveredModelCount} |`,
		);
	}
	lines.push("");
	lines.push("## 2. Concepto y Top Candidatos por Rol");
	for (const role of proposal.roles) {
		lines.push(`### ${role.role} (\`${role.permissions}\`)`);
		lines.push(`- **Concepto**: ${role.concept}`);
		lines.push(
			`- **Actuales**: ${role.currentProfiles.map((p) => `\`${p.profileName}\` (${p.harness} · ${p.model ?? "default"})`).join(", ") || "ninguno"}`,
		);
		if (role.topCandidates.length > 0) {
			lines.push("- **Top candidatos AA/Plan**:");
			for (const c of role.topCandidates.slice(0, 3)) {
				lines.push(
					`  - \`${c.harness} · ${c.profileModel}\` — **${c.compositeScore} pts** (${c.rationale})`,
				);
			}
		}
		if (role.notes.length > 0) {
			for (const n of role.notes) lines.push(`- Nota: ${n}`);
		}
		lines.push("");
	}

	if (proposal.shortlist.length > 0) {
		lines.push("## 3. Plan del Mini-Benchmark (Sin Gasto Todavía)");
		lines.push("| Rol | Harness | Modelo | Tarea | Billing | Costo est. | Duración est. |");
		lines.push("| --- | --- | --- | --- | --- | ---: | ---: |");
		for (const cell of proposal.shortlist) {
			lines.push(
				`| ${cell.role} | \`${cell.harness}\` | \`${cell.profileModel}\` | \`${cell.taskId}\` | ${cell.billingModel} | $${cell.estCostUsd.toFixed(4)} | ~${cell.estDurationSec}s |`,
			);
		}
		lines.push("");
	}

	if (proposal.warnings.length > 0) {
		lines.push("## Avisos");
		for (const w of proposal.warnings) lines.push(`- ${w}`);
		lines.push("");
	}

	lines.push("Siguiente paso recomendado (solo tras confirmar): `idu-pi optimize --run-bench`");
	return lines.join("\n");
}

export function formatRunResultMarkdown(runResult: OptimizeRunResult): string {
	const lines: string[] = [];
	lines.push(`# IDU-PI Auto-Optimizer Bench Report (${runResult.runId})`);
	lines.push("");
	lines.push(`- **Ejecutado**: ${runResult.executedAt}`);
	lines.push(`- **Config usuario ~/.idu intacta**: ${runResult.userConfigUntouched ? "VERIFICADA" : "ALERTA"}`);
	lines.push("");
	lines.push("## 1. Resultados Medidos del Shortlist");
	lines.push("| Rol | Harness | Modelo | Tarea | Resuelto | Regresiones | Tiempo | Tokens | Costo | Score |");
	lines.push("| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |");
	for (const o of runResult.outcomes) {
		const res = !o.supported ? `UNSUP (${o.unsupportedReason ?? ""})` : o.resolved ? `SI (${o.failToPassPassed}/${o.failToPassTotal})` : `NO (${o.failToPassPassed}/${o.failToPassTotal})`;
		const reg = o.regressionsClean ? "clean" : "DIRTY";
		const sec = `${(o.durationMs / 1000).toFixed(1)}s`;
		const tok = o.totalTokens !== null ? String(o.totalTokens) : "n/a";
		const cost = o.costUsd !== null ? `$${o.costUsd.toFixed(4)}` : "n/a";
		lines.push(
			`| ${o.role} | \`${o.harness}\` | \`${o.profileModel}\` | \`${o.taskId}\` | ${res} | ${reg} | ${sec} | ${tok} | ${cost} | ${o.compositeBenchScore} |`,
		);
	}
	lines.push("");
	lines.push("## 2. Recomendaciones para `profiles.json`");
	lines.push("| Perfil | Rol | Acción | Actual | Propuesto | Motivo |");
	lines.push("| --- | --- | --- | --- | --- | --- |");
	for (const rec of runResult.recommendations) {
		const cur = `${rec.current.harness} · ${rec.current.model ?? "default"}`;
		const next = `${rec.recommended.harness} · ${rec.recommended.model}`;
		lines.push(`| \`${rec.profileName}\` | ${rec.role} | **${rec.action}** | \`${cur}\` | \`${next}\` | ${rec.reason} |`);
	}
	lines.push("");
	const updatable = runResult.recommendations.filter((r) => r.action === "update" && r.applyAllowed);
	if (updatable.length > 0) {
		lines.push("Para aplicar las actualizaciones aprobadas: `idu-pi optimize --apply`");
	} else {
		lines.push("No hay cambios automáticos obligatorios; tus titulares actuales siguen sólidos.");
	}
	return lines.join("\n");
}

export function formatApplyOutcomeMarkdown(outcome: OptimizeApplyOutcome): string {
	const lines: string[] = [];
	lines.push(`# IDU-PI Auto-Optimizer Apply (${outcome.appliedAt})`);
	lines.push(`- **Archivo**: ${outcome.profilesPath}`);
	if (outcome.backupPath) lines.push(`- **Backup**: ${outcome.backupPath}`);
	if (outcome.updatedProfiles.length === 0) {
		lines.push("- Sin perfiles modificados.");
	} else {
		lines.push(`- **Perfiles actualizados (${outcome.updatedProfiles.length})**:`);
		for (const u of outcome.updatedProfiles) {
			lines.push(
				`  - \`${u.profileName}\`: \`${u.before.harness}/${u.before.model}\` -> \`${u.after.harness}/${u.after.model}\``,
			);
		}
	}
	return lines.join("\n");
}

export function printOptimizeHelp(): void {
	console.log(
		[
			"idu-pi optimize — Safe 3-stage fleet optimizer (Discover -> Mini-Bench -> Apply)",
			"",
			"Usage:",
			"  idu-pi optimize [--propose] [--roles <a,b>] [--top <N>] [--fresh] [--json]",
			"      Stage 1 (DEFAULT, ZERO SPEND): discovers CLIs, active plans/quotas, live endpoint models,",
			"      queries Artificial Analysis (quality/speed/cost), and proposes a shortlist + estimated cost.",
			"  idu-pi optimize --run-bench [--roles <a,b>] [--top <N>] [--concurrency <N>] [--include-heavy] [--json]",
			"      Stage 2: runs the bounded mini-benchmark ONLY on shortlisted candidates in isolated sandboxes.",
			"  idu-pi optimize --apply [--profiles <p1,p2>] [--json]",
			"      Stage 3: creates a timestamped backup and writes approved updates to ~/.idu/profiles.json.",
			"",
			"Options:",
			"  --fresh         Bypass caches for both Artificial Analysis and CLI quotas",
			"  --fresh-aa      Force refresh of Artificial Analysis model catalog",
			"  --fresh-quota   Force live quota probe across CLIs (may spend 1 call each on claude/agy)",
			"  --include-heavy Include slow 3D/Playwright design-01 cells in mini-benchmark shortlist",
			"  --offline       Skip live /v1/models HTTP probes during discovery",
			"  --json          Emit machine-readable JSON (recommended for AI orchestrators)",
		].join("\n"),
	);
}

export async function runOptimizeCli(args: string[]): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		printOptimizeHelp();
		return;
	}

	const asJson = args.includes("--json");
	const roles = parseCsvFlag(args, "--roles");
	const onlyProfiles = parseCsvFlag(args, "--profiles");
	const shortlistPerRole = parseIntFlag(args, "--top");
	const concurrency = parseIntFlag(args, "--concurrency");
	const fresh = args.includes("--fresh");
	const freshAa = fresh || args.includes("--fresh-aa");
	const freshQuota = fresh || args.includes("--fresh-quota");
	const includeHeavyBench = args.includes("--include-heavy");
	const skipLiveEndpoints = args.includes("--offline");

	if (args.includes("--apply")) {
		const outcome = applyOptimization({ onlyProfiles });
		if (asJson) console.log(JSON.stringify(outcome, null, 2));
		else console.log(formatApplyOutcomeMarkdown(outcome));
		return;
	}

	if (args.includes("--run-bench")) {
		const runResult = await runOptimizationBench({
			roles,
			shortlistPerRole,
			concurrency,
			freshAa,
			freshQuota,
			includeHeavyBench,
			skipLiveEndpoints,
			onProgress: asJson ? undefined : (line) => console.log(line),
		});
		const md = formatRunResultMarkdown(runResult);
		const reportDir = join(getIduHome(), "optimize");
		mkdirSync(reportDir, { recursive: true });
		writeFileSync(join(reportDir, "latest-report.md"), md, "utf8");
		if (asJson) console.log(JSON.stringify(runResult, null, 2));
		else console.log(md);
		return;
	}

	// Default Stage 1: safe zero-spend `propose`
	const proposal = await proposeOptimization({
		roles,
		shortlistPerRole,
		freshAa,
		freshQuota,
		includeHeavyBench,
		skipLiveEndpoints,
	});
	if (asJson) console.log(JSON.stringify(proposal, null, 2));
	else console.log(formatProposalMarkdown(proposal));
}
