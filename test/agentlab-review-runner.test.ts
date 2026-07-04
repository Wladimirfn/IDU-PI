import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import {
	AgentRouter,
	ensureCloneWorkspace,
	type AgentSession,
} from "../src/agent-router.js";
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
	diffRealRepoState,
	runAgentLabReviewRequest,
	runAgentLabReviewRequestFile,
	selectAgentLabProfile,
	snapshotRealRepoState,
	dispatchAgentLabReviewRun,
	resolveAgentLabReviewRunStatus,
	mintAgentLabReviewRunId,
	writeAgentLabReviewRunAtomic,
} from "../src/agentlab-review-runner.js";
import type { AgentProfile } from "../src/config.js";
import type { PiRpcProgressEvent, PiRpcPromptResult } from "../src/pi-rpc.js";
import type { AgentLabFinding } from "../src/agentlab-supervisor-contract.js";
import type { AgentLabReviewRunResult } from "../src/agentlab-review-runner.js";

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
		private onPrompt?: () => void,
		private ok = true,
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
		this.onPrompt?.();
		return { ok: this.ok, output: this.output };
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
		{ id: "ui", label: "UI UX Lab", provider: "pi", piArgs: [] },
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
				requiresHumanApproval: true,
				suggestedNextStep: "Registrar test sugerido para revisión humana.",
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
	onPrompt?: (projectPath: string) => void,
	projectPath = gitProject(),
	ok = true,
) {
	const sessions = new Map<string, FakeSession>();
	const workspaceRoot = root();
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
			const session = new FakeSession(
				options.cwd,
				output,
				busy,
				() => onPrompt?.(projectPath),
				ok,
			);
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

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitProject(): string {
	const projectPath = root();
	git(["init"], projectPath);
	git(["config", "user.email", "test@example.com"], projectPath);
	git(["config", "user.name", "Test"], projectPath);
	git(["config", "core.autocrlf", "false"], projectPath);
	writeFileSync(join(projectPath, "tracked.txt"), "base\n", "utf8");
	git(["add", "tracked.txt"], projectPath);
	git(["commit", "-m", "init"], projectPath);
	return projectPath;
}

test("snapshot repo real con directorio no lanza EISDIR", () => {
	const projectPath = gitProject();
	rmSync(join(projectPath, "tracked.txt"));
	mkdirSync(join(projectPath, "tracked.txt"));
	const snapshot = snapshotRealRepoState(projectPath);
	assert.equal(snapshot.ok, true);
	assert.match(snapshot.fileStates["tracked.txt"] ?? "", /^dir:/u);
});

test("snapshot repo real con symlink roto no rompe", (t) => {
	const projectPath = gitProject();
	try {
		symlinkSync("missing-target", join(projectPath, "broken-link"), "file");
	} catch {
		t.skip("symlink no disponible en este entorno");
		return;
	}
	const snapshot = snapshotRealRepoState(projectPath);
	assert.equal(snapshot.ok, true);
	assert.match(snapshot.fileStates["broken-link"] ?? "", /symlink:/u);
	assert.ok(
		snapshot.warnings.some((warning) => /broken_symlink/u.test(warning)),
	);
});

test("snapshot repo real con archivo normal detecta cambios", () => {
	const projectPath = gitProject();
	const before = snapshotRealRepoState(projectPath);
	writeFileSync(join(projectPath, "tracked.txt"), "changed\n", "utf8");
	const after = snapshotRealRepoState(projectPath);
	const diff = diffRealRepoState(before, after);
	assert.equal(diff.changed, true);
	assert.ok(diff.changedFiles.includes("tracked.txt"));
});

test("clone sandbox configura core.longpaths", () => {
	const projectPath = gitProject();
	const workspace = ensureCloneWorkspace(
		root(),
		"pi-telegram-bridge",
		projectPath,
		"security",
	);
	const value = git(["config", "--get", "core.longpaths"], workspace);
	assert.equal(value, "true");
});

test("selectAgentLabProfile uses assigned role profile before specialty fallback", () => {
	const { router } = routerWith(validReport());
	const selected = selectAgentLabProfile(router, "security", {
		version: 1,
		assignments: { "agentlab-security": "general" },
	});

	assert.equal(selected?.id, "general");
});

test("selectAgentLabProfile uses explicit database and ui_ux role assignments", () => {
	const { router } = routerWith(validReport());
	const database = selectAgentLabProfile(router, "database", {
		version: 1,
		assignments: { "agentlab-database": "general" },
	});
	const uiUx = selectAgentLabProfile(router, "ui_ux", {
		version: 1,
		assignments: { "agentlab-ui-ux": "database" },
	});

	assert.equal(database?.id, "general");
	assert.equal(uiUx?.id, "database");
});

test("selectAgentLabProfile creates virtual profile for direct model assignment", () => {
	const { router } = routerWith(validReport());
	const selected = selectAgentLabProfile(router, "security", {
		version: 1,
		assignments: { "agentlab-security": "anthropic/claude-sonnet-4" },
	});

	assert.match(selected?.id ?? "", /^agentlab-security__anthropic_claude/iu);
	assert.equal(selected?.piArgs[0], "--model");
	assert.equal(selected?.piArgs[1], "anthropic/claude-sonnet-4");
});

test("selectAgentLabProfile ignores missing assignment and keeps specialty fallback", () => {
	const { router } = routerWith(validReport());
	const selected = selectAgentLabProfile(router, "security", {
		version: 1,
		assignments: { "agentlab-security": "missing" },
	});

	assert.equal(selected?.id, "security");
});

test("selectAgentLabProfile does not allow default direct profile for AgentLabs", () => {
	const { router } = routerWith(validReport());
	const selected = selectAgentLabProfile(router, "security", {
		version: 1,
		assignments: { "agentlab-security": "default" },
	});

	assert.equal(selected?.id, "security");
});

test("run uses virtual profile for direct model assignment", async () => {
	const { router, projectPath } = routerWith(validReport());
	const result = await runAgentLabReviewRequest({
		request: request("security"),
		projectPath,
		router,
		modelAssignments: {
			version: 1,
			assignments: { "agentlab-security": "anthropic/claude-sonnet-4" },
		},
	});

	assert.equal(result.status, "completed");
	assert.match(result.agentId ?? "", /^agentlab-security__anthropic_claude/iu);
});

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
	assert.equal(result.runs[0]?.status, "partial");
	assert.match(
		result.runs[0]?.qualityWarnings?.join("\n") ?? "",
		/parcial|fallback/u,
	);
	assert.match(result.path ?? "", /agentlabs[\\/]runs[\\/]current\.json$/u);
});

test("run latest con request master_plan no queda en cero requests", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const request = buildAgentLabReviewRequest({
		id: "agentlab-pi-master-plan-architecture-01",
		projectId: "pi-telegram-bridge",
		projectPath,
		specialty: "architecture",
		trigger: "master_plan",
		objective: "Revisar Plan Maestro",
		contextSummary: "Plan Maestro deep_required",
		evidence: ["reports/master-plan-20260525-100000.json"],
		filesToInspect: ["reports/master-plan-20260525-100000.json"],
		flowsToCheck: [],
		rulesToCheck: [],
		tokenBudgetHint: "bounded-master-plan-review",
		requiresHumanApproval: true,
		createdAt: "2026-05-25T10:00:00.000Z",
	});
	writeFileSync(
		join(reportsPath, "agentlab-review-request-20260525-100000.json"),
		`${JSON.stringify(
			{
				generatedAt: "2026-05-25T10:00:00.000Z",
				projectId: "pi-telegram-bridge",
				source: "master_plan",
				warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
				requests: [request],
				errors: [],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
		now: () => new Date("2026-05-25T10:01:00.000Z"),
	});

	assert.equal(result.runs.length, 1);
	assert.equal(result.runs[0]?.requestId, request.id);
});

test("run latest maneja request current.json directorio sin lanzar", async () => {
	const { router, projectPath, workspaceRoot } = routerWith("legacy summary");
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(join(reportsPath, "..", "agentlabs", "requests", "current.json"), {
		recursive: true,
	});
	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
		now: () => new Date("2026-05-25T10:01:00.000Z"),
	});

	assert.equal(result.runs.length, 1);
	assert.equal(result.runs[0]?.status, "failed");
	assert.match(
		result.runs[0]?.rawSummary ?? "",
		/archivo|file|directorio|directory/iu,
	);
	assert.doesNotMatch(result.runs[0]?.rawSummary ?? "", /EISDIR/u);
});

test("status latest rechaza run current.json directorio", () => {
	const { workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(join(reportsPath, "..", "agentlabs", "runs", "current.json"), {
		recursive: true,
	});
	const status = getAgentLabReviewStatus("latest", reportsPath);
	assert.equal(status.valid, false);
	assert.match(status.errors.join("\n"), /archivo|file|directorio|directory/iu);
	assert.doesNotMatch(status.errors.join("\n"), /EISDIR/u);
});

test("run latest con 5 requests master_plan no falla por directorios", async () => {
	const { router, projectPath, workspaceRoot } = routerWith("legacy summary");
	mkdirSync(join(projectPath, "untracked-dir"));
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const requests = [
		"project_understanding",
		"architecture",
		"database",
		"security",
		"ui_ux",
	].map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: `agentlab-master-plan-${specialty}-${index + 1}`,
			projectId: "pi-telegram-bridge",
			projectPath,
			specialty: specialty as AgentLabSpecialty,
			trigger: "master_plan",
			objective: `Revisar ${specialty} desde Plan Maestro`,
			contextSummary: "Plan Maestro deep_required",
			evidence: ["reports/master-plan-20260525-100000.json"],
			filesToInspect: ["reports/master-plan-20260525-100000.json"],
			flowsToCheck: [],
			rulesToCheck: [],
			tokenBudgetHint: "bounded-master-plan-review",
			requiresHumanApproval: true,
			createdAt: "2026-05-25T10:00:00.000Z",
		}),
	);
	writeFileSync(
		join(reportsPath, "agentlab-review-request-20260525-100000.json"),
		`${JSON.stringify(
			{
				generatedAt: "2026-05-25T10:00:00.000Z",
				projectId: "pi-telegram-bridge",
				source: "master_plan",
				warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.",
				requests,
				errors: [],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
		now: () => new Date("2026-05-25T10:01:00.000Z"),
	});

	assert.equal(result.runs.length, 5);
	// FIX 1 (fail-loud): garbage lab output ("legacy summary") now produces
	// 5 failed runs (one per request), each carrying an "invalid-json:"
	// reason. The runner still doesn't crash on the untracked directory,
	// and there is no security_violation. The original "0 failed" assertion
	// encoded the silent-fabrication bug.
	assert.equal(
		result.runs.filter((run) => run.status === "failed").length,
		5,
	);
	for (const run of result.runs) {
		assert.match(
			run.contractValidation.errors.join("\n"),
			/^invalid-json:/u,
		);
	}
	assert.equal(
		result.runs.filter((run) => run.status === "security_violation").length,
		0,
	);
});

test("status ruta legacy relativa busca en reports", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "revisar UI html components",
		manualContext: "UI html components",
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
	const legacyName = "agentlab-review-run-20260525-100100.json";
	writeFileSync(
		join(reportsPath, legacyName),
		readFileSync(result.path ?? "", "utf8"),
		"utf8",
	);
	const status = getAgentLabReviewStatus(legacyName, reportsPath);
	assert.equal(status.valid, true);
	assert.equal(status.result?.runs[0]?.status, "partial");
});

test("status latest rechaza run current viejo para request current nuevo", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(validReport());
	const reportsPath = join(workspaceRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "old review",
		manualContext: "old review",
		now: () => new Date("2026-05-25T10:00:00.000Z"),
	});
	await runAgentLabReviewRequestFile({
		pathOrLatest: "latest",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		router,
		now: () => new Date("2026-05-25T10:01:00.000Z"),
	});
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath,
		manualObjective: "new review after timeout",
		manualContext: "new review after timeout",
		now: () => new Date("2026-05-25T10:02:00.000Z"),
	});

	const status = getAgentLabReviewStatus("latest", reportsPath);

	assert.equal(status.valid, false);
	assert.match(status.errors.join("\n"), /stale|pendiente|request actual/u);
	assert.equal(status.workloadEnvelope?.status, "stale");
	assert.equal(status.workloadEnvelope?.authority, "advisory");
	assert.equal(status.workloadEnvelope?.autoRunAllowed, false);
	assert.equal(status.workloadEnvelope?.staleRequests, 1);
	assert.equal(status.result, undefined);
});

test("ruta fuera de reports falla", () => {
	const temp = root();
	const status = getAgentLabReviewStatus(
		join(temp, "agentlab-review-run-20260525-100100.json"),
		join(temp, "reports"),
	);
	assert.equal(status.valid, false);
	assert.match(status.errors.join("\n"), /agentlabs\/runs|reports legacy/u);
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
	assert.equal(result.workloadEnvelope?.status, "failed");
	assert.equal(result.workloadEnvelope?.authority, "advisory");
	assert.equal(result.workloadEnvelope?.autoRunAllowed, false);
	assert.equal(result.runs[0]?.workloadEnvelope?.status, "failed");
	assert.equal(result.runs[0]?.workloadEnvelope?.authority, "advisory");
	assert.equal(result.runs[0]?.workloadEnvelope?.failedRequests, 1);
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
	assert.equal(run.workloadEnvelope?.status, "skipped");
	assert.equal(run.workloadEnvelope?.authority, "advisory");
	assert.equal(run.workloadEnvelope?.autoRunAllowed, false);
	assert.equal(run.workloadEnvelope?.skippedRequests, 1);
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
	assert.match(prompt, /Project context budget JSON/u);
	assert.match(prompt, /Context budget JSON/u);
	assert.match(prompt, /"profile": "agentlab_request"/u);
	assert.match(prompt, /Acciones prohibidas/u);
	assert.match(prompt, /SALIDA OBLIGATORIA/u);
	assert.match(prompt, /qualityFindings/u);
	assert.match(prompt, /requiresHumanApproval/u);
});

test("guard no falla si repo real queda igual", async () => {
	const projectPath = gitProject();
	const { router } = routerWith(
		validReport(),
		"clone",
		false,
		undefined,
		projectPath,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "completed");
	assert.equal(git(["status", "--porcelain"], projectPath), "");
});

test("guard detecta archivo nuevo en repo real", async () => {
	const projectPath = gitProject();
	writeFileSync(join(projectPath, "preexisting.txt"), "dirty before\n", "utf8");
	const { router } = routerWith(
		validReport(),
		"clone",
		false,
		(path) => writeFileSync(join(path, "intruder.txt"), "bad\n", "utf8"),
		projectPath,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "security_violation");
	assert.match(run.contractValidation.errors.join("\n"), /security_violation/u);
	assert.deepEqual(run.realRepoChangedFiles, ["intruder.txt"]);
	assert.equal(run.requiresHumanApproval, true);
	assert.equal(run.workloadEnvelope?.status, "security_violation");
	assert.equal(run.workloadEnvelope?.authority, "advisory");
	assert.equal(run.workloadEnvelope?.repoWriteAllowed, false);
	assert.equal(run.workloadEnvelope?.securityViolations, 1);
});

test("guard detecta mutación limpia con commit en repo real", async () => {
	const projectPath = gitProject();
	const { router } = routerWith(
		validReport(),
		"clone",
		false,
		(path) => {
			writeFileSync(join(path, "tracked.txt"), "committed mutation\n", "utf8");
			git(["add", "tracked.txt"], path);
			git(["commit", "-m", "agent mutation"], path);
		},
		projectPath,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "security_violation");
	assert.deepEqual(run.realRepoChangedFiles, ["HEAD"]);
});

test("guard ignora cambios previos pero detecta nuevas diferencias", async () => {
	const projectPath = gitProject();
	writeFileSync(join(projectPath, "tracked.txt"), "dirty before\n", "utf8");
	const cleanRun = await runAgentLabReviewRequest({
		...routerWith(validReport(), "clone", false, undefined, projectPath),
		projectPath,
		request: request("security"),
	});
	assert.equal(cleanRun.status, "completed");

	const { router } = routerWith(
		validReport(),
		"clone",
		false,
		(path) => writeFileSync(join(path, "tracked.txt"), "dirty after\n", "utf8"),
		projectPath,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "security_violation");
	assert.deepEqual(run.realRepoChangedFiles, ["tracked.txt"]);
});

test("guard funciona aunque AgentLab falle", async () => {
	const projectPath = gitProject();
	const { router } = routerWith(
		"falló",
		"clone",
		false,
		(path) => writeFileSync(join(path, "failed-change.txt"), "bad\n", "utf8"),
		projectPath,
		false,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "security_violation");
	assert.deepEqual(run.realRepoChangedFiles, ["failed-change.txt"]);
});

test("parser extrae JSON rodeado de tool logs", () => {
	const output = [
		"[tool:read] iniciando...",
		"ruido antes",
		validReport(),
		'tool after {"tool":"read"}',
	].join("\n");
	const result = parseAgentLabReviewReportFromOutput(
		output,
		request("security"),
	);
	assert.equal(result.report?.summary, "Revisión completada.");
	assert.equal(result.errors.length, 0);
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

test("output sin JSON termina el run como failed con reason legible sin inventar findings", async () => {
	const { router, projectPath } = routerWith(
		"[tool:read] iniciando...\nResumen legacy sin JSON",
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	// FIX 1 (fail-loud): no JSON parseable from the lab must NOT silently
	// become a fabricated "partial" run. It must be a real failure whose
	// reason surfaces through contractValidation.errors, with no findings
	// and no fallback qualityWarnings.
	assert.equal(run.status, "failed");
	assert.equal(run.workloadEnvelope?.status, "failed");
	assert.equal(run.contractValidation.valid, false);
	assert.ok(
		run.contractValidation.errors.length > 0,
		"contractValidation.errors must be non-empty for a failed run",
	);
	assert.match(
		run.contractValidation.errors.join("\n"),
		/^invalid-json:/u,
	);
	assert.equal(run.findings.length, 0);
	assert.equal(run.qualityWarnings, undefined);
});

test("parser con output sin JSON devuelve errors no-vacío sin report", () => {
	// FIX 1 (fail-loud): the parser must surface a non-empty errors array
	// when no JSON candidate was found, so the caller can route to failedRun.
	const result = parseAgentLabReviewReportFromOutput(
		"ruido sin llaves\n[tool:read] x",
		request("security"),
	);
	assert.equal(result.report, undefined);
	assert.ok(
		result.errors.length > 0,
		"errors must be non-empty when no JSON candidate produces a report",
	);
	assert.ok(
		typeof result.errors[0] === "string" && result.errors[0].length > 0,
		"first error must be a non-empty string",
	);
});

test("report JSON válido sigue produciendo run completed (regresión)", async () => {
	// FIX 1 regression guard: valid JSON must still flow through the happy
	// path and produce a completed run, not a failed one.
	const { router, projectPath } = routerWith(
		`\n\`\`\`json\n${validReport()}\n\`\`\``,
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "completed");
	assert.equal(run.contractValidation.valid, true);
	assert.equal(run.findings.length, 1);
});

test("report parcial con estructura reconocible se repara a partial con qualityWarning (tier 2 preservado)", () => {
	// FIX 1 regression guard: tier 2 (repair) MUST keep working. A report-shaped
	// but incomplete JSON must be repaired with a qualityWarning, NOT failed.
	const output = JSON.stringify({
		requestId: "request-security",
		projectId: "pi-telegram-bridge",
		specialty: "security",
		status: "completed",
		summary: "Riesgo detectado.",
		safetyFindings: [{ title: "Auth difuso", severity: "high" }],
		recommendations: ["Revisar auth"],
	});
	const result = parseAgentLabReviewReportFromOutput(output, request("security"));
	assert.ok(result.report, "tier 2 must produce a report");
	assert.equal(result.errors.length, 0);
	assert.match(result.qualityWarnings?.join("\n") ?? "", /reparó/u);
});

test("review_status con 1 failed + 1 completed muestra ambos discriminados", () => {
	// FIX 1 discrimination guard: when one run is failed (with invalid-json
	// reason) and another is completed, formatAgentLabReviewStatus must show
	// each specialty with its own status. The failed run must NOT contribute
	// findings or testsSuggested (it is excluded from the consolidated evidence).
	const failed = {
		requestId: "request-security",
		specialty: "security" as const,
		status: "failed" as const,
		commandsExecuted: [],
		rawSummary: "[tool:read] x",
		contractValidation: {
			valid: false,
			errors: ["invalid-json: Unexpected token r in JSON at position 0"],
		},
		findings: [],
		recommendations: [],
		testsSuggested: [],
		requiresHumanApproval: false,
	};
	const completed = {
		requestId: "request-database",
		specialty: "database" as const,
		status: "completed" as const,
		commandsExecuted: [],
		rawSummary: "DB review ok",
		contractValidation: { valid: true, errors: [] },
		findings: [
			{
				title: "idx-missing",
				description: "Missing index",
				evidence: "schema",
				severity: "medium" as const,
				confidence: "high" as const,
				category: "performance",
				affectedFiles: ["src/db.ts"],
				affectedFlows: ["query"],
				relatedRules: [],
				controlPillars: ["quality"],
			} satisfies AgentLabFinding,
		],
		recommendations: [],
		testsSuggested: ["add index test"],
		requiresHumanApproval: false,
	};
	const status = {
		valid: true,
		path: "current.json",
		name: "current",
		errors: [],
		result: {
			generatedAt: "2026-07-02T00:00:00.000Z",
			sourceRequestFile: "request.json",
			warning: "Revisión AgentLab. No aplica cambios." as const,
			projectId: "pi-telegram-bridge",
			runs: [failed, completed],
			consolidatedSummary: "DB review ok",
			consolidatedFindings: [
				{
					title: "idx-missing",
					description: "Missing index",
					evidence: "schema",
					severity: "medium" as const,
					confidence: "high" as const,
					category: "performance",
					affectedFiles: ["src/db.ts"],
					affectedFlows: ["query"],
					relatedRules: [],
					controlPillars: ["quality"],
				} satisfies AgentLabFinding,
			],
			recommendedNext: "Add index test.",
			requiresHumanApproval: false,
			safeNotes: [],
		},
	};
	const formatted = formatAgentLabReviewStatus(status);
	assert.match(formatted, /security: failed/u);
	assert.match(formatted, /database: completed/u);
	// Discrimination: the failed run must NOT bleed into the consolidated
	// findings list or testsSuggested list — only the completed run contributes.
	const titles = status.result.consolidatedFindings.map((f) => f.title);
	assert.deepEqual(titles, ["idx-missing"]);
	assert.deepEqual(
		status.result.runs
			.filter((run) => run.status !== "failed")
			.flatMap((run) => run.testsSuggested),
		["add index test"],
	);
	// Reason preservation: the fail-loud reason must remain on the run's
	// contractValidation.errors so downstream consumers (and humans reading
	// the persisted run JSON) see WHY it failed.
	const failedRun = status.result.runs.find((r) => r.status === "failed");
	assert.ok(failedRun, "failed run must be in result.runs");
	assert.match(
		failedRun.contractValidation.errors.join("\n"),
		/^invalid-json:/u,
	);
});

test("report parcial se repara a contrato válido", () => {
	const output = JSON.stringify({
		requestId: "request-security",
		projectId: "pi-telegram-bridge",
		specialty: "security",
		status: "completed",
		summary: "Riesgo detectado.",
		safetyFindings: [{ title: "Auth difuso", severity: "high" }],
		recommendations: ["Revisar auth"],
	});
	const result = parseAgentLabReviewReportFromOutput(
		output,
		request("security"),
	);
	assert.equal(result.errors.length, 0);
	assert.match(result.qualityWarnings?.join("\n") ?? "", /reparó/u);
	assert.equal(result.report?.safetyFindings[0]?.evidence.length! > 0, true);
	assert.equal(
		result.report?.recommendations[0]?.suggestedNextStep,
		"Revisar manualmente.",
	);
});

test("finding sin evidence se repara con evidencia del request", () => {
	const parsed = JSON.parse(validReport()) as Record<string, unknown>;
	(parsed.safetyFindings as Record<string, unknown>[])[0]!.evidence = "";
	const result = parseAgentLabReviewReportFromOutput(
		JSON.stringify(parsed),
		request("security"),
	);
	assert.equal(result.errors.length, 0);
	assert.equal(result.report?.safetyFindings[0]?.evidence, "src/auth.ts");
});

test("status latest lee informe", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(
		validReport("agentlab-pi-telegram-bridge-manual-security-01"),
	);
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
	const formatted = formatAgentLabReviewStatus(status);
	assert.match(formatted, /Estado por specialty/u);
	assert.match(formatted, /Agregar test/u);
	assert.match(formatted, /Agregar test token inválido/u);
	assert.doesNotMatch(formatted, /\[tool:/u);
});

test("status current resolves the same run as current.json", async () => {
	const { router, projectPath, workspaceRoot } = routerWith(
		validReport("agentlab-pi-telegram-bridge-manual-security-01"),
	);
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

	const bare = getAgentLabReviewStatus("current", reportsPath);
	const explicit = getAgentLabReviewStatus("current.json", reportsPath);

	assert.equal(bare.valid, true);
	assert.equal(explicit.valid, true);
	assert.equal(bare.path, explicit.path);
	assert.match(bare.path, /agentlabs[\\/]runs[\\/]current\.json$/u);
});

test("status current missing reports current.json candidate", () => {
	const reportsPath = join(root(), "reports");

	const status = getAgentLabReviewStatus("current", reportsPath);

	assert.equal(status.valid, false);
	assert.match(status.path, /agentlabs[\\/]runs[\\/]current\.json$/u);
	assert.match(status.errors.join("\n"), /current\.json/u);
});

test("status latest resuelve archivo legacy en reports sin agentlabs/runs", () => {
	// Regression test for commit 2 of change
	// 2026-07-03-fix-run-selector-unify. Before this commit, latestRunFile's
	// fallback scanned reports/ with an inline regex
	// /^agentlab-review-run-\d{8}-\d{6}\.json$/u. After the migration to
	// isAgentLabRunFilename, the helper ALSO accepts current.json and the
	// new run-<unix>-<hex>.json format, so this test pins that the LEGACY
	// format specifically still resolves when reports/ is the only source.
	const temp = root();
	const reportsPath = join(temp, "reports");
	mkdirSync(reportsPath, { recursive: true });
	// Deliberately do NOT create temp/agentlabs/runs/ — the fallback must
	// resolve from reports/ alone.
	const legacyName = "agentlab-review-run-20260611-101530.json";
	writeFileSync(
		join(reportsPath, legacyName),
		JSON.stringify({
			warning: "Revisión AgentLab. No aplica cambios.",
			generatedAt: "2026-06-11T10:15:30.000Z",
			sourceRequestFile: "reports/agentlab-review-request-20260611-101500.json",
			projectId: "pi-telegram-bridge",
			runs: [],
		}),
		"utf8",
	);

	const status = getAgentLabReviewStatus("latest", reportsPath);

	assert.equal(status.valid, true, `expected valid run, got: ${status.errors.join(" | ")}`);
	assert.match(
		status.path,
		new RegExp(`reports[\\\\/]${legacyName.replace(/\./g, "\\.")}$`, "u"),
		`status.path must point to the legacy file in reports/`,
	);
	assert.equal(status.name, legacyName);
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

// PR1 (Fix 2 — async dispatch) — RED contract tests. Pin the contract that
// dispatchAgentLabReviewRun / resolveAgentLabReviewRunStatus MUST satisfy.
// Compile-time RED gate: these imports fail until PR1 implements production.

// PR2 (Fix 2 — async dispatch) — production-real pipeline contract tests.
// Pin the contract that the detached promise:
//   (a) does NOT block the dispatcher return
//   (b) eventually writes <runId>.json atomically on completion
//   (c) emits a supervisor activity event (via the optional onActivity hook)
// All 4 PR1 tests above MUST still pass — REPLACEMENT of stub bodies, not
// removal of stub seam.

function dispatchFixture() {
	const reportsPath = join(root(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const projectPath = gitProject();
	return {
		reportsPath,
		input: { reportsPath, projectId: "pi-telegram-bridge", projectPath, maxMinutes: 1, requestId: "agentlab-pi-telegram-bridge-manual-security-01" },
	};
}

function completedRunSummary(): AgentLabReviewRunResult {
	return {
		generatedAt: "2026-05-25T10:01:00.000Z",
		sourceRequestFile: "agentlab-review-request-20260525-100000.json",
		warning: "Revisión AgentLab. No aplica cambios." as const,
		projectId: "pi-telegram-bridge",
		runs: [{
			requestId: "agentlab-pi-telegram-bridge-manual-security-01",
			specialty: "security" as AgentLabSpecialty,
			status: "completed" as const,
			commandsExecuted: [], rawSummary: "ok",
			contractValidation: { valid: true, errors: [] },
			findings: [], recommendations: [], testsSuggested: [],
			requiresHumanApproval: false,
		}],
		consolidatedSummary: "completed", consolidatedFindings: [],
		recommendedNext: "none", requiresHumanApproval: false, safeNotes: [],
	};
}

test("PR1 dispatch returns immediately with runId and status dispatched", () => {
	const { input } = dispatchFixture();
	const start = Date.now();
	const result = dispatchAgentLabReviewRun(input, "security");
	const elapsedMs = Date.now() - start;

	assert.ok(elapsedMs < 500, `dispatch must return synchronously (<500ms); took ${elapsedMs}ms`);
	assert.match(result.runId, /^run-\d{10}-[a-z0-9]+$/u, `runId must match /run-\\d{10}-[a-z0-9]+/`);
	assert.equal(result.status, "dispatched", "envelope status must be \"dispatched\"");
	assert.ok(existsSync(result.dispatchPath), `dispatchPath must exist on disk: ${result.dispatchPath}`);
	const raw = JSON.parse(readFileSync(result.dispatchPath, "utf8")) as { runId: string; status: string; startedAt: string };
	assert.equal(raw.runId, result.runId, "placeholder runId must match envelope");
	assert.equal(raw.status, "dispatched", "placeholder status must be \"dispatched\"");
	assert.match(raw.startedAt, /^\d{4}-\d{2}-\d{2}T/u, "placeholder startedAt must be ISO");
});

test("PR1 status during execution reports running when only dispatch.json exists", () => {
	const { input, reportsPath } = dispatchFixture();
	const { runId, dispatchPath } = dispatchAgentLabReviewRun(input, "security");
	const runFile = dispatchPath.replace(/\.dispatch\.json$/u, ".json");

	assert.ok(existsSync(dispatchPath), "dispatch placeholder must exist on disk");
	assert.equal(existsSync(runFile), false, `run artifact must NOT exist while running: ${runFile}`);

	const status = resolveAgentLabReviewRunStatus({ runId, reportsPath });
	assert.equal(status.status, "running", "status while dispatch.json exists and run.json does not must be \"running\"");
	assert.equal(status.runId, runId, "status.runId must echo the queried runId");
	assert.equal(status.kind, "running", "status.kind discriminator must report \"running\"");
});

test("PR1 status after completion reports completed or failed based on run.json", () => {
	const { input, reportsPath } = dispatchFixture();
	const { runId, dispatchPath } = dispatchAgentLabReviewRun(input, "security");
	const runFile = dispatchPath.replace(/\.dispatch\.json$/u, ".json");

	const completed = completedRunSummary();
	assert.equal(writeAgentLabReviewRunAtomic(runId, input.reportsPath, completed), runFile, "atomic write must land at run.json path");
	rmSync(dispatchPath, { force: true });

	const status = resolveAgentLabReviewRunStatus({ runId, reportsPath });
	assert.equal(status.status, "completed", "run.json with status=completed must resolve to \"completed\"");
	assert.equal(status.kind, "completed", "kind discriminator must report \"completed\"");

	// Flip to failed: resolver must track the distinction (kind stays "completed" — file present).
	const failed = { ...completed, runs: [{ ...completed.runs[0]!, status: "failed" as const }] };
	writeAgentLabReviewRunAtomic(runId, input.reportsPath, failed);
	const failedStatus = resolveAgentLabReviewRunStatus({ runId, reportsPath });
	assert.equal(failedStatus.status, "failed", "run.json with status=failed must resolve to \"failed\"");
	assert.equal(failedStatus.kind, "completed", "kind stays \"completed\" (file present)");
});

test("PR1 status never mixes concurrent generations; status(latest) picks by mtime", () => {
	const { reportsPath } = dispatchFixture();

	const runIdA = mintAgentLabReviewRunId();
	const runIdB = mintAgentLabReviewRunId();
	const runDir = resolve(join(reportsPath, "..", "agentlabs", "runs"));
	mkdirSync(runDir, { recursive: true });

	const older = completedRunSummary();
	older.generatedAt = "2026-05-25T09:00:00.000Z";
	const newer = { ...completedRunSummary(), generatedAt: "2026-05-25T10:00:00.000Z" };

	writeAgentLabReviewRunAtomic(runIdA, reportsPath, older);
	// Force a measurable mtime gap so findLatestByMtime has a deterministic winner.
	utimesSync(join(runDir, `${runIdA}.json`), new Date("2026-05-25T09:00:00.000Z"), new Date("2026-05-25T09:00:00.000Z"));
	writeAgentLabReviewRunAtomic(runIdB, reportsPath, newer);
	utimesSync(join(runDir, `${runIdB}.json`), new Date("2026-05-25T10:00:00.000Z"), new Date("2026-05-25T10:00:00.000Z"));

	const statusA = resolveAgentLabReviewRunStatus({ runId: runIdA, reportsPath });
	assert.equal(statusA.runId, runIdA, "statusA.runId must echo runIdA (no mix with runB)");
	assert.equal(statusA.status, "completed", "statusA.status must report runA's status");

	const statusB = resolveAgentLabReviewRunStatus({ runId: runIdB, reportsPath });
	assert.equal(statusB.runId, runIdB, "statusB.runId must echo runIdB (no mix with runA)");
	assert.equal(statusB.status, "completed", "statusB.status must report runB's status");

	const statusLatest = resolveAgentLabReviewRunStatus({ reportsPath });
	assert.equal(statusLatest.runId, runIdB, "latest must resolve to the most-recently-written runId (by mtime)");
});

// ===== PR2 (Fix 2) — production-real pipeline contract tests =====

// Helper: wait for a predicate up to `maxMs`, polling every `intervalMs`.
async function waitFor(
	predicate: () => boolean,
	maxMs = 2000,
	intervalMs = 10,
): Promise<boolean> {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return predicate();
}

test("PR2 dispatch returns immediately even when runLab takes >100ms (detached promise)", async () => {
	const { input } = dispatchFixture();
	const start = Date.now();
	let runLabFinishedAt = 0;
	const result = dispatchAgentLabReviewRun({
		...input,
		runLab: async () => {
			// Simulate the lab work taking 250ms — the dispatcher MUST
			// return well before this completes.
			await new Promise((resolve) => setTimeout(resolve, 250));
			runLabFinishedAt = Date.now();
			return completedRunSummary();
		},
	}, "security");
	const elapsedMs = Date.now() - start;

	assert.ok(elapsedMs < 100, `dispatch must return <100ms even with a slow runLab; took ${elapsedMs}ms`);
	assert.equal(result.status, "dispatched", "dispatch envelope status must remain 'dispatched'");
	assert.match(result.runId, /^run-\d{10}-[a-z0-9]+$/u, "dispatch envelope must include a valid runId");

	// Wait for the detached promise to complete — proves the pipeline ran.
	const runFile = result.dispatchPath.replace(/\.dispatch\.json$/u, ".json");
	const arrived = await waitFor(() => existsSync(runFile), 2000);
	assert.ok(arrived, `run artifact must be written after runLab resolves: ${runFile}`);
	assert.ok(runLabFinishedAt > 0, "runLab must have completed");
	assert.ok(runLabFinishedAt - start >= 200, `runLab must have run for ~250ms; took ${runLabFinishedAt - start}ms`);

	// Dispatch return happened BEFORE runLab finished — the detached contract.
	assert.ok(elapsedMs < runLabFinishedAt - start, `dispatch must return BEFORE runLab finishes; elapsed=${elapsedMs}ms runLab-duration=${runLabFinishedAt - start}ms`);
});

test("PR2 detached runLab failure writes failed run artifact (status: failed)", async () => {
	const { input } = dispatchFixture();
	const failureMessage = "synthetic lab failure for PR2";
	const result = dispatchAgentLabReviewRun({
		...input,
		runLab: async () => {
			throw new Error(failureMessage);
		},
	}, "security");

	const runFile = result.dispatchPath.replace(/\.dispatch\.json$/u, ".json");
	const arrived = await waitFor(() => existsSync(runFile), 2000);
	assert.ok(arrived, `failed run artifact must be written even when runLab throws: ${runFile}`);

	const status = resolveAgentLabReviewRunStatus({ runId: result.runId, reportsPath: input.reportsPath });
	assert.equal(status.kind, "completed", "kind stays 'completed' once the run file exists");
	assert.equal(status.status, "failed", "failed runLab must produce status: failed");
});

test("PR2 detached runLab success writes run artifact matching runLab's summary", async () => {
	const { input } = dispatchFixture();
	const summary = completedRunSummary();
	summary.runs[0]!.status = "partial";
	const result = dispatchAgentLabReviewRun({
		...input,
		runLab: async () => summary,
	}, "security");

	const runFile = result.dispatchPath.replace(/\.dispatch\.json$/u, ".json");
	const arrived = await waitFor(() => existsSync(runFile), 2000);
	assert.ok(arrived, `run artifact must be written when runLab resolves: ${runFile}`);

	const status = resolveAgentLabReviewRunStatus({ runId: result.runId, reportsPath: input.reportsPath });
	assert.equal(status.kind, "completed", "kind must be 'completed' once the run file is written");
	assert.equal(status.status, "partial", "runLab-returned status must propagate to run artifact");
});

test("PR2 detached promise emits completion activity via onActivity hook", async () => {
	const { input } = dispatchFixture();
	const activityEvents: Array<{ kind: string; runId: string }> = [];
	const result = dispatchAgentLabReviewRun({
		...input,
		runLab: async () => completedRunSummary(),
		onActivity: (event) => {
			activityEvents.push({ kind: event.kind, runId: event.runId });
		},
	}, "security");

	const runFile = result.dispatchPath.replace(/\.dispatch\.json$/u, ".json");
	const arrived = await waitFor(() => existsSync(runFile), 2000);
	assert.ok(arrived, "run artifact must be written for activity emission to settle");

	// Wait for the .finally to drain the activity emission.
	const started = await waitFor(() => activityEvents.some((e) => e.kind === "dispatch_started"), 1000);
	assert.ok(started, `dispatch_started activity must be emitted; got ${JSON.stringify(activityEvents)}`);
	const completed = await waitFor(() => activityEvents.some((e) => e.kind === "dispatch_completed"), 1000);
	assert.ok(completed, `dispatch_completed activity must be emitted on success; got ${JSON.stringify(activityEvents)}`);

	for (const event of activityEvents) {
		assert.equal(event.runId, result.runId, `activity event runId must match dispatch envelope`);
	}
});

test("PR2 detached promise emits dispatch_failed activity when runLab rejects", async () => {
	const { input } = dispatchFixture();
	const activityEvents: Array<{ kind: string; runId: string }> = [];
	const result = dispatchAgentLabReviewRun({
		...input,
		runLab: async () => {
			throw new Error("boom");
		},
		onActivity: (event) => {
			activityEvents.push({ kind: event.kind, runId: event.runId });
		},
	}, "security");

	const runFile = result.dispatchPath.replace(/\.dispatch\.json$/u, ".json");
	const arrived = await waitFor(() => existsSync(runFile), 2000);
	assert.ok(arrived, "run artifact must be written even when runLab rejects");

	const failed = await waitFor(() => activityEvents.some((e) => e.kind === "dispatch_failed"), 1000);
	assert.ok(failed, `dispatch_failed activity must be emitted on rejection; got ${JSON.stringify(activityEvents)}`);
});

// ===== PR4 (Fix 2 audit) — latest-resolution dispatch inclusion =====

test("PR4 dispatch más nuevo que run viejo coexistente: latest resuelve al dispatch (running) con el runId nuevo", () => {
	// Reproduce Demo C of the audit: an older completed run sits on disk while a
	// newer dispatch placeholder (no run artifact yet) exists. findLatestRunFileByMtime
	// must include `.dispatch.json` candidates; resolution must delegate to
	// resolveRunByRunId, which sees the absent run file + present dispatch and
	// returns kind=running with the NEW dispatch runId — NOT the old completed runId.
	const { reportsPath } = dispatchFixture();

	const oldRunId = mintAgentLabReviewRunId();
	const newRunId = mintAgentLabReviewRunId();
	const runDir = resolve(join(reportsPath, "..", "agentlabs", "runs"));
	mkdirSync(runDir, { recursive: true });

	// Old completed run (runIdA.json), mtime pinned to T-2h.
	writeAgentLabReviewRunAtomic(oldRunId, reportsPath, completedRunSummary());
	utimesSync(
		join(runDir, `${oldRunId}.json`),
		new Date("2026-05-25T09:00:00.000Z"),
		new Date("2026-05-25T09:00:00.000Z"),
	);

	// New dispatch placeholder (runIdB.dispatch.json), mtime pinned to T+0 — newer.
	writeFileSync(
		join(runDir, `${newRunId}.dispatch.json`),
		JSON.stringify({ runId: newRunId, status: "dispatched", startedAt: "2026-05-25T11:00:00.000Z" }, null, 2),
		"utf8",
	);
	utimesSync(
		join(runDir, `${newRunId}.dispatch.json`),
		new Date("2026-05-25T11:00:00.000Z"),
		new Date("2026-05-25T11:00:00.000Z"),
	);

	// status(latest) must point at the NEW dispatch, not the OLD completed run.
	const statusLatest = resolveAgentLabReviewRunStatus({ reportsPath });
	assert.equal(
		statusLatest.runId,
		newRunId,
		"latest must resolve to the NEW dispatch runId (newest by mtime across both suffixes)",
	);
	assert.equal(
		statusLatest.kind,
		"running",
		"latest.kind must be 'running' when only the .dispatch.json placeholder exists for the newest mtime",
	);
	assert.equal(statusLatest.status, "running", "latest.status must be 'running' for an in-flight dispatch");

	// The old runId is still pinnable — caller can ask for it explicitly.
	const statusOld = resolveAgentLabReviewRunStatus({ runId: oldRunId, reportsPath });
	assert.equal(statusOld.runId, oldRunId, "old runId must still resolve to itself when pinned");
	assert.equal(statusOld.kind, "completed", "old runId.kind must remain 'completed' (run file present)");
	assert.equal(statusOld.status, "completed", "old runId.status must remain 'completed'");
});

test("PR4 run y dispatch del MISMO runId coexistiendo: latest resuelve al completed (run file prevalece sobre residual dispatch.json)", () => {
	// Residual .dispatch.json post-completion (e.g. crash during cleanup or
	// lock-leak scenario) must NOT regress latest to 'running' when the run
	// file is already present. resolveRunByRunId checks the run file FIRST
	// and only falls through to dispatch if the run file is absent — and
	// findLatestRunFileByMtime must include both suffixes in its mtime-max
	// scan so it can pick the run file (which has the newer mtime in normal
	// completion) and hand the runId to resolveRunByRunId.
	const { reportsPath } = dispatchFixture();

	const runId = mintAgentLabReviewRunId();
	const runDir = resolve(join(reportsPath, "..", "agentlabs", "runs"));
	mkdirSync(runDir, { recursive: true });

	// Completed run file written first.
	writeAgentLabReviewRunAtomic(runId, reportsPath, completedRunSummary());
	utimesSync(
		join(runDir, `${runId}.json`),
		new Date("2026-05-25T11:00:00.000Z"),
		new Date("2026-05-25T11:00:00.000Z"),
	);

	// Residual dispatch placeholder (cleanup never ran) — mtime intentionally
	// OLDER than the run file so the residual cannot win by accident.
	writeFileSync(
		join(runDir, `${runId}.dispatch.json`),
		JSON.stringify({ runId, status: "dispatched", startedAt: "2026-05-25T10:30:00.000Z" }, null, 2),
		"utf8",
	);
	utimesSync(
		join(runDir, `${runId}.dispatch.json`),
		new Date("2026-05-25T10:30:00.000Z"),
		new Date("2026-05-25T10:30:00.000Z"),
	);

	const statusLatest = resolveAgentLabReviewRunStatus({ reportsPath });
	assert.equal(
		statusLatest.runId,
		runId,
		"latest must resolve to the runId when both .json and .dispatch.json coexist",
	);
	assert.equal(
		statusLatest.kind,
		"completed",
		"latest.kind must be 'completed' (run file present takes precedence over residual dispatch)",
	);
	assert.equal(statusLatest.status, "completed", "latest.status must be 'completed'");
});
