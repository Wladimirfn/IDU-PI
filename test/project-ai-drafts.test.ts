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
import {
	createAiProjectBlueprintDraft,
	createAiProjectFlowsDraft,
	formatAiProjectDraftResult,
} from "../src/project-ai-drafts.js";

const tempDirs: string[] = [];

function tempProject(): { projectPath: string; reportsDir: string } {
	const projectPath = mkdtempSync(join(tmpdir(), "pi-ai-draft-"));
	tempDirs.push(projectPath);
	const reportsDir = join(projectPath, "reports-out");
	mkdirSync(reportsDir, { recursive: true });
	mkdirSync(join(projectPath, "config"), { recursive: true });
	mkdirSync(join(projectPath, "docs"), { recursive: true });
	writeFileSync(
		join(projectPath, "README.md"),
		"# Demo\nSafe overview\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "package.json"),
		'{"name":"demo","scripts":{"test":"node --test"}}\n',
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
		join(projectPath, "config", "project-blueprint.json"),
		JSON.stringify(validBlueprint("current"), null, 2),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "config", "project-flows.json"),
		JSON.stringify(validFlows(), null, 2),
		"utf8",
	);
	return { projectPath, reportsDir };
}

after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("createAiProjectBlueprintDraft creates warning draft in reports only", async () => {
	const { projectPath, reportsDir } = tempProject();
	const result = await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T10:11:12Z"),
		generate: async () => JSON.stringify(validBlueprint("ai")),
	});

	assert.equal(result.ok, true);
	assert.equal(
		result.path,
		join(reportsDir, "project-blueprint-ai-draft-20260520-101112.json"),
	);
	assert.equal(existsSync(result.path), true);
	assert.equal(
		existsSync(
			join(
				projectPath,
				"config",
				"project-blueprint-ai-draft-20260520-101112.json",
			),
		),
		false,
	);
	const draft = JSON.parse(readFileSync(result.path, "utf8")) as {
		warning: string;
		validJson: boolean;
		proposal: { projectName: string };
	};
	assert.equal(draft.warning, "Borrador IA. No es fuente de verdad.");
	assert.equal(draft.validJson, true);
	assert.equal(draft.proposal.projectName, "ai");
	assert.match(formatAiProjectDraftResult(result), /Borrador IA/u);
});

test("createAiProjectFlowsDraft creates warning draft from scan context in reports only", async () => {
	const { projectPath, reportsDir } = tempProject();
	writeFileSync(
		join(projectPath, "index.html"),
		'<button id="save">Save</button>',
		"utf8",
	);
	let prompt = "";
	const result = await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T10:11:12Z"),
		generate: async (input: string) => {
			prompt = input;
			return JSON.stringify({ suggestedFlows: [] });
		},
	});

	assert.equal(result.ok, true);
	assert.equal(
		result.path,
		join(reportsDir, "project-flows-ai-draft-20260520-101112.json"),
	);
	assert.match(prompt, /scan_project_map/u);
	assert.match(prompt, /project-flows actual/u);
	assert.equal(
		existsSync(
			join(
				projectPath,
				"config",
				"project-flows-ai-draft-20260520-101112.json",
			),
		),
		false,
	);
	const draft = JSON.parse(readFileSync(result.path, "utf8")) as {
		warning: string;
		validJson: boolean;
		proposal: { suggestedFlows: unknown[] };
	};
	assert.equal(draft.warning, "Borrador IA. No es fuente de verdad.");
	assert.equal(draft.validJson, true);
	assert.deepEqual(draft.proposal.suggestedFlows, []);
});

test("AI draft context does not include simulated secrets", async () => {
	const { projectPath, reportsDir } = tempProject();
	let prompt = "";
	await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		generate: async (input: string) => {
			prompt = input;
			return JSON.stringify(validBlueprint("ai"));
		},
	});

	assert.doesNotMatch(prompt, /super-secret-value/u);
	assert.doesNotMatch(prompt, /SECRET_TOKEN/u);
	assert.doesNotMatch(prompt, /\.env/u);
});

test("invalid AI JSON is saved as raw output with warning", async () => {
	const { projectPath, reportsDir } = tempProject();
	const result = await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		generate: async () => "not json",
	});

	assert.equal(result.ok, true);
	const draft = JSON.parse(readFileSync(result.path, "utf8")) as {
		warning: string;
		validJson: boolean;
		rawOutput: string;
	};
	assert.equal(draft.warning, "Borrador IA. No es fuente de verdad.");
	assert.equal(draft.validJson, false);
	assert.equal(draft.rawOutput, "not json");
});

test("AI draft failure returns clear error without writing draft", async () => {
	const { projectPath, reportsDir } = tempProject();
	const result = await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		generate: async () => {
			throw new Error("Pi unavailable");
		},
	});

	assert.equal(result.ok, false);
	assert.match(result.error, /No pude generar borrador IA/u);
	assert.match(
		formatAiProjectDraftResult(result),
		/No pude generar borrador IA/u,
	);
});

function validBlueprint(projectName: string) {
	return {
		projectName,
		projectGoal: "Demo goal",
		projectType: "demo",
		version: "1",
		agentHierarchy: ["human", "agent"],
		architectureRules: ["review first"],
		forbiddenActions: ["auto apply"],
		qualityRules: ["tests pass"],
		requiredValidation: ["build", "test"],
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
	};
}

function validFlows() {
	return {
		version: "1",
		projectType: "demo",
		invariants: ["human review required"],
		qualityRules: ["tests pass"],
		forbiddenTransitions: ["auto apply"],
		allowedTransitions: ["draft only"],
		validationChecklist: ["review draft"],
		modules: [
			{
				id: "core",
				name: "Core",
				description: "Core module",
				screens: ["home"],
				dataStores: ["files"],
				connectedModules: ["core"],
			},
		],
		screens: [
			{
				id: "home",
				path: "index.html",
				module: "core",
				purpose: "Home screen",
				uiElements: ["save"],
			},
		],
		uiElements: [
			{
				id: "save",
				type: "button",
				selector: "#save",
				label: "Save",
				expectedAction: "save",
			},
		],
		dataStores: [
			{
				id: "files",
				type: "file",
				tables: ["drafts"],
				ownerModule: "core",
			},
		],
		flows: [
			{
				id: "save-flow",
				name: "Save",
				module: "core",
				trigger: "save",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "#save",
						to: "files",
						description: "Save draft",
					},
				],
				expectedResult: "Draft saved",
				testTargets: ["manual review"],
			},
		],
		moduleConnections: [
			{
				fromModule: "core",
				toModule: "core",
				reason: "self",
				dataShared: ["drafts"],
			},
		],
	};
}
