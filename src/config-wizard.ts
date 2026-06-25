import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile, AgentWorkspaceMode } from "./config.js";
import { isAllowedCwd } from "./config.js";
import { assertAllowedWrite } from "./idu-scratch.js";
import {
	loadProjectBlueprint,
	validateProjectBlueprint,
} from "./project-blueprint.js";
import { validateProjectFlows } from "./project-flows.js";

export type AssetStatus = {
	label: string;
	path: string;
	relativePath: string;
	exists: boolean;
};

export type ProjectConfigStatus = AssetStatus & {
	source: "project-local" | "default";
	valid: boolean;
	error?: string;
};

export type ConfigWizardReport = {
	projectId: string;
	projectPath: string;
	allowed: boolean;
	isGitRepo: boolean;
	workspaceMode: AgentWorkspaceMode;
	workspaceRoot: string;
	activeProfileId: string;
	agentProfiles: AgentProfile[];
	labAgentCount: number;
	piArgs: string[];
	assets: {
		skills: AssetStatus;
		registry: AssetStatus;
		mcp: AssetStatus;
	};
	projectConfig: {
		blueprint: ProjectConfigStatus;
		flows: ProjectConfigStatus;
	};
	workspace: {
		root: AssetStatus;
		reports: AssetStatus;
		workspaces: AssetStatus;
	};
	necessarySkills: {
		present: string[];
		missing: string[];
	};
	warnings: string[];
	recommendedNext: string;
};

export type InspectProjectConfigOptions = {
	projectId: string;
	projectPath: string;
	stateRoot?: string;
	allowedRoots: string[];
	agentProfiles: AgentProfile[];
	activeProfileId: string;
	workspaceMode: AgentWorkspaceMode;
	workspaceRoot: string;
	piArgs: string[];
	isGitRepo?: boolean;
};

export type InitAssetsResult = {
	projectPath: string;
	created: string[];
	existing: string[];
};

export type InitProjectConfigResult = {
	projectPath: string;
	created: string[];
	existing: string[];
	projectName: string;
};

export type InitWorkspaceResult = {
	workspaceRoot: string;
	created: string[];
	existing: string[];
};

export type SkillsSyncResult = {
	projectPath: string;
	sourceSkillsDir: string;
	copied: string[];
	existing: string[];
	missing: string[];
	indexPath: string;
};

export type ProjectMapInspection = {
	projectPath: string;
	activeProjectId?: string;
	activeProjectName?: string;
	source: "project-local" | "default";
	projectName: string;
	counts: {
		modules: number;
		screens: number;
		uiElements: number;
		dataStores: number;
		flows: number;
		moduleConnections: number;
	};
	issues: string[];
	recommendations: string[];
};

type LooseProjectFlows = {
	modules: Array<{ id?: unknown; screens?: unknown }>;
	screens: Array<{ id?: unknown; module?: unknown }>;
	uiElements: Array<{ id?: unknown; selector?: unknown; label?: unknown }>;
	dataStores: Array<{ id?: unknown; ownerModule?: unknown }>;
	flows: Array<{ id?: unknown; module?: unknown; steps?: unknown }>;
	moduleConnections: Array<{ fromModule?: unknown; toModule?: unknown }>;
};

export const NECESSARY_PROJECT_SKILLS = [
	"bug-hunter",
	"codebase-audit-pre-push",
	"performance-optimizer",
	"skill-check",
	"technical-change-tracker",
	"jq",
] as const;

const SKILLS_DIR = ".idu/skills";
const SKILLS_KEEP = ".idu/skills/.gitkeep";
const SKILL_INDEX = ".idu/skills/INDEX.md";
const REGISTRY_FILE = ".atl/skill-registry.md";
const MCP_CONFIG = ".mcp/config.json";
const PROJECT_BLUEPRINT = ".idu/config/project-blueprint.json";
const PROJECT_FLOWS = ".idu/config/project-flows.json";
const DEFAULT_BLUEPRINT = "config/default-blueprint.json";
const DEFAULT_FLOWS = "config/default-flows.json";
const PACKAGE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

const REGISTRY_TEMPLATE = `# Project Skill Registry

Project-local skills available to Idu-pi agents.

| Skill | Trigger / description | Path |
| --- | --- | --- |
`;

const MCP_TEMPLATE = `{
  "enabled": false,
  "servers": {}
}
`;

function asset(
	projectPath: string,
	label: string,
	relativePath: string,
): AssetStatus {
	const path = join(projectPath, relativePath);
	return { label, path, relativePath, exists: existsSync(path) };
}

function detectGitRepo(projectPath: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: projectPath,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

function marker(ok: boolean): string {
	return ok ? "✅" : "❌";
}

function createFileIfMissing(
	projectPath: string,
	stateRoot: string,
	relativePath: string,
	content: string,
	result: InitAssetsResult,
): void {
	const path = join(projectPath, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		result.existing.push(relativePath);
		return;
	}
	// Territory enforcement: project-local files (skills, registry, MCP config)
	// are owned by the project; the registry and MCP config templates are
	// emitted as starting scaffolding only and are NOT idu-pi governance.
	if (relativePath.startsWith(".idu/")) {
		assertAllowedWrite(path, { stateRoot, repoRoot: projectPath });
	}
	writeFileSync(path, content, "utf8");
	result.created.push(relativePath);
}

function createProjectConfigFileIfMissing(
	projectPath: string,
	stateRoot: string,
	relativePath: string,
	content: () => string,
	result: InitProjectConfigResult,
): void {
	// Slice 2/5: blueprint lives under stateRoot; flows stays under projectPath
	// until Slice 4. Heuristic: project-blueprint.json -> stateRoot,
	// everything else -> projectPath. When stateRoot === projectPath both
	// branches collapse to the same path and behavior is preserved (no-op).
	const base = relativePath.endsWith("project-blueprint.json")
		? stateRoot
		: projectPath;
	const path = join(base, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		result.existing.push(relativePath);
		return;
	}
	// Territory: governance files always live under <stateRoot>/.idu/config/.
	assertAllowedWrite(path, { stateRoot, repoRoot: projectPath });
	writeFileSync(path, content(), "utf8");
	result.created.push(relativePath);
}

function ensureDirectory(
	root: string,
	relativePath: string,
	result: InitWorkspaceResult,
): void {
	const path = join(root, relativePath);
	if (existsSync(path)) {
		result.existing.push(relativePath);
		return;
	}
	mkdirSync(path, { recursive: true });
	result.created.push(relativePath);
}

function presentNecessarySkills(projectPath: string): string[] {
	return NECESSARY_PROJECT_SKILLS.filter((skill) =>
		existsSync(join(projectPath, SKILLS_DIR, skill, "SKILL.md")),
	);
}

function writeLocalSkillIndex(projectPath: string): string {
	const skillsRoot = join(projectPath, SKILLS_DIR);
	mkdirSync(skillsRoot, { recursive: true });
	const entries = existsSync(skillsRoot)
		? readdirSync(skillsRoot, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
				.sort()
		: [];
	const content = `# Project Skill Index\n\nRead this index first, then open only the matching SKILL.md.\n\n| Skill | Path |\n| --- | --- |\n${entries.map((name) => `| ${name} | .idu/skills/${name}/SKILL.md |`).join("\n")}\n`;
	const indexPath = join(projectPath, SKILL_INDEX);
	writeFileSync(indexPath, content, "utf8");
	return indexPath;
}

function safeRelative(projectPath: string, path: string): string {
	return relative(projectPath, path).replace(/\\/gu, "/");
}

function projectConfigStatus(
	projectPath: string,
	label: string,
	relativePath: string,
	validator: (value: unknown) => { ok: true } | { ok: false; errors: string[] },
): ProjectConfigStatus {
	const status = asset(projectPath, label, relativePath);
	if (!status.exists) {
		return { ...status, source: "default", valid: true };
	}
	try {
		const parsed = JSON.parse(readFileSync(status.path, "utf8")) as unknown;
		const validation = validator(parsed);
		return validation.ok
			? { ...status, source: "project-local", valid: true }
			: {
					...status,
					source: "project-local",
					valid: false,
					error: validation.errors.join("; "),
				};
	} catch (error) {
		return {
			...status,
			source: "project-local",
			valid: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function inspectProjectConfig(
	options: InspectProjectConfigOptions,
): ConfigWizardReport {
	const stateRoot = options.stateRoot ?? options.projectPath;
	const assets = {
		skills: asset(options.projectPath, "Skills", SKILLS_DIR),
		registry: asset(options.projectPath, "Skill registry", REGISTRY_FILE),
		mcp: asset(options.projectPath, "MCP config", MCP_CONFIG),
	};
	// Slice 2/5: blueprint now lives under stateRoot; flows stays under
	// projectPath until Slice 4 moves it.
	const projectConfig = {
		blueprint: projectConfigStatus(
			stateRoot,
			"Project blueprint",
			PROJECT_BLUEPRINT,
			validateProjectBlueprint,
		),
		flows: projectConfigStatus(
			options.projectPath,
			"Project flows",
			PROJECT_FLOWS,
			validateProjectFlows,
		),
	};
	const workspace = {
		root: asset(options.workspaceRoot, "Workspace root", "."),
		reports: asset(options.workspaceRoot, "Reports", "reports"),
		workspaces: asset(options.workspaceRoot, "Agent workspaces", "workspaces"),
	};
	const presentSkills = presentNecessarySkills(options.projectPath);
	const missingSkills = NECESSARY_PROJECT_SKILLS.filter(
		(skill) => !presentSkills.includes(skill),
	);
	const allowed = isAllowedCwd(options.projectPath, options.allowedRoots);
	const isGitRepo = options.isGitRepo ?? detectGitRepo(options.projectPath);
	const warnings: string[] = [];

	if (!allowed)
		warnings.push("El proyecto activo no está dentro de ALLOWED_ROOTS.");
	if (!isGitRepo)
		warnings.push("El proyecto activo no parece ser un repo Git.");
	if (options.workspaceMode !== "clone") {
		warnings.push(
			"AGENT_WORKSPACE_MODE no está en clone; los laboratorios no quedan aislados.",
		);
	}
	if (
		!workspace.root.exists ||
		!workspace.reports.exists ||
		!workspace.workspaces.exists
	) {
		warnings.push(
			"Falta inicializar AGENT_WORKSPACE_ROOT con reports/ y workspaces/.",
		);
	}
	if (missingSkills.length) {
		warnings.push(
			`Faltan skills project-local necesarias: ${missingSkills.join(", ")}.`,
		);
	}
	if (options.agentProfiles.length < 2) {
		warnings.push(
			"No hay perfiles lab configurados; solo existe el agente default/directo.",
		);
	}
	if (!projectConfig.blueprint.exists || !projectConfig.flows.exists) {
		warnings.push(
			"Falta config project-local; usá /config init_project_config.",
		);
	}
	if (!projectConfig.blueprint.valid || !projectConfig.flows.valid) {
		warnings.push(
			"Config project-local inválida; corregí JSON antes de continuar.",
		);
	}
	if (
		options.piArgs.some(
			(arg) => arg === "--no-skill-registry" || arg === "--no-lens",
		)
	) {
		warnings.push(
			"PI_EXTRA_ARGS desactiva skill registry/lens; verificá si esto contradice assets project-local.",
		);
	}

	const missingAsset =
		!assets.skills.exists || !assets.registry.exists || !assets.mcp.exists;
	const missingWorkspace =
		!workspace.root.exists ||
		!workspace.reports.exists ||
		!workspace.workspaces.exists;
	const missingProjectConfig =
		!projectConfig.blueprint.exists || !projectConfig.flows.exists;
	const invalidProjectConfig =
		!projectConfig.blueprint.valid || !projectConfig.flows.valid;
	const recommendedNext = missingWorkspace
		? "/config init_workspace"
		: missingAsset
			? "/config init_assets"
			: missingProjectConfig
				? "/config init_project_config"
				: invalidProjectConfig
					? "Corregir config project-local inválida"
					: missingSkills.length
						? "/config skills_sync"
						: "/config doctor";

	return {
		projectId: options.projectId,
		projectPath: options.projectPath,
		allowed,
		isGitRepo,
		workspaceMode: options.workspaceMode,
		workspaceRoot: options.workspaceRoot,
		activeProfileId: options.activeProfileId,
		agentProfiles: options.agentProfiles,
		labAgentCount: Math.max(0, options.agentProfiles.length - 1),
		piArgs: options.piArgs,
		assets,
		projectConfig,
		workspace,
		necessarySkills: {
			present: presentSkills,
			missing: missingSkills,
		},
		warnings,
		recommendedNext,
	};
}

export function initProjectAssets(
	projectPath: string,
	stateRoot: string,
): InitAssetsResult {
	const result: InitAssetsResult = { projectPath, created: [], existing: [] };
	const skillsDir = join(projectPath, SKILLS_DIR);
	assertAllowedWrite(skillsDir, { stateRoot, repoRoot: projectPath });
	mkdirSync(skillsDir, { recursive: true });
	createFileIfMissing(projectPath, stateRoot, SKILLS_KEEP, "", result);
	createFileIfMissing(
		projectPath,
		stateRoot,
		REGISTRY_FILE,
		REGISTRY_TEMPLATE,
		result,
	);
	createFileIfMissing(projectPath, stateRoot, MCP_CONFIG, MCP_TEMPLATE, result);
	return result;
}

export function initProjectBlueprint(
	projectPath: string,
	stateRoot: string,
	projectId?: string,
): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath, projectId);
	createProjectConfigFileIfMissing(
		projectPath,
		stateRoot,
		PROJECT_BLUEPRINT,
		() => blueprintContent(result.projectName),
		result,
	);
	return result;
}

export function initProjectFlows(
	projectPath: string,
	stateRoot: string,
): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath);
	createProjectConfigFileIfMissing(
		projectPath,
		stateRoot,
		PROJECT_FLOWS,
		flowsContent,
		result,
	);
	return result;
}

export function initProjectConfig(
	projectPath: string,
	stateRoot: string,
	projectId?: string,
): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath, projectId);
	createProjectConfigFileIfMissing(
		projectPath,
		stateRoot,
		PROJECT_BLUEPRINT,
		() => blueprintContent(result.projectName),
		result,
	);
	createProjectConfigFileIfMissing(
		projectPath,
		stateRoot,
		PROJECT_FLOWS,
		flowsContent,
		result,
	);
	return result;
}

function emptyProjectConfigResult(
	projectPath: string,
	projectId?: string,
): InitProjectConfigResult {
	return {
		projectPath,
		created: [],
		existing: [],
		projectName: safeProjectName(projectPath, projectId),
	};
}

function safeProjectName(projectPath: string, projectId?: string): string {
	const candidate = projectId?.trim() || basename(projectPath).trim();
	return candidate || "project";
}

function blueprintContent(projectName: string): string {
	const parsed = JSON.parse(
		readFileSync(join(PACKAGE_ROOT, DEFAULT_BLUEPRINT), "utf8"),
	) as unknown;
	const record =
		parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { ...(parsed as Record<string, unknown>), projectName }
			: parsed;
	const validation = validateProjectBlueprint(record);
	if (!validation.ok) {
		throw new Error(
			`Default project blueprint is invalid: ${validation.errors.join("; ")}`,
		);
	}
	return `${JSON.stringify(validation.blueprint, null, 2)}\n`;
}

function flowsContent(): string {
	const parsed = JSON.parse(
		readFileSync(join(PACKAGE_ROOT, DEFAULT_FLOWS), "utf8"),
	) as unknown;
	const validation = validateProjectFlows(parsed);
	if (!validation.ok) {
		throw new Error(
			`Default project flows are invalid: ${validation.errors.join("; ")}`,
		);
	}
	return `${JSON.stringify(validation.flows, null, 2)}\n`;
}

export function inspectProjectMap(
	projectPath: string,
	stateRootOrActiveProject?:
		| string
		| { activeProjectId?: string; activeProjectName?: string },
	activeProject?:
		| { activeProjectId?: string; activeProjectName?: string }
		| undefined,
): ProjectMapInspection {
	// Slice 2/5: blueprint now lives under stateRoot; flows stays under
	// projectPath until Slice 4. Back-compat: when the 2nd arg looks like
	// an activeProject object (legacy shape) we fall back to projectPath
	// as stateRoot — that preserves behavior for callers that haven't been
	// threaded yet, and keeps the path === stateRoot no-op for hermetic test
	// paths.
	const stateRoot =
		typeof stateRootOrActiveProject === "string"
			? stateRootOrActiveProject
			: projectPath;
	const resolvedActiveProject =
		typeof stateRootOrActiveProject === "string"
			? activeProject
			: stateRootOrActiveProject;
	const usesLocalBlueprint = existsSync(join(stateRoot, PROJECT_BLUEPRINT));
	const usesLocalFlows = existsSync(join(projectPath, PROJECT_FLOWS));
	const blueprint = loadProjectBlueprint(stateRoot);
	const flows = readLooseProjectFlows(projectPath, usesLocalFlows);
	const source =
		usesLocalBlueprint && usesLocalFlows ? "project-local" : "default";
	const issues = projectMapIssues(flows);
	const recommendations = projectMapRecommendations(source, flows, issues);
	return {
		projectPath,
		activeProjectId: resolvedActiveProject?.activeProjectId,
		activeProjectName: resolvedActiveProject?.activeProjectName,
		source,
		projectName: blueprint.projectName,
		counts: {
			modules: flows.modules.length,
			screens: flows.screens.length,
			uiElements: flows.uiElements.length,
			dataStores: flows.dataStores.length,
			flows: flows.flows.length,
			moduleConnections: flows.moduleConnections.length,
		},
		issues,
		recommendations,
	};
}

function readLooseProjectFlows(
	projectPath: string,
	usesLocalFlows: boolean,
): LooseProjectFlows {
	const path = usesLocalFlows
		? join(projectPath, PROJECT_FLOWS)
		: join(process.cwd(), DEFAULT_FLOWS);
	const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
		string,
		unknown
	>;
	return {
		modules: arrayValue(parsed.modules),
		screens: arrayValue(parsed.screens),
		uiElements: arrayValue(parsed.uiElements),
		dataStores: arrayValue(parsed.dataStores),
		flows: arrayValue(parsed.flows),
		moduleConnections: arrayValue(parsed.moduleConnections),
	};
}

function arrayValue(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function projectMapIssues(flows: LooseProjectFlows): string[] {
	const issues: string[] = [];
	const modules = new Set(
		flows.modules.map((module) => stringValue(module.id)),
	);
	for (const module of flows.modules) {
		const moduleId = stringValue(module.id);
		if (arrayLength(module.screens) === 0) {
			issues.push(`módulo sin pantallas: ${moduleId}`);
		}
	}
	for (const screen of flows.screens) {
		const screenModule = stringValue(screen.module);
		if (!modules.has(screenModule)) {
			issues.push(
				`pantalla ${stringValue(screen.id)} referencia módulo inexistente: ${screenModule}`,
			);
		}
	}
	for (const flow of flows.flows) {
		const flowId = stringValue(flow.id);
		const flowModule = stringValue(flow.module);
		if (!modules.has(flowModule)) {
			issues.push(
				`flow ${flowId} referencia módulo inexistente: ${flowModule}`,
			);
		}
		for (const step of arrayValue(flow.steps)) {
			if (!stringValue(step.from) || !stringValue(step.to)) {
				issues.push(`flow ${flowId} tiene step sin from/to`);
			}
		}
	}
	for (const store of flows.dataStores) {
		const ownerModule = stringValue(store.ownerModule);
		if (!ownerModule) {
			issues.push(`dataStore ${stringValue(store.id)} sin ownerModule`);
		} else if (!modules.has(ownerModule)) {
			issues.push(
				`dataStore ${stringValue(store.id)} referencia ownerModule inexistente: ${ownerModule}`,
			);
		}
	}
	for (const connection of flows.moduleConnections) {
		const fromModule = stringValue(connection.fromModule);
		const toModule = stringValue(connection.toModule);
		if (!modules.has(fromModule)) {
			issues.push(
				`moduleConnection referencia módulo inexistente: ${fromModule}`,
			);
		}
		if (!modules.has(toModule)) {
			issues.push(
				`moduleConnection referencia módulo inexistente: ${toModule}`,
			);
		}
	}
	for (const element of flows.uiElements) {
		if (!stringValue(element.selector) && !stringValue(element.label)) {
			issues.push(`uiElement ${stringValue(element.id)} sin selector ni label`);
		}
	}
	return issues;
}

function projectMapRecommendations(
	source: ProjectMapInspection["source"],
	flows: LooseProjectFlows,
	issues: string[],
): string[] {
	const recommendations: string[] = [];
	if (source === "default") {
		recommendations.push(
			"Usá /config init_project_config para crear config project-local editable.",
		);
	}
	if (flows.modules.length < 2 || flows.flows.length < 2) {
		recommendations.push(
			"El mapa parece incompleto: agregá módulos y flows reales del proyecto.",
		);
	}
	if (issues.length === 0) {
		recommendations.push("Mapa usable por AgentLabs.");
	}
	return recommendations;
}

export function initWorkspaceRoot(workspaceRoot: string): InitWorkspaceResult {
	const result: InitWorkspaceResult = {
		workspaceRoot,
		created: [],
		existing: [],
	};
	mkdirSync(workspaceRoot, { recursive: true });
	ensureDirectory(workspaceRoot, "reports", result);
	ensureDirectory(workspaceRoot, "workspaces", result);
	return result;
}

export function syncNecessarySkills(
	sourceSkillsDir: string,
	projectPath: string,
	stateRoot: string,
): SkillsSyncResult {
	const result: SkillsSyncResult = {
		projectPath,
		sourceSkillsDir,
		copied: [],
		existing: [],
		missing: [],
		indexPath: join(projectPath, SKILL_INDEX),
	};
	const skillsDir = join(projectPath, SKILLS_DIR);
	assertAllowedWrite(skillsDir, { stateRoot, repoRoot: projectPath });
	mkdirSync(skillsDir, { recursive: true });
	for (const skill of NECESSARY_PROJECT_SKILLS) {
		const source = join(sourceSkillsDir, skill);
		const sourceSkill = join(source, "SKILL.md");
		const destination = join(projectPath, SKILLS_DIR, skill);
		if (!existsSync(sourceSkill)) {
			result.missing.push(skill);
			continue;
		}
		if (existsSync(destination)) {
			result.existing.push(skill);
			continue;
		}
		cpSync(source, destination, { recursive: true });
		result.copied.push(skill);
	}
	result.indexPath = writeLocalSkillIndex(projectPath);
	return result;
}

function projectConfigSummary(status: ProjectConfigStatus): string {
	if (!status.exists) return "falta, usando default";
	return `${status.exists ? "existe" : "falta"}, ${status.source}, ${status.valid ? "válido" : "inválido"}`;
}

export function formatConfigOverview(report: ConfigWizardReport): string {
	return `Configuración Idu-pi

Bridge/proyecto
${marker(report.allowed)} Proyecto permitido: ${report.projectId}
${marker(report.isGitRepo)} Repo Git válido
${marker(report.workspaceMode === "clone")} Workspace mode: ${report.workspaceMode}

Agentes
${marker(report.agentProfiles.length > 1)} Perfiles configurados: ${report.agentProfiles.length}
✅ Agente activo: ${report.activeProfileId}
✅ Agentes lab: ${report.labAgentCount}

Workspace root
${marker(report.workspace.root.exists)} ${report.workspaceRoot}
${marker(report.workspace.reports.exists)} reports/
${marker(report.workspace.workspaces.exists)} workspaces/

Project-local assets
${marker(report.assets.skills.exists)} ${report.assets.skills.relativePath}
${marker(report.assets.registry.exists)} ${report.assets.registry.relativePath}
${marker(report.assets.mcp.exists)} ${report.assets.mcp.relativePath}
${marker(!report.necessarySkills.missing.length)} Skills necesarias: ${report.necessarySkills.present.length}/${NECESSARY_PROJECT_SKILLS.length}

Project config
${marker(report.projectConfig.blueprint.exists && report.projectConfig.blueprint.valid)} ${report.projectConfig.blueprint.relativePath}: ${projectConfigSummary(report.projectConfig.blueprint)}
${marker(report.projectConfig.flows.exists && report.projectConfig.flows.valid)} ${report.projectConfig.flows.relativePath}: ${projectConfigSummary(report.projectConfig.flows)}

${report.warnings.length ? `Advertencias:\n${report.warnings.map((warning) => `- ${warning}`).join("\n")}\n\n` : ""}Siguiente recomendado:
${report.recommendedNext}`;
}

export function formatConfigDoctor(report: ConfigWizardReport): string {
	return `Doctor configuración Idu-pi

Proyecto
- id: ${report.projectId}
- path: ${report.projectPath}
- permitido por ALLOWED_ROOTS: ${report.allowed ? "sí" : "no"}
- git repo: ${report.isGitRepo ? "sí" : "no"}

Workspaces
- mode: ${report.workspaceMode}
- root: ${report.workspaceRoot}
- root existe: ${report.workspace.root.exists ? "sí" : "no"}
- reports existe: ${report.workspace.reports.exists ? "sí" : "no"}
- workspaces existe: ${report.workspace.workspaces.exists ? "sí" : "no"}

Agentes
${report.agentProfiles.map((profile, index) => `- ${index + 1}. ${profile.label} (${profile.id})${profile.id === report.activeProfileId ? " activo" : ""}`).join("\n")}

Project-local assets
- ${report.assets.skills.label}: ${report.assets.skills.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.skills.path)})
- ${report.assets.registry.label}: ${report.assets.registry.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.registry.path)})
- ${report.assets.mcp.label}: ${report.assets.mcp.exists ? "existe" : "falta"} (${safeRelative(report.projectPath, report.assets.mcp.path)})

Project config
- ${report.projectConfig.blueprint.relativePath}: ${projectConfigSummary(report.projectConfig.blueprint)}${report.projectConfig.blueprint.error ? ` — ${report.projectConfig.blueprint.error}` : ""}
- ${report.projectConfig.flows.relativePath}: ${projectConfigSummary(report.projectConfig.flows)}${report.projectConfig.flows.error ? ` — ${report.projectConfig.flows.error}` : ""}

Skills necesarias
- presentes: ${report.necessarySkills.present.length ? report.necessarySkills.present.join(", ") : "ninguna"}
- faltantes: ${report.necessarySkills.missing.length ? report.necessarySkills.missing.join(", ") : "ninguna"}

Pi flags relevantes
- skill registry/lens desactivado: ${report.piArgs.some((arg) => arg === "--no-skill-registry" || arg === "--no-lens") ? "sí" : "no"}

Advertencias
${report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- ninguna"}

Siguiente recomendado:
${report.recommendedNext}`;
}

export function formatProjectMapInspection(
	inspection: ProjectMapInspection,
): string {
	const issues = inspection.issues.length
		? inspection.issues.map((issue) => `- ${issue}`).join("\n")
		: "- ninguna";
	const recommendations = inspection.recommendations.length
		? inspection.recommendations
				.map((recommendation) => `- ${recommendation}`)
				.join("\n")
		: "- ninguna";
	const activeProject = inspection.activeProjectId
		? `${inspection.activeProjectId}${inspection.activeProjectName ? ` — ${inspection.activeProjectName}` : ""}`
		: (inspection.activeProjectName ?? "(sin proyecto registrado)");
	return `Mapa funcional del proyecto

Proyecto activo:
${activeProject}

Ruta activa:
${inspection.projectPath}

Fuente del mapa:
${inspection.source === "project-local" ? "project-local" : "usando defaults"}

Nombre declarado en blueprint:
${inspection.projectName}

Nombre declarado en flows:
—

Conteo:
- módulos: ${inspection.counts.modules}
- pantallas: ${inspection.counts.screens}
- uiElements: ${inspection.counts.uiElements}
- dataStores: ${inspection.counts.dataStores}
- flows: ${inspection.counts.flows}
- moduleConnections: ${inspection.counts.moduleConnections}

Inconsistencias:
${issues}

Recomendaciones:
${recommendations}

Solo lectura: no escribí archivos, no usé IA, no analicé código fuente.`;
}

export function formatInitWorkspaceResult(result: InitWorkspaceResult): string {
	const created = result.created.length
		? result.created.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	const existing = result.existing.length
		? result.existing.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	return `Workspace root\n${result.workspaceRoot}\n\nCreados:\n${created}\n\nYa existían:\n${existing}`;
}

export function formatSkillsSyncResult(result: SkillsSyncResult): string {
	const copied = result.copied.length
		? result.copied.map((skill) => `- ${skill}`).join("\n")
		: "- ninguna";
	const existing = result.existing.length
		? result.existing.map((skill) => `- ${skill}`).join("\n")
		: "- ninguna";
	const missing = result.missing.length
		? result.missing.map((skill) => `- ${skill}`).join("\n")
		: "- ninguna";
	return `Skills sincronizadas\n\nOrigen:\n${result.sourceSkillsDir}\n\nCopiadas:\n${copied}\n\nYa existían:\n${existing}\n\nFaltantes en origen:\n${missing}\n\nÍndice actualizado:\n${result.indexPath}`;
}

export function formatInitAssetsResult(result: InitAssetsResult): string {
	const created = result.created.length
		? result.created.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	const existing = result.existing.length
		? result.existing.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	return `Assets project-local

Creados:
${created}

Ya existían:
${existing}

No ejecuté MCP, no copié secretos, no hice commit ni push.`;
}

export function formatInitProjectConfigResult(
	result: InitProjectConfigResult,
): string {
	const created = result.created.length
		? result.created.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	const existing = result.existing.length
		? result.existing.map((path) => `- ${path}`).join("\n")
		: "- ninguno";
	return `Config project-local (init_project_config)

Proyecto:
${result.projectPath}

projectName seguro:
${result.projectName}

Creados:
${created}

Ya existían:
${existing}

No sobreescribí configs existentes, no usé IA, no analicé código, no hice commit ni push.`;
}
