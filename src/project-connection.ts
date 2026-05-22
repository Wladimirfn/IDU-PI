import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAllowedCwd } from "./config.js";
import { validateProjectBlueprint } from "./project-blueprint.js";
import { validateProjectFlows } from "./project-flows.js";
import type { ProjectEntry, ProjectRegistry } from "./projects.js";

export type ProjectConnectionStatus =
	| "connected"
	| "not_connected"
	| "broken_connection"
	| "unknown_project"
	| "needs_understanding"
	| "ready";

export type ProjectConfigConnectionStatus = {
	exists: boolean;
	source: "project-local" | "default";
	valid: boolean;
	path: string;
	errors: string[];
};

export type ProjectConnectionWorkspaceStatus = {
	workspaceRoot: string;
	reportsExists: boolean;
	labDbExists: boolean;
	labDbCanInitialize: boolean;
	tasksJsonlExists: boolean;
	tasksJsonlCanCreate: boolean;
};

export type ProjectConnectionReport = {
	status: ProjectConnectionStatus;
	projectId?: string;
	projectPath?: string;
	problems: string[];
	warnings: string[];
	recommendedNext: string;
	safeToOperate: boolean;
	needsUserConfirmation: boolean;
	inspectedAt: string;
	blueprint?: ProjectConfigConnectionStatus;
	flows?: ProjectConfigConnectionStatus;
	workspace?: ProjectConnectionWorkspaceStatus;
};

export type InspectProjectConnectionOptions = {
	registry: ProjectRegistry;
	defaultCwd: string;
	allowedRoots: string[];
	workspaceRoot: string;
	projectId?: string;
	now?: () => Date;
};

export function formatProjectConnectionReport(
	report: ProjectConnectionReport,
): string {
	return [
		statusMessage(report.status),
		"",
		"Proyecto:",
		report.projectId ?? "—",
		"",
		"Ruta:",
		report.projectPath ?? "—",
		"",
		"Estado:",
		report.status,
		"",
		"safeToOperate:",
		String(report.safeToOperate),
		"",
		"needsUserConfirmation:",
		String(report.needsUserConfirmation),
		"",
		"Comprensión:",
		understandingSummary(report),
		"",
		"Problemas:",
		formatList(report.problems),
		"",
		"Warnings:",
		formatList(report.warnings),
		"",
		"Siguiente recomendado:",
		report.recommendedNext,
	].join("\n");
}

function statusMessage(status: ProjectConnectionStatus): string {
	switch (status) {
		case "ready":
			return "Idu-pi conectado y listo para operar.";
		case "connected":
			return "Idu-pi conectado, pero falta comprensión/config completa.";
		case "needs_understanding":
			return "Idu-pi conectado, pero el proyecto necesita comprensión.";
		case "broken_connection":
			return "Idu-pi detectó conexión rota.";
		case "not_connected":
			return "Idu-pi no está conectado a ningún proyecto.";
		case "unknown_project":
			return "Proyecto no encontrado en memoria.";
	}
}

function understandingSummary(report: ProjectConnectionReport): string {
	if (
		report.blueprint?.source === "project-local" &&
		report.blueprint.valid &&
		report.flows?.source === "project-local" &&
		report.flows.valid
	) {
		return "- blueprint/flows project-local válidos";
	}
	if (!report.blueprint?.exists || !report.flows?.exists) {
		return "- falta blueprint/flows project-local";
	}
	if (report.blueprint && report.flows) {
		return "- blueprint/flows project-local incompletos o inválidos";
	}
	return "- no evaluada";
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}

export function inspectProjectConnection(
	options: InspectProjectConnectionOptions,
): ProjectConnectionReport {
	const inspectedAt = (options.now ?? (() => new Date()))().toISOString();
	const requestedProjectId = options.projectId?.trim();
	const project = resolveProject(options.registry, requestedProjectId);

	if (requestedProjectId && !project) {
		return baseReport({
			status: "unknown_project",
			projectId: requestedProjectId,
			inspectedAt,
			problems: [`Proyecto no encontrado: ${requestedProjectId}`],
			recommendedNext: "/useproject <id>",
		});
	}

	if (!project) {
		return baseReport({
			status: "not_connected",
			inspectedAt,
			problems: ["No hay proyecto activo conectado."],
			recommendedNext: "/addproject <id> <ruta>",
		});
	}

	const pathStatus = inspectProjectPath(project.path, options.allowedRoots);
	if (!pathStatus.exists || !pathStatus.allowed) {
		return baseReport({
			status: "broken_connection",
			projectId: project.id,
			projectPath: project.path,
			inspectedAt,
			problems: pathStatus.problems,
			recommendedNext: pathStatus.exists
				? "/useproject <id>"
				: "/addproject <id> <ruta>",
		});
	}

	const blueprint = inspectProjectConfigFile(
		project.path,
		"project-blueprint.json",
		validateProjectBlueprint,
	);
	const flows = inspectProjectConfigFile(
		project.path,
		"project-flows.json",
		validateProjectFlows,
	);
	const workspace = inspectWorkspace(options.workspaceRoot);
	const problems: string[] = [];
	const warnings: string[] = [];

	for (const config of [blueprint, flows]) {
		if (!config.exists) {
			problems.push(
				`Falta config/${config.path.endsWith("project-blueprint.json") ? "project-blueprint.json" : "project-flows.json"} project-local; se usaría default.`,
			);
		} else if (!config.valid) {
			problems.push(
				`${config.path} inválido: ${config.errors.join("; ") || "validación fallida"}`,
			);
		}
	}

	if (!workspace.reportsExists) {
		warnings.push(
			`No existe ${join(options.workspaceRoot, "reports")}; usá /config init_workspace para preparar reportes.`,
		);
	} else {
		if (!workspace.labDbExists) {
			warnings.push(
				"No existe lab.db todavía; puede inicializarse con /config db_init.",
			);
		}
		if (!workspace.tasksJsonlExists) {
			warnings.push(
				"No existe tasks.jsonl todavía; la cola estructurada puede crearlo cuando reciba tareas.",
			);
		}
	}

	if (!blueprint.exists || !flows.exists) {
		return {
			status: "needs_understanding",
			projectId: project.id,
			projectPath: project.path,
			problems,
			warnings,
			recommendedNext: "/config init_project_config",
			safeToOperate: false,
			needsUserConfirmation: true,
			inspectedAt,
			blueprint,
			flows,
			workspace,
		};
	}

	if (!blueprint.valid || !flows.valid) {
		return {
			status: "connected",
			projectId: project.id,
			projectPath: project.path,
			problems,
			warnings,
			recommendedNext: "/config inspect_project_map",
			safeToOperate: false,
			needsUserConfirmation: true,
			inspectedAt,
			blueprint,
			flows,
			workspace,
		};
	}

	return {
		status: "ready",
		projectId: project.id,
		projectPath: project.path,
		problems,
		warnings,
		recommendedNext: "listo para operar",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt,
		blueprint,
		flows,
		workspace,
	};
}

function resolveProject(
	registry: ProjectRegistry,
	projectId: string | undefined,
): ProjectEntry | undefined {
	if (projectId) {
		return registry.projects.find((project) => project.id === projectId);
	}
	if (!registry.activeProjectId) return undefined;
	return registry.projects.find(
		(project) => project.id === registry.activeProjectId,
	);
}

function baseReport(options: {
	status: ProjectConnectionStatus;
	inspectedAt: string;
	problems: string[];
	recommendedNext: string;
	projectId?: string;
	projectPath?: string;
}): ProjectConnectionReport {
	return {
		status: options.status,
		...(options.projectId ? { projectId: options.projectId } : {}),
		...(options.projectPath ? { projectPath: options.projectPath } : {}),
		problems: options.problems,
		warnings: [],
		recommendedNext: options.recommendedNext,
		safeToOperate: false,
		needsUserConfirmation: true,
		inspectedAt: options.inspectedAt,
	};
}

function inspectProjectPath(
	projectPath: string,
	allowedRoots: string[],
): { exists: boolean; allowed: boolean; problems: string[] } {
	const problems: string[] = [];
	let exists = false;
	try {
		exists = statSync(projectPath).isDirectory();
	} catch {
		exists = false;
	}
	if (!exists) {
		problems.push(
			`La ruta del proyecto no existe o no es un directorio: ${projectPath}`,
		);
		return { exists, allowed: false, problems };
	}
	const allowed = isAllowedCwd(projectPath, allowedRoots);
	if (!allowed)
		problems.push(`Proyecto fuera de ALLOWED_ROOTS: ${projectPath}`);
	return { exists, allowed, problems };
}

function inspectProjectConfigFile(
	projectPath: string,
	fileName: "project-blueprint.json" | "project-flows.json",
	validate: (value: unknown) => { ok: boolean; errors: string[] },
): ProjectConfigConnectionStatus {
	const path = join(projectPath, "config", fileName);
	if (!existsSync(path)) {
		return {
			exists: false,
			source: "default",
			valid: false,
			path,
			errors: [`config/${fileName} is missing`],
		};
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		const result = validate(parsed);
		return {
			exists: true,
			source: "project-local",
			valid: result.ok,
			path,
			errors: result.ok ? [] : result.errors,
		};
	} catch (error) {
		return {
			exists: true,
			source: "project-local",
			valid: false,
			path,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

function inspectWorkspace(
	workspaceRoot: string,
): ProjectConnectionWorkspaceStatus {
	const reportsPath = join(workspaceRoot, "reports");
	const reportsExists = directoryExists(reportsPath);
	const labDbExists = existsSync(join(reportsPath, "lab.db"));
	const tasksJsonlExists = existsSync(join(reportsPath, "tasks.jsonl"));
	return {
		workspaceRoot,
		reportsExists,
		labDbExists,
		labDbCanInitialize: reportsExists,
		tasksJsonlExists,
		tasksJsonlCanCreate: reportsExists,
	};
}

function directoryExists(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
