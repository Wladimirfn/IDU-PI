import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	listIduMcpTools,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";

// RED test parametrizado para REQ-EI-4 (P5): `stateRoot` debe propagarse
// en el envelope compartido de CADA tool MCP.
//
// Hoy `IduMcpToolResult` no tiene el campo `stateRoot` y `envelope()`
// no lo expone en el output. Esto rompe la compilación TypeScript
// (propiedad inexistente). La mayoría de los 18 cluster handlers
// tampoco setean `stateRoot` real en el envelope, así que aunque
// sorteara el tipo, las assertions `=== SAMPLE_STATE_ROOT` fallarían
// en runtime con `undefined === SAMPLE_STATE_ROOT`.
//
// Esta task es SOLO RED. NO se modifica ningún handler ni el envelope.
// T1.2 (GREEN) es la que agrega el campo al tipo, lo expone en
// `envelope()`, y migra los 18 handlers.

const SAMPLE_STATE_ROOT = "C:\\idu-test\\state-root\\sample";

function resolution(stateRoot: string | undefined): IduMcpProjectResolution {
	// Tolerar `stateRoot === undefined` y `""`: NO joineamos con "repo" en esos
	// casos porque `join(undefined, "repo")` y `join("", "repo")` ambos fallan.
	// Usamos `fake-repo-root` como sentinela — `runtime()` lo detecta y
	// devuelve `workspaceRoot: ""` para que el fallback `?? runtime.workspaceRoot`
	// en los handlers colapse a falsy → envelope emite `stateRoot: null`.
	const basePath =
		stateRoot && stateRoot.length > 0 ? join(stateRoot, "repo") : "fake-repo-root";
	return {
		status: "registered_project",
		projectId: "mcp-envelope-state-root-project",
		projectPath: basePath,
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(projectPath: string): CliRuntime {
	// Derivar el `workspaceRoot` y `stateRoot` real del `projectPath` que pasa
	// `callIduMcpTool` (`options.runtimeFactory(resolution.projectPath)`).
	// Si `projectPath` es la sentinela `fake-repo-root` (casos 2 y 3 — resolver
	// sin stateRoot), devolvemos `workspaceRoot: ""` para que el fallback
	// `stateRoot ?? runtime.workspaceRoot` en los handlers colapse a falsy y
	// el envelope emita `stateRoot: null` (contrato REQ-EI-4 / P5).
	const isSentinel = projectPath === "fake-repo-root";
	const workspaceRoot = isSentinel ? "" : projectPath.replace(/[\\/]repo$/u, "");
	const stateRoot = isSentinel ? "" : workspaceRoot;
	const labDbPath = isSentinel ? "fake-lab.db" : join(stateRoot, "lab.db");
	// Stubs mínimos para los 3 grupos de guards legítimos de T1.1:
	//   1. master-plan guards (status / redraft / review / approve / reject)
	//   2. execution director guard
	//   3. proposal outbox guard (outbox + detail)
	//
	// El contrato del test es que `stateRoot` se propague al envelope. Los
	// handlers que dependen de estos stubs y luego llaman helpers más profundos
	// (buildSupervisorContextPack, buildContinuationProposal, buildTaskPackage)
	// pueden tirar — el catch general en `callIduMcpTool` propaga el
	// `resolution.stateRoot` correctamente. Eso es lo que el test verifica:
	// presencia del stateRoot en el envelope, NO corrección semántica.
	//
	// Para master-plan, los shapes retornados son los mínimos que
	// `handleMasterPlan*` espera (líneas 64-188 de src/mcp/master-plan/handlers.ts).
	const planApproved = {
		plan: {
			status: "approved",
			criticalRisks: [],
			driftFindings: [],
			canonicalClaims: [],
			operationalContracts: [],
			workMilestones: [],
			qualityRisks: [],
			securityRisks: [],
			architectureRisks: [],
			projectFlows: [],
			recommendedNext: [],
			flowArtifact: "master-plan.flows.json",
			inferredObjective: "Objetivo stub para test envelope.",
			executiveSummary: "Resumen stub.",
		},
		revisionAntesDeZarpar: {
			recommendedAgentLabs: [],
		},
	};
	return {
		projectId: "mcp-envelope-state-root-project",
		projectPath,
		workspaceRoot,
		labDbPath,
		// Grupo 1: master-plan guards (9 tools)
		masterPlanStatus: () => ({ status: "approved" }),
		masterPlanRedraft: (_reason: string | undefined) => ({
			plan: {
				...planApproved.plan,
				status: "draft",
			},
			jsonPath: isSentinel ? "fake.json" : join(stateRoot, "master-plan.json"),
			markdownPath: isSentinel ? "fake.md" : join(stateRoot, "master-plan.md"),
		}),
		masterPlanReview: (_selector: string | undefined) => planApproved,
		masterPlanApprove: (
			_selector: string | undefined,
			_reason: string | undefined,
			_source: string | undefined,
		) => ({
			plan: {
				...planApproved.plan,
				approval: { approvedBy: "stub", approvedAt: "1970-01-01T00:00:00Z" },
			},
			jsonPath: isSentinel ? "fake.json" : join(stateRoot, "master-plan.json"),
			markdownPath: isSentinel ? "fake.md" : join(stateRoot, "master-plan.md"),
		}),
		masterPlanReject: (
			_selector: string | undefined,
			_reason: string | undefined,
		) => ({
			plan: {
				...planApproved.plan,
				status: "rejected",
			},
			jsonPath: isSentinel ? "fake.json" : join(stateRoot, "master-plan.json"),
			markdownPath: isSentinel ? "fake.md" : join(stateRoot, "master-plan.md"),
		}),
		// Grupo 2: execution director guard (1 tool)
		executionDirectorTick: () => ({
			status: "ok",
			authority: "advisory",
			generatedAt: "1970-01-01T00:00:00Z",
			proposals: [],
			savedProposals: [],
			blockingReasons: [],
			evidenceRefs: [],
			safeNotes: ["stub"],
		}),
		// Grupo 3: proposal outbox guards (2 tools)
		proposalOutbox: () => [],
		proposalDetail: (_id: string) => null,
	} as unknown as CliRuntime;
}

// Las lifecycle tools (`idu_project_status`, `idu_project_enroll`,
// `idu_bootstrap_project`, `idu_start`) se enrutan vía
// `handleProjectLifecycleTool` y cargan el registry real
// (`loadConfig` + `loadRegistry`) — fuera del scope de los 18 cluster
// handlers que este PR migra. Excluirlas mantiene el test enfocado en
// la propagación de `stateRoot` por el envelope compartido sin depender
// de un registry vivo en disco.
const LIFECYCLE_TOOLS = new Set<string>([
	"idu_project_status",
	"idu_project_enroll",
	"idu_bootstrap_project",
	"idu_start",
]);

const TOOLS = listIduMcpTools().filter(
	(tool) => !LIFECYCLE_TOOLS.has(tool.name),
);

for (const tool of TOOLS) {
	test(`[${tool.name}] envelope propagates stateRoot when resolver provides it`, async () => {
		const stateRoot = mkdtempSync(join(tmpdir(), "mcp-state-root-"));
		try {
			const result = await callIduMcpTool(
				tool.name,
				{},
				{
					projectResolver: () => resolution(stateRoot),
					runtimeFactory: (projectPath) => runtime(projectPath ?? ""),
				},
			);

			assert.equal(result.stateRoot, stateRoot);
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	});

	test(`[${tool.name}] envelope stateRoot is null when stateRoot absent in resolver`, async () => {
		try {
			const result = await callIduMcpTool(
				tool.name,
				{},
				{
					projectResolver: () => resolution(undefined),
					runtimeFactory: (projectPath) => runtime(projectPath ?? ""),
				},
			);

			assert.equal(result.stateRoot, null);
		} finally {
			// No tmpdir to clean — this case doesn't create one.
		}
	});

	test(`[${tool.name}] envelope stateRoot is null when resolver provides empty string`, async () => {
		try {
			const result = await callIduMcpTool(
				tool.name,
				{},
				{
					projectResolver: () => resolution(""),
					runtimeFactory: (projectPath) => runtime(projectPath ?? ""),
				},
			);

			assert.equal(result.stateRoot, null);
		} finally {
			// No tmpdir to clean — this case doesn't create one.
		}
	});
}