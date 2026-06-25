import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	corePath,
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

async function withTempProjectAndStateRoot(
	fn: (projectPath: string, stateRoot: string) => void | Promise<void>,
): Promise<void> {
	// Slice 3/5: projectPath and stateRoot are distinct temp dirs so we can
	// assert that the loader resolves under stateRoot, not projectPath.
	const projectPath = mkdtempSync(join(tmpdir(), "idu-core-project-"));
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-core-stateroot-"));
	try {
		await fn(projectPath, stateRoot);
	} finally {
		await rm(projectPath, { recursive: true, force: true });
		await rm(stateRoot, { recursive: true, force: true });
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

test("loadProjectCore reads from stateRoot, not projectPath (path != stateRoot)", async () => {
	// Slice 3/5 split-brain guard: core must resolve under stateRoot even
	// when stateRoot is a different directory than projectPath.
	await withTempProjectAndStateRoot((projectPath, stateRoot) => {
		// Core lives ONLY in stateRoot/.idu/config/.
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-core.json"),
			JSON.stringify(validCore({ projectName: "StateRoot Core" })),
		);

		const core = loadProjectCore(stateRoot);

		assert.equal(core.projectName, "StateRoot Core");
		// Guard: loader must not have consulted projectPath at all.
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-core.json")),
			false,
			"loader must not consult Layout A in projectPath",
		);
		assert.equal(
			existsSync(join(projectPath, "config", "project-core.json")),
			false,
			"loader must not consult Layout B in projectPath",
		);
	});
});

test("corePath helper returns stateRoot/.idu/config/project-core.json", async () => {
	await withTempProjectAndStateRoot((projectPath, stateRoot) => {
		// Sanity: corePath(stateRoot) is the writer target (Layout A).
		assert.equal(
			corePath(stateRoot),
			join(stateRoot, ".idu", "config", "project-core.json"),
		);
		// corePath(projectPath) is what the old code resolved — we keep the
		// helper available for legacy callers but Slice 3 writers use stateRoot.
		assert.equal(
			corePath(projectPath),
			join(projectPath, ".idu", "config", "project-core.json"),
		);
	});
});

// Slice 3/5 split-brain tests — each writer must land at
// stateRoot/.idu/config/project-core.json and NOT at projectPath.

test("idu-bootstrap inline writes core only under stateRoot (split-brain)", async () => {
	// The bootstrap inline writer is the entry point of initial core
	// creation. If it stays on projectPath, the first idu-bootstrap
	// post-Slice-3 creates core where the loader does NOT read.
	await withTempProjectAndStateRoot(async (projectPath, stateRoot) => {
		const { runIduBootstrap } = await import("../src/idu-bootstrap.js");
		const config: import("../src/config.js").BridgeConfig = {
			telegramBotToken: "test-token",
			allowedUserId: 1,
			defaultCwd: projectPath,
			allowedRoots: [projectPath],
			agentWorkspaceRoot: stateRoot,
			piBin: "pi",
			piArgs: [],
			agentProfiles: [
				{ id: "default", label: "Default", provider: "pi", piArgs: [] },
			],
			agentWorkspaceMode: "clone",
			iduGovernance: {
				mcpAuthorityMode: "advisory",
				agentLabMode: "audit_only",
				workspaceOwner: "orchestrator",
				autoRefreshLabProfiles: true,
			},
		};

		const registryPath = join(stateRoot, "projects.json");
		const result = runIduBootstrap({
			projectPath,
			config,
			registryPath,
			consentGiven: true,
		});

		// The writer must land under stateRoot.
		assert.equal(
			existsSync(
				join(result.statePaths.stateRoot, ".idu", "config", "project-core.json"),
			),
			true,
			"core must exist under stateRoot",
		);
		// And must NOT have written to projectPath's Layout A.
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-core.json")),
			false,
			"core must NOT exist under projectPath Layout A",
		);
		// The loader can find it via stateRoot.
		assert.equal(loadProjectCore(result.statePaths.stateRoot).status, "draft");
	});
});

test("writeProjectCore (confirmation) writes only under stateRoot (split-brain)", async () => {
	// writeProjectCore is module-private; exercise it via confirmProjectCore
	// (the only public surface that reaches it).
	await withTempProjectAndStateRoot(async (projectPath, stateRoot) => {
		const { confirmProjectCore } = await import(
			"../src/project-core-confirmation.js"
		);

// Seed a draft core under stateRoot (where the loader expects it).
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-core.json"),
			JSON.stringify(validCore({ status: "draft", openQuestions: [] })),
			"utf8",
		);
		const reportsDir = join(stateRoot, "reports");
		mkdirSync(reportsDir, { recursive: true });

		const result = confirmProjectCore({
			projectPath,
			stateRoot,
			reportsDir,
			now: () => new Date("2026-05-22T12:00:00.000Z"),
		});

		assert.equal(result.ok, true);
		// The confirmed core lives under stateRoot.
		assert.equal(
			existsSync(join(stateRoot, ".idu", "config", "project-core.json")),
			true,
			"confirmed core must exist under stateRoot",
		);
		// The writer must NOT have written to projectPath.
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-core.json")),
			false,
			"confirmed core must NOT exist under projectPath",
		);
		assert.equal(loadProjectCore(stateRoot).status, "confirmed");
	});
});

test("writeProjectCoreDraft (wizard) writes only under stateRoot (split-brain)", async () => {
	// writeProjectCoreDraft is module-private; exercise it via
	// startProjectCoreWizard + answerProjectCoreWizard (the only public
	// surface that reaches it after a complete wizard run).
	await withTempProjectAndStateRoot(async (projectPath, stateRoot) => {
		const {
			startProjectCoreWizard,
			answerProjectCoreWizard,
		} = await import("../src/project-core-wizard.js");

		const workspaceRoot = join(stateRoot, "ws");
		mkdirSync(workspaceRoot, { recursive: true });

		const options = {
			projectId: "demo",
			projectPath,
			stateRoot,
			workspaceRoot,
			projectName: "Demo",
			now: () => new Date("2026-05-22T10:00:00.000Z"),
		};
		const answers = [
			"Un sistema",
			"Problema X",
			"Usuarios Y",
			"medium",
			"server",
			"medium",
			"medium",
			"modulo a",
			"fuera X",
			"criterio 1",
		];
		startProjectCoreWizard(options);
		let result;
		for (const answer of answers) {
			result = answerProjectCoreWizard(options, answer);
		}

		assert.equal(result?.completed, true);
		// The draft must live under stateRoot.
		assert.equal(
			existsSync(join(stateRoot, ".idu", "config", "project-core.json")),
			true,
			"draft core must exist under stateRoot",
		);
		// The writer must NOT have written to projectPath.
		assert.equal(
			existsSync(join(projectPath, ".idu", "config", "project-core.json")),
			false,
			"draft core must NOT exist under projectPath",
		);
	});
});
