// Tests para REQ-EI-1 (P1): campo `fuente` en excerpts truncados.
//
// Contrato (T1.6 / design.md §3.2):
//   - `resolveExcerptSource(item)` busca `item.source` → `item.path` →
//     `item.filePath`, en ese orden.
//   - Si ninguno presente → retorna `undefined`.
//   - Si alguno presente → retorna el string tal cual (sin transformar).
//   - Idempotente: misma entrada → mismo string.
//
// `budgetJsonArray` (en `src/mcp-server.ts:2931`) llama
// `resolveExcerptSource(item)` cuando `sliceTextToBudget` reporta
// `truncated=true` para un item individual (no para el overflow de
// `maxArrayItems` — ese es otro branch que no setea `fuente`). El
// helper agrega `...(fuente ? { fuente } : {})` al objeto excerpt.
//
// Tests de integración: se ejercita el path real vía `idu_plan_snapshot`
// porque esa tool pasa `operationalContracts` por `budgetJsonArray`
// con `maxArrayItemChars=500` (perfil `plan_snapshot`). NO se exporta
// `budgetJsonArray` (regla del design — la función queda interna) y se
// testea solo end-to-end.

// =====================================================================
// Hermetic env setup (ANTES de los imports de src/) — necesario porque
// `src/mcp-server.ts` llama `loadConfig()` (vía defaultRuntimeFactory /
// resolveMcpProjectContext) y eso requiere DEFAULT_CWD / ALLOWED_ROOTS
// / AGENT_WORKSPACE_ROOT. Sin este setup, los callIduMcpTool fallan
// con "Missing required env var: DEFAULT_CWD".
//
// Patrón copiado de `test/mcp-server.test.ts` L26-40.
// =====================================================================
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hermeticMcpRoot = mkdtempSync(join(tmpdir(), "idu-mcp-excerpt-fuente-"));
const hermeticProjectPath = join(hermeticMcpRoot, "project");
const hermeticWorkspaceRoot = join(hermeticMcpRoot, "workspace");
mkdirSync(hermeticProjectPath, { recursive: true });
mkdirSync(hermeticWorkspaceRoot, { recursive: true });
process.env.DEFAULT_CWD = hermeticProjectPath;
process.env.ALLOWED_ROOTS = hermeticMcpRoot;
process.env.AGENT_WORKSPACE_ROOT = hermeticWorkspaceRoot;
process.env.IDU_PI_REGISTRY_PATH = join(
	hermeticMcpRoot,
	"registry",
	"projects.json",
);
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.ALLOWED_USER_ID;

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	callIduMcpTool,
	resolveExcerptSource,
	type IduMcpProjectResolution,
	type IduMcpRuntimeFactory,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";

test("[resolveExcerptSource] item con `source` retorna ese path", () => {
	const item = { source: "Doc/foo.md", content: "..." };
	assert.equal(resolveExcerptSource(item), "Doc/foo.md");
});

test("[resolveExcerptSource] item con `path` (sin `source`) retorna ese path", () => {
	const item = { path: "Doc/bar.md", content: "..." };
	assert.equal(resolveExcerptSource(item), "Doc/bar.md");
});

test("[resolveExcerptSource] item con `filePath` (sin `source` ni `path`) retorna ese path", () => {
	const item = { filePath: "Doc/baz.md", content: "..." };
	assert.equal(resolveExcerptSource(item), "Doc/baz.md");
});

test("[resolveExcerptSource] item sin ninguno de los tres retorna undefined", () => {
	const item = { content: "...", otherField: "x" };
	assert.equal(resolveExcerptSource(item), undefined);
});

test("[resolveExcerptSource] es idempotente: misma entrada produce mismo string", () => {
	const item = { source: "Doc/foo.md", content: "..." };
	const first = resolveExcerptSource(item);
	const second = resolveExcerptSource(item);
	assert.equal(first, "Doc/foo.md");
	assert.equal(second, "Doc/foo.md");
	assert.equal(first, second);
});

// =====================================================================
// Edge cases opcionales (Warning A del reviewer)
//   - empty string como source retorna string vacío (el caller decide
//     si filtrar downstream via `...(fuente ? { fuente } : {})`)
//   - non-string value en source/path se ignora y se cae al siguiente
//     campo
//   - null/primitive input retorna undefined
// =====================================================================

test("[resolveExcerptSource] empty string como source retorna string vacío (filtrado downstream)", () => {
	assert.equal(resolveExcerptSource({ source: "" }), "");
});

test("[resolveExcerptSource] non-string value en source lo ignora y cae al siguiente campo", () => {
	// `source` no es string → ignora, busca `path` (no presente), busca
	// `filePath` (no presente) → undefined.
	assert.equal(resolveExcerptSource({ source: 123 }), undefined);
	// Misma idea con `path` no-string.
	assert.equal(resolveExcerptSource({ path: null }), undefined);
	// `source` no-string pero `path` SÍ string → retorna `path`.
	assert.equal(
		resolveExcerptSource({ source: false, path: "Doc/x.md" }),
		"Doc/x.md",
	);
});

test("[resolveExcerptSource] null/primitive input retorna undefined", () => {
	assert.equal(resolveExcerptSource(null), undefined);
	assert.equal(resolveExcerptSource("string"), undefined);
	assert.equal(resolveExcerptSource(42), undefined);
	assert.equal(resolveExcerptSource(undefined), undefined);
});

// =====================================================================
// P1 — Test de integración: `budgetJsonArray` incluye `fuente` en
// excerpts truncados vía `idu_plan_snapshot`.
//
// POR QUÉ `idu_plan_snapshot`:
//   `buildPlanSnapshot` (src/mcp-server.ts:2783) llama
//   `budgetJsonArray(arrayField(plan, "operationalContracts"),
//   "plan_snapshot", "operationalContracts")`. El perfil
//   `plan_snapshot` tiene `maxArrayItemChars=500` (src/context-budget.ts:97).
//   Si un item se serializa a >500 chars, `sliceTextToBudget` reporta
//   `truncated=true` y `budgetJsonArray` adjunta `fuente` al excerpt.
//
// POR QUÉ este test ejercita `budgetJsonArray` real (no un mock):
//   El design prohíbe exportar `budgetJsonArray`. El test pasa por la
//   superficie pública (`callIduMcpTool`) y verifica el shape del
//   output — es la única forma honesta de pinear el contrato sin
//   exponer la función.
//
// Setup mínimo:
//   - `runtime.masterPlanReview()` stub que devuelve un plan con
//     3 `operationalContracts`, cada uno con un campo `source`/`path`/
//     `filePath` distinto y un array `rules` con strings de >500 chars
//     que fuerzan truncamiento per-item.
//   - `runtime.projectId` / `projectPath` fijos.
//   - `resolution.stateRoot` válido (tmpdir real).
// =====================================================================

const fakeStateRoot = mkdtempSync(join(tmpdir(), "mcp-excerpt-fuente-"));

function registered(): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		stateRoot: fakeStateRoot,
		safeNotes: [],
		errors: [],
	};
}

function runtimeWithLongContracts(): CliRuntime {
	const longRule = (label: string): string =>
		`${label} ${"x".repeat(900)}`;
	return {
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		workspaceRoot: "C:/idu/workspace",
		masterPlanReview: () =>
			({
				current: {},
				jsonPath:
					"C:/idu/workspace/projects/sistema_de_mantencion/master-plan.json",
				markdown: "# Plan Maestro approved",
				revisionAntesDeZarpar: { recommendedAgentLabs: [] },
				plan: {
					status: "approved",
					executiveSummary: "Resumen compacto.",
					inferredObjective: "Objetivo compacto.",
					criticalRisks: [],
					operationalContracts: [
						{
							area: "agent",
							title: "Contrato con source",
							source: "Doc/foo.md",
							rules: [longRule("regla-1")],
						},
						{
							area: "agent",
							title: "Contrato con path",
							path: "Doc/bar.md",
							rules: [longRule("regla-2")],
						},
						{
							area: "agent",
							title: "Contrato con filePath",
							filePath: "Doc/baz.md",
							rules: [longRule("regla-3")],
						},
					],
					projectFlows: [],
				},
			}) as never,
	} as unknown as CliRuntime;
}

test("P1 integración: budgetJsonArray incluye `fuente` en excerpt truncado via idu_plan_snapshot", async () => {
	const runtime = runtimeWithLongContracts();
	const factory: IduMcpRuntimeFactory = () => runtime;

	const result = await callIduMcpTool(
		"idu_plan_snapshot",
		{},
		{ runtimeFactory: factory, projectResolver: () => registered() },
	);

	// Sanity check: la respuesta es un plan_snapshot exitoso.
	const data = result.data as {
		operationalContracts: Array<Record<string, unknown>>;
	};
	assert.ok(Array.isArray(data.operationalContracts));

	// Cada item DEBE haber sido truncado por `maxArrayItemChars=500`.
	const truncated = data.operationalContracts.filter(
		(item) => item.contextBudgetTruncated === true,
	);
	assert.equal(
		truncated.length,
		3,
		`los 3 contracts deberían estar truncados. contracts actuales: ${JSON.stringify(data.operationalContracts)}`,
	);

	// Cada excerpt truncado DEBE tener `fuente` con el path correcto
	// (en orden de prioridad source → path → filePath).
	const fuentes = truncated.map((item) => item.fuente);
	assert.ok(
		fuentes.includes("Doc/foo.md"),
		`algún item truncado debe tener fuente="Doc/foo.md". fuentes: ${JSON.stringify(fuentes)}`,
	);
	assert.ok(
		fuentes.includes("Doc/bar.md"),
		`algún item truncado debe tener fuente="Doc/bar.md". fuentes: ${JSON.stringify(fuentes)}`,
	);
	assert.ok(
		fuentes.includes("Doc/baz.md"),
		`algún item truncado debe tener fuente="Doc/baz.md". fuentes: ${JSON.stringify(fuentes)}`,
	);

	// Cada `fuente` es string (no number, no boolean).
	for (const item of truncated) {
		assert.equal(
			typeof item.fuente,
			"string",
			`item.fuente debe ser string. item: ${JSON.stringify(item)}`,
		);
	}
});