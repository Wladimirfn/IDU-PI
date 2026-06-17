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
	formatAiProjectDraftReview,
	reviewAiProjectBlueprintDraft,
	reviewAiProjectFlowsDraft,
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

test("reviewAiProjectBlueprintDraft reviews a valid draft", async () => {
	const { projectPath, reportsDir } = tempProject();
	const draft = await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		generate: async () =>
			JSON.stringify({
				...validBlueprint("current"),
				projectGoal: "New goal",
				qualityRules: ["tests pass", "review manually"],
			}),
	});
	assert.equal(draft.ok, true);

	const review = reviewAiProjectBlueprintDraft(
		draft.path,
		projectPath,
		reportsDir,
	);

	assert.equal(review.validDraft, true);
	assert.equal(review.validJson, true);
	assert.equal(review.validBlueprint, true);
	assert.ok(review.differentFields.includes("projectGoal"));
	assert.ok(review.differentFields.includes("qualityRules"));
	assert.deepEqual(review.missingFields, []);
	assert.match(formatAiProjectDraftReview(review), /campos distintos/u);
});

test("reviewAiProjectFlowsDraft reviews a valid draft", async () => {
	const { projectPath, reportsDir } = tempProject();
	const proposed = validFlows();
	proposed.modules[0] = {
		...proposed.modules[0],
		id: "new-core",
		name: "New Core",
		screens: ["new-home"],
		dataStores: ["new-files"],
		connectedModules: ["new-core"],
	};
	proposed.screens[0] = {
		...proposed.screens[0],
		id: "new-home",
		module: "new-core",
		uiElements: ["new-save"],
	};
	proposed.uiElements[0] = { ...proposed.uiElements[0], id: "new-save" };
	proposed.dataStores[0] = {
		...proposed.dataStores[0],
		id: "new-files",
		ownerModule: "new-core",
	};
	proposed.flows[0] = {
		...proposed.flows[0],
		id: "new-save-flow",
		module: "new-core",
	};
	proposed.moduleConnections[0] = {
		...proposed.moduleConnections[0],
		fromModule: "new-core",
		toModule: "new-core",
	};
	const draft = await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		generate: async () => JSON.stringify(proposed),
	});
	assert.equal(draft.ok, true);

	const review = reviewAiProjectFlowsDraft(draft.path, projectPath, reportsDir);

	assert.equal(review.validDraft, true);
	assert.equal(review.validJson, true);
	assert.equal(review.validFlows, true);
	assert.deepEqual(review.suggestedModules, ["new-core"]);
	assert.deepEqual(review.suggestedScreens, ["new-home"]);
	assert.deepEqual(review.suggestedUiElements, ["new-save"]);
	assert.deepEqual(review.suggestedDataStores, ["new-files"]);
	assert.deepEqual(review.suggestedFlows, ["new-save-flow"]);
	assert.deepEqual(review.idConflicts, []);
});

test("review AI latest works for blueprint and flows", async () => {
	const { projectPath, reportsDir } = tempProject();
	await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T10:00:00Z"),
		generate: async () => JSON.stringify(validBlueprint("old")),
	});
	await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T11:00:00Z"),
		generate: async () =>
			JSON.stringify({ ...validBlueprint("current"), projectType: "new-type" }),
	});
	await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T10:00:00Z"),
		generate: async () => JSON.stringify(validFlows()),
	});
	const nextFlows = validFlows();
	nextFlows.flows[0] = { ...nextFlows.flows[0], id: "latest-flow" };
	await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		now: () => new Date("2026-05-20T11:00:00Z"),
		generate: async () => JSON.stringify(nextFlows),
	});

	const blueprint = reviewAiProjectBlueprintDraft(
		"latest",
		projectPath,
		reportsDir,
	);
	const flows = reviewAiProjectFlowsDraft("latest", projectPath, reportsDir);

	assert.ok(
		blueprint.path.endsWith("project-blueprint-ai-draft-20260520-110000.json"),
	);
	assert.ok(flows.path.endsWith("project-flows-ai-draft-20260520-110000.json"));
	assert.ok(blueprint.differentFields.includes("projectType"));
	assert.ok(flows.suggestedFlows.includes("latest-flow"));
});

test("review AI latest without drafts does not throw", () => {
	const { projectPath, reportsDir } = tempProject();

	const blueprint = reviewAiProjectBlueprintDraft(
		"latest",
		projectPath,
		reportsDir,
	);
	const flows = reviewAiProjectFlowsDraft("latest", projectPath, reportsDir);

	assert.equal(blueprint.validDraft, false);
	assert.match(blueprint.errors.join("\n"), /No encontré borrador IA/u);
	assert.equal(flows.validDraft, false);
	assert.match(flows.errors.join("\n"), /No encontré borrador IA/u);
});

test("review reports invalid warning and rawOutput without throwing", async () => {
	const { projectPath, reportsDir } = tempProject();
	const rawDraft = await createAiProjectBlueprintDraft({
		projectPath,
		reportsDir,
		generate: async () => "not json",
	});
	assert.equal(rawDraft.ok, true);
	const badWarningPath = join(
		reportsDir,
		"project-blueprint-ai-draft-20260520-120000.json",
	);
	writeFileSync(
		badWarningPath,
		JSON.stringify({
			warning: "otro",
			validJson: true,
			proposal: validBlueprint("x"),
		}),
		"utf8",
	);

	const rawReview = reviewAiProjectBlueprintDraft(
		rawDraft.path,
		projectPath,
		reportsDir,
	);
	const warningReview = reviewAiProjectBlueprintDraft(
		badWarningPath,
		projectPath,
		reportsDir,
	);

	assert.equal(rawReview.validJson, false);
	assert.equal(rawReview.hasRawOutput, true);
	assert.match(rawReview.risks.join("\n"), /rawOutput/u);
	assert.equal(warningReview.hasRequiredWarning, false);
	assert.match(warningReview.risks.join("\n"), /warning/u);
});

test("reviewAiProjectFlowsDraft detects ID conflicts and does not write config", async () => {
	const { projectPath, reportsDir } = tempProject();
	const beforeBlueprint = readFileSync(
		join(projectPath, "config", "project-blueprint.json"),
		"utf8",
	);
	const beforeFlows = readFileSync(
		join(projectPath, "config", "project-flows.json"),
		"utf8",
	);
	const draft = await createAiProjectFlowsDraft({
		projectPath,
		reportsDir,
		generate: async () => JSON.stringify(validFlows()),
	});
	assert.equal(draft.ok, true);

	const review = reviewAiProjectFlowsDraft(draft.path, projectPath, reportsDir);

	assert.ok(review.idConflicts.includes("module:core"));
	assert.ok(review.idConflicts.includes("screen:home"));
	assert.ok(review.possibleDuplicates.length > 0);
	// Territory model: reviewAiProjectFlowsDraft only reads project-flows
	// (via loadProjectFlows), so blueprint stays in legacy until a reader
	// for it triggers the migration. The flows file moves to .idu/.
	assert.equal(
		readFileSync(join(projectPath, "config", "project-blueprint.json"), "utf8"),
		beforeBlueprint,
	);
	assert.equal(
		readFileSync(
			join(projectPath, ".idu", "config", "project-flows.json"),
			"utf8",
		),
		beforeFlows,
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
