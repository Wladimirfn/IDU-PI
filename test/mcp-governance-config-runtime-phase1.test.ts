// Issue #265 — refactor(mcp): migrate handler governanceConfigData to
// runtime.governanceConfig, Phase 1.
//
// Extends the Phase 0 (#263) env-independence test to cover representative
// handler paths across all 8 migrated clusters. Each assertion proves
// ok === true and that data.governanceConfig carries the injected marker —
// i.e. the config came from the injected runtime, not from env via
// governanceConfigData().
//
// RED (before migration): governanceConfigData() ignores the injected runtime
// and returns env-derived config. On CI (no .env) the call throws → ok=false;
// locally (.env re-seeds) the marker is simply missing. Both reduce to: the
// injected marker is absent from data.governanceConfig.
//
// GREEN (after migration): each handler reads runtime.governanceConfig → the
// injected marker is present and ok=true.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { IduSupervisorLoopResult } from "../src/idu-supervisor-loop.js";

const INJECTED_MARKER = "phase1-injection-265";

// =====================================================================
// Env isolation — snapshot + delete the three keys loadConfig reads, and
// deliberately DO NOT add a tmpdir fallback.
// =====================================================================

const POLLUTED_ENV_KEYS = [
	"ALLOWED_ROOTS",
	"DEFAULT_CWD",
	"AGENT_WORKSPACE_ROOT",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = {};
	for (const key of POLLUTED_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of POLLUTED_ENV_KEYS) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
});

// --- fixtures ---

const fakeStateRoot = mkdtempSync(join(tmpdir(), "idu-gov-phase1-state-"));

function registered(): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "sistema_de_mantencion",
		projectPath: fakeStateRoot,
		stateRoot: fakeStateRoot,
		safeNotes: [],
		errors: [],
	};
}

function fakePreflight(request: string): ProjectPreflightReport {
	return {
		risk: "low",
		okToProceed: true,
		request,
		projectId: "sistema_de_mantencion",
		projectPath: fakeStateRoot,
		connectionStatus: "ready",
		affectedAreas: ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: "Puede continuar con alcance acotado.",
		requiresHumanConfirmation: false,
		shouldRunAgentLab: false,
	};
}

const fakeLoop: IduSupervisorLoopResult = {
	status: "completed",
	trigger: "manual",
	projectId: "sistema_de_mantencion",
	steps: [{ name: "session_check", status: "completed", summary: "ok" }],
	createdTasks: 0,
	summary: "Supervisor tick completed.",
	recommendedNext: ["No action needed."],
	safety: {
		agentLabsExecuted: false,
		rulesApplied: false,
		memoryDeleted: false,
		projectCoreModified: false,
	},
};

/**
 * Rich fake runtime covering the surface all 8 migrated clusters touch.
 * Only the methods each handler reads are provided; everything else is
 * left undefined (optional fields or wrapped in try/catch by the handlers).
 */
function fakeRuntime(): CliRuntime {
	const runtime = {
		projectId: "sistema_de_mantencion",
		projectPath: fakeStateRoot,
		workspaceRoot: fakeStateRoot,
		governanceConfig: {
			mcpAuthorityMode: "advisory",
			agentLabMode: "audit_only",
			workspaceOwner: "orchestrator",
			autoRefreshLabProfiles: true,
			principle:
				"Idu-pi MCP informa, audita y recomienda; el orquestador decide, ejecuta y comunica.",
			testMarker: INJECTED_MARKER,
		},
		preflight: fakePreflight,
		masterPlanReview: (() =>
			({
				current: {},
				jsonPath: join(fakeStateRoot, "master-plan.json"),
				markdown: "# Plan Maestro approved",
				revisionAntesDeZarpar: { recommendedAgentLabs: [] },
				plan: {
					status: "approved",
					executiveSummary: "Resumen compacto.",
					inferredObjective: "Objetivo compacto.",
					criticalRisks: [],
					operationalContracts: [],
					projectFlows: [],
					workMilestones: [],
				},
			})) as never,
		sourceRecommend: (() =>
			({
				projectId: "sistema_de_mantencion",
				request: "",
				generatedAt: "2026-07-10T00:00:00.000Z",
				matches: [],
				missingKnowledge: [],
				limitations: [],
				contractPromotionAllowed: false,
			})) as never,
		sourceRequiredActions: (() =>
			({
				projectId: "sistema_de_mantencion",
				generatedAt: "2026-07-10T00:00:00.000Z",
				actions: [],
				limitations: [],
				contractPromotionAllowed: false,
			})) as never,
		supervisorTick: (() => fakeLoop) as never,
		supervisorCronPlan: (() =>
			({
				status: "planned",
				projectId: "sistema_de_mantencion",
				classification: "idle",
				proposedActions: [],
				advisoryOnly: true,
				writesAllowed: false,
				agentLabsAllowed: false,
				loop: fakeLoop,
			})) as never,
		createTask: (() => ({ id: "task-fake-0" })) as never,
		skillDraftFromLessons: (() =>
			({
				ok: true,
				mode: "proposal-only",
				proposals: [],
				limitations: [],
			})) as never,
	};
	return runtime as unknown as CliRuntime;
}

function opts() {
	return {
		runtimeFactory: () => fakeRuntime(),
		projectResolver: () => registered(),
	};
}

// =====================================================================
// Assertion helper — proves ok===true AND injected marker present.
// =====================================================================

function assertInjectedGovernance(result: {
	ok: boolean;
	data: Record<string, unknown>;
	summary?: unknown;
	errors?: unknown;
}): void {
	assert.equal(
		result.ok,
		true,
		`expected ok=true. summary=${JSON.stringify(result.summary)} errors=${JSON.stringify(result.errors)}`,
	);
	const gov = result.data.governanceConfig as
		| { testMarker?: string }
		| undefined;
	assert.equal(
		gov?.testMarker,
		INJECTED_MARKER,
		`expected injected governance config marker. governanceConfig=${JSON.stringify(result.data.governanceConfig)}`,
	);
}

// =====================================================================
// One representative handler per migrated cluster.
// =====================================================================

test("#265 preflight cluster: idu_preflight carries injected governance config", async () => {
	const result = await callIduMcpTool("idu_preflight", { request: "x" }, opts());
	assertInjectedGovernance(result);
});

test("#265 external cluster: idu_external_source_recommend carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_external_source_recommend",
		{ request: "x" },
		opts(),
	);
	assertInjectedGovernance(result);
});

test("#265 pruning cluster: idu_architectural_pruning_plan carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_architectural_pruning_plan",
		{},
		opts(),
	);
	assertInjectedGovernance(result);
});

test("#265 supervisor-tick cluster: idu_supervisor_tick carries injected governance config", async () => {
	const result = await callIduMcpTool("idu_supervisor_tick", {}, opts());
	assertInjectedGovernance(result);
});

test("#265 supervisor-context cluster: idu_supervisor_context_pack carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "x", includePlanSnapshot: false },
		opts(),
	);
	assertInjectedGovernance(result);
});

test("#265 supervisor-trigger cluster: idu_supervisor_self_maintenance_advisory carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_supervisor_self_maintenance_advisory",
		{},
		opts(),
	);
	assertInjectedGovernance(result);
});

test("#265 objective cluster: idu_automaticov1_cycle carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_automaticov1_cycle",
		{},
		opts(),
	);
	assertInjectedGovernance(result);
});

test("#265 bibliotecario cluster: idu_bibliotecario_proactive_advisory carries injected governance config", async () => {
	const result = await callIduMcpTool(
		"idu_bibliotecario_proactive_advisory",
		{ request: "x" },
		opts(),
	);
	assertInjectedGovernance(result);
});
