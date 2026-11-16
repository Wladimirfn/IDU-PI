import { extractRoleRank, inferProfileRole } from "../tui.js";
import type { IduProfile, QuotaSnapshot } from "../types.js";
import { matchAaModel, normalizeModelKeyForAa } from "./artificial-analysis.js";
import type {
	AaModelMetrics,
	DiscoveredModelCandidate,
	HistoricalBenchMetric,
	MiniBenchCellPlan,
	RoleCurrentProfileSummary,
	RoleObjectiveSpec,
	RoleProposalSummary,
	ScoredCandidate,
} from "./types.js";

export const ROLE_OBJECTIVES: Record<string, RoleObjectiveSpec> = {
	Trabajo: {
		role: "Trabajo",
		concept: "Alta calidad en código/terminal, baja latencia y bajo costo operativo por iteración.",
		permissions: "workspace",
		benchmarkTaskId: "tb-01-log-forensics",
		benchmarkCategory: "terminal-bench",
		weights: { intelligence: 0.25, coding: 0.35, speed: 0.2, costEfficiency: 0.2, visual3d: 0 },
		estBenchTokensPerCell: 28_000,
		estBenchDurationSecPerCell: 60,
		preferFastCheapForMiniBench: true,
		notes: "Prioriza modelos capaces de editar archivos con seguridad y resolver suites de test sin loops largos.",
	},
	Auditoría: {
		role: "Auditoría",
		concept: "Alta calidad analítica y buena velocidad para revisión adversarial sin falsos positivos.",
		permissions: "read-only",
		benchmarkTaskId: "audit-01-security-race",
		benchmarkCategory: "audit-bench",
		weights: { intelligence: 0.4, coding: 0.25, speed: 0.25, costEfficiency: 0.1, visual3d: 0 },
		estBenchTokensPerCell: 16_000,
		estBenchDurationSecPerCell: 45,
	},
	Consultas: {
		role: "Consultas",
		concept: "Máxima calidad de razonamiento, profundidad técnica y criterio de tradeoffs.",
		permissions: "read-only",
		benchmarkTaskId: "consult-01-arch-tradeoff",
		benchmarkCategory: "consult-bench",
		weights: { intelligence: 0.55, coding: 0.2, speed: 0.15, costEfficiency: 0.1, visual3d: 0 },
		estBenchTokensPerCell: 22_000,
		estBenchDurationSecPerCell: 65,
	},
	Arquitectura: {
		role: "Arquitectura",
		concept: "Máxima inteligencia estructural, revisión de contratos y blast radius sin alucinar símbolos.",
		permissions: "read-only",
		benchmarkTaskId: "consult-01-arch-tradeoff",
		benchmarkCategory: "consult-bench",
		weights: { intelligence: 0.5, coding: 0.25, speed: 0.1, costEfficiency: 0.15, visual3d: 0 },
		estBenchTokensPerCell: 22_000,
		estBenchDurationSecPerCell: 70,
	},
	Exploración: {
		role: "Exploración",
		concept: "Velocidad máxima, costo mínimo y tool-calling confiable para mapear código en paralelo.",
		permissions: "read-only",
		benchmarkTaskId: "explore-01-callflow-map",
		benchmarkCategory: "explore-bench",
		weights: { intelligence: 0.15, coding: 0.15, speed: 0.35, costEfficiency: 0.35, visual3d: 0 },
		estBenchTokensPerCell: 14_000,
		estBenchDurationSecPerCell: 35,
	},
	Diseño: {
		role: "Diseño",
		concept: "Calidad visual/3D/motion y generación HTML/WebGL limpia.",
		permissions: "workspace",
		benchmarkTaskId: "design-01-3d-benchmark-explainer",
		benchmarkCategory: "design-bench",
		weights: { intelligence: 0.25, coding: 0.3, speed: 0.1, costEfficiency: 0.1, visual3d: 0.25 },
		estBenchTokensPerCell: 95_000,
		estBenchDurationSecPerCell: 210,
		notes: "El mini-bench 3D completo requiere Playwright; por defecto se omite salvo --include-heavy.",
	},
	Iconografía: {
		role: "Iconografía",
		concept: "Precisión geométrica SVG y coherencia visual con buen equilibrio de costo.",
		permissions: "workspace",
		benchmarkTaskId: null,
		benchmarkCategory: null,
		weights: { intelligence: 0.25, coding: 0.3, speed: 0.15, costEfficiency: 0.15, visual3d: 0.15 },
		estBenchTokensPerCell: 0,
		estBenchDurationSecPerCell: 0,
		notes: "Sin micro-bench automático hoy; rankeado por Artificial Analysis (calidad + código + 3D/visual).",
	},
	Voz: {
		role: "Voz",
		concept: "Ejecución rápida y económica de comandos/scripts locales sobre Voicebox.",
		permissions: "workspace",
		benchmarkTaskId: null,
		benchmarkCategory: null,
		weights: { intelligence: 0.15, coding: 0.15, speed: 0.35, costEfficiency: 0.35, visual3d: 0 },
		estBenchTokensPerCell: 0,
		estBenchDurationSecPerCell: 0,
		notes: "Rol de orquestación local; rankeado por velocidad + costo + tool-calling.",
	},
	Música: {
		role: "Música",
		concept: "Ejecución rápida y económica de guiones de composición sobre Lofi Live AI.",
		permissions: "workspace",
		benchmarkTaskId: null,
		benchmarkCategory: null,
		weights: { intelligence: 0.15, coding: 0.15, speed: 0.35, costEfficiency: 0.35, visual3d: 0 },
		estBenchTokensPerCell: 0,
		estBenchDurationSecPerCell: 0,
		notes: "Rol de orquestación local; rankeado por velocidad + costo + tool-calling.",
	},
};

function clampScore(v: number): number {
	return Math.max(0, Math.min(100, Number(v.toFixed(2))));
}

/** Harnesses known to inflate tokens cleanly discounted as tie-breaker against lean harnesses (`pi`/`gentle-shell`/`opencode`). */
const HARNESS_EFFICIENCY_TIEBREAK: Record<string, number> = {
	pi: 4,
	"gentle-shell": 3.5,
	opencode: 3,
	claude: 2.5,
	antigravity: 2.5,
	kimi: 1.5,
	qwen: 1,
	codex: 0.5,
	commandcode: 0,
	mcode: 0,
};

function resolveProfileProviderField(candidate: DiscoveredModelCandidate): {
	profileProvider?: string;
	profileModel: string;
} {
	const h = candidate.harness.toLowerCase();
	if (h === "pi" || h === "gentle-shell" || h === "qwen" || h === "claude") {
		return { profileProvider: candidate.provider, profileModel: candidate.modelId };
	}
	if (h === "opencode") {
		if (candidate.provider === "nan") {
			return { profileProvider: "nan", profileModel: candidate.modelId };
		}
		return { profileModel: candidate.profileModel };
	}
	return { profileModel: candidate.profileModel };
}

function getQuotaRemainingForCandidate(candidate: DiscoveredModelCandidate, quotas: QuotaSnapshot[]): number | null {
	const snap = quotas.find(
		(q) =>
			q.harness === candidate.harness ||
			(candidate.harness === "antigravity" && q.source === "agy"),
	);
	if (!snap) return null;
	let minPct: number | null = null;
	for (const meter of Object.values(snap.meters)) {
		for (const win of Object.values(meter.windows)) {
			if (typeof win.remainingPercent === "number") {
				minPct = minPct === null ? win.remainingPercent : Math.min(minPct, win.remainingPercent);
			}
		}
	}
	return minPct;
}

function normalizeSpeedScore(aa: AaModelMetrics | null): number {
	if (!aa) return 45;
	// Prefer measured output tokens/s; fall back to inverse task latency if unavailable.
	if (aa.outputSpeedTokPerSec !== null && aa.outputSpeedTokPerSec > 0) {
		const speedPts = Math.min(100, (aa.outputSpeedTokPerSec / 130) * 85);
		const ttftPenalty = aa.ttftSeconds !== null && aa.ttftSeconds > 15 ? Math.min(25, (aa.ttftSeconds - 15) * 0.4) : 0;
		return clampScore(speedPts + 10 - ttftPenalty);
	}
	if (aa.timePerTaskSeconds !== null && aa.timePerTaskSeconds > 0) {
		return clampScore(100 - Math.min(80, (aa.timePerTaskSeconds / 2500) * 65));
	}
	return 45;
}

function normalizeCostEfficiencyScore(
	candidate: DiscoveredModelCandidate,
	aa: AaModelMetrics | null,
	quotaRemaining: number | null,
	conservePlanQuota = false,
): { costEfficiency: number; estCostPer1MTokensUsd: number; headroomPenalty: number } {
	if (candidate.billingModel === "plan") {
		if (quotaRemaining !== null && quotaRemaining <= 0) {
			return { costEfficiency: 5, estCostPer1MTokensUsd: 0, headroomPenalty: 55 };
		}
		if (quotaRemaining !== null && quotaRemaining < 10) {
			return { costEfficiency: 45, estCostPer1MTokensUsd: 0, headroomPenalty: 18 };
		}
		if (quotaRemaining !== null && quotaRemaining < 25) {
			return { costEfficiency: 70, estCostPer1MTokensUsd: 0, headroomPenalty: 6 };
		}
		// Lightweight high-volume roles (Exploración, Voz, Música) avoid burning limited plan quota
		// on tasks an ultra-cheap Flash API handles for fractions of a cent.
		return { costEfficiency: conservePlanQuota ? 70 : 92, estCostPer1MTokensUsd: 0, headroomPenalty: 0 };
	}

	const blended =
		aa?.price1mBlendedUsd ??
		(candidate.inlinePricing
			? (((candidate.inlinePricing.inputPer1M ?? 0) * 3 + (candidate.inlinePricing.outputPer1M ?? 0)) / 4)
			: null);
	if (blended === null) {
		return { costEfficiency: 50, estCostPer1MTokensUsd: 1.5, headroomPenalty: 0 };
	}
	// Logarithmic decay tuned around real Nan/API rates ($0.15/1M ~100, $0.55/1M ~88, $2/1M ~74, $10/1M ~56).
	const score = 100 - Math.max(0, Math.log10(Math.max(0.15, blended) * 5) * 26);
	return {
		costEfficiency: clampScore(score),
		estCostPer1MTokensUsd: blended,
		headroomPenalty: 0,
	};
}

function findHistoricalMetric(
	candidate: DiscoveredModelCandidate,
	taskId: string | null,
	history: HistoricalBenchMetric[],
): HistoricalBenchMetric | undefined {
	if (!taskId) return undefined;
	return history.find(
		(h) =>
			h.taskId === taskId &&
			h.harness.toLowerCase() === candidate.harness.toLowerCase() &&
			(h.model === candidate.modelId || h.model === candidate.profileModel),
	);
}

export function groupCurrentProfilesByRole(
	profiles: Record<string, IduProfile>,
): Record<string, RoleCurrentProfileSummary[]> {
	const grouped: Record<string, RoleCurrentProfileSummary[]> = {};
	for (const [profileName, prof] of Object.entries(profiles)) {
		const role = inferProfileRole(profileName, prof);
		if (!grouped[role]) grouped[role] = [];
		grouped[role].push({
			profileName,
			rank: extractRoleRank(prof.description),
			harness: prof.harness,
			provider: prof.provider,
			model: prof.model,
			permissions: prof.permissions === "read-only" ? "read-only" : "workspace",
			description: prof.description,
		});
	}
	for (const list of Object.values(grouped)) {
		list.sort((a, b) => a.rank - b.rank || a.profileName.localeCompare(b.profileName));
	}
	return grouped;
}

function effortRankForModel(rawModelId: string, speedFirst: boolean): number {
	const lower = rawModelId.toLowerCase().replace(/:[a-z0-9-]+$/i, "");
	if (/(?:^|[-#])xhigh$/.test(lower)) return speedFirst ? 2 : 6;
	if (/(?:^|[-#])max$/.test(lower)) return speedFirst ? 3 : 5;
	if (/(?:^|[-#])high$/.test(lower)) return speedFirst ? 4 : 4;
	if (/(?:^|[-#])fast$/.test(lower)) return speedFirst ? 6 : 0;
	if (/(?:^|[-#])medium$/.test(lower)) return 2;
	if (/(?:^|[-#])low$/.test(lower)) return 1;
	return speedFirst ? 5 : 3;
}

export function scoreCandidatesForRole(params: {
	roleSpec: RoleObjectiveSpec;
	candidates: DiscoveredModelCandidate[];
	aaCatalog: AaModelMetrics[];
	quotas: QuotaSnapshot[];
	historicalMetrics: HistoricalBenchMetric[];
	preferredIncumbents?: Set<string>;
}): ScoredCandidate[] {
	const { roleSpec, candidates, aaCatalog, quotas, historicalMetrics } = params;
	const maxIq = Math.max(65, ...aaCatalog.map((m) => m.intelligenceIndex ?? 0));

	const scored: ScoredCandidate[] = [];
	for (const cand of candidates) {
		// Filter incompatible tool-less/embedding entries cleanly.
		if (/embed|tts|whisper|moderation|audio|image-gen/i.test(cand.modelId)) continue;
		if (cand.supportsToolCall === false) continue;

		const aaMatch = matchAaModel(cand.modelId, aaCatalog);
		const aa = aaMatch.matched;

		// Estimate quality 0..100 cleanly (missing IQ receives a conservative score unless backed by codingScore).
		const quality =
			aa?.intelligenceIndex !== null && aa?.intelligenceIndex !== undefined
				? clampScore((aa.intelligenceIndex / maxIq) * 100)
				: aa?.codingScore !== null && aa?.codingScore !== undefined
					? clampScore(aa.codingScore * 0.85)
					: 22;
		const coding = aa?.codingScore !== null && aa?.codingScore !== undefined ? clampScore(aa.codingScore) : quality;
		const visual3d =
			aa?.visual3dScore !== null && aa?.visual3dScore !== undefined
				? clampScore(aa.visual3dScore <= 1.2 ? aa.visual3dScore * 100 : Math.min(100, aa.visual3dScore / 15))
				: coding * 0.8;
		const speed = normalizeSpeedScore(aa);
		const quotaRemaining = getQuotaRemainingForCandidate(cand, quotas);
		const conservePlanQuota = roleSpec.role === "Exploración" || roleSpec.role === "Voz" || roleSpec.role === "Música";
		const { costEfficiency, estCostPer1MTokensUsd, headroomPenalty } = normalizeCostEfficiencyScore(
			cand,
			aa,
			quotaRemaining,
			conservePlanQuota,
		);

		const hist = findHistoricalMetric(cand, roleSpec.benchmarkTaskId, historicalMetrics);
		let historicalBonus = 0;
		if (hist) {
			historicalBonus = hist.resolvedRate >= 0.9 ? 8 : hist.resolvedRate === 0 ? -18 : -4;
		}
		// Unmatched candidates receive a slight uncertainty penalty vs verified AA models unless backed by empirical history.
		const unknownPenalty = !aa && !hist ? 8 : 0;
		const harnessBonus = HARNESS_EFFICIENCY_TIEBREAK[cand.harness.toLowerCase()] ?? 0;

		const w = roleSpec.weights;
		const weighted =
			quality * w.intelligence +
			coding * w.coding +
			speed * w.speed +
			costEfficiency * w.costEfficiency +
			visual3d * w.visual3d;

		const compositeScore = clampScore(weighted + historicalBonus + harnessBonus - headroomPenalty - unknownPenalty);
		const estCostPerBenchRunUsd =
			cand.billingModel === "plan" || roleSpec.estBenchTokensPerCell === 0
				? 0
				: Number(((roleSpec.estBenchTokensPerCell / 1_000_000) * estCostPer1MTokensUsd).toFixed(4));

		const { profileProvider, profileModel } = resolveProfileProviderField(cand);
		const parts: string[] = [];
		if (aa) {
			parts.push(`AA ${aa.name}: IQ=${aa.intelligenceIndex?.toFixed(1) ?? "n/a"}`);
			if (aa.outputSpeedTokPerSec) parts.push(`${aa.outputSpeedTokPerSec.toFixed(0)} tok/s`);
			if (cand.billingModel === "plan") parts.push(`plan ($0 marginal${quotaRemaining !== null ? `, ${quotaRemaining.toFixed(0)}% libre` : ""})`);
			else if (aa.price1mBlendedUsd !== null) parts.push(`$${aa.price1mBlendedUsd.toFixed(2)}/1M`);
		} else {
			parts.push(cand.billingModel === "plan" ? "plan sin match AA directo" : "API sin match AA directo");
		}
		if (hist) {
			parts.push(`bench previo ${(hist.resolvedRate * 100).toFixed(0)}% (${(hist.medianDurationMs / 1000).toFixed(1)}s)`);
		}

		scored.push({
			harness: cand.harness,
			provider: cand.provider,
			modelId: cand.modelId,
			profileModel,
			profileProvider,
			displayName: cand.displayName,
			billingModel: cand.billingModel,
			compositeScore,
			breakdown: {
				quality,
				coding,
				speed,
				costEfficiency,
				visual3d,
				historicalBonus,
				planHeadroomPenalty: headroomPenalty,
			},
			aaMatch,
			estCostPerBenchRunUsd,
			quotaRemainingPercent: quotaRemaining,
			historical: hist,
			rationale: parts.join(" · "),
		});
	}

	const speedFirst = roleSpec.role === "Exploración" || roleSpec.role === "Voz" || roleSpec.role === "Música";
	const preferredSet = params.preferredIncumbents ?? new Set<string>();
	scored.sort((a, b) => {
		const scoreDiff = b.compositeScore - a.compositeScore;
		if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
		const effDiff = effortRankForModel(b.modelId, speedFirst) - effortRankForModel(a.modelId, speedFirst);
		if (effDiff !== 0) return effDiff;
		const bPref = preferredSet.has(`${b.harness}::${b.profileModel}`) || preferredSet.has(`${b.harness}::${b.modelId}`) ? 1 : 0;
		const aPref = preferredSet.has(`${a.harness}::${a.profileModel}`) || preferredSet.has(`${a.harness}::${a.modelId}`) ? 1 : 0;
		return bPref - aPref;
	});
	// Collapse effort/alias duplicates resolving to the same model on the same harness.
	const collapsed: ScoredCandidate[] = [];
	const seenNormalized = new Set<string>();
	for (const item of scored) {
		const modelKey = item.aaMatch.matched?.id ?? normalizeModelKeyForAa(item.modelId);
		const normKey = `${item.harness}::${modelKey}`;
		if (seenNormalized.has(normKey)) continue;
		seenNormalized.add(normKey);
		collapsed.push(item);
	}
	return collapsed;
}

const ROLE_FILTER_ALIASES: Record<string, string[]> = {
	trabajo: ["work", "coding", "refactor"],
	auditoria: ["audit"],
	consultas: ["consult"],
	arquitectura: ["arch", "architecture"],
	exploracion: ["explore"],
	diseno: ["design"],
	iconografia: ["icon", "iconographer"],
	voz: ["voice"],
	musica: ["music"],
};

function stripDiacriticsLower(value: string): string {
	return value
		.trim()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

export function matchesRoleFilter(roleName: string, filters: string[]): boolean {
	if (filters.length === 0) return true;
	const normRole = stripDiacriticsLower(roleName);
	const aliases = ROLE_FILTER_ALIASES[normRole] ?? [];
	return filters.some((raw) => {
		const token = stripDiacriticsLower(raw);
		if (!token) return false;
		return token === normRole || aliases.includes(token);
	});
}

export function buildRoleProposals(params: {
	profiles: Record<string, IduProfile>;
	candidates: DiscoveredModelCandidate[];
	aaCatalog: AaModelMetrics[];
	quotas: QuotaSnapshot[];
	historicalMetrics: HistoricalBenchMetric[];
	selectedRoles?: string[];
	topN?: number;
	shortlistPerRole?: number;
	includeHeavyBench?: boolean;
}): RoleProposalSummary[] {
	const grouped = groupCurrentProfilesByRole(params.profiles);
	const topN = Math.max(1, params.topN ?? 5);
	const shortlistSize = Math.max(1, params.shortlistPerRole ?? 3);

	const roleNames = Object.keys(ROLE_OBJECTIVES).filter((r) => {
		const hasProfiles = (grouped[r]?.length ?? 0) > 0;
		if (params.selectedRoles && params.selectedRoles.length > 0) {
			return matchesRoleFilter(r, params.selectedRoles);
		}
		return hasProfiles || r === "Trabajo" || r === "Auditoría" || r === "Consultas" || r === "Exploración";
	});

	const summaries: RoleProposalSummary[] = [];
	for (const role of roleNames) {
		const roleSpec = ROLE_OBJECTIVES[role];
		const currentProfiles = grouped[role] ?? [];
		const preferredIncumbents = new Set(currentProfiles.map((p) => `${p.harness}::${p.model ?? ""}`));
		const scored = scoreCandidatesForRole({
			roleSpec,
			candidates: params.candidates,
			aaCatalog: params.aaCatalog,
			quotas: params.quotas,
			historicalMetrics: params.historicalMetrics,
			preferredIncumbents,
		});

		// Pick diverse shortlist across distinct (harness, modelId), ensuring incumbent coverage first.
		const shortlist: MiniBenchCellPlan[] = [];
		const canBenchTask =
			Boolean(roleSpec.benchmarkTaskId) &&
			(roleSpec.benchmarkTaskId !== "design-01-3d-benchmark-explainer" || params.includeHeavyBench === true);

		if (canBenchTask && roleSpec.benchmarkTaskId) {
			const pickedKeys = new Set<string>();
			const targetProfileNames = currentProfiles.map((p) => p.profileName);

			// 1. Seed the highest-priority available incumbent so new challengers compare against a live baseline.
			for (const prof of currentProfiles) {
				const incumbentMatch = scored.find(
					(c) =>
						c.harness === prof.harness &&
						(c.profileModel === prof.model || c.modelId === prof.model) &&
						(c.quotaRemainingPercent === null || c.quotaRemainingPercent > 0),
				);
				if (incumbentMatch) {
					pickedKeys.add(`${incumbentMatch.harness}::${incumbentMatch.modelId}`);
					shortlist.push({
						role,
						harness: incumbentMatch.harness,
						provider: incumbentMatch.provider,
						modelId: incumbentMatch.modelId,
						profileModel: incumbentMatch.profileModel,
						profileProvider: incumbentMatch.profileProvider,
						billingModel: incumbentMatch.billingModel,
						taskId: roleSpec.benchmarkTaskId,
						permissionMode: roleSpec.permissions,
						targetProfiles: targetProfileNames,
						estCostUsd: incumbentMatch.estCostPerBenchRunUsd,
						estDurationSec: roleSpec.estBenchDurationSecPerCell,
						aaScore: incumbentMatch.compositeScore,
						reason: `Titular actual (${prof.profileName}) como línea base`,
					});
					break;
				}
			}

			// 2. Add top-scoring diverse challengers across distinct harnesses AND distinct base models.
			const seenHarnessModel = new Set<string>(
				shortlist.map((s) => `${s.harness}::${matchAaModel(s.modelId, params.aaCatalog).matched?.id ?? normalizeModelKeyForAa(s.modelId)}`),
			);
			const modelFamilyCounts = new Map<string, number>();
			for (const s of shortlist) {
				const fk = matchAaModel(s.modelId, params.aaCatalog).matched?.id ?? normalizeModelKeyForAa(s.modelId);
				modelFamilyCounts.set(fk, (modelFamilyCounts.get(fk) ?? 0) + 1);
			}
			for (const cand of scored) {
				if (shortlist.length >= shortlistSize) break;
				if (cand.billingModel === "plan" && cand.quotaRemainingPercent !== null && cand.quotaRemainingPercent <= 0) {
					continue;
				}
				const fk = cand.aaMatch.matched?.id ?? normalizeModelKeyForAa(cand.modelId);
				const k = `${cand.harness}::${fk}`;
				if (seenHarnessModel.has(k)) continue;
				if ((modelFamilyCounts.get(fk) ?? 0) >= 2 && scored.some((alt) => (modelFamilyCounts.get(alt.aaMatch.matched?.id ?? normalizeModelKeyForAa(alt.modelId)) ?? 0) === 0)) {
					continue;
				}
				seenHarnessModel.add(k);
				modelFamilyCounts.set(fk, (modelFamilyCounts.get(fk) ?? 0) + 1);
				shortlist.push({
					role,
					harness: cand.harness,
					provider: cand.provider,
					modelId: cand.modelId,
					profileModel: cand.profileModel,
					profileProvider: cand.profileProvider,
					billingModel: cand.billingModel,
					taskId: roleSpec.benchmarkTaskId,
					permissionMode: roleSpec.permissions,
					targetProfiles: targetProfileNames,
					estCostUsd: cand.estCostPerBenchRunUsd,
					estDurationSec: roleSpec.estBenchDurationSecPerCell,
					aaScore: cand.compositeScore,
					reason: `Top candidato AA/plan para ${role} (${cand.rationale})`,
				});
			}
		}

		const notes: string[] = [];
		if (roleSpec.notes) notes.push(roleSpec.notes);
		if (role === "Trabajo") {
			notes.push("Regla del fleet: preferir modelos rápidos y estables en edición multi-archivo; revisar costo antes de subir modelos flagship.");
		}

		summaries.push({
			role,
			concept: roleSpec.concept,
			permissions: roleSpec.permissions,
			benchmarkTaskId: roleSpec.benchmarkTaskId,
			currentProfiles,
			topCandidates: scored.slice(0, topN),
			shortlist,
			notes,
		});
	}

	return summaries;
}
