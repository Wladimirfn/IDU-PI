import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatConfigDoctor,
	formatConfigOverview,
	formatInitAssetsResult,
	formatInitProjectConfigResult,
	formatInitWorkspaceResult,
	formatProjectMapInspection,
	formatSkillsSyncResult,
	initProjectAssets,
	initProjectBlueprint,
	initProjectConfig,
	initProjectFlows,
	initWorkspaceRoot,
	NECESSARY_PROJECT_SKILLS,
	inspectProjectConfig,
	inspectProjectMap,
	syncNecessarySkills,
} from "../src/config-wizard.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-config-"));
	tempRoots.push(dir);
	return dir;
}

function tempStateRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-config-state-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("inspectProjectConfig reports missing project-local assets", () => {
	const projectPath = tempDir();
	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot: projectPath,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot: join(projectPath, ".workspaces"),
		piArgs: ["--no-skill-registry", "--no-lens"],
		isGitRepo: false,
	});

	assert.equal(report.assets.skills.exists, false);
	assert.equal(report.assets.registry.exists, false);
	assert.equal(report.assets.mcp.exists, false);
	assert.equal(report.recommendedNext, "/config init_workspace");
	assert.ok(
		report.warnings.some((warning) => warning.includes("No hay perfiles lab")),
	);
});

test("inspectProjectConfig reports existing project-local assets and workspace state", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	initProjectAssets(projectPath, stateRoot);
	initWorkspaceRoot(workspaceRoot);

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "codex", label: "Codex", provider: "pi", piArgs: [] },
		],
		activeProfileId: "codex",
		workspaceMode: "clone",
		workspaceRoot,
		piArgs: [],
		isGitRepo: true,
	});

	assert.equal(report.assets.skills.exists, true);
	assert.equal(report.assets.registry.exists, true);
	assert.equal(report.assets.mcp.exists, true);
	assert.equal(report.workspace.root.exists, true);
	assert.equal(report.workspace.reports.exists, true);
	assert.equal(report.workspace.workspaces.exists, true);
	assert.equal(report.labAgentCount, 1);
	assert.equal(report.recommendedNext, "/config init_project_config");
});

test("initProjectAssets creates missing assets without overwriting existing files", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const existingRegistry = join(projectPath, ".atl", "skill-registry.md");
	const existingMcp = join(projectPath, ".mcp", "config.json");
	initProjectAssets(projectPath, stateRoot);
	writeFileSync(existingRegistry, "# custom registry\n", "utf8");
	writeFileSync(existingMcp, '{"enabled":true}\n', "utf8");

	const result = initProjectAssets(projectPath, stateRoot);

	assert.equal(readFileSync(existingRegistry, "utf8"), "# custom registry\n");
	assert.equal(readFileSync(existingMcp, "utf8"), '{"enabled":true}\n');
	assert.ok(result.existing.includes(".atl/skill-registry.md"));
	assert.ok(result.existing.includes(".mcp/config.json"));
	assert.equal(
		existsSync(join(projectPath, ".idu", "skills", ".gitkeep")),
		true,
	);
	assert.equal(existsSync(join(projectPath, ".mcp", "config.json")), true);
});

test("initProjectBlueprint creates config and blueprint when missing", () => {
	const projectPath = join(tempDir(), "demo-project");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	const result = initProjectBlueprint(projectPath, stateRoot, "active-demo");
	const blueprintPath = join(stateRoot, ".idu", "config", "project-blueprint.json");
	const blueprint = JSON.parse(readFileSync(blueprintPath, "utf8")) as {
		projectName: string;
	};

	assert.equal(existsSync(join(stateRoot, ".idu", "config")), true);
	assert.ok(result.created.includes(".idu/config/project-blueprint.json"));
	assert.equal(blueprint.projectName, "active-demo");
});

test("initProjectBlueprint does not overwrite existing blueprint", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const blueprintPath = join(stateRoot, ".idu", "config", "project-blueprint.json");
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(blueprintPath, '{"projectName":"custom"}\n', "utf8");

	const result = initProjectBlueprint(projectPath, stateRoot, "ignored");

	assert.equal(
		readFileSync(blueprintPath, "utf8"),
		'{"projectName":"custom"}\n',
	);
	assert.ok(result.existing.includes(".idu/config/project-blueprint.json"));
});

test("initProjectBlueprint writes only under stateRoot (split-brain guard)", () => {
	// Slice 2/5 split-brain guard: when stateRoot !== projectPath, the writer
	// must land the file under stateRoot and NOT touch projectPath.
	const projectPath = join(tempDir(), "demo-project");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	initProjectBlueprint(projectPath, stateRoot, "split-brain-demo");

	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-blueprint.json")),
		true,
		"blueprint must exist under stateRoot",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist under projectPath",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist under projectPath legacy layout",
	);
});

test("initProjectFlows creates flows when missing", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();

	const result = initProjectFlows(projectPath, stateRoot);
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		projectType: string;
	};

	assert.ok(result.created.includes(".idu/config/project-flows.json"));
	assert.equal(flows.projectType, "real-project-functional-map");
});

// MANDATORY TEST #1 (Slice 4/5): Split-brain write guard for initProjectFlows.
// When projectPath !== stateRoot, the flows writer must land at stateRoot
// and NOT touch projectPath. Mirrors the Slice 2 initProjectBlueprint guard
// (test/config-wizard.test.ts:165) and the Slice 3 initProjectCore guard.
test("initProjectFlows writes only under stateRoot (split-brain guard)", () => {
	const projectPath = join(tempDir(), "demo-project");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	initProjectFlows(projectPath, stateRoot);

	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-flows.json")),
		true,
		"flows must exist under stateRoot",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-flows.json")),
		false,
		"flows must NOT exist under projectPath (Slice 4 move)",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
		"flows must NOT exist under projectPath legacy layout",
	);
});

test("initProjectFlows does not overwrite existing flows", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(flowsPath, '{"projectType":"custom"}\n', "utf8");

	const result = initProjectFlows(projectPath, stateRoot);

	assert.equal(readFileSync(flowsPath, "utf8"), '{"projectType":"custom"}\n');
	assert.ok(result.existing.includes(".idu/config/project-flows.json"));
});

test("initProjectConfig creates both project config files", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();

	const result = initProjectConfig(projectPath, stateRoot, "demo-id");

	assert.ok(result.created.includes(".idu/config/project-blueprint.json"));
	assert.ok(result.created.includes(".idu/config/project-flows.json"));
	assert.match(formatInitProjectConfigResult(result), /init_project_config/);
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-blueprint.json")),
		true,
	);
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-flows.json")),
		true,
	);
});

test("initProjectConfig infers safe projectName from folder", () => {
	const projectPath = join(tempDir(), "folder-project");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	initProjectConfig(projectPath, stateRoot);
	const blueprint = JSON.parse(
		readFileSync(join(stateRoot, ".idu", "config", "project-blueprint.json"), "utf8"),
	) as { projectName: string };

	assert.equal(blueprint.projectName, "folder-project");
});

test("initProjectConfig writes only under stateRoot (split-brain guard)", () => {
	// Slice 4/5 split-brain guard: when stateRoot !== projectPath, the writer
	// must land BOTH blueprint AND flows under stateRoot and NOT touch
	// projectPath. After Slice 4, both files follow the same ROOT rule.
	const projectPath = join(tempDir(), "demo-project");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	initProjectConfig(projectPath, stateRoot, "split-brain-config-demo");

	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-blueprint.json")),
		true,
		"blueprint must exist under stateRoot",
	);
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-flows.json")),
		true,
		"flows must exist under stateRoot (Slice 4 move)",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist under projectPath",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-flows.json")),
		false,
		"flows must NOT exist under projectPath (Slice 4 move)",
	);
});

// MANDATORY TEST #4 (Slice 4/5 Commit B): Heuristic collapse. After the
// Slice 4 collapse, BOTH blueprint AND flows writes (via initProjectConfig)
// must hit stateRoot/.idu/config/ when projectPath !== stateRoot. This
// verifies the simplified createProjectConfigFileIfMissing does not
// accidentally re-introduce the conditional or regress one of the two
// paths. Mirrors the existing split-brain guard at config-wizard.test.ts:250
// but explicitly checks both files together post-collapse.
test("initProjectConfig writes both blueprint and flows under stateRoot (heuristic collapse)", () => {
	const projectPath = join(tempDir(), "demo-collapse");
	mkdirSync(projectPath, { recursive: true });
	const stateRoot = tempStateRoot();

	initProjectConfig(projectPath, stateRoot, "collapse-demo");

	// Both must land under stateRoot/.idu/config/ (Layout A).
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-blueprint.json")),
		true,
		"blueprint must land under stateRoot (post-collapse)",
	);
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-flows.json")),
		true,
		"flows must land under stateRoot (post-collapse)",
	);
	// Neither may land under projectPath — that would be a regression
	// of the Slice 4 heuristic collapse.
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
		false,
		"blueprint must NOT leak to projectPath (post-collapse)",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-flows.json")),
		false,
		"flows must NOT leak to projectPath (post-collapse)",
	);
	// Negative Layout B — both files must NOT exist in the legacy layout.
	assert.equal(
		existsSync(join(projectPath, "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist in projectPath legacy Layout B",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-flows.json")),
		false,
		"flows must NOT exist in projectPath legacy Layout B",
	);
});

test("inspectProjectConfig reports missing project config and recommends init", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	initProjectAssets(projectPath, stateRoot);
	initWorkspaceRoot(workspaceRoot);

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "codex", label: "Codex", provider: "pi", piArgs: [] },
		],
		activeProfileId: "codex",
		workspaceMode: "clone",
		workspaceRoot,
		piArgs: [],
		isGitRepo: true,
	});

	assert.equal(report.projectConfig.blueprint.exists, false);
	assert.equal(report.projectConfig.flows.exists, false);
	assert.equal(report.projectConfig.blueprint.source, "default");
	assert.equal(report.projectConfig.flows.source, "default");
	assert.equal(report.recommendedNext, "/config init_project_config");
	assert.match(formatConfigOverview(report), /project-blueprint\.json.*falta/s);
	assert.match(formatConfigOverview(report), /project-flows\.json.*falta/s);
});

test("inspectProjectConfig reports valid local project config", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	initProjectAssets(projectPath, stateRoot);
	initProjectConfig(projectPath, stateRoot, "demo");
	initWorkspaceRoot(workspaceRoot);

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "codex", label: "Codex", provider: "pi", piArgs: [] },
		],
		activeProfileId: "codex",
		workspaceMode: "clone",
		workspaceRoot,
		piArgs: [],
		isGitRepo: true,
	});

	assert.equal(report.projectConfig.blueprint.exists, true);
	assert.equal(report.projectConfig.flows.exists, true);
	assert.equal(report.projectConfig.blueprint.valid, true);
	assert.equal(report.projectConfig.flows.valid, true);
	assert.equal(report.projectConfig.blueprint.source, "project-local");
	assert.equal(report.projectConfig.flows.source, "project-local");
	assert.match(
		formatConfigDoctor(report),
		/project-blueprint\.json: existe, project-local, válido/s,
	);
	assert.match(
		formatConfigDoctor(report),
		/project-flows\.json: existe, project-local, válido/s,
	);
});

test("inspectProjectConfig reports invalid project config without throwing", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	initProjectAssets(projectPath, stateRoot);
	initWorkspaceRoot(workspaceRoot);
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-blueprint.json"),
		"{ invalid",
		"utf8",
	);
	// Slice 4/5: flows now live under stateRoot alongside blueprint.
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(stateRoot, ".idu", "config", "project-flows.json"),
		"{}",
		"utf8",
	);

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "codex", label: "Codex", provider: "pi", piArgs: [] },
		],
		activeProfileId: "codex",
		workspaceMode: "clone",
		workspaceRoot,
		piArgs: [],
		isGitRepo: true,
	});

	assert.equal(report.projectConfig.blueprint.valid, false);
	assert.equal(report.projectConfig.flows.valid, false);
	assert.equal(
		report.recommendedNext,
		"Corregir config project-local inválida",
	);
	assert.match(
		formatConfigDoctor(report),
		/project-blueprint\.json.*inválido/s,
	);
	assert.match(formatConfigDoctor(report), /project-flows\.json.*inválido/s);
});

test("inspectProjectMap detects default map in use", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();

	const result = inspectProjectMap(projectPath, stateRoot, {
		activeProjectId: "sistema_de_mantencion",
		activeProjectName: "Sistema de Mantención",
	});
	const formatted = formatProjectMapInspection(result);

	assert.equal(result.source, "default");
	assert.ok(result.counts.modules > 0);
	assert.ok(
		result.recommendations.includes(
			"Usá /config init_project_config para crear config project-local editable.",
		),
	);
	assert.match(formatted, /Fuente del mapa:\n(?:.*\n)*usando defaults/u);
	assert.match(
		formatted,
		/Proyecto activo:\n(?:.*sistema_de_mantencion.*Sistema de Mantención|.*Sistema de Mantención.*sistema_de_mantencion)/u,
	);
	assert.ok(formatted.includes(`Ruta activa:\n${projectPath}`));
	assert.match(formatted, /Nombre declarado en blueprint:\nIdu-pi/u);
	assert.doesNotMatch(formatted, /Proyecto:\nIdu-pi/u);
});

test("inspectProjectMap detects valid project-local map", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.equal(result.source, "project-local");
	assert.equal(result.issues.length, 0);
	assert.ok(result.recommendations.includes("Mapa usable por AgentLabs."));
});

test("inspectProjectMap detects module without screens", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		modules: Array<{ screens: string[] }>;
	};
	flows.modules[0].screens = [];
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /módulo sin pantallas/u);
});

test("inspectProjectMap detects screen with missing module", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		screens: Array<{ module: string }>;
	};
	flows.screens[0].module = "missing-module";
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /pantalla.*missing-module/u);
});

test("inspectProjectMap detects flow with missing module", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		flows: Array<{ module: string }>;
	};
	flows.flows[0].module = "missing-module";
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /flow.*missing-module/u);
});

test("inspectProjectMap detects step without from or to", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		flows: Array<{ steps: Array<{ from?: string }> }>;
	};
	delete flows.flows[0].steps[0].from;
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /step sin from\/to/u);
});

test("inspectProjectMap detects dataStore without ownerModule", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		dataStores: Array<{ ownerModule?: string }>;
	};
	delete flows.dataStores[0].ownerModule;
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /dataStore.*ownerModule/u);
});

test("inspectProjectMap detects invalid moduleConnection", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		moduleConnections: Array<{ toModule: string }>;
	};
	flows.moduleConnections[0].toModule = "missing-module";
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /moduleConnection.*missing-module/u);
});

test("inspectProjectMap detects uiElement without selector or label", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "demo");
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		uiElements: Array<{ selector?: string; label?: string }>;
	};
	delete flows.uiElements[0].selector;
	delete flows.uiElements[0].label;
	writeFileSync(flowsPath, JSON.stringify(flows), "utf8");

	const result = inspectProjectMap(projectPath, stateRoot);

	assert.match(result.issues.join("\n"), /uiElement.*selector.*label/u);
});

test("inspectProjectMap does not write files", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();

	inspectProjectMap(projectPath, stateRoot);

	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
		false,
	);
	assert.equal(
		existsSync(join(stateRoot, ".idu", "config", "project-flows.json")),
		false,
	);
});

test("initWorkspaceRoot creates reports and workspaces directories", () => {
	const workspaceRoot = join(tempDir(), "bridge-agents");

	const result = initWorkspaceRoot(workspaceRoot);

	assert.equal(existsSync(join(workspaceRoot, "reports")), true);
	assert.equal(existsSync(join(workspaceRoot, "workspaces")), true);
	assert.ok(result.created.includes("reports"));
	assert.match(formatInitWorkspaceResult(result), /Workspace root/);
});

test("syncNecessarySkills copies only necessary skills and writes a simple index", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const sourceSkillsDir = join(tempDir(), "source-skills");
	for (const skill of NECESSARY_PROJECT_SKILLS) {
		const skillDir = join(sourceSkillsDir, skill);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}\n`, "utf8");
	}
	mkdirSync(join(sourceSkillsDir, "rcm-flujos-operativos"), {
		recursive: true,
	});
	writeFileSync(
		join(sourceSkillsDir, "rcm-flujos-operativos", "SKILL.md"),
		"# domain\n",
		"utf8",
	);

	const result = syncNecessarySkills(sourceSkillsDir, projectPath, stateRoot);

	assert.deepEqual(result.missing, []);
	assert.equal(result.copied.length, NECESSARY_PROJECT_SKILLS.length);
	assert.equal(
		existsSync(
			join(projectPath, ".idu", "skills", "bug-hunter", "SKILL.md"),
		),
		true,
	);
	// Verify the orchestrator-facing communication skill is part of
	// the deploy set (R5 follow-up: without parent-protocol, the
	// orchestrator does not know how to call idu-pi consistently).
	assert.equal(
		existsSync(
			join(
				projectPath,
				".idu",
				"skills",
				"idu-pi-parent-protocol",
				"SKILL.md",
			),
		),
		true,
		"idu-pi-parent-protocol must be part of NECESSARY_PROJECT_SKILLS",
	);
	assert.equal(
		existsSync(join(projectPath, ".idu", "skills", "rcm-flujos-operativos")),
		false,
	);
	assert.match(
		readFileSync(join(projectPath, ".idu", "skills", "INDEX.md"), "utf8"),
		/bug-hunter/,
	);
	assert.match(formatSkillsSyncResult(result), /Skills sincronizadas/);
});

test("formatConfigOverview and formatConfigDoctor hide secrets and show next steps", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot: join(projectPath, ".workspaces"),
		piArgs: ["--no-skill-registry"],
		isGitRepo: false,
	});

	assert.match(
		formatConfigOverview(report),
		/Siguiente recomendado:\n\/config init_workspace/,
	);
	assert.match(formatConfigDoctor(report), /Project-local assets/);
	assert.doesNotMatch(
		formatConfigDoctor(report),
		/TELEGRAM_BOT_TOKEN|replace_me|token/,
	);
	assert.match(
		formatInitAssetsResult(initProjectAssets(projectPath, stateRoot)),
		/Assets/,
	);
});

test("inspectProjectMap resolves blueprint under stateRoot, not projectPath (dynamic path)", () => {
	// Slice 2/5 dynamic-path guard for config-wizard.ts:563 — the
	// `usesLocalBlueprint` flag (and the loader call) must follow stateRoot
	// even when stateRoot is a different directory than projectPath.
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "dynamic-path-demo");

	// inspectProjectMap reading from stateRoot: source must be project-local.
	const resultFromStateRoot = inspectProjectMap(projectPath, stateRoot);
	assert.equal(resultFromStateRoot.source, "project-local");

	// inspectProjectMap reading from projectPath as both projectPath and
	// stateRoot (mirroring the legacy shape, where stateRoot defaulted to
	// projectPath): no blueprint exists there, so source is default — proves
	// the resolver follows stateRoot, not projectPath.
	const resultFromProjectPath = inspectProjectMap(projectPath, projectPath);
	assert.equal(resultFromProjectPath.source, "default");
});

// MANDATORY TEST #3 (Slice 4/5): inspectProjectMap usesLocalFlows + flows
// branch must follow stateRoot, not projectPath. Mirrors the Slice 2
// dynamic-path guard at config-wizard.test.ts:682.
test("inspectProjectMap resolves flows under stateRoot, not projectPath (dynamic path)", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	initProjectConfig(projectPath, stateRoot, "flows-dynamic-path-demo");

	// Flow file written under stateRoot only. inspectProjectMap must see
	// it and report project-local — not silently fall back to projectPath.
	const resultFromStateRoot = inspectProjectMap(projectPath, stateRoot);
	assert.equal(resultFromStateRoot.source, "project-local");

	// Mirror with projectPath as both: projectPath is empty here (init
	// wrote to stateRoot), so source must be default — proves flows
	// reads follow stateRoot, not projectPath.
	const resultFromProjectPath = inspectProjectMap(projectPath, projectPath);
	assert.equal(resultFromProjectPath.source, "default");
});

// Issue #172 split-brain guard: config-wizard.ts:321 used to do
// `const stateRoot = options.stateRoot ?? options.projectPath`, which would
// silently feed projectPath into projectConfigStatus when stateRoot was
// undefined — reverting Slice 2's blueprint move. The fix made stateRoot
// REQUIRED on InspectProjectConfigOptions and removed the `??` fallback.
// This test proves the inspector follows stateRoot for blueprint status.

test("inspectProjectConfig resolves blueprint status from stateRoot, not projectPath (path != stateRoot)", () => {
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	mkdirSync(workspaceRoot, { recursive: true });

	// Seed a valid blueprint ONLY in stateRoot. projectPath is empty.
	initProjectConfig(projectPath, stateRoot, "blueprint-state-root-only");

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot,
		piArgs: ["--no-skill-registry", "--no-lens"],
		isGitRepo: false,
	});

	// blueprint.status must reflect stateRoot (project-local, valid).
	assert.equal(report.projectConfig.blueprint.exists, true);
	assert.equal(report.projectConfig.blueprint.valid, true);
	assert.equal(report.projectConfig.blueprint.source, "project-local");

	// Negative: there must be no blueprint under projectPath Layout A or B.
	assert.equal(
		existsSync(join(projectPath, ".idu", "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist under projectPath Layout A",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-blueprint.json")),
		false,
		"blueprint must NOT exist under projectPath Layout B",
	);
});

test("inspectProjectConfig returns default blueprint when stateRoot has none (path != stateRoot)", () => {
	// Same setup but with NEITHER stateRoot nor projectPath holding a blueprint.
	// The inspector must report default, NOT silently read from projectPath.
	const projectPath = tempDir();
	const stateRoot = tempStateRoot();
	const workspaceRoot = join(projectPath, ".workspaces");
	mkdirSync(workspaceRoot, { recursive: true });

	const report = inspectProjectConfig({
		projectId: "demo",
		projectPath,
		stateRoot,
		allowedRoots: [projectPath],
		agentProfiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
		],
		activeProfileId: "default",
		workspaceMode: "direct",
		workspaceRoot,
		piArgs: ["--no-skill-registry", "--no-lens"],
		isGitRepo: false,
	});

	assert.equal(report.projectConfig.blueprint.exists, false);
	assert.equal(report.projectConfig.blueprint.source, "default");
	assert.equal(report.projectConfig.blueprint.valid, true);
});

// MANDATORY TEST #5 (Slice 4/5): No-op when path === stateRoot.
// Pre-Slice-4 invariant: when stateRoot === projectPath, all reads/writes
// behave identically to the pre-refactor world (loads from where writes
// land). After Slice 4, this invariant must still hold — the only path
// resolution is by ROOT (stateRoot), and writes/reads both use it.
test("initProjectFlows behaves identically when path === stateRoot (no-op)", () => {
	const projectPath = tempDir();
	const stateRoot = projectPath;

	const result = initProjectFlows(projectPath, stateRoot);
	const flowsPath = join(stateRoot, ".idu", "config", "project-flows.json");
	const flows = JSON.parse(readFileSync(flowsPath, "utf8")) as {
		projectType: string;
	};

	assert.ok(result.created.includes(".idu/config/project-flows.json"));
	assert.equal(flows.projectType, "real-project-functional-map");
	// Layout B fallback path must NOT exist — Slice 4 uses Layout A only.
	assert.equal(existsSync(join(stateRoot, "config", "project-flows.json")), false);
});
