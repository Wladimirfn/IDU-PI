export type ArchitecturalPruningClassification =
	| "duplication"
	| "stale"
	| "dead"
	| "overlap";

export type ArchitecturalPruningSeverity = "low" | "medium" | "high";
export type ArchitecturalPruningConfidence = "low" | "medium" | "high";

export type ArchitecturalPruningCandidate = {
	id: string;
	classification: ArchitecturalPruningClassification;
	severity: ArchitecturalPruningSeverity;
	confidence: ArchitecturalPruningConfidence;
	files: string[];
	exactSeam: string;
	recommendation: string;
	blockedBy: string[];
	tests: string[];
	risks: string[];
};

export type ArchitecturalPruningPlan = {
	version: 1;
	warning: "Advisory pruning plan. Do not delete or refactor without human approval.";
	projectId: string;
	generatedAt: string;
	mode: "advisory_only";
	noDeletion: true;
	noAutoApprove: true;
	stateRootOnlyRuntimeWrites: true;
	mcpAuthority: "advisory";
	candidates: ArchitecturalPruningCandidate[];
	nonGoals: string[];
	recommendedNext: string[];
};

export function buildArchitecturalPruningPlan(input: {
	projectId: string;
	now?: () => Date;
}): ArchitecturalPruningPlan {
	return {
		version: 1,
		warning:
			"Advisory pruning plan. Do not delete or refactor without human approval.",
		projectId: input.projectId,
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		mode: "advisory_only",
		noDeletion: true,
		noAutoApprove: true,
		stateRootOnlyRuntimeWrites: true,
		mcpAuthority: "advisory",
		candidates: pruningCandidates(),
		nonGoals: [
			"Do not delete candidate files.",
			"Do not auto-approve pruning recommendations.",
			"Do not apply refactors from this plan.",
			"Do not promote semantic findings into contracts.",
			"Do not execute AgentLabs.",
			"Do not write runtime reports outside stateRoot.",
		],
		recommendedNext: [
			"Review candidates with the orchestrator before implementation.",
			"Start with the highest-confidence low-blast-radius extraction.",
			"Run fresh review and full tests before any pruning commit.",
		],
	};
}

function pruningCandidates(): ArchitecturalPruningCandidate[] {
	return [
		{
			id: "prune-001",
			classification: "duplication",
			severity: "medium",
			confidence: "high",
			files: [
				"src/supervisor-improvement-decisions.ts",
				"src/skill-improvement-decisions.ts",
			],
			exactSeam:
				"Shared proposal-file decision utilities for latest-file resolution, path containment, backup naming, proposal selection, and status validation; keep domain schemas separate.",
			recommendation:
				"Extract only read/validate/backup primitives after characterization tests. Do not merge supervisor and skill schemas in this slice.",
			blockedBy: ["human approval", "characterization tests", "fresh review"],
			tests: [
				"test/supervisor-improvement-decisions.test.ts",
				"test/skill-improvement-decisions.test.ts",
			],
			risks: [
				"Skill decisions use decisionLog[] while supervisor decisions use a decision object.",
				"Persisted JSON and tested error messages must remain stable.",
			],
		},
		{
			id: "prune-002",
			classification: "duplication",
			severity: "low",
			confidence: "high",
			files: [
				"src/semantic-audit-command.ts",
				"src/semantic-audit-trigger.ts",
				"src/idu-supervisor-loop.ts",
			],
			exactSeam:
				"Shared semantic audit helpers for scannedCounts(stats) and defaultRunId(prefix, projectId, now).",
			recommendation:
				"Extract tiny helpers into a core utility module; keep trigger/checkpoint semantics unchanged.",
			blockedBy: ["focused tests", "fresh review"],
			tests: [
				"test/semantic-audit-command.test.ts",
				"test/semantic-audit-trigger.test.ts",
				"test/idu-supervisor-loop.test.ts",
			],
			risks: [
				"Run ID prefixes differ across manual, trigger, and supervisor flows; keep prefix explicit.",
			],
		},
		{
			id: "prune-003",
			classification: "overlap",
			severity: "medium",
			confidence: "medium",
			files: [
				"src/supervisor-improvement-proposals.ts",
				"src/skill-improvement-proposals.ts",
				"src/agentlab-report-consolidation.ts",
			],
			exactSeam:
				"Advisory proposal envelope fields: warning, createdAt, sourceDraftPath, projectId, evidence trimming, max proposals, and timestamped report path.",
			recommendation:
				"Defer until decision utility extraction is stable. If pursued, extract envelope construction only and keep candidate generation domain-specific.",
			blockedBy: ["human approval", "decision utility seam stability"],
			tests: [
				"test/supervisor-improvement-proposals.test.ts",
				"test/skill-improvement-proposals.test.ts",
				"test/agentlab-report-consolidation.test.ts",
			],
			risks: [
				"Premature abstraction can obscure domain-specific proposal rules.",
			],
		},
		{
			id: "prune-004",
			classification: "stale",
			severity: "low",
			confidence: "low",
			files: [
				"src/semantic-audit-trigger.ts",
				"src/idu-supervisor-hooks.ts",
				"src/idu-supervisor-loop.ts",
			],
			exactSeam:
				"Review whether semantic-audit-trigger remains an active runtime path or only a legacy helper; static grep alone is insufficient.",
			recommendation:
				"Do not delete. Confirm runtime call paths from Telegram/index/hooks, then only extract shared helpers if still active.",
			blockedBy: ["runtime path confirmation", "human approval"],
			tests: [
				"test/semantic-audit-trigger.test.ts",
				"test/idu-supervisor-hooks.test.ts",
				"test/idu-supervisor-e2e.test.ts",
			],
			risks: [
				"May be called indirectly from Telegram/index runtime; deletion would be unsafe without dynamic evidence.",
			],
		},
		{
			id: "prune-005",
			classification: "overlap",
			severity: "medium",
			confidence: "medium",
			files: [
				"src/cli.ts",
				"src/mcp-server.ts",
				"src/command-catalog.ts",
				"docs/mcp-server.md",
				"docs/cli-commands.md",
			],
			exactSeam:
				"Command/tool catalog surfaces repeat advisory safety wording and aliases for governance features.",
			recommendation:
				"If exposing more pruning controls, prefer one MCP read-only plan first and keep decision/apply lifecycle separate.",
			blockedBy: ["orchestrator review", "safe notes audit"],
			tests: [
				"test/idu-cli.test.ts",
				"test/mcp-server.test.ts",
				"test/command-catalog.test.ts",
			],
			risks: [
				"MCP clients may treat recommendations as commands unless decision envelopes and safeNotes remain explicit.",
			],
		},
	];
}
