import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
	const projectPath = mkdtempSync(join(tmpdir(), "pi-constitution-"));
	tempDirs.push(projectPath);
	mkdirSync(join(projectPath, "config"));
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	writeFileSync(
		join(projectPath, "config", "project-constitution.json"),
		`${JSON.stringify(constitution, null, 2)}\n`,
		"utf8",
	);

	assert.equal(loadProjectConstitution(projectPath).projectName, "Idu PI");
});
