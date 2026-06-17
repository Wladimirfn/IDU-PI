import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
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
	confirmProjectCore,
	diffProjectCore,
	formatProjectCoreConfirmationResult,
	formatProjectCoreDiff,
	rejectProjectCore,
} from "../src/project-core-confirmation.js";

const tempDirs: string[] = [];

function tempProject(): {
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	corePath: string;
} {
	const projectPath = mkdtempSync(join(tmpdir(), "pi-core-confirm-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-core-confirm-state-"));
	tempDirs.push(projectPath, stateRoot);
	const reportsDir = join(projectPath, "reports");
	// Write to <repo>/.idu/config/project-core.json (the new territory) so
	// tests don't need migration guard. Some tests still write to the
	// legacy <repo>/config/ to verify migration behavior — those use a
	// dedicated helper instead.
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	mkdirSync(join(projectPath, "reports"), { recursive: true });
	return {
		projectPath,
		stateRoot,
		reportsDir,
		corePath: join(projectPath, ".idu", "config", "project-core.json"),
	};
}

function completeCore(overrides: Partial<ProjectCore> = {}): ProjectCore {
	return {
		...createDefaultProjectCore("Idu PI"),
		projectGoal: "Coordinar desarrollo seguro desde Telegram",
		problemStatement:
			"Las tareas técnicas pierden contexto y confirmación humana",
		targetUsers: ["Founder", "maintainers"],
		includedScope: ["Telegram bridge", "Project Core"],
		excludedScope: ["Production deploy automation"],
		successCriteria: ["Human confirms Project Core before integration"],
		openQuestions: [],
		status: "draft",
		...overrides,
	};
}

function writeCore(corePath: string, core: ProjectCore): void {
	writeFileSync(corePath, `${JSON.stringify(core, null, 2)}\n`, "utf8");
}

function readCore(corePath: string): ProjectCore {
	return JSON.parse(readFileSync(corePath, "utf8")) as ProjectCore;
}

function writeResearchDraft(
	reportsDir: string,
	name = "project-core-research-draft-20260522-101112.json",
): string {
	const path = join(reportsDir, name);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				generatedAt: "2026-05-22T10:11:12.000Z",
				projectPath: "demo",
				warning: "Borrador IA. No es fuente de verdad.",
				sourceCoreStatus: "draft",
				validJson: true,
				recommendations: {
					suggestedLanguages: ["TypeScript"],
					suggestedFrameworks: ["grammY"],
					suggestedDatabase: ["SQLite"],
					suggestedAuthSecurity: ["Telegram allowlist"],
					suggestedArchitecture: ["modular services"],
					suggestedDeployment: ["server"],
					scalabilityNotes: ["queue work by project"],
					maintainabilityNotes: ["keep tests near modules"],
					risks: [],
					alternatives: ["manual only"],
					openQuestions: [],
				},
			},
			null,
		)}\n`,
		"utf8",
	);
	return path;
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("confirmProjectCore fails when project-core does not exist", () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();

	const result = confirmProjectCore({ projectPath, stateRoot, reportsDir });

	assert.equal(result.ok, false);
	assert.match(
		formatProjectCoreConfirmationResult(result),
		/No existe config\/project-core\.json/u,
	);
});

test("confirmProjectCore does not confirm with missing critical fields", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore({ targetUsers: [] }));

	const result = confirmProjectCore({ projectPath, stateRoot, reportsDir });
	const core = readCore(corePath);

	assert.equal(result.ok, false);
	assert.equal(core.status, "draft");
	assert.deepEqual(result.missingFields, ["targetUsers"]);
});

test("confirmProjectCore confirms complete draft core", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());

	const result = confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		now: () => new Date("2026-05-22T12:00:00Z"),
	});
	const core = readCore(corePath);

	assert.equal(result.ok, true);
	assert.equal(core.status, "confirmed");
	assert.equal(core.updatedAt, "2026-05-22T12:00:00.000Z");
});

test("confirmProjectCore does not overwrite confirmed core", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(
		corePath,
		completeCore({
			status: "confirmed",
			updatedAt: "2026-01-01T00:00:00.000Z",
		}),
	);
	const before = readFileSync(corePath, "utf8");

	const result = confirmProjectCore({ projectPath, stateRoot, reportsDir });

	assert.equal(result.ok, true);
	assert.equal(result.alreadyConfirmed, true);
	assert.equal(readFileSync(corePath, "utf8"), before);
	assert.match(
		formatProjectCoreConfirmationResult(result),
		/ya está confirmado/u,
	);
});

test("confirmProjectCore creates backup before writing", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());

	const result = confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		now: () => new Date("2026-05-22T12:13:14Z"),
	});

	assert.equal(result.ok, true);
	// Territory: backup lives under stateRoot/tmp/ (scratch), not under
	// <repo>/config/.
	assert.equal(
		existsSync(
			join(stateRoot, "tmp", "project-core.backup-20260522-121314.json"),
		),
		true,
	);
});

test("confirmProjectCore records confirmed_project_core human decision", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());

	confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		now: () => new Date("2026-05-22T12:00:00Z"),
	});
	const core = readCore(corePath);

	assert.ok(
		core.humanDecisions.some(
			(decision) =>
				typeof decision === "object" &&
				decision.decision === "confirmed_project_core" &&
				decision.source === "telegram",
		),
	);
});

test("rejectProjectCore marks stale and records rejected_project_core decision", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore({ status: "proposed" }));

	const result = rejectProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		reason: "scope unclear",
		now: () => new Date("2026-05-22T12:00:00Z"),
	});
	const core = readCore(corePath);

	assert.equal(result.ok, true);
	assert.equal(core.status, "stale");
	assert.ok(
		core.humanDecisions.some(
			(decision) =>
				typeof decision === "object" &&
				decision.decision === "rejected_project_core" &&
				decision.reason === "scope unclear",
		),
	);
});

test("diffProjectCore does not write files", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(
		corePath,
		completeCore({ openQuestions: ["Who approves releases?"] }),
	);
	writeResearchDraft(reportsDir);
	const before = readFileSync(corePath, "utf8");
	const beforeReports = readdirSync(reportsDir).join("\n");

	const diff = diffProjectCore({ projectPath, stateRoot, reportsDir });

	assert.equal(readFileSync(corePath, "utf8"), before);
	assert.equal(readdirSync(reportsDir).join("\n"), beforeReports);
	assert.match(formatProjectCoreDiff(diff), /status actual/u);
	assert.match(formatProjectCoreDiff(diff), /preguntas abiertas/u);
	assert.match(formatProjectCoreDiff(diff), /campos podría completar/u);
});

test("formatProjectCoreDiff surfaces invalid latest research errors", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());
	writeFileSync(
		join(reportsDir, "project-core-research-draft-20260522-101112.json"),
		"{}\n",
		"utf8",
	);

	const diff = diffProjectCore({ projectPath, stateRoot, reportsDir });
	const text = formatProjectCoreDiff(diff);

	assert.equal(diff.ok, true);
	assert.match(text, /Research inválido/u);
});

test("confirmProjectCore rejects research path outside reports", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());
	const outside = join(
		projectPath,
		"project-core-research-draft-20260522-101112.json",
	);
	writeFileSync(outside, "{}\n", "utf8");

	const result = confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		research: outside,
	});

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /reports/u);
});

test("confirmProjectCore rejects JSON not named as project-core research draft", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());
	const wrong = join(reportsDir, "random.json");
	writeFileSync(wrong, "{}\n", "utf8");

	const result = confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		research: wrong,
	});

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /project-core-research-draft/u);
});

test("confirmProjectCore latest_research records research path", () => {
	const { projectPath, stateRoot, reportsDir, corePath } = tempProject();
	writeCore(corePath, completeCore());
	const researchPath = writeResearchDraft(reportsDir);

	const result = confirmProjectCore({
		projectPath,
		stateRoot,
		reportsDir,
		research: "latest_research",
		now: () => new Date("2026-05-22T12:00:00Z"),
	});
	const core = readCore(corePath);

	assert.equal(result.ok, true);
	assert.equal(result.researchDraftPath, researchPath);
	assert.ok(
		core.humanDecisions.some(
			(decision) =>
				typeof decision === "object" &&
				decision.decision === "confirmed_project_core" &&
				decision.researchDraftPath === researchPath,
		),
	);
});
