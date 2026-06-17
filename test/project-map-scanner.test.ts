import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	applyProjectFlowsDraft,
	formatProjectFlowDraftResult,
	formatProjectFlowDraftReview,
	formatProjectFlowSuggestions,
	formatProjectMapScan,
	scanProjectMap,
	reviewProjectFlowsDraft,
	saveProjectFlowsDraft,
	suggestProjectFlowsFromScan,
	type ProjectMapScanResult,
} from "../src/project-map-scanner.js";
import { loadProjectFlows, type ProjectFlows } from "../src/project-flows.js";

const tempDirs: string[] = [];

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-project-map-scan-"));
	tempDirs.push(dir);
	return dir;
}

function tempStateRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-project-map-scan-state-"));
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

test("suggestProjectFlowsFromScan suggests missing screen", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	writeFileSync(join(projectPath, "reports.html"), "<h1>Reports</h1>", "utf8");

	const suggestions = suggestProjectFlowsFromScan(projectPath, mappedFlows());

	assert.ok(
		suggestions.screens.some((screen) => screen.path === "reports.html"),
	);
});

test("suggestProjectFlowsFromScan suggests missing uiElement", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = flows.uiElements.filter(
		(element) => element.id !== "create-machine",
	);

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.ok(
		suggestions.uiElements.some((element) => element.id === "create-machine"),
	);
});

test("suggestProjectFlowsFromScan suggests missing dataStore", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.dataStores = [];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.ok(
		suggestions.dataStores.some((store) => store.type === "localStorage"),
	);
});

test("scanner does not suggest supabase from textual mention only", () => {
	const projectPath = tempProject();
	writeFileSync(
		join(projectPath, "notes.js"),
		`// TODO: maybe use supabase later\nconst text = "supabase integration planned";`,
		"utf8",
	);
	const flows = mappedFlows();
	flows.dataStores = [];

	const scan = scanProjectMap(projectPath, flows);
	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.equal(
		scan.detected.dataStores.some((store) => store.type === "supabase"),
		false,
	);
	assert.equal(
		suggestions.dataStores.some((store) => store.type === "supabase"),
		false,
	);
	assert.doesNotMatch(warningText(scan), /supabase|dataStore detectado/u);
});

test("scanner ignores storage mentions in docs and fixtures", () => {
	const projectPath = tempProject();
	mkdirSync(join(projectPath, "docs"));
	mkdirSync(join(projectPath, "fixtures"));
	writeFileSync(
		join(projectPath, "docs", "storage.js"),
		`const docs = "localStorage and sessionStorage are examples";`,
		"utf8",
	);
	writeFileSync(
		join(projectPath, "fixtures", "storage.js"),
		`const fixture = { storage: "localStorage sessionStorage" };`,
		"utf8",
	);
	const flows = mappedFlows();
	flows.dataStores = [];

	const scan = scanProjectMap(projectPath, flows);
	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.equal(scan.detected.dataStores.length, 0);
	assert.equal(suggestions.dataStores.length, 0);
	assert.doesNotMatch(warningText(scan), /localStorage|sessionStorage/u);
});

test("scanner ignores API examples and defaults as functional dataStores", () => {
	const projectPath = tempProject();
	mkdirSync(join(projectPath, "examples"));
	mkdirSync(join(projectPath, "config"));
	mkdirSync(join(projectPath, "defaults"));
	writeFileSync(
		join(projectPath, "examples", "default-api.js"),
		`const machines = "/api/machines";\nconst reports = fetch('/api/reports');`,
		"utf8",
	);
	writeFileSync(
		join(projectPath, "config", "default-flows.json"),
		JSON.stringify({ endpoints: ["/api/machines", "/api/reports"] }),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "defaults", "api.js"),
		`fetch('/api/machines');\nlocalStorage.setItem('demo', '1');`,
		"utf8",
	);
	writeFileSync(
		join(projectPath, "api.defaults.js"),
		`fetch('/api/reports');`,
		"utf8",
	);
	const flows = mappedFlows();
	flows.dataStores = [];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);
	const ids = suggestions.dataStores.map((store) => store.id);

	assert.equal(ids.includes("api-machines"), false);
	assert.equal(ids.includes("api-reports"), false);
	assert.equal(
		suggestions.dataStores.some((store) => store.type === "localStorage"),
		false,
	);
});

test("scanner keeps real runtime API and storage evidence", () => {
	const projectPath = tempProject();
	writeFileSync(
		join(projectPath, "app.js"),
		`fetch('/api/machines');\nlocalStorage.setItem('machines', '[]');`,
		"utf8",
	);
	const flows = mappedFlows();
	flows.dataStores = [];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.ok(
		suggestions.dataStores.some((store) => store.id === "api-machines"),
	);
	assert.ok(
		suggestions.dataStores.some((store) => store.type === "localStorage"),
	);
});

test("suggestProjectFlowsFromScan suggests simple flow from onclick", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.flows = [];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.ok(
		suggestions.flows.some(
			(flow) =>
				flow.trigger === "createMachine" &&
				flow.steps[0].from === "#create-machine",
		),
	);
});

test("suggestProjectFlowsFromScan does not suggest duplicates already mapped", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const suggestions = suggestProjectFlowsFromScan(projectPath, mappedFlows());

	assert.equal(
		suggestions.uiElements.some((element) => element.id === "create-machine"),
		false,
	);
});

test("suggestProjectFlowsFromScan does not suggest element when selector is mapped", () => {
	const projectPath = tempProject();
	writeFileSync(
		join(projectPath, "index.html"),
		'<button id="different-id">Create machine</button>',
		"utf8",
	);
	const flows = mappedFlows();
	flows.uiElements = [
		{
			id: "mapped-by-selector",
			type: "button",
			selector: "#different-id",
			expectedAction: "mapped",
		},
	];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.equal(
		suggestions.uiElements.some(
			(element) => element.selector === "#different-id",
		),
		false,
	);
});

test("suggestProjectFlowsFromScan deduplicates candidate uiElements and flows", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = flows.uiElements.filter(
		(element) => element.id !== "create-machine",
	);
	flows.flows = [];

	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);

	assert.equal(
		suggestions.uiElements.filter((element) => element.id === "create-machine")
			.length,
		1,
	);
	assert.equal(
		suggestions.flows.filter((flow) => flow.trigger === "createMachine").length,
		1,
	);
});

test("formatProjectFlowSuggestions limits output", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const suggestions = suggestProjectFlowsFromScan(projectPath, mappedFlows());
	suggestions.uiElements = Array.from({ length: 12 }, (_, index) => ({
		id: `button-${index + 1}`,
		type: "button" as const,
		selector: `#button-${index + 1}`,
		label: `Button ${index + 1}`,
		expectedAction: "Revisar acción detectada",
	}));

	const text = formatProjectFlowSuggestions(suggestions);

	assert.match(text, /Top 10/u);
	assert.match(text, /button-10/u);
	assert.doesNotMatch(text, /button-11/u);
	assert.match(text, /\+2 más/u);
});

test("suggestProjectFlowsFromScan does not write files", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);
	const before = readFileSync(join(projectPath, "index.html"), "utf8");

	suggestProjectFlowsFromScan(projectPath, mappedFlows());

	assert.equal(readFileSync(join(projectPath, "index.html"), "utf8"), before);
	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
	);
});

test("formatProjectFlowSuggestions includes human review warning", () => {
	const projectPath = tempProject();
	writeFixture(projectPath);

	const text = formatProjectFlowSuggestions(
		suggestProjectFlowsFromScan(projectPath, mappedFlows()),
	);

	assert.match(text, /Esto es un borrador sugerido/u);
	assert.match(
		text,
		/Revísalo antes de pegarlo en config\/project-flows\.json/u,
	);
	assert.match(text, /No escribí archivos/u);
	assert.match(text, /no usé IA/u);
});

test("saveProjectFlowsDraft creates draft in injected reports directory", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);

	const result = saveProjectFlowsDraft(projectPath, mappedFlows(), reportsPath);

	assert.match(result.path, /project-flows-draft-\d{8}-\d{6}\.json$/u);
	assert.equal(existsSync(result.path), true);
});

test("saveProjectFlowsDraft does not write config project-flows", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);

	saveProjectFlowsDraft(projectPath, mappedFlows(), reportsPath);

	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
	);
});

test("saveProjectFlowsDraft does not overwrite existing draft", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFixture(projectPath);
	const existingPath = join(
		reportsPath,
		"project-flows-draft-20260102-030405.json",
	);
	writeFileSync(existingPath, "existing", "utf8");

	const result = saveProjectFlowsDraft(
		projectPath,
		mappedFlows(),
		reportsPath,
		new Date("2026-01-02T03:04:05Z"),
	);

	assert.notEqual(result.path, existingPath);
	assert.equal(readFileSync(existingPath, "utf8"), "existing");
});

test("saveProjectFlowsDraft includes draft warning and suggestions", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = flows.uiElements.filter(
		(element) => element.id !== "create-machine",
	);
	flows.dataStores = [];
	flows.flows = [];

	const result = saveProjectFlowsDraft(projectPath, flows, reportsPath);
	const draft = JSON.parse(readFileSync(result.path, "utf8")) as {
		warning: string;
		suggestedScreens: unknown[];
		suggestedUiElements: unknown[];
		suggestedDataStores: unknown[];
		suggestedFlows: unknown[];
	};

	assert.equal(draft.warning, "Borrador sugerido, no es fuente de verdad");
	assert.ok(Array.isArray(draft.suggestedScreens));
	assert.ok(draft.suggestedUiElements.length > 0);
	assert.ok(draft.suggestedDataStores.length > 0);
	assert.ok(draft.suggestedFlows.length > 0);
});

test("formatProjectFlowDraftResult shows draft path and review warning", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);

	const text = formatProjectFlowDraftResult(
		saveProjectFlowsDraft(projectPath, mappedFlows(), reportsPath),
	);

	assert.match(text, /Borrador project-flows guardado/u);
	assert.match(text, /project-flows-draft-/u);
	assert.match(text, /revisalo antes de copiarlo/u);
	assert.match(text, /No modifiqué config\/project-flows\.json/u);
});

test("reviewProjectFlowsDraft reviews valid draft", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = [];
	const draft = saveProjectFlowsDraft(projectPath, flows, reportsPath);

	const review = reviewProjectFlowsDraft(
		draft.path,
		mappedFlows(),
		reportsPath,
	);

	assert.equal(review.valid, true);
	assert.equal(review.path, draft.path);
});

test("reviewProjectFlowsDraft latest takes newest draft", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const oldDraft = saveProjectFlowsDraft(
		projectPath,
		mappedFlows(),
		reportsPath,
		new Date("2026-01-02T03:04:05Z"),
	);
	const latestDraft = saveProjectFlowsDraft(
		projectPath,
		mappedFlows(),
		reportsPath,
		new Date("2026-01-02T03:04:06Z"),
	);

	const review = reviewProjectFlowsDraft("latest", mappedFlows(), reportsPath);

	assert.equal(review.path, latestDraft.path);
	assert.notEqual(review.path, oldDraft.path);
});

test("reviewProjectFlowsDraft detects invalid draft", () => {
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const invalidPath = join(reportsPath, "project-flows-draft-invalid.json");
	writeFileSync(invalidPath, JSON.stringify({ warning: "bad" }), "utf8");

	const review = reviewProjectFlowsDraft(
		invalidPath,
		mappedFlows(),
		reportsPath,
	);
	const text = formatProjectFlowDraftReview(review);

	assert.equal(review.valid, false);
	assert.match(text, /Draft inválido/u);
	assert.match(text, /generatedAt/u);
});

test("reviewProjectFlowsDraft requires projectPath", () => {
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const invalidPath = join(
		reportsPath,
		"project-flows-draft-no-project-path.json",
	);
	writeFileSync(
		invalidPath,
		JSON.stringify({
			generatedAt: "2026-01-02T03:04:05.000Z",
			warning: "Borrador sugerido, no es fuente de verdad",
			suggestedScreens: [],
			suggestedUiElements: [],
			suggestedDataStores: [],
			suggestedFlows: [],
		}),
		"utf8",
	);

	const review = reviewProjectFlowsDraft(
		invalidPath,
		mappedFlows(),
		reportsPath,
	);

	assert.equal(review.valid, false);
	assert.match(review.errors.join("\n"), /projectPath/u);
});

test("reviewProjectFlowsDraft latest returns invalid review when no draft exists", () => {
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });

	const review = reviewProjectFlowsDraft("latest", mappedFlows(), reportsPath);

	assert.equal(review.valid, false);
	assert.match(review.errors.join("\n"), /No encontré borradores/u);
});

test("reviewProjectFlowsDraft detects new screens", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	writeFileSync(join(projectPath, "reports.html"), "<h1>Reports</h1>", "utf8");
	const draft = saveProjectFlowsDraft(projectPath, mappedFlows(), reportsPath);

	const review = reviewProjectFlowsDraft(
		draft.path,
		mappedFlows(),
		reportsPath,
	);

	assert.ok(review.newScreens.some((screen) => screen.path === "reports.html"));
});

test("reviewProjectFlowsDraft detects new uiElements", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.uiElements = [];
	const draft = saveProjectFlowsDraft(projectPath, flows, reportsPath);

	const review = reviewProjectFlowsDraft(draft.path, flows, reportsPath);

	assert.ok(
		review.newUiElements.some((element) => element.id === "create-machine"),
	);
});

test("reviewProjectFlowsDraft detects new dataStores", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.dataStores = [];
	const draft = saveProjectFlowsDraft(projectPath, flows, reportsPath);

	const review = reviewProjectFlowsDraft(draft.path, flows, reportsPath);

	assert.ok(
		review.newDataStores.some((store) => store.type === "localStorage"),
	);
});

test("reviewProjectFlowsDraft detects new flows", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const flows = mappedFlows();
	flows.flows = [];
	const draft = saveProjectFlowsDraft(projectPath, flows, reportsPath);

	const review = reviewProjectFlowsDraft(draft.path, flows, reportsPath);

	assert.ok(review.newFlows.some((flow) => flow.trigger === "createMachine"));
});

test("reviewProjectFlowsDraft detects duplicates with current flows", () => {
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const draftPath = join(
		reportsPath,
		"project-flows-draft-20260102-030405.json",
	);
	writeFileSync(
		draftPath,
		JSON.stringify({
			generatedAt: "2026-01-02T03:04:05.000Z",
			projectPath: "demo",
			warning: "Borrador sugerido, no es fuente de verdad",
			suggestedScreens: [],
			suggestedUiElements: [
				{ id: "create-machine", type: "button", expectedAction: "x" },
			],
			suggestedDataStores: [],
			suggestedFlows: [],
		}),
		"utf8",
	);

	const review = reviewProjectFlowsDraft(draftPath, mappedFlows(), reportsPath);

	assert.match(review.duplicates.join("\n"), /uiElement.*create-machine/u);
});

test("reviewProjectFlowsDraft does not write files", () => {
	const projectPath = tempProject();
	const reportsPath = join(tempProject(), "reports");
	writeFixture(projectPath);
	const draft = saveProjectFlowsDraft(projectPath, mappedFlows(), reportsPath);
	const before = readFileSync(draft.path, "utf8");

	reviewProjectFlowsDraft(draft.path, mappedFlows(), reportsPath);

	assert.equal(readFileSync(draft.path, "utf8"), before);
	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
	);
});

function writeProjectFlows(projectPath: string, flows: ProjectFlows): string {
	const configPath = join(projectPath, "config");
	mkdirSync(configPath, { recursive: true });
	const flowsPath = join(configPath, "project-flows.json");
	const validFlows: ProjectFlows = {
		...flows,
		invariants: flows.invariants.length
			? flows.invariants
			: ["Preservar mapa funcional"],
		qualityRules: flows.qualityRules.length
			? flows.qualityRules
			: ["Revisar cambios humanos"],
		forbiddenTransitions: flows.forbiddenTransitions.length
			? flows.forbiddenTransitions
			: ["No borrar datos"],
		allowedTransitions: flows.allowedTransitions.length
			? flows.allowedTransitions
			: ["Agregar elementos revisados"],
		validationChecklist: flows.validationChecklist.length
			? flows.validationChecklist
			: ["Validar schema"],
		modules: flows.modules.map((module) => ({
			...module,
			connectedModules: module.connectedModules.length
				? module.connectedModules
				: [module.id],
		})),
		screens: flows.screens.map((screen) => ({
			...screen,
			uiElements: screen.uiElements.length
				? screen.uiElements
				: ["placeholder"],
		})),
		dataStores: flows.dataStores.map((store) => ({
			...store,
			tables: store.tables.length ? store.tables : ["placeholder"],
		})),
		flows: flows.flows.map((flow) => ({
			...flow,
			testTargets: flow.testTargets.length ? flow.testTargets : ["manual"],
		})),
		moduleConnections: flows.moduleConnections.length
			? flows.moduleConnections
			: [
					{
						fromModule: "machines",
						toModule: "machines",
						reason: "self",
						dataShared: ["placeholder"],
					},
				],
	};
	writeFileSync(flowsPath, `${JSON.stringify(validFlows, null, 2)}\n`, "utf8");
	return flowsPath;
}

function writeDraft(
	_projectPath: string,
	draft: Record<string, unknown>,
): string {
	const reportsPath = join(tempProject(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const draftPath = join(
		reportsPath,
		"project-flows-draft-20260102-030405.json",
	);
	writeFileSync(draftPath, JSON.stringify(draft, null, 2), "utf8");
	return draftPath;
}

test("applyProjectFlowsDraft rejects missing explicit path", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());

	const result = applyProjectFlowsDraft(projectPath, stateRoot, "");

	assert.equal(result.applied, false);
	assert.match(result.errors.join("\n"), /ruta explícita/u);
});

test("applyProjectFlowsDraft rejects latest", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());

	const result = applyProjectFlowsDraft(projectPath, stateRoot, "latest");

	assert.equal(result.applied, false);
	assert.match(result.errors.join("\n"), /latest/u);
});

test("applyProjectFlowsDraft rejects invalid draft", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());
	const draftPath = writeDraft(projectPath, { warning: "bad" });

	const result = applyProjectFlowsDraft(projectPath, stateRoot, draftPath);

	assert.equal(result.applied, false);
	assert.match(result.errors.join("\n"), /generatedAt/u);
});

test("applyProjectFlowsDraft rejects different projectPath", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());
	const draftPath = writeDraft(projectPath, {
		generatedAt: "2026-01-02T03:04:05.000Z",
		projectPath: "other-project",
		warning: "Borrador sugerido, no es fuente de verdad",
		suggestedScreens: [],
		suggestedUiElements: [],
		suggestedDataStores: [],
		suggestedFlows: [],
	});

	const result = applyProjectFlowsDraft(projectPath, stateRoot, draftPath);

	assert.equal(result.applied, false);
	assert.match(result.errors.join("\n"), /projectPath no coincide/u);
});

test("applyProjectFlowsDraft creates backup before writing", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());
	const draftPath = writeDraft(projectPath, {
		generatedAt: "2026-01-02T03:04:05.000Z",
		projectPath,
		warning: "Borrador sugerido, no es fuente de verdad",
		suggestedScreens: [
			{
				id: "reports",
				path: "reports.html",
				module: "machines",
				purpose: "Reports",
				uiElements: ["report-button"],
			},
		],
		suggestedUiElements: [],
		suggestedDataStores: [],
		suggestedFlows: [],
	});

	const result = applyProjectFlowsDraft(
		projectPath,
		stateRoot,
		draftPath,
		new Date("2026-01-02T03:04:05Z"),
	);

	assert.equal(result.applied, true);
	assert.match(
		result.backupPath ?? "",
		/project-flows\.backup-20260102-030405\.json$/u,
	);
	assert.equal(existsSync(result.backupPath ?? ""), true);
});

test("applyProjectFlowsDraft merges new screens and uiElements", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());
	const draftPath = writeDraft(projectPath, {
		generatedAt: "2026-01-02T03:04:05.000Z",
		projectPath,
		warning: "Borrador sugerido, no es fuente de verdad",
		suggestedScreens: [
			{
				id: "reports",
				path: "reports.html",
				module: "machines",
				purpose: "Reports",
				uiElements: ["report-button"],
			},
		],
		suggestedUiElements: [
			{
				id: "report-button",
				type: "button",
				selector: "#report-button",
				expectedAction: "review",
			},
		],
		suggestedDataStores: [],
		suggestedFlows: [],
	});

	applyProjectFlowsDraft(projectPath, stateRoot, draftPath);
	const flows = loadProjectFlows(projectPath);

	assert.ok(flows.screens.some((screen) => screen.id === "reports"));
	assert.ok(flows.uiElements.some((element) => element.id === "report-button"));
});

test("applyProjectFlowsDraft does not duplicate existing ids", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	writeProjectFlows(projectPath, mappedFlows());
	const draftPath = writeDraft(projectPath, {
		generatedAt: "2026-01-02T03:04:05.000Z",
		projectPath,
		warning: "Borrador sugerido, no es fuente de verdad",
		suggestedScreens: [
			{
				id: "machines",
				path: "other.html",
				module: "machines",
				purpose: "Duplicate",
				uiElements: ["duplicate"],
			},
		],
		suggestedUiElements: [
			{ id: "create-machine", type: "button", expectedAction: "duplicate" },
		],
		suggestedDataStores: [],
		suggestedFlows: [],
	});

	const result = applyProjectFlowsDraft(projectPath, stateRoot, draftPath);
	const flows = loadProjectFlows(projectPath);

	assert.equal(
		flows.screens.filter((screen) => screen.id === "machines").length,
		1,
	);
	assert.equal(
		flows.uiElements.filter((element) => element.id === "create-machine")
			.length,
		1,
	);
	assert.match(result.skipped.join("\n"), /machines/u);
	assert.match(result.conflicts.join("\n"), /create-machine/u);
});

test("applyProjectFlowsDraft does not delete existing content and validates final flows", () => {
	const projectPath = tempProject();
	const stateRoot = tempStateRoot();
	const original = mappedFlows();
	writeProjectFlows(projectPath, original);
	const draftPath = writeDraft(projectPath, {
		generatedAt: "2026-01-02T03:04:05.000Z",
		projectPath,
		warning: "Borrador sugerido, no es fuente de verdad",
		suggestedScreens: [],
		suggestedUiElements: [],
		suggestedDataStores: [
			{
				id: "reports-api",
				type: "api",
				tables: ["reports"],
				ownerModule: "machines",
			},
		],
		suggestedFlows: [
			{
				id: "report-flow",
				name: "Report",
				module: "machines",
				trigger: "report",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "#report-button",
						to: "report",
						description: "Report",
					},
				],
				expectedResult: "Report",
				testTargets: ["manual"],
			},
		],
	});

	const result = applyProjectFlowsDraft(projectPath, stateRoot, draftPath);
	const flows = loadProjectFlows(projectPath);

	assert.equal(result.applied, true);
	assert.ok(result.finalValidationOk);
	assert.ok(
		flows.screens.some((screen) => screen.id === original.screens[0].id),
	);
	assert.ok(flows.dataStores.some((store) => store.id === "reports-api"));
	assert.ok(flows.flows.some((flow) => flow.id === "report-flow"));
});
