import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { AgentProfile, AgentWorkspaceMode } from "./config.js";
import { isAllowedCwd } from "./config.js";
import { validateProjectBlueprint } from "./project-blueprint.js";
import { validateProjectFlows } from "./project-flows.js";

export type AssetStatus = {
	label: string;
	path: string;
	relativePath: string;
	exists: boolean;
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

export const NECESSARY_PROJECT_SKILLS = [
	"bug-hunter",
	"codebase-audit-pre-push",
	"performance-optimizer",
	"skill-check",
	"technical-change-tracker",
	"jq",
] as const;

const SKILLS_DIR = ".agents/skills";
const SKILLS_KEEP = ".agents/skills/.gitkeep";
const SKILL_INDEX = ".agents/skills/INDEX.md";
const REGISTRY_FILE = ".atl/skill-registry.md";
const MCP_CONFIG = ".mcp/config.json";
const PROJECT_BLUEPRINT = "config/project-blueprint.json";
const PROJECT_FLOWS = "config/project-flows.json";
const DEFAULT_BLUEPRINT = "config/default-blueprint.json";
const DEFAULT_FLOWS = "config/default-flows.json";

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
	writeFileSync(path, content, "utf8");
	result.created.push(relativePath);
}

function createProjectConfigFileIfMissing(
	projectPath: string,
	relativePath: string,
	content: () => string,
	result: InitProjectConfigResult,
): void {
	const path = join(projectPath, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		result.existing.push(relativePath);
		return;
	}
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
	const content = `# Project Skill Index\n\nRead this index first, then open only the matching SKILL.md.\n\n| Skill | Path |\n| --- | --- |\n${entries.map((name) => `| ${name} | .agents/skills/${name}/SKILL.md |`).join("\n")}\n`;
	const indexPath = join(projectPath, SKILL_INDEX);
	writeFileSync(indexPath, content, "utf8");
	return indexPath;
}

function safeRelative(projectPath: string, path: string): string {
	return relative(projectPath, path).replace(/\\/gu, "/");
}

export function inspectProjectConfig(
	options: InspectProjectConfigOptions,
): ConfigWizardReport {
	const assets = {
		skills: asset(options.projectPath, "Skills", SKILLS_DIR),
		registry: asset(options.projectPath, "Skill registry", REGISTRY_FILE),
		mcp: asset(options.projectPath, "MCP config", MCP_CONFIG),
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
	const recommendedNext = missingWorkspace
		? "/config init_workspace"
		: missingAsset
			? "/config init_assets"
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
		workspace,
		necessarySkills: {
			present: presentSkills,
			missing: missingSkills,
		},
		warnings,
		recommendedNext,
	};
}

export function initProjectAssets(projectPath: string): InitAssetsResult {
	const result: InitAssetsResult = { projectPath, created: [], existing: [] };
	mkdirSync(join(projectPath, SKILLS_DIR), { recursive: true });
	createFileIfMissing(projectPath, SKILLS_KEEP, "", result);
	createFileIfMissing(projectPath, REGISTRY_FILE, REGISTRY_TEMPLATE, result);
	createFileIfMissing(projectPath, MCP_CONFIG, MCP_TEMPLATE, result);
	return result;
}

export function initProjectBlueprint(
	projectPath: string,
	projectId?: string,
): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath, projectId);
	createProjectConfigFileIfMissing(
		projectPath,
		PROJECT_BLUEPRINT,
		() => blueprintContent(result.projectName),
		result,
	);
	return result;
}

export function initProjectFlows(projectPath: string): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath);
	createProjectConfigFileIfMissing(
		projectPath,
		PROJECT_FLOWS,
		flowsContent,
		result,
	);
	return result;
}

export function initProjectConfig(
	projectPath: string,
	projectId?: string,
): InitProjectConfigResult {
	const result = emptyProjectConfigResult(projectPath, projectId);
	createProjectConfigFileIfMissing(
		projectPath,
		PROJECT_BLUEPRINT,
		() => blueprintContent(result.projectName),
		result,
	);
	createProjectConfigFileIfMissing(
		projectPath,
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
		readFileSync(join(process.cwd(), DEFAULT_BLUEPRINT), "utf8"),
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
		readFileSync(join(process.cwd(), DEFAULT_FLOWS), "utf8"),
	) as unknown;
	const validation = validateProjectFlows(parsed);
	if (!validation.ok) {
		throw new Error(
			`Default project flows are invalid: ${validation.errors.join("; ")}`,
		);
	}
	return `${JSON.stringify(validation.flows, null, 2)}\n`;
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
): SkillsSyncResult {
	const result: SkillsSyncResult = {
		projectPath,
		sourceSkillsDir,
		copied: [],
		existing: [],
		missing: [],
		indexPath: join(projectPath, SKILL_INDEX),
	};
	mkdirSync(join(projectPath, SKILLS_DIR), { recursive: true });
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
