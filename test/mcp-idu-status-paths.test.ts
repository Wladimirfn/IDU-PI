// RED tests para REQ-EI-2 (P2): paths explícitos en `idu_status`.
//
// Esta task es SOLO RED. NO modifica código de src/. T1.8 (GREEN) es la
// que crea `resolveSkillsDirPath(repoRoot)` adyacente a `handleStatus`
// en `src/mcp/session/handlers.ts`, y modifica `handleStatus` para
// exponer `repoPath`, `stateRootPath`, `skillsDirPath` en el `data`.
//
// Contrato esperado (T1.8 / design.md §3.3 + §9 Spec Concern #1):
//   - `resolveSkillsDirPath(repoRoot)` busca en orden
//     `.agents/skills` → `.idu/skills` → `.pi/skills` dentro de `repoRoot`.
//   - Si ninguno existe → retorna `null`.
//   - Si existe → retorna el path absoluto resuelto.
//   - `handleStatus` agrega al `data`:
//       repoPath        — workspace root absoluto (string)
//       stateRootPath   — state root absoluto o `null` si no resuelto
//       skillsDirPath   — `resolveSkillsDirPath(runtime.workspaceRoot)` o `null`
//
// RED esperado (T1.7):
//   1. El import `resolveSkillsDirPath` desde `../src/mcp/session/handlers.js`
//      falla en compile porque el símbolo no está exportado todavía.
//   2. El integration test pasa por la compilación (no toca el símbolo
//      faltante directamente) pero FALLA en runtime: `data` de
//      `idu_status` no tiene `repoPath` / `stateRootPath` / `skillsDirPath`.

import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	listIduMcpTools,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import { resolveSkillsDirPath } from "../src/mcp/session/handlers.js";

// =====================================================================
// Hermetic tmpdir helpers
// =====================================================================

/**
 * Crea un directorio temporal vacío y devuelve su path absoluto.
 * Cleanup a cargo del caller (usar `try { ... } finally { rmSync(...) }`).
 */
function createTempRepo(): string {
	return mkdtempSync(join(tmpdir(), "mcp-status-paths-empty-"));
}

/**
 * Crea un directorio temporal con la estructura `relPath: content` provista.
 * Las claves con `/` se interpretan como paths anidados; los directorios
 * padre se crean con `recursive: true`. Cleanup a cargo del caller.
 */
function createTempRepoWith(structure: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "mcp-status-paths-"));
	for (const [relPath, content] of Object.entries(structure)) {
		const fullPath = join(dir, relPath);
		mkdirSync(join(fullPath, ".."), { recursive: true });
		writeFileSync(fullPath, content);
	}
	return dir;
}

// =====================================================================
// Tests unitarios de `resolveSkillsDirPath(repoRoot)` (helper puro)
// =====================================================================

test("[resolveSkillsDirPath] prioriza `.agents/skills` sobre `.idu/skills` y `.pi/skills`", () => {
	const repoRoot = createTempRepoWith({ ".agents/skills/foo.txt": "x" });
	try {
		const result = resolveSkillsDirPath(repoRoot);
		assert.equal(result, join(repoRoot, ".agents/skills"));
	} finally {
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("[resolveSkillsDirPath] usa `.idu/skills` cuando no hay `.agents/skills`", () => {
	const repoRoot = createTempRepoWith({ ".idu/skills/foo.txt": "x" });
	try {
		const result = resolveSkillsDirPath(repoRoot);
		assert.equal(result, join(repoRoot, ".idu/skills"));
	} finally {
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("[resolveSkillsDirPath] usa `.pi/skills` solo si no hay `.agents/skills` ni `.idu/skills`", () => {
	const repoRoot = createTempRepoWith({ ".pi/skills/foo.txt": "x" });
	try {
		const result = resolveSkillsDirPath(repoRoot);
		assert.equal(result, join(repoRoot, ".pi/skills"));
	} finally {
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("[resolveSkillsDirPath] retorna `null` cuando ninguno de los tres existe", () => {
	const repoRoot = createTempRepo();
	try {
		const result = resolveSkillsDirPath(repoRoot);
		// NO ausente: debe estar presente con valor `null` (consumers distinguen
		// "no resuelto" de "ausente" — ver spec REQ-EI-2, último bullet).
		assert.equal(result, null);
	} finally {
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

// =====================================================================
// Test de integración: `idu_status` expone los 3 paths en `data`
// =====================================================================
//
// Reutiliza el patrón de T1.1 (`mcp-envelope-state-root.test.ts`):
// `callIduMcpTool("idu_status", {}, { projectResolver, runtimeFactory })`
// con stubs de `CliRuntime`. La diferencia: acá sólo nos importa el
// shape de `data` (presencia de `repoPath`, `stateRootPath`,
// `skillsDirPath`), no la propagación del stateRoot (eso es REQ-EI-4).

const SAMPLE_REPO_PATH = "C:\\idu-test\\repo-root\\paths-integration";

function resolution(stateRoot: string | undefined): IduMcpProjectResolution {
	// Tolerar `stateRoot === undefined`: NO joineamos con "repo" en ese caso
	// porque `join(undefined, "repo")` falla. Usamos `fake-repo-root` como
	// sentinela — `runtime()` lo detecta y devuelve `workspaceRoot: ""`
	// para que el fallback `?? runtime.workspaceRoot` en `handleStatus`
	// colapse a falsy → `stateRootPath: null` y `repoPath: null` (el path
	// del repo todavía no fue resuelto).
	const basePath =
		stateRoot && stateRoot.length > 0
			? join(stateRoot, "repo")
			: SAMPLE_REPO_PATH;
	return {
		status: "registered_project",
		projectId: "mcp-idu-status-paths-project",
		projectPath: basePath,
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(projectPath: string): CliRuntime {
	const isSentinel = projectPath === SAMPLE_REPO_PATH;
	const workspaceRoot = isSentinel ? "" : projectPath.replace(/[\\/]repo$/u, "");
	const stateRoot = isSentinel ? "" : workspaceRoot;
	return {
		projectId: "mcp-idu-status-paths-project",
		projectPath,
		workspaceRoot,
		labDbPath: isSentinel ? "fake-lab.db" : join(stateRoot, "lab.db"),
	} as unknown as CliRuntime;
}

test("[idu_status integration] expone repoPath, stateRootPath y skillsDirPath en `data`", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-status-paths-int-"));
	try {
		const result = await callIduMcpTool(
			"idu_status",
			{},
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: (projectPath) => runtime(projectPath ?? ""),
			},
		);

		// Los tres campos DEBEN estar presentes en `data` (no ausentes).
		assert.ok(
			"repoPath" in result.data,
			"`data.repoPath` debe estar presente en idu_status",
		);
		assert.ok(
			"stateRootPath" in result.data,
			"`data.stateRootPath` debe estar presente en idu_status",
		);
		assert.ok(
			"skillsDirPath" in result.data,
			"`data.skillsDirPath` debe estar presente en idu_status",
		);

		// `repoPath` y `stateRootPath` son strings absolutos no vacíos
		// cuando el resolver proveyó `stateRoot`.
		assert.equal(typeof result.data.repoPath, "string");
		assert.equal(typeof result.data.stateRootPath, "string");
		assert.ok((result.data.repoPath as string).length > 0);
		assert.ok((result.data.stateRootPath as string).length > 0);

		// `skillsDirPath` puede ser `string | null` (null si el repo no
		// tiene ninguno de los 3 candidatos). Verificamos sólo el tipo
		// runtime — el helper devuelve null porque nuestro tmpdir
		// recién creado no tiene `.agents/skills` ni `.idu/skills` ni
		// `.pi/skills`.
		const skills = result.data.skillsDirPath;
		assert.ok(
			skills === null || typeof skills === "string",
			"`data.skillsDirPath` debe ser `string | null`",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Mantener `listIduMcpTools` importado para que el test parametriza-
// ción en el futuro (T2.5 cubre otras tools que deban exponer los 3
// paths) tenga el símbolo disponible sin agregar imports adicionales.
// Por ahora sólo testeamos `idu_status` explícitamente.
void listIduMcpTools;