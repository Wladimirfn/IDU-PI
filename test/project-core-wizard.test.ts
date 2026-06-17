import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProjectCore } from "../src/project-core.js";
import {
	answerProjectCoreWizard,
	formatProjectCoreWizardPrompt,
	formatProjectCoreWizardSummary,
	getProjectCoreWizardStatus,
	startProjectCoreWizard,
} from "../src/project-core-wizard.js";

async function withTempPaths(
	fn: (paths: {
		projectPath: string;
		stateRoot: string;
		workspaceRoot: string;
	}) => void | Promise<void>,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "idu-core-wizard-"));
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	const workspaceRoot = join(root, "workspace");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	mkdirSync(workspaceRoot, { recursive: true });
	try {
		await fn({ projectPath, stateRoot, workspaceRoot });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function options(paths: {
	projectPath: string;
	stateRoot: string;
	workspaceRoot: string;
}) {
	return {
		...paths,
		projectId: "demo",
		projectName: "Demo",
		now: () => new Date("2026-05-22T10:00:00.000Z"),
	};
}

const answers = [
	"Un sistema de órdenes de trabajo",
	"Las solicitudes se pierden por WhatsApp",
	"Planificadores y técnicos",
	"escalable",
	"server",
	"high",
	"medium",
	"Solicitudes, planificación, cierre",
	"Facturación y compras",
	"Reducir solicitudes perdidas y cerrar OTs trazables",
];

test("startProjectCoreWizard creates initial state", async () => {
	await withTempPaths((paths) => {
		const result = startProjectCoreWizard(options(paths));

		assert.equal(result.state.projectId, "demo");
		assert.equal(result.state.currentStep, 0);
		assert.equal(result.state.status, "active");
		assert.match(
			formatProjectCoreWizardPrompt(result.state),
			/Qué quieres construir/u,
		);
		assert.ok(
			existsSync(
				join(paths.workspaceRoot, "reports", "project-core-wizard-state.json"),
			),
		);
	});
});

test("answerProjectCoreWizard advances questions", async () => {
	await withTempPaths((paths) => {
		startProjectCoreWizard(options(paths));

		const result = answerProjectCoreWizard(options(paths), answers[0]);

		assert.equal(result.state.currentStep, 1);
		assert.equal(result.state.answers.projectGoal, answers[0]);
		assert.equal(result.completed, false);
		assert.match(result.message, /problema resuelve/u);
	});
});

test("answerProjectCoreWizard creates ProjectCore draft when complete", async () => {
	await withTempPaths((paths) => {
		startProjectCoreWizard(options(paths));
		let result;
		for (const answer of answers)
			result = answerProjectCoreWizard(options(paths), answer);

		assert.equal(result?.completed, true);
		// Territory model: project-core.json lives under <repo>/.idu/config/.
		const corePath = join(
			paths.projectPath,
			".idu",
			"config",
			"project-core.json",
		);
		assert.ok(existsSync(corePath));
		const core = loadProjectCore(paths.projectPath);
		assert.equal(core.status, "draft");
		assert.equal(core.projectGoal, answers[0]);
		assert.equal(core.problemStatement, answers[1]);
		assert.equal(core.complexityLevel, "scalable");
		assert.equal(core.deploymentTarget, "server");
		assert.equal(core.securityLevel, "high");
		assert.equal(core.dataSensitivity, "medium");
		assert.deepEqual(core.initialModules, [
			"Solicitudes",
			"planificación",
			"cierre",
		]);
		assert.match(
			formatProjectCoreWizardSummary(core),
			/Project Core draft creado/u,
		);
	});
});

test("answerProjectCoreWizard does not overwrite confirmed ProjectCore", async () => {
	await withTempPaths((paths) => {
		mkdirSync(join(paths.projectPath, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(paths.projectPath, ".idu", "config", "project-core.json"),
			JSON.stringify({
				version: "1.0.0",
				projectName: "Confirmed",
				projectGoal: "Keep me",
				problemStatement: "Confirmed problem",
				targetUsers: ["admin"],
				projectType: "telegram-bot",
				complexityLevel: "medium",
				deploymentTarget: "server",
				securityLevel: "high",
				dataSensitivity: "medium",
				preferredStack: [],
				rejectedStack: [],
				architectureStyle: "confirmed",
				includedScope: ["confirmed scope"],
				excludedScope: ["nope"],
				initialModules: ["core"],
				criticalFlows: ["confirmed flow"],
				successCriteria: ["confirmed success"],
				validationCommands: [],
				humanDecisions: ["confirmed by human"],
				assumptions: [],
				openQuestions: [],
				status: "confirmed",
				createdAt: "2026-05-01T00:00:00.000Z",
				updatedAt: "2026-05-01T00:00:00.000Z",
			}),
		);
		startProjectCoreWizard(options(paths));

		assert.throws(() => {
			for (const answer of answers)
				answerProjectCoreWizard(options(paths), answer);
		}, /Project Core confirmed/u);
		const core = loadProjectCore(paths.projectPath);
		assert.equal(core.projectGoal, "Keep me");
		assert.equal(core.status, "confirmed");
	});
});

test("wizard state persists and reloads", async () => {
	await withTempPaths((paths) => {
		startProjectCoreWizard(options(paths));
		answerProjectCoreWizard(options(paths), answers[0]);

		const status = getProjectCoreWizardStatus(options(paths));

		assert.equal(status.state?.currentStep, 1);
		assert.equal(status.state?.answers.projectGoal, answers[0]);
		assert.match(status.text, /Wizard Project Core activo/u);
	});
});

test("getProjectCoreWizardStatus reports local ProjectCore summary and open questions", async () => {
	await withTempPaths((paths) => {
		startProjectCoreWizard(options(paths));
		for (const answer of answers)
			answerProjectCoreWizard(options(paths), answer);

		const status = getProjectCoreWizardStatus(options(paths));

		assert.match(status.text, /Project Core local: existe/u);
		assert.match(status.text, /Estado: draft/u);
		assert.match(status.text, /Objetivo: Un sistema/u);
		assert.match(status.text, /Preguntas abiertas/u);
	});
});

test("wizard does not modify blueprint or flows", async () => {
	await withTempPaths((paths) => {
		mkdirSync(join(paths.projectPath, "config"), { recursive: true });
		const blueprintPath = join(
			paths.projectPath,
			"config",
			"project-blueprint.json",
		);
		const flowsPath = join(paths.projectPath, "config", "project-flows.json");
		writeFileSync(blueprintPath, "blueprint untouched");
		writeFileSync(flowsPath, "flows untouched");
		startProjectCoreWizard(options(paths));
		for (const answer of answers)
			answerProjectCoreWizard(options(paths), answer);

		assert.equal(readFileSync(blueprintPath, "utf8"), "blueprint untouched");
		assert.equal(readFileSync(flowsPath, "utf8"), "flows untouched");
	});
});
