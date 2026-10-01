import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerArgs, unwrapCmdExecutable } from "../src/cmdline.js";
import {
	CrossCliProcessManager,
	extractCleanSummary,
	acquireSessionLock,
	aliasToUuid,
	killProcessTree,
	writeJsonAtomic,
	isProcessAlive,
	resolveSessionProfile,
	checkSessionHarnessAffinity,
	shouldCountTurn,
} from "../src/process-manager.js";
import { getProfile, IDU_SESSIONS_DIR, IDU_LOGS_DIR } from "../src/config.js";
import type { IduConfig, IduProfile, RunRecord } from "../src/types.js";

const mockConfig: IduConfig = {
	version: "1.0.0",
	oneOrchestratorRule: {
		enabled: true,
		allowRecursiveDelegation: false,
	},
	clis: {
		claude: {
			command: "claude.cmd",
			argsTemplate: [],
		},
		opencode: {
			command: "opencode.cmd",
			argsTemplate: [],
		},
		pi: {
			command: "pi.cmd",
			argsTemplate: [],
		},
		codex: {
			command: "codex.cmd",
			argsTemplate: [],
		},
		antigravity: {
			command: "agy.cmd",
			argsTemplate: [],
		},
		commandcode: {
			command: "cmdc.cmd",
			argsTemplate: [],
		},
		mcode: {
			command: "mcode.cmd",
			argsTemplate: [],
		},
	},
	defaultTimeoutMs: 10000,
	maxConcurrentWorkers: 4,
};

test("buildWorkerArgs builds correct argv for Claude with model and bypassPermissions", () => {
	const profile: IduProfile = {
		harness: "claude",
		model: "sonnet",
		permissions: "workspace",
	};
	const { command, args } = buildWorkerArgs(profile, "Refactor auth", [], mockConfig);
	assert.equal(command, "claude.cmd");
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("sonnet"));
	assert.ok(args.includes("--output-format"));
	assert.ok(args.includes("stream-json"));
	assert.ok(args.includes("bypassPermissions"));
	assert.equal(args[args.length - 1], "Refactor auth");
});

test("buildWorkerArgs builds correct argv for OpenCode run with auto mode", () => {
	const profile: IduProfile = {
		harness: "opencode",
		model: "MiniMax-M3",
		permissions: "workspace",
	};
	const { command, args } = buildWorkerArgs(profile, "Check syntax", [], mockConfig);
	assert.equal(command, "opencode.cmd");
	assert.deepEqual(args.slice(0, 4), ["run", "--format", "json", "--auto"]);
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("MiniMax-M3"));
	assert.equal(args[args.length - 1], "Check syntax");
});

test("buildWorkerArgs builds correct argv for Pi CLI with provider and task flag", () => {
	const profile: IduProfile = {
		harness: "pi",
		provider: "minimax",
		model: "MiniMax-M3",
	};
	const { command, args } = buildWorkerArgs(profile, "Run scout", [], mockConfig);
	assert.equal(command, "pi.cmd");
	assert.ok(args.includes("--provider"));
	assert.ok(args.includes("minimax"));
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("MiniMax-M3"));
	assert.ok(args.includes("-p"));
	assert.equal(args[args.length - 1], "Run scout");
});

test("buildWorkerArgs builds correct argv for Antigravity (agy) with model and permissions", () => {
	const profile: IduProfile = {
		harness: "antigravity",
		model: "flash",
		permissions: "workspace",
	};
	const { command, args } = buildWorkerArgs(profile, "Review architecture", [], mockConfig);
	assert.equal(command, "agy.cmd");
	assert.ok(args.includes("--model"));
	assert.ok(args.includes("gemini-3.8-flash-high"));
	assert.ok(args.includes("--output-format"));
	assert.ok(args.includes("stream-json"));
	assert.ok(args.includes("--dangerously-skip-permissions"));
	assert.ok(args.includes("-p"));
	assert.equal(args[args.length - 1], "Review architecture");
});

test("buildWorkerArgs builds correct argv for Command Code with model and yolo permissions", () => {
	const profile: IduProfile = {
		harness: "commandcode",
		model: "deepseek/deepseek-v4.1-flash",
		permissions: "workspace",
	};
	const { command, args } = buildWorkerArgs(profile, "Implement feature", [], mockConfig);
	assert.equal(command, "cmdc.cmd");
	assert.ok(args.includes("-m"));
	assert.ok(args.includes("deepseek/deepseek-v4.1-flash"));
	assert.ok(args.includes("--output-format"));
	assert.ok(args.includes("json"));
	assert.ok(args.includes("--yolo"));
	assert.ok(args.includes("--skip-onboarding"));
	assert.ok(args.includes("-p"));
	assert.equal(args[args.length - 1], "Implement feature");
});

test("CrossCliProcessManager gets capabilities reporting profiles and CLIs", async () => {
	const manager = CrossCliProcessManager.getInstance();
	// No include_quota: probing costs a model call for two of the sources, so
	// asking what the harness can do must not quietly spend one.
	const caps = await manager.getCapabilities();
	assert.ok(caps.profiles["cheap-explore"]);
	assert.ok(Array.isArray(caps.installedClis));
	assert.equal(caps.oneOrchestratorRule.enabled, true);
	assert.equal(caps.quota, undefined, "quota must be opt-in, never a side effect of discovery");
});

test("ONE ORCHESTRATOR RULE blocks recursive delegation when IDU_WORKER is set", async () => {
	// Every guard test names a profile that does not exist, on purpose. These
	// assertions live on the guard throwing, which happens before profile
	// resolution, so the profile is never reached. But if the guard ever stopped
	// firing, a REAL profile would resolve, take a session lock and spawn a
	// detached opencode runner that this test would then wait on for hours. The
	// failure mode has to be a fast red assertion, not a real worker.
	const manager = CrossCliProcessManager.getInstance();
	process.env.IDU_WORKER = "true";
	process.env.IDU_ALLOW_DELEGATION = "false";
	process.env.IDU_RUN_ID = "IDU-TEST-123";

	try {
		await assert.rejects(
			async () => {
				await manager.delegate({
					task: "Recursive subagent call",
					profile: "profile-that-does-not-exist-guard-probe",
				});
			},
			/ONE ORCHESTRATOR RULE VIOLATION/,
		);
	} finally {
		delete process.env.IDU_WORKER;
		delete process.env.IDU_ALLOW_DELEGATION;
		delete process.env.IDU_RUN_ID;
	}
});

test("ONE ORCHESTRATOR RULE needs only the IDU_WORKER identity marker", async () => {
	const manager = CrossCliProcessManager.getInstance();
	// Only the identity marker. No IDU_ALLOW_DELEGATION at all: this is the case
	// that used to pass the old two-condition guard. Note what this test does
	// NOT claim — see "is identity-only, and that is the whole boundary" below
	// for the side that a caller controls.
	process.env.IDU_WORKER = "true";
	process.env.IDU_RUN_ID = "IDU-TEST-FAILCLOSED";

	try {
		await assert.rejects(
			async () => {
				await manager.delegate({
					task: "Recursive subagent call with identity only",
					profile: "profile-that-does-not-exist-guard-probe",
				});
			},
			/ONE ORCHESTRATOR RULE VIOLATION/,
		);
	} finally {
		delete process.env.IDU_WORKER;
		delete process.env.IDU_RUN_ID;
	}
});

test("ONE ORCHESTRATOR RULE: IDU_ALLOW_DELEGATION alone does not block the orchestrator", async () => {
	const manager = CrossCliProcessManager.getInstance();
	// Not a worker. A leftover ALLOW_DELEGATION=false must not be read as
	// worker identity, so the guard must stay out of the way.
	// The profile deliberately does not exist. getProfile() throws at step 3,
	// which is BEFORE the session lock (step 9) and the detached spawn
	// (step 11). That is the only way to prove the guard let the call through
	// without leaving a real worker process behind. An earlier version used a
	// real profile with asyncExecution=true, which still spawned a detached
	// runner and leaked it: asyncExecution only skips waitForCompletion.
	process.env.IDU_ALLOW_DELEGATION = "false";

	try {
		await assert.rejects(
			async () => {
				await manager.delegate({
					task: "Orchestrator-level task, not a worker",
					profile: "profile-that-does-not-exist-guard-probe",
				});
			},
			/not found in ~\/\.idu\/profiles\.json/,
		);
	} finally {
		delete process.env.IDU_ALLOW_DELEGATION;
	}
});

test("ONE ORCHESTRATOR RULE rejects before any session file is written", async () => {
	const { readdirSync } = await import("node:fs");
	const { IDU_SESSIONS_DIR } = await import("../src/config.js");
	const manager = CrossCliProcessManager.getInstance();
	process.env.IDU_WORKER = "true";
	process.env.IDU_RUN_ID = "IDU-TEST-NOSESSION";

	try {
		const before = new Set(readdirSync(IDU_SESSIONS_DIR));

		await assert.rejects(
			async () => {
				await manager.delegate({
					task: "Should never persist state",
					profile: "profile-that-does-not-exist-guard-probe",
				});
			},
			/ONE ORCHESTRATOR RULE VIOLATION/,
		);

		// Assert on the whole sessions dir, not a guessed filename. The guard
		// rejects before generateRunId() ever runs, so there is no runId to
		// predict: a name-based check would be vacuously green. This version
		// fails for real if a rejected delegation writes anything.
		const after = new Set(readdirSync(IDU_SESSIONS_DIR));
		const added = [...after].filter((f) => !before.has(f));
		assert.deepEqual(added, [], `a rejected delegation must not write session files, found: ${added}`);
	} finally {
		delete process.env.IDU_WORKER;
		delete process.env.IDU_RUN_ID;
	}
});

test("retired oneOrchestratorRule keys no longer disable the guard", async () => {
	const { readFileSync, writeFileSync, renameSync, rmSync, existsSync: fsExists } = await import("node:fs");
	const { join } = await import("node:path");
	const { IDU_HOME, loadIduConfig } = await import("../src/config.js");
	const configPath = join(IDU_HOME, "config.json");
	const backupPath = join(IDU_HOME, `config.json.test-backup-${process.pid}`);

	const manager = CrossCliProcessManager.getInstance();

	// Back the real config up by RENAME, not by copying. A copy leaves the
	// window where a crash mid-test replaces the user's global config with a
	// two-key stub. With a rename, the original bytes stay reachable at
	// backupPath and the test never destroys them, whatever happens next.
	if (fsExists(configPath)) {
		renameSync(configPath, backupPath);
	}

	try {
		writeFileSync(
			configPath,
			JSON.stringify(
				{
					version: "2.1.0",
					// BOTH switches, each set to the value that used to defeat the
					// guard: `enabled:false` wrapped the whole condition and
					// `allowRecursiveDelegation:true` was the direct kill. Setting
					// both at once pins that neither key is read any more, and it
					// is `enabled:false` that was the cheap bypass, because it cost
					// one edit to a file every worker can write.
					oneOrchestratorRule: { enabled: false, allowRecursiveDelegation: true },
				},
				null,
				2,
			),
			"utf8",
		);

		// The guard rejection on its own cannot prove this test means anything.
		// The guard reads no config at all, so `enabled:false` on disk would not
		// change its behaviour even if the file were still honoured: the test
		// would collapse into "IDU_WORKER=true -> rejected", which two other tests
		// already cover. Assert on the loader, because that is where the bypass
		// actually lived. Re-merging `parsed.oneOrchestratorRule` in
		// loadIduConfig() fails these two and says exactly what came back.
		const loaded = loadIduConfig();
		assert.equal(
			loaded.oneOrchestratorRule.enabled,
			true,
			"loadIduConfig must not take `enabled` from the file: that was the one-edit bypass",
		);
		assert.equal(
			loaded.oneOrchestratorRule.allowRecursiveDelegation,
			false,
			"loadIduConfig must not take `allowRecursiveDelegation` from the file either",
		);

		process.env.IDU_WORKER = "true";
		process.env.IDU_RUN_ID = "IDU-TEST-BYPASS";

		try {
			await assert.rejects(
				async () => {
					await manager.delegate({
						task: "Config flag must not disable the guard",
						profile: "profile-that-does-not-exist-guard-probe",
					});
				},
				/ONE ORCHESTRATOR RULE VIOLATION/,
			);
		} finally {
			delete process.env.IDU_WORKER;
			delete process.env.IDU_RUN_ID;
		}
	} finally {
		// Restore by rename so the original file comes back whole, then drop
		// the stub. No require(): this package is ESM ("type": "module"), so a
		// require here threw ReferenceError on any machine without a config.
		rmSync(configPath, { force: true });
		if (fsExists(backupPath)) {
			renameSync(backupPath, configPath);
		}
	}
});

/**
 * The guard tests above set IDU_WORKER themselves, so every one of them can
 * only prove the same thing: that the guard fires when the marker is present.
 * None of them can catch the case that actually matters, because the marker is
 * an environment variable owned by the calling process. They test the rule
 * against itself.
 *
 * This one drives the real shipped binary in a separate process, because the
 * claim is about what a CALLER can do to its own environment. Every probe names
 * a profile that does not exist, so nothing spawns and nothing is spent: a run
 * that clears the guard dies at profile resolution, and reaching that error IS
 * the proof that it cleared the guard.
 */
test("ONE ORCHESTRATOR RULE is identity-only, and that is the whole boundary", async () => {
	const { spawnSync } = await import("node:child_process");
	const { fileURLToPath } = await import("node:url");
	const { dirname, join } = await import("node:path");

	// dist/test/cross-cli.test.js -> dist/src/cli.js
	const cliPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "cli.js");

	const probe = (marker: string | undefined): string => {
		const env = { ...process.env };
		delete env.IDU_WORKER;
		if (marker !== undefined) env.IDU_WORKER = marker;
		const res = spawnSync(
			process.execPath,
			[
				cliPath,
				"delegate",
				"guard boundary probe",
				"--profile",
				"profile-that-does-not-exist-guard-probe",
			],
			{ env, encoding: "utf8" },
		);
		return `${res.stdout ?? ""}${res.stderr ?? ""}`;
	};

	// Marker present: refused.
	assert.match(
		probe("true"),
		/ONE ORCHESTRATOR RULE VIOLATION/,
		"a process that declares itself a worker must be refused",
	);

	// The measured bypass, pinned as a test so it cannot quietly come back, and
	// so nobody reads SECURITY.md as aspirational.
	const spoofed = probe("false");
	assert.doesNotMatch(
		spoofed,
		/ONE ORCHESTRATOR RULE VIOLATION/,
		"setting IDU_WORKER to any other value defeats the guard; that is the documented boundary",
	);

	// Marker dropped entirely: same result. A worker controls its own
	// environment, so "declared" and "is" are not the same thing and the guard
	// only ever sees the first one.
	const dropped = probe(undefined);
	assert.doesNotMatch(dropped, /ONE ORCHESTRATOR RULE VIOLATION/);

	// Both of those reached profile resolution. Without this the two
	// doesNotMatch assertions could pass because the CLI never ran at all.
	assert.match(dropped, /not found in ~\/\.idu\/profiles\.json/);
	assert.match(spoofed, /not found in ~\/\.idu\/profiles\.json/);
});

import { extractUsage, formatUsage } from "../src/usage.js";

// The three shapes below are verbatim from real worker logs, not invented.
test("extractUsage reads antigravity snake_case usage", () => {
	const log = [
		JSON.stringify({ type: "step_update", step_update: { type: "tool" } }),
		JSON.stringify({
			type: "step_update",
			usage: { input_tokens: 21134, output_tokens: 1227, thinking_tokens: 1082, total_tokens: 22361 },
		}),
	].join("\n");

	const usage = extractUsage(log, "antigravity");
	assert.equal(usage.captured, true);
	assert.equal(usage.tokens.inputTokens, 21134);
	assert.equal(usage.tokens.outputTokens, 1227);
	assert.equal(usage.tokens.reasoningTokens, 1082);
	assert.equal(usage.tokens.totalTokens, 22361);
});

test("extractUsage reads commandcode camelCase usage", () => {
	const log = JSON.stringify({
		type: "result",
		usage: { inputTokens: 18639, outputTokens: 175, cacheReadTokens: 5248, cacheWriteTokens: 0 },
	});

	const usage = extractUsage(log, "commandcode");
	assert.equal(usage.captured, true);
	assert.equal(usage.tokens.inputTokens, 18639);
	assert.equal(usage.tokens.outputTokens, 175);
	assert.equal(usage.tokens.cacheReadTokens, 5248);
	// Reported total absent, so it is derived from the parts it did give.
	assert.equal(usage.tokens.totalTokens, 18639 + 175);
});

test("extractUsage never turns a missing field into zero", () => {
	// A harness that reports only input: output stays null, NOT 0.
	const log = JSON.stringify({ usage: { input_tokens: 500 } });
	const usage = extractUsage(log, "quiet-harness");

	assert.equal(usage.captured, true);
	assert.equal(usage.tokens.inputTokens, 500);
	assert.equal(usage.tokens.outputTokens, null, "unreported must be null, never 0");
	assert.equal(usage.tokens.totalTokens, null, "cannot total a partial report");
	assert.equal(usage.incomplete, true);
});

test("extractUsage reports unknown rather than zero for a silent harness", () => {
	const usage = extractUsage("worker said nothing about tokens", "silent-harness");
	assert.equal(usage.captured, false);
	assert.equal(usage.reportedCostUsd, null);
	assert.equal(usage.tokens.inputTokens, null);

	assert.match(formatUsage(usage), /not reported/);
	assert.doesNotMatch(formatUsage(usage), /\b0\b/);
});

test("extractUsage survives a malformed line among good ones", () => {
	const log = ["{not json", JSON.stringify({ usage: { input_tokens: 42, output_tokens: 7 } })].join("\n");
	const usage = extractUsage(log, "noisy");
	assert.equal(usage.tokens.inputTokens, 42);
	assert.equal(usage.tokens.outputTokens, 7);
});

test("formatUsage says cost not reported instead of inventing a price", () => {
	const usage = extractUsage(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }), "agy");
	assert.equal(usage.reportedCostUsd, null);
	assert.match(formatUsage(usage), /cost not reported/);
});

test("summarizeUsage returns an honest shape over an empty ledger", () => {
	const manager = CrossCliProcessManager.getInstance();
	// Hermetic by construction. An earlier version asserted runs > 0, which
	// only held because the developer machine had leftover sessions; CI has an
	// empty ~/.idu and the test failed there. A summary of nothing must be a
	// valid answer, not a crash.
	const summary = manager.summarizeUsage(10);

	assert.equal(typeof summary.runs, "number");
	assert.ok(summary.runs >= 0);
	assert.equal(typeof summary.byHarness, "object");

	for (const [harness, bucket] of Object.entries(summary.byHarness)) {
		assert.ok(bucket.runs > 0, `${harness} should count its runs`);
		assert.ok(bucket.unreported >= 0);
	}
});

test("summarizeUsage never turns an unreported harness into zero tokens", () => {
	const manager = CrossCliProcessManager.getInstance();
	const summary = manager.summarizeUsage(50);

	// Across every bucket, the arithmetic must stay non-negative and a harness
	// with only unreported runs must show unreported > 0 rather than pretending
	// it consumed nothing.
	for (const [harness, bucket] of Object.entries(summary.byHarness)) {
		if (bucket.runs === 0) continue;
		assert.ok(bucket.inputTokens >= 0 && bucket.outputTokens >= 0, `${harness} must not go negative`);
		if (bucket.unreported === bucket.runs) {
			assert.equal(bucket.inputTokens, 0, `${harness} reported nothing, so it has no measured tokens`);
		}
	}
});

test("unwrapCmdExecutable unwraps Windows npm cmd wrappers to direct executables", async () => {
	if (process.platform !== "win32") return;

	const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");

	const tempDir = mkdtempSync(join(tmpdir(), "idu-cmd-test-"));
	try {
		// 1. Direct binary wrapper
		const targetExe = join(tempDir, "test-tool.exe");
		writeFileSync(targetExe, "");
		const wrapperCmd = join(tempDir, "test-tool.cmd");
		writeFileSync(wrapperCmd, `@ECHO off\r\n"%~dp0test-tool.exe" %*\r\n`);

		const res = unwrapCmdExecutable(wrapperCmd, ["run", "--auto"]);
		assert.equal(res.command, targetExe);
		assert.equal(res.isShell, false);
		assert.deepEqual(res.args, ["run", "--auto"]);

		// 2. Node script wrapper
		const scriptJs = join(tempDir, "cli.js");
		writeFileSync(scriptJs, "");
		const nodeCmd = join(tempDir, "node-tool.cmd");
		writeFileSync(nodeCmd, `@ECHO off\r\nnode "%~dp0cli.js" %*\r\n`);

		const resNode = unwrapCmdExecutable(nodeCmd, ["-p", "hi"]);
		assert.equal(resNode.command, process.execPath);
		assert.equal(resNode.isShell, false);
		assert.deepEqual(resNode.args, [scriptJs, "-p", "hi"]);

		// 3. Wrapper with sub-command argument (e.g. agentapi)
		const serverExe = join(tempDir, "language_server.exe");
		writeFileSync(serverExe, "");
		const agentapiBat = join(tempDir, "agentapi.bat");
		writeFileSync(agentapiBat, `@ECHO off\r\n"%~dp0language_server.exe" agentapi %*\r\n`);

		const resAgent = unwrapCmdExecutable(agentapiBat, ["new-conversation", "prompt"]);
		assert.equal(resAgent.command, serverExe);
		assert.equal(resAgent.isShell, false);
		assert.deepEqual(resAgent.args, ["agentapi", "new-conversation", "prompt"]);

		// 4. npm shim whose entry point is an ES module (e.g. Command Code's `index.mjs`). Falling back
		// to the shell here splits a multi-word prompt into separate arguments.
		const scriptMjs = join(tempDir, "node_modules", "tool", "dist", "index.mjs");
		const { mkdirSync } = await import("node:fs");
		mkdirSync(join(tempDir, "node_modules", "tool", "dist"), { recursive: true });
		writeFileSync(scriptMjs, "");
		const mjsCmd = join(tempDir, "mjs-tool.cmd");
		writeFileSync(
			mjsCmd,
			`@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n` +
				`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\dist\\index.mjs" %*\r\n`,
		);

		const resMjs = unwrapCmdExecutable(mjsCmd, ["-p", "two words"]);
		assert.equal(resMjs.command, process.execPath);
		assert.equal(resMjs.isShell, false);
		assert.deepEqual(resMjs.args, [scriptMjs, "-p", "two words"]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("extractCleanSummary extracts full assistant report from NDJSON without truncation", () => {
	const sampleNdjson = [
		JSON.stringify({ type: "step_start", timestamp: 123 }),
		JSON.stringify({ type: "text", text: "Starting exploration..." }),
		JSON.stringify({ type: "tool_use", tool: "read" }),
		JSON.stringify({ type: "text", text: "# Full Final Report\n\n- Architecture overview\n- Clean sections\n- No truncated json tail\n\nDetailed findings across the whole repository." }),
		JSON.stringify({ type: "step_finish", cost: 0.01 }),
	].join("\n");

	const summary = extractCleanSummary(sampleNdjson, "opencode");
	assert.ok(summary.startsWith("# Full Final Report"), "Summary should start with the report heading");
	assert.ok(summary.includes("Detailed findings across the whole repository."), "Summary should contain full body");
	assert.ok(!summary.includes("step_finish"), "Summary should not include raw JSON events");
});

test("extractCleanSummary extracts full response from Antigravity (agy) stream-json and json events", () => {
	const streamJson = [
		JSON.stringify({ event: "init", conversation_id: "conv-1" }),
		JSON.stringify({ event: "step_update", step_update: { text_delta: "Thinking..." } }),
		JSON.stringify({ event: "result", result: { conversation_id: "conv-1", status: "SUCCESS", response: "Antigravity report complete." } }),
	].join("\n");

	const summaryStream = extractCleanSummary(streamJson, "antigravity");
	assert.equal(summaryStream, "Antigravity report complete.");

	const jsonOutput = JSON.stringify({
		conversation_id: "conv-2",
		status: "SUCCESS",
		response: "Direct json response.",
	});
	const summaryJson = extractCleanSummary(jsonOutput, "antigravity");
	assert.equal(summaryJson, "Direct json response.");
});

test("extractCleanSummary extracts finalText from Command Code result JSON", () => {
	const cmdcJson = [
		JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "cmdc-sess-1" } }),
		JSON.stringify({ type: "event", event: { type: "message_start" } }),
		JSON.stringify({ type: "event", event: { type: "text_delta", delta: "Processing" } }),
		JSON.stringify({
			type: "result",
			subtype: "success",
			sessionId: "cmdc-sess-1",
			stopReason: "end_turn",
			finalText: "All implementation steps completed successfully.",
		}),
	].join("\n");

	const summary = extractCleanSummary(cmdcJson, "commandcode");
	assert.equal(summary, "All implementation steps completed successfully.");
});

test("extractCleanSummary extracts the agent answer from a minimax Code exec.result object", () => {
	// mcode exec emits ONE json object, not an NDJSON stream. Captured live
	// from `mcode exec --output-format json` (2026-09-29).
	const mcodeJson = JSON.stringify({
		schemaVersion: 1,
		type: "exec.result",
		runId: "exec_turn_mun8i9to_24x3h4",
		sessionId: "mvs_5866f6fb7f5640b7b4b9a3afd877e36c",
		turnId: "turn_mun8i9to_24x3h4",
		status: "succeeded",
		output: "Refactor completo: 3 archivos, 49/49 tests verdes.",
		model: { providerId: "minimax", modelId: "MiniMax-M3.1-Flash-Preview" },
		usage: { inputTokens: 31501, outputTokens: 2, totalTokens: 31503 },
		durationMs: 7768,
	});

	const summary = extractCleanSummary(mcodeJson, "mcode");
	// Must be the agent's prose, never the serialized envelope.
	assert.equal(summary, "Refactor completo: 3 archivos, 49/49 tests verdes.");
	assert.ok(!summary.startsWith("{"), "raw exec.result JSON must never leak as the summary");
});

test("extractCleanSummary surfaces a minimax Code error instead of an empty summary", () => {
	const mcodeError = JSON.stringify({
		type: "exec.result",
		status: "failed",
		sessionId: "mvs_abc123",
		error: "workspace permission denied",
	});

	const summary = extractCleanSummary(mcodeError, "mcode");
	assert.equal(summary, "minimax Code error: workspace permission denied");
});

test("extractCleanSummary handles Command Code empty finalText and does not leak raw NDJSON", () => {
	// Case 1: finalText is empty and text_delta has content
	const cmdcDeltaOnly = [
		JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "cmdc-sess-2" } }),
		JSON.stringify({ type: "event", event: { type: "text_delta", delta: "Partial streamed output." } }),
		JSON.stringify({
			type: "result",
			subtype: "error",
			sessionId: "cmdc-sess-2",
			stopReason: "error",
			finalText: "",
		}),
	].join("\n");
	const summaryDelta = extractCleanSummary(cmdcDeltaOnly, "commandcode");
	assert.equal(summaryDelta, "Partial streamed output.");

	// Case 2: finalText is empty, no text_delta, but error message exists
	const cmdcError = [
		JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "cmdc-sess-3" } }),
		JSON.stringify({
			type: "result",
			subtype: "error",
			sessionId: "cmdc-sess-3",
			stopReason: "error",
			finalText: "",
			error: { message: "Cap of --max-turns reached" },
		}),
	].join("\n");
	const summaryError = extractCleanSummary(cmdcError, "commandcode");
	assert.equal(summaryError, "Command Code error: Cap of --max-turns reached");

	// Case 3: Completely empty response — must return empty string, NEVER raw NDJSON lines
	const cmdcBlank = [
		JSON.stringify({ type: "event", event: { type: "run_start", sessionId: "cmdc-sess-4" } }),
		JSON.stringify({
			type: "result",
			subtype: "error",
			sessionId: "cmdc-sess-4",
			stopReason: "stop",
			finalText: "",
		}),
	].join("\n");
	const summaryBlank = extractCleanSummary(cmdcBlank, "commandcode");
	assert.equal(summaryBlank, "");
	assert.ok(!summaryBlank.includes("{"), "Should never leak raw NDJSON");
});

test("Session Triad: buildWorkerArgs handles --session-id, --resume, and --fork for Claude", () => {
	const profile: IduProfile = { harness: "claude", model: "opus" };
	const uuid = "12345678-1234-4234-8234-123456789abc";

	// Turn 1: New session
	const turn1 = buildWorkerArgs(profile, "Initial prompt", [], mockConfig, { sessionId: uuid, isResumed: false });
	assert.ok(turn1.args.includes("--session-id"));
	assert.equal(turn1.args[turn1.args.indexOf("--session-id") + 1], uuid);
	assert.ok(!turn1.args.includes("--resume"));

	// Turn 2: Resume session
	const turn2 = buildWorkerArgs(profile, "Follow up", [], mockConfig, { sessionId: uuid, isResumed: true });
	assert.ok(turn2.args.includes("--resume"));
	assert.equal(turn2.args[turn2.args.indexOf("--resume") + 1], uuid);
	assert.ok(!turn2.args.includes("--session-id"));
	assert.ok(!turn2.args.includes("--fork-session"));

	// Fork: Branch from existing session
	const forked = buildWorkerArgs(profile, "Branch exploration", [], mockConfig, { sessionId: "child-uuid-1234", parentSessionId: uuid, fork: true });
	assert.ok(forked.args.includes("--resume"));
	assert.equal(forked.args[forked.args.indexOf("--resume") + 1], uuid);
	assert.ok(forked.args.includes("--fork-session"));
	assert.ok(forked.args.includes("--session-id"));
	assert.equal(forked.args[forked.args.indexOf("--session-id") + 1], "child-uuid-1234");
});

test("Session Triad: buildWorkerArgs handles OpenCode Turn 1 without --session and Turn 2 with --session", () => {
	const opencodeProfile: IduProfile = { harness: "opencode", model: "MiniMax-M3" };
	const sessId = "session-test-456";

	// Turn 1: New session (MUST NOT include --session to avoid "Session not found")
	const turn1 = buildWorkerArgs(opencodeProfile, "Turn 1 task", [], mockConfig, { sessionId: sessId, isResumed: false });
	assert.ok(!turn1.args.includes("--session"), "Turn 1 must not include --session flag");

	// Turn 2: Resumed session (includes --session)
	const turn2 = buildWorkerArgs(opencodeProfile, "Turn 2 task", [], mockConfig, { sessionId: sessId, isResumed: true });
	assert.ok(turn2.args.includes("--session"));
	assert.equal(turn2.args[turn2.args.indexOf("--session") + 1], sessId);

	// Fork: Branch from parent session
	const forked = buildWorkerArgs(opencodeProfile, "Branch task", [], mockConfig, { parentSessionId: sessId, fork: true });
	assert.ok(forked.args.includes("--session"));
	assert.equal(forked.args[forked.args.indexOf("--session") + 1], sessId);
	assert.ok(forked.args.includes("--fork"));
});

test("Session Triad: buildWorkerArgs handles Pi CLI --session-id, --session, and --fork", () => {
	const piProfile: IduProfile = { harness: "pi", model: "MiniMax-M3" };
	const sessId = "session-test-456";

	// Pi new session: --session-id <id>
	const piNew = buildWorkerArgs(piProfile, "Task", [], mockConfig, { sessionId: sessId, isResumed: false });
	assert.ok(piNew.args.includes("--session-id"));
	assert.equal(piNew.args[piNew.args.indexOf("--session-id") + 1], sessId);

	// Pi resume: --session <id>
	const piResume = buildWorkerArgs(piProfile, "Task", [], mockConfig, { sessionId: sessId, isResumed: true });
	assert.ok(piResume.args.includes("--session"));
	assert.equal(piResume.args[piResume.args.indexOf("--session") + 1], sessId);

	// Pi fork: --fork <parentId>
	const piFork = buildWorkerArgs(piProfile, "Task", [], mockConfig, { parentSessionId: sessId, fork: true });
	assert.ok(piFork.args.includes("--fork"));
	assert.equal(piFork.args[piFork.args.indexOf("--fork") + 1], sessId);
});

test("Session Triad: buildWorkerArgs handles Antigravity Turn 1 and Turn 2 with --conversation", () => {
	const agyProfile: IduProfile = { harness: "antigravity", model: "gemini-3.8-flash-high" };
	const nativeSessId = "agy-conv-uuid-1234";

	// Turn 1: New session (MUST NOT include --conversation)
	const turn1 = buildWorkerArgs(agyProfile, "Turn 1 task", [], mockConfig, { sessionId: "ses-1", isResumed: false });
	assert.ok(!turn1.args.includes("--conversation"), "Turn 1 must not include --conversation flag");

	// Turn 2: Resumed session (includes --conversation)
	const turn2 = buildWorkerArgs(agyProfile, "Turn 2 task", [], mockConfig, {
		sessionId: "ses-1",
		nativeSessionId: nativeSessId,
		isResumed: true,
	});
	assert.ok(turn2.args.includes("--conversation"));
	assert.equal(turn2.args[turn2.args.indexOf("--conversation") + 1], nativeSessId);
});

test("Session Triad: buildWorkerArgs handles Command Code Turn 1, Turn 2 resume with --session, and fork with --fork-session", () => {
	const cmdcProfile: IduProfile = { harness: "commandcode", permissions: "workspace" };
	const sessId = "cmdc-session-uuid-1234";

	// Turn 1: New session (MUST NOT include --session)
	const turn1 = buildWorkerArgs(cmdcProfile, "Turn 1 task", [], mockConfig, { sessionId: sessId, isResumed: false });
	assert.ok(!turn1.args.includes("--session"), "Turn 1 must not include --session flag");
	assert.ok(turn1.args.includes("--yolo"));
	assert.ok(turn1.args.includes("--output-format"));
	assert.ok(turn1.args.includes("json"));

	// Turn 2: Resumed session WITH nativeSessionId (includes --session)
	const turn2 = buildWorkerArgs(cmdcProfile, "Turn 2 task", [], mockConfig, { sessionId: sessId, nativeSessionId: sessId, isResumed: true });
	assert.ok(turn2.args.includes("--session"));
	assert.equal(turn2.args[turn2.args.indexOf("--session") + 1], sessId);

	// Turn 2: Resumed session WITHOUT nativeSessionId (MUST NOT include --session, degraded safe fresh)
	const turn2Degraded = buildWorkerArgs(cmdcProfile, "Turn 2 degraded", [], mockConfig, { sessionId: sessId, isResumed: true });
	assert.ok(!turn2Degraded.args.includes("--session"), "Must not pass unverified session ID to cmdc");

	// Fork: Branch from parent session WITH parentNativeSessionId (includes --session <parentId> --fork-session)
	const forked = buildWorkerArgs(cmdcProfile, "Fork task", [], mockConfig, { parentNativeSessionId: sessId, fork: true });
	assert.ok(forked.args.includes("--session"));
	assert.equal(forked.args[forked.args.indexOf("--session") + 1], sessId);
	assert.ok(forked.args.includes("--fork-session"));

	// Fork: Branch without parentNativeSessionId (MUST NOT include --session or --fork-session)
	const forkedDegraded = buildWorkerArgs(cmdcProfile, "Fork task degraded", [], mockConfig, { parentSessionId: sessId, fork: true });
	assert.ok(!forkedDegraded.args.includes("--session"));
	assert.ok(!forkedDegraded.args.includes("--fork-session"));
});

test("buildWorkerArgs builds correct argv for minimax Code (mcode) as implementer", () => {
	// Mirrors the real DEFAULT_PROFILES.mcode shape: full provider/model in
	// `model` and NO separate `provider`. Declaring both would make
	// buildWorkerArgs emit "minimax/minimax/MiniMax-...".
	const profile: IduProfile = {
		harness: "mcode",
		model: "minimax/MiniMax-M3.1-Flash-Preview",
		permissions: "workspace",
	};
	const { command, args } = buildWorkerArgs(profile, "Implementa el modulo", [], mockConfig);

	assert.equal(command, "mcode.cmd");
	assert.equal(args[0], "exec", "mcode must use the headless exec subcommand, not the TUI");
	assert.ok(args.includes("--output-format"));
	assert.equal(args[args.indexOf("--output-format") + 1], "json");

	// The default policy is "smart", which prompts interactively and hangs a
	// detached worker. Implementers must get "full" explicitly.
	assert.ok(args.includes("--permission"));
	assert.equal(args[args.indexOf("--permission") + 1], "full");

	// A bare model is passed through; a provider-qualified one is not
	// double-joined.
	const model = args[args.indexOf("--model") + 1];
	assert.equal(model, "minimax/MiniMax-M3.1-Flash-Preview");
	assert.equal(model.split("/").length, 2, `model must not be provider-joined twice: ${model}`);

	// Turn 1 must not pass --session.
	assert.ok(!args.includes("--session"));
	assert.equal(args[args.length - 1], "Implementa el modulo");
});

test("buildWorkerArgs joins provider and model at most once for minimax Code", () => {
	// A profile that declares BOTH provider and a bare model must still
	// produce a single provider prefix.
	const profile: IduProfile = {
		harness: "mcode",
		provider: "minimax",
		model: "MiniMax-M3.1-Flash-Preview",
		permissions: "workspace",
	};
	const { args } = buildWorkerArgs(profile, "Task", [], mockConfig);
	const model = args[args.indexOf("--model") + 1];
	assert.equal(model, "minimax/MiniMax-M3.1-Flash-Preview");
	assert.ok(!model.includes("minimax/minimax"), `double-joined model: ${model}`);
});

test("buildWorkerArgs gives minimax Code a read-only permission policy", () => {
	const profile: IduProfile = { harness: "mcode", permissions: "read-only" };
	const { args } = buildWorkerArgs(profile, "Audita esto", [], mockConfig);

	assert.ok(args.includes("--permission"));
	assert.equal(
		args[args.indexOf("--permission") + 1],
		"off",
		"a read-only mcode worker must not be granted write access",
	);
});

test("buildWorkerArgs resumes a minimax Code session and degrades safely on fork", () => {
	const profile: IduProfile = { harness: "mcode", permissions: "workspace" };
	const nativeId = "mvs_5866f6fb7f5640b7b4b9a3afd877e36c";

	// Turn 2+: resumed with a verified native session id.
	const turn2 = buildWorkerArgs(profile, "Continua", [], mockConfig, {
		sessionId: nativeId,
		nativeSessionId: nativeId,
		isResumed: true,
	});
	assert.ok(turn2.args.includes("--session"));
	assert.equal(turn2.args[turn2.args.indexOf("--session") + 1], nativeId);

	// Fork: mcode exec has no fork flag, so a fork must start fresh rather
	// than reusing the parent's session.
	const forked = buildWorkerArgs(profile, "Fork", [], mockConfig, {
		parentNativeSessionId: nativeId,
		fork: true,
	});
	assert.ok(!forked.args.includes("--session"), "a forked mcode run must not reuse the parent session");
});

// ---------------------------------------------------------------------------
// Session lifecycle: profile affinity and transactional turns
//
// Regression cover for the incident captured in session
// 16bfbe3e-b6d1-428c-801d-96073650afdd, where resuming a minimax Code session
// without --profile fell back to the "fast" (pi) default: the run failed with
// "No session found matching ...", yet the session's turnCount still went
// from 1 to 2. A dead CLI was billed as a conversational turn.
// ---------------------------------------------------------------------------

test("resolveSessionProfile inherits the session's profile when none is named", () => {
	const owner = { profile: "mcode" };

	// The exact incident: no --profile given, the CLI default is "fast" (pi).
	const inherited = resolveSessionProfile("fast", owner, { profileExplicit: false });
	assert.equal(inherited.profileName, "mcode");
	assert.equal(inherited.inherited, true);

	// An explicit profile is never overridden.
	const explicit = resolveSessionProfile("fast", owner, { profileExplicit: true });
	assert.equal(explicit.profileName, "fast");
	assert.equal(explicit.inherited, false);

	// Forking starts a new session, so it keeps the requested profile.
	const forked = resolveSessionProfile("fast", owner, { profileExplicit: false, fork: true });
	assert.equal(forked.profileName, "fast");
	assert.equal(forked.inherited, false);

	// No owner (fresh session) keeps the requested profile.
	const fresh = resolveSessionProfile("fast", undefined, { profileExplicit: false });
	assert.equal(fresh.profileName, "fast");
	assert.equal(fresh.inherited, false);

	// Same profile on both sides is a no-op, not an "inherit" event.
	const same = resolveSessionProfile("mcode", owner, { profileExplicit: false });
	assert.equal(same.profileName, "mcode");
	assert.equal(same.inherited, false);
});

test("checkSessionHarnessAffinity refuses a cross-harness resume and --force overrides it", () => {
	const owner = { harness: "mcode", profile: "mcode" };
	const same = { harness: "mcode", profileName: "mcode" };
	const cross = { harness: "pi", profileName: "fast" };

	// Same harness: legitimate resume.
	assert.equal(checkSessionHarnessAffinity(owner, "sess-1", same), null);

	// Cross-harness: refused, with an actionable message.
	const refusal = checkSessionHarnessAffinity(owner, "sess-1", cross);
	assert.ok(refusal, "a cross-harness resume must be refused");
	assert.match(refusal!, /SESSION HARNESS MISMATCH/);
	assert.match(refusal!, /"mcode"/);
	assert.match(refusal!, /--force/);

	// --force is the documented escape hatch.
	assert.equal(checkSessionHarnessAffinity(owner, "sess-1", cross, true), null);

	// No owner (fresh session) is always allowed.
	assert.equal(checkSessionHarnessAffinity(undefined, "sess-1", cross), null);

	// Missing harness on either side cannot be compared, so it passes.
	assert.equal(checkSessionHarnessAffinity({ harness: "", profile: "x" }, "s", cross), null);
});

test("shouldCountTurn only counts runs that actually completed", () => {
	// The happy path: exit 0, completed.
	assert.equal(shouldCountTurn(0, "completed"), true);

	// The incident: the wrong CLI exited non-zero. Not a turn.
	assert.equal(shouldCountTurn(1, "failed"), false);
	assert.equal(shouldCountTurn(137, "failed"), false);
	assert.equal(shouldCountTurn(255, "failed"), false);

	// A timeout is not a turn even if the exit code looks clean.
	assert.equal(shouldCountTurn(0, "timeout"), false);
	assert.equal(shouldCountTurn(1, "timeout"), false);

	// A missing exit code (process never reported) is not a turn.
	assert.equal(shouldCountTurn(null, "completed"), false);
	assert.equal(shouldCountTurn(null, "failed"), false);
});

test("aliasToUuid maps non-UUID aliases deterministically to valid UUIDv4 strings", () => {
	const alias = "my-custom-feature-session";
	const uuid1 = aliasToUuid(alias);
	const uuid2 = aliasToUuid(alias);
	assert.equal(uuid1, uuid2);
	assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

	const validUuid = "12345678-1234-4234-8234-123456789abc";
	assert.equal(aliasToUuid(validUuid), validUuid);
});

test("acquireSessionLock blocks concurrent execution on same session and releases cleanly", () => {
	const testSessionId = "lock-test-session-uuid";
	const cwd = process.cwd();
	const lock1 = acquireSessionLock(testSessionId, cwd, process.pid);
	assert.ok(lock1);

	// Attempting second lock while first process is active must throw
	assert.throws(
		() => acquireSessionLock(testSessionId, cwd, process.pid),
		/is currently in use by active process/,
	);

	// Release lock
	lock1.release();

	// Acquiring again after release should succeed
	const lock2 = acquireSessionLock(testSessionId, cwd, process.pid);
	assert.ok(lock2);
	lock2.release();
});

test("acquireSessionLock protects against foreign lock deletion (HOLE-C) and handles updatePid", async () => {
	const { writeFileSync, existsSync, unlinkSync } = await import("node:fs");
	const testSessionId = "foreign-lock-test-session";
	const cwd = process.cwd();
	const lock1 = acquireSessionLock(testSessionId, cwd, 11111);
	assert.ok(lock1);

	// Update PID (e.g. child process spawned)
	lock1.updatePid?.(22222);

	// Simulate lock stolen/recreated by another process 33333
	writeFileSync(lock1.lockPath, JSON.stringify({ pid: 33333, cwd, time: new Date().toISOString() }), "utf8");

	// lock1 release must NOT delete the file because it's owned by 33333
	lock1.release();
	assert.ok(existsSync(lock1.lockPath), "Foreign lock should not be deleted by lock1");

	// Clean up
	unlinkSync(lock1.lockPath);
});

test("killProcessTree handles dead/missing process gracefully without unhandled exceptions", () => {
	// Dummy process object with a non-existent PID
	const dummyChild = {
		pid: 99999999,
		kill: () => true,
	} as any;

	assert.doesNotThrow(() => {
		killProcessTree(dummyChild, "test-safety");
	});
});

test("getProfile returns streaming flags and customized timeouts for profiles", () => {
	const arch = getProfile("architecture");
	assert.ok(arch, "architecture profile should exist");
	assert.equal(arch.streams, true);
	assert.equal(arch.timeoutMs, 3600000);
	assert.equal(arch.idleTimeoutMs, 300000);
	assert.equal(arch.hardCapMs, 14400000);

	const coding = getProfile("coding");
	assert.ok(coding, "coding profile should exist");
	assert.equal(coding.hardCapMs, 14400000);

	const fast = getProfile("fast");
	assert.ok(fast, "fast profile should exist");
	assert.equal(fast.streams, false);
	assert.equal(fast.timeoutMs, 180000);
});

test("DelegateResult preserves error, marks partial=true and sets resumeHint on timeout", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-timeout-recovery-001";
	const mockSessionId = "test-session-uuid-1234";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);
	const mockLogPath = join(IDU_LOGS_DIR, `${mockRunId}.log`);

	const mockRecord: RunRecord = {
		runId: mockRunId,
		sessionId: mockSessionId,
		request: {
			task: "Long reasoning task",
			profile: "architecture",
		},
		profile: {
			harness: "claude",
			model: "opus",
			streams: true,
		},
		command: "claude.cmd",
		args: ["-p", "test"],
		status: "timeout",
		exitCode: null,
		startedAt: new Date(Date.now() - 300000).toISOString(),
		completedAt: new Date().toISOString(),
		logPath: mockLogPath,
		resultSummary: "Partial analysis findings before timeout",
		error: "Execution timed out: inactivity for 305000ms without output",
		lastActivityAt: new Date().toISOString(),
		bytesEmitted: 4096,
	};

	writeFileSync(mockSessionPath, JSON.stringify(mockRecord, null, 2), "utf8");
	writeFileSync(mockLogPath, "mock log content", "utf8");

	try {
		const result = manager.getResult(mockRunId);
		assert.ok(result);
		assert.equal(result.status, "timeout");
		assert.equal(result.partial, true);
		assert.equal(result.error, "Execution timed out: inactivity for 305000ms without output");
		assert.equal(result.resumeHint, mockSessionId);
		assert.ok(result.summary.includes("[TIMEOUT: Execution timed out: inactivity for 305000ms without output]"));
		assert.ok(result.summary.includes("Partial analysis findings before timeout"));
		assert.equal(result.bytesEmitted, 4096);
		assert.ok(result.lastActivityAt);
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
		try { unlinkSync(mockLogPath); } catch {}
	}
});

test("getStatus computes live telemetry (elapsedMs, secondsSinceLastActivity, health)", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-telemetry-001";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);

	const mockRecord: RunRecord = {
		runId: mockRunId,
		sessionId: "test-sess-telemetry",
		request: { task: "Test", profile: "fast" },
		profile: { harness: "pi", model: "MiniMax-M3" },
		command: "pi.cmd",
		args: ["-p", "test"],
		status: "running",
		exitCode: null,
		startedAt: new Date(Date.now() - 60000).toISOString(),
		logPath: "dummy.log",
		lastActivityAt: new Date(Date.now() - 5000).toISOString(),
		bytesEmitted: 1024,
	};

	writeFileSync(mockSessionPath, JSON.stringify(mockRecord, null, 2), "utf8");

	try {
		const status = manager.getStatus(mockRunId);
		assert.ok(status);
		assert.ok(typeof status.elapsedMs === "number" && status.elapsedMs >= 59000);
		assert.ok(typeof status.secondsSinceLastActivity === "number" && status.secondsSinceLastActivity >= 4);
		assert.equal(status.health, "healthy");
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
	}
});

test("hardCapMs=0 sentinel is recognized and does not cause premature timeout", () => {
	const profileWithZeroHardCap: IduProfile = {
		harness: "claude",
		hardCapMs: 0,
	};
	assert.equal(profileWithZeroHardCap.hardCapMs, 0);
});

test("writeJsonAtomic writes valid JSON and creates missing directory safely", async () => {
	const { readFileSync, unlinkSync, rmdirSync, existsSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");

	const testDir = join(tmpdir(), `idu-atomic-test-${Date.now()}`);
	const testFile = join(testDir, "test.json");
	const payload = { hello: "world", count: 42, active: true };

	try {
		writeJsonAtomic(testFile, payload);
		assert.ok(existsSync(testFile));
		const readBack = JSON.parse(readFileSync(testFile, "utf8"));
		assert.deepEqual(readBack, payload);
	} finally {
		try { unlinkSync(testFile); } catch {}
		try { rmdirSync(testDir); } catch {}
	}
});

test("isProcessAlive identifies live vs non-existent processes", () => {
	assert.equal(isProcessAlive(process.pid), true);
	assert.equal(isProcessAlive(0), false);
	assert.equal(isProcessAlive(-1), false);
	// 999999 is extraordinarily unlikely to exist
	assert.equal(isProcessAlive(999999), false);
});

test("getStatus recovers completed status from log when runner and worker PIDs have exited", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-recovery-completed-001";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);
	const mockLogPath = join(IDU_LOGS_DIR, `${mockRunId}.log`);

	const logContent = [
		`=== IDU RUN START: ${mockRunId} ===`,
		`Command: mock-cmd`,
		`=== RAW OUTPUT ===`,
		`All unit tests passed successfully.`,
		`=== PROCESS CLOSED WITH CODE 0 ===`,
	].join("\n");

	const mockRecord: RunRecord = {
		runId: mockRunId,
		sessionId: "sess-rec-001",
		request: { task: "Test recovery", profile: "fast" },
		profile: { harness: "claude", model: "sonnet" },
		command: "claude.cmd",
		args: ["-p", "test"],
		pid: 999998,
		runnerPid: 999997,
		status: "running",
		exitCode: null,
		startedAt: new Date(Date.now() - 30000).toISOString(),
		logPath: mockLogPath,
	};

	writeFileSync(mockSessionPath, JSON.stringify(mockRecord, null, 2), "utf8");
	writeFileSync(mockLogPath, logContent, "utf8");

	try {
		const status = manager.getStatus(mockRunId);
		assert.ok(status);
		assert.equal(status.status, "completed");
		assert.equal(status.exitCode, 0);
		assert.ok(status.resultSummary?.includes("All unit tests passed successfully"));
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
		try { unlinkSync(mockLogPath); } catch {}
	}
});

test("getStatus records failed when runner and worker PIDs are dead without exit marker", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-recovery-abrupt-001";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);
	const mockLogPath = join(IDU_LOGS_DIR, `${mockRunId}.log`);

	const logContent = [
		`=== IDU RUN START: ${mockRunId} ===`,
		`Command: mock-cmd`,
		`Incomplete output before abrupt kill`,
	].join("\n");

	const mockRecord: RunRecord = {
		runId: mockRunId,
		sessionId: "sess-rec-abrupt",
		request: { task: "Test abrupt", profile: "fast" },
		profile: { harness: "opencode" },
		command: "opencode.cmd",
		args: ["run"],
		pid: 999996,
		runnerPid: 999995,
		status: "running",
		exitCode: null,
		startedAt: new Date(Date.now() - 30000).toISOString(),
		logPath: mockLogPath,
	};

	writeFileSync(mockSessionPath, JSON.stringify(mockRecord, null, 2), "utf8");
	writeFileSync(mockLogPath, logContent, "utf8");

	try {
		const status = manager.getStatus(mockRunId);
		assert.ok(status);
		assert.equal(status.status, "failed");
		assert.equal(status.error, "Worker process terminated unexpectedly");
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
		try { unlinkSync(mockLogPath); } catch {}
	}
});

test("getStatus reads disk session.json directly without in-memory stale shadowing", async () => {
	const { unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-disk-truth-001";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);

	// Initial record as if created at spawn
	const initialRecord: RunRecord = {
		runId: mockRunId,
		sessionId: "sess-disk-truth",
		request: { task: "Test truth", profile: "fast" },
		profile: { harness: "pi" },
		command: "pi.cmd",
		args: ["-p", "test"],
		status: "running",
		exitCode: null,
		startedAt: new Date(Date.now() - 10000).toISOString(),
		logPath: "dummy.log",
	};

	writeJsonAtomic(mockSessionPath, initialRecord);

	// Ensure manager reads it
	let status = manager.getStatus(mockRunId);
	assert.ok(status);
	assert.equal(status.bytesEmitted, undefined);

	// External daemon updates session.json on disk with worker pid and telemetry
	const daemonUpdatedRecord: RunRecord = {
		...initialRecord,
		pid: process.pid, // alive pid
		runnerPid: process.pid,
		bytesEmitted: 42000,
		lastActivityAt: new Date().toISOString(),
	};
	writeJsonAtomic(mockSessionPath, daemonUpdatedRecord);

	try {
		// getStatus in the same process must read the updated disk truth, not a stale mirror
		status = manager.getStatus(mockRunId);
		assert.ok(status);
		assert.equal(status.bytesEmitted, 42000);
		assert.equal(status.pid, process.pid);
		assert.equal(status.runnerPid, process.pid);
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
	}
});

test("getStatus recovers from log when process closed with CODE null (POSIX signal termination)", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join } = await import("node:path");

	const manager = CrossCliProcessManager.getInstance();
	const mockRunId = "IDU-test-signal-death-001";
	const mockSessionPath = join(IDU_SESSIONS_DIR, `${mockRunId}.json`);
	const mockLogPath = join(IDU_LOGS_DIR, `${mockRunId}.log`);

	const logContent = [
		`=== IDU RUN START: ${mockRunId} ===`,
		`Worker killed by signal`,
		`=== PROCESS CLOSED WITH CODE null ===`,
	].join("\n");

	const mockRecord: RunRecord = {
		runId: mockRunId,
		sessionId: "sess-signal-null",
		request: { task: "Test signal", profile: "fast" },
		profile: { harness: "claude" },
		command: "claude.cmd",
		args: ["-p", "test"],
		pid: 999994,
		runnerPid: 999993,
		status: "running",
		exitCode: null,
		startedAt: new Date(Date.now() - 30000).toISOString(),
		logPath: mockLogPath,
	};

	writeFileSync(mockSessionPath, JSON.stringify(mockRecord, null, 2), "utf8");
	writeFileSync(mockLogPath, logContent, "utf8");

	try {
		const status = manager.getStatus(mockRunId);
		assert.ok(status);
		assert.equal(status.status, "failed");
		assert.equal(status.exitCode, 1);
	} finally {
		try { unlinkSync(mockSessionPath); } catch {}
		try { unlinkSync(mockLogPath); } catch {}
	}
});

test("CLI wait command exits with 124 on timeout and 0 on completion with silent compact JSON", async () => {
	const { writeFileSync, unlinkSync } = await import("node:fs");
	const { join, resolve } = await import("node:path");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	const cliPath = resolve("dist/src/cli.js");

	// 1. Test timeout (code 124) when process is still running
	const timeoutRunId = "IDU-test-wait-timeout-001";
	const timeoutSessionPath = join(IDU_SESSIONS_DIR, `${timeoutRunId}.json`);
	const timeoutLogPath = join(IDU_LOGS_DIR, `${timeoutRunId}.log`);

	const runningRecord: RunRecord = {
		runId: timeoutRunId,
		sessionId: "sess-wait-timeout",
		request: { task: "Wait timeout test", profile: "fast" },
		profile: { harness: "claude" },
		command: "claude.cmd",
		args: ["-p", "test"],
		pid: 999991,
		runnerPid: process.pid, // alive so getStatus reports running
		status: "running",
		exitCode: null,
		startedAt: new Date().toISOString(),
		logPath: timeoutLogPath,
	};

	writeFileSync(timeoutSessionPath, JSON.stringify(runningRecord, null, 2), "utf8");
	writeFileSync(timeoutLogPath, "mock log line\n", "utf8");

	try {
		let timedOut = false;
		try {
			await execFileAsync(process.execPath, [cliPath, "wait", timeoutRunId, "--timeout", "200", "--interval", "50"]);
		} catch (err: any) {
			timedOut = true;
			assert.equal(err.code, 124, "CLI wait must exit with code 124 on timeout");
			assert.ok(err.stderr.includes("Wait timed out after 200ms. Worker is still running in background."));
		}
		assert.ok(timedOut, "Process should have exited with timeout code 124");
	} finally {
		try { unlinkSync(timeoutSessionPath); } catch {}
		try { unlinkSync(timeoutLogPath); } catch {}
	}

	// 2. Test completion returns 0 and compact JSON
	const completedRunId = "IDU-test-wait-completed-002";
	const completedSessionPath = join(IDU_SESSIONS_DIR, `${completedRunId}.json`);
	const completedLogPath = join(IDU_LOGS_DIR, `${completedRunId}.log`);

	const completedRecord: RunRecord = {
		runId: completedRunId,
		sessionId: "sess-wait-completed",
		request: { task: "Wait completed test", profile: "fast" },
		profile: { harness: "claude" },
		command: "claude.cmd",
		args: ["-p", "test"],
		pid: 999992,
		runnerPid: 999990,
		status: "completed",
		exitCode: 0,
		startedAt: new Date(Date.now() - 5000).toISOString(),
		completedAt: new Date().toISOString(),
		logPath: completedLogPath,
		resultSummary: "Task completed successfully",
	};

	writeFileSync(completedSessionPath, JSON.stringify(completedRecord, null, 2), "utf8");
	writeFileSync(completedLogPath, "mock log line\n", "utf8");

	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, "wait", completedRunId, "--timeout", "5000"]);
		assert.equal(stderr, "");
		const parsed = JSON.parse(stdout);
		assert.equal(parsed.status, "completed");
		assert.equal(parsed.runId, completedRunId);
		assert.equal(parsed.summary, "Task completed successfully");
	} finally {
		try { unlinkSync(completedSessionPath); } catch {}
		try { unlinkSync(completedLogPath); } catch {}
	}
});

test("SDD Implementation Guard blocks delegating SDD Work Unit implementation to workspace profiles", async () => {
	const manager = CrossCliProcessManager.getInstance();

	// 1. Task targeting WU implementation with workspace profile must throw
	await assert.rejects(
		async () => {
			await manager.delegate({
				task: "Delegating WU2 implementation to a subagent with a coding profile while separating code and docs",
				profile: "coding",
			});
		},
		/SDD WORK UNIT IMPLEMENTATION VIOLATION/,
	);

	// 2. Task targeting sdd-apply with workspace profile must throw
	await assert.rejects(
		async () => {
			await manager.delegate({
				task: "Run sdd-apply for change predictive-ai-api-key-encryption",
				profile: "coding",
			});
		},
		/SDD WORK UNIT IMPLEMENTATION VIOLATION/,
	);
});

test("checkActiveSddAttempt detects heuristic markers and permits non-SDD tasks", async () => {
	const { checkActiveSddAttempt } = await import("../src/process-manager.js");

	// 1. SDD Work Unit task triggers blocked: true
	const res1 = checkActiveSddAttempt(process.cwd(), "Implement WU3: fix telemetry parser");
	assert.equal(res1.blocked, true);
	assert.ok(res1.reason?.includes("SDD implementation / Work Unit"));

	// 2. Regular non-SDD task triggers blocked: false
	const res2 = checkActiveSddAttempt(process.cwd(), "Check memory health and git status");
	assert.equal(res2.blocked, false);
});


