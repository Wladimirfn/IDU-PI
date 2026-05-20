import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AgentRouter,
	formatAgentProfiles,
	type AgentSession,
} from "../src/agent-router.js";
import type { PiRpcOptions, PiRpcPromptResult } from "../src/pi-rpc.js";

class FakeSession implements AgentSession {
	running = false;
	busy = false;
	prompts: string[] = [];
	cancelled = false;
	stopped = false;
	uiAnswers: unknown[] = [];

	constructor(public cwd: string) {}

	start(): void {
		this.running = true;
	}

	async prompt(message: string): Promise<PiRpcPromptResult> {
		this.running = true;
		this.prompts.push(message);
		return { ok: true, output: `ok:${message}` };
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
		this.stopped = true;
		this.running = false;
	}
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
