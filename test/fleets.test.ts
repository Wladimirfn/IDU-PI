import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkerArgs } from "../src/cmdline.js";
import { loadIduConfig, loadProfilesConfig, getProfile } from "../src/config.js";
import {
	formatModelForOpenCode,
	inspectProfileEffort,
	parseReasoningEffortInput,
	resolveHarnessEffortArg,
} from "../src/effort.js";
import {
	bindProjectFleet,
	buildDynamicProfileDescription,
	checkHarnessModelCompatibility,
	createFleet,
	deleteFleet,
	deleteFleetAgent,
	formatProfileFieldsForHarness,
	LEGACY_AGENT_ALIASES,
	listFleets,
	migrateFleetFile,
	migrateProfilesToCanonicalSlots,
	nextAvailableSlotName,
	normalizeFleetSlug,
	parseModelSpec,
	renameFleet,
	resolveAgentProfile,
	resolveEffectiveFleet,
	unbindProjectFleet,
	upsertFleetAgent,
	useFleet,
	writeLocalFleetMarker,
} from "../src/fleets.js";
import { buildWorkerSpawnEnv } from "../src/runner.js";
import { loadAgentTuiSnapshot } from "../src/tui.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const CLI_PATH = join(repoRoot, "dist", "src", "cli.js");

function withIsolatedIduHome(fn: (ctx: { iduHome: string; root: string }) => void): void {
	const root = mkdtempSync(join(tmpdir(), "idu-fleets-test-"));
	const iduHome = join(root, "idu-home");
	const prevHome = process.env.IDU_HOME;
	const prevFleet = process.env.IDU_FLEET;
	delete process.env.IDU_FLEET;
	process.env.IDU_HOME = iduHome;
	mkdirSync(iduHome, { recursive: true });
	try {
		fn({ iduHome, root });
	} finally {
		if (prevHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevHome;
		if (prevFleet === undefined) delete process.env.IDU_FLEET;
		else process.env.IDU_FLEET = prevFleet;
		rmSync(root, { recursive: true, force: true });
	}
}

test("normalizeFleetSlug sanitizes spaces/accents and rejects invalid names", () => {
	assert.equal(normalizeFleetSlug("Perfil 1"), "perfil-1");
	assert.equal(normalizeFleetSlug("Perfil 20 · OpenCode"), "perfil-20-opencode");
	assert.throws(() => normalizeFleetSlug(".."), /inválido/i);
	assert.throws(() => normalizeFleetSlug("   "), /inválido/i);
});

test("named fleet CRUD, precedence resolution, and project bindings work end-to-end", () => {
	withIsolatedIduHome(({ iduHome, root }) => {
		writeFileSync(
			join(iduHome, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-1": { harness: "pi", provider: "nan", model: "deepseek-v4-flash", permissions: "workspace" },
				},
			}),
			"utf8",
		);

		const created1 = createFleet({ name: "perfil-1", description: "Flota OpenCode" });
		const created20 = createFleet({ name: "perfil-20", empty: true, description: "Flota Claude" });
		assert.equal(created1.name, "perfil-1");
		assert.equal(created20.name, "perfil-20");

		upsertFleetAgent({
			fleet: "perfil-20",
			slotName: "work-1",
			profile: { harness: "opencode", provider: "nan", model: "kimi-k3.1-pro", permissions: "workspace" },
		});

		const projA = join(root, "proj-a");
		const projB = join(root, "proj-b");
		mkdirSync(projA, { recursive: true });
		mkdirSync(projB, { recursive: true });

		bindProjectFleet("perfil-1", projA);
		writeLocalFleetMarker("perfil-20", projB);

		// Global active is still default
		assert.equal(resolveEffectiveFleet().fleetName, "default");
		// Project A resolves via binding to perfil-1
		assert.equal(resolveEffectiveFleet({ workingDir: projA }).fleetName, "perfil-1");
		assert.equal(resolveEffectiveFleet({ workingDir: projA }).source, "project-binding");
		// Project B resolves via .idu/fleet marker to perfil-20
		assert.equal(resolveEffectiveFleet({ workingDir: projB }).fleetName, "perfil-20");
		assert.equal(resolveEffectiveFleet({ workingDir: projB }).source, "project-local");
		assert.equal(getProfile("work-1", { workingDir: projB })?.model, "kimi-k3.1-pro");

		// Explicit fleet overrides project binding & active fleet
		useFleet("perfil-1");
		assert.equal(resolveEffectiveFleet().fleetName, "perfil-1");
		assert.equal(resolveEffectiveFleet({ fleet: "perfil-20", workingDir: projA }).fleetName, "perfil-20");
		assert.equal(resolveEffectiveFleet({ fleet: "perfil-20", workingDir: projA }).source, "explicit");

		// Env IDU_FLEET overrides project & active, yields to explicit
		process.env.IDU_FLEET = "perfil-20";
		assert.equal(resolveEffectiveFleet({ workingDir: projA }).fleetName, "perfil-20");
		assert.equal(resolveEffectiveFleet({ workingDir: projA }).source, "env");
		assert.equal(resolveEffectiveFleet({ fleet: "default", workingDir: projA }).fleetName, "default");
		delete process.env.IDU_FLEET;

		// Rename & delete clean up active/binding references
		renameFleet("perfil-20", "perfil-21");
		assert.ok(listFleets().some((f) => f.name === "perfil-21"));
		assert.equal(loadProfilesConfig({ fleet: "perfil-21" }).profiles["work-1"]?.harness, "opencode");

		unbindProjectFleet(projA);
		assert.equal(resolveEffectiveFleet({ workingDir: projA }).fleetName, "perfil-1"); // falls back to activeFleet

		const del = deleteFleet("perfil-1");
		assert.equal(del.deleted, "perfil-1");
		assert.equal(del.activeFleet, "default");
	});
});

test("parseModelSpec, compatibility matrix, and formatProfileFieldsForHarness normalize all CLI routing quirks", () => {
	const kimi = parseModelSpec("nan/kimi-k3.1-pro");
	assert.equal(kimi.provider, "nan");
	assert.equal(kimi.modelId, "kimi-k3.1-pro");
	assert.equal(kimi.display, "nan/kimi-k3.1-pro");

	assert.deepEqual(formatProfileFieldsForHarness("pi", kimi), {
		harness: "pi",
		provider: "nan",
		model: "kimi-k3.1-pro",
		streams: false,
	});
	assert.deepEqual(formatProfileFieldsForHarness("opencode", kimi), {
		harness: "opencode",
		provider: "nan",
		model: "kimi-k3.1-pro",
		streams: false,
	});
	assert.deepEqual(formatProfileFieldsForHarness("mcode", kimi), {
		harness: "mcode",
		model: "custom_provider:nan/kimi-k3.1-pro",
		streams: false,
	});
	assert.deepEqual(formatProfileFieldsForHarness("kimi", kimi), {
		harness: "kimi",
		model: "nan/kimi-k3.1-pro",
		streams: false,
	});
	assert.deepEqual(formatProfileFieldsForHarness("commandcode", kimi), {
		harness: "commandcode",
		model: "nan/kimi-k3.1-pro",
		streams: false,
	});

	assert.equal(checkHarnessModelCompatibility("claude", kimi, true).compatible, false);
	assert.equal(checkHarnessModelCompatibility("antigravity", kimi, true).compatible, false);
	assert.equal(checkHarnessModelCompatibility("pi", kimi, true).compatible, true);

	const nested = parseModelSpec("openrouter/qwen/qwen3-coder:free");
	assert.equal(nested.provider, "openrouter");
	assert.equal(nested.modelId, "qwen/qwen3-coder:free");
});

test("buildDynamicProfileDescription purges stale model/metric text and reflects new terminal & model", () => {
	const oldDesc =
		"ROL TRABAJO (3º): implementación con HY4 en su harness #1 de coding/terminal (62.5%, score 65.0 en nan-controlled-v1). kimi + HY4 (nan).";

	const manualDesc = buildDynamicProfileDescription({
		slotName: "work-3",
		role: "Trabajo",
		rank: 3,
		existingDescription: oldDesc,
		harness: "pi",
		provider: "nan",
		model: "kimi-k3.1-pro",
	});
	assert.doesNotMatch(manualDesc, /HY4|62\.5%|score 65\.0/i);
	assert.match(manualDesc, /^ROL TRABAJO \(3º\):/);
	assert.match(manualDesc, /pi \+ kimi-k3\.1-pro \(nan\)\./);

	const benchDesc = buildDynamicProfileDescription({
		slotName: "work-3",
		role: "Trabajo",
		rank: 3,
		existingDescription: oldDesc,
		harness: "opencode",
		provider: "nan",
		model: "kimi-k3.1-pro",
		benchmark: {
			taskId: "tb-01-log-forensics",
			resolved: true,
			regressionsClean: true,
			durationMs: 38_200,
			totalTokens: 14_000,
			score: 91.4,
			testedCount: 5,
			recommended: true,
		},
	});
	assert.match(benchDesc, /tb-01-log-forensics: 100%, 38\.2s, 14k tok, score 91\.4, recomendada entre 5 terminales/);
	assert.match(benchDesc, /opencode \+ kimi-k3\.1-pro \(nan\)/);
});

test("legacy aliases resolve cleanly and migrateFleetFile renames model-anchored slots with backup", () => {
	withIsolatedIduHome(({ iduHome }) => {
		writeFileSync(
			join(iduHome, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-mimo": {
						harness: "kimi",
						model: "nan/hy4",
						permissions: "workspace",
						description: "ROL TRABAJO (3º): implementación con HY4. kimi + HY4 (nan).",
					},
					"consult-gemini38": {
						harness: "antigravity",
						model: "gemini-4-hydrogen-xhigh",
						permissions: "read-only",
						description: "ROL CONSULTAS (4): consultas con Gemini 4 Hydrogen.",
					},
				},
			}),
			"utf8",
		);

		// Alias resolution works before migration
		const { profiles } = loadProfilesConfig();
		assert.equal(resolveAgentProfile(profiles, "work-3")?.resolvedName, "work-mimo");

		const mig = migrateFleetFile({ refreshDescriptions: true });
		assert.equal(mig.renamed.length, 2);
		assert.ok(mig.backupPath && existsSync(mig.backupPath));

		const after = loadProfilesConfig().profiles;
		assert.ok(after["work-3"]);
		assert.ok(after["consult-4"]);
		assert.equal(after["work-mimo"], undefined);
		assert.equal(resolveAgentProfile(after, "work-mimo")?.resolvedName, "work-3");
		assert.equal(nextAvailableSlotName("Trabajo", after), "work-1");

		// Ensure all 25 legacy alias constants map to non-model-anchored names
		assert.equal(Object.keys(LEGACY_AGENT_ALIASES).length, 25);
		const migratedEmpty = migrateProfilesToCanonicalSlots({
			replaceDefaults: true,
			profiles: { "audit-minimax": { harness: "pi", provider: "nan", model: "kimi-k3.1-pro" } },
		});
		assert.ok(migratedEmpty.migrated.profiles["audit-5"]);

		// Delete custom agent works cleanly
		const delRes = deleteFleetAgent({ slotName: "consult-4" });
		assert.equal(delRes.removed, true);
	});
});

test("codex + nan injects model_provider flags in buildWorkerArgs and NAN_API_KEY in buildWorkerSpawnEnv", () => {
	const cfg = loadIduConfig();
	const built = buildWorkerArgs(
		{ harness: "codex", provider: "nan", model: "kimi-k3.1-pro", permissions: "workspace" },
		"Fix bug",
		[],
		cfg,
	);
	assert.ok(built.args.includes('model_provider="nan"'));
	assert.equal(built.args[built.args.indexOf("-m") + 1], "kimi-k3.1-pro");

	const fakeHome = mkdtempSync(join(tmpdir(), "idu-codex-nan-home-"));
	try {
		mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(fakeHome, ".pi", "agent", "auth.json"),
			JSON.stringify({ nan: { type: "api_key", key: "nan-codex-secret" } }),
			"utf8",
		);
		const env = buildWorkerSpawnEnv(
			{ harness: "codex", args: built.args, env: { IDU_WORKER: "true" } },
			{},
			fakeHome,
		);
		assert.equal(env.NAN_API_KEY, "nan-codex-secret");
	} finally {
		rmSync(fakeHome, { recursive: true, force: true });
	}
});

test("CLI `idu-pi fleet` subcommands create, switch, and set-agent cleanly under isolated IDU_HOME", () => {
	withIsolatedIduHome(({ iduHome }) => {
		writeFileSync(
			join(iduHome, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-1": { harness: "mcode", model: "custom_provider:nan/glm5.3-flash", permissions: "workspace" },
				},
			}),
			"utf8",
		);

		const runCli = (args: string[]) =>
			spawnSync(process.execPath, [CLI_PATH, ...args], {
				encoding: "utf8",
				env: { ...process.env, IDU_HOME: iduHome },
			});

		const createRes = runCli(["fleet", "create", "perfil-1", "--use", "--json"]);
		assert.equal(createRes.status, 0, createRes.stderr);

		const setRes = runCli([
			"fleet",
			"set-agent",
			"work-1",
			"--fleet",
			"perfil-1",
			"--model",
			"nan/kimi-k3.1-pro",
			"--harness",
			"pi",
			"--json",
		]);
		assert.equal(setRes.status, 0, setRes.stderr);

		const saved = JSON.parse(readFileSync(join(iduHome, "fleets", "perfil-1.json"), "utf8")) as {
			profiles: Record<string, { harness: string; provider?: string; model?: string; description?: string }>;
		};
		assert.equal(saved.profiles["work-1"].harness, "pi");
		assert.equal(saved.profiles["work-1"].provider, "nan");
		assert.equal(saved.profiles["work-1"].model, "kimi-k3.1-pro");
		assert.match(saved.profiles["work-1"].description ?? "", /pi \+ kimi-k3\.1-pro \(nan\)/);
	});
});

test("resolveEffectiveFleet and loadAgentTuiSnapshot treat ~ (parent of IDU_HOME) as default and support real project-local .idu/profiles.json", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-home-parent-test-"));
	const fakeHomeDir = join(root, "elmas");
	const fakeIduHome = join(fakeHomeDir, ".idu");
	const projLocal = join(root, "proj-local");
	const prevHome = process.env.IDU_HOME;
	const prevFleet = process.env.IDU_FLEET;
	delete process.env.IDU_FLEET;
	process.env.IDU_HOME = fakeIduHome;
	mkdirSync(fakeIduHome, { recursive: true });
	mkdirSync(join(projLocal, ".idu"), { recursive: true });

	try {
		writeFileSync(
			join(fakeIduHome, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-1": { harness: "pi", provider: "nan", model: "kimi-k3.1-pro", permissions: "workspace" },
				},
			}),
			"utf8",
		);

		// 1. Running from dirname(IDU_HOME) (~) must resolve default, NOT "local:*"
		const homeEffective = resolveEffectiveFleet({ workingDir: dirname(fakeIduHome) });
		assert.equal(homeEffective.fleetName, "default");
		assert.equal(homeEffective.source, "default");

		const homeSnap = await loadAgentTuiSnapshot({ workingDir: dirname(fakeIduHome) });
		assert.equal(homeSnap.activeFleet, "default");
		assert.equal(homeSnap.fleetSource, "default");
		assert.ok(homeSnap.agents.some((a) => a.name === "work-1"));

		// 2. Real project with <proj>/.idu/profiles.json outside IDU_HOME resolves project-local and edits stay local
		writeFileSync(
			join(projLocal, ".idu", "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-1": { harness: "kimi", model: "nan/hy4", permissions: "workspace" },
				},
			}),
			"utf8",
		);
		const localEffective = resolveEffectiveFleet({ workingDir: projLocal });
		assert.equal(localEffective.fleetName, "local:proj-local");
		assert.equal(localEffective.source, "project-local");

		const localSnapBefore = await loadAgentTuiSnapshot({ workingDir: projLocal });
		assert.equal(localSnapBefore.activeFleet, "local:proj-local");
		assert.equal(localSnapBefore.fleetSource, "project-local");
		assert.ok(localSnapBefore.agents.some((a) => a.name === "work-1"));

		upsertFleetAgent({
			fleet: undefined,
			workingDir: projLocal,
			slotName: "work-2",
			profile: {
				harness: "pi",
				provider: "nan",
				model: "deepseek-v4-flash",
				permissions: "workspace",
				description: "ROL TRABAJO (2º): slot local",
			},
		});

		const localSnapAfter = await loadAgentTuiSnapshot({ workingDir: projLocal });
		assert.ok(localSnapAfter.agents.some((a) => a.name === "work-2"));
		const writtenGlobal = JSON.parse(readFileSync(join(fakeIduHome, "profiles.json"), "utf8")) as {
			profiles: Record<string, unknown>;
		};
		assert.equal(writtenGlobal.profiles["work-2"], undefined);
	} finally {
		if (prevHome === undefined) delete process.env.IDU_HOME;
		else process.env.IDU_HOME = prevHome;
		if (prevFleet === undefined) delete process.env.IDU_FLEET;
		else process.env.IDU_FLEET = prevFleet;
		rmSync(root, { recursive: true, force: true });
	}
});

test("reasoning effort translates per-CLI flags, preserves defaults when unset, and maps unsupported extremes safely", () => {
	const cfg = loadIduConfig();

	// Unset effort keeps legacy args unmodified
	const legacyOc = buildWorkerArgs(
		{ harness: "opencode", provider: "nan", model: "mimo-v2.6-flash#high", permissions: "read-only" },
		"Scan",
		[],
		cfg,
	);
	assert.equal(legacyOc.args[legacyOc.args.indexOf("--model") + 1], "nan/mimo-v2.6-flash#high");
	const legacyPi = buildWorkerArgs(
		{ harness: "pi", provider: "nan", model: "deepseek-v4-flash", permissions: "workspace" },
		"Code",
		[],
		cfg,
	);
	assert.ok(!legacyPi.args.includes("--thinking"));

	// Explicit effort across all CLIs
	const ocMax = buildWorkerArgs(
		{ harness: "opencode", provider: "nan", model: "mimo-v2.6-flash#high", effort: "max", permissions: "workspace" },
		"Code",
		[],
		cfg,
	);
	assert.equal(ocMax.args[ocMax.args.indexOf("--model") + 1], "nan/mimo-v2.6-flash#max");
	assert.equal(formatModelForOpenCode("opencode-go/deepseek-v4.1-flash", "max"), "opencode-go/deepseek-v4.1-flash#max");

	const piXhigh = buildWorkerArgs(
		{ harness: "pi", provider: "nan", model: "kimi-k3.1-pro:low", effort: "xhigh", permissions: "workspace" },
		"Code",
		[],
		cfg,
	);
	assert.equal(piXhigh.args[piXhigh.args.indexOf("--model") + 1], "kimi-k3.1-pro");
	assert.equal(piXhigh.args[piXhigh.args.indexOf("--thinking") + 1], "xhigh");

	const gsMed = buildWorkerArgs(
		{ harness: "gentle-shell", provider: "nan", model: "glm5.3-flash", effort: "medium", permissions: "read-only" },
		"Inspect",
		[],
		cfg,
	);
	assert.equal(gsMed.args[gsMed.args.indexOf("--thinking") + 1], "medium");

	const claudeOff = buildWorkerArgs(
		{ harness: "claude", provider: "anthropic", model: "opus", effort: "off", permissions: "read-only" },
		"Review",
		[],
		cfg,
	);
	assert.equal(claudeOff.args[claudeOff.args.indexOf("--effort") + 1], "low");

	const codexMax = buildWorkerArgs(
		{ harness: "codex", provider: "nan", model: "kimi-k3.1-pro", effort: "max", permissions: "workspace" },
		"Fix",
		[],
		cfg,
	);
	assert.ok(codexMax.args.includes('model_reasoning_effort="xhigh"'));

	const cmdcHigh = buildWorkerArgs(
		{ harness: "commandcode", model: "nan/deepseek-v4-flash", effort: "high", permissions: "workspace" },
		"Fix",
		[],
		cfg,
	);
	assert.equal(cmdcHigh.args[cmdcHigh.args.indexOf("--effort") + 1], "high");

	const mcodeHigh = buildWorkerArgs(
		{ harness: "mcode", model: "custom_provider:nan/kimi-k3.1-pro#low", effort: "high", permissions: "workspace" },
		"Fix",
		[],
		cfg,
	);
	assert.equal(mcodeHigh.args[mcodeHigh.args.indexOf("--model") + 1], "custom_provider:nan/kimi-k3.1-pro");
	assert.equal(mcodeHigh.args[mcodeHigh.args.indexOf("--effort") + 1], "high");

	const agyMed = buildWorkerArgs(
		{ harness: "antigravity", model: "gemini-4-argon-high", effort: "medium", permissions: "read-only" },
		"Audit",
		[],
		cfg,
	);
	assert.equal(agyMed.args[agyMed.args.indexOf("--effort") + 1], "medium");

	const kimiHigh = buildWorkerArgs(
		{ harness: "kimi", model: "nan/hy4", effort: "high", permissions: "workspace" },
		"Fix",
		[],
		cfg,
	);
	assert.ok(!kimiHigh.args.includes("--effort"));
	assert.equal(resolveHarnessEffortArg("kimi", "high").supported, false);

	// Input parsing & `#variant` splitting
	assert.equal(parseReasoningEffortInput("medio"), "medium");
	assert.equal(parseReasoningEffortInput("default"), undefined);
	assert.throws(() => parseReasoningEffortInput("ultra-turbo"), /Esfuerzo inválido/);

	const parsedVariant = parseModelSpec("opencode-go/deepseek-v4.1-flash#max");
	assert.equal(parsedVariant.modelId, "deepseek-v4.1-flash");
	assert.equal(parsedVariant.effortSuffix, "max");

	// Dynamic descriptions include effort cleanly without accumulating across edits
	const d1 = buildDynamicProfileDescription({
		slotName: "work-1",
		role: "Trabajo",
		rank: 1,
		harness: "opencode",
		model: "opencode-go/deepseek-v4.1-flash",
		effort: "max",
		benchmark: {
			taskId: "tb-01-log-forensics",
			resolved: true,
			regressionsClean: true,
			durationMs: 12_000,
			totalTokens: 10_000,
			score: 90,
			recommended: true,
		},
	});
	assert.match(d1, /opencode \+ opencode-go\/deepseek-v4\.1-flash · effort: max\./);
	const d2 = buildDynamicProfileDescription({
		slotName: "work-1",
		role: "Trabajo",
		rank: 1,
		existingDescription: d1,
		harness: "pi",
		provider: "nan",
		model: "kimi-k3.1-pro",
		effort: "low",
	});
	assert.doesNotMatch(d2, /deepseek|tb-01|effort: max/i);
	assert.match(d2, /pi \+ kimi-k3\.1-pro \(nan\) · effort: low\./);
});

test("inspectProfileEffort reads local CLI default configs, #variant suffixes, and OpenCode model capabilities", () => {
	const fakeHome = mkdtempSync(join(tmpdir(), "idu-effort-home-"));
	try {
		mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
		mkdirSync(join(fakeHome, ".claude"), { recursive: true });
		mkdirSync(join(fakeHome, ".codex"), { recursive: true });
		mkdirSync(join(fakeHome, ".commandcode"), { recursive: true });
		mkdirSync(join(fakeHome, ".config", "opencode"), { recursive: true });
		mkdirSync(join(fakeHome, ".cache", "opencode"), { recursive: true });

		writeFileSync(join(fakeHome, ".pi", "agent", "settings.json"), JSON.stringify({ defaultThinkingLevel: "medium" }), "utf8");
		writeFileSync(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({ model: "opus", modelSettings: { "claude-opus-5-5": { effortLevel: "high" } } }),
			"utf8",
		);
		writeFileSync(join(fakeHome, ".codex", "config.toml"), 'model = "gpt-6.2-sol"\nmodel_reasoning_effort = "xhigh"\n', "utf8");
		writeFileSync(
			join(fakeHome, ".commandcode", "config.json"),
			JSON.stringify({ reasoningEffort: { "nan/deepseek-v4-flash": "max" } }),
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".config", "opencode", "opencode.jsonc"),
			'{\n  // user default agent\n  "agent": { "build": { "variant": "" } }\n}\n',
			"utf8",
		);
		writeFileSync(
			join(fakeHome, ".cache", "opencode", "models.json"),
			JSON.stringify({
				"opencode-go": {
					models: {
						"deepseek-v4.1-flash": {
							reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
						},
					},
				},
			}),
			"utf8",
		);

		const piDef = inspectProfileEffort({ harness: "pi", provider: "nan", model: "deepseek-v4-flash" }, fakeHome);
		assert.equal(piDef.source, "cli-default");
		assert.equal(piDef.effective, "medium");
		assert.equal(piDef.badge, "~med");

		const claudeDef = inspectProfileEffort({ harness: "claude", provider: "anthropic", model: "opus" }, fakeHome);
		assert.equal(claudeDef.effective, "high");
		assert.equal(claudeDef.badge, "~high");

		const codexDef = inspectProfileEffort({ harness: "codex", provider: "nan", model: "kimi-k3.1-pro" }, fakeHome);
		assert.equal(codexDef.effective, "xhigh");
		assert.equal(codexDef.badge, "~xhigh");

		const cmdcDef = inspectProfileEffort({ harness: "commandcode", model: "nan/deepseek-v4-flash" }, fakeHome);
		assert.equal(cmdcDef.effective, "max");
		assert.equal(cmdcDef.badge, "~max");

		const ocModel = inspectProfileEffort({ harness: "opencode", model: "opencode-go/deepseek-v4.1-flash" }, fakeHome);
		assert.equal(ocModel.source, "unknown-default");
		assert.deepEqual(ocModel.advertisedModelLevels, ["low", "high", "max"]);
		assert.match(ocModel.detail, /low\/high\/max/);

		const ocSuffix = inspectProfileEffort({ harness: "opencode", provider: "nan", model: "mimo-v2.6-flash#high" }, fakeHome);
		assert.equal(ocSuffix.source, "model-suffix");
		assert.equal(ocSuffix.effective, "high");
		assert.equal(ocSuffix.badge, "HIGH");
	} finally {
		rmSync(fakeHome, { recursive: true, force: true });
	}
});

test("CLI `idu-pi fleet set-agent <slot> --effort` updates and clears effort without needing --model", () => {
	withIsolatedIduHome(({ iduHome }) => {
		writeFileSync(
			join(iduHome, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-1": { harness: "opencode", model: "opencode-go/deepseek-v4.1-flash", permissions: "workspace" },
				},
			}),
			"utf8",
		);

		const runCli = (args: string[]) =>
			spawnSync(process.execPath, [CLI_PATH, ...args], {
				encoding: "utf8",
				env: { ...process.env, IDU_HOME: iduHome },
			});

		const setMax = runCli(["fleet", "set-agent", "work-1", "--effort", "max", "--json"]);
		assert.equal(setMax.status, 0, setMax.stderr);
		const afterMax = JSON.parse(readFileSync(join(iduHome, "profiles.json"), "utf8")) as {
			profiles: Record<string, { effort?: string; description?: string }>;
		};
		assert.equal(afterMax.profiles["work-1"].effort, "max");
		assert.match(afterMax.profiles["work-1"].description ?? "", /effort: max/);

		const clearRes = runCli(["fleet", "set-agent", "work-1", "--effort", "default", "--json"]);
		assert.equal(clearRes.status, 0, clearRes.stderr);
		const afterClear = JSON.parse(readFileSync(join(iduHome, "profiles.json"), "utf8")) as {
			profiles: Record<string, { effort?: string; description?: string }>;
		};
		assert.equal(afterClear.profiles["work-1"].effort, undefined);
		assert.doesNotMatch(afterClear.profiles["work-1"].description ?? "", /effort: max/);
	});
});
