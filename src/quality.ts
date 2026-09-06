import { execSync } from "node:child_process";

export type ChangeMode = "additive" | "modification" | "refactor" | "destructive";

export type RiskLevel = "low" | "medium" | "high";

export interface PreflightInput {
	request: string;
	expectedFiles?: string[];
	changeMode?: ChangeMode;
	cwd?: string;
}

export interface PreflightResult {
	okToProceed: boolean;
	risk: RiskLevel;
	request: string;
	changeMode: ChangeMode;
	expectedFiles: string[];
	uncommittedCount: number;
	uncommittedFiles: string[];
	advisory: string;
}

export interface PostflightInput {
	taskId?: string;
	expectedFiles?: string[];
	cwd?: string;
}

export interface PostflightResult {
	taskId: string;
	matchesIntent: boolean;
	observedChangedCount: number;
	observedChangedFiles: string[];
	unexpectedFiles: string[];
	blastRadiusSafe: boolean;
	summary: string;
}

function getGitStatus(cwd: string): string[] {
	try {
		const out = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
		return out ? out.split("\n").map((l) => l.trim()) : [];
	} catch {
		return [];
	}
}

function getGitDiffFiles(cwd: string): string[] {
	try {
		const out = execSync("git diff --name-only HEAD", { cwd, encoding: "utf8" }).trim();
		return out ? out.split("\n").map((l) => l.trim()) : [];
	} catch {
		return [];
	}
}

export function runPreflight(input: PreflightInput): PreflightResult {
	const cwd = input.cwd || process.cwd();
	const dirtyFiles = getGitStatus(cwd);
	const changeMode = input.changeMode || "modification";
	const expectedFiles = input.expectedFiles || [];

	const risk: RiskLevel =
		dirtyFiles.length > 15 || changeMode === "destructive"
			? "high"
			: dirtyFiles.length > 0 || changeMode === "refactor"
				? "medium"
				: "low";

	const advisory =
		risk === "low"
			? "Working tree is clean. Low risk change; safe to proceed."
			: risk === "medium"
				? `Working tree has ${dirtyFiles.length} uncommitted file(s). Review git status before applying refactors.`
				: `High risk: large uncommitted set (${dirtyFiles.length} files) or destructive mode. Stash or commit before proceeding.`;

	return {
		okToProceed: risk !== "high",
		risk,
		request: input.request,
		changeMode,
		expectedFiles,
		uncommittedCount: dirtyFiles.length,
		uncommittedFiles: dirtyFiles.slice(0, 20),
		advisory,
	};
}

export function runPostflight(input: PostflightInput): PostflightResult {
	const cwd = input.cwd || process.cwd();
	const observedChangedFiles = getGitDiffFiles(cwd);
	const expectedFiles = input.expectedFiles || [];

	const unexpectedFiles = observedChangedFiles.filter(
		(f) => expectedFiles.length > 0 && !expectedFiles.some((ef) => f.includes(ef) || ef.includes(f)),
	);

	const matchesIntent = unexpectedFiles.length === 0;

	const summary = matchesIntent
		? `Postflight passed: ${observedChangedFiles.length} file(s) modified, zero blast-radius violations.`
		: `Postflight warning: ${unexpectedFiles.length} file(s) modified outside expected scope: ${unexpectedFiles.join(", ")}`;

	return {
		taskId: input.taskId || "unspecified",
		matchesIntent,
		observedChangedCount: observedChangedFiles.length,
		observedChangedFiles,
		unexpectedFiles,
		blastRadiusSafe: matchesIntent,
		summary,
	};
}
