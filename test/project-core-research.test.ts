import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createDefaultProjectCore } from "../src/project-core.js";
import {
	buildProjectCoreResearchPrompt,
	formatProjectCoreResearchDraft,
	formatProjectCoreResearchReview,
	reviewProjectCoreResearchDraft,
	saveProjectCoreResearchDraft,
} from "../src/project-core-research.js";

const tempDirs: string[] = [];

function tempProject(): {
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
} {
	const projectPath = mkdtempSync(join(tmpdir(), "pi-core-research-"));
	// Slice 2/5: blueprint now lives under stateRoot. Use a separate temp
	// dir for stateRoot so tests reflect the post-slice territory model.
	// NOTE: flows remains under projectPath for now — Slice 4 moves flows
	// to stateRoot, so we keep flows accessible to loadProjectFlows via
	// its current projectPath-based migration.
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-core-research-state-"));
	tempDirs.push(projectPath, stateRoot);
	const reportsDir = join(projectPath, "reports-out");
	mkdirSync(join(projectPath, "config"), { recursive: true });
	mkdirSync(join(projectPath, "docs"), { recursive: true });
	mkdirSync(reportsDir, { recursive: true });
	mkdirSync(join(stateRoot, "config"), { recursive: true });
	const core = createDefaultProjectCore("Demo Core");
	writeFileSync(
		join(projectPath, "config", "project-core.json"),
		JSON.stringify(
			{
				...core,
				projectGoal: "Gestionar órdenes de trabajo de mantenimiento",
				problemStatement: "Las solicitudes se pierden en canales informales",
				status: "draft",
			},
			null,
			2,
		),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "README.md"),
		"# Demo\nSafe overview\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "package.json"),
		'{"name":"demo","dependencies":{"grammy":"latest"}}\n',
		"utf8",
	);
	writeFileSync(
		join(projectPath, "docs", "guide.md"),
		"# Guide\nSmall doc\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, ".env"),
		"SECRET_TOKEN=super-secret-value\n",
		"utf8",
	);
	writeFileSync(
		join(stateRoot, "config", "project-blueprint.json"),
		'{"projectName":"Blueprint"}\n',
		"utf8",
	);
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(projectPath, ".idu", "config", "project-flows.json"),
		'{"modules":[]}\n',
		"utf8",
	);
	return { projectPath, stateRoot, reportsDir };
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("buildProjectCoreResearchPrompt includes projectGoal", () => {
	const { projectPath, stateRoot } = tempProject();
	const prompt = buildProjectCoreResearchPrompt(projectPath, "", stateRoot);

	assert.match(prompt, /Gestionar órdenes de trabajo/u);
	assert.match(prompt, /Responder en JSON/u);
	assert.match(prompt, /No decidir por el humano/u);
});

test("buildProjectCoreResearchPrompt does not include simulated secrets", () => {
	const { projectPath, stateRoot } = tempProject();
	const prompt = buildProjectCoreResearchPrompt(projectPath, "", stateRoot);

	assert.doesNotMatch(prompt, /super-secret-value/u);
	assert.doesNotMatch(prompt, /SECRET_TOKEN/u);
	assert.doesNotMatch(prompt, /\.env/u);
});

test("saveProjectCoreResearchDraft creates file in reports", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	const result = await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		now: () => new Date("2026-05-22T10:11:12Z"),
		generate: async () => JSON.stringify(validRecommendations()),
	});

	assert.equal(result.ok, true);
	assert.equal(
		result.path,
		join(reportsDir, "project-core-research-draft-20260522-101112.json"),
	);
	assert.equal(existsSync(result.path), true);
});

test("saveProjectCoreResearchDraft does not write config/project-core.json", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	const corePath = join(projectPath, "config", "project-core.json");
	const before = readFileSync(corePath, "utf8");

	await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		generate: async () => JSON.stringify(validRecommendations()),
	});

	// Territory model: loadProjectCore (called inside saveProjectCoreResearchDraft
	// to read sourceCoreStatus) uses migration guard and moves the legacy file
	// to <repo>/.idu/config/project-core.json. We compare against the migrated
	// path; the content must be unchanged.
	const migratedPath = join(projectPath, ".idu", "config", "project-core.json");
	assert.equal(readFileSync(migratedPath, "utf8"), before);
});

test("saved ProjectCore research draft includes warning", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	const result = await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		generate: async () => JSON.stringify(validRecommendations()),
	});
	assert.equal(result.ok, true);
	const draft = JSON.parse(readFileSync(result.path, "utf8")) as {
		warning: string;
	};

	assert.equal(draft.warning, "Borrador IA. No es fuente de verdad.");
	assert.match(
		formatProjectCoreResearchDraft(result),
		/No modifiqué config\/project-core\.json/u,
	);
});

test("reviewProjectCoreResearchDraft latest works", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		now: () => new Date("2026-05-22T10:11:12Z"),
		generate: async () => JSON.stringify(validRecommendations()),
	});

	const review = reviewProjectCoreResearchDraft("latest", reportsDir);

	assert.equal(review.validJson, true);
	assert.equal(review.hasRequiredWarning, true);
	assert.match(
		review.path,
		/project-core-research-draft-20260522-101112\.json/u,
	);
	assert.match(
		formatProjectCoreResearchReview(review),
		/recomendaciones principales/u,
	);
});

test("reviewProjectCoreResearchDraft accepts explicit path", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	const result = await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		generate: async () => JSON.stringify(validRecommendations()),
	});
	assert.equal(result.ok, true);

	const review = reviewProjectCoreResearchDraft(result.path, reportsDir);

	assert.equal(review.path, result.path);
	assert.equal(review.validJson, true);
});

test("reviewProjectCoreResearchDraft rejects explicit paths outside reports", () => {
	const { projectPath, reportsDir } = tempProject();
	const outsidePath = join(projectPath, "outside.json");
	writeFileSync(
		outsidePath,
		JSON.stringify({ warning: "Borrador IA. No es fuente de verdad." }),
	);

	const review = reviewProjectCoreResearchDraft(outsidePath, reportsDir);

	assert.equal(review.validDraft, false);
	assert.match(review.errors.join("\n"), /reports/u);
});

test("reviewProjectCoreResearchDraft handles invalid rawOutput", async () => {
	const { projectPath, stateRoot, reportsDir } = tempProject();
	const result = await saveProjectCoreResearchDraft({
		projectPath,
		stateRoot,
		reportsDir,
		generate: async () => "not json",
	});
	assert.equal(result.ok, true);

	const review = reviewProjectCoreResearchDraft(result.path, reportsDir);

	assert.equal(review.validJson, false);
	assert.equal(review.hasRawOutput, true);
	assert.doesNotThrow(() => formatProjectCoreResearchReview(review));
});

function validRecommendations() {
	return {
		suggestedLanguages: ["TypeScript"],
		suggestedFrameworks: ["grammY"],
		suggestedDatabase: ["SQLite", "Postgres"],
		suggestedAuthSecurity: ["Telegram allowlist", "secret redaction"],
		suggestedArchitecture: ["modular services"],
		suggestedDeployment: ["server"],
		scalabilityNotes: ["queue work by project"],
		maintainabilityNotes: ["keep tests near modules"],
		risks: ["unclear data retention"],
		alternatives: ["local only", "cloud worker"],
		openQuestions: ["Who approves production changes?"],
	};
}
