import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createDefaultProjectCore,
	formatProjectCoreForPrompt,
	loadProjectCore,
	summarizeProjectCore,
	validateProjectCore,
} from "../src/project-core.js";

async function withTempProject(
	fn: (projectPath: string) => void | Promise<void>,
): Promise<void> {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-core-project-"));
	try {
		await fn(projectPath);
	} finally {
		await rm(projectPath, { recursive: true, force: true });
	}
}

function validCore(overrides: Record<string, unknown> = {}) {
	return {
		version: "1.0.0",
		projectName: "Demo Project",
		projectGoal: "Help teams coordinate maintenance work.",
		problemStatement: "Work requests are scattered across channels.",
		targetUsers: ["planner", "technician"],
		projectType: "telegram-bot",
		complexityLevel: "medium",
		deploymentTarget: "server",
		securityLevel: "medium",
		dataSensitivity: "medium",
		preferredStack: ["TypeScript", "SQLite"],
		rejectedStack: ["spreadsheet-only"],
		architectureStyle: "modular services",
		includedScope: ["task intake", "review queue"],
		excludedScope: ["billing"],
		initialModules: ["task core", "project core"],
		criticalFlows: ["request -> preflight -> queue"],
		successCriteria: ["tasks are visible", "critical changes pause"],
		validationCommands: ["corepack pnpm build", "corepack pnpm test"],
		humanDecisions: ["critical changes require approval"],
		assumptions: ["single project active per session"],
		openQuestions: ["Which deployment target is final?"],
		status: "draft",
		createdAt: "2026-05-22T00:00:00.000Z",
		updatedAt: "2026-05-22T00:00:00.000Z",
		...overrides,
	};
}

test("loadProjectCore loads default core", async () => {
	await withTempProject((projectPath) => {
		const core = loadProjectCore(projectPath);

		assert.equal(core.projectName, "Proyecto sin definir");
		assert.equal(core.projectGoal, "Definir objetivo antes de construir");
		assert.equal(core.status, "draft");
		assert.ok(core.openQuestions.includes("¿Qué problema resuelve?"));
	});
});

test("loadProjectCore loads project-local core when present", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-core.json"),
			JSON.stringify(validCore({ projectName: "Custom Core" })),
		);

		const core = loadProjectCore(projectPath);

		assert.equal(core.projectName, "Custom Core");
		assert.equal(core.projectGoal, "Help teams coordinate maintenance work.");
	});
});

test("loadProjectCore fails clearly on invalid JSON", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(join(projectPath, "config", "project-core.json"), "{ nope");

		assert.throws(
			() => loadProjectCore(projectPath),
			/Invalid project core JSON/u,
		);
	});
});

test("validateProjectCore fails when projectGoal is missing", () => {
	const core = validCore();
	delete (core as { projectGoal?: string }).projectGoal;

	const result = validateProjectCore(core);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /projectGoal/u);
});

test("validateProjectCore fails when status is missing", () => {
	const core = validCore();
	delete (core as { status?: string }).status;

	const result = validateProjectCore(core);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /status/u);
});

test("validateProjectCore validates allowed status", () => {
	const result = validateProjectCore(validCore({ status: "archived" }));

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /status must be one of/u);
});

test("validateProjectCore validates allowed complexityLevel", () => {
	const result = validateProjectCore(validCore({ complexityLevel: "huge" }));

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /complexityLevel must be one of/u);
});

test("validateProjectCore validates allowed deploymentTarget", () => {
	const result = validateProjectCore(
		validCore({ deploymentTarget: "mainframe" }),
	);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /deploymentTarget must be one of/u);
});

test("validateProjectCore validates allowed securityLevel", () => {
	const result = validateProjectCore(validCore({ securityLevel: "extreme" }));

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /securityLevel must be one of/u);
});

test("validateProjectCore validates allowed dataSensitivity", () => {
	const result = validateProjectCore(validCore({ dataSensitivity: "secret" }));

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /dataSensitivity must be one of/u);
});

test("summarizeProjectCore shows goal, scope, and status", () => {
	const result = validateProjectCore(validCore());
	assert.equal(result.ok, true);

	const text = summarizeProjectCore(result.core);

	assert.match(text, /Objetivo: Help teams coordinate maintenance work/u);
	assert.match(text, /Alcance incluido: task intake \| review queue/u);
	assert.match(text, /Estado: draft/u);
});

test("formatProjectCoreForPrompt returns short useful summary", () => {
	const result = validateProjectCore(validCore());
	assert.equal(result.ok, true);

	const text = formatProjectCoreForPrompt(result.core);

	assert.match(text, /Project Core/u);
	assert.match(text, /Demo Project/u);
	assert.match(text, /Fuera de alcance: billing/u);
	assert.ok(text.length < 1500);
});

test("createDefaultProjectCore uses received projectName", () => {
	const core = createDefaultProjectCore("Nuevo Sistema");

	assert.equal(core.projectName, "Nuevo Sistema");
	assert.equal(core.status, "draft");
	assert.equal(core.projectGoal, "Definir objetivo antes de construir");
});

test("loadProjectCore does not write files", async () => {
	await withTempProject((projectPath) => {
		const localPath = join(projectPath, "config", "project-core.json");

		loadProjectCore(projectPath);

		assert.equal(existsSync(localPath), false);
	});
});
