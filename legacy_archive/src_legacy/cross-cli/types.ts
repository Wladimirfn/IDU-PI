export type HarnessEngine = "claude" | "opencode" | "pi" | "codex" | string;

export type PermissionLevel = "read-only" | "workspace" | string[];

export interface IduProfile {
	harness: HarnessEngine;
	provider?: string;
	model?: string;
	permissions?: PermissionLevel;
	description?: string;
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
}

export interface DelegateResult {
	runId: string;
	profile: string;
	harness: string;
	model?: string;
	status: RunStatus;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	summary: string;
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	logPath: string;
}

export interface RunRecord {
	runId: string;
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
