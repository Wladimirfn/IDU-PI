import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type IduSessionProjectState = {
	projectId: string;
	active: boolean;
	activatedAt?: string;
	updatedAt: string;
	guardrails: "automatic";
};

export type IduSessionState = {
	version: 1;
	projects: Record<string, IduSessionProjectState>;
};

export type IduSessionStatus = {
	projectId: string;
	active: boolean;
	activatedAt?: string;
	guardrails: "automatic" | "manual";
	workspaceRoot: string;
	sessionStatePath: string;
};

export type IduSessionStoreOptions = {
	workspaceRoot?: string;
	filePath?: string;
	now?: () => Date;
};

const emptyState = (): IduSessionState => ({ version: 1, projects: {} });

export function resolveIduSessionStatePath(stateRoot: string): string {
	return join(stateRoot, "idu-session-state.json");
}

export class IduSessionStore {
	private readonly workspaceRoot: string;
	private readonly filePath: string;
	private readonly now: () => Date;
	private state: IduSessionState;

	constructor(options: IduSessionStoreOptions = {}) {
		if (options.workspaceRoot === "") {
			throw new Error(
				"IduSessionStore requires a non-empty workspaceRoot; use configureIduSessionStore({ workspaceRoot: stateRoot, filePath: ... }) instead of relying on the default. Tests that pass `stateRoot: \"\"` as a sentinel must configure the store with a tempDir stateRoot before invoking handlers.",
			);
		}
		if (options.filePath === "") {
			throw new Error(
				"IduSessionStore requires a non-empty filePath; use configureIduSessionStore({ workspaceRoot: stateRoot, filePath: ... }) instead of relying on the default. Tests that pass `filePath: \"\"` as a sentinel must configure the store with a tempDir filePath before invoking handlers.",
			);
		}
		this.workspaceRoot = options.workspaceRoot ?? process.cwd();
		this.filePath =
			options.filePath ?? resolveIduSessionStatePath(this.workspaceRoot);
		this.now = options.now ?? (() => new Date());
		this.state = this.load();
	}

	activate(projectId: string): IduSessionStatus {
		const normalizedProjectId = normalizeProjectId(projectId);
		const timestamp = this.now().toISOString();
		this.state.projects[normalizedProjectId] = {
			projectId: normalizedProjectId,
			active: true,
			activatedAt: timestamp,
			updatedAt: timestamp,
			guardrails: "automatic",
		};
		this.persist();
		return this.status(normalizedProjectId);
	}

	deactivate(projectId: string): IduSessionStatus {
		const normalizedProjectId = normalizeProjectId(projectId);
		const existing = this.state.projects[normalizedProjectId];
		const timestamp = this.now().toISOString();
		this.state.projects[normalizedProjectId] = {
			projectId: normalizedProjectId,
			active: false,
			...(existing?.activatedAt ? { activatedAt: existing.activatedAt } : {}),
			updatedAt: timestamp,
			guardrails: "automatic",
		};
		this.persist();
		return this.status(normalizedProjectId);
	}

	shouldUseAutomaticGuardrails(projectId: string): boolean {
		const normalizedProjectId = normalizeProjectId(projectId);
		this.state = this.load();
		return this.state.projects[normalizedProjectId]?.active === true;
	}

	status(projectId: string): IduSessionStatus {
		const normalizedProjectId = normalizeProjectId(projectId);
		this.state = this.load();
		const project = this.state.projects[normalizedProjectId];
		return {
			projectId: normalizedProjectId,
			active: project?.active === true,
			...(project?.activatedAt ? { activatedAt: project.activatedAt } : {}),
			guardrails: project?.active === true ? "automatic" : "manual",
			workspaceRoot: this.workspaceRoot,
			sessionStatePath: this.filePath,
		};
	}

	private load(): IduSessionState {
		if (!existsSync(this.filePath)) return emptyState();
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
			if (!isIduSessionState(parsed)) return emptyState();
			return parsed;
		} catch {
			return emptyState();
		}
	}

	private persist(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(this.filePath, `${JSON.stringify(this.state, null, "\t")}\n`);
	}
}

let defaultStore = new IduSessionStore();

export function configureIduSessionStore(
	options: IduSessionStoreOptions,
): IduSessionStore {
	defaultStore = new IduSessionStore(options);
	return defaultStore;
}

export function activateIduSession(projectId: string): IduSessionStatus {
	return defaultStore.activate(projectId);
}

export function deactivateIduSession(projectId: string): IduSessionStatus {
	return defaultStore.deactivate(projectId);
}

export function shouldUseAutomaticGuardrails(projectId: string): boolean {
	return defaultStore.shouldUseAutomaticGuardrails(projectId);
}

export function getIduSessionStatus(projectId: string): IduSessionStatus {
	return defaultStore.status(projectId);
}

export function formatIduSessionStatus(status: IduSessionStatus): string {
	return [
		"Idu-pi session",
		"",
		"Estado:",
		status.active ? "active" : "inactive",
		"",
		"projectId:",
		status.projectId,
		"",
		"activatedAt:",
		status.activatedAt ?? "—",
		"",
		"guardrails:",
		status.guardrails,
		"",
		"workspaceRoot:",
		status.workspaceRoot,
		"",
		"sessionStatePath:",
		status.sessionStatePath,
	].join("\n");
}

function normalizeProjectId(projectId: string): string {
	const trimmed = projectId.trim();
	if (!trimmed) throw new Error("projectId is required");
	return trimmed;
}

function isIduSessionState(value: unknown): value is IduSessionState {
	if (!isRecord(value)) return false;
	if (value.version !== 1 || !isRecord(value.projects)) return false;
	return Object.values(value.projects).every(isIduSessionProjectState);
}

function isIduSessionProjectState(
	value: unknown,
): value is IduSessionProjectState {
	return (
		isRecord(value) &&
		typeof value.projectId === "string" &&
		typeof value.active === "boolean" &&
		typeof value.updatedAt === "string" &&
		(value.activatedAt === undefined ||
			typeof value.activatedAt === "string") &&
		value.guardrails === "automatic"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
