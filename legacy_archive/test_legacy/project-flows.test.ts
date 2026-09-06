import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatFlowsForPrompt,
	loadProjectFlows,
	validateProjectFlows,
} from "../src/project-flows.js";

async function withTempProject(
	fn: (projectPath: string) => void | Promise<void>,
): Promise<void> {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-flows-project-"));
	try {
		await fn(projectPath);
	} finally {
		await rm(projectPath, { recursive: true, force: true });
	}
}

function validFlows(overrides: Record<string, unknown> = {}) {
	return {
		version: "1.0.0",
		projectType: "maintenance-dashboard",
		invariants: ["No registrar bugs sin evidencia clara."],
		qualityRules: ["Build/test deben preservarse."],
		forbiddenTransitions: ["invalid-json -> text-fallback-findings"],
		allowedTransitions: ["button -> function -> db", "db -> dashboard -> view"],
		validationChecklist: ["corepack pnpm build", "corepack pnpm test"],
		modules: [
			{
				id: "machines",
				name: "Máquinas",
				description: "Gestiona activos y equipos.",
				screens: ["machines-list"],
				dataStores: ["maintenance-db"],
				connectedModules: ["purchasing"],
			},
			{
				id: "purchasing",
				name: "Compras",
				description: "Gestiona compras de repuestos.",
				screens: ["purchase-dashboard"],
				dataStores: ["maintenance-db"],
				connectedModules: ["machines"],
			},
		],
		screens: [
			{
				id: "machines-list",
				path: "/machines",
				module: "machines",
				purpose: "Lista máquinas.",
				tabs: ["Activas", "Historial"],
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
				expectedAction: "Calls createMachine and writes to DB.",
			},
			{
				id: "machines-dashboard",
				type: "dashboard",
				selector: "#machines-dashboard",
				label: "Dashboard máquinas",
				expectedAction: "Reads machine data and updates view.",
			},
			{
				id: "purchases-table",
				type: "table",
				selector: "#purchases-table",
				label: "Tabla compras",
				expectedAction: "Shows purchase orders.",
			},
		],
		dataStores: [
			{
				id: "maintenance-db",
				type: "sqlite",
				tables: ["machines", "spare_parts", "purchases"],
				ownerModule: "machines",
			},
		],
		flows: [
			{
				id: "create-machine",
				name: "Botón crea dato",
				module: "machines",
				trigger: "create-machine-button click",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "create-machine-button",
						to: "createMachine",
						description: "User clicks create machine button.",
					},
					{
						order: 2,
						type: "function_call",
						from: "createMachine",
						to: "maintenance-db.machines",
						description: "Function writes machine data to DB.",
					},
				],
				expectedResult: "Machine appears in dashboard.",
				testTargets: ["createMachine", "machines-dashboard"],
			},
		],
		moduleConnections: [
			{
				fromModule: "machines",
				toModule: "purchasing",
				reason: "Máquinas solicitan repuestos a compras.",
				dataShared: ["sparePartId", "quantity"],
			},
		],
		...overrides,
	};
}

test("loadProjectFlows loads default flows", async () => {
	await withTempProject((projectPath) => {
		const flows = loadProjectFlows(projectPath);

		assert.equal(flows.projectType, "real-project-functional-map");
		assert.match(
			flows.invariants.join("\n"),
			/project-flows es el mapa funcional del proyecto real/u,
		);
		assert.ok(flows.modules.some((module) => module.id === "machines"));
	});
});

test("loadProjectFlows loads project-local config when present", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-flows.json"),
			JSON.stringify(validFlows({ projectType: "custom-product" })),
		);

		const flows = loadProjectFlows(projectPath);

		assert.equal(flows.projectType, "custom-product");
		assert.equal(flows.modules[0].id, "machines");
	});
});

test("loadProjectFlows fails clearly on invalid JSON", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-flows.json"),
			"{ invalid",
		);

		assert.throws(
			() => loadProjectFlows(projectPath),
			/Invalid project flows JSON/u,
		);
	});
});

test("validateProjectFlows validates modules", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);
	assert.equal(result.flows.modules[0].connectedModules[0], "purchasing");
});

test("validateProjectFlows validates screens", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);
	assert.equal(result.flows.screens[0].module, "machines");
});

test("validateProjectFlows validates uiElements", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);
	assert.equal(result.flows.uiElements[0].type, "button");
});

test("validateProjectFlows validates dataStores", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);
	assert.equal(result.flows.dataStores[0].ownerModule, "machines");
});

test("validateProjectFlows validates flows with steps", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);
	assert.equal(result.flows.flows[0].steps[0].from, "create-machine-button");
});

test("validateProjectFlows fails when flow has no trigger", () => {
	const flows = validFlows();
	delete (flows.flows as Array<{ trigger?: string }>)[0].trigger;

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /trigger/u);
});

test("validateProjectFlows fails when step has no from or to", () => {
	const flows = validFlows();
	delete (
		flows.flows as Array<{ steps: Array<{ from?: string; to?: string }> }>
	)[0].steps[0].from;

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /from/u);
});

test("validateProjectFlows fails when uiElement has no selector or label", () => {
	const flows = validFlows({
		uiElements: [
			{
				id: "create-machine-button",
				type: "button",
				expectedAction: "Calls createMachine and writes to DB.",
			},
		],
	});

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /selector or label/u);
});

test("validateProjectFlows fails when moduleConnection points to missing module", () => {
	const flows = validFlows({
		moduleConnections: [
			{
				fromModule: "machines",
				toModule: "missing-module",
				reason: "Invalid connection.",
				dataShared: ["partId"],
			},
		],
	});

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /missing-module/u);
});

test("validateProjectFlows fails when screen references missing module", () => {
	const flows = validFlows({
		screens: [
			{
				id: "bad-screen",
				path: "/bad",
				module: "missing-module",
				purpose: "Invalid screen.",
				uiElements: ["create-machine-button"],
			},
		],
	});

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /missing-module/u);
});

test("validateProjectFlows fails when dataStore has no ownerModule", () => {
	const flows = validFlows();
	delete (flows.dataStores as Array<{ ownerModule?: string }>)[0].ownerModule;

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /ownerModule/u);
});

test("formatFlowsForPrompt summarizes modules, screens and flows", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);

	const text = formatFlowsForPrompt(result.flows);

	assert.match(text, /Máquinas/u);
	assert.match(text, /\/machines/u);
	assert.match(text, /Botón crea dato/u);
	assert.ok(text.length < 1600);
});

test("loadProjectFlows does not write files", async () => {
	await withTempProject((projectPath) => {
		const localPath = join(projectPath, "config", "project-flows.json");

		loadProjectFlows(projectPath);

		assert.equal(existsSync(localPath), false);
	});
});
