export type HarnessEngine = "claude" | "opencode" | "pi" | "codex" | "kimi" | "qwen" | "antigravity" | "commandcode" | "cmdc" | string;

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
	/**
	 * Whether a config file can turn the guard off. Always false now: both keys
	 * are retired and the guard reads no config. Present so `idu status` can say
	 * "not configurable" instead of printing an ENABLED/DISABLED that a stale
	 * config file could contradict. Optional so older mock configs still compile.
	 */
	configurable?: boolean;
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
	/**
	 * True when the caller explicitly named the profile. When resuming a
	 * session with this false, the session's own profile is inherited
	 * instead of a global default, so a session can never be resumed
	 * blind under a different harness.
	 */
	profileExplicit?: boolean;
	/**
	 * Bypass the harness-affinity guard: allows resuming a session with a
	 * profile whose harness differs from the one that created it. Off by
	 * default because a cross-harness resume silently discards the native
	 * session id and corrupts the turn count.
	 */
	force?: boolean;
	workingDir?: string;
	parentOrchestrator?: string;
	timeoutMs?: number;
	contextFiles?: string[];
	verbose?: boolean;
	sessionId?: string;
	parentSessionId?: string;
	fork?: boolean;
}

/**
 * Token counts a harness reported for one delegation.
 *
 * `null` on a field means the harness did not report it, which is NOT the same
 * as zero. A missing field must never be summed as 0, or the total silently
 * under-reports and nobody can tell "free" apart from "unknown".
 */
export interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	/** Reasoning tokens, when the harness separates them from output. */
	reasoningTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	/** Harness-reported total, when present. Recomputed only as a last resort. */
	totalTokens: number | null;
}

/**
 * What a harness actually reported, normalised across its own conventions.
 *
 * `harness` is the provenance: it tells the reader which CLI produced these
 * numbers and therefore which conventions to trust. `reportedCostUsd` stays
 * null unless a real price was known; a subscription plan has no per-token
 * price, and inventing one is how a cost figure turns into a lie.
 */
export interface UsageReport {
	harness: string;
	tokens: TokenUsage;
	/**
	 * Dollar cost from the harness itself, or null when unknown. Never zero as
	 * a stand-in for "not reported".
	 */
	reportedCostUsd: number | null;
	/** True when at least one token field was read from a harness payload. */
	captured: boolean;
	/** True when some field is missing because that harness never emits it. */
	incomplete: boolean;
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
	instruction?: string;
	usage?: UsageReport;
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
	runnerPid?: number;
	status: RunStatus;
	exitCode: number | null;
	startedAt: string;
	completedAt?: string;
	elapsedMs?: number;
	logPath: string;
	resultSummary?: string;
	error?: string;
	lastActivityAt?: string;
	bytesEmitted?: number;
	secondsSinceLastActivity?: number;
	health?: "healthy" | "idle_warning" | "completed" | "interrupted";
	/**
	 * Persisted so the numbers survive a reread of the session. Without this,
	 * usage is only ever visible in the first response and disappears on every
	 * later `getResult` or `getStatus`.
	 */
	usage?: UsageReport;
}

export interface RunnerSpec {
	runId: string;
	sessionId: string;
	parentSessionId?: string;
	harness: string;
	command: string;
	args: string[];
	workingDir: string;
	env: Record<string, string>;
	logPath: string;
	sessionPath: string;
	pidPath: string;
	runnerPidPath?: string;
	specPath?: string;
	lockPath?: string;
	startedAt?: string;
	timeoutMs?: number;
	idleTimeoutMs?: number;
	hardCapMs?: number;
	startupGraceMs?: number;
	streams?: boolean;
	verbose?: boolean;
	shell?: boolean;
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
