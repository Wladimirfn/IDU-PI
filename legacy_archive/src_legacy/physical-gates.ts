import type {
	ProjectPostflightGitState,
	ProjectPostflightReport,
} from "./project-postflight.js";

export type PhysicalGateKind =
	| "build"
	| "test"
	| "git_status"
	| "diff"
	| "report_hygiene"
	| "safe_push";

export type PhysicalGateStatus =
	| "pass"
	| "fail"
	| "warn"
	| "not_run"
	| "error"
	| "needs_evidence";

export type PhysicalGateCommand = {
	exe: string;
	args: string[];
	cwd: string;
};

export type PhysicalGateEvidence = {
	id: string;
	kind: PhysicalGateKind;
	status: PhysicalGateStatus;
	summary: string;
	advisoryOnly: true;
	destructive: false;
	command?: PhysicalGateCommand;
	observedAt?: string;
	exitCode?: number | null;
	stdoutExcerpt?: string;
	stderrExcerpt?: string;
	data?: Record<string, unknown>;
};

export type BuildPostflightPhysicalGatesInput = {
	projectPath: string;
	gitState: ProjectPostflightGitState;
	report: ProjectPostflightReport;
	observedAt?: string;
};

export function buildPostflightPhysicalGates(
	input: BuildPostflightPhysicalGatesInput,
): PhysicalGateEvidence[] {
	const observedAt = input.observedAt ?? "deterministic";
	return [
		gitStatusGate(input.projectPath, input.gitState, observedAt),
		diffGate(input.projectPath, input.gitState, observedAt),
		reportHygieneGate(input.report, observedAt),
		buildNotRunGate(input.projectPath, observedAt),
		testNotRunGate(input.projectPath, observedAt),
	];
}

function gitStatusGate(
	projectPath: string,
	gitState: ProjectPostflightGitState,
	observedAt: string,
): PhysicalGateEvidence {
	const gitStatusWarning = gitState.warnings.find((warning) =>
		/git status/u.test(warning),
	);
	if (gitStatusWarning) {
		return gate({
			id: "physical-git-status",
			kind: "git_status",
			status: "error",
			summary: gitStatusWarning,
			command: { exe: "git", args: ["status", "--porcelain"], cwd: projectPath },
			observedAt,
			stderrExcerpt: gitStatusWarning,
		});
	}
	return gate({
		id: "physical-git-status",
		kind: "git_status",
		status: gitState.changedFiles.length > 0 ? "warn" : "pass",
		summary:
			gitState.changedFiles.length > 0
				? `Git status observed ${gitState.changedFiles.length} changed file(s).`
				: "Git status observed a clean tree.",
		command: { exe: "git", args: ["status", "--porcelain"], cwd: projectPath },
		observedAt,
		stdoutExcerpt: gitState.changedFiles.slice(0, 20).join("\n"),
		data: { changedFiles: gitState.changedFiles },
	});
}

function diffGate(
	projectPath: string,
	gitState: ProjectPostflightGitState,
	observedAt: string,
): PhysicalGateEvidence {
	const diffWarnings = gitState.warnings.filter((warning) => /git diff/u.test(warning));
	if (diffWarnings.length > 0) {
		return gate({
			id: "physical-diff",
			kind: "diff",
			status: "error",
			summary: diffWarnings.join(" | "),
			command: { exe: "git", args: ["diff", "--stat"], cwd: projectPath },
			observedAt,
			stderrExcerpt: diffWarnings.join("\n"),
		});
	}
	return gate({
		id: "physical-diff",
		kind: "diff",
		status: gitState.diffSummary?.trim() ? "warn" : "pass",
		summary: gitState.diffSummary?.trim()
			? "Git diff stat is present."
			: "Git diff stat is empty.",
		command: { exe: "git", args: ["diff", "--stat"], cwd: projectPath },
		observedAt,
		stdoutExcerpt: excerpt(gitState.diffSummary ?? ""),
	});
}

function reportHygieneGate(
	report: ProjectPostflightReport,
	observedAt: string,
): PhysicalGateEvidence {
	const blocker = report.risk === "blocker" || report.requiresHumanConfirmation;
	return gate({
		id: "physical-report-hygiene",
		kind: "report_hygiene",
		status: blocker ? "needs_evidence" : report.risk === "low" ? "pass" : "warn",
		summary: blocker
			? "Postflight report requires human review or additional evidence."
			: `Postflight report risk: ${report.risk}.`,
		observedAt,
		data: {
			risk: report.risk,
			requiresHumanConfirmation: report.requiresHumanConfirmation,
			warnings: report.warnings,
		},
	});
}

function buildNotRunGate(projectPath: string, observedAt: string): PhysicalGateEvidence {
	return gate({
		id: "physical-build-not-run",
		kind: "build",
		status: "not_run",
		summary: "Build command was not run automatically by Idu-pi.",
		command: { exe: "corepack", args: ["pnpm", "build"], cwd: projectPath },
		observedAt,
	});
}

function testNotRunGate(projectPath: string, observedAt: string): PhysicalGateEvidence {
	return gate({
		id: "physical-test-not-run",
		kind: "test",
		status: "not_run",
		summary: "Test command was not run automatically by Idu-pi.",
		command: { exe: "corepack", args: ["pnpm", "test"], cwd: projectPath },
		observedAt,
	});
}

function gate(
	input: Omit<PhysicalGateEvidence, "advisoryOnly" | "destructive">,
): PhysicalGateEvidence {
	return { ...input, advisoryOnly: true, destructive: false };
}

function excerpt(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > 1_000 ? `${trimmed.slice(0, 980).trimEnd()}\n[truncated]` : trimmed;
}
