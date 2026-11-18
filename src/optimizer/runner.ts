import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildHarnessInvocation, collectGitChangedFiles, prepareTaskSandbox, resolveNanApiKey, snapshotUserIduFiles, spawnIsolatedWorker } from "../../bench/isolation.js";
import { BENCHMARK_TASKS } from "../../bench/tasks/registry.js";
import { assessAutonomy } from "../../bench/stats.js";
import type { BenchmarkTaskDef } from "../../bench/types.js";
import { buildWorkerArgs, checkCliAvailable, unwrapCmdExecutable } from "../cmdline.js";
import { resolveHarnessEffortArg } from "../effort.js";
import { getIduHome, loadIduConfig } from "../config.js";
import {
	buildDynamicProfileDescription,
	formatProfileFieldsForHarness,
	listCompatibleHarnessesForModel,
	normalizeRoleLabel,
	parseModelSpec,
	resolveEffectiveFleet,
} from "../fleets.js";
import { writeJsonAtomic } from "../json-file.js";
import { buildWorkerSpawnEnv } from "../runner.js";
import { canonicalHarnessName } from "../session-policy.js";
import { extractCleanSummary } from "../summary.js";
import type { IduConfig, IduProfile, ProfilesConfig, ReasoningEffort } from "../types.js";
import { extractUsage } from "../usage.js";
import { fetchArtificialAnalysisCatalog, matchAaModel, type AaCatalogResult } from "./artificial-analysis.js";
import { discoverFleetCapabilities, type DiscoveryResult } from "./discovery.js";
import { buildRoleProposals, HARNESS_EFFICIENCY_TIEBREAK, matchesRoleFilter, ROLE_OBJECTIVES } from "./roles.js";
import type {
	AaModelMetrics,
	MiniBenchCellOutcome,
	MiniBenchCellPlan,
	ModelTerminalTestCell,
	ModelTerminalTestReport,
	OptimizeApplyOutcome,
	OptimizeProposal,
	OptimizeRunResult,
	ProfileChangeRecommendation,
	RoleProposalSummary,
} from "./types.js";

export interface ProposeOptions {
	fleet?: string;
	workingDir?: string;
	roles?: string[];
	topN?: number;
	shortlistPerRole?: number;
	freshAa?: boolean;
	freshQuota?: boolean;
	includeHeavyBench?: boolean;
	skipLiveEndpoints?: boolean;
	aaApiKey?: string;
	optimizeDir?: string;
	aaFetcher?: () => Promise<AaCatalogResult>;
	discoverer?: () => Promise<DiscoveryResult>;
}

export interface RunBenchOptions extends ProposeOptions {
	concurrency?: number;
	proposal?: OptimizeProposal;
	cellRunner?: (cell: MiniBenchCellPlan, task: BenchmarkTaskDef) => Promise<MiniBenchCellOutcome>;
	onProgress?: (line: string) => void;
}

export interface ApplyOptions {
	fleet?: string;
	onlyProfiles?: string[];
	runResult?: OptimizeRunResult;
	optimizeDir?: string;
	profilesPath?: string;
}

const DEFAULT_OPTIMIZE_SUBDIR = "optimize";

function getOptimizeDir(explicit?: string): string {
	return explicit ?? join(getIduHome(), DEFAULT_OPTIMIZE_SUBDIR);
}

function dedupeShortlistCells(roles: RoleProposalSummary[]): MiniBenchCellPlan[] {
	const merged = new Map<string, MiniBenchCellPlan>();
	for (const roleSummary of roles) {
		for (const cell of roleSummary.shortlist) {
			const key = `${cell.harness}::${cell.modelId}::${cell.taskId}`;
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, { ...cell, targetProfiles: [...cell.targetProfiles] });
			} else {
				const mergedTargets = [...new Set([...existing.targetProfiles, ...cell.targetProfiles])];
				existing.targetProfiles = mergedTargets;
				if (cell.aaScore > existing.aaScore) {
					existing.aaScore = cell.aaScore;
				}
				if (!existing.role.includes(cell.role)) {
					existing.role = `${existing.role}, ${cell.role}`;
				}
			}
		}
	}
	return [...merged.values()];
}

export async function proposeOptimization(options: ProposeOptions = {}): Promise<OptimizeProposal> {
	const aa = options.aaFetcher
		? await options.aaFetcher()
		: await fetchArtificialAnalysisCatalog({
				fresh: options.freshAa,
				apiKey: options.aaApiKey,
			});

	const discovery = options.discoverer
		? await options.discoverer()
		: await discoverFleetCapabilities({
				freshQuota: options.freshQuota,
				skipLiveEndpoints: options.skipLiveEndpoints,
			});

	const effectiveFleet = resolveEffectiveFleet({
		fleet: options.fleet,
		workingDir: options.workingDir,
	});
	const { profiles } = effectiveFleet.config;
	const roles = buildRoleProposals({
		profiles,
		candidates: discovery.candidates,
		aaCatalog: aa.models,
		quotas: discovery.quotas,
		historicalMetrics: discovery.historicalMetrics,
		selectedRoles: options.roles,
		topN: options.topN,
		shortlistPerRole: options.shortlistPerRole,
		includeHeavyBench: options.includeHeavyBench,
	});

	const shortlist = dedupeShortlistCells(roles);
	const estimatedTotalCostUsd = Number(
		shortlist.reduce((sum, item) => sum + item.estCostUsd, 0).toFixed(4),
	);
	const estimatedDurationSec = shortlist.reduce((sum, item) => sum + item.estDurationSec, 0);
	const estimatedPlanCalls = shortlist.filter((c) => c.billingModel === "plan").length;

	const warnings = [...discovery.warnings];
	if (aa.warning) warnings.push(aa.warning);

	const proposal: OptimizeProposal = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		iduHome: getIduHome(),
		aaSource: aa.source,
		aaFetchedAt: aa.fetchedAt,
		aaModelCount: aa.models.length,
		clis: discovery.clis,
		providers: discovery.providers,
		quotas: discovery.quotas,
		discoveredModelCount: discovery.candidates.length,
		roles,
		shortlist,
		estimatedTotalCostUsd,
		estimatedDurationSec,
		estimatedPlanCalls,
		warnings,
	};

	const optDir = getOptimizeDir(options.optimizeDir);
	mkdirSync(optDir, { recursive: true });
	writeJsonAtomic(join(optDir, "latest-proposal.json"), proposal);

	return proposal;
}

const NAN_CONTROLLED_HARNESSES = new Set([
	"opencode",
	"pi",
	"gentle-shell",
	"commandcode",
	"mcode",
	"qwen",
	"codex",
	"kimi",
]);

function estimateCellCostFromAa(
	cell: MiniBenchCellPlan,
	tokens: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null },
	aaCatalog: AaModelMetrics[],
	reportedCostUsd: number | null,
): number | null {
	if (cell.billingModel === "plan") return 0;
	if (reportedCostUsd !== null) return reportedCostUsd;
	const match = matchAaModel(cell.modelId, aaCatalog).matched;
	if (!match || (match.price1mInputUsd === null && match.price1mOutputUsd === null)) return null;
	if (tokens.inputTokens === null || tokens.outputTokens === null) return null;
	const cached = Math.max(0, Math.min(tokens.cacheReadTokens ?? 0, tokens.inputTokens));
	const uncachedIn = Math.max(0, tokens.inputTokens - cached);
	const inPrice = match.price1mInputUsd ?? match.price1mOutputUsd ?? 0;
	const outPrice = match.price1mOutputUsd ?? match.price1mInputUsd ?? 0;
	const cachedPrice = match.price1mInputUsd !== null ? Math.min(inPrice, inPrice * 0.25) : inPrice;
	const usd = (uncachedIn * inPrice + cached * cachedPrice + tokens.outputTokens * outPrice) / 1_000_000;
	return Number(usd.toFixed(6));
}

function scoreMeasuredCell(outcome: Omit<MiniBenchCellOutcome, "compositeBenchScore">, roleName: string): number {
	if (!outcome.supported || !outcome.resolved) {
		const ratio = outcome.failToPassTotal > 0 ? outcome.failToPassPassed / outcome.failToPassTotal : 0;
		return Number((ratio * 35 + (outcome.regressionsClean ? 10 : 0)).toFixed(2));
	}
	const primaryRole = roleName.split(",")[0].trim();
	const w = ROLE_OBJECTIVES[primaryRole]?.weights ?? {
		intelligence: 0.35,
		coding: 0.25,
		speed: 0.25,
		costEfficiency: 0.15,
		visual3d: 0,
	};
	const latencyPts = Math.max(10, Math.min(100, 100 - ((outcome.durationMs / 1000 - 15) / 150) * 65));
	const costPts =
		outcome.billingModel === "plan" || outcome.costUsd === 0
			? 95
			: outcome.costUsd !== null
				? Math.max(10, Math.min(100, 100 - Math.log10(Math.max(0.0005, outcome.costUsd) * 1000) * 35))
				: 65;
	const qualityPts = outcome.autonomous ? 100 : 85;
	const qualityShare = w.intelligence + w.coding + w.visual3d;
	const score = qualityPts * qualityShare + latencyPts * w.speed + costPts * w.costEfficiency;
	return Number(Math.max(0, Math.min(100, score)).toFixed(2));
}

async function runSingleShortlistCell(
	cell: MiniBenchCellPlan,
	task: BenchmarkTaskDef,
	iduConfig: IduConfig,
	nanKey: string | null,
	aaCatalog: AaModelMetrics[],
): Promise<MiniBenchCellOutcome> {
	const runId = `opt_${cell.harness}_${cell.modelId}_${task.id}`;
	const sentinel = `IDU_OPT_SENTINEL_${runId}_${Math.random().toString(36).slice(2, 7)}`;
	const sb = prepareTaskSandbox(task, sentinel);

	try {
		const useControlledNan = cell.provider === "nan" && nanKey !== null && NAN_CONTROLLED_HARNESSES.has(cell.harness.toLowerCase());
		let command = "";
		let args: string[] = [];
		let env: NodeJS.ProcessEnv = {};

		if (useControlledNan) {
			const inv = buildHarnessInvocation({
				harness: cell.harness,
				model: {
					id: cell.modelId,
					displayName: cell.modelId,
					providerModelId: cell.modelId,
					pricePer1M: null,
				},
				prompt: task.prompt,
				isolationRoot: sb.isolationRoot,
				track: "controlled",
				apiKey: nanKey!,
				permissionMode: task.permissionMode ?? "workspace",
				...(cell.effort ? { effort: cell.effort } : {}),
			});
			if (!inv.supported) {
				return {
					role: cell.role,
					harness: cell.harness,
					provider: cell.provider,
					modelId: cell.modelId,
					profileModel: cell.profileModel,
					profileProvider: cell.profileProvider,
					billingModel: cell.billingModel,
					taskId: task.id,
					supported: false,
					unsupportedReason: inv.unsupportedReason,
					resolved: false,
					regressionsClean: true,
					autonomous: false,
					failToPassPassed: 0,
					failToPassTotal: 1,
					durationMs: 0,
					totalTokens: null,
					costUsd: null,
					compositeBenchScore: 0,
					summaryPreview: "",
				};
			}
			command = inv.command;
			args = inv.args;
			env = inv.env;
		} else {
			const hostProfile: IduProfile = {
				harness: cell.harness,
				provider: cell.profileProvider,
				model: cell.profileModel,
				...(cell.effort ? { effort: cell.effort } : {}),
				permissions: task.permissionMode ?? "workspace",
			};
			const built = buildWorkerArgs(hostProfile, task.prompt, [], iduConfig);
			const unwrapped = unwrapCmdExecutable(built.command, built.args);
			command = unwrapped.command;
			args = unwrapped.args;
			env = buildWorkerSpawnEnv(
				{
					harness: cell.harness,
					args,
					env: {
						IDU_WORKER: "true",
						IDU_ALLOW_DELEGATION: "false",
						IDU_RUN_ID: runId,
					},
				},
				process.env,
			);
		}

		const outcome = await spawnIsolatedWorker({
			command,
			args,
			cwd: sb.sandboxDir,
			env,
			timeoutMs: task.timeoutMs,
		});

		const changedFiles = collectGitChangedFiles(sb.sandboxDir, sb.initialCommitSha);
		const usage = extractUsage(outcome.stdout, cell.harness);
		const summary = extractCleanSummary(outcome.stdout, cell.harness);
		const evalRes = await task.evaluate(sb.sandboxDir, {
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
		const costUsd = estimateCellCostFromAa(cell, usage.tokens, aaCatalog, usage.reportedCostUsd);

		const partial: Omit<MiniBenchCellOutcome, "compositeBenchScore"> = {
			role: cell.role,
			harness: cell.harness,
			provider: cell.provider,
			modelId: cell.modelId,
			profileModel: cell.profileModel,
			profileProvider: cell.profileProvider,
			billingModel: cell.billingModel,
			taskId: task.id,
			supported: true,
			resolved: evalRes.resolved,
			regressionsClean: evalRes.regressionsClean,
			autonomous: autonomy.autonomous,
			failToPassPassed: evalRes.failToPassPassed,
			failToPassTotal: evalRes.failToPassTotal,
			durationMs: outcome.durationMs,
			totalTokens: usage.tokens.totalTokens,
			costUsd,
			summaryPreview: summary.slice(0, 180),
			error: outcome.spawnError,
		};

		return {
			...partial,
			compositeBenchScore: scoreMeasuredCell(partial, cell.role),
		};
	} finally {
		sb.cleanup();
	}
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
		while (cursor < items.length) {
			const idx = cursor++;
			await fn(items[idx]);
		}
	});
	await Promise.all(workers);
}

function normalizeProfilePairKey(harness: string, model: string | undefined): string {
	const raw = (model ?? "").trim().toLowerCase();
	const tail = raw.replace(/^custom_provider:/, "");
	return `${harness.trim().toLowerCase()}::${tail}`;
}

function isTransientQuotaFailure(outcome: MiniBenchCellOutcome | undefined): boolean {
	if (!outcome || outcome.resolved) return false;
	const tokensZero = outcome.totalTokens === null || outcome.totalTokens === 0;
	if (!tokensZero) return false;
	return /hit your .*limit|weekly limit|rate.?limit|resets \d|too many requests|\b429\b/i.test(
		outcome.summaryPreview || outcome.error || "",
	);
}

function buildRecommendations(
	proposal: OptimizeProposal,
	outcomes: MiniBenchCellOutcome[],
	selectedRoles?: string[],
): ProfileChangeRecommendation[] {
	const recommendations: ProfileChangeRecommendation[] = [];
	const targetRoles =
		selectedRoles && selectedRoles.length > 0
			? proposal.roles.filter((r) => matchesRoleFilter(r.role, selectedRoles))
			: proposal.roles;

	for (const roleSummary of targetRoles) {
		const roleTaskId = roleSummary.benchmarkTaskId;
		const roleOutcomes = outcomes.filter(
			(o) =>
				o.taskId === roleTaskId &&
				o.role.split(",").map((s) => s.trim()).includes(roleSummary.role),
		);
		const passing = roleOutcomes
			.filter((o) => o.supported && o.resolved && o.regressionsClean && o.autonomous)
			.sort((a, b) => b.compositeBenchScore - a.compositeBenchScore);

		const topAa = roleSummary.topCandidates[0];
		const winner = passing[0];
		const activePairsInRole = new Set(
			roleSummary.currentProfiles.map((p) => normalizeProfilePairKey(p.harness, p.model)),
		);

		for (const cur of roleSummary.currentProfiles) {
			if (!roleTaskId || roleOutcomes.length === 0) {
				if (topAa && (topAa.harness !== cur.harness || topAa.profileModel !== cur.model)) {
					recommendations.push({
						profileName: cur.profileName,
						role: roleSummary.role,
						action: "manual-review",
						current: { harness: cur.harness, provider: cur.provider, model: cur.model },
						recommended: {
							harness: topAa.harness,
							provider: topAa.profileProvider,
							model: topAa.profileModel,
							description: cur.description || `${roleSummary.role} (${topAa.harness} · ${topAa.profileModel})`,
						},
						reason: `Sin mini-bench automático para ${roleSummary.role}; AA sugiere ${topAa.harness} · ${topAa.profileModel} (${topAa.rationale}).`,
						applyAllowed: false,
					});
				} else {
					recommendations.push({
						profileName: cur.profileName,
						role: roleSummary.role,
						action: "keep",
						current: { harness: cur.harness, provider: cur.provider, model: cur.model },
						recommended: {
							harness: cur.harness,
							provider: cur.provider,
							model: cur.model || "",
							description: cur.description || "",
						},
						reason: "Mantiene configuración actual (sin mini-bench requerido).",
						applyAllowed: false,
					});
				}
				continue;
			}

			if (!winner) {
				recommendations.push({
					profileName: cur.profileName,
					role: roleSummary.role,
					action: "keep",
					current: { harness: cur.harness, provider: cur.provider, model: cur.model },
					recommended: {
						harness: cur.harness,
						provider: cur.provider,
						model: cur.model || "",
						description: cur.description || "",
					},
					reason: "Ningún candidato del shortlist superó el mini-bench limpiamente; se mantiene la configuración actual.",
					applyAllowed: false,
				});
				continue;
			}

			const incumbentOutcome = roleOutcomes.find(
				(o) => o.harness === cur.harness && (o.profileModel === cur.model || o.modelId === cur.model),
			);
			const transientQuota = isTransientQuotaFailure(incumbentOutcome);

			// Only swap #1 profile directly when challenger clearly outperforms incumbent (> +5 pts or incumbent failed),
			// while keeping secondary parallel fleet diversity untouched unless it failed cleanly for a non-quota reason.
			// Never overwrite an active profile with a transient subscription limit, and never clone a sibling's pair.
			const matchesWinner =
				winner.harness === cur.harness &&
				(winner.profileModel === cur.model || winner.modelId === cur.model);
			const incumbentHealthy = Boolean(
				incumbentOutcome?.supported && incumbentOutcome.resolved && incumbentOutcome.regressionsClean,
			);
			const needsReplacement =
				!transientQuota &&
				((cur.rank === 1 &&
					!matchesWinner &&
					(!incumbentHealthy || winner.compositeBenchScore >= (incumbentOutcome?.compositeBenchScore ?? 0) + 5)) ||
					(Boolean(incumbentOutcome) && !incumbentHealthy && !matchesWinner));

			const curPairKey = normalizeProfilePairKey(cur.harness, cur.model);
			const replacement = needsReplacement
				? passing.find((cand) => {
						const candKey = normalizeProfilePairKey(cand.harness, cand.profileModel);
						if (candKey === curPairKey) return false;
						return !activePairsInRole.has(candKey);
					})
				: undefined;
			const validReplacement =
				replacement &&
				(!incumbentHealthy || replacement.compositeBenchScore >= (incumbentOutcome?.compositeBenchScore ?? 0) + 5)
					? replacement
					: undefined;

			if (validReplacement) {
				activePairsInRole.delete(curPairKey);
				activePairsInRole.add(normalizeProfilePairKey(validReplacement.harness, validReplacement.profileModel));
				const sec = (validReplacement.durationMs / 1000).toFixed(1);
				const tokLabel = validReplacement.totalTokens !== null ? `${Math.round(validReplacement.totalTokens / 1000)}k tok` : "tok n/a";
				recommendations.push({
					profileName: cur.profileName,
					role: roleSummary.role,
					action: "update",
					current: { harness: cur.harness, provider: cur.provider, model: cur.model },
					recommended: {
						harness: validReplacement.harness,
						...(validReplacement.profileProvider ? { provider: validReplacement.profileProvider } : {}),
						model: validReplacement.profileModel,
						description: buildDynamicProfileDescription({
							slotName: cur.profileName,
							role: roleSummary.role,
							rank: cur.rank,
							existingDescription: cur.description,
							harness: validReplacement.harness,
							provider: validReplacement.profileProvider,
							model: validReplacement.profileModel,
							benchmark: {
								taskId: validReplacement.taskId,
								resolved: validReplacement.resolved,
								regressionsClean: validReplacement.regressionsClean,
								durationMs: validReplacement.durationMs,
								totalTokens: validReplacement.totalTokens,
								score: validReplacement.compositeBenchScore,
								recommended: true,
							},
						}),
					},
					reason: `${validReplacement.harness} · ${validReplacement.modelId} obtuvo ${validReplacement.compositeBenchScore} pts (${sec}s, ${tokLabel}) en ${validReplacement.taskId}${incumbentOutcome ? ` vs ${incumbentOutcome.compositeBenchScore} pts actual` : ""}.`,
					applyAllowed: true,
				});
			} else {
				const reason = transientQuota
					? `Límite temporal de suscripción (${incumbentOutcome!.summaryPreview.slice(0, 70)}); se conserva titular sin duplicar.`
					: needsReplacement
						? `El ganador (${winner.harness} · ${winner.modelId}) ya está asignado a otro perfil del rol; se conserva diversidad.`
						: matchesWinner
							? `Ya usa el ganador del mini-bench (${winner.harness} · ${winner.modelId}, ${winner.compositeBenchScore} pts).`
							: incumbentHealthy
								? `Titular estable (${incumbentOutcome!.compositeBenchScore} pts en ${winner.taskId}); conserva diversidad paralela en el rol.`
								: "Mantiene configuración actual.";
				recommendations.push({
					profileName: cur.profileName,
					role: roleSummary.role,
					action: "keep",
					current: { harness: cur.harness, provider: cur.provider, model: cur.model },
					recommended: {
						harness: cur.harness,
						provider: cur.provider,
						model: cur.model || "",
						description: cur.description || "",
					},
					reason,
					applyAllowed: false,
				});
			}
		}
	}

	return recommendations;
}

export async function runOptimizationBench(options: RunBenchOptions = {}): Promise<OptimizeRunResult> {
	const optDir = getOptimizeDir(options.optimizeDir);
	const proposalPath = join(optDir, "latest-proposal.json");

	let proposal: OptimizeProposal | undefined = options.proposal;
	if (!proposal && !options.freshAa && !options.freshQuota && existsSync(proposalPath)) {
		try {
			const cachedProposal = JSON.parse(readFileSync(proposalPath, "utf8")) as OptimizeProposal;
			const coversRequested =
				!options.roles?.length ||
				options.roles.every((filter) => cachedProposal.roles.some((r) => matchesRoleFilter(r.role, [filter])));
			if (coversRequested) {
				proposal = cachedProposal;
			}
		} catch {
			// Fall back to fresh proposal generation below.
		}
	}
	if (!proposal) {
		proposal = await proposeOptimization(options);
	}

	const aa = options.aaFetcher
		? await options.aaFetcher()
		: await fetchArtificialAnalysisCatalog({ apiKey: options.aaApiKey });
	const iduConfig = loadIduConfig();
	const nanKey = resolveNanApiKey();
	const beforeIdu = snapshotUserIduFiles();

	const filteredShortlist = options.roles?.length
		? proposal.shortlist.filter((c) =>
				c.role.split(",").some((r) => matchesRoleFilter(r.trim(), options.roles!)),
			)
		: proposal.shortlist;

	const outcomes: MiniBenchCellOutcome[] = [];
	const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 3));
	let finishedCount = 0;

	await runPool(filteredShortlist, concurrency, async (cell) => {
		const task = BENCHMARK_TASKS.find((t) => t.id === cell.taskId);
		if (!task) {
			outcomes.push({
				role: cell.role,
				harness: cell.harness,
				provider: cell.provider,
				modelId: cell.modelId,
				profileModel: cell.profileModel,
				profileProvider: cell.profileProvider,
				billingModel: cell.billingModel,
				taskId: cell.taskId,
				supported: false,
				unsupportedReason: `Task not found: ${cell.taskId}`,
				resolved: false,
				regressionsClean: true,
				autonomous: false,
				failToPassPassed: 0,
				failToPassTotal: 1,
				durationMs: 0,
				totalTokens: null,
				costUsd: null,
				compositeBenchScore: 0,
				summaryPreview: "",
			});
			return;
		}
		const result = options.cellRunner
			? await options.cellRunner(cell, task)
			: await runSingleShortlistCell(cell, task, iduConfig, nanKey, aa.models);
		outcomes.push(result);
		finishedCount++;
		const sec = (result.durationMs / 1000).toFixed(1);
		options.onProgress?.(
			`[${finishedCount}/${filteredShortlist.length}] ${result.role} · ${result.harness}/${result.profileModel} -> resolved=${result.resolved} regClean=${result.regressionsClean} ${sec}s`,
		);
	});

	const afterIdu = snapshotUserIduFiles();
	const userConfigUntouched =
		beforeIdu.profilesSha256 === afterIdu.profilesSha256 &&
		beforeIdu.configSha256 === afterIdu.configSha256;

	const recommendations = buildRecommendations(proposal, outcomes, options.roles);
	const warnings = [...proposal.warnings];
	if (!userConfigUntouched) {
		warnings.push("User ~/.idu config changed during mini-benchmark execution.");
	}

	const runResult: OptimizeRunResult = {
		schemaVersion: 1,
		runId: `opt-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
		executedAt: new Date().toISOString(),
		proposalGeneratedAt: proposal.generatedAt,
		userConfigUntouched,
		outcomes,
		recommendations,
		warnings,
	};

	mkdirSync(optDir, { recursive: true });
	writeJsonAtomic(join(optDir, "latest-run.json"), runResult);
	return runResult;
}

export function applyOptimization(options: ApplyOptions = {}): OptimizeApplyOutcome {
	const optDir = getOptimizeDir(options.optimizeDir);
	const runPath = join(optDir, "latest-run.json");
	const runResult: OptimizeRunResult =
		options.runResult ??
		(() => {
			if (!existsSync(runPath)) {
				throw new Error(`No optimization run found at ${runPath}. Run "idu-pi optimize --run-bench" first.`);
			}
			return JSON.parse(readFileSync(runPath, "utf8")) as OptimizeRunResult;
		})();

	const resolvedFleet = resolveEffectiveFleet({ fleet: options.fleet });
	const profilesPath = options.profilesPath ?? resolvedFleet.filePath;
	const currentCfg: ProfilesConfig = existsSync(profilesPath)
		? (JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesConfig)
		: { ...resolvedFleet.config, profiles: { ...resolvedFleet.config.profiles } };

	const updatedProfiles: OptimizeApplyOutcome["updatedProfiles"] = [];
	const skippedProfiles: OptimizeApplyOutcome["skippedProfiles"] = [];

	const onlySet = options.onlyProfiles?.length ? new Set(options.onlyProfiles) : null;
	const candidatesToApply = runResult.recommendations.filter((rec) => {
		if (onlySet && !onlySet.has(rec.profileName)) return false;
		return rec.action === "update" && rec.applyAllowed;
	});

	let backupPath: string | null = null;
	if (candidatesToApply.length > 0 && existsSync(profilesPath)) {
		backupPath = `${profilesPath}.bak-${Date.now()}`;
		copyFileSync(profilesPath, backupPath);
	}

	for (const rec of runResult.recommendations) {
		if (onlySet && !onlySet.has(rec.profileName)) continue;
		const existing = currentCfg.profiles[rec.profileName];
		if (!existing) {
			skippedProfiles.push({ profileName: rec.profileName, reason: "Profile not found in profiles.json" });
			continue;
		}
		if (rec.action !== "update" || !rec.applyAllowed) {
			skippedProfiles.push({ profileName: rec.profileName, reason: rec.reason });
			continue;
		}
		const before = { harness: existing.harness, provider: existing.provider, model: existing.model };
		const nextProfile: IduProfile = {
			...existing,
			harness: rec.recommended.harness,
			model: rec.recommended.model,
			description: rec.recommended.description,
		};
		if (rec.recommended.provider) nextProfile.provider = rec.recommended.provider;
		else delete nextProfile.provider;

		currentCfg.profiles[rec.profileName] = nextProfile;
		updatedProfiles.push({
			profileName: rec.profileName,
			before,
			after: { harness: nextProfile.harness, provider: nextProfile.provider, model: nextProfile.model },
		});
	}

	if (updatedProfiles.length > 0) {
		writeJsonAtomic(profilesPath, currentCfg);
	}

	return {
		appliedAt: new Date().toISOString(),
		profilesPath,
		backupPath,
		updatedProfiles,
		skippedProfiles,
	};
}

export interface TestModelAcrossTerminalsOptions {
	role: string;
	modelInput: string;
	effort?: ReasoningEffort;
	permissions?: "read-only" | "workspace";
	harnesses?: string[];
	includeHeavyBench?: boolean;
	concurrency?: number;
	aaApiKey?: string;
	aaFetcher?: () => Promise<AaCatalogResult>;
	installedClisOverride?: Array<{ name: string; available: boolean }>;
	cellRunner?: (cell: MiniBenchCellPlan, task: BenchmarkTaskDef) => Promise<MiniBenchCellOutcome>;
	onProgress?: (line: string) => void;
}

/**
 * Benchmarks ONE user-chosen model (e.g. `nan/kimi-k3.1-pro`) across all compatible
 * installed terminals in isolated sandboxes, returning ranked results and a
 * recommended terminal so the user can accept it or choose one manually.
 */
export async function testModelAcrossTerminals(
	options: TestModelAcrossTerminalsOptions,
): Promise<ModelTerminalTestReport> {
	const canonicalRole = normalizeRoleLabel(options.role);
	const roleSpec = ROLE_OBJECTIVES[canonicalRole];
	const parsedModel = parseModelSpec(options.modelInput);
	const requestedEffort = options.effort ?? parsedModel.effortSuffix;
	const permissions = options.permissions ?? roleSpec?.permissions ?? "workspace";

	let taskId = roleSpec?.benchmarkTaskId ?? null;
	let taskIsFallbackProbe = false;
	if (!taskId || (taskId === "design-01-3d-benchmark-explainer" && !options.includeHeavyBench)) {
		taskId = permissions === "workspace" ? "tb-01-log-forensics" : "explore-01-callflow-map";
		taskIsFallbackProbe = true;
	}
	const task = BENCHMARK_TASKS.find((t) => t.id === taskId);
	if (!task) {
		throw new Error(`No existe tarea de benchmark "${taskId}" para el rol "${canonicalRole}".`);
	}

	const iduConfig = loadIduConfig();
	const installedClis =
		options.installedClisOverride ??
		Object.entries(iduConfig.clis).map(([name, def]) => ({
			name,
			available: checkCliAvailable(def.command),
		}));

	const requestedHarnessSet = options.harnesses?.length
		? new Set(options.harnesses.map((h) => canonicalHarnessName(h.trim().toLowerCase())))
		: null;

	const compatibility = listCompatibleHarnessesForModel(parsedModel, installedClis).filter(
		(c) => !requestedHarnessSet || requestedHarnessSet.has(c.harness),
	);

	const runnable = compatibility.filter((c) => c.compatible && c.available);
	const skippedCells: ModelTerminalTestCell[] = compatibility
		.filter((c) => !c.compatible || !c.available)
		.map((c) => {
			const formatted = formatProfileFieldsForHarness(c.harness, parsedModel);
			return {
				harness: c.harness,
				compatible: c.compatible,
				available: c.available,
				incompatibleReason: !c.compatible ? c.reason : "CLI no detectado en PATH",
				profileProvider: formatted.provider,
				profileModel: formatted.model,
				taskId: task.id,
				supported: false,
				unsupportedReason: !c.compatible ? c.reason : "CLI no detectado en PATH",
				resolved: false,
				regressionsClean: true,
				autonomous: false,
				failToPassPassed: 0,
				failToPassTotal: 1,
				durationMs: 0,
				totalTokens: null,
				costUsd: null,
				compositeBenchScore: 0,
				summaryPreview: "",
			};
		});

	const aa = options.aaFetcher
		? await options.aaFetcher()
		: await fetchArtificialAnalysisCatalog({ apiKey: options.aaApiKey }).catch(
				(): AaCatalogResult => ({
					models: [],
					source: "unavailable",
					fetchedAt: null,
				}),
			);
	const nanKey = resolveNanApiKey();
	const beforeIdu = snapshotUserIduFiles();
	const billingModel: "plan" | "api" =
		parsedModel.provider && ["anthropic", "antigravity", "openai-codex", "command-code", "minimax"].includes(parsedModel.provider)
			? "plan"
			: "api";

	const executedCells: ModelTerminalTestCell[] = [];
	const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 3));
	let finished = 0;

	await runPool(runnable, concurrency, async (item) => {
		const formatted = formatProfileFieldsForHarness(item.harness, parsedModel);
		const effortInfo = resolveHarnessEffortArg(item.harness, requestedEffort);
		const planCell: MiniBenchCellPlan = {
			role: canonicalRole,
			harness: item.harness,
			provider: parsedModel.provider ?? item.harness,
			modelId: parsedModel.modelId,
			profileModel: formatted.model,
			profileProvider: formatted.provider,
			...(requestedEffort ? { effort: requestedEffort } : {}),
			billingModel,
			taskId: task.id,
			permissionMode: permissions,
			targetProfiles: [],
			estCostUsd: 0,
			estDurationSec: roleSpec?.estBenchDurationSecPerCell ?? 60,
			aaScore: 0,
			reason: `Manual model terminal probe (${parsedModel.display})`,
		};

		const outcome = options.cellRunner
			? await options.cellRunner(planCell, task)
			: await runSingleShortlistCell(planCell, task, iduConfig, nanKey, aa.models);

		executedCells.push({
			harness: item.harness,
			compatible: true,
			available: true,
			profileProvider: formatted.provider,
			profileModel: formatted.model,
			...(effortInfo.effective ? { effortApplied: effortInfo.effective } : {}),
			taskId: task.id,
			supported: outcome.supported,
			unsupportedReason: outcome.unsupportedReason,
			resolved: outcome.resolved,
			regressionsClean: outcome.regressionsClean,
			autonomous: outcome.autonomous,
			failToPassPassed: outcome.failToPassPassed,
			failToPassTotal: outcome.failToPassTotal,
			durationMs: outcome.durationMs,
			totalTokens: outcome.totalTokens,
			costUsd: outcome.costUsd,
			compositeBenchScore: outcome.compositeBenchScore,
			summaryPreview: outcome.summaryPreview,
			error: outcome.error,
		});
		finished++;
		const sec = `${(outcome.durationMs / 1000).toFixed(1)}s`;
		options.onProgress?.(
			`[${finished}/${runnable.length}] ${item.harness} (${parsedModel.display}) -> resolved=${outcome.resolved} regClean=${outcome.regressionsClean} ${sec} score=${outcome.compositeBenchScore}`,
		);
	});

	const afterIdu = snapshotUserIduFiles();
	const userConfigUntouched =
		beforeIdu.profilesSha256 === afterIdu.profilesSha256 &&
		beforeIdu.configSha256 === afterIdu.configSha256;

	executedCells.sort((a, b) => {
		const aPass = a.supported && a.resolved && a.regressionsClean && a.autonomous ? 1 : 0;
		const bPass = b.supported && b.resolved && b.regressionsClean && b.autonomous ? 1 : 0;
		if (bPass !== aPass) return bPass - aPass;
		const scoreDiff = b.compositeBenchScore - a.compositeBenchScore;
		if (Math.abs(scoreDiff) > 0.25) return scoreDiff;
		const effDiff =
			(HARNESS_EFFICIENCY_TIEBREAK[b.harness] ?? 0) - (HARNESS_EFFICIENCY_TIEBREAK[a.harness] ?? 0);
		if (effDiff !== 0) return effDiff;
		return a.durationMs - b.durationMs;
	});

	const winner = executedCells.find((c) => c.supported && c.resolved && c.regressionsClean && c.autonomous) ?? null;
	const recommendedHarness = winner?.harness ?? null;
	let recommendationReason: string;
	if (winner) {
		const sec = `${(winner.durationMs / 1000).toFixed(1)}s`;
		const tok = winner.totalTokens !== null ? `, ${Math.round(winner.totalTokens / 1000)}k tok` : "";
		recommendationReason = `${winner.harness} resolvió ${task.id} limpio (score ${winner.compositeBenchScore}, ${sec}${tok}) entre ${runnable.length} terminal(es) compatible(s).`;
	} else if (runnable.length === 0) {
		recommendationReason = `Ninguna terminal instalada resultó compatible con "${parsedModel.display}".`;
	} else {
		recommendationReason = `Ninguna de las ${runnable.length} terminal(es) probadas pasó ${task.id} limpiamente; podés elegir una terminal manualmente o revisar los logs.`;
	}

	return {
		testedAt: new Date().toISOString(),
		role: canonicalRole,
		taskId: task.id,
		taskIsFallbackProbe,
		...(requestedEffort ? { requestedEffort } : {}),
		modelInput: options.modelInput,
		parsedModel: {
			provider: parsedModel.provider,
			modelId: parsedModel.modelId,
			display: parsedModel.display,
		},
		recommendedHarness,
		recommendationReason,
		userConfigUntouched,
		results: [...executedCells, ...skippedCells],
	};
}
