// T1.3 — RECONOCIMIENTO: imprime la forma real de `contextBudget.omitted[]`
// que T1.4 va a recibir como input del helper `buildTruncationNotice(budget)`.
//
// Este test NO assertea nada del shape. Su único trabajo es construir un
// `ContextBudgetUsage` con truncamiento forzado (vía los helpers puros
// `sliceTextToBudget`/`sliceListToBudget`/`mergeContextBudgetUsage`) e
// imprimir la forma de `omitted[]` para que T1.4 escriba el helper
// correcto.
//
// Diseño §9 Spec Concern #4 (engañoso): el scout inicial dijo que la
// forma era `[{path}]` y luego que era `[{reason, omittedItems}]`. La
// realidad está en `src/context-budget.ts:31-36` (tipo
// `ContextBudgetOmission`) y se construye en
// `src/context-budget.ts:206-212, 254-258, 280-285`. Este test existe
// para que T1.4 lea el snapshot antes de escribir el helper.
//
// POR QUÉ NO USAR `idu_supervisor_context_pack` end-to-end:
//   - El handler real (src/mcp/supervisor-context/handlers.ts:99) hace
//     `data: pack` con el `pack.contextBudget` que produce
//     `mergeContextBudgetUsage` sobre los usages de cada sección.
//     Pero la "fuente" del shape vive en `src/context-budget.ts`, no en
//     el handler.
//   - Llamar al handler completo requiere stub de runtime con 9+
//     métodos (masterPlanReview, preflight, sourceRecommend,
//     sourceRequiredActions, ...). Es frágil y ortogonal al shape.
//   - T1.4 va a recibir el `ContextBudgetUsage` ya armado, no la
//     respuesta del handler. Verificar el shape a nivel de los helpers
//     puros es MÁS fiel a la realidad que T1.4 enfrenta.
//
// Cinco fuentes independientes confirman el shape real:
//   1. Tipo `ContextBudgetOmission` (src/context-budget.ts:31-36).
//   2. Construcción en `sliceTextToBudget` (src/context-budget.ts:206-212)
//      → `{path, reason: "max_chars", omittedChars}`.
//   3. Construcción en `sliceListToBudget` (src/context-budget.ts:254-258)
//      → `{path, reason: "max_items", omittedItems}`.
//   4. Construcción en `mergeContextBudgetUsage` (src/context-budget.ts:280-285)
//      → `{path: "contextBudget.total", reason: "max_chars", omittedChars}`.
//   5. Test existente (test/context-budget.test.ts:22-23, 39-45, 81-82)
//      assertea `omitted[0].path`, `omitted[0].reason`,
//      `omitted.some(item => item.reason === "max_items")`,
//      `omitted.some(item => item.path === "contextBudget.total")`.

import assert from "node:assert/strict";
import test from "node:test";
import {
	mergeContextBudgetUsage,
	sliceListToBudget,
	sliceTextToBudget,
} from "../src/context-budget.js";
import type { ContextBudgetUsage } from "../src/context-budget.js";
import { buildTruncationNotice } from "../src/mcp/envelope-advisory/truncation-notice.js";

test("T1.3 RECONOCIMIENTO: imprime forma real de contextBudget.omitted[]", () => {
	// Forzar 3 paths de truncamiento distintos: max_chars (sliceTextToBudget),
	// max_items (sliceListToBudget) y max_chars de overflow total
	// (mergeContextBudgetUsage).

	// (a) max_chars: texto > 100 chars → 1 entry `{path, reason, omittedChars}`.
	const textUsage = sliceTextToBudget({
		text: "x".repeat(2_000),
		profile: "supervisor_context_pack",
		path: "goals.taskGoal",
		maxChars: 100,
	}).usage;

	// (b) max_items: lista de 25 > maxArrayItems=10 → 1 entry `{path, reason, omittedItems}`.
	const listUsage = sliceListToBudget({
		items: Array.from({ length: 25 }, (_, i) => `item-${i}`),
		profile: "supervisor_context_pack",
		path: "risks",
	}).usage;

	// (c) max_chars overflow total: 8 slices de 1500 chars > maxTotalChars=10000
	//     → entry adicional `{path: "contextBudget.total", reason: "max_chars", omittedChars}`.
	const longSlices = Array.from({ length: 8 }, (_, i) =>
		sliceTextToBudget({
			text: "x".repeat(1_500),
			profile: "supervisor_context_pack",
			path: `loop-${i}`,
		}).usage,
	);
	const merged = mergeContextBudgetUsage("supervisor_context_pack", [
		...longSlices,
		textUsage,
		listUsage,
	]);

	console.log("=== contextBudget shape (T1.3 RECON) ===");
	console.log(JSON.stringify(merged, null, 2));
	console.log("=== top-level keys of contextBudget ===");
	console.log(Object.keys(merged).join(", "));
	console.log("=== omitted array length ===");
	console.log(merged.omitted.length);
	console.log("=== omitted[0] (max_chars entry) ===");
	console.log(JSON.stringify(merged.omitted[0], null, 2));
	console.log("=== omitted element that has omittedItems ===");
	const withOmittedItems = merged.omitted.find(
		(o) => typeof o.omittedItems === "number",
	);
	console.log(JSON.stringify(withOmittedItems ?? null, null, 2));
	console.log("=== omitted element with path=contextBudget.total ===");
	const totalEntry = merged.omitted.find(
		(o) => o.path === "contextBudget.total",
	);
	console.log(JSON.stringify(totalEntry ?? null, null, 2));
	console.log("=== union of keys across all omitted entries ===");
	const allKeys = new Set<string>();
	for (const o of merged.omitted) {
		for (const k of Object.keys(o)) allKeys.add(k);
	}
	console.log([...allKeys].join(", "));

	// Sólo assertea que el shape existe y tiene las 3 clases de entry
	// que el design anticipó (max_chars, max_items, total overflow).
	// La forma precisa queda registrada por consola.
	assert.ok(Array.isArray(merged.omitted), "omitted no es array");
	assert.ok(merged.omitted.length >= 3, "omitted < 3 — no se forzó las 3 vías");
	assert.ok(
		merged.omitted.some((o) => o.reason === "max_chars"),
		"falta entry con reason=max_chars",
	);
	assert.ok(
		merged.omitted.some((o) => o.reason === "max_items"),
		"falta entry con reason=max_items",
	);
});

// T1.4 — RED helper `buildTruncationNotice`.
//
// Contrato esperado (verificado en spec REQ-EI-3 P4 y design §9 Spec
// Concern #3 + nota post-T1.3 sobre el sentinel "contextBudget.total"):
//
//   1. `budget.truncated === false` → retorna `null`.
//   2. `truncated === true` con N=1 y 1 path único (excluyendo el
//      sentinel) → `"${N} contratos truncados por context budget,
//      fuente en ${path}"`.
//   3. `truncated === true` con N=3 y 3 paths únicos distintos
//      (excluyendo el sentinel) → `"${N} contratos truncados por
//      context budget, fuente en mixed"`.
//   4. `truncated === true` con N=4 pero 2 unique paths (dos reasons
//      distintos sobre el mismo path) → `"${N} contratos truncados
//      por context budget, fuente en mixed"`.
//   5. La entry con `path === "contextBudget.total"` (sentinel que
//      agrega `mergeContextBudgetUsage` cuando el total agregado
//      supera `maxTotalChars`) NO cuenta para N ni para el set de
//      paths únicos. Si después de filtrarla queda un único path
//      real, se usa ese path; si quedan varios, "mixed".
//
// N = total de entries en `omitted[]` excluyendo el sentinel. Esta
// interpretación está fijada por la nota post-T1.3 y el design §9
// Spec Concern #4 (la forma real de `omitted[]` es
// `{path, reason, omittedChars? | omittedItems?}`, NO
// `[{reason, omittedItems}]` como el scout inicial había supuesto).
//
// Verify RED esperado: el import
// `../src/mcp/envelope-advisory/truncation-notice.js` rompe la
// compilación porque T1.11 todavía no creó el archivo ni exportó
// `buildTruncationNotice`. El test rojo por import error es la RED
// legítima — no se mockea, no se hace skip. Cuando T1.11 implemente
// el helper siguiendo este contrato, los 5 viran a GREEN.

test("T1.4 buildTruncationNotice: truncated=false returns null", () => {
	const budget: ContextBudgetUsage = {
		profile: "supervisor_context_pack",
		maxTotalChars: 10000,
		usedChars: 5000,
		truncated: false,
		omitted: [],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
	};
	assert.equal(buildTruncationNotice(budget), null);
});

test("T1.4 buildTruncationNotice: 1 entry, 1 unique path returns the path", () => {
	const budget: ContextBudgetUsage = {
		profile: "supervisor_context_pack",
		maxTotalChars: 10000,
		usedChars: 10000,
		truncated: true,
		omitted: [{ path: "Doc/foo.md", reason: "max_chars", omittedChars: 320 }],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
	};
	assert.equal(
		buildTruncationNotice(budget),
		"1 contratos truncados por context budget, fuente en Doc/foo.md",
	);
});

test("T1.4 buildTruncationNotice: 3 entries, 3 unique paths returns 'mixed'", () => {
	const budget: ContextBudgetUsage = {
		profile: "supervisor_context_pack",
		maxTotalChars: 10000,
		usedChars: 10000,
		truncated: true,
		omitted: [
			{ path: "Doc/a.md", reason: "max_chars", omittedChars: 100 },
			{ path: "Doc/b.md", reason: "max_chars", omittedChars: 200 },
			{ path: "Doc/c.md", reason: "max_items", omittedItems: 5 },
		],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
	};
	assert.equal(
		buildTruncationNotice(budget),
		"3 contratos truncados por context budget, fuente en mixed",
	);
});

test("T1.4 buildTruncationNotice: 4 entries, 2 unique paths returns 'mixed'", () => {
	const budget: ContextBudgetUsage = {
		profile: "supervisor_context_pack",
		maxTotalChars: 10000,
		usedChars: 10000,
		truncated: true,
		omitted: [
			{ path: "Doc/a.md", reason: "max_chars", omittedChars: 100 },
			{ path: "Doc/a.md", reason: "max_items", omittedItems: 5 },
			{ path: "Doc/b.md", reason: "max_chars", omittedChars: 200 },
			{ path: "Doc/b.md", reason: "max_items", omittedItems: 3 },
		],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
	};
	assert.equal(
		buildTruncationNotice(budget),
		"4 contratos truncados por context budget, fuente en mixed",
	);
});

test("T1.4 buildTruncationNotice: filters contextBudget.total sentinel from count", () => {
	const budget: ContextBudgetUsage = {
		profile: "supervisor_context_pack",
		maxTotalChars: 10000,
		usedChars: 10000,
		truncated: true,
		omitted: [
			{ path: "Doc/real.md", reason: "max_chars", omittedChars: 320 },
			// Sentinel que `mergeContextBudgetUsage` agrega cuando el
			// total agregado supera `maxTotalChars`. No es un path de
			// campo real; se filtra del conteo de N y del set de paths
			// únicos. N=1 (solo Doc/real.md), 1 unique path → formato
			// con path, no "mixed".
			{ path: "contextBudget.total", reason: "max_chars", omittedChars: 50 },
		],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
	};
	assert.equal(
		buildTruncationNotice(budget),
		"1 contratos truncados por context budget, fuente en Doc/real.md",
	);
});