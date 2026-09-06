import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	AgentLabFinding,
	AgentLabReport,
} from "../src/agentlab-contract.js";
import type { ProjectBlueprint } from "../src/project-blueprint.js";
import type { ProjectFlows } from "../src/project-flows.js";
import {
	validateAgentLabReportAgainstRules,
	validateFindingAgainstRules,
} from "../src/rule-validator.js";

function blueprint(): ProjectBlueprint {
	return {
		projectName: "Idu-pi",
		projectGoal: "Coordinate local AI agents safely.",
		projectType: "private-ai-orchestrator",
		version: "1.0.0",
		agentHierarchy: ["Humano = gerente", "AgentLabs = auditan"],
		architectureRules: ["JSONL remains primary"],
		forbiddenActions: [
			"Labs no pueden hacer commit.",
			"Labs no pueden hacer push.",
			"Labs no deben modificar repo real.",
		],
		qualityRules: ["Toda propuesta debe tener evidencia."],
		requiredValidation: ["corepack pnpm build", "corepack pnpm test"],
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
	};
}

function flows(): ProjectFlows {
	return {
		version: "1.0.0",
		projectType: "maintenance-dashboard",
		invariants: [
			"project-flows es el mapa funcional del proyecto real, no el mapa interno de Idu-pi.",
			"No aceptar findings sin evidence.",
		],
		qualityRules: ["Build/test deben preservarse."],
		forbiddenTransitions: ["machines-dashboard -> direct-delete"],
		allowedTransitions: [
			"create-machine-button -> createMachine -> operations-db",
		],
		validationChecklist: ["corepack pnpm build", "corepack pnpm test"],
		modules: [
			{
				id: "machines",
				name: "Máquinas",
				description: "Gestión de activos reales.",
				screens: ["machines-list"],
				dataStores: ["operations-db"],
				connectedModules: ["purchasing"],
			},
			{
				id: "purchasing",
				name: "Compras",
				description: "Gestión de compras de repuestos.",
				screens: ["purchase-dashboard"],
				dataStores: ["operations-db"],
				connectedModules: ["machines"],
			},
		],
		screens: [
			{
				id: "machines-list",
				path: "/machines",
				module: "machines",
				purpose: "Lista máquinas reales.",
				uiElements: ["create-machine-button", "machines-dashboard"],
			},
			{
				id: "purchase-dashboard",
				path: "/purchases",
				module: "purchasing",
				purpose: "Dashboard de compras.",
				uiElements: ["purchases-table"],
			},
		],
		uiElements: [
			{
				id: "create-machine-button",
				type: "button",
				selector: "[data-testid='create-machine']",
				label: "Crear máquina",
				expectedAction: "Creates a machine through createMachine.",
			},
			{
				id: "machines-dashboard",
				type: "dashboard",
				selector: "#machines-dashboard",
				label: "Dashboard máquinas",
				expectedAction: "Reads machines from operations-db.",
			},
			{
				id: "purchases-table",
				type: "table",
				selector: "#purchases-table",
				label: "Tabla compras",
				expectedAction: "Lists purchase requests.",
			},
		],
		dataStores: [
			{
				id: "operations-db",
				type: "sqlite",
				tables: ["machines", "purchases"],
				ownerModule: "machines",
			},
		],
		flows: [
			{
				id: "button-creates-machine",
				name: "Button creates machine",
				module: "machines",
				trigger: "User clicks create-machine-button",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "create-machine-button",
						to: "createMachine",
						description: "Button triggers createMachine.",
					},
					{
						order: 2,
						type: "data_write",
						from: "createMachine",
						to: "operations-db",
						description: "Function writes machine data.",
					},
				],
				expectedResult: "Machine appears in machines-dashboard.",
				testTargets: ["create-machine-button", "operations-db"],
			},
		],
		moduleConnections: [
			{
				fromModule: "machines",
				toModule: "purchasing",
				reason: "Máquinas solicitan repuestos a compras.",
				dataShared: ["machineId", "sparePartId"],
			},
		],
	};
}

function finding(
	patch: Partial<AgentLabFinding> = {},
): AgentLabFinding & { ruleIds?: string[] } {
	return {
		title: "Build fails",
		description: "Build exits with TypeScript errors.",
		evidence: "corepack pnpm build exited with code 2",
		severity: "medium",
		confidence: "high",
		category: "code_quality",
		proposal: {
			summary: "Fix the TypeScript error.",
			steps: ["Inspect build output", "Apply minimal fix"],
			risk: "Low.",
			requiresHumanApproval: false,
		},
		...patch,
	};
}

function report(patch: Partial<AgentLabReport> = {}): AgentLabReport {
	return {
		role: "code_quality",
		summary: "Lab report.",
		findings: [finding()],
		...patch,
	};
}

test("validateAgentLabReportAgainstRules passes a valid report", () => {
	const result = validateAgentLabReportAgainstRules(
		report(),
		blueprint(),
		flows(),
	);

	assert.deepEqual(result, { ok: true, failures: [], warnings: [] });
});

test("validateFindingAgainstRules fails when evidence is missing", () => {
	const invalid = finding({ evidence: "" });

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "evidence");
});

test("validateFindingAgainstRules fails high finding without human approval", () => {
	const invalid = finding({ severity: "high" });

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.message).join("\n"),
		/requiresHumanApproval/u,
	);
});

test("validateFindingAgainstRules fails when title is missing", () => {
	const result = validateFindingAgainstRules(
		finding({ title: "" }),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "title");
});

test("validateFindingAgainstRules fails when description is missing", () => {
	const result = validateFindingAgainstRules(
		finding({ description: "" }),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "description");
});

test("validateFindingAgainstRules fails proposal with commit from lab", () => {
	const invalid = finding({
		proposal: {
			summary: "Commit from lab workspace.",
			steps: ["Run git commit from lab"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].severity, "critical");
	assert.match(result.failures[0].message, /commit/u);
});

test("validateFindingAgainstRules fails proposal with push from lab", () => {
	const invalid = finding({
		proposal: {
			summary: "Push from lab workspace.",
			steps: ["git push origin feature"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].severity, "critical");
	assert.match(result.failures[0].message, /push/u);
});

test("validateFindingAgainstRules fails real repo modification from clone without approval", () => {
	const invalid = finding({
		proposal: {
			summary: "Modify repo real from clone.",
			steps: ["Edit real repo from clone workspace"],
			risk: "High.",
			requiresHumanApproval: false,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.ruleId).join("\n"),
		/realRepo\.humanApproval/u,
	);
});

test("validateFindingAgainstRules fails arbitrary blueprint forbiddenActions", () => {
	const customBlueprint = {
		...blueprint(),
		forbiddenActions: ["Delete production data"],
	};
	const invalid = finding({
		proposal: {
			summary: "Delete production data to reset state.",
			steps: ["Delete production data"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, customBlueprint, flows());

	assert.equal(result.ok, false);
	assert.match(result.failures[0].ruleId, /blueprint\.forbiddenActions/u);
});

test("validateFindingAgainstRules fails arbitrary flow invariants", () => {
	const customFlows = {
		...flows(),
		invariants: ["Never skip regression tests"],
	};
	const invalid = finding({
		proposal: {
			summary: "Skip regression tests for speed.",
			steps: ["Skip regression tests"],
			risk: "Medium.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), customFlows);

	assert.equal(result.ok, false);
	assert.match(result.failures[0].ruleId, /flows\.invariants/u);
});

test("validateFindingAgainstRules does not warn for existing functional module", () => {
	const result = validateFindingAgainstRules(
		finding({
			description: "The machines module fails to persist a machine.",
			proposal: {
				summary: "Fix the machines flow.",
				steps: ["Update machines module handling"],
				risk: "Low.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.deepEqual(result.warnings, []);
});

test("validateFindingAgainstRules warns for missing functional module", () => {
	const result = validateFindingAgainstRules(
		finding({
			description: "The billing module fails to persist a report.",
			proposal: {
				summary: "Fix billing module handling.",
				steps: ["Update billing module"],
				risk: "Low.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.match(
		result.warnings.map((warning) => warning.ruleId).join("\n"),
		/flows\.module\.unknown/u,
	);
	assert.match(
		result.warnings.map((warning) => warning.message).join("\n"),
		/billing/u,
	);
});

test("validateFindingAgainstRules warns for missing functional screen", () => {
	const result = validateFindingAgainstRules(
		finding({
			description: "The /settings route shows stale data.",
			proposal: {
				summary: "Fix screen /settings refresh.",
				steps: ["Update screen /settings"],
				risk: "Low.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.match(
		result.warnings.map((warning) => warning.ruleId).join("\n"),
		/flows\.screen\.unknown/u,
	);
	assert.match(
		result.warnings.map((warning) => warning.message).join("\n"),
		/settings/u,
	);
});

test("validateFindingAgainstRules warns when proposal touches missing dataStore", () => {
	const result = validateFindingAgainstRules(
		finding({
			proposal: {
				summary: "Write reports to metrics-store.",
				steps: ["Persist report in metrics-store"],
				risk: "Medium.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.match(
		result.warnings.map((warning) => warning.ruleId).join("\n"),
		/flows\.dataStore\.unknown/u,
	);
	assert.match(
		result.warnings.map((warning) => warning.message).join("\n"),
		/metrics-store/u,
	);
});

test("validateFindingAgainstRules warns when proposal touches missing uiElement", () => {
	const result = validateFindingAgainstRules(
		finding({
			proposal: {
				summary: "Wire export-button to lab reports.",
				steps: ["Update export-button click behavior"],
				risk: "Medium.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.match(
		result.warnings.map((warning) => warning.ruleId).join("\n"),
		/flows\.uiElement\.unknown/u,
	);
	assert.match(
		result.warnings.map((warning) => warning.message).join("\n"),
		/export-button/u,
	);
});

test("validateFindingAgainstRules fails high dataStore change without approval", () => {
	const result = validateFindingAgainstRules(
		finding({
			severity: "high",
			proposal: {
				summary: "Change operations-db persistence format.",
				steps: ["Migrate operations-db records"],
				risk: "High.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.ruleId).join("\n"),
		/flows\.protectedChange\.approvalRequired/u,
	);
});

test("validateFindingAgainstRules warns when proposal contradicts existing flow", () => {
	const result = validateFindingAgainstRules(
		finding({
			proposal: {
				summary:
					"Bypass create-machine-button and write directly to operations-db.",
				steps: [
					"Skip create-machine-button",
					"Write directly to operations-db",
				],
				risk: "Medium.",
				requiresHumanApproval: false,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.match(
		result.warnings.map((warning) => warning.ruleId).join("\n"),
		/flows\.flow\.contradiction/u,
	);
});

test("validateFindingAgainstRules fails high approved proposal that contradicts existing flow", () => {
	const result = validateFindingAgainstRules(
		finding({
			severity: "high",
			proposal: {
				summary:
					"Bypass create-machine-button and write directly to operations-db.",
				steps: [
					"Skip create-machine-button",
					"Write directly to operations-db",
				],
				risk: "High.",
				requiresHumanApproval: true,
			},
		}),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.ruleId).join("\n"),
		/flows\.flow\.contradiction/u,
	);
});

test("validateFindingAgainstRules warns on unknown ruleIds", () => {
	const result = validateFindingAgainstRules(
		finding({ ruleIds: ["missing-rule"] } as Partial<AgentLabFinding>),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].ruleId, "missing-rule");
});

test("validateAgentLabReportAgainstRules passes report with no findings", () => {
	const result = validateAgentLabReportAgainstRules(
		report({ findings: [] }),
		blueprint(),
		flows(),
	);

	assert.deepEqual(result, { ok: true, failures: [], warnings: [] });
});

test("rule validation does not modify inputs", () => {
	const inputReport = report();
	const before = JSON.stringify(inputReport);

	validateAgentLabReportAgainstRules(inputReport, blueprint(), flows());

	assert.equal(JSON.stringify(inputReport), before);
});
