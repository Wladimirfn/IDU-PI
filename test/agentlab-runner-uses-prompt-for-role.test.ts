import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import { buildAgentLabReviewRequest } from "../src/agentlab-supervisor-contract.js";
import { runAgentLabReviewRequest } from "../src/agentlab-review-runner.js";
import type { AgentProfile } from "../src/config.js";
import type { ModelInvocationRecord } from "../src/model-invocation-log.js";
import type {
	PiRpcOptions,
	PiRpcProgressEvent,
	PiRpcPromptResult,
} from "../src/pi-rpc.js";

class FakeSession implements AgentSession {
	readonly cwd: string;
	running = false;
	busy = false;
	cancelled = false;
	prompts: string[] = [];
	piArgs: string[] = [];

	constructor(
		cwd: string,
		piArgs: string[],
		private readonly output: string,
	) {
		this.cwd = cwd;
		this.piArgs = piArgs;
	}

	start(): void {
		this.running = true;
	}

	async prompt(
		message: string,
		_onProgress?: (event: PiRpcProgressEvent) => void,
	): Promise<PiRpcPromptResult> {
		this.prompts.push(message);
		return { ok: true, output: this.output };
	}

	answerUiRequest(): boolean {
		return false;
	}

	cancel(): boolean {
		return false;
	}

	stop(): void {
		this.running = false;
	}
}

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitProject(): string {
	const projectPath = mkdtempSync(
		join(tmpdir(), "agentlab-prompt-for-role-runner-"),
	);
	git(["init"], projectPath);
	git(["config", "user.email", "test@example.com"], projectPath);
	git(["config", "user.name", "Test"], projectPath);
	git(["config", "core.autocrlf", "false"], projectPath);
	writeFileSync(join(projectPath, "tracked.txt"), "base\n", "utf8");
	git(["add", "tracked.txt"], projectPath);
	git(["commit", "-m", "init"], projectPath);
	return projectPath;
}

function profiles(): AgentProfile[] {
	return [
		{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		{ id: "security", label: "Security Lab", provider: "pi", piArgs: [] },
		{ id: "database", label: "Database Lab", provider: "pi", piArgs: [] },
		{ id: "ui", label: "UI UX Lab", provider: "pi", piArgs: [] },
		{ id: "general", label: "General Lab", provider: "pi", piArgs: [] },
	];
}

function makeRouter({
	output,
	projectPath,
	workspaceRoot,
}: {
	output: string;
	projectPath: string;
	workspaceRoot: string;
}) {
	const created: Array<{ options: PiRpcOptions; session: FakeSession }> = [];
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles: profiles(),
		defaultProjectId: "pi-telegram-bridge",
		defaultCwd: projectPath,
		workspaceMode: "clone",
		workspaceRoot,
		createSession: (options) => {
			const session = new FakeSession(
				options.cwd,
				options.piArgs ?? [],
				output,
			);
			created.push({ options, session });
			return session;
		},
		syncWorkspace: (_workspaceRoot, _projectId, _targetCwd, profileId) => {
			const clone = join(workspaceRoot, "workspaces", profileId);
			mkdirSync(clone, { recursive: true });
			return clone;
		},
	});
	return { router, created };
}

function validReport(requestId = "request-security", specialty = "security") {
	return JSON.stringify({
		id: "report-001",
		requestId,
		projectId: "pi-telegram-bridge",
		specialty,
		status: "completed",
		summary: "Revisión completada.",
		qualityFindings: [],
		safetyFindings: [],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: [],
		testsExecuted: ["corepack pnpm test -- auth"],
		evidence: ["Inspección de tests"],
		recommendations: [],
		proposedSupervisorActions: [],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "high",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T00:00:00.000Z",
	});
}

test("runner uses promptForRole when request.model is set and writes a model_invocation_log record", async () => {
	const projectPath = gitProject();
	const workspaceRoot = mkdtempSync(join(tmpdir(), "agentlab-pfr-runner-"));
	mkdirSync(workspaceRoot, { recursive: true });
	const stateRoot = mkdtempSync(join(tmpdir(), "agentlab-pfr-runner-state-"));
	writeFileSync(
		join(stateRoot, "model-assignments.json"),
		JSON.stringify(
			{
				version: 1,
				assignments: {
					"agentlab-security": "opencode-go/deepseek-v4-pro",
				},
				updatedAt: "2026-06-08T00:00:00.000Z",
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	const { router, created } = makeRouter({
		output: validReport("request-pfr-1"),
		projectPath,
		workspaceRoot,
	});

	const request = buildAgentLabReviewRequest({
		id: "request-pfr-1",
		projectId: "pi-telegram-bridge",
		projectPath,
		specialty: "security",
		trigger: "manual",
		objective: "audit auth",
		contextSummary: "auth",
		evidence: ["src/auth.ts"],
		filesToInspect: ["src/auth.ts"],
		flowsToCheck: [],
		rulesToCheck: ["no secrets"],
		constraints: ["review-only"],
		maxCommands: 2,
		maxMinutes: 1,
		tokenBudgetHint: "bounded",
		expectedOutputs: ["reporte"],
		createdAt: "2026-05-25T00:00:00.000Z",
		model: "opencode-go/deepseek-v4-pro",
	});

	const sink: ModelInvocationRecord[] = [];
	const run = await runAgentLabReviewRequest({
		request,
		projectPath,
		router,
		stateRoot,
		invocationSink: (record) => sink.push(record),
	});

	assert.equal(
		run.status,
		"completed",
		`run=${JSON.stringify({ status: run.status, rawSummary: run.rawSummary, contractValidation: run.contractValidation, parsed: run.parsedReport?.status, errors: run.contractValidation?.errors })}`,
	);
	// The runner used promptForRole, which spawns a session with
	// --provider opencode-go --model deepseek-v4-pro.
	const directPiArgs = created
		.map((entry) => entry.options.piArgs ?? [])
		.find(
			(args) =>
				args.includes("--provider") &&
				args.includes("opencode-go") &&
				args.includes("--model") &&
				args.includes("deepseek-v4-pro"),
		);
	assert.ok(
		directPiArgs,
		"expected a session created with --provider opencode-go --model deepseek-v4-pro",
	);
	// The sink got exactly one record with role=agentlab-security and the
	// direct-model model id.
	assert.equal(sink.length, 1);
	assert.equal(sink[0]?.status, "success");
	assert.equal(sink[0]?.role, "agentlab-security");
	assert.equal(sink[0]?.provider, "opencode-go");
	assert.equal(sink[0]?.model, "deepseek-v4-pro");

	rmSync(workspaceRoot, { recursive: true, force: true });
	rmSync(stateRoot, { recursive: true, force: true });
});

test("runner falls back to the existing profile path when request.model is not set", async () => {
	const projectPath = gitProject();
	const workspaceRoot = mkdtempSync(
		join(tmpdir(), "agentlab-pfr-runner-fallback-"),
	);
	mkdirSync(workspaceRoot, { recursive: true });
	const stateRoot = mkdtempSync(
		join(tmpdir(), "agentlab-pfr-runner-fallback-state-"),
	);
	const { router, created } = makeRouter({
		output: validReport("request-pfr-2"),
		projectPath,
		workspaceRoot,
	});

	const request = buildAgentLabReviewRequest({
		id: "request-pfr-2",
		projectId: "pi-telegram-bridge",
		projectPath,
		specialty: "security",
		trigger: "manual",
		objective: "audit auth",
		contextSummary: "auth",
		evidence: ["src/auth.ts"],
		filesToInspect: ["src/auth.ts"],
		flowsToCheck: [],
		rulesToCheck: ["no secrets"],
		constraints: ["review-only"],
		maxCommands: 2,
		maxMinutes: 1,
		tokenBudgetHint: "bounded",
		expectedOutputs: ["reporte"],
		createdAt: "2026-05-25T00:00:00.000Z",
		// No model field: back-compat path.
	});

	const sink: ModelInvocationRecord[] = [];
	const run = await runAgentLabReviewRequest({
		request,
		projectPath,
		router,
		stateRoot,
		invocationSink: (record) => sink.push(record),
	});

	assert.equal(run.status, "completed");
	// The fallback path: the session is created with the security profile's
	// existing piArgs (empty for the "security" profile), not
	// --provider/--model.
	const hasDirectPiArgs = created.some(
		(args) =>
			(args.options.piArgs ?? []).includes("--provider") &&
			(args.options.piArgs ?? []).includes("opencode-go"),
	);
	assert.equal(
		hasDirectPiArgs,
		false,
		"fallback path must not use --provider/--model direct-model flags",
	);
	// No promptForRole means no invocation record.
	assert.equal(sink.length, 0);

	rmSync(workspaceRoot, { recursive: true, force: true });
	rmSync(stateRoot, { recursive: true, force: true });
});
