import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import type { ModelInvocationRecord } from "../src/model-invocation-log.js";
import type { PiRpcOptions, PiRpcPromptResult } from "../src/pi-rpc.js";

class FakeSession implements AgentSession {
	readonly cwd: string;
	running = false;
	busy = false;
	prompts: string[] = [];
	cancelled = false;
	stopped = false;

	constructor(
		cwd: string,
		public readonly piArgs: string[],
		private readonly options: {
			output?: string;
			throwOnPrompt?: Error;
		} = {},
	) {
		this.cwd = cwd;
	}

	start(): void {
		this.running = true;
	}

	async prompt(message: string): Promise<PiRpcPromptResult> {
		this.prompts.push(message);
		if (this.options.throwOnPrompt) throw this.options.throwOnPrompt;
		return { ok: true, output: this.options.output ?? "fake-output" };
	}

	answerUiRequest(): boolean {
		return false;
	}

	cancel(): boolean {
		this.cancelled = true;
		return false;
	}

	stop(): void {
		this.stopped = true;
		this.running = false;
	}
}

const tempRoots: string[] = [];

function tempStateRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "agent-router-pfr-"));
	tempRoots.push(dir);
	return dir;
}

function writeAssignments(
	root: string,
	assignments: Record<string, string>,
): void {
	writeFileSync(
		join(root, "model-assignments.json"),
		`${JSON.stringify({ version: 1, assignments }, null, 2)}\n`,
		"utf8",
	);
}

function makeRouter(
	sessionOptions?: (options: PiRpcOptions) => {
		output?: string;
		throwOnPrompt?: Error;
	},
) {
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
			const overrides = sessionOptions?.(options) ?? {};
			const session = new FakeSession(options.cwd, options.piArgs ?? [], {
				output: overrides.output,
				throwOnPrompt: overrides.throwOnPrompt,
			});
			created.push({ options, session });
			return session;
		},
	});
	return { router, created };
}

after(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) =>
			rm(dir, { recursive: true, force: true }),
		),
	);
});

test("promptForRole honours the assignment and passes --provider and --model to pi-rpc", async () => {
	const root = tempStateRoot();
	writeAssignments(root, {
		"supervisor-main": "opencode-go/deepseek-v4-pro",
	});
	const { router, created } = makeRouter();
	const sink: ModelInvocationRecord[] = [];

	const result = await router.promptForRole(
		"supervisor-main",
		"hello world",
		{
			projectId: "project-a",
			stateRoot: root,
			invocationSink: (record) => sink.push(record),
		},
	);

	assert.equal(result.ok, true);
	assert.equal(result.output, "fake-output");
	assert.equal(result.provider, "opencode-go");
	assert.equal(result.model, "deepseek-v4-pro");
	assert.equal(result.role, "supervisor-main");

	// The session was created with --provider opencode-go --model deepseek-v4-pro
	assert.equal(created.length, 1);
	const piArgs = created[0]?.options.piArgs ?? [];
	assert.deepEqual(piArgs, [
		"pi-cli.js",
		"--provider",
		"opencode-go",
		"--model",
		"deepseek-v4-pro",
	]);
	assert.deepEqual(created[0]?.session.prompts, ["hello world"]);

	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "success");
	assert.equal(sink[0]?.role, "supervisor-main");
	assert.equal(sink[0]?.provider, "opencode-go");
	assert.equal(sink[0]?.model, "deepseek-v4-pro");
	assert.equal(sink[0]?.promptChars, "hello world".length);
	assert.equal(sink[0]?.responseChars, "fake-output".length);
	assert.equal(sink[0]?.errorMessage, undefined);
});

test("promptForRole writes a model_invocation_log failure row with error_message when the session throws", async () => {
	const root = tempStateRoot();
	writeAssignments(root, {
		"agentlab-security": "opencode-go/deepseek-v4-pro",
	});
	const { router, created } = makeRouter(() => ({
		throwOnPrompt: new Error("Pi crashed during prompt"),
	}));
	const sink: ModelInvocationRecord[] = [];

	await assert.rejects(
		router.promptForRole("agentlab-security", "boom", {
			projectId: "project-a",
			stateRoot: root,
			invocationSink: (record) => sink.push(record),
		}),
		/Pi crashed during prompt/u,
	);

	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "failure");
	assert.equal(sink[0]?.role, "agentlab-security");
	assert.equal(sink[0]?.provider, "opencode-go");
	assert.equal(sink[0]?.model, "deepseek-v4-pro");
	assert.equal(sink[0]?.promptChars, "boom".length);
	assert.equal(sink[0]?.responseChars, 0);
	assert.equal(sink[0]?.errorMessage, "Pi crashed during prompt");
	// The session was created even though the prompt threw.
	assert.equal(created.length, 1);
});

test("promptForRole records a skipped row when the role has no assignment and does not spawn a session", async () => {
	const root = tempStateRoot();
	// No model-assignments.json present.
	const { router, created } = makeRouter();
	const sink: ModelInvocationRecord[] = [];

	const result = await router.promptForRole(
		"agentlab-database",
		"any message",
		{
			projectId: "project-a",
			stateRoot: root,
			invocationSink: (record) => sink.push(record),
		},
	);

	assert.equal(result.ok, false);
	assert.equal(result.output, "");
	assert.equal(result.provider, "");
	assert.equal(result.model, "");
	assert.equal(result.role, "agentlab-database");
	assert.equal(created.length, 0);

	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "skipped");
	assert.equal(sink[0]?.role, "agentlab-database");
	assert.equal(sink[0]?.provider, "");
	assert.equal(sink[0]?.model, "");
	assert.equal(sink[0]?.promptChars, "any message".length);
	assert.equal(sink[0]?.responseChars, 0);
});

test("promptForRole rejects an unknown role with a clear error and does not write an invocation record", async () => {
	const root = tempStateRoot();
	const { router } = makeRouter();
	const sink: ModelInvocationRecord[] = [];

	await assert.rejects(
		router.promptForRole(
			// @ts-expect-error — invalid role id, exercised at runtime
			"not-a-real-role",
			"hi",
			{
				projectId: "project-a",
				stateRoot: root,
				invocationSink: (record) => sink.push(record),
			},
		),
		/unknown model role|invalid role|unknown role/i,
	);
	assert.equal(sink.length, 0);
});

test("promptForRole reuses the existing profile runtime when the assignment is a profile id", async () => {
	const root = tempStateRoot();
	writeAssignments(root, {
		// The "codex" profile already has piArgs: ["--model", "codex"].
		"agentlab-security": "codex",
	});
	const { router, created } = makeRouter();
	const sink: ModelInvocationRecord[] = [];

	const result = await router.promptForRole(
		"agentlab-security",
		"audit please",
		{
			projectId: "project-a",
			stateRoot: root,
			invocationSink: (record) => sink.push(record),
		},
	);

	assert.equal(result.ok, true);
	assert.equal(result.role, "agentlab-security");
	assert.equal(result.provider, "pi");
	assert.equal(result.model, "codex");
	assert.equal(created.length, 1);
	// The session was spawned with the profile's existing piArgs, not --provider/--model.
	assert.deepEqual(created[0]?.options.piArgs, [
		"pi-cli.js",
		"--model",
		"codex",
	]);
	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "success");
	assert.equal(sink[0]?.model, "codex");
});
