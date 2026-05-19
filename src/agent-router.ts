import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, AgentWorkspaceMode } from "./config.js";
import {
	PiRpcSession,
	type PiRpcOptions,
	type PiRpcPromptResult,
} from "./pi-rpc.js";

export type AgentSession = {
	readonly cwd: string;
	readonly running: boolean;
	readonly busy: boolean;
	prompt(message: string): Promise<PiRpcPromptResult>;
	cancel(): boolean;
	stop(reason?: string): void;
};

export type AgentRuntime = {
	projectId: string;
	targetCwd: string;
	cwd: string;
	profile: AgentProfile;
	session: AgentSession;
	modePrefix: string;
	workspaceKind: "direct" | "clone";
};

type SessionFactory = (options: PiRpcOptions) => AgentSession;

type WorkspaceResolver = (
	projectId: string,
	targetCwd: string,
	profile: AgentProfile,
) => string;

type WorkspaceSyncer = (
	workspaceRoot: string | undefined,
	projectId: string,
	targetCwd: string,
	profileId: string,
) => string;

function slug(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/giu, "_")
			.replace(/^_+|_+$/gu, "") || "project"
	);
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function ensureGitRepo(path: string): void {
	runGit(path, ["rev-parse", "--show-toplevel"]);
}

export function ensureCloneWorkspace(
	workspaceRoot: string | undefined,
	projectId: string,
	targetCwd: string,
	profileId: string,
): string {
	if (!workspaceRoot)
		throw new Error("AGENT_WORKSPACE_ROOT is required for clone workspaces.");
	ensureGitRepo(targetCwd);
	const workspacesRoot = join(workspaceRoot, "workspaces");
	mkdirSync(workspacesRoot, { recursive: true });
	const workspace = join(
		workspacesRoot,
		`${slug(projectId)}__${slug(profileId)}`,
	);
	if (!existsSync(workspace)) {
		execFileSync("git", ["clone", "--no-hardlinks", targetCwd, workspace], {
			stdio: ["ignore", "pipe", "pipe"],
		});
	}
	runGit(workspace, [
		"remote",
		"set-url",
		"--push",
		"origin",
		"DISABLED_PUSH_FROM_PI_TELEGRAM_BRIDGE",
	]);
	writeFileSync(
		join(workspace, ".git", "hooks", "pre-push"),
		"#!/bin/sh\necho 'Push disabled for pi-telegram-bridge agent workspace.' >&2\nexit 1\n",
		{ mode: 0o755 },
	);
	writeFileSync(
		join(workspace, ".git", "hooks", "pre-commit"),
		"#!/bin/sh\necho 'Commit disabled for pi-telegram-bridge agent workspace.' >&2\nexit 1\n",
		{ mode: 0o755 },
	);
	const branch = runGit(targetCwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	runGit(workspace, ["fetch", "origin"]);
	if (branch === "HEAD") {
		const head = runGit(targetCwd, ["rev-parse", "HEAD"]);
		runGit(workspace, ["reset", "--hard", head]);
	} else {
		runGit(workspace, ["reset", "--hard", `origin/${branch}`]);
	}
	runGit(workspace, ["clean", "-fd"]);
	return workspace;
}

type AgentRouterOptions = {
	piBin: string;
	basePiArgs: string[];
	profiles: AgentProfile[];
	defaultProjectId: string;
	defaultCwd: string;
	workspaceRoot?: string;
	workspaceMode?: AgentWorkspaceMode;
	createSession?: SessionFactory;
	resolveWorkspace?: WorkspaceResolver;
	syncWorkspace?: WorkspaceSyncer;
};

export class AgentRouter {
	private projectId: string;
	private cwd: string;
	private activeProfileByProject = new Map<string, string>();
	private runtimes = new Map<string, AgentRuntime>();
	private createSession: SessionFactory;
	private resolveWorkspace?: WorkspaceResolver;
	private syncWorkspace: WorkspaceSyncer;

	constructor(private options: AgentRouterOptions) {
		if (!options.profiles.length)
			throw new Error("At least one agent profile is required.");
		this.projectId = options.defaultProjectId;
		this.cwd = options.defaultCwd;
		this.activeProfileByProject.set(this.projectId, options.profiles[0].id);
		this.createSession =
			options.createSession ??
			((sessionOptions) => new PiRpcSession(sessionOptions));
		this.resolveWorkspace = options.resolveWorkspace;
		this.syncWorkspace = options.syncWorkspace ?? ensureCloneWorkspace;
	}

	get profiles(): AgentProfile[] {
		return this.options.profiles;
	}

	get currentProjectId(): string {
		return this.projectId;
	}

	get currentCwd(): string {
		return this.cwd;
	}

	switchProject(projectId: string, cwd: string): void {
		this.projectId = projectId;
		this.cwd = cwd;
		if (!this.activeProfileByProject.has(projectId)) {
			this.activeProfileByProject.set(projectId, this.options.profiles[0].id);
		}
	}

	activeProfile(): AgentProfile {
		const profileId =
			this.activeProfileByProject.get(this.projectId) ??
			this.options.profiles[0].id;
		return (
			this.options.profiles.find((profile) => profile.id === profileId) ??
			this.options.profiles[0]
		);
	}

	activeRuntime(): AgentRuntime {
		return this.runtimeFor(this.projectId, this.cwd, this.activeProfile());
	}

	labProfiles(): AgentProfile[] {
		return this.options.profiles.slice(1);
	}

	runtimeForProfile(profileId: string): AgentRuntime {
		const profile = this.options.profiles.find(
			(candidate) => candidate.id === profileId,
		);
		if (!profile) throw new Error(`Unknown agent profile: ${profileId}`);
		return this.runtimeFor(this.projectId, this.cwd, profile);
	}

	cancelProfiles(profileIds: string[]): number {
		let cancelled = 0;
		for (const profileId of profileIds) {
			const key = this.key(this.projectId, this.cwd, profileId);
			const runtime = this.runtimes.get(key);
			if (runtime?.session.cancel()) cancelled++;
		}
		return cancelled;
	}

	select(input: string): AgentProfile | undefined {
		const normalized = input.trim().replace(/\.$/u, "").toLowerCase();
		const index = Number(normalized);
		const profile = Number.isInteger(index)
			? this.options.profiles[index - 1]
			: this.options.profiles.find(
					(candidate) =>
						candidate.id.toLowerCase() === normalized ||
						candidate.label.toLowerCase() === normalized,
				);
		if (!profile) return undefined;
		this.activeProfileByProject.set(this.projectId, profile.id);
		this.runtimeFor(this.projectId, this.cwd, profile);
		return profile;
	}

	async prompt(message: string): Promise<PiRpcPromptResult> {
		return this.activeRuntime().session.prompt(message);
	}

	cancelActive(): boolean {
		return this.activeRuntime().session.cancel();
	}

	resetActiveSession(sessionPath?: string): void {
		const profile = this.activeProfile();
		const key = this.key(this.projectId, this.cwd, profile.id);
		this.runtimes
			.get(key)
			?.session.stop("Sesión reiniciada para retomar otro hilo.");
		this.runtimes.delete(key);
		this.runtimeFor(this.projectId, this.cwd, profile, sessionPath);
	}

	setActiveModePrefix(modePrefix: string): void {
		this.activeRuntime().modePrefix = modePrefix;
		this.resetActiveSession();
	}

	stopAll(reason = "Bridge detenido."): void {
		for (const runtime of this.runtimes.values()) runtime.session.stop(reason);
		this.runtimes.clear();
	}

	private runtimeFor(
		projectId: string,
		cwd: string,
		profile: AgentProfile,
		sessionPath?: string,
	): AgentRuntime {
		const key = this.key(projectId, cwd, profile.id);
		const existing = this.runtimes.get(key);
		const workspace = this.workspaceFor(projectId, cwd, profile);
		if (existing && !sessionPath) {
			existing.cwd = workspace.cwd;
			existing.workspaceKind = workspace.kind;
			return existing;
		}
		const modePrefix = existing?.modePrefix ?? "";
		const runtime: AgentRuntime = {
			projectId,
			targetCwd: cwd,
			cwd: workspace.cwd,
			profile,
			modePrefix,
			workspaceKind: workspace.kind,
			session: this.createSession({
				piBin: this.options.piBin,
				piArgs: [...this.options.basePiArgs, ...profile.piArgs],
				cwd: workspace.cwd,
				modePrefix,
				sessionPath,
			}),
		};
		this.runtimes.set(key, runtime);
		return runtime;
	}

	private workspaceFor(
		projectId: string,
		targetCwd: string,
		profile: AgentProfile,
	): { cwd: string; kind: "direct" | "clone" } {
		const defaultProfileId = this.options.profiles[0].id;
		if (
			(this.options.workspaceMode ?? "direct") !== "clone" ||
			profile.id === defaultProfileId
		) {
			return { cwd: targetCwd, kind: "direct" };
		}
		const cwd = this.resolveWorkspace
			? this.resolveWorkspace(projectId, targetCwd, profile)
			: this.syncWorkspace(
					this.options.workspaceRoot,
					projectId,
					targetCwd,
					profile.id,
				);
		return { cwd, kind: "clone" };
	}

	private key(projectId: string, cwd: string, profileId: string): string {
		return `${projectId}\u0000${cwd}\u0000${profileId}`;
	}
}

export function formatAgentProfiles(router: AgentRouter): string {
	const active = router.activeProfile();
	return router.profiles
		.map(
			(profile, index) =>
				`${index + 1}. ${profile.label}${profile.id === active.id ? " ✅" : ""}\n   id: ${profile.id}\n   provider: ${profile.provider}`,
		)
		.join("\n\n");
}
