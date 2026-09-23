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

test("CrossCliProcessManager gets capabilities reporting profiles and CLIs", () => {
	const manager = CrossCliProcessManager.getInstance();
	const caps = manager.getCapabilities();
	assert.ok(caps.profiles["cheap-explore"]);
	assert.ok(Array.isArray(caps.installedClis));
	assert.equal(caps.oneOrchestratorRule.enabled, true);
});

test("ONE ORCHESTRATOR RULE blocks recursive delegation when IDU_WORKER is set", async () => {
	const manager = CrossCliProcessManager.getInstance();
	process.env.IDU_WORKER = "true";
	process.env.IDU_ALLOW_DELEGATION = "false";
	process.env.IDU_RUN_ID = "IDU-TEST-123";

	try {
		await assert.rejects(
			async () => {
				await manager.delegate({
					task: "Recursive subagent call",
					profile: "cheap-explore",
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


