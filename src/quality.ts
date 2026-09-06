import { execSync } from "node:child_process";
import { recordDecision } from "./decision-ledger.js";

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

export function getObservedChangedFiles(cwd: string): string[] {
	const set = new Set<string>();

	// 1. Modified / staged files against HEAD
	try {
		const diffOut = execSync("git diff --name-only HEAD", { cwd, encoding: "utf8" }).trim();
		if (diffOut) {
			diffOut.split(/\r?\n/).forEach((f) => {
				const clean = f.trim();
				if (clean) set.add(clean.replace(/\\/g, "/"));
			});
		}
	} catch {
		// Git repository might be empty or HEAD unavailable
	}

	// 2. Untracked and staged files from porcelain status
	try {
		const statusOut = execSync("git status --porcelain -uall", { cwd, encoding: "utf8" }).trim();
		if (statusOut) {
			statusOut.split(/\r?\n/).forEach((line) => {
				const cleanLine = line.trim();
				if (!cleanLine) return;
				const filePath = cleanLine.slice(3).trim();
				const finalPath = filePath.includes(" -> ") ? filePath.split(" -> ")[1].trim() : filePath;
				if (finalPath) {
					set.add(finalPath.replace(/\\/g, "/"));
				}
			});
		}
	} catch {
		// Git command unavailable or non-git directory
	}

	return Array.from(set).sort();
}

export function matchesExpectedFile(observedFile: string, expectedPattern: string): boolean {
	const normObserved = observedFile.replace(/\\/g, "/").replace(/^\.\//, "");
	const normExpected = expectedPattern.replace(/\\/g, "/").replace(/^\.\//, "");

	// 1. Exact path match
	if (normObserved === normExpected) return true;

	// 2. Directory prefix match (if expected is a directory or glob prefix)
	const dirPrefix = normExpected.endsWith("/") ? normExpected : normExpected + "/";
	if (normObserved.startsWith(dirPrefix)) return true;

	// 3. Basename match if expectedPattern is solely a filename without slashes
	if (!normExpected.includes("/") && normObserved.endsWith("/" + normExpected)) {
		return true;
	}

	return false;
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
	const observedChangedFiles = getObservedChangedFiles(cwd);
	const expectedFiles = input.expectedFiles || [];

	const unexpectedFiles = observedChangedFiles.filter((f) => {
		return !expectedFiles.some((ef) => matchesExpectedFile(f, ef));
	});

	const matchesIntent = unexpectedFiles.length === 0;

	const summary = matchesIntent
		? `Postflight passed: ${observedChangedFiles.length} file(s) modified, zero blast-radius violations.`
		: `Postflight warning: ${unexpectedFiles.length} file(s) modified outside expected scope: ${unexpectedFiles.join(", ")}`;

	// Always write audit record to decision ledger
	try {
		recordDecision({
			projectId: "quality-gate",
			decision: matchesIntent ? "postflight_passed" : "postflight_blast_radius_violation",
			decidedBy: "postflight-gate",
			targetKind: "postflight",
			targetId: input.taskId || "unspecified",
			rationale: summary,
		});
	} catch {
		// Decision ledger write is non-blocking
	}

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
