import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatProjectMapScan,
	scanProjectMap,
	type ProjectMapScanResult,
} from "../src/project-map-scanner.js";
import type { ProjectFlows } from "../src/project-flows.js";

const tempDirs: string[] = [];

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-project-map-scan-"));
	tempDirs.push(dir);
	return dir;
}

function writeFixture(projectPath: string): void {
	writeFileSync(
		join(projectPath, "index.html"),
		`<!doctype html>
<html>
	<body>
		<section id="machines" class="dashboard">
			<button id="create-machine" data-action="createMachine" onclick="createMachine()">Create machine</button>
			<button id="create-machine" onclick="createMachineAgain()">Create machine</button>
			<form id="machine-form"></form>
			<table id="machine-table"></table>
			<canvas id="machine-chart"></canvas>
		</section>
		<script src="./app.js"></script>
	</body>
</html>`,
		"utf8",
	);
	writeFileSync(
		join(projectPath, "app.js"),
		`function createMachine() {
	return fetch('/api/machines');
}
const refreshDashboard = () => localStorage.getItem('machines');
window.openMachine = function () {
	sessionStorage.setItem('machine', '1');
};
const apiUrl = "/api/reports";
const dataFile = "machines.json";
const db = supabase.from('machines');
`,
		"utf8",
	);
}

function mappedFlows(): ProjectFlows {
	return {
		version: "1",
		projectType: "html-app",
		invariants: [],
		qualityRules: [],
		forbiddenTransitions: [],
		allowedTransitions: [],
		validationChecklist: [],
		modules: [
			{
				id: "machines",
				name: "Machines",
				description: "Machine dashboard",
				screens: ["machines"],
				dataStores: ["localStorage", "api", "supabase", "json"],
				connectedModules: [],
			},
		],
		screens: [
			{
				id: "machines",
				path: "index.html",
				module: "machines",
				purpose: "Machines screen",
				uiElements: [
					"create-machine",
					"machine-form",
					"machine-table",
					"machines",
				],
			},
			{
				id: "ghost",
				path: "ghost.html",
				module: "machines",
				purpose: "Missing screen",
				uiElements: [],
			},
		],
		uiElements: [
			{
				id: "create-machine",
				type: "button",
				selector: "#create-machine",
				label: "Create machine",
				expectedAction: "createMachine",
			},
			{
				id: "missing-selector",
				type: "button",
				selector: "#missing-selector",
				expectedAction: "Missing",
			},
		],
		dataStores: [
			{
				id: "api",
				type: "api",
				tables: [],
				ownerModule: "machines",
			},
		],
		flows: [
			{
				id: "create-machine-flow",
				name: "Create machine",
				module: "machines",
				trigger: "createMachine",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "#create-machine",
						to: "#missing-selector",
						description: "Click create",
					},
				],
				expectedResult: "Machine created",
				testTargets: [],
			},
		],
		moduleConnections: [],
	};
}

function warningText(result: ProjectMapScanResult): string {
	return result.findings
		.filter((finding) => finding.severity === "warning")
		.map((finding) => finding.message)
		.join("\n");
}

function infoText(result: ProjectMapScanResult): string {
	return result.findings
		.filter((finding) => finding.severity === "info")
		.map((finding) => finding.message)
		.join("\n");
}

test("scanProjectMap detects HTML files", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.deepEqual(result.detected.htmlFiles, ["index.html"]);
});

test("scanProjectMap detects button by id", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.ok(
		result.detected.uiElements.some(
			(element) => element.id === "create-machine" && element.type === "button",
		),
	);
});

test("scanProjectMap detects onclick", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.equal(result.detected.inlineOnclicks.length, 2);
});

test("scanProjectMap detects form", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.ok(
		result.detected.uiElements.some(
			(element) => element.id === "machine-form" && element.type === "form",
		),
	);
});

test("scanProjectMap detects fetch", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.deepEqual(
		result.detected.apiEndpoints.map((endpoint) => endpoint.value),
		["/api/machines", "/api/reports"],
	);
});

test("scanProjectMap detects localStorage", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.ok(
		result.detected.dataStores.some((store) => store.type === "localStorage"),
	);
	assert.ok(
		result.detected.dataStores.some((store) => store.type === "sessionStorage"),
	);
});

test("scanProjectMap warns for unmapped button", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = flows.uiElements.filter(
		(element) => element.id !== "create-machine",
	);

	const result = scanProjectMap(projectPath, flows);

	assert.match(
		warningText(result),
		/UI element detectado no mapeado.*create-machine/u,
	);
});

test("scanProjectMap warns for missing flow selector", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.match(
		warningText(result),
		/Flow referencia selector que no aparece.*#missing-selector/u,
	);
});

test("scanProjectMap warns for undeclared real screen", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	writeFileSync(
		join(projectPath, "reports.html"),
		'<button id="report">Report</button>',
		"utf8",
	);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.match(
		warningText(result),
		/Pantalla real no declarada.*reports\.html/u,
	);
});

test("scanProjectMap detects duplicate button", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.match(warningText(result), /Botón duplicado.*create-machine/u);
});

test("scanProjectMap reports unmapped functions as info", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.match(
		infoText(result),
		/Función detectada no usada en flows.*refreshDashboard/u,
	);
});

test("scanProjectMap warns for unmapped dataStore", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());

	assert.match(
		warningText(result),
		/dataStore detectado no mapeado.*localStorage/u,
	);
});

test("scanProjectMap does not write files", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const before = readFileSync(join(projectPath, "index.html"), "utf8");

	scanProjectMap(projectPath, mappedFlows());

	assert.equal(readFileSync(join(projectPath, "index.html"), "utf8"), before);
	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
	);
});

test("formatProjectMapScan includes grouped summary", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const result = scanProjectMap(projectPath, mappedFlows());
	const text = formatProjectMapScan(result);

	assert.match(text, /Resumen/u);
	assert.match(text, /pantallas detectadas: 1/u);
	assert.match(text, /botones\/UI detectados: 6/u);
	assert.match(text, /flows definidos: 1/u);
	assert.match(text, /warnings: \d+/u);
	assert.match(text, /infos: \d+/u);
	assert.match(text, /Solo lectura/u);
	assert.match(text, /no usé IA/u);
});

test("formatProjectMapScan limits top 10 findings", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const result = scanProjectMap(projectPath, mappedFlows());
	result.findings = Array.from({ length: 12 }, (_, index) => ({
		severity: "warning" as const,
		message: `warning ${index + 1}`,
	}));

	const text = formatProjectMapScan(result);

	assert.match(text, /Top 10 hallazgos/u);
	assert.match(text, /warning 10/u);
	assert.doesNotMatch(text, /warning 11/u);
	assert.match(text, /\+2 más/u);
});

test("formatProjectMapScan warns when default flows are used", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const text = formatProjectMapScan(scanProjectMap(projectPath, mappedFlows()));

	assert.match(text, /Estás usando default-flows/u);
	assert.match(text, /\/config init_project_config/u);
});

test("formatProjectMapScan reports healthy map when no warnings", () => {
	const projectPath = tempProject();
	writeFileSync(
		join(projectPath, "index.html"),
		'<button id="create-machine">Create machine</button>',
		"utf8",
	);
	const flows = mappedFlows();
	flows.screens = [flows.screens[0]];
	flows.uiElements = [flows.uiElements[0]];
	flows.dataStores = [];
	flows.flows = [
		{
			...flows.flows[0],
			steps: [
				{
					...flows.flows[0].steps[0],
					to: "#create-machine",
				},
			],
		},
	];

	const text = formatProjectMapScan(scanProjectMap(projectPath, flows));

	assert.match(text, /Mapa funcional consistente con el escaneo básico/u);
});

test("formatProjectMapScan keeps main warning categories", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const text = formatProjectMapScan(scanProjectMap(projectPath, mappedFlows()));

	assert.match(text, /Riesgos principales/u);
	assert.match(text, /pantallas no declaradas/u);
	assert.match(text, /botones no mapeados/u);
	assert.match(text, /selectors faltantes/u);
	assert.match(text, /dataStores no mapeados/u);
	assert.match(text, /funciones no usadas en flows/u);
	assert.match(text, /duplicados/u);
	assert.match(text, /onclick inline/u);
	assert.match(
		text,
		/Actualiza config\/project-flows\.json antes de pedir cambios grandes a la IA/u,
	);
	assert.match(text, /Los AgentLabs pueden revisar estos puntos/u);
});
