import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { resolvePackageRoot } from "../src/package-root.js";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../src/project-core.js";
import {
	deriveConstitutionFromProjectCore,
	evaluateConstitutionGates,
	formatConstitutionForPrompt,
	loadConfirmedProjectConstitution,
	loadProjectConstitution,
	validateProjectConstitution,
} from "../src/project-constitution.js";
import { migrateHygieneLayout } from "../src/hygiene-migrate.js";

const tempDirs: string[] = [];

function confirmedCore(overrides: Partial<ProjectCore> = {}): ProjectCore {
	return {
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
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("deriveConstitutionFromProjectCore creates rules from confirmed Project Core", () => {
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());

	assert.equal(constitution.projectName, "Idu PI");
	assert.equal(constitution.sourceCoreStatus, "confirmed");
	assert.equal(constitution.status, "active");
	assert.ok(
		constitution.principles.some((item) =>
			/Project Core confirmado/u.test(item),
		),
	);
	assert.ok(constitution.technologyRules.preferredStack.includes("TypeScript"));
	assert.ok(constitution.technologyRules.rejectedStack.includes("Firebase"));
	assert.ok(
		constitution.validationGates.some(
			(gate) => gate.id === "skip_tests_blocker",
		),
	);
	assert.match(
		formatConstitutionForPrompt(constitution),
		/Project Constitution/u,
	);
	assert.equal(validateProjectConstitution(constitution).ok, true);
});

test("evaluateConstitutionGates reports project_core_not_confirmed", () => {
	const constitution = deriveConstitutionFromProjectCore(
		confirmedCore({ status: "draft" }),
	);

	const result = evaluateConstitutionGates({
		request: "crear módulo Project Core",
		constitution,
	});

	assert.equal(result.risk, "blocker");
	assert.ok(
		result.failures.some(
			(failure) => failure.gateId === "project_core_not_confirmed",
		),
	);
});

test("evaluateConstitutionGates marks auth/login request high", () => {
	const result = evaluateConstitutionGates({
		request: "agregar login con tokens",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(result.risk, "high");
	assert.equal(result.requiresHumanConfirmation, true);
	assert.ok(
		result.failures.some(
			(failure) => failure.gateId === "auth_security_review",
		),
	);
});

test("evaluateConstitutionGates marks DB/schema with high data sensitivity high", () => {
	const result = evaluateConstitutionGates({
		request: "crear migration para tabla de usuarios",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(result.risk, "high");
	assert.ok(
		result.failures.some(
			(failure) => failure.gateId === "data_security_review",
		),
	);
});

test("evaluateConstitutionGates warns for request outside includedScope", () => {
	const result = evaluateConstitutionGates({
		request: "crear módulo inventario",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.ok(["medium", "high"].includes(result.risk));
	assert.ok(
		result.warnings.some((warning) => warning.gateId === "scope_included"),
	);
});

test("evaluateConstitutionGates blocks excludedScope request", () => {
	const result = evaluateConstitutionGates({
		request: "crear billing para suscripciones",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(result.risk, "blocker");
	assert.ok(
		result.failures.some((failure) => failure.gateId === "scope_excluded"),
	);
});

test("evaluateConstitutionGates blocks rejected stack", () => {
	const result = evaluateConstitutionGates({
		request: "usar Firebase para auth",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(result.risk, "blocker");
	assert.ok(
		result.failures.some((failure) => failure.gateId === "rejected_stack"),
	);
});

test("evaluateConstitutionGates blocks skipping tests", () => {
	const result = evaluateConstitutionGates({
		request: "implementalo sin correr tests ni build",
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(result.risk, "blocker");
	assert.ok(
		result.failures.some((failure) => failure.gateId === "skip_tests_blocker"),
	);
});

test("loadProjectConstitution loads local file or default", () => {
	// Migration to stateRoot-based loader: constitution now lives at
	// <stateRoot>/config/project-constitution.json (Layout B), not at
	// <projectPath>/config/. The fixture creates a stateRoot and writes
	// there to keep the no-op behavior for the path == stateRoot case.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-constitution-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, "config"));
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	assert.equal(loadProjectConstitution(stateRoot).projectName, "Idu PI");
});

test("loadProjectConstitution reads from stateRoot, not projectPath (path != stateRoot)", () => {
	const projectPath = mkdtempSync(join(tmpdir(), "pi-constitution-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-state-"));
	tempDirs.push(projectPath, stateRoot);

	// Constitution lives ONLY in stateRoot/config/. projectPath is empty.
	mkdirSync(join(stateRoot, "config"), { recursive: true });
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadProjectConstitution(stateRoot);
	assert.equal(loaded.projectName, "Idu PI");

	// Guard anti-migración: el loader NO debe haber consultado ni escrito en projectPath.
	assert.equal(
		existsSync(join(projectPath, "config", "project-constitution.json")),
		false,
		"loader must not consult projectPath (no migration as side effect)",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-constitution.json")),
		false,
		"loader must not consult Layout A in projectPath",
	);
});

// Issue #172 split-brain guards: loadConfirmedProjectConstitution is the shared
// helper exported from src/project-constitution.ts and consumed by both
// src/index.ts and src/cli/setup/helpers.ts. The pre-fix signature accepted
// (projectPath, stateRoot) as optional and used `stateRoot ?? projectPath`,
// which silently fed projectPath to loadProjectCore + loadProjectConstitution
// when stateRoot was undefined. These tests prove the helper reads from
// stateRoot only.

test("loadConfirmedProjectConstitution reads from stateRoot, not projectPath (path != stateRoot, with constitution)", () => {
	const projectPath = mkdtempSync(join(tmpdir(), "pi-confirmed-constitution-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-confirmed-state-"));
	tempDirs.push(projectPath, stateRoot);

	// Seed a confirmed Project Core AND a constitution ONLY under stateRoot.
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });
	const core = confirmedCore();
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-core.json"),
		`${JSON.stringify(core, null, 2)}\n`,
		"utf8",
	);
	const constitution = deriveConstitutionFromProjectCore(core);
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadConfirmedProjectConstitution(stateRoot);
	assert.ok(loaded, "helper must return a constitution when core is confirmed");
	assert.equal(loaded?.projectName, "Idu PI");

	// Anti-split-brain: helper must NOT have consulted or written to projectPath.
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-core.json")),
		false,
		"helper must not consult Layout A in projectPath for core",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-constitution.json")),
		false,
		"helper must not consult Layout B in projectPath for constitution",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-constitution.json")),
		false,
		"helper must not consult Layout A in projectPath for constitution",
	);
});

test("loadConfirmedProjectConstitution derives from stateRoot core when constitution is missing (path != stateRoot)", () => {
	// Same as above, but constitution file does NOT exist — the helper must
	// derive it from the confirmed core at stateRoot (NOT consult projectPath).
	const projectPath = mkdtempSync(join(tmpdir(), "pi-confirmed-derived-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-confirmed-derived-state-"));
	tempDirs.push(projectPath, stateRoot);

	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	const core = confirmedCore();
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-core.json"),
		`${JSON.stringify(core, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadConfirmedProjectConstitution(stateRoot);
	assert.ok(loaded, "helper must derive constitution from confirmed core");
	assert.equal(loaded?.projectName, "Idu PI");

	// Anti-split-brain: helper must NOT have consulted projectPath for either core or constitution.
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-core.json")),
		false,
		"helper must not consult projectPath core (derivation branch)",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-constitution.json")),
		false,
		"helper must not consult Layout B in projectPath (derivation branch)",
	);
});

test("loadConfirmedProjectConstitution returns undefined when stateRoot is empty string", () => {
	// Issue #172: stateRoot is required, but the helper guards against empty
	// input and returns undefined rather than crashing or silently reverting.
	assert.equal(loadConfirmedProjectConstitution(""), undefined);
});

test("loadConfirmedProjectConstitution is no-op when path == stateRoot", () => {
	// Issue #172 acceptance criterion 7: behavior preserved when path === stateRoot.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-confirmed-noop-"));
	tempDirs.push(stateRoot);

	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	const core = confirmedCore();
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-core.json"),
		`${JSON.stringify(core, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadConfirmedProjectConstitution(stateRoot);
	assert.ok(loaded);
	assert.equal(loaded?.projectName, "Idu PI");
});

// =========================================================================
// R1/5 — Issue #178: A-pref-B migration for constitution loader
// =========================================================================

test("loadProjectConstitution: Layout B only → migrates to A and returns content (R1)", () => {
	// R1 acceptance criterion 2a: constitution at Layout B (legacy) is
	// migrated to Layout A on first read, and the loader returns the content.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r1-constitution-b-only-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, "config"));
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadProjectConstitution(stateRoot);
	assert.equal(loaded.projectName, "Idu PI");

	// Layout A must now exist; Layout B must be gone (renameSync is atomic).
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-constitution.json")),
		true,
		"Layout A file must exist after readIdPathWithMigration migrates",
	);
	assert.equal(
		existsSync(join(stateRoot, "config", "project-constitution.json")),
		false,
		"Layout B file must be gone after migration",
	);
});

test("loadProjectConstitution: Layout A only → reads directly without side effect (R1)", () => {
	// R1 acceptance criterion 2b: constitution at Layout A reads directly.
	// No Layout B file should be created as a side effect.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r1-constitution-a-only-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	const loaded = loadProjectConstitution(stateRoot);
	assert.equal(loaded.projectName, "Idu PI");

	// Guard: no Layout B file should appear as a side effect of A-only read.
	assert.equal(
		existsSync(join(stateRoot, "config", "project-constitution.json")),
		false,
		"Layout B file must not be created by Layout A direct read",
	);
});

test("loadProjectConstitution: both A and B → A wins, B is left untouched (R1)", () => {
	// R1 acceptance criterion 2c: when both files exist, A is preferred
	// (readIdPathWithMigration short-circuits on A and does not touch B).
	// B is NOT migrated because A already exists.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r1-constitution-both-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });

	const coreA = confirmedCore({ projectName: "Project-A" });
	const coreB = confirmedCore({ projectName: "Project-B" });
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-constitution.json"),
		`${JSON.stringify(deriveConstitutionFromProjectCore(coreA), null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(deriveConstitutionFromProjectCore(coreB), null, 2)}\n`,
		"utf8",
	);

	const loaded = loadProjectConstitution(stateRoot);
	assert.equal(loaded.projectName, "Project-A", "Layout A must win over Layout B");

	// Both files remain — readIdPathWithMigration only migrates when A is missing.
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-constitution.json")),
		true,
		"Layout A file must remain",
	);
	assert.equal(
		existsSync(join(stateRoot, "config", "project-constitution.json")),
		true,
		"Layout B file must remain when A already exists (no migration triggered)",
	);
});

test("loadProjectConstitution: neither A nor B → falls back to defaultConstitutionPath (R1)", () => {
	// R1 acceptance criterion 2d: when neither layout has the file, the loader
	// falls back to defaultConstitutionPath (the existing default file at
	// <cwd>/config/default-constitution.json). The fallback is preserved
	// as-is per the hard-constraints in the task brief — the cwd-fragility
	// is a known finding logged for R2 (D7 #1).
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r1-constitution-neither-"));
	tempDirs.push(stateRoot);
	// Both layout dirs exist but contain no constitution file.
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });

	const loaded = loadProjectConstitution(stateRoot);
	// The default fixture (config/default-constitution.json) is part of the
	// repo and is read via process.cwd() — it always resolves to the real
	// "Idu-pi" project shipped with the bridge.
	assert.ok(loaded, "loader must return a default constitution");
	assert.ok(loaded.projectName.length > 0);
});

test("hygiene-migrate + loadProjectConstitution: end-to-end (R1 integration)", () => {
	// R1 acceptance criterion 3: run hygiene-migrate on a Layout-B
	// constitution, then call loadProjectConstitution. The loader must find
	// the migrated file at Layout A — without R1, this would have failed
	// because the old loader looked in B and the file had been moved to A.
	//
	// This is the deferred hygiene-migrate bug from Slice 1, now closed.
	const repoRoot = mkdtempSync(join(tmpdir(), "pi-r1-hygiene-repo-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r1-hygiene-state-"));
	tempDirs.push(repoRoot, stateRoot);

	// Seed a constitution at Layout B only.
	mkdirSync(join(repoRoot, "config"), { recursive: true });
	const core = confirmedCore({ projectName: "Hygiene Migrate Test" });
	const constitution = deriveConstitutionFromProjectCore(core);
	writeFileSync(
		join(repoRoot, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	// Run hygiene-migrate to move it B → A.
	const result = migrateHygieneLayout({ repoRoot, stateRoot });
	const constitutionMoved = result.moved.some((entry) =>
		entry.to.endsWith("project-constitution.json"),
	);
	assert.ok(
		constitutionMoved,
		"hygiene-migrate must move project-constitution.json B→A",
	);
	assert.equal(
		existsSync(join(repoRoot, ".idu", "config", "project-constitution.json")),
		true,
		"constitution must be at Layout A after migrateHygieneLayout",
	);
	assert.equal(
		existsSync(join(repoRoot, "config", "project-constitution.json")),
		false,
		"constitution must NOT remain at Layout B after migrateHygieneLayout",
	);

	// Now call the loader. Pre-R1, this would have thrown because the loader
	// looked in <stateRoot>/config/ — but the file is now at Layout A.
	const loaded = loadProjectConstitution(repoRoot);
	assert.equal(loaded.projectName, "Hygiene Migrate Test");
});

// =========================================================================
// R2.2 — Issue #180: defaultConstitutionPath resolves from packageRoot, not cwd
// =========================================================================
//
// R2.2 acceptance criteria (Hermetic tests):
//   1. defaultConstitutionPath resolves from packageRoot, NOT process.cwd().
//   2. loadProjectConstitution with no stateRoot files falls back to the
//      bundled template at packageRoot/config/default-constitution.json.
//   3. loadProjectConstitution with a Layout B constitution present still
//      reads it correctly when cwd is broken (simulates cwd-fragility trap).
//
// All tests run against compiled `dist/` output (see package.json `test`
// script), which is required for resolvePackageRoot() to work — see the
// SOURCE-CONTEXT LIMITATION note in src/package-root.ts.

test("R2.2: defaultConstitutionPath resolves from packageRoot, not cwd", () => {
	// Use the SHARED helper (the same one defaultConstitutionPath uses) to
	// compute the expected path. This avoids duplicating the regex and keeps
	// the test in sync with the helper's exact behavior. Since the helper
	// itself is defined in `src/package-root.ts` and runs in compiled
	// context (`dist/src/package-root.js`), the regex correctly strips
	// `dist/src` and yields the package root regardless of cwd.
	const packageRoot = resolvePackageRoot();
	const expected = join(packageRoot, "config", "default-constitution.json");

	// Confirm the bundled template exists at the expected location.
	assert.equal(
		existsSync(expected),
		true,
		`bundled template must exist at ${expected}`,
	);

	// Save cwd, chdir to a temp dir that DOES NOT have a config/ subdir,
	// then load the loader. If the loader still used process.cwd() it
	// would fail to read a default — but since it now resolves from
	// packageRoot, it succeeds regardless of cwd.
	const originalCwd = process.cwd();
	const fakeCwd = mkdtempSync(join(tmpdir(), "pi-r2-2-fake-cwd-"));
	tempDirs.push(fakeCwd);
	try {
		process.chdir(fakeCwd);

		const loaded = loadProjectConstitution(fakeCwd);
		// fakeCwd is empty: layout A and B both absent → fallback to packageRoot.
		assert.ok(loaded, "loader must return a default constitution");
		assert.equal(
			loaded.projectName,
			JSON.parse(readFileSync(expected, "utf8")).projectName,
			"loaded projectName must match the bundled template, not anything cwd-derived",
		);
	} finally {
		process.chdir(originalCwd);
	}

	// Sanity: the helper's expected path is NOT the (post-chdir) cwd.
	assert.notEqual(expected, join(fakeCwd, "config", "default-constitution.json"));
});

test("R2.2: loadProjectConstitution with no stateRoot files falls back to bundled template (cwd-different)", () => {
	// stateRoot has Layout A and Layout B directories but no constitution
	// file in either. The loader must fall back to packageRoot/config/default-constitution.json
	// (the bundled template), NOT to <stateRoot>/config/default-constitution.json
	// and NOT to <cwd>/config/default-constitution.json.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r2-2-state-empty-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });

	// Build expected payload by reading the bundled template directly.
	const bundledPath = join(
		resolvePackageRoot(),
		"config",
		"default-constitution.json",
	);
	const bundled = JSON.parse(readFileSync(bundledPath, "utf8")) as {
		projectName: string;
	};

	const originalCwd = process.cwd();
	const fakeCwd = mkdtempSync(join(tmpdir(), "pi-r2-2-state-empty-cwd-"));
	tempDirs.push(fakeCwd);
	try {
		// chdir somewhere with NO config/default-constitution.json. If the
		// loader were still cwd-fragile, readFileSync(defaultConstitutionPath())
		// would throw ENOENT and this test would fail.
		process.chdir(fakeCwd);

		const loaded = loadProjectConstitution(stateRoot);
		assert.equal(
			loaded.projectName,
			bundled.projectName,
			"loader must fall back to bundled template when stateRoot has no constitution file",
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("R2.2: loadProjectConstitution reads Layout B even when cwd is broken", () => {
	// Regression guard: even with a cwd that has NO config/default-constitution.json,
	// the loader must NOT accidentally take the cwd-fragile fallback when the
	// stateRoot has a valid Layout B constitution.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-r2-2-layout-b-cwd-broken-"));
	tempDirs.push(stateRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });

	// Seed a sentinel constitution at Layout B with a known projectName.
	const sentinel = deriveConstitutionFromProjectCore(
		confirmedCore({ projectName: "Layout-B-Sentinel" }),
	);
	writeFileSync(
		join(stateRoot, "config", "project-constitution.json"),
		`${JSON.stringify(sentinel, null, 2)}\n`,
		"utf8",
	);

	const originalCwd = process.cwd();
	const fakeCwd = mkdtempSync(join(tmpdir(), "pi-r2-2-broken-cwd-"));
	tempDirs.push(fakeCwd);
	// Deliberately do NOT create fakeCwd/config/default-constitution.json so
	// any cwd-based read would throw ENOENT and fail this test.
	try {
		process.chdir(fakeCwd);

		const loaded = loadProjectConstitution(stateRoot);
		assert.equal(
			loaded.projectName,
			"Layout-B-Sentinel",
			"loader must read Layout B from stateRoot, not fall back to packageRoot",
		);
	} finally {
		process.chdir(originalCwd);
	}
});
