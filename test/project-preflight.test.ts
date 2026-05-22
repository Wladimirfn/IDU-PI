import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProjectBlueprint } from "../src/project-blueprint.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import {
	analyzeProjectPreflight,
	formatProjectPreflightReport,
} from "../src/project-preflight.js";
import type { ProjectFlows } from "../src/project-flows.js";

function connection(
	overrides: Partial<ProjectConnectionReport> = {},
): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["no existe scan reciente"],
		projectId: "demo",
		projectPath: "/demo",
		problems: [],
		warnings: [],
		recommendedNext: "/idu_prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-21T00:00:00.000Z",
		blueprint: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "/demo/config/project-blueprint.json",
			errors: [],
		},
		flows: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "/demo/config/project-flows.json",
			errors: [],
		},
		...overrides,
	};
}

const blueprint: ProjectBlueprint = {
	projectName: "Demo",
	projectGoal: "Demo system",
	projectType: "maintenance-system",
	version: "1",
	agentHierarchy: [],
	architectureRules: [],
	forbiddenActions: [],
	qualityRules: [],
	requiredValidation: [],
	createdAt: "2026-05-21T00:00:00.000Z",
	updatedAt: "2026-05-21T00:00:00.000Z",
};

const flows: ProjectFlows = {
	version: "1",
	projectType: "maintenance-system",
	invariants: [],
	qualityRules: [],
	forbiddenTransitions: [],
	allowedTransitions: [],
	validationChecklist: [],
	modules: [
		{
			id: "inventario",
			name: "Inventario",
			description: "Stock",
			screens: [],
			dataStores: ["stock"],
			connectedModules: [],
		},
	],
	screens: [],
	uiElements: [],
	dataStores: [
		{
			id: "stock",
			type: "sqlite",
			tables: ["stock"],
			ownerModule: "inventario",
		},
	],
	flows: [],
	moduleConnections: [],
};

test("simple explanation request is low risk", () => {
	const report = analyzeProjectPreflight("explicame el proyecto", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "low");
	assert.equal(report.okToProceed, true);
	assert.equal(report.requiresHumanConfirmation, false);
	assert.equal(report.shouldRunAgentLab, false);
	assert.ok(report.affectedAreas.includes("tarea simple"));
});

test("DB/schema request is high risk", () => {
	const report = analyzeProjectPreflight("cambia schema de base de datos", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "high");
	assert.equal(report.okToProceed, false);
	assert.ok(report.affectedAreas.includes("datos"));
	assert.equal(report.requiresHumanConfirmation, true);
});

test("English database request is high risk", () => {
	const report = analyzeProjectPreflight("change database migration", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("datos"));
});

test("auth/login request is high risk", () => {
	const report = analyzeProjectPreflight("cambia login y permisos", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("auth/seguridad"));
	assert.equal(report.requiresHumanConfirmation, true);
});

test("English security request is high risk", () => {
	const report = analyzeProjectPreflight("change security secrets", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("auth/seguridad"));
});

test("creating a module is high risk", () => {
	const report = analyzeProjectPreflight("crear módulo de compras", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("módulo nuevo"));
	assert.equal(report.shouldRunAgentLab, true);
});

test("English button and form request is medium risk", () => {
	const report = analyzeProjectPreflight("add button and form", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "medium");
	assert.equal(report.okToProceed, false);
	assert.ok(report.affectedAreas.includes("interfaz/API"));
});

test("compras/inventario without confirmed flows is high risk", () => {
	const report = analyzeProjectPreflight(
		"agrega módulo de compras y conéctalo con inventario",
		{ connection: connection(), blueprint, flows },
	);

	assert.equal(report.risk, "high");
	assert.match(report.warnings.join("\n"), /compras no está confirmado/u);
	assert.ok(report.affectedAreas.includes("conexión entre módulos"));
});

test("missing project-local configs are reported as missing context", () => {
	const report = analyzeProjectPreflight("agregar botón", {
		connection: connection({
			status: "needs_understanding",
			blueprint: {
				exists: false,
				source: "default",
				valid: true,
				path: "/demo/config/default-blueprint.json",
				errors: [],
			},
			flows: {
				exists: false,
				source: "default",
				valid: true,
				path: "/demo/config/default-flows.json",
				errors: [],
			},
		}),
	});

	assert.match(
		report.missingContext.join("\n"),
		/Falta config\/project-blueprint\.json project-local/u,
	);
	assert.match(
		report.missingContext.join("\n"),
		/Falta config\/project-flows\.json project-local/u,
	);
	assert.doesNotMatch(
		report.missingContext.join("\n"),
		/project-local válido/u,
	);
});

test("not_connected blocks preflight", () => {
	const report = analyzeProjectPreflight("crea dashboard", {
		connection: connection({
			status: "not_connected",
			safeToOperate: false,
			problems: ["No hay proyecto activo conectado."],
			recommendedNext: "/addproject <id> <ruta>",
		}),
	});

	assert.equal(report.risk, "blocker");
	assert.equal(report.okToProceed, false);
	assert.match(report.recommendedNext, /addproject/u);
});

test("broken_connection blocks preflight", () => {
	const report = analyzeProjectPreflight("crea dashboard", {
		connection: connection({
			status: "broken_connection",
			safeToOperate: false,
			problems: ["La ruta no existe"],
			recommendedNext: "/addproject <id> <ruta>",
		}),
	});

	assert.equal(report.risk, "blocker");
	assert.equal(report.okToProceed, false);
});

test("needs_understanding plus large change is high risk", () => {
	const report = analyzeProjectPreflight("crea dashboard de repuestos", {
		connection: connection({
			status: "needs_understanding",
			safeToOperate: false,
			needsUserConfirmation: true,
			problems: ["Falta config/project-flows.json project-local"],
			recommendedNext: "/config init_project_config",
			flows: { ...connection().flows!, exists: false, valid: false },
		}),
	});

	assert.equal(report.risk, "high");
	assert.equal(report.okToProceed, false);
	assert.match(report.missingContext.join("\n"), /project-flows/u);
});

test("ready plus simple request can proceed", () => {
	const report = analyzeProjectPreflight("resumir proyecto", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "low");
	assert.equal(report.okToProceed, true);
});

test("English summary review and tests requests are low risk", () => {
	for (const request of ["summary project", "review code", "run tests"]) {
		const report = analyzeProjectPreflight(request, {
			connection: connection(),
			blueprint,
			flows,
		});
		assert.equal(report.risk, "low");
		assert.equal(report.okToProceed, true);
	}
});

test("formatProjectPreflightReport renders high risk details", () => {
	const report = analyzeProjectPreflight(
		"agrega módulo de compras y conéctalo con inventario",
		{ connection: connection(), blueprint, flows },
	);
	const text = formatProjectPreflightReport(report);

	assert.match(text, /Preflight Idu-pi/u);
	assert.match(text, /Riesgo:\nhigh/u);
	assert.match(text, /compras no está confirmado/u);
	assert.match(text, /pedir confirmación humana/u);
	assert.match(text, /no lanzar AgentLab todavía/u);
});

test("analyzeProjectPreflight does not write files", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-preflight-"));
	try {
		const before = readdirSync(dir);
		analyzeProjectPreflight("explicar", {
			connection: connection({ projectPath: dir }),
			projectPath: dir,
		});
		assert.deepEqual(readdirSync(dir), before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
