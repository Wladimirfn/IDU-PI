// T1.10 — RED integración aviso en `safeNotes`.
//
// Contrato esperado (verificado en spec REQ-EI-3 P4, design §3.4 P4 y
// tasks.md L432-445):
//
//   1. Al invocar `idu_supervisor_context_pack` con un context pack que
//      SE TRUNCA, la respuesta `safeNotes` debe contener una entrada
//      que matchea `/^\d+ contratos truncados por context budget,
//      fuente en .+/` (formato fijo del helper `buildTruncationNotice`
//      que T1.11 va a crear).
//   2. Esa entrada debe ser la PRIMERA del array `safeNotes` (aparece
//      antes que cualquier otra — pisa el orden actual de "Context pack
//      advisory: ..." y "Inyecta metas y gates; ...").
//   3. Con `contextBudget.truncated === false`, `safeNotes` NO contiene
//      ninguna entrada que matchee ese regex (verifica que el helper se
//      llama SOLO cuando hay truncamiento, no siempre).
//   4. El regex matchea exactamente el formato del spec para varios
//      casos (1 contrato, 3 mixed, 10 con path), independientemente del
//      handler — es unit-level sobre el regex.
//
// POR QUÉ `callIduMcpTool` y NO `handleSupervisorContextPack` directo:
//
//   El handler en `src/mcp/supervisor-context/handlers.ts:52` tiene
//   como firma `(name, args, runtime, resolution)`. Para invocarlo
//   directo hay que construir un `runtime` con métodos de muchos
//   dominios y un `resolution` con `safeNotes`, `stateRoot`, etc.
//   Es ortogonal a lo que el test assertea.
//
//   `callIduMcpTool("idu_supervisor_context_pack", args, options)` es
//   el entry point público del servidor MCP y es el patrón canónico
//   usado en `test/mcp-server.test.ts` L2676-2680 para casos idénticos
//   (forzar truncation con un plan stubbed).
//
// CÓMO SE FUERZA TRUNCAMIENTO:
//
//   `buildSupervisorContextPack` agrega los warnings del preflight al
//   array `risks` y los pasa por `budgetStringArray` con el profile
//   `supervisor_context_pack`, que tiene `maxArrayItems=10`
//   (ver `src/context-budget.ts:119`). Si pasamos más de 10 warnings,
//   `sliceListToBudget` setea `truncated: true` con un entry en
//   `omitted[]` con `reason: "max_items"`. Eso fuerza
//   `contextBudget.truncated === true` en el output del handler.
//
//   Verificado experimentalmente: con 25 warnings, el output tiene
//   `contextBudget.truncated === true` y
//   `omitted[0] = {path: "risks", reason: "max_items", omittedItems: 15}`.
//
//   (Nota: pasar un plan con muchos contratos/flows grandes NO
//   alcanza para forzar truncamiento en el context pack, porque
//   `compactPlanSnapshotForContextPack` solo incluye los campos
//   `authority`, `planStatus`, `objective`, `summary`, etc. — los
//   arrays grandes no entran al `contextBudget.usedChars`. Por eso
//   el path elegido es el de los warnings del preflight.)

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { callIduMcpTool, type IduMcpProjectResolution } from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { ContextBudgetUsage } from "../src/context-budget.js";

// =====================================================================
// Env isolation (fix test-only para T1.10 en CI)
//
// CAUSA RAÍZ (reproducida, ver issue #252):
//
//   Varios tests del repo (p.ej. `mcp-server.test.ts` L31-33,
//   `mcp-excerpt-fuente.test.ts` L40-42) setean
//   `ALLOWED_ROOTS` / `DEFAULT_CWD` / `AGENT_WORKSPACE_ROOT` al cargar
//   el módulo y NUNCA los limpian. En CI el orden de tests los ejecuta
//   antes que T1.10, y esos env vars restrictivos contaminan el
//   runtime de `callIduMcpTool`.
//
//   El fake `projectPath = "C:/projects/sistema"` de T1.10 queda
//   fuera de `ALLOWED_ROOTS` → `buildSupervisorContextPack` lanza
//   "Ruta fuera de ALLOWED_ROOTS" → `callIduMcpTool` catchea el throw
//   y devuelve `data: {}` → `result.data.contextBudget` es
//   `undefined` → `budget.truncated` explota con
//   "Cannot read properties of undefined (reading 'truncated')".
//
//   Local pasa porque el orden es distinto y T1.10 corre con env
//   limpio. Es la misma clase de issue que #209/#211 (order-dependent
//   test failures por environment pollution).
//
// FIX:
//
//   Snapshot+restore de las 3 env vars polluted keys en beforeEach /
//   afterEach. Solo se aplica a este archivo, no es cleanup amplio
//   de los otros 10+ tests que setean env sin limpiar (eso es issue
//   separado, explícitamente out of scope).
//
//   `beforeEach`/`afterEach` a nivel de SUITE (no de módulo) porque
//   la contaminación ocurre en RUNTIME cuando `callIduMcpTool` lee
//   `process.env` al resolver el project context. Borrar a nivel
//   módulo (top-level) no serviría: la contaminación puede llegar
//   DESPUÉS de que este módulo ya cargó.
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

// --- fixtures locales (mínimo viable para `buildSupervisorContextPack`) ---

const fakeStateRoot = mkdtempSync(join(tmpdir(), "idu-t110-red-state-"));

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

function fakePreflight(request: string): ProjectPreflightReport {
	return {
		risk: "low",
		okToProceed: true,
		request,
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
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
 * fakeRuntime mínimo para `idu_supervisor_context_pack`.
 *
 * Solo necesita los métodos que `buildSupervisorContextPack` (en
 * `src/mcp-server.ts:2339`) y sus helpers llaman:
 *   - `masterPlanReview(selector)`         — para el plan snapshot
 *   - `preflight(request)`                 — para alignmentAdvisory
 *   - `sourceRecommend(request)`           — para sourceEvidence
 *   - `sourceRequiredActions()`            — para sourceEvidence
 *   - `workspaceRoot` / `projectPath`      — para readTaxonomyGuide
 *                                           y buildActiveSkillsIndex
 *
 * El handler del cluster (handlers.ts:52) usa `runtime.masterPlanReview`
 * en el guard inicial (L58) y nada más — el resto del handler pasa el
 * `runtime` directamente a `buildSupervisorContextPack`.
 */
function fakeRuntime(): CliRuntime {
	const runtime = {
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		workspaceRoot: "C:/idu/workspace",
		preflight: fakePreflight,
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
					operationalContracts: [],
					projectFlows: [],
				},
			}) as never,
		sourceRecommend: () =>
			({
				projectId: "sistema_de_mantencion",
				request: "",
				generatedAt: "2026-07-05T00:00:00.000Z",
				matches: [],
				missingKnowledge: [],
				limitations: [],
				contractPromotionAllowed: false,
			}) as never,
		sourceRequiredActions: () =>
			({
				projectId: "sistema_de_mantencion",
				generatedAt: "2026-07-05T00:00:00.000Z",
				actions: [],
				limitations: [],
				contractPromotionAllowed: false,
			}) as never,
	};
	return runtime as unknown as CliRuntime;
}

/**
 * Helper: arma un `runtime` con un `preflight` que devuelve muchos
 * warnings. Esto fuerza `safeRisks` (profile `supervisor_context_pack`,
 * maxItems=10) a truncar con `max_items` y así dispara
 * `contextBudget.truncated === true` desde el lado de la integración.
 *
 * Patrón verificado: el context pack agrega los warnings de
 * preflight al array `risks` y luego llama `budgetStringArray` con
 * maxItems=10 del budget `supervisor_context_pack`. Si pasamos más de
 * 10 warnings, dispara truncamiento.
 */
function runtimeWithManyWarnings(): CliRuntime {
	const runtime = fakeRuntime();
	runtime.preflight = (request: string): ProjectPreflightReport => ({
		risk: "low",
		okToProceed: true,
		request,
		projectId: "sistema_de_mantencion",
		projectPath: "C:/projects/sistema",
		connectionStatus: "ready",
		affectedAreas: ["tarea simple"],
		missingContext: [],
		warnings: Array.from(
			{ length: 25 },
			(_, index) =>
				`Warning ${index} con descripción ${"z".repeat(80)} para forzar max_items`,
		),
		recommendedNext: "Puede continuar con alcance acotado.",
		requiresHumanConfirmation: false,
		shouldRunAgentLab: false,
	});
	return runtime;
}

/**
 * Helper: arma un `runtime` con un `preflight` "limpio" (sin
 * warnings). Junto con un plan chico (que es el default de
 * `fakeRuntime`), produce un `contextBudget.truncated === false`.
 */
function runtimeWithNoWarnings(): CliRuntime {
	return fakeRuntime();
}

// Regex fijo del spec REQ-EI-3 P4 (también contractado en tasks.md
// L432-445). Lo extraigo a constante para que Test 4 lo reuse y para
// que el contrato quede visible en un solo lugar.
const TRUNCATION_NOTICE_REGEX =
	/^\d+ contratos truncados por context budget, fuente en .+/;

// --- Test 1: safeNotes incluye aviso cuando contextBudget truncado ---

test("T1.10 safeNotes incluye aviso cuando contextBudget está truncado", async () => {
	const runtime = runtimeWithManyWarnings();

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request: "request que fuerza truncamiento via warnings de preflight",
			includePlanSnapshot: true,
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	const budget = result.data.contextBudget as ContextBudgetUsage;
	assert.equal(budget.truncated, true, "precondición: budget debe estar truncado");

	const aviso = (result.safeNotes as string[]).find((n) =>
		TRUNCATION_NOTICE_REGEX.test(n),
	);
	assert.ok(
		aviso,
		`safeNotes debe incluir aviso de truncamiento que matchea ${TRUNCATION_NOTICE_REGEX}. safeNotes actuales: ${JSON.stringify(result.safeNotes)}`,
	);
});

// --- Test 2: el aviso es el primer safeNote user-provided ---
//
// POR QUÉ asertamos posición RELATIVA y no absoluta (`safeNotes[0]`):
//
//   El handler de `idu_supervisor_context_pack` (en
//   `src/mcp/supervisor-context/handlers.ts:113-120`) construye su
//   `safeNotes` y luego lo pasa a `envelope()` (en
//   `src/mcp/_shared/index.ts:237`). `envelope()` prepende
//   `[...SAFE_BASE_NOTES]` (3 invariantes compartidos) ANTES de los
//   `safeNotes` del handler, vía
//   `dedupe([...SAFE_BASE_NOTES, ...(input.safeNotes ?? [])])`.
//
//   Resultado: el orden final es
//     [base1, base2, base3, ...handlerSafeNotes]
//   donde `handlerSafeNotes` comienza con la truncation notice (porque
//   el handler hace `safeNotes.unshift(truncationNotice)` cuando hay
//   truncamiento). Pero los 3 SAFE_BASE_NOTES la empujan a `safeNotes[3]`,
//   NO a `safeNotes[0]`.
//
//   Modificar `envelope()` para no prepender SAFE_BASE_NOTES rompería
//   el invariante P5 de REQ-EI-4 y el anti-pattern guard del design
//   (los ~130 call sites migrados en T1.2 dependen de esos 3 notas
//   compartidas). Por lo tanto la aserción correcta es RELATIVA:
//   el aviso debe preceder al advisory hardcoded del handler
//   ("Context pack advisory: no implementé, ..."), no aparecer en
//   posición 0 absoluta.
//
//   Esto es la garantía mínima correcta: si en el futuro el handler
//   agrega otros safeNotes user-provided entre el aviso y el
//   advisory, este assert sigue siendo válido.

test("T1.10 el aviso de truncamiento es el primer safeNote user-provided", async () => {
	const runtime = runtimeWithManyWarnings();

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{
			request: "request que fuerza truncamiento via warnings de preflight",
			includePlanSnapshot: true,
		},
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	const budget = result.data.contextBudget as ContextBudgetUsage;
	assert.equal(budget.truncated, true, "precondición: budget debe estar truncado");

	assert.ok(
		Array.isArray(result.safeNotes) && result.safeNotes.length > 0,
		"safeNotes debe ser array no vacío",
	);

	const noticeIdx = (result.safeNotes as string[]).findIndex((n) =>
		TRUNCATION_NOTICE_REGEX.test(n),
	);
	const advisoryIdx = (result.safeNotes as string[]).indexOf(
		"Context pack advisory: no implementé, no escribí archivos y no ejecuté AgentLabs.",
	);

	assert.notEqual(
		noticeIdx,
		-1,
		`safeNotes debe contener el aviso de truncamiento. safeNotes actuales: ${JSON.stringify(result.safeNotes)}`,
	);
	assert.notEqual(
		advisoryIdx,
		-1,
		`safeNotes debe contener el advisory hardcoded del handler. safeNotes actuales: ${JSON.stringify(result.safeNotes)}`,
	);
	assert.ok(
		noticeIdx < advisoryIdx,
		`El aviso debe preceder al advisory hardcoded (posición relativa, no absoluta, por el invariante SAFE_BASE_NOTES de envelope()). safeNotes[${noticeIdx}] (aviso) vs safeNotes[${advisoryIdx}] (advisory). safeNotes actuales: ${JSON.stringify(result.safeNotes)}`,
	);
});

// --- Test 3: safeNotes NO incluye aviso cuando no hay truncamiento ---

test("T1.10 safeNotes NO incluye aviso cuando contextBudget NO está truncado", async () => {
	const runtime = runtimeWithNoWarnings();

	const result = await callIduMcpTool(
		"idu_supervisor_context_pack",
		{ request: "x", includePlanSnapshot: true },
		{ runtimeFactory: () => runtime, projectResolver: () => registered() },
	);

	const budget = result.data.contextBudget as ContextBudgetUsage;
	assert.equal(
		budget.truncated,
		false,
		"precondición: budget NO debe estar truncado",
	);

	const aviso = (result.safeNotes as string[]).find((n) =>
		TRUNCATION_NOTICE_REGEX.test(n),
	);
	assert.equal(
		aviso,
		undefined,
		`safeNotes NO debe contener aviso de truncamiento. safeNotes actuales: ${JSON.stringify(result.safeNotes)}`,
	);
});

// --- Test 4: el regex matchea el formato exacto del spec ---

test("T1.10 regex matchea el formato exacto del spec para varios casos", () => {
	const formatos = [
		"1 contratos truncados por context budget, fuente en Doc/foo.md",
		"3 contratos truncados por context budget, fuente en mixed",
		"10 contratos truncados por context budget, fuente en Doc/bar.md",
	];
	for (const formato of formatos) {
		assert.match(
			formato,
			TRUNCATION_NOTICE_REGEX,
			`regex debe matchear: ${formato}`,
		);
	}

	// Casos negativos: el regex NO debe matchear.
	const negativos = [
		"", // vacío
		"algún otro safeNote que no es aviso de truncamiento",
		"context pack advisory: no implementé, no escribí archivos",
		"1 contratos truncados por context budget", // falta "fuente en ..."
		"contratos truncados por context budget, fuente en Doc/foo.md", // falta el número
		"1 contrato truncado por context budget, fuente en Doc/foo.md", // singular, no plural
	];
	for (const negativo of negativos) {
		assert.equal(
			TRUNCATION_NOTICE_REGEX.test(negativo),
			false,
			`regex NO debe matchear: ${negativo}`,
		);
	}
});