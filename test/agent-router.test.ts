import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	AgentRouter,
	formatAgentProfiles,
	type AgentSession,
} from "../src/agent-router.js";
import { runAgentLabReviewRequest } from "../src/agentlab-review-runner.js";
import { buildAgentLabReviewRequest } from "../src/agentlab-supervisor-contract.js";
import type { ModelInvocationRecord } from "../src/model-invocation-log.js";
import type { PiRpcOptions, PiRpcPromptResult } from "../src/pi-rpc.js";
import { makeTempDir } from "./helpers/temp.js";

class FakeSession implements AgentSession {
	running = false;
	busy = false;
	prompts: string[] = [];
	cancelled = false;
	stopped = false;
	stopCalls = 0;
	uiAnswers: unknown[] = [];

	constructor(
		public cwd: string,
		private readonly promptError?: Error,
		private readonly promptOutput?: string,
	) {}

	start(): void {
		this.running = true;
	}

	async prompt(message: string): Promise<PiRpcPromptResult> {
		this.running = true;
		this.prompts.push(message);
		if (this.promptError) throw this.promptError;
		return { ok: true, output: this.promptOutput ?? `ok:${message}` };
	}

	answerUiRequest(value: unknown): boolean {
		this.uiAnswers.push(value);
		return true;
	}

	cancel(): boolean {
		this.cancelled = true;
		return this.running;
	}

	stop(): void {
		this.stopCalls++;
		this.stopped = true;
		this.running = false;
	}
}

function writeModelAssignments(
	stateRoot: string,
	assignments: Record<string, string>,
): void {
	writeFileSync(
		join(stateRoot, "model-assignments.json"),
		`${JSON.stringify({ version: 1, assignments }, null, 2)}\n`,
		"utf8",
	);
}

function createRoleRouter(promptError?: Error) {
	const created: Array<{ options: PiRpcOptions; session: FakeSession }> = [];
	const router = new AgentRouter({
		piBin: "node",
		basePiArgs: ["pi-cli.js"],
		profiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{
				id: "codex",
				label: "GPT Codex",
				provider: "pi",
				piArgs: ["--model", "codex"],
			},
		],
		defaultProjectId: "project-a",
		defaultCwd: "C:/project-a",
		workspaceMode: "direct",
		createSession: (options) => {
			const session = new FakeSession(options.cwd, promptError);
			created.push({ options, session });
			return session;
		},
	});
	return { router, created };
}

function createRouter(workspaceMode: "direct" | "clone" = "direct") {
	const created: Array<{ options: PiRpcOptions; session: FakeSession }> = [];
	const syncs: string[] = [];
	const router = new AgentRouter({
		piBin: "node",
		basePiArgs: ["pi-cli.js"],
		profiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{
				id: "codex",
				label: "GPT Codex",
				provider: "pi",
				piArgs: ["--model", "codex"],
			},
		],
		defaultProjectId: "project-a",
		defaultCwd: "C:/project-a",
		workspaceMode,
		workspaceRoot: "C:/bridge-agents",
		syncWorkspace: (_workspaceRoot, projectId, _targetCwd, profileId) => {
			syncs.push(`${projectId}:${profileId}`);
			return `C:/bridge-agents/workspaces/${projectId}__${profileId}`;
		},
		createSession: (options) => {
			const session = new FakeSession(options.cwd);
			created.push({ options, session });
			return session;
		},
	});
	return { router, created, syncs };
}

test("selects agent profiles by number, id, and label", () => {
	const { router } = createRouter();

	assert.equal(router.activeProfile().id, "default");
	assert.equal(router.select("2")?.id, "codex");
	assert.equal(router.select("1.")?.id, "default");
	assert.equal(router.select("codex")?.id, "codex");
	assert.equal(router.select("GPT Codex")?.id, "codex");
	assert.equal(router.select("missing"), undefined);
});

test("formatAgentProfiles shows model for pi profiles", () => {
	const { router } = createRouter();
	const text = formatAgentProfiles(router);

	assert.match(
		text,
		/1\. Pi default ✅\n {3}id: default\n {3}provider: pi\n {3}model: Pi default/,
	);
	assert.match(
		text,
		/2\. GPT Codex\n {3}id: codex\n {3}provider: pi\n {3}model: codex/,
	);
});

test("keeps independent sessions per project and profile", async () => {
	const { router, created } = createRouter();

	await router.prompt("a default");
	router.select("codex");
	await router.prompt("a codex");
	router.switchProject("project-b", "C:/project-b");
	await router.prompt("b default");
	router.switchProject("project-a", "C:/project-a");
	await router.prompt("a codex again");

	assert.equal(created.length, 3);
	assert.deepEqual(
		created.map((entry) => entry.options.cwd),
		["C:/project-a", "C:/project-a", "C:/project-b"],
	);
	assert.deepEqual(created[1].options.piArgs, [
		"pi-cli.js",
		"--model",
		"codex",
	]);
	assert.deepEqual(created[1].session.prompts, ["a codex", "a codex again"]);
});

test("cancel only affects active session", async () => {
	const { router, created } = createRouter();

	await router.prompt("default");
	router.select("codex");
	await router.prompt("codex");

	assert.equal(router.cancelActive(), true);
	assert.equal(created[0].session.cancelled, false);
	assert.equal(created[1].session.cancelled, true);
});

test("cancelProfiles cancels specified lab runtimes without active profile", async () => {
	const { router, created } = createRouter("clone");

	router.select("codex");
	await router.prompt("codex");
	router.select("default");

	assert.equal(router.cancelProfiles(["codex"]), 1);
	const codexSession = created.find((entry) =>
		entry.options.piArgs?.includes("codex"),
	)?.session;
	assert.equal(codexSession?.cancelled, true);
});

test("resetActiveSession recreates only active runtime with session path", () => {
	const { router, created } = createRouter();

	router.activeRuntime();
	router.resetActiveSession("session.jsonl");

	assert.equal(created.length, 2);
	assert.equal(created[0].session.stopped, true);
	assert.equal(created[1].options.sessionPath, "session.jsonl");
});

test("clone workspace mode keeps default direct and non-default isolated", () => {
	const { router, created, syncs } = createRouter("clone");

	const defaultRuntime = router.activeRuntime();
	router.select("codex");
	const codexRuntime = router.activeRuntime();

	assert.equal(defaultRuntime.workspaceKind, "direct");
	assert.equal(defaultRuntime.cwd, "C:/project-a");
	assert.equal(codexRuntime.workspaceKind, "clone");
	assert.equal(
		codexRuntime.cwd,
		"C:/bridge-agents/workspaces/project-a__codex",
	);
	assert.deepEqual(
		created.map((entry) => entry.options.cwd),
		["C:/project-a", "C:/bridge-agents/workspaces/project-a__codex"],
	);
	assert.deepEqual(syncs, ["project-a:codex", "project-a:codex"]);
});

test("existing clone runtime re-syncs workspace before reuse", () => {
	const { router, syncs } = createRouter("clone");

	router.select("codex");
	router.activeRuntime();

	assert.deepEqual(syncs, ["project-a:codex", "project-a:codex"]);
});

test("server lifecycle starts, restarts, stops, and answers active UI", () => {
	const { router, created } = createRouter();

	router.startActive();
	assert.equal(created[0].session.running, true);

	assert.equal(router.answerActiveUiRequest({ confirmed: true }), true);
	assert.deepEqual(created[0].session.uiAnswers, [{ confirmed: true }]);

	router.restartActive();
	assert.equal(created[0].session.stopped, true);
	assert.equal(created.length, 2);
	assert.equal(created[1].session.running, true);

	assert.equal(router.stopActive(), true);
	assert.equal(created[1].session.stopped, true);
});

test("answers UI requests on the runtime that created them", async () => {
	const { router, created } = createRouter();

	const defaultRuntime = router.activeRuntime();
	await router.prompt("needs confirm");
	router.select("codex");
	await router.prompt("other active work");

	assert.equal(
		router.answerUiRequestForRuntime(defaultRuntime, { confirmed: true }),
		true,
	);
	assert.deepEqual(created[0].session.uiAnswers, [{ confirmed: true }]);
	assert.deepEqual(created[1].session.uiAnswers, []);
});

test("promptForRole stops the direct-model runtime once on success", async () => {
	const stateRoot = makeTempDir("agent-router-direct-model-success-");
	writeModelAssignments(stateRoot, {
		"supervisor-main": "opencode-go/deepseek-v4-pro",
	});
	const { router, created } = createRoleRouter();
	const sink: ModelInvocationRecord[] = [];

	const result = await router.promptForRole("supervisor-main", "hello", {
		projectId: "project-a",
		stateRoot,
		invocationSink: (record) => sink.push(record),
	});

	assert.equal(result.ok, true);
	assert.equal(created.length, 1);
	assert.equal(created[0]?.session.stopCalls, 1);
	assert.equal(created[0]?.options.noSession, true);
	assert.deepEqual(created[0]?.options.piArgs, [
		"pi-cli.js",
		"--provider",
		"opencode-go",
		"--model",
		"deepseek-v4-pro",
	]);
	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "success");
});

test("promptForRole still stops the direct-model runtime when the prompt throws", async () => {
	const stateRoot = makeTempDir("agent-router-direct-model-throws-");
	writeModelAssignments(stateRoot, {
		"supervisor-main": "opencode-go/deepseek-v4-pro",
	});
	const promptError = new Error("Pi crashed during prompt");
	const { router, created } = createRoleRouter(promptError);
	const sink: ModelInvocationRecord[] = [];

	await assert.rejects(
		router.promptForRole("supervisor-main", "boom", {
			projectId: "project-a",
			stateRoot,
			invocationSink: (record) => sink.push(record),
		}),
		(error: unknown) => {
			assert.equal(error, promptError);
			return true;
		},
	);

	assert.equal(created.length, 1);
	assert.equal(created[0]?.session.stopCalls, 1);
	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "failure");
	assert.equal(sink[0]?.errorMessage, "Pi crashed during prompt");
});

test("promptForRole reuses the profile runtime and never stops it (regression for assigned-profile trap)", async () => {
	const stateRoot = makeTempDir("agent-router-assigned-profile-");
	writeModelAssignments(stateRoot, {
		"supervisor-main": "codex",
	});
	const { router, created } = createRoleRouter();

	router.select("codex");
	router.activeRuntime();
	const beforeCount = created.length;

	const result = await router.promptForRole("supervisor-main", "audit", {
		projectId: "project-a",
		stateRoot,
	});

	assert.equal(result.ok, true);
	assert.equal(result.provider, "pi");
	assert.equal(result.model, "codex");
	assert.equal(created.length, beforeCount);
	for (const entry of created) {
		assert.equal(entry.session.stopCalls, 0);
	}
	const codexEntry = created[beforeCount - 1];
	assert.equal(codexEntry?.options.noSession, undefined);
	assert.equal(codexEntry?.session.prompts.at(-1), "audit");
	assert.equal(
		router.activeRuntime().session,
		codexEntry?.session,
		"shared profile runtime must still be reachable after the role call",
	);
});

test("promptForRole spawns and stops one session per direct-model call", async () => {
	const stateRoot = makeTempDir("agent-router-repeated-direct-model-");
	writeModelAssignments(stateRoot, {
		"supervisor-main": "opencode-go/deepseek-v4-pro",
	});
	const { router, created } = createRoleRouter();

	const calls = 3;
	for (let index = 0; index < calls; index++) {
		await router.promptForRole("supervisor-main", `call-${index}`, {
			projectId: "project-a",
			stateRoot,
		});
	}

	assert.equal(created.length, calls);
	for (const entry of created) {
		assert.equal(entry.session.stopCalls, 1);
	}
});

test("AgentLab promptForRole path stops both its outer runtime and inner direct-model runtime", async () => {
	const projectPath = makeTempDir("agent-router-agentlab-project-");
	const runGit = (args: string[]) =>
		execFileSync("git", args, { cwd: projectPath, encoding: "utf8" });
	runGit(["init"]);
	runGit(["config", "user.email", "test@example.com"]);
	runGit(["config", "user.name", "Test"]);
	runGit(["config", "core.autocrlf", "false"]);
	writeFileSync(join(projectPath, "tracked.txt"), "base\n", "utf8");
	runGit(["add", "tracked.txt"]);
	runGit(["commit", "-m", "init"]);

	const stateRoot = makeTempDir("agent-router-agentlab-state-");
	writeModelAssignments(stateRoot, {
		"agentlab-security": "opencode-go/deepseek-v4-pro",
	});
	const workspaceRoot = makeTempDir("agent-router-agentlab-workspace-");
	const created: Array<{ options: PiRpcOptions; session: FakeSession }> = [];
	const profiles = [
		{ id: "default", label: "Default", provider: "pi" as const, piArgs: [] },
		{ id: "security", label: "Security", provider: "pi" as const, piArgs: [] },
	];
	const router = new AgentRouter({
		piBin: "node",
		basePiArgs: ["pi-cli.js"],
		profiles,
		defaultProjectId: "project-a",
		defaultCwd: projectPath,
		workspaceRoot,
		workspaceMode: "clone",
		syncWorkspace: (_root, _projectId, _targetCwd, profileId) => {
			const workspace = join(workspaceRoot, profileId);
			mkdirSync(workspace, { recursive: true });
			return workspace;
		},
		createSession: (options) => {
			const session = new FakeSession(options.cwd, undefined, "{}");
			created.push({ options, session });
			return session;
		},
	});
	const invocationRecords: ModelInvocationRecord[] = [];
	const request = buildAgentLabReviewRequest({
		id: "request-security",
		projectId: "project-a",
		projectPath,
		specialty: "security",
		trigger: "manual",
		objective: "Review security",
		contextSummary: "Direct-model lifetime regression proof",
		evidence: ["tracked.txt"],
		filesToInspect: ["tracked.txt"],
		flowsToCheck: [],
		rulesToCheck: ["review-only"],
		constraints: ["review-only"],
		maxCommands: 1,
		maxMinutes: 1,
		tokenBudgetHint: "bounded",
		expectedOutputs: ["report"],
		createdAt: "2026-05-25T00:00:00.000Z",
		model: "opencode-go/deepseek-v4-pro",
	});

	await runAgentLabReviewRequest({
		request,
		projectPath,
		router,
		profile: profiles[1],
		stateRoot,
		invocationSink: (record) => invocationRecords.push(record),
	});

	assert.equal(created.length, 2);
	const inner = created.find((entry) =>
		entry.options.piArgs?.includes("--provider"),
	);
	const outer = created.find((entry) => entry !== inner);
	assert.ok(inner, "AgentLab must route the model invocation through promptForRole");
	assert.equal(inner.session.stopCalls, 1);
	assert.equal(outer?.session.stopCalls, 1);
	assert.equal(invocationRecords.length, 1);
	assert.equal(invocationRecords[0]?.status, "success");
});
