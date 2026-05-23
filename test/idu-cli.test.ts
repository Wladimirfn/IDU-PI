import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	configureIduSessionStore,
	getIduSessionStatus,
} from "../src/idu-session.js";
import { runCliCommand, type CliRuntime } from "../src/cli.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type {
	SemanticAuditRunResult,
	SemanticAuditStatusReport,
} from "../src/semantic-audit-command.js";

async function withRuntime(
	fn: (
		runtime: CliRuntime,
		paths: { projectPath: string; workspaceRoot: string },
	) => void | Promise<void>,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-"));
	const projectPath = join(root, "project");
	const workspaceRoot = join(root, "workspace");
	try {
		const runtime = fakeRuntime(projectPath, workspaceRoot);
		await fn(runtime, { projectPath, workspaceRoot });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function fakeConnection(projectPath: string): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["sin scan reciente"],
		projectId: "pi-telegram-bridge",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "idu-pi prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-22T00:00:00.000Z",
	};
}

function fakePreflight(request: string): ProjectPreflightReport {
	return {
		risk: /login/u.test(request) ? "high" : "low",
		okToProceed: !/login/u.test(request),
		request,
		projectId: "pi-telegram-bridge",
		projectPath: "/project",
		connectionStatus: "ready",
		affectedAreas: /login/u.test(request)
			? ["auth/seguridad"]
			: ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: /login/u.test(request)
			? "Pedir confirmación humana."
			: "Puede continuar.",
		requiresHumanConfirmation: /login/u.test(request),
		shouldRunAgentLab: false,
	};
}

function fakePostflight(): ProjectPostflightReport {
	return {
		risk: "low",
		changedFiles: [],
		impactedAreas: [],
		warnings: [],
		recommendedNext: "Sin cambios locales detectados.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	};
}

function fakeSemanticAuditStatus(): SemanticAuditStatusReport {
	return {
		projectId: "pi-telegram-bridge",
		stats: {
			projectId: "pi-telegram-bridge",
			labRunCount: 1,
			findingCount: 0,
			proposalCount: 0,
			taskCount: 0,
			userSignalCount: 0,
			memoryItemCount: 0,
			criticalFindingCount: 0,
			highFindingCount: 0,
		},
		checkpoint: {
			projectId: "pi-telegram-bridge",
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
			labRuns: 1,
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
			newEventCount: 1,
		},
		recommendedNext:
			"Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

function fakeSemanticAuditRun(): SemanticAuditRunResult {
	return {
		projectId: "pi-telegram-bridge",
		runId: "audit-1",
		status: "completed",
		summary: "Auditoría manual registrada sin compactación.",
		checkpointUpdated: true,
		stats: fakeSemanticAuditStatus().stats,
		decision: fakeSemanticAuditStatus().decision,
		recommendedNext:
			"Esperar umbral o ejecutar futura compactación supervisada.",
	};
}

function fakePrepare(projectPath: string): IduPrepareResult {
	return {
		projectId: "pi-telegram-bridge",
		projectPath,
		initialStatus: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "aligned",
		readiness: "aligned_ready",
		differencesDetected: { screens: 0, uiElements: 0, dataStores: 0, flows: 0 },
		steps: [
			{
				id: "inspect_connection",
				status: "completed",
				summary: "ready",
			},
		],
		errors: [],
		finalRisk: "low",
		recommendedNext: "Listo para operar.",
		suggestedActions: ["idu-pi status"],
	};
}

function fakeRuntime(projectPath: string, workspaceRoot: string): CliRuntime {
	return {
		projectId: "pi-telegram-bridge",
		projectPath,
		workspaceRoot,
		inspectConnection: () => fakeConnection(projectPath),
		formatConnection: (report) =>
			["Estado CLI", report.projectId, report.status].join("\n"),
		formatDashboard: (report) =>
			[
				"Idu-pi activo",
				"",
				"Proyecto:",
				report.projectId ?? "—",
				"",
				"Acción principal:",
				"idu-pi prepare",
			].join("\n"),
		preflight: fakePreflight,
		formatPreflight: (report) =>
			[
				"Preflight Idu-pi",
				"",
				"Riesgo:",
				report.risk,
				"",
				"Solicitud:",
				report.request,
			].join("\n"),
		advisory: (request): ProjectAdvisory => ({
			level: /login/u.test(request) ? "risk" : "info",
			title: /login/u.test(request)
				? "Idu-pi Advisory — Riesgo alto"
				: "Idu-pi Advisory — Info",
			request,
			affectedAreas: /login/u.test(request) ? ["auth/seguridad"] : [],
			missingContext: [],
			warnings: [],
			availableContext: [],
			recommendation: "Pedir confirmación humana.",
			actions: ["idu-pi preflight"],
			requiresHumanConfirmation: /login/u.test(request),
			okToProceed: !/login/u.test(request),
		}),
		formatAdvisory: (advisory) =>
			[advisory.title, "", "Solicitud:", advisory.request].join("\n"),
		postflight: fakePostflight,
		formatPostflight: (report) =>
			["Postflight Idu-pi", "", "Riesgo:", report.risk].join("\n"),
		prepare: () => fakePrepare(projectPath),
		formatPrepare: (result) =>
			["Idu-pi Prepare", "", "Proyecto:", result.projectId].join("\n"),
		labReviewPlan: () => ({
			shouldReview: false,
			risk: "low",
			affectedAreas: [],
			suggestedAgentLabs: [],
			warnings: [],
			recommendedNext: "No se requiere revisión AgentLab para este riesgo.",
		}),
		formatLabReviewPlan: () =>
			"Lab Review Plan Idu-pi\n\nNo ejecuté AgentLabs; solo preparé el plan.",
		semanticAuditStatus: fakeSemanticAuditStatus,
		formatSemanticAuditStatus: (report) =>
			[
				"Semantic Audit Status",
				"",
				"Proyecto:",
				report.projectId,
				"",
				"shouldRun:",
				String(report.decision.shouldRun),
			].join("\n"),
		semanticAuditRun: fakeSemanticAuditRun,
		formatSemanticAuditRun: (result) =>
			[
				"Semantic Audit Run",
				"",
				"Estado:",
				result.status,
				"",
				"No usé IA, no compacté memoria, no borré datos y no ejecuté AgentLabs.",
			].join("\n"),
	};
}

test("cli status muestra estado sin escribir archivos", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const before = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		const result = await runCliCommand(["status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado CLI/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
		const after = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		assert.deepEqual(after, before);
	});
});

test("cli idu activa sesión persistente", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const result = await runCliCommand(["idu"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Guardrails automáticos activados/u);
		assert.equal(
			existsSync(join(workspaceRoot, "reports", "idu-session-state.json")),
			true,
		);
	});
});

test("cli idu-off desactiva sesión", async () => {
	await withRuntime(async (runtime) => {
		await runCliCommand(["idu"], runtime);
		const result = await runCliCommand(["idu-off"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado:\ninactive/u);
		assert.match(result.stdout, /guardrails:\nmanual/u);
	});
});

test("cli idu-status lee el mismo estado persistido", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		await runCliCommand(["idu"], runtime);
		configureIduSessionStore({ workspaceRoot });
		assert.equal(getIduSessionStatus("pi-telegram-bridge").active, true);

		const result = await runCliCommand(["idu-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado:\nactive/u);
		assert.match(result.stdout, /projectId:\npi-telegram-bridge/u);
	});
});

test("cli ignora separador -- que agrega pnpm run", async () => {
	await withRuntime(async (runtime) => {
		await runCliCommand(["idu"], runtime);

		const result = await runCliCommand(["--", "idu-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Estado:\nactive/u);
		assert.equal(result.stderr, "");
	});
});

test("cli prepare llama al flujo de idu_prepare", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["prepare"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Prepare/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
	});
});

test("cli preflight cambia login devuelve riesgo high", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["preflight", "cambia login"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Preflight Idu-pi/u);
		assert.match(result.stdout, /Riesgo:\nhigh/u);
	});
});

test("cli advisory cambia login devuelve advisory", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["advisory", "cambia login"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Advisory/u);
		assert.match(result.stdout, /cambia login/u);
	});
});

test("cli postflight funciona sin escribir archivos", async () => {
	await withRuntime(async (runtime, { workspaceRoot }) => {
		const before = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		const result = await runCliCommand(["postflight"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Postflight Idu-pi/u);
		const after = existsSync(join(workspaceRoot, "reports"))
			? readdirSync(join(workspaceRoot, "reports"))
			: [];
		assert.deepEqual(after, before);
	});
});

test("cli lab-review-plan postflight prepara plan sin AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["lab-review-plan", "postflight"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Lab Review Plan Idu-pi/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI semantic-audit-status funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["semantic-audit-status"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Audit Status/u);
		assert.match(result.stdout, /pi-telegram-bridge/u);
	});
});

test("CLI semantic-audit-run funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["semantic-audit-run"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Audit Run/u);
		assert.match(result.stdout, /No usé IA/u);
	});
});

test("comando desconocido muestra ayuda", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["desconocido"], runtime);

		assert.equal(result.exitCode, 1);
		assert.match(result.stderr, /Comando desconocido/u);
		assert.match(result.stdout, /Uso:/u);
	});
});

test("cli help no requiere runtime ni configuración", async () => {
	const result = await runCliCommand(["--help"]);

	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /Uso: idu-pi/u);
	assert.equal(result.stderr, "");
});
