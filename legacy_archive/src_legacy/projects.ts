import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalDirectory, isAllowedCwd } from "./config.js";
// A14: worktree write-guard. This creates a projects <-> idu-installer import
// cycle, which is safe in ESM: both modules only reference each other inside
// function bodies (runtime), never at module-evaluation time. Function
// declarations are hoisted, so live bindings resolve by first call.
import { assertNotWorktreePath } from "./idu-installer.js";

export type ProjectEntry = {
	id: string;
	name: string;
	path: string;
	stateRoot?: string | null;
	lastSessionFile?: string | null;
};

export type ProjectRegistry = {
	activeProjectId: string | null;
	projects: ProjectEntry[];
};

const REGISTRY_PATH = join(process.cwd(), "data", "projects.json");

export function slugifyProjectId(input: string): string {
	return input
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

export type LoadRegistryOptions = {
	createIfMissing?: boolean;
	registryPath?: string;
};

export function loadRegistry(
	defaultCwd: string,
	allowedRoots: string[],
	options: LoadRegistryOptions = {},
): ProjectRegistry {
	const createIfMissing = options.createIfMissing ?? true;
	const registryPath = options.registryPath ?? REGISTRY_PATH;
	if (!existsSync(registryPath)) {
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
		if (createIfMissing) saveRegistry(initial, registryPath);
		return createIfMissing ? initial : { activeProjectId: null, projects: [] };
	}

	const parsed = JSON.parse(
		readFileSync(registryPath, "utf8"),
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

export function saveRegistry(
	registry: ProjectRegistry,
	registryPath = REGISTRY_PATH,
): void {
	mkdirSync(dirname(registryPath), { recursive: true });
	writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
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

	// A14: defense-in-depth — reject a worktree of an already-enrolled parent.
	// This covers direct callers (CLI /addproject, bootstrap) that bypass
	// projectEnroll. Exact-match re-enroll is allowed inside the guard.
	const conflict = assertNotWorktreePath(path, registry);
	if (conflict) {
		throw new Error(
			`Cannot enroll ${path}: it is a worktree of already-enrolled project ${conflict.parent}. Worktree enrollment is not allowed.`,
		);
	}

	const existing = registry.projects.find((project) => project.id === id);
	const project: ProjectEntry = {
		id,
		name: idInput.trim(),
		path,
		stateRoot: existing?.stateRoot ?? null,
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
	// A14: defense-in-depth — if someone hand-edits the registry to inject a
	// worktree path, setActiveProject must still reject it. Exact-match (the
	// normal case: activating an enrolled root) is allowed inside the guard.
	const conflict = assertNotWorktreePath(path, registry);
	if (conflict) {
		throw new Error(
			`Cannot enroll ${path}: it is a worktree of already-enrolled project ${conflict.parent}. Worktree enrollment is not allowed.`,
		);
	}
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
