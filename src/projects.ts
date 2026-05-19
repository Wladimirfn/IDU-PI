import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalDirectory, isAllowedCwd } from "./config.js";

export type ProjectEntry = {
	id: string;
	name: string;
	path: string;
	lastSessionFile?: string | null;
};

export type ProjectRegistry = {
	activeProjectId: string | null;
	projects: ProjectEntry[];
};

const REGISTRY_PATH = join(process.cwd(), "data", "projects.json");

export function slugifyProjectId(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

export function loadRegistry(
	defaultCwd: string,
	allowedRoots: string[],
): ProjectRegistry {
	if (!existsSync(REGISTRY_PATH)) {
		const initial: ProjectRegistry = {
			activeProjectId: "default",
			projects: [
				{
					id: "default",
					name: "Default",
					path: defaultCwd,
					lastSessionFile: null,
				},
			],
		};
		saveRegistry(initial);
		return initial;
	}

	const parsed = JSON.parse(
		readFileSync(REGISTRY_PATH, "utf8"),
	) as ProjectRegistry;
	const projects = (Array.isArray(parsed.projects) ? parsed.projects : [])
		.map((project) => {
			try {
				const path = canonicalDirectory(project.path);
				if (!isAllowedCwd(path, allowedRoots)) return undefined;
				return { ...project, id: slugifyProjectId(project.id), path };
			} catch {
				return undefined;
			}
		})
		.filter((project): project is ProjectEntry => Boolean(project?.id));

	const activeProjectId = projects.some(
		(project) => project.id === parsed.activeProjectId,
	)
		? parsed.activeProjectId
		: (projects[0]?.id ?? null);

	return { activeProjectId, projects };
}

export function saveRegistry(registry: ProjectRegistry): void {
	mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
	writeFileSync(
		REGISTRY_PATH,
		`${JSON.stringify(registry, null, 2)}\n`,
		"utf8",
	);
}

export function getActiveProject(
	registry: ProjectRegistry,
): ProjectEntry | undefined {
	return (
		registry.projects.find(
			(project) => project.id === registry.activeProjectId,
		) ?? registry.projects[0]
	);
}

export function addProject(
	registry: ProjectRegistry,
	idInput: string,
	pathInput: string,
	allowedRoots: string[],
): ProjectEntry {
	const id = slugifyProjectId(idInput);
	if (!id) throw new Error("El id del proyecto no puede estar vacío.");

	const path = canonicalDirectory(pathInput);
	if (!isAllowedCwd(path, allowedRoots)) {
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${path}`);
	}

	const existing = registry.projects.find((project) => project.id === id);
	const project: ProjectEntry = {
		id,
		name: idInput.trim(),
		path,
		lastSessionFile: existing?.lastSessionFile ?? null,
	};

	if (existing) {
		Object.assign(existing, project);
		return existing;
	}

	registry.projects.push(project);
	if (!registry.activeProjectId) registry.activeProjectId = id;
	return project;
}

export function setActiveProject(
	registry: ProjectRegistry,
	idInput: string,
	allowedRoots: string[],
): ProjectEntry {
	const id = slugifyProjectId(idInput);
	const project = registry.projects.find((entry) => entry.id === id);
	if (!project) throw new Error(`Proyecto no encontrado: ${idInput}`);
	const path = canonicalDirectory(project.path);
	if (!isAllowedCwd(path, allowedRoots))
		throw new Error(`Ruta fuera de ALLOWED_ROOTS: ${path}`);
	project.path = path;
	registry.activeProjectId = project.id;
	return project;
}

export function parseAddProjectArgs(text: string): {
	id: string;
	path: string;
} {
	const trimmed = text.trim();
	const firstSpace = trimmed.search(/\s/u);
	if (firstSpace === -1) throw new Error("Uso: /addproject <id> <ruta>");
	const id = trimmed.slice(0, firstSpace).trim();
	const path = trimmed.slice(firstSpace).trim();
	if (!id || !path) throw new Error("Uso: /addproject <id> <ruta>");
	return { id, path };
}
