import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProfile, AgentWorkspaceMode } from "./config.js";
import {
	loadModelAssignments,
	profileForModelRole,
	IDU_MODEL_ROLES,
	type IduModelRoleId,
} from "./model-assignments.js";
import { parseModelAssignment } from "./model-assignment-parser.js";
import type { ModelInvocationRecord } from "./model-invocation-log.js";
import {
	PiRpcSession,
	type PiRpcOptions,
	type PiRpcProgressEvent,
	type PiRpcPromptResult,
} from "./pi-rpc.js";

export type AgentSession = {
	readonly cwd: string;
	readonly running: boolean;
	readonly busy: boolean;
	start(): void;
	prompt(
		message: string,
		onProgress?: (event: PiRpcProgressEvent) => void,
	): Promise<PiRpcPromptResult>;
	answerUiRequest(value: unknown): boolean;
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

function gitEnv(): NodeJS.ProcessEnv {
	return process.platform === "win32"
		? {
				...process.env,
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "core.longpaths",
				GIT_CONFIG_VALUE_0: "true",
			}
		: process.env;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: gitEnv(),
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
			env: gitEnv(),
		});
	}
	runGit(workspace, ["config", "core.longpaths", "true"]);
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

	runtimeForAdHocProfile(profile: AgentProfile): AgentRuntime {
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
		this.setActiveProfile(profile.id);
		return profile;
	}

	setActiveProfile(profileId: string): AgentProfile | undefined {
		const profile = this.options.profiles.find(
			(candidate) => candidate.id === profileId,
		);
		if (!profile) return undefined;
		this.activeProfileByProject.set(this.projectId, profile.id);
		this.runtimeFor(this.projectId, this.cwd, profile);
		return profile;
	}

	startActive(): AgentRuntime {
		const runtime = this.activeRuntime();
		runtime.session.start();
		return runtime;
	}

	async prompt(
		message: string,
		onProgress?: (event: PiRpcProgressEvent) => void,
	): Promise<PiRpcPromptResult> {
		return this.activeRuntime().session.prompt(message, onProgress);
	}

	/**
	 * Resolve a model role (one of `IduModelRoleId`) to its assigned
	 * provider/model from `<stateRoot>/model-assignments.json` and
	 * invoke Pi with the per-role flags.
	 *
	 * B5 wiring (REQ-B5-1 + REQ-B5-2). Every successful or failed
	 * invocation is reported to `options.invocationSink` so the CLI
	 * can persist it to `model_invocation_log`. The sink is the only
	 * persistence hook; the router itself stays free of side effects.
	 *
	 * Resolution order:
	 *
	 * 1. `loadModelAssignments(stateRoot)` reads the assignment file.
	 * 2. `profileForModelRole(assignments, role, profiles)` resolves
	 *    the role.
	 * 3. `direct-model` → spawn a session with
	 *    `["--provider", provider, "--model", model]`.
	 * 4. `assigned` → reuse the profile's existing `piArgs` and resolve
	 *    `provider`/`model` from the profile shape.
	 * 5. `missing` or undefined → record a `skipped` invocation and
	 *    return `{ ok: false, output: "" }` without spawning a session.
	 *
	 * @throws if `role` is not a known `IduModelRoleId`.
	 */
	async promptForRole(
		role: IduModelRoleId,
		message: string,
		options: PromptForRoleOptions,
	): Promise<PromptForRoleResult> {
		assertValidModelRole(role);
		const promptChars = message.length;
		const assignments = loadModelAssignments(options.stateRoot);
		const resolution = profileForModelRole(
			assignments,
			role,
			this.options.profiles,
		);
		if (
			!resolution ||
			resolution.source === "missing" ||
			resolution.source === "inherit"
		) {
			const errorMessage =
				resolution?.source === "missing"
					? `unknown model profile: ${resolution.profileId}`
					: undefined;
			options.invocationSink?.({
				role,
				provider: "",
				model: "",
				status: "skipped",
				promptChars,
				responseChars: 0,
				...(errorMessage ? { errorMessage } : {}),
			});
			return {
				ok: false,
				output: "",
				provider: "",
				model: "",
				role,
			};
		}
		const resolved = resolveSessionForRole(resolution, this);
		try {
			const result = await resolved.runtime.session.prompt(
				message,
				options.onProgress,
			);
			options.invocationSink?.({
				role,
				provider: resolved.provider,
				model: resolved.model,
				status: "success",
				promptChars,
				responseChars: result.output.length,
			});
			return {
				...result,
				provider: resolved.provider,
				model: resolved.model,
				role,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			options.invocationSink?.({
				role,
				provider: resolved.provider,
				model: resolved.model,
				status: "failure",
				promptChars,
				responseChars: 0,
				errorMessage,
			});
			throw error;
		}
	}

	answerActiveUiRequest(value: unknown): boolean {
		return this.activeRuntime().session.answerUiRequest(value);
	}

	answerUiRequestForRuntime(runtime: AgentRuntime, value: unknown): boolean {
		return runtime.session.answerUiRequest(value);
	}

	restartActive(): AgentRuntime {
		this.resetActiveSession();
		return this.startActive();
	}

	stopActive(reason = "Servidor Pi detenido desde Telegram."): boolean {
		const runtime = this.activeRuntime();
		const hadRuntime = runtime.session.running || runtime.session.busy;
		runtime.session.stop(reason);
		return hadRuntime;
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

	/**
	 * Internal helper used by `promptForRole` to spawn a session with
	 * custom `piArgs` (e.g. `["--provider", provider, "--model", model]`)
	 * when the resolved role points at a direct-model assignment.
	 *
	 * Unlike `activeRuntime()` this does **not** cache a runtime in
	 * the `runtimes` map or share the active profile's session: the
	 * role-based call is one-off and should not touch the active
	 * runtime the user has selected via Telegram.
	 */
	private createRoleSession(piArgs: string[]): AgentSession {
		const workspace = this.workspaceFor(
			this.projectId,
			this.cwd,
			this.options.profiles[0]!,
		);
		return this.createSession({
			piBin: this.options.piBin,
			piArgs: [...this.options.basePiArgs, ...piArgs],
			cwd: workspace.cwd,
			modePrefix: "",
		});
	}
}

export type PromptForRoleOptions = {
	projectId: string;
	stateRoot: string;
	invocationSink?: (record: ModelInvocationRecord) => void;
	onProgress?: (event: PiRpcProgressEvent) => void;
};

export type PromptForRoleResult = PiRpcPromptResult & {
	provider: string;
	model: string;
	role: IduModelRoleId;
};

type ResolvedRoleSession = {
	runtime: AgentRuntime;
	provider: string;
	model: string;
};

type AssignedResolution = {
	source: "assigned";
	profile: AgentProfile;
	profileId: string;
};

type DirectModelResolution = {
	source: "direct-model";
	profile: AgentProfile;
	modelId: string;
};

function resolveSessionForRole(
	resolution: AssignedResolution | DirectModelResolution,
	router: AgentRouter,
): ResolvedRoleSession {
	if (resolution.source === "direct-model") {
		const parsed = parseModelAssignment(resolution.modelId);
		return {
			runtime: createDirectModelRuntime(router, parsed.provider, parsed.model),
			provider: parsed.provider,
			model: parsed.model,
		};
	}
	// source === "assigned": reuse the existing profile runtime.
	return {
		runtime: router.runtimeForProfile(resolution.profile.id),
		provider: resolution.profile.provider,
		model: profileModelLabel(resolution.profile),
	};
}

function createDirectModelRuntime(
	router: AgentRouter,
	provider: string,
	model: string,
): AgentRuntime {
	const session = router["createRoleSession"]([
		"--provider",
		provider,
		"--model",
		model,
	]);
	const workspace = router["workspaceFor"](
		router["projectId"],
		router["cwd"],
		router["profiles"][0]!,
	);
	return {
		projectId: router["projectId"],
		targetCwd: router["cwd"],
		cwd: workspace.cwd,
		profile: {
			id: "__agent_router_role_runtime__",
			label: "agentRouter role runtime",
			provider: "pi",
			piArgs: ["--provider", provider, "--model", model],
		},
		modePrefix: "",
		workspaceKind: workspace.kind,
		session,
	};
}

function assertValidModelRole(role: IduModelRoleId): void {
	if (!IDU_MODEL_ROLES.some((candidate) => candidate.id === role)) {
		throw new Error(`unknown model role: ${role}`);
	}
}

export function profileModelLabel(profile: AgentProfile): string {
	const modelFlagIndex = profile.piArgs.findIndex((arg) => arg === "--model");
	if (modelFlagIndex >= 0 && profile.piArgs[modelFlagIndex + 1]) {
		return profile.piArgs[modelFlagIndex + 1];
	}
	const modelEqualsArg = profile.piArgs.find((arg) =>
		arg.startsWith("--model="),
	);
	if (modelEqualsArg) return modelEqualsArg.slice("--model=".length);
	return "Pi default";
}

export function formatAgentProfiles(router: AgentRouter): string {
	const active = router.activeProfile();
	return router.profiles
		.map(
			(profile, index) =>
				`${index + 1}. ${profile.label}${profile.id === active.id ? " ✅" : ""}\n   id: ${profile.id}\n   provider: ${profile.provider}\n   model: ${profileModelLabel(profile)}`,
		)
		.join("\n\n");
}
