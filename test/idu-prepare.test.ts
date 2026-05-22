import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import type { ProjectFlows } from "../src/project-flows.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import { formatIduPrepareResult, runIduPrepare } from "../src/idu-prepare.js";

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
		projectPath: "/tmp/demo",
		problems: [],
		warnings: [],
		recommendedNext: "listo para operar",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-22T00:00:00.000Z",
		blueprint: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "/tmp/demo/config/project-blueprint.json",
			errors: [],
		},
		flows: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "/tmp/demo/config/project-flows.json",
			errors: [],
		},
		...overrides,
	};
}

function flows(): ProjectFlows {
	return {
		version: "1",
		projectType: "web",
		invariants: [],
		qualityRules: [],
		forbiddenTransitions: [],
		allowedTransitions: [],
		validationChecklist: [],
		modules: [
			{
				id: "main",
				name: "Main",
				description: "Main",
				screens: [],
				dataStores: [],
				connectedModules: [],
			},
		],
		screens: [],
		uiElements: [],
		dataStores: [],
		flows: [],
		moduleConnections: [],
	};
}

function postflight(
	risk: ProjectPostflightReport["risk"] = "low",
): ProjectPostflightReport {
	return {
		risk,
		changedFiles: [],
		impactedAreas: risk === "low" ? [] : ["DB/storage"],
		warnings: [],
		recommendedNext:
			risk === "low" ? "Sin cambios locales detectados." : "Revisar impacto.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: risk === "low" ? [] : ["db-storage"],
		requiresHumanConfirmation: risk !== "low",
	};
}

test("runIduPrepare executes initProjectConfig when project-local configs are missing", () => {
	const calls: string[] = [];
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () =>
			connection({
				status: "needs_understanding",
				configStatus: "missing",
				alignmentStatus: "unknown",
				readiness: "not_ready",
				alignmentReason: ["faltan blueprint/flows project-local"],
				blueprint: undefined,
				flows: undefined,
			}),
		initProjectConfig: () => {
			calls.push("init_project_config");
			return {
				projectPath: "/tmp/demo",
				created: ["config/project-blueprint.json"],
				existing: [],
				projectName: "demo",
			};
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.ok(calls.includes("init_project_config"));
	assert.equal(
		result.steps.find((step) => step.id === "init_project_config")?.status,
		"completed",
	);
	assert.equal(result.configStatus, "project_local_valid");
	assert.equal(result.readiness, "aligned_ready");
});

test("runIduPrepare does not write or scan without valid connection", () => {
	let initCalls = 0;
	let scanCalls = 0;
	let postflightCalls = 0;
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () =>
			connection({
				status: "not_connected",
				projectId: undefined,
				projectPath: undefined,
				blueprint: undefined,
				flows: undefined,
			}),
		initProjectConfig: () => {
			initCalls += 1;
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => {
			scanCalls += 1;
			return { findings: [] };
		},
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => {
			postflightCalls += 1;
			return postflight("low");
		},
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(initCalls, 0);
	assert.equal(scanCalls, 0);
	assert.equal(postflightCalls, 0);
	assert.equal(
		result.steps.find((step) => step.id === "init_project_config")?.status,
		"skipped",
	);
	assert.equal(
		result.steps.find((step) => step.id === "scan_project_map")?.status,
		"skipped",
	);
	assert.equal(
		result.steps.find((step) => step.id === "postflight")?.status,
		"skipped",
	);
});

test("runIduPrepare does not initialize when project-local configs already exist", () => {
	let initCalls = 0;
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			initCalls += 1;
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(initCalls, 0);
	assert.equal(
		result.steps.find((step) => step.id === "init_project_config")?.status,
		"skipped",
	);
});

test("runIduPrepare executes scan suggest draft and review in order", () => {
	const calls: string[] = [];
	runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => {
			calls.push("inspect_project_map");
			return { issues: [] };
		},
		loadProjectFlows: () => flows(),
		scanProjectMap: () => {
			calls.push("scan_project_map");
			return { findings: [] };
		},
		suggestProjectFlows: () => {
			calls.push("suggest_project_flows");
			return { screens: [], uiElements: [], dataStores: [], flows: [] };
		},
		draftProjectFlows: () => {
			calls.push("draft_project_flows");
			return {
				path: "/tmp/reports/draft.json",
				suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
			};
		},
		reviewProjectFlowsDraft: () => {
			calls.push("review_project_flows_draft");
			return { valid: true, errors: [] };
		},
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.deepEqual(calls, [
		"inspect_project_map",
		"scan_project_map",
		"suggest_project_flows",
		"draft_project_flows",
		"review_project_flows_draft",
	]);
});

test("runIduPrepare reports scan failure and continues with safe postflight", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => {
			throw new Error("scan exploded");
		},
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("high"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(
		result.steps.find((step) => step.id === "scan_project_map")?.status,
		"failed",
	);
	assert.equal(
		result.steps.find((step) => step.id === "postflight")?.status,
		"completed",
	);
	assert.equal(
		result.steps.find((step) => step.id === "lab_review_plan")?.status,
		"completed",
	);
	assert.equal(result.labReviewTaskId, "task-1");
});

test("runIduPrepare with suggested dataStores reports needs_review", () => {
	const suggestedStores = Array.from({ length: 39 }, (_, index) => ({
		id: `store-${index}`,
		name: `Store ${index}`,
		type: "json" as const,
		path: `data/store-${index}.json`,
		description: "Suggested store",
	}));
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: suggestedStores,
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: {
				screens: [],
				uiElements: [],
				dataStores: suggestedStores,
				flows: [],
			},
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(result.configStatus, "project_local_valid");
	assert.equal(result.alignmentStatus, "needs_review");
	assert.equal(result.readiness, "config_ready");
	assert.deepEqual(result.differencesDetected, {
		screens: 0,
		uiElements: 0,
		dataStores: 39,
		flows: 0,
	});
	assert.equal(result.recommendedNext, "Revisar draft antes de aplicar.");
	assert.deepEqual(result.suggestedActions, [
		"/config review_project_flows_draft latest",
		"continuar bajo riesgo",
	]);
});

test("runIduPrepare without suggestions and low postflight reports aligned_ready", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(result.alignmentStatus, "aligned");
	assert.equal(result.readiness, "aligned_ready");
	assert.deepEqual(result.differencesDetected, {
		screens: 0,
		uiElements: 0,
		dataStores: 0,
		flows: 0,
	});
});

test("runIduPrepare reports stale when local changes exist after prepare", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => ({
			...postflight("low"),
			changedFiles: ["src/index.ts"],
		}),
		createStructuredTask: () => ({ id: "task-1" }),
	});

	assert.equal(result.alignmentStatus, "stale");
	assert.equal(result.readiness, "config_ready");
});

test("formatIduPrepareResult includes alignment statuses and differences", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});
	const text = formatIduPrepareResult(result);

	assert.doesNotMatch(text, /Estado inicial:\nready/u);
	assert.match(text, /Estado inicial de conexión:\nready/u);
	assert.match(text, /Estado inicial de configuración:\nproject-local válido/u);
	assert.match(text, /Estado inicial de alineación:\naligned/u);
	assert.match(text, /readiness final:\naligned_ready/u);
	assert.match(text, /dataStores sugeridos: 0/u);
});

test("formatIduPrepareResult includes project risk actions and no AgentLab execution claim", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection(),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({
			path: "/tmp/reports/draft.json",
			suggestions: { screens: [], uiElements: [], dataStores: [], flows: [] },
		}),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("high"),
		createStructuredTask: () => ({ id: "task-1" }),
	});
	const text = formatIduPrepareResult(result);

	assert.match(text, /Idu-pi Prepare/u);
	assert.match(text, /Proyecto:\ndemo/u);
	assert.match(text, /postflight: riesgo high/u);
	assert.match(text, /lab_review_plan: preparado/u);
	assert.match(text, /No ejecuté AgentLabs/u);
});

test("formatIduPrepareResult does not show ambiguous ready initial status", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection({ status: "ready" }),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({ path: "/tmp/reports/draft.json" }),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});
	const text = formatIduPrepareResult(result);

	assert.doesNotMatch(text, /^Estado inicial:\nready$/mu);
});

test("formatIduPrepareResult separates initial connection and alignment status", () => {
	const result = runIduPrepare({
		projectId: "demo",
		projectPath: "/tmp/demo",
		reportsPath: mkdtempSync(join(tmpdir(), "idu-prepare-")),
		inspectConnection: () => connection({ status: "ready" }),
		initProjectConfig: () => {
			throw new Error("should not init");
		},
		inspectProjectMap: () => ({ issues: [] }),
		loadProjectFlows: () => flows(),
		scanProjectMap: () => ({ findings: [] }),
		suggestProjectFlows: () => ({
			screens: [{ name: "Login" }],
			uiElements: [],
			dataStores: [],
			flows: [],
		}),
		draftProjectFlows: () => ({ path: "/tmp/reports/draft.json" }),
		reviewProjectFlowsDraft: () => ({ valid: true, errors: [] }),
		postflight: () => postflight("low"),
		createStructuredTask: () => ({ id: "task-1" }),
	});
	const text = formatIduPrepareResult(result);

	assert.match(text, /Estado inicial de conexión:\nready/u);
	assert.match(text, /Estado inicial de configuración:\nproject-local válido/u);
	assert.match(text, /Estado inicial de alineación:\nneeds_review/u);
});
