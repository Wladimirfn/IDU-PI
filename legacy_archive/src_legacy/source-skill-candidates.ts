import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { sourceLibraryPaths } from "./source-library.js";

export type SourceSkillCandidate = {
	candidateId: string;
	title: string;
	suggestedSkillName: string;
	purpose: string;
	triggers: string[];
	sourceIds: string[];
	chunkIds: string[];
	evidenceRefs: string[];
	draftTargetPath: string;
	draftPreview: string;
	limitations: string[];
	duplicateHints: string[];
	requiresHumanApproval: true;
	contractPromotionAllowed: false;
	tokensCostMeasured: false;
	efficiencyEvidence: "no medido";
};

export type SourceSkillCandidateReport = {
	version: 1;
	projectId: string;
	createdAt: string;
	source: "source_library";
	warning: string;
	contractPromotionAllowed: false;
	requiresHumanApproval: true;
	tokensCostMeasured: false;
	efficiencyEvidence: "no medido";
	candidates: SourceSkillCandidate[];
	limitations: string[];
	requiredActions: string[];
};

export type CreateSourceSkillCandidatesOptions = {
	stateRoot: string;
	reportsPath: string;
	projectId: string;
	selector?: string;
	maxCandidates?: number;
	now?: Date;
};

export type SourceSkillCandidateCreationResult = {
	ok: true;
	path: string;
	report: SourceSkillCandidateReport;
};

export type SourceSkillCandidateReview =
	| { ok: true; path: string; report: SourceSkillCandidateReport; errors: [] }
	| { ok: false; path?: string; report?: undefined; errors: string[] };

const FILE_PREFIX = "source-skill-candidates-";
const WARNING =
	"Source-derived skill candidates. Reports-only; no real skills, .agents, .atl, contracts, or project code were modified.";

export function createSourceSkillCandidates(
	options: CreateSourceSkillCandidatesOptions,
): SourceSkillCandidateCreationResult {
	const stateRoot = resolve(options.stateRoot);
	const reportsRoot = resolve(options.reportsPath);
	if (!isInsideDirectory(reportsRoot, stateRoot)) {
		throw new Error("reportsPath must stay inside stateRoot");
	}
	const now = options.now ?? new Date();
	const maxCandidates = Math.max(1, options.maxCandidates ?? 5);
	const paths = sourceLibraryPaths(stateRoot, options.projectId);
	const limitations: string[] = [];
	const requiredActions: string[] = [];
	const candidates: SourceSkillCandidate[] = [];
	if (!existsSync(paths.libraryIndexPath)) {
		limitations.push(`Missing source library index: ${paths.libraryIndexPath}`);
	} else {
		const entries = readLibraryIndexEntries(
			paths.libraryIndexPath,
			limitations,
		);
		for (const entry of entries) {
			if (candidates.length >= maxCandidates) break;
			if (
				options.selector &&
				options.selector !== "all" &&
				options.selector !== "latest" &&
				entry.sourceId !== options.selector
			) {
				continue;
			}
			const digestPath = join(paths.digestsDir, `${entry.sourceId}.json`);
			const digest = readDigest(digestPath, limitations);
			if (!digest) continue;
			if (digest.processingMode === "requires_specialized_reader") {
				requiredActions.push(
					`source ${entry.sourceId} requires specialized reader before skill extraction`,
				);
				continue;
			}
			const candidate = candidateFromDigest(entry, digest, digestPath);
			if (candidate) candidates.push(candidate);
			else {
				limitations.push(
					`source ${entry.sourceId} did not contain reusable skill signals`,
				);
			}
		}
	}
	if (!candidates.length && !limitations.length && !requiredActions.length) {
		limitations.push("No reusable source-derived skill candidates found.");
	}
	const report: SourceSkillCandidateReport = {
		version: 1,
		projectId: safeSlug(options.projectId),
		createdAt: now.toISOString(),
		source: "source_library",
		warning: WARNING,
		contractPromotionAllowed: false,
		requiresHumanApproval: true,
		tokensCostMeasured: false,
		efficiencyEvidence: "no medido",
		candidates,
		limitations,
		requiredActions,
	};
	mkdirSync(reportsRoot, { recursive: true });
	const path = join(reportsRoot, `${FILE_PREFIX}${timestamp(now)}.json`);
	writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return { ok: true, path, report };
}

export function reviewSourceSkillCandidates(
	pathOrLatest: string,
	reportsPath: string,
): SourceSkillCandidateReview {
	const resolved = resolveReportPath(pathOrLatest || "latest", reportsPath);
	if (!resolved.ok) return { ok: false, errors: resolved.errors };
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolved.path, "utf8"));
		const report = parseReport(parsed);
		if (!report) {
			return {
				ok: false,
				path: resolved.path,
				errors: [
					"Invalid source skill candidate report schema or candidate advisory invariants",
				],
			};
		}
		return { ok: true, path: resolved.path, report, errors: [] };
	} catch (error) {
		return {
			ok: false,
			path: resolved.path,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

export function formatSourceSkillCandidateCreationResult(
	result: SourceSkillCandidateCreationResult,
): string {
	return [
		"Source skill candidates",
		"",
		`candidates: ${result.report.candidates.length}`,
		`report: ${result.path}`,
		`warning: ${result.report.warning}`,
		"tokens/cost: no medido",
		"",
		"candidates:",
		...(result.report.candidates.length
			? result.report.candidates.map(
					(candidate) =>
						`- ${candidate.suggestedSkillName}: ${candidate.title}`,
				)
			: ["- none"]),
		...(result.report.limitations.length
			? [
					"",
					"limitations:",
					...result.report.limitations.map((item) => `- ${item}`),
				]
			: []),
		...(result.report.requiredActions.length
			? [
					"",
					"required actions:",
					...result.report.requiredActions.map((item) => `- ${item}`),
				]
			: []),
	].join("\n");
}

export function formatSourceSkillCandidateReview(
	review: SourceSkillCandidateReview,
): string {
	if (!review.ok) {
		return [
			"Source skill candidates review",
			"",
			"Estado:",
			"invalid",
			"",
			"Errores:",
			...review.errors.map((error) => `- ${error}`),
		].join("\n");
	}
	return [
		"Source skill candidates review",
		"",
		"Estado:",
		"valid",
		"",
		`Archivo: ${review.path}`,
		`candidates: ${review.report.candidates.length}`,
		`warning: ${review.report.warning}`,
		"tokens/cost: no medido",
	].join("\n");
}

type IndexEntry = {
	sourceId: string;
	title?: string;
	topics: string[];
	useWhen: string[];
	recommendedReads: string[];
	limitations: string[];
};

type Digest = {
	sourceId: string;
	title: string;
	processingMode?: string;
	summary?: string;
	topics: string[];
	useWhen: string[];
	recommendedReads: string[];
	limitations: string[];
};

function readLibraryIndexEntries(
	path: string,
	limitations: string[],
): IndexEntry[] {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return [];
		return parsed.entries.flatMap((entry): IndexEntry[] => {
			if (!isRecord(entry) || typeof entry.sourceId !== "string") return [];
			return [
				{
					sourceId: entry.sourceId,
					...(typeof entry.title === "string" ? { title: entry.title } : {}),
					topics: stringArray(entry.topics),
					useWhen: stringArray(entry.useWhen),
					recommendedReads: stringArray(entry.recommendedReads),
					limitations: stringArray(entry.limitations),
				},
			];
		});
	} catch (error) {
		limitations.push(
			`Could not read source library index: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

function readDigest(path: string, limitations: string[]): Digest | undefined {
	try {
		if (!existsSync(path)) {
			limitations.push(`Missing source digest: ${path}`);
			return undefined;
		}
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			typeof parsed.sourceId !== "string" ||
			typeof parsed.title !== "string"
		) {
			return undefined;
		}
		return {
			sourceId: parsed.sourceId,
			title: parsed.title,
			...(typeof parsed.processingMode === "string"
				? { processingMode: parsed.processingMode }
				: {}),
			...(typeof parsed.summary === "string"
				? { summary: parsed.summary }
				: {}),
			topics: stringArray(parsed.topics),
			useWhen: stringArray(parsed.useWhen),
			recommendedReads: stringArray(parsed.recommendedReads),
			limitations: stringArray(parsed.limitations),
		};
	} catch (error) {
		limitations.push(
			`Could not read source digest ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

function candidateFromDigest(
	entry: IndexEntry,
	digest: Digest,
	digestPath: string,
): SourceSkillCandidate | undefined {
	const topics = unique([
		...(digest.topics ?? []),
		...(entry.topics ?? []),
	]).slice(0, 6);
	const triggers = unique([
		...(digest.useWhen ?? []),
		...(entry.useWhen ?? []),
	]).slice(0, 6);
	const chunkIds = unique([
		...(digest.recommendedReads ?? []),
		...(entry.recommendedReads ?? []),
	]).slice(0, 6);
	const signalText = [
		...topics,
		...triggers,
		digest.summary ?? "",
		digest.title,
	]
		.join(" ")
		.toLowerCase();
	if (
		!/(practice|practices|testing|test|engineering|architecture|design|security|javascript|typescript|workflow|pattern|standard|convention|quality|review)/u.test(
			signalText,
		)
	) {
		return undefined;
	}
	const suggestedSkillName = safeSlug(
		`${topics[0] ?? digest.title}-${digest.title}`,
	).slice(0, 64);
	const title = digest.title;
	const candidateId =
		`source-skill-${safeSlug(digest.sourceId)}-${safeSlug(suggestedSkillName)}`.slice(
			0,
			96,
		);
	const evidenceRefs = chunkIds.length
		? chunkIds.map((chunkId) => `${digest.sourceId}/${chunkId}`)
		: [`${digest.sourceId}/digest`];
	return {
		candidateId,
		title,
		suggestedSkillName,
		purpose: `Apply source-backed guidance from ${title}.`,
		triggers: triggers.length
			? triggers
			: topics.map((topic) => `${topic} task`),
		sourceIds: [digest.sourceId],
		chunkIds,
		evidenceRefs,
		draftTargetPath: `.agents/skills/${suggestedSkillName}/SKILL.md`,
		draftPreview: skillDraftPreview(
			suggestedSkillName,
			title,
			triggers,
			topics,
			evidenceRefs,
			digestPath,
		),
		limitations: [...(digest.limitations ?? []), ...(entry.limitations ?? [])],
		duplicateHints: [],
		requiresHumanApproval: true,
		contractPromotionAllowed: false,
		tokensCostMeasured: false,
		efficiencyEvidence: "no medido",
	};
}

function skillDraftPreview(
	name: string,
	title: string,
	triggers: string[],
	topics: string[],
	evidenceRefs: string[],
	digestPath: string,
): string {
	return [
		"---",
		`name: ${name}`,
		`description: Source-derived candidate from ${title}. Requires human approval before installation.`,
		"---",
		"",
		"# Source-derived skill candidate",
		"",
		"Use this candidate only after human approval and AgentLab review when required.",
		"",
		"## Triggers",
		...(triggers.length
			? triggers.map((item) => `- ${item}`)
			: ["- Source-backed task matching the evidence below"]),
		"",
		"## Guidance topics",
		...(topics.length
			? topics.map((item) => `- ${item}`)
			: ["- Review source digest before use"]),
		"",
		"## Source evidence",
		`- digest: ${digestPath}`,
		...evidenceRefs.map((ref) => `- ${ref}`),
		"",
		"## Limits",
		"- Reports-only candidate; do not install without approval.",
		"- tokens/cost: no medido",
	].join("\n");
}

function resolveReportPath(
	pathOrLatest: string,
	reportsPath: string,
): { ok: true; path: string } | { ok: false; errors: string[] } {
	const reportsRoot = resolve(reportsPath);
	if (pathOrLatest === "latest") {
		const latest = latestReportFile(reportsRoot);
		return latest
			? { ok: true, path: latest }
			: { ok: false, errors: ["No source skill candidate reports found"] };
	}
	const resolved = resolve(pathOrLatest);
	if (!isInsideDirectory(resolved, reportsRoot)) {
		return { ok: false, errors: ["Report path is outside reports directory"] };
	}
	if (!existsSync(resolved)) {
		return { ok: false, errors: [`Report not found: ${resolved}`] };
	}
	return { ok: true, path: resolved };
}

function latestReportFile(reportsRoot: string): string | undefined {
	if (!existsSync(reportsRoot)) return undefined;
	const latest = readdirSync(reportsRoot)
		.filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(".json"))
		.sort()
		.at(-1);
	return latest ? join(reportsRoot, latest) : undefined;
}

function parseReport(value: unknown): SourceSkillCandidateReport | undefined {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		value.source !== "source_library"
	) {
		return undefined;
	}
	if (
		value.contractPromotionAllowed !== false ||
		value.requiresHumanApproval !== true ||
		value.tokensCostMeasured !== false ||
		value.efficiencyEvidence !== "no medido" ||
		!Array.isArray(value.candidates) ||
		!Array.isArray(value.limitations) ||
		!Array.isArray(value.requiredActions)
	) {
		return undefined;
	}
	if (!value.candidates.every(isSafeCandidate)) return undefined;
	return value as SourceSkillCandidateReport;
}

function isSafeCandidate(value: unknown): value is SourceSkillCandidate {
	if (!isRecord(value)) return false;
	if (
		value.requiresHumanApproval !== true ||
		value.contractPromotionAllowed !== false ||
		value.tokensCostMeasured !== false ||
		value.efficiencyEvidence !== "no medido"
	) {
		return false;
	}
	if (
		typeof value.candidateId !== "string" ||
		typeof value.title !== "string" ||
		typeof value.suggestedSkillName !== "string" ||
		typeof value.purpose !== "string" ||
		typeof value.draftTargetPath !== "string" ||
		typeof value.draftPreview !== "string"
	) {
		return false;
	}
	if (
		!Array.isArray(value.triggers) ||
		!Array.isArray(value.sourceIds) ||
		!Array.isArray(value.chunkIds) ||
		!Array.isArray(value.evidenceRefs) ||
		!Array.isArray(value.limitations) ||
		!Array.isArray(value.duplicateHints)
	) {
		return false;
	}
	if (!isSafeDraftTargetPath(value.draftTargetPath)) return false;
	return [
		value.triggers,
		value.sourceIds,
		value.chunkIds,
		value.evidenceRefs,
		value.limitations,
		value.duplicateHints,
	].every((items) => items.every((item) => typeof item === "string"));
}

function isSafeDraftTargetPath(path: string): boolean {
	if (path.includes("\\")) return false;
	if (path.startsWith("/") || /^[a-z]:/iu.test(path)) return false;
	const parts = path.split("/");
	if (parts.some((part) => !part || part === "." || part === "..")) {
		return false;
	}
	return (
		parts.length === 4 &&
		parts[0] === ".agents" &&
		parts[1] === "skills" &&
		parts[3] === "SKILL.md"
	);
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function safeSlug(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/gu, "-")
			.replace(/^-+|-+$/gu, "") || "source-skill"
	);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter(
					(item): item is string =>
						typeof item === "string" && Boolean(item.trim()),
				)
				.map((item) => item.trim())
		: [];
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsideDirectory(path: string, directory: string): boolean {
	return (
		path === directory ||
		path.startsWith(`${directory}\\`) ||
		path.startsWith(`${directory}/`)
	);
}
