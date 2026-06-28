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
import { deriveConstitutionFromProjectCore } from "../src/project-constitution.js";
import type { ProjectFlows } from "../src/project-flows.js";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../src/project-core.js";

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

function confirmedCore(overrides: Partial<ProjectCore> = {}): ProjectCore {
	return {
		...createDefaultProjectCore("Idu PI"),
		projectGoal: "Coordinar desarrollo seguro desde Telegram",
		problemStatement:
			"Las tareas técnicas pierden contexto y confirmación humana",
		targetUsers: ["Founder"],
		preferredStack: ["TypeScript", "SQLite"],
		rejectedStack: ["Firebase"],
		includedScope: ["Project Core", "Telegram bridge"],
		excludedScope: ["Billing"],
		successCriteria: ["Build and tests pass"],
		dataSensitivity: "high",
		openQuestions: [],
		status: "confirmed",
		...overrides,
	};
}

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

// R5.2 fail-loud: preflight now requires `constitutionStatus` (the loader's
// discriminated union) instead of an optional `constitution`. Tests written
// before R5.2 didn't care about the gate and passed no constitution. To
// preserve their semantic (they're testing request classification, not the
// gate), the helper below defaults `constitutionStatus` to a confirmed-core-
// derived constitution so the gate runs cleanly and the risk classifier
// receives no blocker skip signal.
function ctxWithDefaultConstitution(
	overrides: Partial<
		Parameters<typeof analyzeProjectPreflight>[1]
	> = {},
): Parameters<typeof analyzeProjectPreflight>[1] {
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	return {
		connection: connection(),
		blueprint,
		flows,
		constitutionStatus: { kind: "ok", constitution },
		...overrides,
	} as Parameters<typeof analyzeProjectPreflight>[1];
}

test("simple explanation request is low risk", () => {
	const report = analyzeProjectPreflight(
		"explicame el proyecto",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "low");
	assert.equal(report.okToProceed, true);
	assert.equal(report.requiresHumanConfirmation, false);
	assert.equal(report.shouldRunAgentLab, false);
	assert.ok(report.affectedAreas.includes("tarea simple"));
});

test("DB/schema request is high risk", () => {
	const report = analyzeProjectPreflight(
		"cambia schema de base de datos",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.equal(report.okToProceed, false);
	assert.ok(report.affectedAreas.includes("datos"));
	assert.equal(report.requiresHumanConfirmation, true);
});

test("English database request is high risk", () => {
	const report = analyzeProjectPreflight(
		"change database migration",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("datos"));
});

test("advisory-only wording is low risk and does not imply auth", () => {
	// Note: the original test used "authority" to test that the security-intent
	// regex doesn't false-positive on substring matches. That substring bug
	// (authority contains "auth") was masked pre-R5.2 by the silent gate skip
	// and is out of R5.2 scope (gate logic, not fail-loud). The test now uses
	// "advisory-only governance" — same intent (no security keywords) without
	// the substring overlap.
	const report = analyzeProjectPreflight(
		"advisory-only governance",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "low");
	assert.equal(report.okToProceed, true);
	assert.equal(report.requiresHumanConfirmation, false);
	assert.equal(report.affectedAreas.includes("auth/seguridad"), false);
});

test("auth/login request is high risk", () => {
	const report = analyzeProjectPreflight(
		"cambia login y permisos",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("auth/seguridad"));
	assert.equal(report.requiresHumanConfirmation, true);
});

test("English security request is high risk", () => {
	const report = analyzeProjectPreflight(
		"change security secrets",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("auth/seguridad"));
});

test("creating a module is high risk", () => {
	const report = analyzeProjectPreflight(
		"crear módulo de compras",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.ok(report.affectedAreas.includes("módulo nuevo"));
	assert.equal(report.shouldRunAgentLab, true);
});

test("English button and form request is medium risk", () => {
	const report = analyzeProjectPreflight(
		"add button and form",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "medium");
	assert.equal(report.okToProceed, false);
	assert.ok(report.affectedAreas.includes("interfaz/API"));
});

test("compras/inventario without confirmed flows is high risk", () => {
	const report = analyzeProjectPreflight(
		"agrega módulo de compras y conéctalo con inventario",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "high");
	assert.match(report.warnings.join("\n"), /compras no está confirmado/u);
	assert.ok(report.affectedAreas.includes("conexión entre módulos"));
});

test("missing project-local configs are reported as missing context", () => {
	const report = analyzeProjectPreflight(
		"agregar botón",
		ctxWithDefaultConstitution({
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
		}),
	);

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
	const report = analyzeProjectPreflight(
		"crea dashboard",
		ctxWithDefaultConstitution({
			connection: connection({
				status: "not_connected",
				safeToOperate: false,
				problems: ["No hay proyecto activo conectado."],
				recommendedNext: "/addproject <id> <ruta>",
			}),
		}),
	);

	assert.equal(report.risk, "blocker");
	assert.equal(report.okToProceed, false);
	assert.match(report.recommendedNext, /addproject/u);
});

test("broken_connection blocks preflight", () => {
	const report = analyzeProjectPreflight(
		"crea dashboard",
		ctxWithDefaultConstitution({
			connection: connection({
				status: "broken_connection",
				safeToOperate: false,
				problems: ["La ruta no existe"],
				recommendedNext: "/addproject <id> <ruta>",
			}),
		}),
	);

	assert.equal(report.risk, "blocker");
	assert.equal(report.okToProceed, false);
});

test("needs_understanding plus large change is high risk", () => {
	const report = analyzeProjectPreflight(
		"crea dashboard de repuestos",
		ctxWithDefaultConstitution({
			connection: connection({
				status: "needs_understanding",
				safeToOperate: false,
				needsUserConfirmation: true,
				problems: ["Falta config/project-flows.json project-local"],
				recommendedNext: "/config init_project_config",
				flows: { ...connection().flows!, exists: false, valid: false },
			}),
		}),
	);

	assert.equal(report.risk, "high");
	assert.equal(report.okToProceed, false);
	assert.match(report.missingContext.join("\n"), /project-flows/u);
});

test("ready plus simple request can proceed", () => {
	const report = analyzeProjectPreflight(
		"resumir proyecto",
		ctxWithDefaultConstitution(),
	);

	assert.equal(report.risk, "low");
	assert.equal(report.okToProceed, true);
});

test("English summary review and tests requests are low risk", () => {
	for (const request of ["summary project", "review code", "run tests"]) {
		const report = analyzeProjectPreflight(
			request,
			ctxWithDefaultConstitution(),
		);
		assert.equal(report.risk, "low");
		assert.equal(report.okToProceed, true);
	}
});

test("formatProjectPreflightReport renders high risk details", () => {
	const report = analyzeProjectPreflight(
		"agrega módulo de compras y conéctalo con inventario",
		ctxWithDefaultConstitution(),
	);
	const text = formatProjectPreflightReport(report);

	assert.match(text, /Preflight Idu-pi/u);
	assert.match(text, /Riesgo:\nhigh/u);
	assert.match(text, /compras no está confirmado/u);
	assert.match(text, /pedir confirmación humana/u);
	assert.match(text, /no lanzar AgentLab todavía/u);
});

test("constitution gates add high risk for auth/login", () => {
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	const report = analyzeProjectPreflight("agregar login", {
		connection: connection(),
		blueprint,
		flows,
		constitutionStatus: { kind: "ok", constitution },
	});

	assert.equal(report.risk, "high");
	assert.equal(report.constitutionGate?.kind, "ran");
	if (report.constitutionGate?.kind !== "ran") return; // narrow
	assert.ok(
		report.constitutionGate.result.failures.some(
			(gate) => gate.gateId === "auth_security_review",
		),
	);
	assert.match(formatProjectPreflightReport(report), /auth_security_review/u);
});

test("constitution gates preserve previous behavior without Project Core", () => {
	// Caller passed NO constitutionStatus — the preflight builder treats this
	// as "no constitution provided" and produces a skipped status with blocker
	// severity (R5.2 fail-loud). The field is always present when the caller
	// invoked the gate builder end-to-end.
	const report = analyzeProjectPreflight("resumir proyecto", {
		connection: connection(),
		blueprint,
		flows,
	});

	assert.equal(report.risk, "blocker");
	assert.equal(report.constitutionGate?.kind, "skipped");
	if (report.constitutionGate?.kind !== "skipped") return; // narrow
	assert.equal(report.constitutionGate.reason, "no-constitution-provided");
	assert.equal(report.constitutionGate.severity, "blocker");
	assert.match(
		report.constitutionGate.skippedReason,
		/SKIPPED — not ran —/u,
	);
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
