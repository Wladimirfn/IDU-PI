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
	/**
	 * Quota for the accounts behind the installed CLIs, read on demand.
	 *
	 * Probing is a deliberate act, never a side effect of delegating: two of
	 * the sources cost a model call to answer, so `getCapabilities()` fills this
	 * only when asked, and `delegate()` never triggers it.
	 */
	quota?: QuotaSnapshot[];
}

/**
 * One quota window on a provider account.
 *
 * Direction is the field that matters, so it is fixed once and never varies:
 * every source is converted to REMAINING on the way in. Claude reports "9% used"
 * and agy reports "98% remaining" for the same account state, and a reader that
 * has to know which CLI produced a number is one refactor away from shipping a
 * number that is backwards.
 */
export interface QuotaWindow {
	/** 0-100 remaining. Null when the source did not report it. */
	remainingPercent: number | null;
	/** When the window resets, ISO 8601. Null when unreported or unparseable. */
	resetsAt: string | null;
	/** Length of the window in seconds, when the source names it. */
	windowSeconds: number | null;
}

/**
 * What one CLI reports about its own account, as observed at one moment.
 *
 * `unknownReason` exists so that "this CLI cannot tell us" is a value the
 * caller can read and pass along, rather than a window silently missing from
 * the object. A snapshot with no numbers and no stated reason is the failure
 * mode this type is built to prevent.
 */
export interface QuotaSnapshot {
	/** Stable id of the source, e.g. "codex". */
	source: string;
	/** The CLI whose credentials and endpoint were used. */
	harness: string;
	/**
	 * Which meter this is. A subscriber plan and a metered API account are the
	 * same vendor with different counters, so they must never share a bucket.
	 * Null when the source does not say which one it is.
	 */
	billingModel: "plan" | "api" | "subscription" | null;
	/** Plan name when the source names one, e.g. "plus". */
	plan: string | null;
	/** Windows keyed by a stable label ("5h", "week"), never by index. */
	windows: Record<string, QuotaWindow>;
	/** When this observation was made. Never a file mtime, never the reset time. */
	capturedAt: string;
	/** Why there are no numbers, when there are none. */
	unknownReason: string | null;
}
