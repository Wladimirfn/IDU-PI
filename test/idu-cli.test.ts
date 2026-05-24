import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	activateIduSession,
	configureIduSessionStore,
	getIduSessionStatus,
} from "../src/idu-session.js";
import {
	approveStructuredTaskById,
	createCliTask,
	formatCliTaskResult,
	rejectStructuredTaskById,
	runCliCommand,
	type CliRuntime,
} from "../src/cli.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import type { IduPrepareResult } from "../src/idu-prepare.js";
import type { ProjectAdvisory } from "../src/project-advisory.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type {
	SemanticAuditRunResult,
	SemanticAuditStatusReport,
} from "../src/semantic-audit-command.js";
import type {
	SaveSemanticCompactionDraftResult,
	SemanticCompactionReview,
} from "../src/semantic-compaction.js";
import type {
	SemanticAgentTaskCreationResult,
	SemanticAgentTaskPlan,
} from "../src/semantic-agent-tasks.js";
import {
	formatStructuredTaskQueueDetail,
	StructuredTaskQueue,
	type StructuredTask,
} from "../src/structured-task-queue.js";

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

function fakeSemanticCompactionDraft(
	workspaceRoot: string,
): SaveSemanticCompactionDraftResult {
	return {
		path: join(
			workspaceRoot,
			"reports",
			"semantic-compaction-draft-20260102-030405.json",
		),
		prompt: "safe compaction prompt",
		draft: {
			generatedAt: "2026-01-02T03:04:05.000Z",
			projectId: "pi-telegram-bridge",
			warning: "Borrador IA. No es fuente de verdad.",
			sourceAuditRunIds: ["audit-1"],
			inputSummary: { criticalFindings: 1 },
			preservedRules: ["No borrar datos"],
			criticalBugs: [{ title: "Critical auth bug" }],
			humanDecisions: [],
			reusableLessons: [],
			architecturalRisks: [],
			classifierQualityReview: {
				emotionCorrect: "needs_review",
				categoryCorrect: "needs_review",
				priorityCorrect: "needs_review",
				intentCorrect: "needs_review",
				guardrailCorrect: "needs_review",
				falsePositives: [],
				falseNegatives: [],
				errorPatterns: ["login typo"],
				recommendedRules: ["Si falla + db → bug/database/high"],
			},
			misclassifiedExamples: [],
			suggestedRuleUpdates: ["Si falla + db → bug/database/high"],
			suggestedSkillUpdates: [],
			suggestedMemoryItems: [],
			suggestedAgentTasks: ["Revisar seguridad auth/login"],
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function fakeSemanticCompactionReview(
	workspaceRoot: string,
): SemanticCompactionReview {
	const draft = fakeSemanticCompactionDraft(workspaceRoot).draft;
	return {
		path: join(
			workspaceRoot,
			"reports",
			"semantic-compaction-draft-20260102-030405.json",
		),
		validDraft: true,
		errors: [],
		draft,
		hasRawOutput: false,
		summary: {
			preservedRules: draft.preservedRules,
			criticalBugs: ["Critical auth bug"],
			classifierErrors: ["login typo"],
			suggestedRuleUpdates: draft.suggestedRuleUpdates,
			suggestedSkillUpdates: [],
			suggestedAgentTasks: draft.suggestedAgentTasks,
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function fakeSemanticAgentTaskPlan(): SemanticAgentTaskPlan {
	return {
		draftPath: "semantic-compaction-draft-20260102-030405.json",
		draftName: "semantic-compaction-draft-20260102-030405.json",
		projectId: "pi-telegram-bridge",
		validDraft: true,
		errors: [],
		candidates: [
			{
				type: "security",
				category: "review",
				title: "Revisar seguridad auth/login",
				priority: 5,
				reason: "findings críticos sobre auth/login",
				recommendation: "revisar seguridad de autenticación",
				evidence: "Critical auth bug",
				requiresHumanApproval: true,
				dedupeKey: "security:auth-login",
				queuePriority: 1,
				text: "Revisión SG5 semantic-audit — security: Revisar seguridad auth/login\nPrioridad semántica: 5\nPrioridad cola: 1\nNo ejecutar cambios sin aprobación humana.\nDedupe: security:auth-login",
			},
		],
	};
}

function fakeSemanticAgentTaskCreation(): SemanticAgentTaskCreationResult {
	return {
		plan: fakeSemanticAgentTaskPlan(),
		created: [
			{
				id: "task-sg5-1",
				text: "Revisión SG5 semantic-audit — security: Revisar seguridad auth/login",
				category: "review",
				priority: 5,
				status: "pending",
				createdAt: "2026-05-23T00:00:00.000Z",
				updatedAt: "2026-05-23T00:00:00.000Z",
				emotion: "neutral",
				source: "semantic-audit",
				projectId: "pi-telegram-bridge",
			},
		],
		skippedDuplicates: [],
	};
}

function fakeTask(): StructuredTask {
	return {
		id: "task-1",
		text: "Bug task. Symptom/context: urgente otra vez falló login",
		category: "bug",
		priority: 5,
		status: "pending",
		createdAt: "2026-05-23T00:00:00.000Z",
		updatedAt: "2026-05-23T00:00:00.000Z",
		emotion: "urgente",
		source: "cli",
		projectId: "pi-telegram-bridge",
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
		semanticCompactionDraft: () => fakeSemanticCompactionDraft(workspaceRoot),
		formatSemanticCompactionDraft: (result) =>
			[
				"Semantic Compaction Draft",
				"",
				"Ruta:",
				result.path,
				"",
				"No apliqué reglas, no creé semantic_memory_items, no borré datos y no ejecuté AgentLabs.",
			].join("\n"),
		semanticCompactionReview: () => fakeSemanticCompactionReview(workspaceRoot),
		formatSemanticCompactionReview: (review) =>
			[
				"Semantic Compaction Review",
				"",
				"Draft válido:",
				review.validDraft ? "sí" : "no",
				"",
				"suggestedRuleUpdates:",
				review.summary.suggestedRuleUpdates.join("\n"),
				"",
				"suggestedAgentTasks:",
				review.summary.suggestedAgentTasks.join("\n"),
			].join("\n"),
		semanticAgentTaskPlan: fakeSemanticAgentTaskPlan,
		formatSemanticAgentTaskPlan: (plan) =>
			[
				"Semantic Agent Tasks Review",
				"",
				"Tareas candidatas:",
				String(plan.candidates.length),
				"",
				"security — priority 5",
				"",
				"No ejecuté AgentLabs ni modifiqué código.",
			].join("\n"),
		semanticAgentTasksCreate: fakeSemanticAgentTaskCreation,
		formatSemanticAgentTaskCreationResult: (result) =>
			[
				"Semantic Agent Tasks Created",
				"",
				"Creadas:",
				...result.created.map(
					(task) => `- ${task.id} ${task.category} priority ${task.priority}`,
				),
				"",
				"Solo registré tareas para revisión. No ejecuté AgentLabs.",
			].join("\n"),
		createTask: fakeTask,
		formatTask: (task) =>
			[
				"Idu-pi Task",
				"",
				"Estado:",
				"queued",
				"",
				"ID:",
				task.id,
				"",
				"Nota segura:",
				"Registré la tarea y la señal localmente; no ejecuté IA ni AgentLabs.",
			].join("\n"),
		queueDetail: () => "Cola estructurada (1):\n\ntask-1 | pending | P5 | bug",
		queueClearStructured: () => 1,
		queueApprove: fakeTask,
		queueReject: fakeTask,
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

test("CLI semantic-compact-draft funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["semantic-compact-draft"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Compaction Draft/u);
		assert.match(result.stdout, /semantic-compaction-draft/u);
		assert.match(result.stdout, /no ejecuté AgentLabs/u);
	});
});

test("CLI semantic-compact-review latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["semantic-compact-review", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Compaction Review/u);
		assert.match(result.stdout, /suggestedRuleUpdates/u);
		assert.match(result.stdout, /suggestedAgentTasks/u);
	});
});

test("CLI semantic-agent-tasks-review latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["semantic-agent-tasks-review", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Agent Tasks Review/u);
		assert.match(result.stdout, /security — priority 5/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI semantic-agent-tasks-create latest funciona", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["semantic-agent-tasks-create", "latest"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Semantic Agent Tasks Created/u);
		assert.match(result.stdout, /task-sg5-1/u);
		assert.match(result.stdout, /No ejecuté AgentLabs/u);
	});
});

test("CLI task bug encola tarea sin AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-task", "bug", "urgente otra vez falló login"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Idu-pi Task/u);
		assert.match(result.stdout, /queued/u);
		assert.match(result.stdout, /no ejecuté IA ni AgentLabs/u);
	});
});

test("CLI idu-task sin argumentos muestra ayuda sin fallar", async () => {
	await withRuntime(async (runtime) => {
		let createTaskCalled = false;
		const result = await runCliCommand(["idu-task"], {
			...runtime,
			createTask: (kind, details) => {
				createTaskCalled = true;
				return runtime.createTask(kind, details);
			},
		});

		assert.equal(result.exitCode, 0);
		assert.equal(createTaskCalled, false);
		assert.match(result.stdout, /Plantillas de tarea/u);
		assert.equal(result.stderr, "");
	});
});

test("CLI idu-task infiere bug de falla en base de datos", async () => {
	await withRuntime(async (runtime) => {
		let capturedKind = "";
		let capturedDetails = "";
		const result = await runCliCommand(
			[
				"idu-task",
				"fallas",
				"en",
				"las",
				"bases",
				"de",
				"datos",
				"debemos",
				"arreglarla",
			],
			{
				...runtime,
				createTask: (kind, details) => {
					capturedKind = kind;
					capturedDetails = details;
					return fakeTask();
				},
			},
		);

		assert.equal(result.exitCode, 0);
		assert.equal(capturedKind, "bug");
		assert.equal(
			capturedDetails,
			"fallas en las bases de datos debemos arreglarla",
		);
		assert.match(result.stdout, /Idu-pi Task/u);
	});
});

test("CLI idu-task infiere bug desde texto libre", async () => {
	await withRuntime(async (runtime) => {
		let capturedKind = "";
		let capturedDetails = "";
		const result = await runCliCommand(
			["idu-task", "fallo", "nuevamente", "el", "login"],
			{
				...runtime,
				createTask: (kind, details) => {
					capturedKind = kind;
					capturedDetails = details;
					return fakeTask();
				},
			},
		);

		assert.equal(result.exitCode, 0);
		assert.equal(capturedKind, "bug");
		assert.equal(capturedDetails, "fallo nuevamente el login");
		assert.match(result.stdout, /Idu-pi Task/u);
	});
});

test("createCliTask inactive encola sin needs_confirmation", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-inactive-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		const task = createCliTask("bug", "urgente login falla", {
			projectId: "pi-telegram-bridge",
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: fakePreflight,
		});

		assert.equal(task.status, "pending");
		assert.notEqual(task.guardStatus, "needs_confirmation");
		assert.match(formatCliTaskResult(task), /queued/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createCliTask active bloquea login high con confirmación", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-active-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("pi-telegram-bridge");
		const task = createCliTask("bug", "urgente login falla", {
			projectId: "pi-telegram-bridge",
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: fakePreflight,
		});
		const formatted = formatCliTaskResult(task);

		assert.equal(task.guardStatus, "needs_confirmation");
		assert.equal(task.guardRisk, "high");
		assert.match(formatted, /Tarea pausada: requiere confirmación humana/u);
		assert.match(formatted, /Intención:/u);
		assert.match(formatted, /bug_report\/login\/high/u);
		assert.match(formatted, /idu-pi idu-queue-approve/u);
		assert.match(formatted, /idu-pi idu-queue-reject/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("createCliTask active usa intención humana aunque preflight sea low", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-task-intent-"));
	try {
		const workspaceRoot = join(root, "workspace");
		configureIduSessionStore({ workspaceRoot });
		activateIduSession("pi-telegram-bridge");
		const task = createCliTask("bug", "borrar base de datos y schema", {
			projectId: "pi-telegram-bridge",
			structuredTaskQueue: new StructuredTaskQueue({ workspaceRoot }),
			labDbRepository: new LabDbRepository(
				join(workspaceRoot, "reports", "lab.db"),
			),
			preflight: (request) => ({
				...fakePreflight(request.replace(/login/gu, "")),
				risk: "low",
				okToProceed: true,
				requiresHumanConfirmation: false,
			}),
		});

		assert.equal(task.intentRiskHint, "blocker");
		assert.equal(task.guardStatus, "needs_confirmation");
		assert.equal(task.guardRisk, "blocker");
		assert.match(task.guardReason ?? "", /intent blocker/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI queue-detail muestra cola estructurada", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-detail"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Cola estructurada/u);
	});
});

test("CLI queue-detail muestra comandos CLI para aprobación", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-detail"], {
			...runtime,
			queueDetail: () =>
				formatStructuredTaskQueueDetail(
					[
						{
							...fakeTask(),
							guardStatus: "needs_confirmation",
							guardRisk: "high",
						},
					],
					{
						approveCommand: (id) => `idu-pi idu-queue-approve ${id}`,
						rejectCommand: (id) => `idu-pi idu-queue-reject ${id}`,
					},
				),
		});

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Aprobar: idu-pi idu-queue-approve task-1/u);
		assert.match(result.stdout, /Rechazar: idu-pi idu-queue-reject task-1/u);
	});
});

test("CLI queue-clear-structured limpia cola estructurada", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-clear-structured"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Cola estructurada limpiada: 1 tarea/u);
	});
});

test("CLI queue-approve aprueba tarea sin ejecutar AgentLabs", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(
			["idu-queue-approve", "task-1"],
			runtime,
		);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Tarea aprobada: task-1/u);
		assert.match(result.stdout, /No ejecuté IA ni AgentLabs/u);
	});
});

test("CLI queue_reject rechaza tarea", async () => {
	await withRuntime(async (runtime) => {
		const result = await runCliCommand(["idu-queue-reject", "task-1"], runtime);

		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /Tarea rechazada: task-1/u);
	});
});

test("CLI queue-reject sin ID falla y no modifica cola", async () => {
	await withRuntime(async (runtime) => {
		let called = false;
		const guardedRuntime: CliRuntime = {
			...runtime,
			queueReject: () => {
				called = true;
				return fakeTask();
			},
		};

		const result = await runCliCommand(["idu-queue-reject"], guardedRuntime);

		assert.equal(result.exitCode, 1);
		assert.equal(called, false);
		assert.match(result.stderr, /Falta solicitud/u);
	});
});

test("CLI queue-approve sin ID falla y no modifica cola", async () => {
	await withRuntime(async (runtime) => {
		let called = false;
		const guardedRuntime: CliRuntime = {
			...runtime,
			queueApprove: () => {
				called = true;
				return fakeTask();
			},
		};

		const result = await runCliCommand(["idu-queue-approve"], guardedRuntime);

		assert.equal(result.exitCode, 1);
		assert.equal(called, false);
		assert.match(result.stderr, /Falta solicitud/u);
	});
});

test("CLI queue helpers exigen ID completo", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-queue-exact-"));
	try {
		const queue = new StructuredTaskQueue({ workspaceRoot: root });
		const task = queue.enqueueTask({
			text: "Bug task. Symptom/context: login falla",
			category: "bug",
			priority: 5,
		});
		queue.markNeedsConfirmation(task.id, {
			guardRisk: "high",
			guardReason: "preflight high",
		});

		assert.equal(
			approveStructuredTaskById(queue, task.id.slice(0, 12)),
			undefined,
		);
		assert.equal(queue.getTask(task.id)?.guardStatus, "needs_confirmation");
		assert.equal(
			approveStructuredTaskById(queue, task.id)?.guardStatus,
			"approved",
		);
		assert.equal(
			rejectStructuredTaskById(queue, task.id.slice(0, 12)),
			undefined,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI comandos muestra catálogo local sin runtime", async () => {
	const result = await runCliCommand(["comandos"]);

	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, /CLI pnpm/u);
	assert.match(result.stdout, /corepack pnpm cli -- semantic-compact-draft/u);
	assert.match(
		result.stdout,
		/corepack pnpm cli -- semantic-agent-tasks-create latest/u,
	);
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
