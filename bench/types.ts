export type BenchmarkTrack = "controlled" | "native";

export type TaskCategory =
	| "terminal-bench"
	| "swe-bench"
	| "audit-bench"
	| "consult-bench"
	| "explore-bench"
	| "design-bench";

export type PermissionMode = "workspace" | "read-only";

export type HarnessCapability = "supported" | "unsupported";

export interface BenchmarkModelSpec {
	id: string;
	displayName: string;
	providerModelId: string;
	/** Optional USD pricing per 1M tokens when known from an authoritative schedule. */
	pricePer1M?: {
		input: number;
		output: number;
		cachedInput?: number;
	} | null;
}

export interface EvalCheckResult {
	name: string;
	kind: "fail_to_pass" | "pass_to_pass" | "hygiene";
	passed: boolean;
	detail?: string;
}

export interface TaskEvalResult {
	resolved: boolean;
	failToPassPassed: number;
	failToPassTotal: number;
	regressionsClean: boolean;
	passToPassPassed: number;
	passToPassTotal: number;
	brokenPreExistingCount: number;
	forbiddenTouches: string[];
	checks: EvalCheckResult[];
}

export interface EvalContext {
	/** Extracted clean final assistant response (or oracle text during `--validate-tasks`). */
	summary?: string;
	/** Raw stdout captured from the harness process. */
	stdout?: string;
	/** Raw stderr captured from the harness process. */
	stderr?: string;
	/** Repository-relative files modified or created in the sandbox. */
	changedFiles?: string[];
}

export interface BenchmarkTaskDef {
	id: string;
	category: TaskCategory;
	title: string;
	description: string;
	timeoutMs: number;
	/** Execution mode for worker harnesses; defaults to "workspace". */
	permissionMode?: PermissionMode;
	/** Files written into the sandbox before the baseline git commit. */
	fixtureFiles: Record<string, string>;
	/** Known-good reference fix used by `--validate-tasks` and unit tests (never shown to workers). */
	oraclePatchFiles: Record<string, string>;
	/** Reference response used by `--validate-tasks` for read-only tasks that evaluate text/JSON output. */
	oracleSummary?: string;
	/** Exact prompt delivered to every CLI harness. */
	prompt: string;
	/** Immutable relative paths that workers must not alter (e.g. raw logs, smoke tests if frozen). */
	protectedPaths?: string[];
	/** Hidden verifier executed outside the agent's control after the worker exits. */
	evaluate: (sandboxDir: string, ctx?: EvalContext) => Promise<TaskEvalResult>;
}

export interface AutonomyAssessment {
	autonomous: boolean;
	timedOut: boolean;
	hungOrPrompted: boolean;
	crashed: boolean;
	exitCode: number | null;
	blockerReason?: string;
}

export interface EfficiencyMetrics {
	durationMs: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	totalTokens: number | null;
	reportedCostUsd: number | null;
	estimatedCostUsd: number | null;
	telemetryComplete: boolean;
	telemetrySource: "stream-usage" | "synthetic-none";
}

export interface CapabilityProbeEntry {
	harness: string;
	model: string;
	supported: HarnessCapability;
	durationMs: number;
	exitCode: number | null;
	usageCaptured: boolean;
	reason?: string;
}

export interface BenchmarkRunRecord {
	schemaVersion: 1;
	runId: string;
	batchId: string;
	track: BenchmarkTrack;
	trialIndex: number;
	taskId: string;
	category: TaskCategory;
	harness: string;
	model: string;
	supported: boolean;
	unsupportedReason?: string;
	resolved: boolean;
	failToPassPassed: number;
	failToPassTotal: number;
	regressionsClean: boolean;
	passToPassPassed: number;
	passToPassTotal: number;
	brokenPreExistingCount: number;
	forbiddenTouches: string[];
	autonomy: AutonomyAssessment;
	efficiency: EfficiencyMetrics;
	changedFiles: string[];
	sentinelLeaked: boolean;
	summaryPreview: string;
	rawLogFile?: string;
	timestamp: string;
}

export interface CellStats {
	key: string;
	harness: string;
	model: string;
	category: TaskCategory | "all";
	n: number;
	kTrials: number;
	resolvedCount: number;
	resolutionRate: number;
	cleanRegressionRate: number;
	autonomyRate: number;
	passAt1: number;
	passAtK: number;
	passPowK: number;
	empiricalAllPassRate: number;
	medianDurationMs: number | null;
	p90DurationMs: number | null;
	iqrDurationMs: number | null;
	durationCv: number | null;
	medianTotalTokens: number | null;
	meanTotalTokens: number | null;
	medianInputTokens: number | null;
	medianOutputTokens: number | null;
	meanEstimatedCostUsd: number | null;
	telemetryCoverageRate: number;
	compositeScore: number;
}

export interface MarginalRanking {
	name: string;
	n: number;
	resolutionRate: number;
	ciLow: number;
	ciHigh: number;
	cleanRegressionRate: number;
	autonomyRate: number;
	passPowK: number;
	medianDurationMs: number | null;
	meanTotalTokens: number | null;
	meanEstimatedCostUsd: number | null;
	telemetryCoverageRate: number;
	compositeScore: number;
}

export interface InteractionResidual {
	harness: string;
	model: string;
	observedRate: number;
	expectedAdditiveRate: number;
	residual: number;
	n: number;
}

export interface RecommendationEntry {
	category: TaskCategory | "overall";
	criterion: "best_overall" | "fastest" | "most_economical" | "most_reliable";
	harness: string;
	model: string;
	resolutionRate: number;
	passPowK: number;
	medianDurationMs: number | null;
	meanTotalTokens: number | null;
	note: string;
}
