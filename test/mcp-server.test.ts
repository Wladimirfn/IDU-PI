import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	configureIduSessionStore,
	deactivateIduSession,
	getIduSessionStatus,
} from "../src/idu-session.js";
import {
	callIduMcpTool,
	handleMcpRequest,
	listIduMcpTools,
	type IduMcpProjectResolution,
	type IduMcpRuntimeFactory,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { IduSupervisorLoopResult } from "../src/idu-supervisor-loop.js";
import type { SemanticAuditStatusReport } from "../src/semantic-audit-command.js";
import type { AgentLabReviewRequestPlan } from "../src/agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewStatus,
} from "../src/agentlab-review-runner.js";
import type { StructuredTask } from "../src/structured-task-queue.js";

const UNUSED = "unused";

function connection(
	projectPath = "C:/projects/sistema",
): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["sin scan reciente"],
		projectId: "sistema_de_mantencion",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "idu-pi idu-preflight <solicitud>",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-25T00:00:00.000Z",
	};
}

function preflight(request: string): ProjectPreflightReport {
	const risky = /loggin|login|auth/iu.test(request);
	return {
		risk: risky ? "high" : "low",
		okToProceed: !risky,
		request,
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		connectionStatus: "ready",
		affectedAreas: risky ? ["auth/seguridad", "login"] : ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: risky
			? "Pedir confirmación humana antes de implementar."
			: "Puede continuar con alcance acotado.",
		requiresHumanConfirmation: risky,
		shouldRunAgentLab: false,
	};
}

function fakeTask(text: string, active: boolean): StructuredTask {
	return {
		id: active ? "task-20260525-000001" : "task-20260525-000002",
		text: `Bug task. Symptom/context: ${text}`,
		originalText: text,
		category: "bug",
		priority: 10,
		status: "pending",
		createdAt: "2026-05-25T00:00:00.000Z",
		updatedAt: "2026-05-25T00:00:00.000Z",
		projectId: "sistema_de_mantencion",
		guardRisk: /loggin|login/iu.test(text) ? "high" : "low",
		guardStatus:
			active && /loggin|login/iu.test(text) ? "needs_confirmation" : "clear",
		guardReason: active
			? "preflight high; área: auth/seguridad"
			: "Idu-pi inactivo",
		intentConcepts: ["auth"],
	};
}

function fakeRuntime(projectPath = "C:/projects/sistema"): CliRuntime {
	let active = false;
	const tasks: StructuredTask[] = [];
	const runtime = {
		projectId: "sistema_de_mantencion",
		projectPath,
		workspaceRoot: "C:/idu/workspace",
		inspectConnection: () => connection(projectPath),
		formatConnection: () => "connection",
		formatDashboard: () => "dashboard",
		preflight,
		formatPreflight: () => "preflight",
		advisory: (request: string): ProjectAdvisory => ({
			level: preflight(request).risk === "high" ? "risk" : "info",
			title: "Idu-pi Advisory",
			request,
			affectedAreas: preflight(request).affectedAreas,
			missingContext: [],
			warnings: [],
			availableContext: [],
			recommendation: preflight(request).recommendedNext,
			actions: ["Pedir confirmación humana"],
			requiresHumanConfirmation: preflight(request).requiresHumanConfirmation,
			okToProceed: preflight(request).okToProceed,
		}),
		formatAdvisory: () => "advisory",
		postflight: (): ProjectPostflightReport => ({
			risk: "low",
			changedFiles: ["src/auth.ts"],
			impactedAreas: ["seguridad"],
			warnings: [],
			recommendedNext: "Revisar cambios.",
			shouldRunAgentLab: false,
			suggestedAgentLabs: [],
			requiresHumanConfirmation: false,
		}),
		formatPostflight: () => "postflight",
		prepare: (): IduPrepareResult => ({
			projectId: "sistema_de_mantencion",
			projectPath,
			initialStatus: "ready",
			configStatus: "project_local_valid",
			alignmentStatus: "pending_scan",
			readiness: "config_ready",
			differencesDetected: {
				screens: 0,
				uiElements: 0,
				dataStores: 0,
				flows: 0,
			},
			steps: [],
			errors: [],
			finalRisk: "low",
			recommendedNext: "Listo para preflight.",
			suggestedActions: [],
		}),
		formatPrepare: () => "prepare",
		labReviewPlan: () => {
			throw new Error(UNUSED);
		},
		formatLabReviewPlan: () => UNUSED,
		semanticAuditStatus: (): SemanticAuditStatusReport => ({
			projectId: "sistema_de_mantencion",
			stats: {
				projectId: "sistema_de_mantencion",
				labRunCount: 0,
				findingCount: 0,
				proposalCount: 0,
				taskCount: 0,
				userSignalCount: 0,
				memoryItemCount: 0,
				criticalFindingCount: 0,
				highFindingCount: 0,
			},
			checkpoint: {
				projectId: "sistema_de_mantencion",
				lastLabRunCount: 0,
				lastFindingCount: 0,
				lastProposalCount: 0,
				lastTaskCount: 0,
				lastUserSignalCount: 0,
				lastMemoryItemCount: 0,
				lastCriticalFindingCount: 0,
				lastHighFindingCount: 0,
			},
			newEvents: {
				labRuns: 0,
				findings: 0,
				proposals: 0,
				tasks: 0,
				userSignals: 0,
				memoryItems: 0,
				criticalFindings: 0,
				highFindings: 0,
			},
			decision: {
				shouldRun: false,
				triggerReason: "not_enough_data",
				newEventCount: 0,
			},
			recommendedNext: "Esperar umbral.",
		}),
		formatSemanticAuditStatus: () => "semantic status",
		semanticAuditRun: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAuditRun: () => UNUSED,
		semanticCompactionDraft: () => {
			throw new Error(UNUSED);
		},
		formatSemanticCompactionDraft: () => UNUSED,
		semanticCompactionReview: () => {
			throw new Error(UNUSED);
		},
		formatSemanticCompactionReview: () => UNUSED,
		semanticAgentTaskPlan: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAgentTaskPlan: () => UNUSED,
		semanticAgentTasksCreate: () => {
			throw new Error(UNUSED);
		},
		formatSemanticAgentTaskCreationResult: () => UNUSED,
		supervisorTick: (): IduSupervisorLoopResult =>
			active
				? {
						status: "completed",
						trigger: "manual",
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check",
								status: "active",
								summary: "Idu-pi activo.",
							},
						],
						createdTasks: 0,
						summary: "Tick seguro.",
						recommendedNext: [],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					}
				: {
						status: "skipped",
						reason: "idu_inactive",
						trigger: "manual",
						projectId: "sistema_de_mantencion",
						steps: [
							{
								name: "session_check",
								status: "inactive",
								summary: "Idu-pi inactivo.",
							},
						],
						createdTasks: 0,
						summary: "Idu-pi está apagado.",
						recommendedNext: ["Activar /idu"],
						safety: {
							agentLabsExecuted: false,
							rulesApplied: false,
							memoryDeleted: false,
							projectCoreModified: false,
						},
					},
		formatSupervisorTick: () => "tick",
		supervisorOnIduActivation: () => {
			active = true;
		},
		supervisorImprovementPlan: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementPlan: () => UNUSED,
		supervisorImprovementCreate: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementCreationResult: () => UNUSED,
		supervisorImprovementStatus: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementStatus: () => UNUSED,
		supervisorImprovementApprove: () => {
			throw new Error(UNUSED);
		},
		supervisorImprovementReject: () => {
			throw new Error(UNUSED);
		},
		supervisorImprovementDefer: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorImprovementDecisionResult: () => UNUSED,
		supervisorImprovementsApply: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesApplyResult: () => UNUSED,
		supervisorLearningRulesStatus: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesStatus: () => UNUSED,
		supervisorLearningRulesTest: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesTest: () => UNUSED,
		supervisorLearningRulesDisable: () => {
			throw new Error(UNUSED);
		},
		supervisorLearningRulesEnable: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRuleDecision: () => UNUSED,
		supervisorLearningRulesRollback: () => {
			throw new Error(UNUSED);
		},
		formatSupervisorLearningRulesRollback: () => UNUSED,
		skillImprovementPlan: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementPlan: () => UNUSED,
		skillImprovementCreate: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementCreationResult: () => UNUSED,
		skillImprovementStatus: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementStatus: () => UNUSED,
		skillImprovementApprove: () => {
			throw new Error(UNUSED);
		},
		skillImprovementReject: () => {
			throw new Error(UNUSED);
		},
		skillImprovementDefer: () => {
			throw new Error(UNUSED);
		},
		formatSkillImprovementDecisionResult: () => UNUSED,
		skillDraftsCreate: () => {
			throw new Error(UNUSED);
		},
		formatSkillDraftCreationResult: () => UNUSED,
		skillDraftReview: () => {
			throw new Error(UNUSED);
		},
		formatSkillDraftReview: () => UNUSED,
		agentLabRequestCreate: (source: string): AgentLabReviewRequestPlan => ({
			generatedAt: "2026-05-25T00:00:00.000Z",
			projectId: "sistema_de_mantencion",
			source:
				source === "skill-draft"
					? "skill_draft"
					: source === "master-plan"
						? "master_plan"
						: "postflight",
			warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
			requests: [],
			errors: [],
			path: "C:/idu/workspace/reports/agentlab-review-request-20260525-000000.json",
		}),
		formatAgentLabReviewRequestPlan: () => "agentlab request",
		agentLabRequestReview: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabReviewRequestReview: () => UNUSED,
		agentLabReviewRun: async (): Promise<AgentLabReviewRunResult> => ({
			generatedAt: "2026-05-25T00:00:00.000Z",
			sourceRequestFile: "request.json",
			warning: "Revisión AgentLab. No aplica cambios.",
			projectId: "sistema_de_mantencion",
			runs: [],
			consolidatedSummary: "Sin hallazgos.",
			consolidatedFindings: [],
			recommendedNext: "Revisar reporte.",
			requiresHumanApproval: false,
			safeNotes: ["Review-only sandbox."],
			path: "C:/idu/workspace/reports/agentlab-review-run-20260525-000000.json",
		}),
		formatAgentLabReviewRunResult: () => "agentlab run",
		agentLabReviewStatus: (): AgentLabReviewStatus => ({
			path: "run.json",
			name: "run.json",
			valid: true,
			errors: [],
			result: {
				generatedAt: "2026-05-25T00:00:00.000Z",
				sourceRequestFile: "request.json",
				warning: "Revisión AgentLab. No aplica cambios.",
				projectId: "sistema_de_mantencion",
				runs: [],
				consolidatedSummary: "Sin hallazgos.",
				consolidatedFindings: [],
				recommendedNext: "Revisar reporte.",
				requiresHumanApproval: false,
				safeNotes: [],
			},
		}),
		formatAgentLabReviewStatus: () => "agentlab status",
		agentLabReportConsolidate: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabConsolidationResult: () => UNUSED,
		agentLabReportConsolidationStatus: () => {
			throw new Error(UNUSED);
		},
		formatAgentLabConsolidationStatus: () => UNUSED,
		createTask: (_kind: string, details: string) => {
			const task = fakeTask(details, active);
			tasks.push(task);
			return task;
		},
		formatTask: () => "task",
		queueDetail: () => JSON.stringify(tasks),
		listTasks: () => tasks,
		queueClearStructured: () => 0,
		queueApprove: () => undefined,
		queueReject: () => undefined,
	} satisfies CliRuntime & { listTasks: () => StructuredTask[] };
	return runtime;
}

function registered(
	projectPath = "C:/projects/sistema",
): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "sistema_de_mantencion",
		projectPath,
		safeNotes: [],
		errors: [],
	};
}

function factory(): IduMcpRuntimeFactory {
	return (projectPath) => fakeRuntime(projectPath);
}

test("mcp server lists Idu-pi tools", async () => {
	const tools = listIduMcpTools();
	assert.ok(tools.some((tool) => tool.name === "idu_status"));
	assert.ok(tools.some((tool) => tool.name === "idu_project_enroll"));
	assert.ok(tools.some((tool) => tool.name === "idu_bootstrap_project"));
	assert.ok(tools.some((tool) => tool.name === "idu_start"));
	assert.ok(tools.some((tool) => tool.name === "idu_agentlab_review_run"));
	assert.equal(tools.length, 18);
});

test("idu_status works with explicit projectPath", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{ projectPath: "C:/projects/sistema" },
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/sistema"),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.tool, "idu_status");
	assert.equal(result.projectId, "sistema_de_mantencion");
	assert.equal(result.projectPath, "C:/projects/sistema");
	assert.equal(result.data.configStatus, "project_local_valid");
});

test("idu_status works with mocked active project", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{},
		{
			runtimeFactory: factory(),
			projectResolver: () => registered("C:/projects/active"),
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.projectPath, "C:/projects/active");
});

test("idu_activate and idu_deactivate change session state", async () => {
	configureIduSessionStore({
		workspaceRoot: "C:/idu/workspace",
		filePath: join(process.cwd(), "dist", "test-session-state.json"),
	});
	deactivateIduSession("sistema_de_mantencion");
	const activate = await callIduMcpTool(
		"idu_activate",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(activate.ok, true);
	assert.equal(activate.data.active, true);
	const deactivate = await callIduMcpTool(
		"idu_deactivate",
		{},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(deactivate.ok, true);
	assert.equal(deactivate.data.active, false);
});

test("idu_preflight detects high auth/login risk", async () => {
	const result = await callIduMcpTool(
		"idu_preflight",
		{ request: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, true);
	assert.equal(result.data.risk, "high");
	assert.equal(result.data.requiresHumanConfirmation, true);
	assert.deepEqual(result.data.detectedImpact, ["auth/seguridad", "login"]);
});

test("idu_task respects active and inactive guardrails", async () => {
	const activeRuntime = fakeRuntime();
	activeRuntime.supervisorOnIduActivation();
	const active = await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{
			runtimeFactory: () => activeRuntime,
			projectResolver: () => registered(),
		},
	);
	assert.equal(active.data.guardStatus, "needs_confirmation");
	assert.equal(active.data.guardRisk, "high");

	const inactive = await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.notEqual(inactive.data.guardStatus, "needs_confirmation");
});

test("idu_supervisor_tick skips when inactive", async () => {
	const result = await callIduMcpTool(
		"idu_supervisor_tick",
		{ allowSemanticDraft: false, allowAgentTaskPlan: false },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(result.ok, true);
	assert.equal(result.data.status, "skipped");
	assert.equal(result.data.reason, "idu_inactive");
});

test("idu_queue_detail returns complete ids and guard status", async () => {
	const runtime = fakeRuntime();
	runtime.supervisorOnIduActivation();
	await callIduMcpTool(
		"idu_task",
		{ text: "fallo el loggin" },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	const detail = await callIduMcpTool(
		"idu_queue_detail",
		{},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);
	assert.equal(detail.ok, true);
	const queueData = detail.data as {
		tasks: Array<{ id: string; guardStatus: string }>;
	};
	assert.equal(queueData.tasks[0].id, "task-20260525-000001");
	assert.equal(queueData.tasks[0].guardStatus, "needs_confirmation");
});

test("MCP tool output always includes required JSON envelope", async () => {
	const result = await callIduMcpTool(
		"idu_advisory",
		{ request: "fallo el loggin" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	for (const key of [
		"ok",
		"tool",
		"projectId",
		"projectPath",
		"summary",
		"data",
		"safeNotes",
		"errors",
	]) {
		assert.ok(key in result, key);
	}
});

test("unregistered projectPath returns clear diagnostic", async () => {
	const result = await callIduMcpTool(
		"idu_status",
		{ projectPath: "C:/projects/unknown" },
		{
			runtimeFactory: factory(),
			projectResolver: () => ({
				status: "unregistered_project",
				projectId: "unknown",
				projectPath: "C:/projects/unknown",
				safeNotes: [],
				errors: ["Proyecto no registrado: C:/projects/unknown"],
				recommendedNext: "Registrá el proyecto en Idu-pi antes de usar MCP.",
			}),
		},
	);
	assert.equal(result.ok, false);
	assert.equal(result.data.resolutionStatus, "unregistered_project");
	assert.match(result.summary, /no registrado/i);
});

test("mcp server source does not import Telegram entrypoint", () => {
	const source = readFileSync(
		join(process.cwd(), "src", "mcp-server.ts"),
		"utf8",
	);
	assert.doesNotMatch(source, /\.\/index\.js/u);
	assert.doesNotMatch(source, /grammy|new Bot|Bot\(/u);
});

test("JSON-RPC initialize, notifications, and tool calls work", async () => {
	const init = await handleMcpRequest({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {},
	});
	assert.equal(init?.jsonrpc, "2.0");
	assert.equal(init?.id, 1);
	const initResult = init?.result as {
		capabilities: { tools: { listChanged: boolean } };
	};
	assert.equal(initResult.capabilities.tools.listChanged, false);

	const notification = await handleMcpRequest({
		jsonrpc: "2.0",
		method: "notifications/initialized",
		params: {},
	});
	assert.equal(notification, undefined);

	const call = await handleMcpRequest(
		{
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "idu_status", arguments: {} },
		},
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(call?.id, 2);
	const callResult = call?.result as {
		content: Array<{ type: string; text: string }>;
	};
	assert.equal(callResult.content[0].type, "text");
	const body = JSON.parse(callResult.content[0].text) as {
		ok: boolean;
		tool: string;
	};
	assert.equal(body.ok, true);
	assert.equal(body.tool, "idu_status");
});

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
	return {
		DEFAULT_CWD: process.env.DEFAULT_CWD,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function setMcpEnv(root: string, projectPath: string): string {
	const workspaceRoot = join(root, "workspace");
	const registryPath = join(root, "registry", "projects.json");
	process.env.DEFAULT_CWD = projectPath;
	process.env.ALLOWED_ROOTS = root;
	process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	delete process.env.TELEGRAM_BOT_TOKEN;
	delete process.env.ALLOWED_USER_ID;
	return registryPath;
}

test("idu_project_status does not write files for unregistered project", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-status-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const registryPath = setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_project_status", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.data.registered, false);
		assert.equal(existsSync(registryPath), false);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_enroll registers project and creates isolated state only", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-enroll-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_project_enroll", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.projectId, "project");
		const statePaths = result.data.statePaths as {
			stateRoot: string;
			reportsDir: string;
			agentLabReportsDir: string;
		};
		assert.equal(existsSync(statePaths.stateRoot), true);
		assert.equal(existsSync(statePaths.reportsDir), true);
		assert.equal(existsSync(statePaths.agentLabReportsDir), true);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
		assert.equal(
			existsSync(join(projectPath, "config", "project-constitution.json")),
			false,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_status reports registered project after enroll", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-status-registered-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, projectPath);
	try {
		await callIduMcpTool("idu_project_enroll", { projectPath });
		const result = await callIduMcpTool("idu_project_status", { projectPath });
		assert.equal(result.ok, true);
		assert.equal(result.data.registered, true);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_project_enroll rejects paths outside allowed roots", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-enroll-deny-"));
	const outside = mkdtempSync(join(tmpdir(), "idu-mcp-outside-"));
	const previous = snapshotEnv();
	setMcpEnv(root, root);
	try {
		const result = await callIduMcpTool("idu_project_enroll", {
			projectPath: outside,
		});
		assert.equal(result.ok, false);
		assert.match(result.summary, /ALLOWED_ROOTS/u);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("idu_bootstrap_project creates drafts only when explicitly allowed and activates when requested", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-bootstrap-"));
	const noDraftsPath = join(root, "no-drafts");
	const draftsPath = join(root, "drafts");
	mkdirSync(noDraftsPath, { recursive: true });
	mkdirSync(draftsPath, { recursive: true });
	const previous = snapshotEnv();
	setMcpEnv(root, noDraftsPath);
	try {
		const noDrafts = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: noDraftsPath,
			allowCreateDrafts: false,
			activate: false,
		});
		assert.equal(noDrafts.ok, true);
		assert.equal(
			existsSync(join(noDraftsPath, "config", "project-core.json")),
			false,
		);

		const withDraftsInactive = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: draftsPath,
			allowCreateDrafts: true,
			activate: false,
		});
		assert.equal(withDraftsInactive.ok, true);
		assert.equal(
			existsSync(join(draftsPath, "config", "project-core.json")),
			true,
		);
		assert.equal(
			existsSync(join(draftsPath, "config", "project-constitution.json")),
			true,
		);
		assert.equal(
			getIduSessionStatus(String(withDraftsInactive.projectId)).active,
			false,
		);

		const withDrafts = await callIduMcpTool("idu_bootstrap_project", {
			projectPath: draftsPath,
			allowCreateDrafts: true,
			activate: true,
		});
		assert.equal(withDrafts.ok, true);
		assert.equal(
			getIduSessionStatus(String(withDrafts.projectId)).active,
			true,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_start does not enroll unregistered projects and activates registered projects", async () => {
	const unregistered = await callIduMcpTool(
		"idu_start",
		{ projectPath: "C:/projects/new" },
		{
			projectResolver: () => ({
				status: "unregistered_project",
				projectId: "new",
				projectPath: "C:/projects/new",
				recommendedNext: "Use enroll.",
				safeNotes: [],
				errors: ["not registered"],
			}),
			runtimeFactory: factory(),
		},
	);
	assert.equal(unregistered.ok, false);
	assert.match(
		String(unregistered.data.recommendedNext),
		/idu_project_enroll/u,
	);

	const registeredStart = await callIduMcpTool(
		"idu_start",
		{ projectPath: "C:/projects/sistema" },
		{ projectResolver: () => registered(), runtimeFactory: factory() },
	);
	assert.equal(registeredStart.ok, true);
	assert.equal(registeredStart.data.active, true);
});

test("idu_activate remains activate-only and does not bootstrap unregistered projects", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-mcp-activate-only-"));
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	const previous = snapshotEnv();
	const registryPath = setMcpEnv(root, projectPath);
	try {
		const result = await callIduMcpTool("idu_activate", { projectPath });
		assert.equal(result.ok, false);
		assert.equal(existsSync(registryPath), false);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
		);
	} finally {
		restoreEnv(previous);
		rmSync(root, { recursive: true, force: true });
	}
});

test("agentlab review run is the only AgentLab execution tool and reports sandbox notes", async () => {
	const request = await callIduMcpTool(
		"idu_agentlab_request_create",
		{ source: "postflight", selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.match(request.summary, /solicitud/i);
	assert.ok(
		request.safeNotes.some((note) => /No ejecuté AgentLabs/u.test(note)),
	);

	const run = await callIduMcpTool(
		"idu_agentlab_review_run",
		{ selector: "latest" },
		{ runtimeFactory: factory(), projectResolver: () => registered() },
	);
	assert.equal(run.ok, true);
	assert.match(run.summary, /review/i);
	assert.ok(
		run.safeNotes.some((note) => /sandbox|review-only|clone/iu.test(note)),
	);
});
