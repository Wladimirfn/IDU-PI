import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatBlueprintForPrompt,
	loadProjectBlueprint,
	validateProjectBlueprint,
} from "../src/project-blueprint.js";

async function withTempProject(
	fn: (projectPath: string) => void | Promise<void>,
): Promise<void> {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-blueprint-project-"));
	try {
		await fn(projectPath);
	} finally {
		await rm(projectPath, { recursive: true, force: true });
	}
}

function validBlueprint(overrides: Record<string, unknown> = {}) {
	return {
		projectName: "Local Project",
		projectGoal: "Coordinate AI agents safely.",
		projectType: "orchestrator",
		version: "1.0.0",
		agentHierarchy: ["Humano", "Orquestador", "AgentLabs"],
		architectureRules: ["JSONL remains primary"],
		forbiddenActions: ["Labs cannot commit", "Labs cannot push"],
		qualityRules: ["Every proposal needs evidence"],
		requiredValidation: ["corepack pnpm build", "corepack pnpm test"],
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
		...overrides,
	};
}

test("loadProjectBlueprint loads default blueprint", async () => {
	await withTempProject((projectPath) => {
		const blueprint = loadProjectBlueprint(projectPath);

		assert.equal(blueprint.projectName, "Idu-pi");
		assert.match(
			blueprint.projectGoal,
			/supervisor\/orquestador privado vía Telegram/u,
		);
		assert.ok(
			blueprint.forbiddenActions.includes("Labs no pueden hacer commit."),
		);
	});
});

test("loadProjectBlueprint loads project-local blueprint when present", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-blueprint.json"),
			JSON.stringify(validBlueprint({ projectName: "Custom Project" })),
		);

		const blueprint = loadProjectBlueprint(projectPath);

		assert.equal(blueprint.projectName, "Custom Project");
		assert.equal(blueprint.projectGoal, "Coordinate AI agents safely.");
	});
});

test("loadProjectBlueprint fails clearly on invalid JSON", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-blueprint.json"),
			"{ invalid json",
		);

		assert.throws(
			() => loadProjectBlueprint(projectPath),
			/Invalid project blueprint JSON/u,
		);
	});
});

test("validateProjectBlueprint fails when projectGoal is missing", () => {
	const blueprint = validBlueprint();
	delete (blueprint as { projectGoal?: string }).projectGoal;

	const result = validateProjectBlueprint(blueprint);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /projectGoal/u);
});

test("formatBlueprintForPrompt returns short useful text", () => {
	const result = validateProjectBlueprint(validBlueprint());
	assert.equal(result.ok, true);

	const text = formatBlueprintForPrompt(result.blueprint);

	assert.match(text, /Local Project/u);
	assert.match(text, /Coordinate AI agents safely/u);
	assert.match(text, /Labs cannot commit/u);
	assert.ok(text.length < 1200);
});

test("loadProjectBlueprint does not write files", async () => {
	await withTempProject((projectPath) => {
		const localPath = join(projectPath, "config", "project-blueprint.json");

		loadProjectBlueprint(projectPath);

		assert.equal(existsSync(localPath), false);
	});
});
