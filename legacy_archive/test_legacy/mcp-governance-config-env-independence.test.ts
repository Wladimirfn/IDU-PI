// Issue #263 — refactor(mcp): inject governance config into runtime, Phase 0.
//
// ROOT CAUSE (confirmed): `governanceConfigData()` in src/mcp-server.ts calls
// `loadConfig({ requireTelegram: false })`, which requires DEFAULT_CWD
// (src/config.ts:135). It bypasses the injected runtimeFactory/projectResolver.
// When DEFAULT_CWD is absent (clean CI, or any injected-runtime test that does
// NOT re-seed env), the call throws, callIduMcpTool catches it, and returns an
// error envelope with ok=false and no data.contextBudget.
//
// This test proves the intended env-independent contract for the migrated
// builder path (buildSupervisorContextPack). It deliberately does NOT add a
// tmpdir fallback for DEFAULT_CWD — that would re-hide the hidden env dep.
//
// RED manifests as the SAME root cause on two environments:
//   - CI (no .env):             DEFAULT_CWD stays deleted -> governanceConfigData()
//                              -> loadConfig -> throws -> error envelope ok=false,
//                              no contextBudget.
//   - Local (with .env):        applyPackageEnvDefaults() (called by
//                              resolveMcpProjectContext at the top of
//                              callIduMcpTool) re-seeds the deleted keys from
//                              .env, so loadConfig does NOT throw; instead the
//                              injected governance marker is missing because
//                              governanceConfigData() ignores the injected
//                              runtime and returns the env-derived value.
//   Both reduce to one bug: governanceConfigData() bypasses the injected runtime.
//
// GREEN (after fix):   buildSupervisorContextPack reads runtime.governanceConfig
//                      -> ok=true, contextBudget present, injected marker carried.

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

// Distinctive marker value that loadConfig could never produce. Proves the
// governance config in the response came from the injected runtime, not env.
const INJECTED_MARKER = "phase0-injection-263";

// =====================================================================
// Env isolation — snapshot + delete the three keys loadConfig reads, and
// deliberately DO NOT add a tmpdir fallback. This is the core of the test:
// the migrated path must not need DEFAULT_CWD at all.
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

const fakeStateRoot = mkdtempSync(join(tmpdir(), "idu-gov-phase0-state-"));

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

/**
 * Fake runtime carrying an injected governance config with a distinctive
 * marker. Only the surface buildSupervisorContextPack touches is provided.
 */
function fakeRuntime(): CliRuntime {
	const runtime = {
		projectId: "sistema_de_mantencion",
		projectPath: fakeStateRoot,
		workspaceRoot: fakeStateRoot,
		// The injected governance config — the whole point of the refactor.
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
		masterPlanReview: () =>
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
				},
			}) as never,
		sourceRecommend: () =>
			({
				projectId: "sistema_de_mantencion",
				request: "",
				generatedAt: "2026-07-10T00:00:00.000Z",
				matches: [],
				missingKnowledge: [],
				limitations: [],
				contractPromotionAllowed: false,
			}) as never,
		sourceRequiredActions: () =>
			({
				projectId: "sistema_de_mantencion",
				generatedAt: "2026-07-10T00:00:00.000Z",
				actions: [],
				limitations: [],
				contractPromotionAllowed: false,
			}) as never,
	};
	return runtime as unknown as CliRuntime;
}

test("#263 idu_supervisor_context_pack is env-independent and carries injected governance config", async () => {
	const runtime = fakeRuntime();

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "x", includePlanSnapshot: false },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	// Intended successful contract.
	assert.equal(
		result.ok,
		true,
		`expected ok=true but got error envelope. summary=${JSON.stringify(result.summary)} errors=${JSON.stringify(result.errors)}`,
	);

	assert.ok(
		result.data.contextBudget !== undefined,
		`expected data.contextBudget to exist. dataKeys=${JSON.stringify(Object.keys(result.data ?? {}))}`,
	);

	const governanceConfig = result.data.governanceConfig as
		| { testMarker?: string }
		| undefined;
	assert.equal(
		governanceConfig?.testMarker,
		INJECTED_MARKER,
		`expected injected governance config marker. governanceConfig=${JSON.stringify(result.data.governanceConfig)}`,
	);
});
