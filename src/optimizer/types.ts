import type { IduProfile, QuotaSnapshot } from "../types.js";

export type BillingModel = "plan" | "api";

export interface ProviderAuthSummary {
	provider: string;
	harnessHints: string[];
	authType: BillingModel;
	source: string;
	authStatus?: "active" | "expired" | "free-tier-only" | "invalid";
	remainingCreditsUsd?: number | null;
	baseUrl?: string;
	liveEndpointQueried?: boolean;
	liveModelCount?: number;
	discoveryNote?: string;
}

export interface DiscoveredModelCandidate {
	harness: string;
	provider: string;
	modelId: string;
	/** Exact string passed to CLI/profile `model` field (e.g. `custom_provider:nan/glm5.3-flash`, `nan/hy4`, `openai/gpt-6.1-terra`). */
	profileModel: string;
	displayName: string;
	billingModel: BillingModel;
	source: "live-endpoint" | "cli-list" | "local-config" | "quota";
	contextWindow: number | null;
	reasoning?: boolean;
	supportsToolCall?: boolean;
	inlinePricing?: {
		inputPer1M: number | null;
		outputPer1M: number | null;
	};
}

export interface CliDiscoverySummary {
	harness: string;
	command: string;
	available: boolean;
	billingModel: BillingModel | "mixed" | "unknown";
	planLabel: string | null;
	remainingPercent: number | null;
	authProviders: string[];
	discoveredModelCount: number;
	note?: string;
}

export interface AaModelMetrics {
	id: string;
	name: string;
	creator?: string;
	intelligenceIndex: number | null;
	codingScore: number | null;
	visual3dScore: number | null;
	outputSpeedTokPerSec: number | null;
	ttftSeconds: number | null;
	timePerTaskSeconds: number | null;
	price1mInputUsd: number | null;
	price1mOutputUsd: number | null;
	price1mBlendedUsd: number | null;
	contextWindowTokens: number | null;
	isReasoning?: boolean;
	source: "aa-v2-api" | "aa-ssr-catalog" | "cached";
}

export interface AaMatchResult {
	matched: AaModelMetrics | null;
	confidence: "exact" | "normalized" | "family" | "unmatched";
	normalizedQuery: string;
}

export interface RoleObjectiveSpec {
	role: string;
	concept: string;
	permissions: "read-only" | "workspace";
	benchmarkTaskId: string | null;
	benchmarkCategory: string | null;
	weights: {
		intelligence: number;
		coding: number;
		speed: number;
		costEfficiency: number;
		visual3d: number;
	};
	/** Estimated average total tokens per mini-benchmark run on this role's task. */
	estBenchTokensPerCell: number;
	/** Estimated wall time in seconds per mini-benchmark run on this role's task. */
	estBenchDurationSecPerCell: number;
	preferFastCheapForMiniBench?: boolean;
	notes?: string;
}

export interface HistoricalBenchMetric {
	harness: string;
	model: string;
	taskId: string;
	runs: number;
	resolvedRate: number;
	regressionsCleanRate: number;
	medianDurationMs: number;
	meanTokens: number | null;
	meanCostUsd: number | null;
	batchId: string;
}

export interface ScoredCandidate {
	harness: string;
	provider: string;
	modelId: string;
	profileModel: string;
	/** Explicit profile `provider` field when CLI uses `--provider` (`pi`, `gentle-shell`, `opencode`, `qwen`). */
	profileProvider?: string;
	displayName: string;
	billingModel: BillingModel;
	compositeScore: number;
	breakdown: {
		quality: number;
		coding: number;
		speed: number;
		costEfficiency: number;
		visual3d: number;
		historicalBonus: number;
		planHeadroomPenalty: number;
	};
	aaMatch: AaMatchResult;
	estCostPerBenchRunUsd: number;
	quotaRemainingPercent: number | null;
	historical?: HistoricalBenchMetric;
	rationale: string;
}

export interface MiniBenchCellPlan {
	role: string;
	harness: string;
	provider: string;
	modelId: string;
	profileModel: string;
	profileProvider?: string;
	billingModel: BillingModel;
	taskId: string;
	permissionMode: "read-only" | "workspace";
	targetProfiles: string[];
	estCostUsd: number;
	estDurationSec: number;
	aaScore: number;
	reason: string;
}

export interface RoleCurrentProfileSummary {
	profileName: string;
	rank: number;
	harness: string;
	provider?: string;
	model?: string;
	permissions: "read-only" | "workspace";
	description?: string;
}

export interface RoleProposalSummary {
	role: string;
	concept: string;
	permissions: "read-only" | "workspace";
	benchmarkTaskId: string | null;
	currentProfiles: RoleCurrentProfileSummary[];
	topCandidates: ScoredCandidate[];
	shortlist: MiniBenchCellPlan[];
	notes: string[];
}

export interface OptimizeProposal {
	schemaVersion: 1;
	generatedAt: string;
	iduHome: string;
	aaSource: "aa-v2-api" | "aa-ssr-catalog" | "cached" | "unavailable";
	aaFetchedAt: string | null;
	aaModelCount: number;
	clis: CliDiscoverySummary[];
	providers: ProviderAuthSummary[];
	quotas: QuotaSnapshot[];
	discoveredModelCount: number;
	roles: RoleProposalSummary[];
	shortlist: MiniBenchCellPlan[];
	estimatedTotalCostUsd: number;
	estimatedDurationSec: number;
	estimatedPlanCalls: number;
	warnings: string[];
}

export interface MiniBenchCellOutcome {
	role: string;
	harness: string;
	provider: string;
	modelId: string;
	profileModel: string;
	profileProvider?: string;
	billingModel: BillingModel;
	taskId: string;
	supported: boolean;
	unsupportedReason?: string;
	resolved: boolean;
	regressionsClean: boolean;
	autonomous: boolean;
	failToPassPassed: number;
	failToPassTotal: number;
	durationMs: number;
	totalTokens: number | null;
	costUsd: number | null;
	compositeBenchScore: number;
	summaryPreview: string;
	error?: string;
}

export interface ProfileChangeRecommendation {
	profileName: string;
	role: string;
	action: "keep" | "update" | "manual-review";
	current: {
		harness: string;
		provider?: string;
		model?: string;
	};
	recommended: {
		harness: string;
		provider?: string;
		model: string;
		description: string;
	};
	reason: string;
	applyAllowed: boolean;
}

export interface OptimizeRunResult {
	schemaVersion: 1;
	runId: string;
	executedAt: string;
	proposalGeneratedAt: string;
	userConfigUntouched: boolean;
	outcomes: MiniBenchCellOutcome[];
	recommendations: ProfileChangeRecommendation[];
	warnings: string[];
}

export interface OptimizeApplyOutcome {
	appliedAt: string;
	profilesPath: string;
	backupPath: string | null;
	updatedProfiles: Array<{
		profileName: string;
		before: Pick<IduProfile, "harness" | "provider" | "model">;
		after: Pick<IduProfile, "harness" | "provider" | "model">;
	}>;
	skippedProfiles: Array<{
		profileName: string;
		reason: string;
	}>;
}
