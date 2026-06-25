import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	shouldUseAutomaticGuardrails,
} from "../src/idu-session.js";
import {
	buildLabReviewPlan,
	formatLabReviewPlan,
} from "../src/lab-review-plan.js";
import {
	buildProjectAdvisory,
	formatProjectAdvisory,
} from "../src/project-advisory.js";
import type { ProjectBlueprint } from "../src/project-blueprint.js";
import { confirmProjectCore } from "../src/project-core-confirmation.js";
import {
	createDefaultProjectCore,
	loadProjectCore,
	type ProjectCore,
} from "../src/project-core.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import {
	deriveConstitutionFromProjectCore,
	type ProjectConstitution,
} from "../src/project-constitution.js";
import type { ProjectFlows } from "../src/project-flows.js";
import {
	analyzeProjectPostflight,
	formatProjectPostflightReport,
} from "../src/project-postflight.js";
import {
	analyzeProjectPreflight,
	formatProjectPreflightReport,
	type ProjectPreflightReport,
} from "../src/project-preflight.js";
import {
	StructuredTaskQueue,
	structuredTaskInputForText,
} from "../src/structured-task-queue.js";

async function withTempProject(
	fn: (paths: {
		projectPath: string;
		stateRoot: string;
		reportsDir: string;
	}) => Promise<void> | void,
): Promise<void> {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-auto-mode-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-auto-mode-state-"));
	try {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		mkdirSync(join(projectPath, "reports"), { recursive: true });
		await fn({
			projectPath,
			stateRoot,
			reportsDir: join(projectPath, "reports"),
		});
	} finally {
		await rm(projectPath, { recursive: true, force: true });
		await rm(stateRoot, { recursive: true, force: true });
	}
}

function completeDraftCore(overrides: Partial<ProjectCore> = {}): ProjectCore {
	return {
		...createDefaultProjectCore("Idu PI"),
		projectGoal: "Supervisar desarrollo seguro desde Telegram",
		problemStatement:
			"Las tareas técnicas necesitan contexto ejecutable y confirmación humana.",
		targetUsers: ["Founder", "Maintainer"],
		projectType: "telegram-bot",
		complexityLevel: "medium",
		deploymentTarget: "server",
		securityLevel: "high",
		dataSensitivity: "high",
		preferredStack: ["TypeScript", "SQLite"],
		rejectedStack: ["Firebase"],
		architectureStyle: "Telegram bridge with deterministic supervisor",
		includedScope: ["Telegram bridge", "Project Core", "Idu-pi supervisor"],
		excludedScope: ["Billing", "juego"],
		initialModules: ["idu-session", "project-core", "preflight"],
		criticalFlows: ["/idu -> guardrails -> preflight -> human confirmation"],
		successCriteria: ["Build and tests pass", "Human confirms Project Core"],
		validationCommands: ["corepack pnpm build", "corepack pnpm test"],
		humanDecisions: ["Draft created by human wizard"],
		assumptions: [],
		openQuestions: [],
		status: "draft",
		createdAt: "2026-05-22T00:00:00.000Z",
		updatedAt: "2026-05-22T00:00:00.000Z",
		...overrides,
	};
}

function connection(projectPath: string): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["sin scan reciente"],
		projectId: "idu-pi",
		projectPath,
		problems: [],
		warnings: [],
		recommendedNext: "/idu_prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-22T00:00:00.000Z",
		blueprint: {
			exists: true,
			source: "project-local",
			valid: true,
			path: join(projectPath, "config", "project-blueprint.json"),
			errors: [],
		},
		flows: {
			exists: true,
			source: "project-local",
			valid: true,
			path: join(projectPath, "config", "project-flows.json"),
			errors: [],
		},
	};
}

const blueprint: ProjectBlueprint = {
	projectName: "Idu PI",
	projectGoal: "Supervisar desarrollo seguro desde Telegram",
	projectType: "telegram-bot",
	version: "1",
	agentHierarchy: [],
	architectureRules: [],
	forbiddenActions: [],
	qualityRules: [],
	requiredValidation: [],
	createdAt: "2026-05-22T00:00:00.000Z",
	updatedAt: "2026-05-22T00:00:00.000Z",
};

const flows: ProjectFlows = {
	version: "1",
	projectType: "telegram-bot",
	invariants: [],
	qualityRules: [],
	forbiddenTransitions: [],
	allowedTransitions: [],
	validationChecklist: [],
	modules: [
		{
			id: "telegram-bridge",
			name: "Telegram Bridge",
			description: "Telegram command surface",
			screens: [],
			dataStores: ["reports"],
			connectedModules: ["project-core"],
		},
		{
			id: "project-core",
			name: "Project Core",
			description: "Executable project specification",
			screens: [],
			dataStores: ["config"],
			connectedModules: ["telegram-bridge"],
		},
	],
	screens: [],
	uiElements: [],
	dataStores: [
		{
			id: "reports",
			type: "json",
			tables: [],
			ownerModule: "telegram-bridge",
		},
		{
			id: "config",
			type: "json",
			tables: [],
			ownerModule: "project-core",
		},
	],
	flows: [],
	moduleConnections: [],
};

function forbidEmbeddedJs(
	constitution: ProjectConstitution,
): ProjectConstitution {
	return {
		...constitution,
		forbiddenPractices: [...constitution.forbiddenPractices, "JS embebido"],
	};
}

function applyAutoGuardIfActive(
	queue: StructuredTaskQueue,
	projectId: string,
	text: string,
	report: ProjectPreflightReport,
) {
	if (!shouldUseAutomaticGuardrails(projectId)) return undefined;
	const task = queue.enqueueTask(
		structuredTaskInputForText(text, {
			source: "queue-guard",
			projectId,
		}),
	);
	if (report.risk === "high" || report.risk === "blocker") {
		return queue.markNeedsConfirmation(task.id, {
			guardRisk: report.risk,
			guardReason: report.recommendedNext,
		});
	}
	return queue.markGuardClear(task.id, report.risk, report.recommendedNext);
}

test("Idu-pi auto mode ties confirmed Project Core to Constitution gates and guarded queue", async () => {
	await withTempProject(async ({ projectPath, stateRoot, reportsDir }) => {
		// Slice 3/5: the loader reads from stateRoot, so the draft must be
		// seeded under stateRoot/.idu/config/ (Layout A).
		const corePath = join(stateRoot, ".idu", "config", "project-core.json");
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			corePath,
			`${JSON.stringify(completeDraftCore(), null, "\t")}\n`,
		);

		const confirmResult = confirmProjectCore({
			projectPath,
			stateRoot,
			reportsDir,
			now: () => new Date("2026-05-22T12:00:00.000Z"),
		});
		assert.equal(confirmResult.ok, true);
		assert.equal(confirmResult.status, "confirmed");
		assert.ok(confirmResult.backupPath?.endsWith(".json"));
		// Territory: backup lives under stateRoot/tmp/ (scratch), not under
		// <repo>/config/.
		assert.ok(
			readdirSync(join(stateRoot, "tmp")).some((entry) =>
				/^project-core\.backup-/u.test(entry),
			),
		);

		const confirmedCore = loadProjectCore(stateRoot);
		assert.equal(confirmedCore.status, "confirmed");
		assert.ok(
			confirmedCore.humanDecisions.some(
				(decision) =>
					typeof decision === "object" &&
					decision.decision === "confirmed_project_core",
			),
		);

		const constitution = forbidEmbeddedJs(
			deriveConstitutionFromProjectCore(confirmedCore),
		);
		assert.equal(constitution.status, "active");
		assert.equal(constitution.sourceCoreStatus, "confirmed");

		const preflight = analyzeProjectPreflight("agrega un juego a la web", {
			connection: connection(projectPath),
			blueprint,
			flows,
			constitution,
		});
		assert.equal(preflight.risk, "blocker");
		assert.equal(preflight.requiresHumanConfirmation, true);
		assert.ok(
			preflight.constitutionGate?.affectedRules.includes("scope_excluded"),
		);
		assert.match(formatProjectPreflightReport(preflight), /scope_excluded/u);

		const advisory = buildProjectAdvisory(
			analyzeProjectPreflight("usa JS embebido en la página", {
				connection: connection(projectPath),
				blueprint,
				flows,
				constitution,
			}),
		);
		const advisoryText = formatProjectAdvisory(advisory);
		assert.equal(advisory.level, "blocker");
		assert.match(advisoryText, /Reglas afectadas:/u);
		assert.match(advisoryText, /forbidden_practice/u);
		assert.match(advisoryText, /No ejecuté scan, IA ni AgentLabs/u);

		const postflight = analyzeProjectPostflight({
			projectPath,
			connectionReport: connection(projectPath),
			changedFiles: ["src/auth/login.ts", "src/lab-db.ts"],
			constitution,
		});
		assert.equal(postflight.risk, "high");
		assert.ok(
			postflight.constitutionGate?.affectedRules.includes(
				"auth_security_review",
			),
		);
		assert.ok(
			postflight.constitutionGate?.affectedRules.includes("db_schema_plan"),
		);
		assert.match(
			formatProjectPostflightReport(postflight),
			/auth_security_review/u,
		);
		assert.match(formatProjectPostflightReport(postflight), /db_schema_plan/u);

		configureIduSessionStore({
			filePath: join(reportsDir, "idu-session-state.json"),
		});
		deactivateIduSession("idu-pi");
		assert.equal(shouldUseAutomaticGuardrails("idu-pi"), false);

		const queue = new StructuredTaskQueue({
			filePath: join(reportsDir, "tasks.jsonl"),
		});
		assert.equal(queue.listTasks().length, 0);
		assert.equal(
			shouldUseAutomaticGuardrails("idu-pi") &&
				preflight.requiresHumanConfirmation,
			false,
		);

		activateIduSession("idu-pi");
		assert.equal(shouldUseAutomaticGuardrails("idu-pi"), true);
		const guardedPreflight = analyzeProjectPreflight(
			"/task bug urgente cambia login y base de datos",
			{
				connection: connection(projectPath),
				blueprint,
				flows,
				constitution,
			},
		);
		assert.equal(guardedPreflight.risk, "high");
		assert.equal(guardedPreflight.requiresHumanConfirmation, true);
		const paused = applyAutoGuardIfActive(
			queue,
			"idu-pi",
			"/task bug urgente cambia login y base de datos",
			guardedPreflight,
		);
		assert.equal(paused?.guardStatus, "needs_confirmation");
		assert.equal(paused?.guardRisk, "high");

		deactivateIduSession("idu-pi");
		assert.equal(shouldUseAutomaticGuardrails("idu-pi"), false);
		const taskCountAfterIduOff = queue.listTasks().length;
		const notPausedAfterIduOff = applyAutoGuardIfActive(
			queue,
			"idu-pi",
			"/task bug urgente cambia login y base de datos",
			guardedPreflight,
		);
		assert.equal(notPausedAfterIduOff, undefined);
		assert.equal(queue.listTasks().length, taskCountAfterIduOff);
		assert.equal(
			queue
				.listTasks()
				.filter((candidate) => candidate.guardStatus === "needs_confirmation")
				.length,
			1,
		);

		const labPlan = buildLabReviewPlan({
			projectId: "idu-pi",
			postflightReport: postflight,
		});
		assert.equal(labPlan.shouldReview, true);
		assert.equal(labPlan.structuredTaskInput?.category, "review");
		assert.equal(labPlan.structuredTaskInput?.source, "idu-pi");
		assert.ok(labPlan.suggestedAgentLabs.includes("security"));
		assert.ok(labPlan.suggestedAgentLabs.includes("database"));
		assert.match(formatLabReviewPlan(labPlan), /No ejecuté AgentLabs/u);
	});
});
