/**
 * R5.1 — loader hermetic tests for `loadConfirmedProjectConstitution`.
 *
 * Why a new file: the existing `project-constitution.test.ts` covers
 * pre-R5.1 behavior (returns ProjectConstitution | undefined). R5.1
 * changed the return type to a discriminated union, so the existing
 * helper tests were updated inline. The hermetic suite below proves the
 * new return contract end-to-end.
 *
 * Acceptance criteria:
 *  1. Layout A only + confirmed core → { kind: "ok" }
 *  2. Layout A + draft core → { kind: "skipped", reason: "core-not-confirmed" }
 *  3. No core anywhere → default core → { kind: "skipped", reason: "core-loaded-default" }
 *  4. Empty stateRoot → { kind: "skipped", reason: "no-stateRoot" }
 *  5. Invalid constitution JSON → { kind: "skipped", reason: "read-failed" }
 *  6. NEVER returns undefined — every exit is typed
 *
 * R5.2: the R5.1 caller shim `getActiveConstitution` is DEAD — it silently
 * absorbed the discriminated union back to `ProjectConstitution | null`,
 * which masked the original R5 bug at the type level. Callers now handle
 * the union directly. The 4 shim tests from R5.1 are removed.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../src/project-core.js";
import {
	deriveConstitutionFromProjectCore,
	loadConfirmedProjectConstitution,
} from "../src/project-constitution.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function seedConfirmedCore(
	stateRoot: string,
	overrides: Partial<ProjectCore> = {},
): ProjectCore {
	const core: ProjectCore = {
		...createDefaultProjectCore("Idu PI"),
		projectGoal: "Coordinar desarrollo seguro desde Telegram",
		problemStatement:
			"Las tareas técnicas pierden contexto y confirmación humana",
		targetUsers: ["Founder", "maintainers"],
		preferredStack: ["TypeScript", "grammY", "SQLite"],
		rejectedStack: ["Firebase"],
		includedScope: ["Telegram bridge", "Project Core"],
		excludedScope: ["Billing", "Public marketplace"],
		successCriteria: ["Build and tests pass"],
		securityLevel: "high",
		dataSensitivity: "high",
		openQuestions: [],
		status: "confirmed",
		...overrides,
	};
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-core.json"),
		`${JSON.stringify(core, null, 2)}\n`,
		"utf8",
	);
	return core;
}

function seedValidConstitution(stateRoot: string, core: ProjectCore): void {
	// Use the production helper so we always serialize a constitution that
	// passes validateProjectConstitution. Hand-rolling fields drifts every
	// time the schema changes.
	const constitution = deriveConstitutionFromProjectCore(core);
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);
}

after(() => {
	for (const dir of tempDirs) {
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

// =========================================================================
// Test 1 — Layout A only + confirmed core → { kind: "ok" }
// =========================================================================

test("R5.1 loadConfirmedProjectConstitution: Layout A core + Layout A constitution + confirmed → ok", () => {
	const stateRoot = makeTempDir("pi-r51-layout-a-confirmed-");
	const core = seedConfirmedCore(stateRoot);
	seedValidConstitution(stateRoot, core);

	const result = loadConfirmedProjectConstitution(stateRoot);

	assert.notEqual(
		result,
		undefined,
		"R5.1 acceptance: NEVER returns undefined",
	);
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return; // narrow for TS
	assert.equal(result.constitution.projectName, core.projectName);
	assert.equal(result.constitution.version, "1.0.0");
});

// =========================================================================
// Test 2 — Layout A + draft core → { kind: "skipped", reason: "core-not-confirmed" }
// =========================================================================

test("R5.1 loadConfirmedProjectConstitution: Layout A + draft core → skipped core-not-confirmed", () => {
	const stateRoot = makeTempDir("pi-r51-draft-core-");
	const draftCore = seedConfirmedCore(stateRoot, { status: "draft" });
	seedValidConstitution(stateRoot, draftCore);

	const result = loadConfirmedProjectConstitution(stateRoot);

	assert.notEqual(result, undefined);
	assert.equal(result.kind, "skipped");
	if (result.kind !== "skipped") return; // narrow
	assert.equal(result.reason, "core-not-confirmed");
});

// =========================================================================
// Test 3 — No core anywhere → default core → { kind: "skipped", reason: "core-loaded-default" }
// =========================================================================

test("R5.1 loadConfirmedProjectConstitution: no core at all → skipped core-loaded-default", () => {
	// State root with neither Layout A nor Layout B core. loadProjectCore
	// falls through to defaultCorePath() (the package-bundled default),
	// which has status "draft" — but the R5.1 guard fires BEFORE the
	// status check via detectCoreSource, so we get "core-loaded-default"
	// instead of "core-not-confirmed".
	const stateRoot = makeTempDir("pi-r51-no-core-");

	const result = loadConfirmedProjectConstitution(stateRoot);

	assert.notEqual(result, undefined);
	assert.equal(result.kind, "skipped");
	if (result.kind !== "skipped") return; // narrow
	assert.equal(result.reason, "core-loaded-default");
});

// =========================================================================
// Test 4 — Empty stateRoot → { kind: "skipped", reason: "no-stateRoot" }
// =========================================================================

test("R5.1 loadConfirmedProjectConstitution: empty stateRoot → skipped no-stateRoot", () => {
	const result = loadConfirmedProjectConstitution("");

	assert.notEqual(result, undefined, "R5.1: must NEVER return undefined");
	assert.equal(result.kind, "skipped");
	if (result.kind !== "skipped") return; // narrow
	assert.equal(result.reason, "no-stateRoot");
});

// =========================================================================
// Test 5 — Invalid constitution JSON → { kind: "skipped", reason: "read-failed" }
// =========================================================================

test("R5.1 loadConfirmedProjectConstitution: invalid constitution JSON → skipped read-failed", () => {
	const stateRoot = makeTempDir("pi-r51-invalid-constitution-");
	seedConfirmedCore(stateRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-constitution.json"),
		`{ this is not valid JSON ::: }`,
		"utf8",
	);

	const result = loadConfirmedProjectConstitution(stateRoot);

	assert.notEqual(result, undefined);
	assert.equal(result.kind, "skipped");
	if (result.kind !== "skipped") return; // narrow
	assert.equal(result.reason, "read-failed");
	// Detail must include the underlying JSON parse error so triage is possible
	assert.ok(
		typeof result.detail === "string" && result.detail.length > 0,
		"read-failed must carry a detail string",
	);
});

// =========================================================================
// Test 6 — R5.2 fail-loud: discriminated union is the ONLY return shape
// =========================================================================
// (R5.1 had a `getActiveConstitution` shim that wrapped the union back to
//  `ProjectConstitution | null`. That shim is DEAD in R5.2 — see file header.)

test("R5.2: loadConfirmedProjectConstitution returns a discriminated union, never undefined", () => {
	// Empty stateRoot is the simplest path that triggers a skip.
	const result = loadConfirmedProjectConstitution("");
	assert.notEqual(result, undefined, "R5.1 acceptance: NEVER returns undefined");
	assert.ok(
		result.kind === "ok" || result.kind === "skipped",
		"R5.2 acceptance: result MUST be the discriminated union",
	);
});
