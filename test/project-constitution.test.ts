import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
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
