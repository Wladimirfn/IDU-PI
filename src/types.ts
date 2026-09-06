export type HarnessEngine = "claude" | "opencode" | "pi" | "codex" | "kimi" | "qwen" | "antigravity" | string;

export type PermissionLevel = "read-only" | "workspace" | string[];

export interface IduProfile {
	harness: HarnessEngine;
	provider?: string;
	model?: string;
	permissions?: PermissionLevel;
	description?: string;
	timeoutMs?: number;
	idleTimeoutMs?: number;
	hardCapMs?: number;
	startupGraceMs?: number;
	streams?: boolean;
}

export interface CliDefinition {
	command: string;
	argsTemplate: string[];
}

export interface OneOrchestratorRule {
	enabled: boolean;
	allowRecursiveDelegation: boolean;
}

export interface IduConfig {
	version: string;
	oneOrchestratorRule: OneOrchestratorRule;
	clis: Record<string, CliDefinition>;
	defaultTimeoutMs: number;
	maxConcurrentWorkers: number;
}

export interface ProfilesConfig {
	profiles: Record<string, IduProfile>;
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface DelegateRequest {
	task: string;
	profile: string;
	workingDir?: string;
	parentOrchestrator?: string;
	timeoutMs?: number;
	contextFiles?: string[];
	verbose?: boolean;
	sessionId?: string;
	parentSessionId?: string;
	fork?: boolean;
}

export interface DelegateResult {
	runId: string;
	sessionId: string;
	parentSessionId?: string;
	isResumed?: boolean;
	profile: string;
	harness: string;
	model?: string;
	status: RunStatus;
	exitCode: number | null;
	stdout?: string;
	stderr?: string;
	summary: string;
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	logPath: string;
	error?: string;
	partial?: boolean;
	resumeHint?: string;
	lastActivityAt?: string;
	bytesEmitted?: number;
}

export interface RunRecord {
	runId: string;
	sessionId: string;
	parentSessionId?: string;
	isResumed?: boolean;
	request: DelegateRequest;
	profile: IduProfile;
	command: string;
	args: string[];
	pid?: number;
	status: RunStatus;
	exitCode: number | null;
	startedAt: string;
	completedAt?: string;
	logPath: string;
	resultSummary?: string;
	error?: string;
	lastActivityAt?: string;
	bytesEmitted?: number;
	elapsedMs?: number;
	secondsSinceLastActivity?: number;
	health?: "healthy" | "idle_warning" | "completed" | "interrupted";
}

export interface SessionTreeEntry {
	sessionId: string;
	parentSessionId?: string;
	nativeSessionId?: string;
	profile: string;
	harness: string;
	workingDir: string;
	createdAt: string;
	lastActiveAt: string;
	turnCount: number;
	runs: string[];
}

export interface CapabilitiesResult {
	installedClis: Array<{
		name: string;
		command: string;
		available: boolean;
	}>;
	profiles: Record<string, IduProfile>;
	oneOrchestratorRule: OneOrchestratorRule;
}
