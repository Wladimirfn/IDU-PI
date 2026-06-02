import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	assert.equal(result.runs.filter((run) => run.status === "failed").length, 0);
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
	assert.equal(status.result?.runs[0]?.status, "completed");
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

test("report texto legacy se convierte en contrato válido sin inventar findings", async () => {
	const { router, projectPath } = routerWith(
		"[tool:read] iniciando...\nResumen legacy sin JSON",
	);
	const run = await runAgentLabReviewRequest({
		router,
		projectPath,
		request: request("security"),
	});
	assert.equal(run.status, "completed");
	assert.equal(run.contractValidation.valid, true);
	assert.equal(run.findings.length, 0);
	assert.match(run.qualityWarnings?.join("\n") ?? "", /fallback/u);
	assert.doesNotMatch(run.rawSummary, /\[tool:read\]/u);
	assert.match(run.rawSummary, /Resumen legacy/u);
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
