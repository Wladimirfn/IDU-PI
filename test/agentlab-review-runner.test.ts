import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import {
	buildAgentLabReviewRequest,
	type AgentLabSpecialty,
} from "../src/agentlab-supervisor-contract.js";
import { createAgentLabReviewRequests } from "../src/agentlab-review-requests.js";
import {
	formatAgentLabReviewRunResult,
	formatAgentLabReviewStatus,
	getAgentLabReviewStatus,
	parseAgentLabReviewReportFromOutput,
	runAgentLabReviewRequest,
	runAgentLabReviewRequestFile,
} from "../src/agentlab-review-runner.js";
import type { AgentProfile } from "../src/config.js";
import type { PiRpcProgressEvent, PiRpcPromptResult } from "../src/pi-rpc.js";

class FakeSession implements AgentSession {
	readonly cwd: string;
	running = false;
	busy = false;
	cancelled = false;
	prompts: string[] = [];
	constructor(
		cwd: string,
		private output: string,
		busy = false,
	) {
		this.cwd = cwd;
		this.busy = busy;
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
		this.cancelled = true;
		return true;
	}
	stop(): void {
		this.running = false;
	}
}

function root(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-review-runner-"));
}

function profiles(): AgentProfile[] {
	return [
		{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		{ id: "security", label: "Security Lab", provider: "pi", piArgs: [] },
		{ id: "database", label: "Database Lab", provider: "pi", piArgs: [] },
		{ id: "general", label: "General Lab", provider: "pi", piArgs: [] },
	];
}

function request(specialty: AgentLabSpecialty = "security") {
	return buildAgentLabReviewRequest({
		id: `request-${specialty}`,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		specialty,
		trigger: "manual",
		objective: `Revisar ${specialty}`,
		contextSummary: "Contexto de revisión",
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
	});
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
		safetyFindings: [
			{
				title: "Falta prueba negativa",
				description: "No hay prueba de token inválido.",
				evidence: "test/auth.test.ts no cubre token inválido",
				severity: "medium",
				confidence: "high",
				category: "security",
				affectedFiles: ["test/auth.test.ts"],
				affectedFlows: ["login"],
				relatedRules: ["auth requires tests"],
				controlPillars: ["quality", "safety"],
			},
		],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
		testsSuggested: ["Agregar test token inválido"],
		testsExecuted: ["corepack pnpm test -- auth"],
		evidence: ["Inspección de tests"],
		recommendations: [
			{
				title: "Agregar test",
				description: "Cubrir token inválido.",
				rationale: "Evita regresión.",
				expectedBenefit: "safety",
				risk: "low",
				requiresHumanApproval: false,
				suggestedNextStep: "Crear test antes de tocar auth.",
			},
		],
		proposedSupervisorActions: [],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "high",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T00:00:00.000Z",
	});
}

function routerWith(
	output: string,
	workspaceMode: "clone" | "direct" = "clone",
	busy = false,
) {
	const sessions = new Map<string, FakeSession>();
	const workspaceRoot = root();
	const projectPath = root();
	mkdirSync(projectPath, { recursive: true });
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles: profiles(),
		defaultProjectId: "pi-telegram-bridge",
		defaultCwd: projectPath,
		workspaceRoot,
		workspaceMode,
		createSession: (options) => {
			const session = new FakeSession(options.cwd, output, busy);
			sessions.set(options.cwd, session);
			return session;
		},
		syncWorkspace: (_workspaceRoot, _projectId, _targetCwd, profileId) => {
			const clone = join(workspaceRoot, "workspaces", profileId);
			mkdirSync(clone, { recursive: true });
			return clone;
		},
	});
	return { router, sessions, projectPath, workspaceRoot };
}

test("run latest lee request válido", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security",
		manualContext: "auth security",
		now: () => new Date("2026-05-25T10:00:00.000Z"),
	});
	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
		now: () => new Date("2026-05-25T10:01:00.000Z"),
	});
	assert.equal(result.runs[0]?.status, "completed");
	assert.match(result.path ?? "", /agentlab-review-run-\d{8}-\d{6}\.json$/u);
});

test("ruta fuera de reports falla", () => {
	const temp = root();
	const status = getAgentLabReviewStatus(
		join(temp, "agentlab-review-run-20260525-100100.json"),
		join(temp, "reports"),
	);
	assert.equal(status.valid, false);
	assert.match(
		status.errors.join("\n"),
		/dentro de AGENT_WORKSPACE_ROOT\/reports/u,
	);
});

test("nombre inválido falla", () => {
	const reportsPath = join(root(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(join(reportsPath, "bad.json"), "{}\n", "utf8");
	const status = getAgentLabReviewStatus("bad.json", reportsPath);
	assert.equal(status.valid, false);
	assert.match(status.errors.join("\n"), /agentlab-review-run/u);
});

test("request inválido se salta y reporta error", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		join(reportsPath, "agentlab-review-request-20260525-100000.json"),
		JSON.stringify({ warning: "bad" }),
		"utf8",
	);
	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
	});
	assert.equal(result.runs[0]?.status, "failed");
	assert.match(result.runs[0]!.rawSummary, /Request file inválido/u);
});

test("security request selecciona security o fallback general", async () => {
	const { router, projectPath } = routerWith(validReport());
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.agentId, "security");
});

test("database request selecciona database o fallback general", async () => {
	const { router, projectPath } = routerWith(
		validReport("request-database", "database"),
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("database"),
	});
	assert.equal(run.agentId, "database");
});

test("si no hay agente compatible, run skipped no rompe", async () => {
	const { projectPath } = routerWith(validReport());
	const router = new AgentRouter({
		piBin: "pi",
		basePiArgs: [],
		profiles: [profiles()[0]!],
		defaultProjectId: "pi-telegram-bridge",
		defaultCwd: projectPath,
		workspaceMode: "clone",
		createSession: (options) => new FakeSession(options.cwd, validReport()),
	});
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "skipped");
});

test("run usa review-only y forbiddenActions", async () => {
	const { router, projectPath, sessions } = routerWith(validReport());
	await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	const prompt = [...sessions.values()][0]!.prompts[0]!;
	assert.match(prompt, /No modifiques el repo real/u);
	assert.match(prompt, /No hagas commit/u);
	assert.match(prompt, /No modifiques schema ni migraciones/u);
	assert.match(
		prompt,
		/No modifiques labPrompt ni infraestructura de ejecución AgentLab/u,
	);
	assert.match(prompt, /Acciones prohibidas/u);
});

test("run no modifica repo real", async () => {
	const { router, projectPath } = routerWith(validReport());
	const sentinel = join(projectPath, "sentinel.txt");
	writeFileSync(sentinel, "original", "utf8");
	await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(readFileSync(sentinel, "utf8"), "original");
});

test("report JSON válido se valida contra contrato", async () => {
	const { router, projectPath } = routerWith(
		`\n\`\`\`json\n${validReport()}\n\`\`\``,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.contractValidation.valid, true);
	assert.equal(run.findings.length, 1);
});

test("report texto legacy queda como partial sin inventar findings", async () => {
	const { router, projectPath } = routerWith("Resumen legacy sin JSON");
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "completed");
	assert.equal(run.contractValidation.valid, false);
	assert.equal(run.findings.length, 0);
});

test("finding sin evidence no se acepta como válido", () => {
	const parsed = JSON.parse(validReport()) as Record<string, unknown>;
	(parsed.safetyFindings as Record<string, unknown>[])[0]!.evidence = "";
	const result = parseAgentLabReviewReportFromOutput(
		JSON.stringify(parsed),
		request("security"),
	);
	assert.equal(result.report, undefined);
	assert.match(result.errors.join("\n"), /evidence/u);
});

test("status latest lee informe", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security",
		manualContext: "auth security",
	});
	await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
	});
	const status = getAgentLabReviewStatus("latest", reportsPath);
	assert.equal(status.valid, true);
	assert.match(formatAgentLabReviewStatus(status), /Estado por specialty/u);
});

test("format run muestra resumen", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "auth security",
		manualContext: "auth security",
	});
	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
	});
	assert.match(formatAgentLabReviewRunResult(result), /AgentLab Review Run/u);
});
