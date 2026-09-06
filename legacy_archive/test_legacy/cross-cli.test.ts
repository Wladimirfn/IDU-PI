import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerArgs } from "../src/cross-cli/cmdline.js";
import { CrossCliProcessManager } from "../src/cross-cli/process-manager.js";
import type { IduConfig, IduProfile } from "../src/cross-cli/types.js";

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
	},
	defaultTimeoutMs: 10000,
	maxConcurrentWorkers: 4,
};

test("buildWorkerArgs builds correct argv for Claude with model and bypassPermissions", () => {
	const profile: IduProfile = {
		harness: "claude",
		model: "sonnet",
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

test("CrossCliProcessManager gets capabilities reporting profiles and CLIs", () => {
	const manager = CrossCliProcessManager.getInstance();
	const caps = manager.getCapabilities();
	assert.ok(caps.profiles["cheap-explore"]);
	assert.ok(caps.installedClis.length > 0);
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
