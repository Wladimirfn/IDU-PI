import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ProjectRegistry } from "../src/projects.js";
import {
	formatProjectConnectionReport,
	inspectProjectConnection,
} from "../src/project-connection.js";
import { resolveProjectStatePaths } from "../src/project-state.js";

const tempRoots: string[] = [];

function tempDir(prefix = "idu-connection-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function registry(
	projectPath: string,
	activeProjectId = "demo",
): ProjectRegistry {
	return {
		activeProjectId,
		projects: [{ id: "demo", name: "Demo", path: projectPath }],
	};
}

function inspect(options: {
	registry: ProjectRegistry;
	allowedRoots?: string[];
	workspaceRoot?: string;
	stateRoot?: string;
	projectId?: string;
}) {
	const defaultCwd = tempDir("idu-default-");
	return inspectProjectConnection({
		defaultCwd,
		allowedRoots: options.allowedRoots ?? [defaultCwd],
		workspaceRoot: options.workspaceRoot ?? tempDir("idu-workspace-"),
		...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
		registry: options.registry,
		...(options.projectId ? { projectId: options.projectId } : {}),
	});
}

function writeProjectConfig(projectPath: string): void {
	// F-Item3a: project-flows.json lives at Layout A (`.idu/config/`)
	// per the territory model. project-blueprint.json still lives at
	// Layout B (`config/`) — that's the canonical location for that
	// file and `inspectProjectConfigFile` checks Layout B for it.
	mkdirSync(join(projectPath, "config"), { recursive: true });
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	cpSync(
		"config/default-blueprint.json",
		join(projectPath, "config", "project-blueprint.json"),
	);
	cpSync(
		"config/default-flows.json",
		join(projectPath, ".idu", "config", "project-flows.json"),
	);
}

test("not_connected if there are no projects", () => {
	const report = inspect({
		registry: { activeProjectId: null, projects: [] },
	});

	assert.equal(report.status, "not_connected");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.equal(report.recommendedNext, "/addproject <id> <ruta>");
});

test("unknown_project if requested projectId does not exist", () => {
	const projectPath = tempDir();
	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		projectId: "missing",
	});

	assert.equal(report.status, "unknown_project");
	assert.equal(report.projectId, "missing");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.recommendedNext, "/useproject <id>");
});

test("broken_connection if project path does not exist", () => {
	const root = tempDir();
	const missingPath = join(root, "missing");
	const report = inspect({
		registry: registry(missingPath),
		allowedRoots: [root],
	});

	assert.equal(report.status, "broken_connection");
	assert.match(report.problems.join("\n"), /ruta.*no existe/i);
	assert.equal(report.recommendedNext, "/addproject <id> <ruta>");
});

test("broken_connection if project path is outside allowed roots", () => {
	const allowedRoot = tempDir("idu-allowed-");
	const outsideRoot = tempDir("idu-outside-");
	const report = inspect({
		registry: registry(outsideRoot),
		allowedRoots: [allowedRoot],
	});

	assert.equal(report.status, "broken_connection");
	assert.match(report.problems.join("\n"), /fuera de ALLOWED_ROOTS/);
	assert.equal(report.recommendedNext, "/useproject <id>");
});

test("needs_understanding if project-local configs are missing", () => {
	const projectPath = tempDir();
	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
	});

	assert.equal(report.status, "needs_understanding");
	assert.equal(report.configStatus, "missing");
	assert.equal(report.alignmentStatus, "unknown");
	assert.equal(report.readiness, "not_ready");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.match(report.problems.join("\n"), /project-blueprint/);
	assert.match(report.problems.join("\n"), /project-flows/);
	assert.equal(report.recommendedNext, "/config init_project_config");
});

test("ready if local blueprint and flows are valid", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	// stateRoot = workspaceRoot/projects/demo (canonical path per project-state.ts)
	mkdirSync(join(workspaceRoot, "projects", "demo"), { recursive: true });
	writeProjectConfig(projectPath);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
		// Slice 5: legacy no-op — these tests predate the path!=stateRoot refactor.
		// stateRoot == projectPath is the explicit "behavior unchanged" case.
		stateRoot: projectPath,
	});

	assert.equal(report.status, "ready");
	assert.equal(report.configStatus, "project_local_valid");
	assert.equal(report.alignmentStatus, "pending_scan");
	assert.equal(report.readiness, "config_ready");
	assert.equal(report.safeToOperate, true);
	assert.equal(report.needsUserConfirmation, false);
	assert.equal(report.recommendedNext, "/idu_prepare");
});

test("ready uses matching prepare alignment state", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	mkdirSync(join(workspaceRoot, "projects", "demo"), { recursive: true });
	writeProjectConfig(projectPath);

	const defaultCwd = tempDir("idu-default-");
	const report = inspectProjectConnection({
		defaultCwd,
		allowedRoots: [projectPath],
		workspaceRoot,
		// Slice 5: legacy no-op — see "ready if local blueprint and flows are valid".
		stateRoot: projectPath,
		registry: registry(projectPath),
		alignmentState: {
			version: 1,
			projectId: "demo",
			projectPath,
			alignmentStatus: "aligned",
			readiness: "aligned_ready",
			alignmentReason: ["último prepare alineado"],
			recordedAt: "2026-06-05T00:00:00.000Z",
		},
	});

	assert.equal(report.status, "ready");
	assert.equal(report.alignmentStatus, "aligned");
	assert.equal(report.readiness, "aligned_ready");
	assert.deepEqual(report.alignmentReason, ["último prepare alineado"]);
	assert.equal(report.recommendedNext, "continuar bajo riesgo");
	assert.match(
		formatProjectConnectionReport(report),
		/Idu-pi conectado con configuración válida; alineación verificada\./u,
	);
});

test("ready with non-aligned prepare state keeps safe next action", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	mkdirSync(join(workspaceRoot, "projects", "demo"), { recursive: true });
	writeProjectConfig(projectPath);

	const defaultCwd = tempDir("idu-default-");
	const report = inspectProjectConnection({
		defaultCwd,
		allowedRoots: [projectPath],
		workspaceRoot,
		// Slice 5: legacy no-op — see "ready if local blueprint and flows are valid".
		stateRoot: projectPath,
		registry: registry(projectPath),
		alignmentState: {
			version: 1,
			projectId: "demo",
			projectPath,
			alignmentStatus: "needs_review",
			readiness: "config_ready",
			alignmentReason: ["último prepare detectó diferencias"],
			recordedAt: "2026-06-05T00:00:00.000Z",
		},
	});

	assert.equal(report.status, "ready");
	assert.equal(report.alignmentStatus, "needs_review");
	assert.equal(report.recommendedNext, "/config review_project_flows_draft");
	assert.equal(report.needsUserConfirmation, true);
});

test("warnings if project state directory does not exist", () => {
	// Slice 5: the inspector reads config from stateRoot AND checks whether
	// the stateRoot directory exists. When stateRoot is missing, both the
	// config read AND the workspace check fail simultaneously — there is no
	// longer a scenario where config is present but the state dir is missing,
	// because they are now coupled to the same path. The init_workspace
	// warning therefore fires together with needs_understanding status.
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	// No writeProjectConfig — stateRoot (= workspaceRoot/projects/demo) will
	// not exist, so both the config read and the workspace check fail.

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(report.status, "needs_understanding");
	assert.match(report.warnings.join("\n"), /init_workspace/);
});

test("connected if local configs exist but are invalid", () => {
	const projectPath = tempDir();
	mkdirSync(join(projectPath, "config"), { recursive: true });
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	writeFileSync(join(projectPath, "config", "project-blueprint.json"), "{}\n");
	writeFileSync(join(projectPath, ".idu", "config", "project-flows.json"), "{}\n");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		// Slice 5: legacy no-op — see "ready if local blueprint and flows are valid".
		stateRoot: projectPath,
	});

	assert.equal(report.status, "connected");
	assert.equal(report.configStatus, "invalid");
	assert.equal(report.alignmentStatus, "unknown");
	assert.equal(report.readiness, "not_ready");
	assert.equal(report.safeToOperate, false);
	assert.equal(report.needsUserConfirmation, true);
	assert.equal(report.recommendedNext, "/config inspect_project_map");
});

test("formatProjectConnectionReport shows ready", () => {
	const text = formatProjectConnectionReport({
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["no existe scan reciente"],
		projectId: "demo",
		projectPath: "C:\\demo",
		problems: [],
		warnings: [],
		recommendedNext: "/idu_prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-21T00:00:00.000Z",
		blueprint: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "C:\\demo\\config\\project-blueprint.json",
			errors: [],
		},
		flows: {
			exists: true,
			source: "project-local",
			valid: true,
			path: "C:\\demo\\config\\project-flows.json",
			errors: [],
		},
	});

	assert.match(
		text,
		/Idu-pi conectado con configuración válida; alineación pendiente\./,
	);
	assert.match(text, /Proyecto:\ndemo/);
	assert.match(text, /Estado:\nready/);
	assert.match(text, /configStatus:\nproject_local_valid/);
	assert.match(text, /alignmentStatus:\npending_scan/);
	assert.match(text, /readiness:\nconfig_ready/);
	assert.match(text, /safeToOperate:\ntrue/);
	assert.match(text, /needsUserConfirmation:\nfalse/);
	assert.match(text, /blueprint\/flows project-local válidos/);
	assert.match(text, /Siguiente recomendado:\n\/idu_prepare/);
});

test("formatProjectConnectionReport shows needs_understanding", () => {
	const text = formatProjectConnectionReport({
		status: "needs_understanding",
		configStatus: "missing",
		alignmentStatus: "unknown",
		readiness: "not_ready",
		alignmentReason: ["faltan blueprint/flows project-local"],
		projectId: "demo",
		projectPath: "C:\\demo",
		problems: [
			"Falta .idu/config/project-flows.json project-local; se usaría default.",
		],
		warnings: [],
		recommendedNext: "/config init_project_config",
		safeToOperate: false,
		needsUserConfirmation: true,
		inspectedAt: "2026-05-21T00:00:00.000Z",
	});

	assert.match(
		text,
		/Idu-pi conectado, pero el proyecto necesita comprensión\./,
	);
	assert.match(text, /Problemas:\n- Falta \.idu\/config\/project-flows\.json/);
	assert.match(text, /Siguiente recomendado:\n\/config init_project_config/);
});

test("formatProjectConnectionReport shows broken_connection", () => {
	const text = formatProjectConnectionReport({
		status: "broken_connection",
		configStatus: "missing",
		alignmentStatus: "unknown",
		readiness: "not_ready",
		alignmentReason: ["conexión de proyecto no disponible"],
		projectId: "demo",
		projectPath: "C:\\missing",
		problems: [
			"La ruta del proyecto no existe o no es un directorio: C:\\missing",
		],
		warnings: ["Revisá el registro de proyectos."],
		recommendedNext: "/addproject <id> <ruta>",
		safeToOperate: false,
		needsUserConfirmation: true,
		inspectedAt: "2026-05-21T00:00:00.000Z",
	});

	assert.match(text, /Idu-pi detectó conexión rota\./);
	assert.match(text, /Warnings:\n- Revisá el registro de proyectos\./);
	assert.match(text, /Siguiente recomendado:\n\/addproject <id> <ruta>/);
});

test("inspectProjectConnection does not write files", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	rmSync(workspaceRoot, { recursive: true, force: true });

	inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(existsSync(workspaceRoot), false);
	assert.equal(existsSync(join(projectPath, "config")), false);
});

// A1-T: canonical stateRoot path tests (Spec A2-S1, A2-S2, A2-S3)

test("A2-S1: labDbExists true when stateRoot/lab.db exists (not reports/lab.db)", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	writeProjectConfig(projectPath);

	// Set up ONLY the canonical stateRoot path — no legacy reports/ directory
	const statePaths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "demo",
		projectPath,
	});
	mkdirSync(statePaths.stateRoot, { recursive: true });
	writeFileSync(statePaths.labDbPath, "");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(
		report.workspace?.labDbExists,
		true,
		"labDbExists should be true when stateRoot/lab.db exists",
	);
});

test("A2-S1 inverse: labDbExists false when only reports/lab.db exists (path bug check)", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	writeProjectConfig(projectPath);

	// Create only the legacy/buggy reports/ path — canonical path does NOT exist
	mkdirSync(join(workspaceRoot, "reports"), { recursive: true });
	writeFileSync(join(workspaceRoot, "reports", "lab.db"), "");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	// The buggy behavior reports true here because it checks workspaceRoot/reports/lab.db.
	// After the fix, this must be false (stateRoot/lab.db does not exist).
	assert.equal(
		report.workspace?.labDbExists,
		false,
		"labDbExists must be false when only the legacy reports/ path exists, not the canonical stateRoot path",
	);
});

test("A2-S3: needsUserConfirmation not set to true solely from path bug when canonical lab.db exists", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	// Slice 5: inspector now reads from stateRoot. Mirror writeProjectConfig at
	// the canonical stateRoot so the config read succeeds.
	writeProjectConfig(projectPath);
	const statePaths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "demo",
		projectPath,
	});
	writeProjectConfig(statePaths.stateRoot);

	// Canonical lab.db exists; no legacy reports/ directory
	mkdirSync(statePaths.stateRoot, { recursive: true });
	writeFileSync(statePaths.labDbPath, "");
	writeFileSync(statePaths.taskQueuePath, "");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(
		report.needsUserConfirmation,
		false,
		"needsUserConfirmation must not be true when canonical lab.db exists",
	);
	assert.equal(
		report.warnings.filter((w) => /lab\.db/i.test(w)).length,
		0,
		"no lab.db warning should appear when canonical lab.db exists",
	);
});

test("A2-S2: tasksJsonlExists true at canonical stateRoot/tasks.jsonl (not reports/tasks.jsonl)", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	writeProjectConfig(projectPath);

	const statePaths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "demo",
		projectPath,
	});
	mkdirSync(statePaths.stateRoot, { recursive: true });
	writeFileSync(statePaths.taskQueuePath, "");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(
		report.workspace?.tasksJsonlExists,
		true,
		"tasksJsonlExists should be true when stateRoot/tasks.jsonl exists",
	);
});

test("PR-0: enrolled project inspection uses explicit stateRoot without double nesting", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-global-workspace-");
	const enrolledStateRoot = join(workspaceRoot, "projects", "demo");
	writeProjectConfig(projectPath);
	mkdirSync(enrolledStateRoot, { recursive: true });
	writeFileSync(join(enrolledStateRoot, "lab.db"), "");
	writeFileSync(join(enrolledStateRoot, "tasks.jsonl"), "");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot: enrolledStateRoot,
		stateRoot: enrolledStateRoot,
	});

	assert.equal(report.workspace?.labDbExists, true);
	assert.equal(report.workspace?.tasksJsonlExists, true);
	assert.equal(
		report.workspace?.reportsExists,
		true,
		"state directory should be the enrolled stateRoot itself, not stateRoot/projects/demo",
	);
	assert.equal(
		report.warnings.some((warning) =>
			warning.includes(join(enrolledStateRoot, "projects", "demo")),
		),
		false,
		"inspection must not warn about a double-nested stateRoot/projects/demo path",
	);
});

// F-Blueprint-Inspector-Drift regression guards.
// Pre-fix these tests are RED: the inspector hardcoded Layout B for
// blueprint and Layout A for flows, so a file in the other layout was
// reported as missing even though the loader would have found it.

test("inspector finds project-blueprint.json in Layout A (.idu/config) — pre-fix RED", () => {
	const projectPath = tempDir();
	// Only Layout A — no file in config/
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	writeFileSync(
		join(projectPath, ".idu", "config", "project-blueprint.json"),
		"{}",
		"utf8",
	);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		// Slice 5: legacy no-op — see "ready if local blueprint and flows are valid".
		stateRoot: projectPath,
	});

	assert.equal(
		report.blueprint?.exists,
		true,
		"inspector must find blueprint in Layout A — pre-fix this was false (drift)",
	);
	assert.equal(report.blueprint?.source, "project-local");
	assert.equal(report.blueprint?.valid, false);
	assert.match(
		report.blueprint?.path ?? "",
		/\.idu[\\/]+config[\\/]+project-blueprint\.json$/,
	);
});

test("inspector finds project-flows.json in Layout B (config) — pre-fix RED", () => {
	const projectPath = tempDir();
	// Only Layout B — no file in .idu/config/
	mkdirSync(join(projectPath, "config"), { recursive: true });
	writeFileSync(
		join(projectPath, "config", "project-flows.json"),
		"{}",
		"utf8",
	);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		// Slice 5: legacy no-op — see "ready if local blueprint and flows are valid".
		stateRoot: projectPath,
	});

	assert.equal(
		report.flows?.exists,
		true,
		"inspector must find flows in Layout B — pre-fix this was false (drift)",
	);
	assert.equal(report.flows?.source, "project-local");
	assert.equal(report.flows?.valid, false);
	assert.match(
		report.flows?.path ?? "",
		/[\\/]config[\\/]+project-flows\.json$/,
	);
});

test("inspector does NOT migrate files between Layout A and Layout B", () => {
	const projectPath = tempDir();
	// Blueprint in Layout A only — verify inspector reads it
	// without moving it.
	mkdirSync(join(projectPath, ".idu", "config"), { recursive: true });
	const blueprintPathA = join(
		projectPath,
		".idu",
		"config",
		"project-blueprint.json",
	);
	writeFileSync(blueprintPathA, "{}", "utf8");

	inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
	});

	assert.ok(
		existsSync(blueprintPathA),
		"blueprint must remain in Layout A after inspect — inspector must not migrate",
	);
	assert.equal(
		existsSync(join(projectPath, "config", "project-blueprint.json")),
		false,
		"inspector must not create a Layout B copy of blueprint",
	);
});

// =========================================================================
// Slice 5 hermetic guard — path!=stateRoot inspector refactor.
//
// Goal: prove `inspectProjectConnection` reads blueprint/flows from
// stateRoot, NOT from project.path. The recursive self-test
// `idu-pi-sobre-si-mismo` is the canonical case where path !== stateRoot.
//
// Hermeticity lesson (#900-class): NEVER reference the real
// `bridge-agents/projects/idu-pi` stateRoot. Every temp directory comes
// from `mkdtempSync(join(tmpdir(), "..."))` and is rmSync'd in after()
// (the existing teardown already handles it via the tempRoots array).
// =========================================================================

test("Slice 5: inspectProjectConnection reads config from stateRoot, not project.path", () => {
	// project.path and stateRoot are TWO DIFFERENT temp directories.
	// Config lives ONLY under stateRoot — must be found there.
	const projectPath = tempDir("idu-slice5-project-");
	const stateRoot = tempDir("idu-slice5-state-");
	const workspaceRoot = tempDir("idu-slice5-workspace-");
	const defaultCwd = tempDir("idu-slice5-default-");

	// Write the project-local config ONLY under stateRoot/.idu/config/
	// (Layout A — the canonical post-refactor location).
	mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
	cpSync(
		"config/default-blueprint.json",
		join(stateRoot, ".idu", "config", "project-blueprint.json"),
	);
	cpSync(
		"config/default-flows.json",
		join(stateRoot, ".idu", "config", "project-flows.json"),
	);

	const report = inspectProjectConnection({
		registry: registry(projectPath),
		allowedRoots: [projectPath, stateRoot],
		workspaceRoot,
		stateRoot, // <-- explicit override so reads go to the actual temp stateRoot
		defaultCwd,
	});

	// configStatus MUST be project_local_valid — proves config was found AND valid.
	assert.equal(report.configStatus, "project_local_valid", [
		`expected configStatus=project_local_valid, got ${report.configStatus}`,
		`blueprint: ${JSON.stringify(report.blueprint)}`,
		`flows: ${JSON.stringify(report.flows)}`,
	].join("\n"));

	// safeToOperate true — the recursive self-test payoff signal.
	assert.equal(report.safeToOperate, true, [
		`expected safeToOperate=true, got ${report.safeToOperate}`,
		`status=${report.status}, problems=${report.problems.join("; ")}`,
	].join("\n"));

	// Both reads must report exists=true, source=project-local, valid=true.
	assert.equal(report.blueprint?.exists, true);
	assert.equal(report.blueprint?.source, "project-local");
	assert.equal(report.blueprint?.valid, true);
	assert.equal(report.flows?.exists, true);
	assert.equal(report.flows?.source, "project-local");
	assert.equal(report.flows?.valid, true);

	// Crucially, the resolved paths must be UNDER stateRoot, NOT under project.path.
	assert.ok(
		report.blueprint?.path.startsWith(stateRoot),
		`blueprint path must be under stateRoot; got ${report.blueprint?.path}`,
	);
	assert.ok(
		report.flows?.path.startsWith(stateRoot),
		`flows path must be under stateRoot; got ${report.flows?.path}`,
	);
	assert.ok(
		!report.blueprint?.path.startsWith(projectPath),
		`blueprint path must NOT be under project.path; got ${report.blueprint?.path}`,
	);
	assert.ok(
		!report.flows?.path.startsWith(projectPath),
		`flows path must NOT be under project.path; got ${report.flows?.path}`,
	);
});

test("Slice 5 negative control: config only at project.path is NOT seen (proves reads come from stateRoot)", () => {
	// The trap test. Under the OLD code (read from project.path), this would
	// silently pass with configStatus=project_local_valid. Under the NEW code
	// (read from stateRoot), this MUST report missing because stateRoot has
	// no config files. If the inspector accidentally still reads from
	// project.path, this test catches the regression.
	const projectPath = tempDir("idu-slice5-neg-project-");
	const stateRoot = tempDir("idu-slice5-neg-state-");
	const workspaceRoot = tempDir("idu-slice5-neg-workspace-");
	const defaultCwd = tempDir("idu-slice5-neg-default-");

	// Write the config ONLY at project.path — NOT at stateRoot.
	// This simulates the buggy pre-refactor world where the inspector read from path.
	writeProjectConfig(projectPath);

	const report = inspectProjectConnection({
		registry: registry(projectPath),
		allowedRoots: [projectPath, stateRoot],
		workspaceRoot,
		stateRoot, // <-- explicit override; stateRoot is empty so reads must fail
		defaultCwd,
	});

	// configStatus MUST be missing — the inspector did not find config at stateRoot.
	assert.equal(
		report.configStatus,
		"missing",
		[
			`expected configStatus=missing (proves read goes through stateRoot), got ${report.configStatus}`,
			`blueprint: ${JSON.stringify(report.blueprint)}`,
			`flows: ${JSON.stringify(report.flows)}`,
		].join("\n"),
	);

	// safeToOperate false — the recursion guard caught the misconfiguration.
	assert.equal(report.safeToOperate, false);
	assert.equal(report.status, "needs_understanding");

	// blueprint/flows must each report exists=false (no config at stateRoot).
	assert.equal(report.blueprint?.exists, false);
	assert.equal(report.flows?.exists, false);
});

test("Slice 5 no-op: when project.path === stateRoot, valid config still yields project_local_valid", () => {
	// Legacy case (repo IS the stateRoot) MUST still report valid.
	// Both stateRoot and projectPath point at the SAME temp dir.
	const sharedRoot = tempDir("idu-slice5-noop-");
	const workspaceRoot = tempDir("idu-slice5-noop-workspace-");
	const defaultCwd = tempDir("idu-slice5-noop-default-");

	writeProjectConfig(sharedRoot);

	const report = inspectProjectConnection({
		registry: registry(sharedRoot),
		allowedRoots: [sharedRoot],
		workspaceRoot,
		stateRoot: sharedRoot, // <-- simulate legacy "workspaceRoot equals stateRoot" caller
		defaultCwd,
	});

	assert.equal(report.configStatus, "project_local_valid");
	assert.equal(report.safeToOperate, true);
	assert.equal(report.blueprint?.exists, true);
	assert.equal(report.flows?.exists, true);
});
