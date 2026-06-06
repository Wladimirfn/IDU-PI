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
	projectId?: string;
}) {
	const defaultCwd = tempDir("idu-default-");
	return inspectProjectConnection({
		defaultCwd,
		allowedRoots: options.allowedRoots ?? [defaultCwd],
		workspaceRoot: options.workspaceRoot ?? tempDir("idu-workspace-"),
		registry: options.registry,
		...(options.projectId ? { projectId: options.projectId } : {}),
	});
}

function writeProjectConfig(projectPath: string): void {
	mkdirSync(join(projectPath, "config"), { recursive: true });
	cpSync(
		"config/default-blueprint.json",
		join(projectPath, "config", "project-blueprint.json"),
	);
	cpSync(
		"config/default-flows.json",
		join(projectPath, "config", "project-flows.json"),
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
	mkdirSync(join(workspaceRoot, "reports"), { recursive: true });
	writeProjectConfig(projectPath);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
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
	mkdirSync(join(workspaceRoot, "reports"), { recursive: true });
	writeProjectConfig(projectPath);

	const defaultCwd = tempDir("idu-default-");
	const report = inspectProjectConnection({
		defaultCwd,
		allowedRoots: [projectPath],
		workspaceRoot,
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
	mkdirSync(join(workspaceRoot, "reports"), { recursive: true });
	writeProjectConfig(projectPath);

	const defaultCwd = tempDir("idu-default-");
	const report = inspectProjectConnection({
		defaultCwd,
		allowedRoots: [projectPath],
		workspaceRoot,
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

test("warnings if reports directory does not exist", () => {
	const projectPath = tempDir();
	const workspaceRoot = tempDir("idu-workspace-");
	writeProjectConfig(projectPath);

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
		workspaceRoot,
	});

	assert.equal(report.status, "ready");
	assert.match(report.warnings.join("\n"), /reports/);
	assert.equal(report.safeToOperate, true);
});

test("connected if local configs exist but are invalid", () => {
	const projectPath = tempDir();
	mkdirSync(join(projectPath, "config"), { recursive: true });
	writeFileSync(join(projectPath, "config", "project-blueprint.json"), "{}\n");
	writeFileSync(join(projectPath, "config", "project-flows.json"), "{}\n");

	const report = inspect({
		registry: registry(projectPath),
		allowedRoots: [projectPath],
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
			"Falta config/project-flows.json project-local; se usaría default.",
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
	assert.match(text, /Problemas:\n- Falta config\/project-flows\.json/);
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
