// RED tests para REQ-EI-1 (P1): campo `fuente` en excerpts truncados.
//
// Esta task es SOLO RED. NO modifica código de src/. T1.6 (GREEN) es la
// que crea `resolveExcerptSource(item)` y agrega el spread condicional
// `...(fuente ? { fuente } : {})` en `budgetJsonArray`.
//
// Contrato esperado (T1.6 / design.md §3.2):
//   - `resolveExcerptSource(item)` busca `item.source` → `item.path` →
//     `item.filePath`, en ese orden.
//   - Si ninguno presente → retorna `undefined`.
//   - Si alguno presente → retorna el string tal cual (sin transformar).
//   - Idempotente: misma entrada → mismo string.
//
// RED esperado: `resolveExcerptSource` no está exportado desde
// `src/mcp-server.ts` todavía, así que el import de este archivo falla
// en compile. T1.6 va a crear la función y exportarla.
//
// Tests de integración con `budgetJsonArray`: SKIPPED. La función
// `budgetJsonArray` en `src/mcp-server.ts:2911` es interna (no está
// exportada) y su firma real es
//   `budgetJsonArray(items, profile, path): { items, usage }`
// (no `Array<item>` como asume el task brief). Verificá el contrato de
// `budgetJsonArray` end-to-end con el test parametrizado de T1.10 /
// `mcp-supervisor-context-pack-notice.test.ts` (safeNotes), o cuando se
// refactore la función a un módulo exportado.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveExcerptSource } from "../src/mcp-server.js";

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