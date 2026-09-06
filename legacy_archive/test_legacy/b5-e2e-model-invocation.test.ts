/**
 * B5 end-to-end smoke: when idu-pi uses a configured model role, the
 * invocation lands in lab.db model_invocation_log with the right
 * provider/model and a success status, and idu-model-invocation-status
 * can read it back.
 *
 * This is the test that the user asked for: does idu-pi actually consume
 * the AI models configured in model-assignments.json?
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import {
	buildModelInvocationStatusOrError,
	formatModelInvocationStatus,
	parseModelInvocationStatusArgs,
} from "../src/cli-model-invocation-status.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { loadModelAssignments } from "../src/model-assignments.js";
import { parseModelAssignment } from "../src/model-assignment-parser.js";
import type { AgentProfile } from "../src/config.js";
import type {
	PiRpcOptions,
	PiRpcProgressEvent,
	PiRpcPromptResult,
} from "../src/pi-rpc.js";

class FakeSession implements AgentSession {
	readonly cwd: string;
	readonly piArgs: string[];
	readonly prompts: string[] = [];
	running = false;
	busy = false;

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

function seedEnv(): {
	root: string;
	stateRoot: string;
	projectPath: string;
	labDbPath: string;
} {
	const root = mkdtempSync(join(tmpdir(), "b5-e2e-"));
	const stateRoot = join(root, "state");
	const projectPath = join(root, "project");
	mkdirSync(stateRoot, { recursive: true });
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(join(stateRoot, "projects", "idu-pi"), { recursive: true });
	const labDbPath = join(stateRoot, "projects", "idu-pi", "lab.db");
	applyMigrations(labDbPath);
	writeFileSync(
		join(stateRoot, "model-assignments.json"),
		JSON.stringify(
			{
				version: 1,
				assignments: {
					"agentlab-security": "opencode-go/deepseek-v4-pro",
					"agentlab-architecture": "opencode-go/qwen3.7-plus",
					"supervisor-main": "opencode-go/deepseek-v4-pro",
				},
				updatedAt: "2026-06-09T00:00:00.000Z",
			},
			null,
			2,
		) + "\n",
		"utf8",
	);
	return { root, stateRoot, projectPath, labDbPath };
}

function profiles(): AgentProfile[] {
	return [
		{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		{
			id: "agentlab-security",
			label: "AgentLab security",
			provider: "pi",
			piArgs: [],
		},
		{
			id: "agentlab-architecture",
			label: "AgentLab architecture",
			provider: "pi",
			piArgs: [],
		},
	];
}

function makeRouter(
	projectPath: string,
	workspaceRoot: string,
	output: string,
): {
	router: AgentRouter;
	created: Array<{ options: PiRpcOptions; session: FakeSession }>;
} {
	const created: Array<{ options: PiRpcOptions; session: FakeSession }> = [];
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles: profiles(),
		defaultProjectId: "idu-pi",
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

test("B5 E2E — agentRouter.promptForRole records a real invocation in lab.db", async () => {
	const { root, stateRoot, projectPath, labDbPath } = seedEnv();
	try {
		const workspaceRoot = join(root, "workspace");
		mkdirSync(workspaceRoot, { recursive: true });
		const validReport = JSON.stringify({
			id: "report-e2e-1",
			requestId: "req-e2e-1",
			projectId: "idu-pi",
			specialty: "security",
			status: "completed",
			summary: "E2E: model invocation recorded.",
			qualityFindings: [],
			safetyFindings: [],
			architectureFindings: [],
			tokenCostFindings: [],
			timeFindings: [],
			resourceFindings: [],
			testsSuggested: [],
			testsExecuted: ["corepack pnpm test"],
			evidence: ["E2E smoke"],
			recommendations: [],
			proposedSupervisorActions: [],
			suggestedSkillUpdates: [],
			suggestedRuleUpdates: [],
			suggestedAgentTasks: [],
			confidence: "high",
			requiresHumanApproval: true,
			createdAt: "2026-06-09T00:00:00.000Z",
		});
		const { router, created } = makeRouter(
			projectPath,
			workspaceRoot,
			validReport,
		);

		const assignments = loadModelAssignments(stateRoot);
		assert.equal(
			assignments.assignments["agentlab-security"],
			"opencode-go/deepseek-v4-pro",
			"the model-assignments.json should have the opencode-go entry for agentlab-security",
		);
		const parsed = parseModelAssignment(
			assignments.assignments["agentlab-security"],
		);
		assert.equal(parsed.provider, "opencode-go");
		assert.equal(parsed.canonicalId, "opencode-go/deepseek-v4-pro");

		const repository = new LabDbRepository(labDbPath, {
			modelInvocationLogProjectId: "idu-pi",
		});
		const result = await router.promptForRole(
			"agentlab-security",
			"audit auth",
			{
				projectId: "idu-pi",
				stateRoot,
				invocationSink: repository.appendInvocation.bind(repository),
			},
		);
		assert.equal(result.ok, true, "promptForRole should succeed");

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

		const invocations = repository.listRecentInvocations(10);
		const ourInvocation = invocations.find(
			(inv) => inv.role === "agentlab-security",
		);
		assert.ok(
			ourInvocation,
			"expected at least one invocation in lab.db model_invocation_log",
		);
		assert.equal(ourInvocation.provider, "opencode-go");
		assert.equal(ourInvocation.model, "deepseek-v4-pro");
		assert.equal(ourInvocation.status, "success");
		assert.equal(ourInvocation.promptChars, "audit auth".length);
		assert.ok(ourInvocation.responseChars > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("B5 E2E — idu-model-invocation-status reads back the recorded invocation", () => {
	const { root, stateRoot, labDbPath } = seedEnv();
	try {
		const repository = new LabDbRepository(labDbPath, {
			modelInvocationLogProjectId: "idu-pi",
		});
		repository.appendInvocation({
			role: "agentlab-architecture",
			provider: "opencode-go",
			model: "qwen3.7-plus",
			status: "success",
			promptChars: 200,
			responseChars: 500,
			ts: "2026-06-09T00:00:00.000Z",
		});

		const { role, limit } = parseModelInvocationStatusArgs([
			"--role",
			"agentlab-architecture",
		]);
		assert.equal(role, "agentlab-architecture");
		assert.equal(limit, undefined);

		const result = buildModelInvocationStatusOrError({
			projectId: "idu-pi",
			stateRoot,
			labDbPath,
			options: { role, limit },
		});
		assert.equal(result.ok, true);
		if (!result.ok) throw new Error("unreachable");
		const text = formatModelInvocationStatus(result.report);

		assert.match(text, /▸ agentlab-architecture/u);
		assert.match(text, /opencode-go\/qwen3\.7-plus/u);
		assert.match(text, /success/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("B5 E2E — model-assignments.json in the real stateRoot stays structurally valid (skips in CI)", () => {
	const realPath =
		"C:/Users/elmas/Documents/bridge-agents/projects/idu-pi/model-assignments.json";
	if (!existsSync(realPath)) {
		// In CI (and on any other machine) the local stateRoot does not
		// exist; this test is a developer-local smoke only.
		return;
	}
	// Models are EDITABLE by design: the live config may reassign any role
	// to any model at any time, and idu-pi promises that a role's identity
	// does not change when its model changes. Pinning specific model strings
	// here would punish that editability and break the moment a model is
	// reconfigured. We only guard the invariant that the live config stays
	// structurally valid: parseable JSON, a numeric version, and every
	// assignment a well-formed `<provider>/<model>` id.
	const json = JSON.parse(readFileSync(realPath, "utf8"));
	assert.equal(
		typeof json.version,
		"number",
		"config must carry a numeric version",
	);
	const assignments = json.assignments as Record<string, string>;
	assert.ok(
		assignments && typeof assignments === "object",
		"config must carry an assignments map",
	);
	const roles = Object.keys(assignments);
	assert.ok(roles.length > 0, "config must assign at least one role");
	for (const role of roles) {
		const parsed = parseModelAssignment(assignments[role]);
		assert.equal(
			parsed.canonicalId,
			`${parsed.provider}/${parsed.model}`,
			`role ${role}: assignment must be a well-formed provider/model id`,
		);
	}
});
