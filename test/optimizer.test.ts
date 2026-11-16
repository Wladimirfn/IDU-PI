import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	applyOptimization,
	buildRoleProposals,
	discoverFleetCapabilities,
	fetchArtificialAnalysisCatalog,
	matchAaModel,
	matchesRoleFilter,
	parseAaLeaderboardHtml,
	parseCsvFlag,
	proposeOptimization,
	ROLE_OBJECTIVES,
	runOptimizationBench,
	type AaModelMetrics,
	type MiniBenchCellOutcome,
	type MiniBenchCellPlan,
	type OptimizeProposal,
} from "../src/optimizer/index.js";
import { getBenchmarkTask } from "../bench/tasks/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function makeSampleAaHtml(): string {
	const models = [
		{
			id: "m1",
			name: "DeepSeek V4.1 Flash 1017 (Max)",
			intelligenceIndex: 32.6,
			outputSpeed: 105.4,
			timeToFirstToken: 1.2,
			price1mInputTokens: 0.3,
			price1mOutputTokens: 1.2,
			scores: { "frontiercode-2-0": 0.44, "terminalbench-4-0": 0.41 },
			contextWindowTokens: 1_000_000,
			isReasoning: true,
		},
		{
			id: "m2",
			name: "Claude Opus 5.5 (Max)",
			intelligenceIndex: 59.1,
			outputSpeed: 64.0,
			timeToFirstToken: 2.1,
			price1mInputTokens: 4.0,
			price1mOutputTokens: 20.0,
			scores: { "frontiercode-2-0": 0.52, "terminalbench-4-0": 0.54 },
			contextWindowTokens: 1_000_000,
			isReasoning: true,
		},
		{
			id: "m3",
			name: "Tencent Hy4",
			intelligenceIndex: 34.6,
			outputSpeed: 93.6,
			timeToFirstToken: 2.9,
			price1mInputTokens: 0.83,
			price1mOutputTokens: 2.5,
			scores: { "frontiercode-2-0": 0.31, "aa-3d": 0.45 },
			contextWindowTokens: 262_144,
			isReasoning: true,
		},
	];
	const escapedChunks = models.map((m) => JSON.stringify(m).replace(/"/g, '\\"'));
	return `<html><script>self.__next_f.push([1,"${escapedChunks.join(",")}"])</script></html>`;
}

test("parseAaLeaderboardHtml, fetchArtificialAnalysisCatalog cache/fallback, and matchAaModel", async () => {
	const parsed = parseAaLeaderboardHtml(makeSampleAaHtml());
	assert.equal(parsed.length, 3);
	const ds = matchAaModel("nan/deepseek-v4-flash", parsed);
	assert.equal(ds.matched?.name, "DeepSeek V4.1 Flash 1017 (Max)");
	assert.equal(ds.matched?.outputSpeedTokPerSec, 105.4);
	assert.equal(ds.matched?.price1mBlendedUsd, 0.525);

	const hy = matchAaModel("custom_provider:nan/hy4", parsed);
	assert.equal(hy.matched?.name, "Tencent Hy4");

	const opus = matchAaModel("opus", parsed);
	assert.equal(opus.matched?.name, "Claude Opus 5.5 (Max)");

	const miss = matchAaModel("completely-unknown-model-xyz", parsed);
	assert.equal(miss.matched, null);
	assert.equal(miss.confidence, "unmatched");

	const cacheDir = mkdtempSync(join(tmpdir(), "idu-aa-cache-"));
	try {
		const cachePath = join(cacheDir, "aa-models.json");
		let calls = 0;
		const okFetch = (async () => {
			calls++;
			return new Response(makeSampleAaHtml(), { status: 200 });
		}) as unknown as typeof fetch;

		const live = await fetchArtificialAnalysisCatalog({ cachePath, fetchImpl: okFetch, now: 1_000_000 });
		assert.equal(live.source, "aa-ssr-catalog");
		assert.equal(live.models.length, 3);
		assert.equal(calls, 1);

		const fromCache = await fetchArtificialAnalysisCatalog({ cachePath, fetchImpl: okFetch, now: 1_000_500 });
		assert.equal(fromCache.source, "cached");
		assert.equal(calls, 1, "must hit cache inside TTL");

		const failingFetch = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		const staleFallback = await fetchArtificialAnalysisCatalog({
			cachePath,
			fetchImpl: failingFetch,
			fresh: true,
			now: 99_999_999,
		});
		assert.equal(staleFallback.source, "cached");
		assert.match(staleFallback.warning ?? "", /network down/);
	} finally {
		rmSync(cacheDir, { recursive: true, force: true });
	}
});

test("discoverFleetCapabilities reads plans, filters opencode auth providers, queries /v1/models, and never leaks keys", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-opt-disc-"));
	const prevIduHome = process.env.IDU_HOME;
	const iduHome = join(root, "idu-home");
	const fakeHome = join(root, "user-home");
	const secretNan = "sk-nan-TOPSECRET-998877";
	const secretOc = "sk-oc-TOPSECRET-112233";

	try {
		process.env.IDU_HOME = iduHome;
		mkdirSync(iduHome, { recursive: true });
		mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
		mkdirSync(join(fakeHome, ".local", "share", "opencode"), { recursive: true });
		mkdirSync(join(fakeHome, ".codex"), { recursive: true });

		writeFileSync(
			join(fakeHome, ".pi", "agent", "auth.json"),
			JSON.stringify({ nan: { type: "api_key", key: secretNan } }),
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".local", "share", "opencode", "auth.json"),
			JSON.stringify({ openai: { type: "oauth", access: secretOc } }),
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".codex", "auth.json"),
			JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null }),
			"utf8",
		);

		const discovery = await discoverFleetCapabilities({
			homeDir: fakeHome,
			env: { PATH: process.env.PATH ?? "" },
			checkCliImpl: (cmd) => cmd === "pi" || cmd === "opencode" || cmd === "codex" || cmd === "agy",
			execCliImpl: (cmd, args) => {
				if (cmd === "opencode" && args[0] === "models") {
					return ["openai/gpt-6.1-terra", "unauthed-vendor/secret-model"].join("\n");
				}
				if (cmd === "agy" && args[0] === "models") {
					return "gemini-4-argon-high\tGemini 4 Argon (High)\n";
				}
				return null;
			},
			fetchImpl: (async (url: string | URL, init?: RequestInit) => {
				if (String(url).includes("nan.builders")) {
					assert.equal((init?.headers as Record<string, string>)?.Authorization, `Bearer ${secretNan}`);
					return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash", max_input_tokens: 1_000_000 }] }), {
						status: 200,
					});
				}
				return new Response("{}", { status: 404 });
			}) as unknown as typeof fetch,
			readQuotaImpl: async () => [
				{
					source: "codex",
					harness: "codex",
					billingModel: "plan",
					plan: "plus",
					meters: {
						plan: {
							id: "plan",
							label: "ChatGPT plan",
							windows: {
								"5h": { remainingPercent: 92, resetsAt: null, resetsInSeconds: null, windowSeconds: 18000 },
							},
						},
					},
					capturedAt: new Date().toISOString(),
					stale: false,
					unknownReason: null,
				},
			],
		});

		const serialized = JSON.stringify(discovery);
		assert.ok(!serialized.includes(secretNan), "discovery output must never leak Nan secret");
		assert.ok(!serialized.includes(secretOc), "discovery output must never leak OpenCode OAuth secret");
		assert.ok(discovery.candidates.some((c) => c.harness === "pi" && c.modelId === "deepseek-v4-flash"));
		assert.ok(discovery.candidates.some((c) => c.harness === "opencode" && c.profileModel === "openai/gpt-6.1-terra"));
		assert.ok(
			!discovery.candidates.some((c) => c.profileModel === "unauthed-vendor/secret-model"),
			"must exclude unauthenticated opencode providers",
		);
		assert.ok(discovery.candidates.some((c) => c.harness === "antigravity" && c.modelId === "gemini-4-argon-high"));
	} finally {
		if (prevIduHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevIduHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("3-stage optimizer flow: propose -> run-bench -> apply with backup and provider cleanup", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-opt-e2e-"));
	const prevIduHome = process.env.IDU_HOME;
	const iduHome = join(root, "idu-home");
	const optDir = join(iduHome, "optimize");
	const profilesPath = join(iduHome, "profiles.json");

	try {
		process.env.IDU_HOME = iduHome;
		mkdirSync(iduHome, { recursive: true });
		writeFileSync(
			profilesPath,
			JSON.stringify(
				{
					replaceDefaults: true,
					profiles: {
						"explore-glm": {
							harness: "commandcode",
							provider: "nan",
							model: "nan/glm5.3-flash",
							permissions: "read-only",
							description: "ROL EXPLORACIÓN (1º): incumbent.",
							timeoutMs: 1800000,
						},
						"consult-claude": {
							harness: "claude",
							provider: "anthropic",
							model: "opus",
							permissions: "read-only",
							description: "ROL CONSULTAS (1º): incumbent.",
							streams: true,
							hardCapMs: 14400000,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const aaModels: AaModelMetrics[] = [
			{
				id: "deepseek-v4-1-flash-1017",
				name: "DeepSeek V4.1 Flash",
				intelligenceIndex: 32.6,
				codingScore: 44,
				visual3dScore: null,
				outputSpeedTokPerSec: 110,
				ttftSeconds: 1.0,
				timePerTaskSeconds: 800,
				price1mInputUsd: 0.3,
				price1mOutputUsd: 1.2,
				price1mBlendedUsd: 0.525,
				contextWindowTokens: 1_000_000,
				source: "aa-ssr-catalog",
			},
			{
				id: "glm-5-3-flash",
				name: "GLM-5.3-Flash",
				intelligenceIndex: 27.8,
				codingScore: 40,
				visual3dScore: null,
				outputSpeedTokPerSec: 53.5,
				ttftSeconds: 3.4,
				timePerTaskSeconds: 1200,
				price1mInputUsd: 0.15,
				price1mOutputUsd: 0.5,
				price1mBlendedUsd: 0.24,
				contextWindowTokens: 1_000_000,
				source: "aa-ssr-catalog",
			},
			{
				id: "claude-opus-5-5",
				name: "Claude Opus 5.5",
				intelligenceIndex: 59.1,
				codingScore: 52,
				visual3dScore: null,
				outputSpeedTokPerSec: 64,
				ttftSeconds: 2.0,
				timePerTaskSeconds: 1491,
				price1mInputUsd: 4.0,
				price1mOutputUsd: 20.0,
				price1mBlendedUsd: 8.0,
				contextWindowTokens: 1_000_000,
				source: "aa-ssr-catalog",
			},
		];

		const mockDiscovery = {
			clis: [
				{ harness: "pi", command: "pi", available: true, billingModel: "api" as const, planLabel: null, remainingPercent: null, authProviders: ["nan"], discoveredModelCount: 1 },
				{ harness: "commandcode", command: "cmdc", available: true, billingModel: "api" as const, planLabel: null, remainingPercent: null, authProviders: ["nan"], discoveredModelCount: 1 },
				{ harness: "claude", command: "claude", available: true, billingModel: "plan" as const, planLabel: "sub", remainingPercent: 85, authProviders: ["anthropic"], discoveredModelCount: 1 },
			],
			providers: [],
			quotas: [],
			candidates: [
				{
					harness: "pi",
					provider: "nan",
					modelId: "deepseek-v4-flash",
					profileModel: "deepseek-v4-flash",
					displayName: "deepseek-v4-flash",
					billingModel: "api" as const,
					source: "live-endpoint" as const,
					contextWindow: 1_000_000,
				},
				{
					harness: "commandcode",
					provider: "nan",
					modelId: "glm5.3-flash",
					profileModel: "nan/glm5.3-flash",
					displayName: "glm5.3-flash",
					billingModel: "api" as const,
					source: "local-config" as const,
					contextWindow: 1_000_000,
				},
				{
					harness: "claude",
					provider: "anthropic",
					modelId: "opus",
					profileModel: "opus",
					displayName: "Claude Opus",
					billingModel: "plan" as const,
					source: "local-config" as const,
					contextWindow: 1_000_000,
				},
			],
			historicalMetrics: [],
			warnings: [],
		};

		const roleCheck = buildRoleProposals({
			profiles: JSON.parse(readFileSync(profilesPath, "utf8")).profiles,
			candidates: mockDiscovery.candidates,
			aaCatalog: aaModels,
			quotas: [],
			historicalMetrics: [],
			selectedRoles: ["Exploración", "Consultas"],
		});
		const consultRole = roleCheck.find((r) => r.role === "Consultas");
		assert.equal(consultRole?.topCandidates[0]?.modelId, "opus", "Consultas must rank highest-IQ candidate first");
		const exploreRole = roleCheck.find((r) => r.role === "Exploración");
		assert.equal(exploreRole?.topCandidates[0]?.modelId, "deepseek-v4-flash", "Exploración must prioritize fast/cheap reliable candidate over slower options");

		const proposal = await proposeOptimization({
			roles: ["Exploración", "Consultas"],
			optimizeDir: optDir,
			aaFetcher: async () => ({ models: aaModels, source: "aa-ssr-catalog", fetchedAt: new Date().toISOString() }),
			discoverer: async () => mockDiscovery,
		});

		assert.ok(existsSync(join(optDir, "latest-proposal.json")));
		assert.ok(proposal.shortlist.length >= 2);
		assert.equal(JSON.parse(readFileSync(profilesPath, "utf8")).profiles["explore-glm"].harness, "commandcode");

		const stubCellRunner = async (cell: (typeof proposal.shortlist)[number]): Promise<MiniBenchCellOutcome> => {
			if (cell.harness === "pi" && cell.modelId === "deepseek-v4-flash") {
				return {
					...cell,
					supported: true,
					resolved: true,
					regressionsClean: true,
					autonomous: true,
					failToPassPassed: 3,
					failToPassTotal: 3,
					durationMs: 21_000,
					totalTokens: 12_000,
					costUsd: 0.004,
					compositeBenchScore: 95,
					summaryPreview: "fast clean pass",
				};
			}
			if (cell.harness === "commandcode") {
				return {
					...cell,
					supported: true,
					resolved: false,
					regressionsClean: true,
					autonomous: true,
					failToPassPassed: 0,
					failToPassTotal: 3,
					durationMs: 90_000,
					totalTokens: 80_000,
					costUsd: 0.02,
					compositeBenchScore: 10,
					summaryPreview: "truncated",
				};
			}
			return {
				...cell,
				supported: true,
				resolved: true,
				regressionsClean: true,
				autonomous: true,
				failToPassPassed: 4,
				failToPassTotal: 4,
				durationMs: 35_000,
				totalTokens: null,
				costUsd: 0,
				compositeBenchScore: 92,
				summaryPreview: "opus ok",
			};
		};

		// Accent-folded subset filter reuses cached latest-proposal.json instead of re-discovering.
		const cachedSubsetRun = await runOptimizationBench({
			roles: ["exploracion"],
			optimizeDir: optDir,
			discoverer: async () => {
				throw new Error("should reuse cached proposal without re-running discovery");
			},
			aaFetcher: async () => ({ models: aaModels, source: "aa-ssr-catalog", fetchedAt: new Date().toISOString() }),
			cellRunner: stubCellRunner,
		});
		assert.deepEqual(
			cachedSubsetRun.recommendations.map((r) => r.role),
			["Exploración"],
		);

		const runResult = await runOptimizationBench({
			roles: ["Exploración", "Consultas"],
			optimizeDir: optDir,
			discoverer: async () => mockDiscovery,
			aaFetcher: async () => ({ models: aaModels, source: "aa-ssr-catalog", fetchedAt: new Date().toISOString() }),
			cellRunner: stubCellRunner,
		});

		assert.equal(runResult.userConfigUntouched, true);
		const updateGlm = runResult.recommendations.find((r) => r.profileName === "explore-glm");
		assert.equal(updateGlm?.action, "update");
		assert.equal(updateGlm?.recommended.harness, "pi");
		assert.equal(updateGlm?.recommended.model, "deepseek-v4-flash");

		const applied = applyOptimization({ optimizeDir: optDir, profilesPath });
		assert.equal(applied.updatedProfiles.length, 1);
		assert.ok(applied.backupPath && existsSync(applied.backupPath));

		const updatedFile = JSON.parse(readFileSync(profilesPath, "utf8"));
		assert.equal(updatedFile.replaceDefaults, true);
		assert.equal(updatedFile.profiles["explore-glm"].harness, "pi");
		assert.equal(updatedFile.profiles["explore-glm"].model, "deepseek-v4-flash");
		assert.equal(updatedFile.profiles["explore-glm"].timeoutMs, 1800000, "must preserve untouched profile fields");
		assert.equal(updatedFile.profiles["consult-claude"].harness, "claude", "healthy winner remains untouched");
	} finally {
		if (prevIduHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevIduHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu-pi optimize --help and idupi optimize --help exit cleanly", () => {
	const cliHelp = spawnSync(process.execPath, [join(repoRoot, "dist", "src", "cli.js"), "optimize", "--help"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	assert.equal(cliHelp.status, 0);
	assert.match(cliHelp.stdout, /Safe 3-stage fleet optimizer/);

	const idupiHelp = spawnSync(process.execPath, [join(repoRoot, "dist", "src", "idupi-bin.js"), "optimize", "--help"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	assert.equal(idupiHelp.status, 0);
	assert.match(idupiHelp.stdout, /--run-bench/);
});

test("parseCsvFlag and matchesRoleFilter handle PowerShell arrays, accents, and bilingual aliases", () => {
	// PowerShell unquoted `--roles Exploración,Auditoría` arrives as separate array argv tokens.
	assert.deepEqual(
		parseCsvFlag(["optimize", "--run-bench", "--roles", "Exploración", "Auditoría", "--concurrency", "3"], "--roles"),
		["Exploración", "Auditoría"],
	);
	assert.deepEqual(
		parseCsvFlag(["--roles", "exploracion, auditoria", "--roles", "Trabajo"], "--roles"),
		["exploracion", "auditoria", "Trabajo"],
	);
	assert.equal(parseCsvFlag(["--run-bench"], "--roles"), undefined);

	assert.equal(matchesRoleFilter("Exploración", ["exploracion"]), true);
	assert.equal(matchesRoleFilter("Auditoría", ["audit"]), true);
	assert.equal(matchesRoleFilter("Auditoría", ["auditoría"]), true);
	assert.equal(matchesRoleFilter("Trabajo", ["work"]), true);
	assert.equal(matchesRoleFilter("Consultas", ["consult"]), true);
	assert.equal(matchesRoleFilter("Arquitectura", ["architecture"]), true);
	assert.equal(matchesRoleFilter("Trabajo", ["exploracion", "auditoria"]), false);
});

test("every ROLE_OBJECTIVES benchmarkTaskId resolves in BENCHMARK_TASKS", () => {
	for (const spec of Object.values(ROLE_OBJECTIVES)) {
		if (!spec.benchmarkTaskId) continue;
		const resolvedTask = getBenchmarkTask(spec.benchmarkTaskId);
		assert.ok(resolvedTask, `ROLE_OBJECTIVES.${spec.role}.benchmarkTaskId (${spec.benchmarkTaskId}) must exist`);
		assert.equal(resolvedTask.id, spec.benchmarkTaskId);
	}
});

test("discovery excludes expired opencode OAuth, @ai-sdk/anthropic commandcode gateway, and paid OpenRouter models on free tier", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-opt-auth-filters-"));
	const prevIduHome = process.env.IDU_HOME;
	const iduHome = join(root, "idu-home");
	const fakeHome = join(root, "user-home");

	try {
		process.env.IDU_HOME = iduHome;
		mkdirSync(iduHome, { recursive: true });
		mkdirSync(join(fakeHome, ".local", "share", "opencode"), { recursive: true });
		mkdirSync(join(fakeHome, ".config", "opencode"), { recursive: true });
		mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });

		writeFileSync(
			join(fakeHome, ".pi", "agent", "models.json"),
			JSON.stringify({
				providers: {
					"commandcode-anth": {
						models: [{ id: "claude-fable-5" }],
					},
				},
			}),
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".local", "share", "opencode", "auth.json"),
			JSON.stringify({
				openai: { type: "oauth", access: "expired-tok", expires: 1_000_000 },
				zai: { type: "api", key: "valid-zai-tok" },
			}),
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".config", "opencode", "opencode.json"),
			JSON.stringify({
				provider: {
					"commandcode-anth": {
						npm: "@ai-sdk/anthropic",
						options: { baseURL: "https://api.commandcode.ai/provider/v1", apiKey: "stale-cmdc-key" },
					},
				},
			}),
			"utf8",
		);

		const discovery = await discoverFleetCapabilities({
			homeDir: fakeHome,
			env: { PATH: process.env.PATH ?? "", OPENROUTER_API_KEY: "or-free-key" },
			checkCliImpl: (cmd) => cmd === "pi" || cmd === "opencode",
			execCliImpl: (cmd, args) => {
				if (cmd === "opencode" && args[0] === "models") {
					return [
						"openai/gpt-6.1-terra",
						"commandcode-anth/claude-fable-5",
						"zai/glm-5",
						"openrouter/openai/o3",
						"openrouter/deepseek/deepseek-r1:free",
					].join("\n");
				}
				return null;
			},
			fetchImpl: (async (url: string | URL) => {
				const u = String(url);
				if (u.endsWith("/api/v1/models")) {
					return new Response(
						JSON.stringify({
							data: [{ id: "openai/o3" }, { id: "deepseek/deepseek-r1:free" }],
						}),
						{ status: 200 },
					);
				}
				if (u.endsWith("/api/v1/key")) {
					return new Response(
						JSON.stringify({ data: { is_free_tier: true, limit_remaining: null } }),
						{ status: 200 },
					);
				}
				return new Response("{}", { status: 404 });
			}) as unknown as typeof fetch,
			readQuotaImpl: async () => [],
		});

		assert.ok(discovery.candidates.some((c) => c.harness === "opencode" && c.profileModel === "zai/glm-5"));
		assert.ok(
			discovery.candidates.some((c) => c.provider === "openrouter" && c.modelId.endsWith(":free")),
			"free-tier :free models should remain available",
		);
		assert.ok(
			!discovery.candidates.some((c) => c.profileModel === "openai/gpt-6.1-terra"),
			"expired OpenAI OAuth must be excluded",
		);
		assert.ok(
			!discovery.candidates.some((c) => c.harness === "pi" && c.modelId === "claude-fable-5"),
			"blocked opencode custom provider must not bleed into pi models.json candidates",
		);
		assert.ok(
			!discovery.candidates.some((c) => c.profileModel === "commandcode-anth/claude-fable-5"),
			"@ai-sdk/anthropic commandcode gateway must be excluded",
		);
		assert.ok(
			!discovery.candidates.some((c) => c.provider === "openrouter" && !c.modelId.endsWith(":free")),
			"paid OpenRouter models must be excluded when key is free-tier without credits",
		);
		assert.ok(discovery.warnings.some((w) => /expirado/i.test(w)));
		assert.ok(discovery.warnings.some((w) => /free-tier/i.test(w)));
	} finally {
		if (prevIduHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevIduHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildRoleProposals preserves highest effort tier, seeds incumbents across collapsed variants, and avoids 0% quota plans", () => {
	const catalog: AaModelMetrics[] = [
		{
			id: "claude-opus-5-5",
			name: "Claude Opus 5.5 (Max)",
			intelligenceIndex: 59.1,
			codingScore: 54,
			visual3dScore: null,
			outputSpeedTokPerSec: 110,
			ttftSeconds: 1.5,
			timePerTaskSeconds: 900,
			price1mInputUsd: 4,
			price1mOutputUsd: 20,
			price1mBlendedUsd: 8,
			contextWindowTokens: 1_000_000,
			isReasoning: true,
			source: "aa-ssr-catalog",
		},
		{
			id: "gemini-4-argon",
			name: "Gemini 4 Argon (High)",
			intelligenceIndex: 50.4,
			codingScore: 48,
			visual3dScore: null,
			outputSpeedTokPerSec: 120,
			ttftSeconds: 1.2,
			timePerTaskSeconds: 800,
			price1mInputUsd: 2,
			price1mOutputUsd: 10,
			price1mBlendedUsd: 4,
			contextWindowTokens: 1_000_000,
			isReasoning: true,
			source: "aa-ssr-catalog",
		},
		{
			id: "glm-5-3-flash",
			name: "GLM-5.3-Flash",
			intelligenceIndex: 27.8,
			codingScore: 40,
			visual3dScore: null,
			outputSpeedTokPerSec: 90,
			ttftSeconds: 1.0,
			timePerTaskSeconds: 600,
			price1mInputUsd: 0.15,
			price1mOutputUsd: 0.5,
			price1mBlendedUsd: 0.24,
			contextWindowTokens: 1_000_000,
			source: "aa-ssr-catalog",
		},
	];

	assert.equal(matchAaModel("custom_provider:nan/glm5.3-flash", catalog).matched?.name, "GLM-5.3-Flash");

	const proposals = buildRoleProposals({
		profiles: {
			"arch-gemini": {
				harness: "antigravity",
				model: "gemini-4-argon-high",
				permissions: "read-only",
				description: "ROL ARQUITECTURA (1)",
			},
		},
		candidates: [
			{
				harness: "antigravity",
				provider: "antigravity",
				modelId: "claude-opus-5-5-low",
				profileModel: "claude-opus-5-5-low",
				displayName: "Claude Opus 5.5 (Low)",
				billingModel: "plan",
				source: "cli-list",
				contextWindow: null,
			},
			{
				harness: "antigravity",
				provider: "antigravity",
				modelId: "claude-opus-5-5-high",
				profileModel: "claude-opus-5-5-high",
				displayName: "Claude Opus 5.5 (High)",
				billingModel: "plan",
				source: "cli-list",
				contextWindow: null,
			},
			{
				harness: "antigravity",
				provider: "antigravity",
				modelId: "gemini-4-argon-medium",
				profileModel: "gemini-4-argon-medium",
				displayName: "Gemini 4 Argon (Medium)",
				billingModel: "plan",
				source: "cli-list",
				contextWindow: null,
			},
			{
				harness: "antigravity",
				provider: "antigravity",
				modelId: "gemini-4-argon-high",
				profileModel: "gemini-4-argon-high",
				displayName: "Gemini 4 Argon (High)",
				billingModel: "plan",
				source: "cli-list",
				contextWindow: null,
			},
			{
				harness: "codex",
				provider: "openai-codex",
				modelId: "claude-opus-5-5-high",
				profileModel: "claude-opus-5-5-high",
				displayName: "Exhausted Codex Plan",
				billingModel: "plan",
				source: "quota",
				contextWindow: null,
			},
		],
		aaCatalog: catalog,
		quotas: [
			{
				source: "agy",
				harness: "antigravity",
				billingModel: "plan",
				plan: "plan",
				meters: { m: { id: "m", label: "agy", windows: { d: { remainingPercent: 54, resetsAt: null, resetsInSeconds: null, windowSeconds: 86400 } } } },
				capturedAt: new Date().toISOString(),
				stale: false,
				unknownReason: null,
			},
			{
				source: "codex",
				harness: "codex",
				billingModel: "plan",
				plan: "plus",
				meters: { m: { id: "m", label: "codex", windows: { h5: { remainingPercent: 0, resetsAt: null, resetsInSeconds: null, windowSeconds: 18000 } } } },
				capturedAt: new Date().toISOString(),
				stale: false,
				unknownReason: null,
			},
		],
		historicalMetrics: [],
		selectedRoles: ["Arquitectura"],
	});

	const arch = proposals[0];
	assert.equal(arch.topCandidates[0]?.profileModel, "claude-opus-5-5-high", "-high must beat -low when base score ties");
	assert.ok(
		arch.shortlist.some((s) => s.profileModel === "gemini-4-argon-high" && s.reason.includes("Titular actual")),
		"incumbent -high variant must be seeded instead of dropped behind -medium",
	);
	assert.ok(!arch.shortlist.some((s) => s.harness === "codex"), "0% remaining plan CLI must not consume a shortlist cell");
});

test("runOptimizationBench preserves transient-quota profiles and avoids cloning sibling pairs", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-opt-diversity-"));
	const prevIduHome = process.env.IDU_HOME;
	const iduHome = join(root, "idu-home");
	const optDir = join(iduHome, "optimize");
	try {
		process.env.IDU_HOME = iduHome;
		mkdirSync(iduHome, { recursive: true });
		const syntheticShortlist: MiniBenchCellPlan[] = [
			{
				role: "Consultas",
				harness: "commandcode",
				provider: "xiaomi",
				modelId: "mimo-v2.6-pro",
				profileModel: "xiaomi/mimo-v2.6-pro",
				billingModel: "plan",
				taskId: "consult-01-arch-tradeoff",
				permissionMode: "read-only",
				targetProfiles: ["consult-openai", "consult-mimo", "consult-claude"],
				estCostUsd: 0,
				estDurationSec: 50,
				aaScore: 80,
				reason: "incumbent",
			},
			{
				role: "Consultas",
				harness: "antigravity",
				provider: "antigravity",
				modelId: "gemini-4-hydrogen-xhigh",
				profileModel: "gemini-4-hydrogen-xhigh",
				billingModel: "plan",
				taskId: "consult-01-arch-tradeoff",
				permissionMode: "read-only",
				targetProfiles: ["consult-openai", "consult-mimo", "consult-claude"],
				estCostUsd: 0,
				estDurationSec: 65,
				aaScore: 81,
				reason: "challenger",
			},
			{
				role: "Consultas",
				harness: "claude",
				provider: "anthropic",
				modelId: "opus",
				profileModel: "opus",
				profileProvider: "anthropic",
				billingModel: "plan",
				taskId: "consult-01-arch-tradeoff",
				permissionMode: "read-only",
				targetProfiles: ["consult-openai", "consult-mimo", "consult-claude"],
				estCostUsd: 0,
				estDurationSec: 65,
				aaScore: 81.4,
				reason: "claude plan",
			},
		];
		const syntheticProposal: OptimizeProposal = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			iduHome,
			clis: [],
			providers: [],
			quotas: [],
			aaSource: "cached",
			aaFetchedAt: new Date().toISOString(),
			aaModelCount: 0,
			discoveredModelCount: 3,
			estimatedTotalCostUsd: 0,
			estimatedPlanCalls: 3,
			estimatedDurationSec: 120,
			roles: [
				{
					role: "Consultas",
					concept: "Max reasoning",
					permissions: "read-only",
					benchmarkTaskId: "consult-01-arch-tradeoff",
					currentProfiles: [
						{ profileName: "consult-openai", rank: 1, harness: "opencode", model: "openai/gpt-6.1-terra", permissions: "read-only" },
						{ profileName: "consult-mimo", rank: 2, harness: "commandcode", model: "xiaomi/mimo-v2.6-pro", permissions: "read-only" },
						{ profileName: "consult-claude", rank: 3, harness: "claude", provider: "anthropic", model: "opus", permissions: "read-only" },
					],
					topCandidates: [],
					shortlist: syntheticShortlist,
					notes: [],
				},
			],
			shortlist: syntheticShortlist,
			warnings: [],
		};

		const runResult = await runOptimizationBench({
			roles: ["Consultas"],
			optimizeDir: optDir,
			proposal: syntheticProposal,
			aaFetcher: async () => ({ models: [], source: "cached", fetchedAt: new Date().toISOString() }),
			discoverer: async () => ({ clis: [], providers: [], quotas: [], candidates: [], historicalMetrics: [], warnings: [] }),
			cellRunner: async (cell): Promise<MiniBenchCellOutcome> => {
				if (cell.harness === "claude") {
					return {
						...cell,
						supported: true,
						resolved: false,
						regressionsClean: false,
						autonomous: false,
						failToPassPassed: 0,
						failToPassTotal: 4,
						durationMs: 5_000,
						totalTokens: 0,
						costUsd: 0,
						compositeBenchScore: 0,
						summaryPreview: "You've hit your weekly limit · resets 8pm",
					};
				}
				return {
					...cell,
					supported: true,
					resolved: true,
					regressionsClean: true,
					autonomous: true,
					failToPassPassed: 4,
					failToPassTotal: 4,
					durationMs: cell.harness === "commandcode" ? 50_000 : 90_000,
					totalTokens: 50_000,
					costUsd: 0,
					compositeBenchScore: cell.harness === "commandcode" ? 97 : 91,
					summaryPreview: "ok",
				};
			},
		});

		const recOpenai = runResult.recommendations.find((r) => r.profileName === "consult-openai");
		const recMimo = runResult.recommendations.find((r) => r.profileName === "consult-mimo");
		const recClaude = runResult.recommendations.find((r) => r.profileName === "consult-claude");
		assert.equal(recMimo?.action, "keep");
		assert.equal(recClaude?.action, "keep", "transient weekly limit must not erase active claude profile");
		assert.equal(recOpenai?.action, "update");
		assert.equal(
			recOpenai?.recommended.model,
			"gemini-4-hydrogen-xhigh",
			"must fall back to second distinct passing runner instead of cloning sibling consult-mimo",
		);
	} finally {
		if (prevIduHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevIduHome;
		rmSync(root, { recursive: true, force: true });
	}
});
