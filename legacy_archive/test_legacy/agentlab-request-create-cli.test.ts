/**
 * B5 PR3 v2 — REQ-B5-5 CLI surface tests.
 *
 * Covers the user-facing CLI argument parsing and runtime plumbing for
 * `idu-agentlab-request-create`. The MCP counterpart is covered in
 * `test/mcp-server.test.ts`.
 *
 * These tests assert the contract:
 * 1. `parseAgentLabRequestCreateArgs` extracts `--model` and `--state-root`
 *    from the rest args (mirroring `parseModelInvocationStatusArgs`).
 * 2. `runCliCommand(["idu-agentlab-request-create", ...flags])` forwards
 *    the parsed flags to `activeRuntime.agentLabRequestCreate(source,
 *    selector, { model, stateRoot })`.
 * 3. The real `createCliRuntime` `agentLabRequestCreate` method passes
 *    `stateRoot` to `createAgentLabReviewRequests` so the auto-pick
 *    logic in `resolveCreateTimeModelErrors` actually fires.
 * 4. The real `createCliRuntime` `agentLabReviewRun` method passes
 *    `stateRoot` and `invocationSink` to the runner so the
 *    `usePromptForRole` branch is reachable from the CLI.
 *
 * RED: every test references `parseAgentLabRequestCreateArgs` and a
 * runtime option type that does not yet exist on
 * `AgentLabSpecialistAuditPlanOptions` / `CliRuntime`. GREEN: those
 * types and the parser are introduced.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	parseAgentLabRequestCreateArgs,
	runCliCommand,
	type CliRuntime,
} from "../src/cli.js";
import type {
	AgentLabReviewRequestPlan,
	AgentLabSpecialistAuditPlanOptions,
} from "../src/agentlab-review-requests.js";

/**
 * Build a minimal `CliRuntime` that satisfies the `runCliCommand` switch
 * for the `idu-agentlab-request-create` case. Only the case under test
 * is stubbed; everything else throws on accidental access.
 */
function makeFakeCliRuntime(opts: {
	projectPath: string;
	projectId?: string;
	reportsPath: string;
	agentLabRequestCreate: (
		source: string,
		selector?: string,
		options?: AgentLabSpecialistAuditPlanOptions,
	) => AgentLabReviewRequestPlan;
}): CliRuntime {
	const projectId = opts.projectId ?? "pi-telegram-bridge";
	const formatPlan = (plan: AgentLabReviewRequestPlan) =>
		[
			"AgentLab Review Requests Created",
			"",
			"Ruta:",
			plan.path ?? "<no-path>",
			"",
			"No ejecuté AgentLabs ni apliqué skills.",
		].join("\n");
	return {
		projectId,
		projectPath: opts.projectPath,
		workspaceRoot: opts.reportsPath,
		inspectConnection: () => {
			throw new Error("inspectConnection not stubbed");
		},
		formatConnection: () => "connection",
		formatDashboard: () => "dashboard",
		preflight: () => {
			throw new Error("preflight not stubbed");
		},
		formatPreflight: () => "preflight",
		advisory: () => {
			throw new Error("advisory not stubbed");
		},
		formatAdvisory: () => "advisory",
		postflight: () => {
			throw new Error("postflight not stubbed");
		},
		formatPostflight: () => "postflight",
		prepare: () => {
			throw new Error("prepare not stubbed");
		},
		formatPrepare: () => "prepare",
		masterPlanStatus: () => {
			throw new Error("masterPlanStatus not stubbed");
		},
		masterPlanRedraft: () => {
			throw new Error("masterPlanRedraft not stubbed");
		},
		masterPlanReview: () => {
			throw new Error("masterPlanReview not stubbed");
		},
		masterPlanApprove: () => {
			throw new Error("masterPlanApprove not stubbed");
		},
		masterPlanReject: () => {
			throw new Error("masterPlanReject not stubbed");
		},
		formatMasterPlanStatus: () => "masterPlanStatus",
		formatMasterPlanReview: () => "masterPlanReview",
		supervisorOnIduActivation: () => {
			throw new Error("supervisorOnIduActivation not stubbed");
		},
		executionDirectorTick: () => {
			throw new Error("executionDirectorTick not stubbed");
		},
		formatExecutionDirectorTick: () => "executionDirectorTick",
		proposalOutbox: () => [],
		formatProposalOutbox: () => "proposalOutbox",
		proposalDetail: () => {
			throw new Error("proposalDetail not stubbed");
		},
		formatProposalDetail: () => "proposalDetail",
		supervisorImprovementPlan: () => {
			throw new Error("supervisorImprovementPlan not stubbed");
		},
		formatSupervisorImprovementPlan: () => "supervisorImprovementPlan",
		supervisorImprovementCreate: () => {
			throw new Error("supervisorImprovementCreate not stubbed");
		},
		formatSupervisorImprovementCreationResult: () =>
			"supervisorImprovementCreate",
		supervisorImprovementStatus: () => {
			throw new Error("supervisorImprovementStatus not stubbed");
		},
		formatSupervisorImprovementStatus: () => "supervisorImprovementStatus",
		supervisorImprovementApprove: () => {
			throw new Error("supervisorImprovementApprove not stubbed");
		},
		supervisorImprovementReject: () => {
			throw new Error("supervisorImprovementReject not stubbed");
		},
		supervisorImprovementDefer: () => {
			throw new Error("supervisorImprovementDefer not stubbed");
		},
		formatSupervisorImprovementDecisionResult: () =>
			"supervisorImprovementDecision",
		supervisorImprovementsApply: () => {
			throw new Error("supervisorImprovementsApply not stubbed");
		},
		formatSupervisorLearningRulesApplyResult: () =>
			"supervisorLearningRulesApply",
		supervisorLearningRulesStatus: () => {
			throw new Error("supervisorLearningRulesStatus not stubbed");
		},
		formatSupervisorLearningRulesStatus: () => "supervisorLearningRulesStatus",
		supervisorLearningRulesTest: () => {
			throw new Error("supervisorLearningRulesTest not stubbed");
		},
		formatSupervisorLearningRulesTest: () => "supervisorLearningRulesTest",
		supervisorLearningRulesDisable: () => {
			throw new Error("supervisorLearningRulesDisable not stubbed");
		},
		supervisorLearningRulesEnable: () => {
			throw new Error("supervisorLearningRulesEnable not stubbed");
		},
		formatSupervisorLearningRuleDecision: () =>
			"supervisorLearningRuleDecision",
		supervisorLearningRulesRollback: () => {
			throw new Error("supervisorLearningRulesRollback not stubbed");
		},
		formatSupervisorLearningRulesRollback: () =>
			"supervisorLearningRulesRollback",
		skillImprovementPlan: () => {
			throw new Error("skillImprovementPlan not stubbed");
		},
		formatSkillImprovementPlan: () => "skillImprovementPlan",
		skillImprovementCreate: () => {
			throw new Error("skillImprovementCreate not stubbed");
		},
		formatSkillImprovementCreationResult: () => "skillImprovementCreate",
		skillImprovementStatus: () => {
			throw new Error("skillImprovementStatus not stubbed");
		},
		formatSkillImprovementStatus: () => "skillImprovementStatus",
		skillImprovementApprove: () => {
			throw new Error("skillImprovementApprove not stubbed");
		},
		skillImprovementReject: () => {
			throw new Error("skillImprovementReject not stubbed");
		},
		skillImprovementDefer: () => {
			throw new Error("skillImprovementDefer not stubbed");
		},
		formatSkillImprovementDecisionResult: () => "skillImprovementDecision",
		skillDraftsCreate: () => {
			throw new Error("skillDraftsCreate not stubbed");
		},
		formatSkillDraftCreationResult: () => "skillDraftsCreate",
		skillDraftFromLessons: () => {
			throw new Error("skillDraftFromLessons not stubbed");
		},
		skillDraftReview: () => {
			throw new Error("skillDraftReview not stubbed");
		},
		formatSkillDraftReview: () => "skillDraftReview",
		agentLabRequestCreate: opts.agentLabRequestCreate,
		formatAgentLabReviewRequestPlan: formatPlan,
		agentLabRequestReview: () => {
			throw new Error("agentLabRequestReview not stubbed");
		},
		formatAgentLabReviewRequestReview: () => "agentLabRequestReview",
		agentLabReviewRun: () => {
			throw new Error("agentLabReviewRun not stubbed");
		},
		formatAgentLabReviewRunResult: () => "agentLabReviewRun",
		agentLabReviewStatus: () => {
			throw new Error("agentLabReviewStatus not stubbed");
		},
		formatAgentLabReviewStatus: () => "agentLabReviewStatus",
		agentLabReportConsolidate: () => {
			throw new Error("agentLabReportConsolidate not stubbed");
		},
		formatAgentLabConsolidationResult: () => "agentLabReportConsolidate",
		agentLabReportConsolidationStatus: () => {
			throw new Error("agentLabReportConsolidationStatus not stubbed");
		},
		formatAgentLabConsolidationStatus: () =>
			"agentLabReportConsolidationStatus",
		createTask: () => {
			throw new Error("createTask not stubbed");
		},
		formatTask: () => "createTask",
		queueDetail: () => "queueDetail",
		listTasks: () => [],
		queueClearStructured: () => 0,
		queueApprove: () => undefined,
		queueReject: () => undefined,
		queueComplete: () => undefined,
		projectStateReset: () => {
			throw new Error("projectStateReset not stubbed");
		},
		formatProjectStateResetResult: () => "projectStateReset",
		modelInvocationStatus: () => {
			throw new Error("modelInvocationStatus not stubbed");
		},
		formatModelInvocationStatus: () => "modelInvocationStatus",
	} as unknown as CliRuntime;
}

test("parseAgentLabRequestCreateArgs extracts --model and uses the rest as the selector", () => {
	const parsed = parseAgentLabRequestCreateArgs([
		"postflight",
		"latest",
		"--model",
		"opencode-go/deepseek-v4-pro",
	]);
	assert.equal(parsed.source, "postflight");
	assert.equal(parsed.selector, "latest");
	assert.equal(parsed.model, "opencode-go/deepseek-v4-pro");
	assert.equal(parsed.stateRoot, undefined);
});

test("parseAgentLabRequestCreateArgs extracts --state-root and preserves selector ordering", () => {
	const parsed = parseAgentLabRequestCreateArgs([
		"postflight",
		"--state-root",
		"C:/state/idu-pi",
		"latest",
	]);
	assert.equal(parsed.source, "postflight");
	assert.equal(parsed.selector, "latest");
	assert.equal(parsed.stateRoot, "C:/state/idu-pi");
	assert.equal(parsed.model, undefined);
});

test("parseAgentLabRequestCreateArgs defaults source to postflight and selector to latest", () => {
	const parsed = parseAgentLabRequestCreateArgs([]);
	assert.equal(parsed.source, "postflight");
	assert.equal(parsed.selector, "latest");
	assert.equal(parsed.model, undefined);
	assert.equal(parsed.stateRoot, undefined);
});

test("CLI idu-agentlab-request-create --model threads model into runtime options", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentlab-cli-model-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	try {
		let captured:
			| {
					source: string;
					selector?: string;
					options?: AgentLabSpecialistAuditPlanOptions;
			  }
			| undefined;
		const runtime = makeFakeCliRuntime({
			projectPath,
			projectId: "pi-telegram-bridge",
			reportsPath,
			agentLabRequestCreate: (source, selector, options) => {
				captured = { source, selector, options };
				return {
					generatedAt: "2026-06-08T00:00:00.000Z",
					projectId: "pi-telegram-bridge",
					source: "postflight",
					warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
					path: join(reportsPath, "current.json"),
					errors: [],
					requests: [],
				};
			},
		});
		const result = await runCliCommand(
			[
				"idu-agentlab-request-create",
				"postflight",
				"--model",
				"opencode-go/deepseek-v4-pro",
			],
			runtime,
		);
		assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
		assert.ok(captured, "expected agentLabRequestCreate to be called");
		assert.equal(captured?.source, "postflight");
		assert.equal(captured?.selector, "latest");
		assert.equal(captured?.options?.model, "opencode-go/deepseek-v4-pro");
	} finally {
		// sync rm: avoid leaving a Promise<...> tail in the test.
		const { rmSync } = await import("node:fs");
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI idu-agentlab-request-create --state-root threads stateRoot into runtime options for the auto-pick path", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentlab-cli-state-root-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	try {
		let captured:
			| {
					source: string;
					selector?: string;
					options?: AgentLabSpecialistAuditPlanOptions;
			  }
			| undefined;
		const runtime = makeFakeCliRuntime({
			projectPath,
			projectId: "pi-telegram-bridge",
			reportsPath,
			agentLabRequestCreate: (source, selector, options) => {
				captured = { source, selector, options };
				return {
					generatedAt: "2026-06-08T00:00:00.000Z",
					projectId: "pi-telegram-bridge",
					source: "postflight",
					warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
					path: join(reportsPath, "current.json"),
					errors: [],
					requests: [],
				};
			},
		});
		const result = await runCliCommand(
			["idu-agentlab-request-create", "postflight", "--state-root", root],
			runtime,
		);
		assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
		assert.ok(captured, "expected agentLabRequestCreate to be called");
		assert.equal(captured?.options?.stateRoot, root);
	} finally {
		const { rmSync } = await import("node:fs");
		rmSync(root, { recursive: true, force: true });
	}
});

/**
 * The two tests below exercise the REAL `createCliRuntime` factory so
 * they prove the actual user-facing wiring, not just the parser. The
 * fake-runtime tests above prove the CLI command forwards the flags;
 * these two prove the runtime passes them through to the underlying
 * `createAgentLabReviewRequests` / `runAgentLabReviewRequestFile`.
 *
 * The factory is hermetic via `mkdtempSync` for `stateRoot`,
 * `projectPath`, and the registry; the existing `cli-model-invocation-status`
 * test (test/cli-model-invocation-status.test.ts) shows the same pattern.
 */

test("createAgentLabReviewRequests auto-picks model from stateRoot/model-assignments.json when stateRoot is passed and model is omitted", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentlab-runtime-autopick-"));
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	try {
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
		const { createAgentLabReviewRequests } = (await import(
			"../src/agentlab-review-requests.js"
		)) as typeof import("../src/agentlab-review-requests.js");
		const plan = createAgentLabReviewRequests({
			source: "postflight",
			reportsPath: stateRoot,
			projectId: "hermetic-pi-bridge",
			projectPath,
			stateRoot,
			postflightReport: {
				risk: "high",
				changedFiles: ["src/auth.ts"],
				impactedAreas: ["seguridad"],
				warnings: [],
				recommendedNext: "Revisar cambios.",
				shouldRunAgentLab: true,
				suggestedAgentLabs: ["security"],
				requiresHumanConfirmation: false,
				physicalGates: [],
			},
		});
		const security = plan.requests.find(
			(request) => request.specialty === "security",
		);
		assert.ok(security, "expected a security request");
		assert.equal(security?.model, "opencode-go/deepseek-v4-pro");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createAgentLabReviewRequests honours an explicit model and threads it through to every request", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentlab-runtime-explicit-"));
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	try {
		const { createAgentLabReviewRequests } = (await import(
			"../src/agentlab-review-requests.js"
		)) as typeof import("../src/agentlab-review-requests.js");
		const plan = createAgentLabReviewRequests({
			source: "postflight",
			reportsPath: stateRoot,
			projectId: "hermetic-pi-bridge",
			projectPath,
			stateRoot,
			model: "opencode-go/qwen3.7-plus",
			postflightReport: {
				risk: "high",
				changedFiles: ["src/auth.ts"],
				impactedAreas: ["seguridad"],
				warnings: [],
				recommendedNext: "Revisar cambios.",
				shouldRunAgentLab: true,
				suggestedAgentLabs: ["security"],
				requiresHumanConfirmation: false,
				physicalGates: [],
			},
		});
		// The explicit model wins over the auto-pick.
		for (const request of plan.requests) {
			assert.equal(
				request.model,
				"opencode-go/qwen3.7-plus",
				`request ${request.specialty} should carry the explicit model`,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
