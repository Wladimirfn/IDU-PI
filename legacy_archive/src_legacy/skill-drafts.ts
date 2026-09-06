import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	SkillImprovementProposalType,
	SkillImprovementRisk,
} from "./skill-improvement-proposals.js";
import {
	loadSkillImprovementProposalFile,
	type SkillImprovementProposalWithDecision,
} from "./skill-improvement-decisions.js";

export type SkillDraft = {
	proposalId: string;
	action: "create_skill" | "improve_skill" | "validate_skill";
	skillName: string;
	targetPath?: string;
	title: string;
	purpose: string;
	whenToUse: string;
	safetyRules: string[];
	inputsExpected: string[];
	outputsExpected: string[];
	testsSuggested: string[];
	contentPreview: string;
	requiresHumanApproval: true;
};

export type SkillDraftPlan = {
	generatedAt: string;
	sourceProposalFile: string;
	warning: "Borrador de skill. No es fuente de verdad.";
	skillDrafts: SkillDraft[];
	omittedProposals: SkillDraftOmittedProposal[];
};

export type SkillDraftOmittedProposal = {
	id: string;
	type: string;
	status: string;
	reason: string;
};

export type SkillDraftCreationResult = {
	path?: string;
	plan: SkillDraftPlan;
	created: SkillDraft[];
	omittedProposals: SkillDraftOmittedProposal[];
	notApplicable: SkillDraftOmittedProposal[];
};

export type SkillDraftReview = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	plan?: SkillDraftPlan;
};

type CreateOptions = {
	now?: () => Date;
};

const WARNING = "Borrador de skill. No es fuente de verdad." as const;
const DRAFT_RE = /^skill-draft-\d{8}-\d{6}\.json$/u;
const APPLICABLE_TYPES = new Set([
	"create_skill",
	"improve_skill",
	"validate_skill",
]);
const NOT_APPLICABLE_TYPES = new Set(["archive_skill", "move_skill"]);
const SECRET_PATTERN =
	/(token|secret|password|api[_-]?key|bearer|credentials?)\s*[:=]?\s*[^\s,;\]}]+/giu;

export function createSkillDraftsFromApprovedProposals(
	pathOrLatest: string,
	reportsPath: string,
	options: CreateOptions = {},
): SkillDraftCreationResult {
	const now = options.now?.() ?? new Date();
	const sourceFile = loadSkillImprovementProposalFile(
		pathOrLatest,
		reportsPath,
	);
	const generatedAt = now.toISOString();
	const skillDrafts: SkillDraft[] = [];
	const omittedProposals: SkillDraftOmittedProposal[] = [];
	const notApplicable: SkillDraftOmittedProposal[] = [];
	for (const proposal of sourceFile.proposals) {
		if (proposal.status !== "approved") {
			omittedProposals.push(omit(proposal, "status no aprobado"));
			continue;
		}
		if (NOT_APPLICABLE_TYPES.has(proposal.type)) {
			const omitted = omit(proposal, "tipo no aplicable todavía");
			notApplicable.push(omitted);
			omittedProposals.push(omitted);
			continue;
		}
		if (!APPLICABLE_TYPES.has(proposal.type)) {
			omittedProposals.push(omit(proposal, "tipo desconocido"));
			continue;
		}
		skillDrafts.push(buildDraft(proposal));
	}
	const plan: SkillDraftPlan = {
		generatedAt,
		sourceProposalFile: basename(sourceFile.path),
		warning: WARNING,
		skillDrafts,
		omittedProposals,
	};
	if (!skillDrafts.length) {
		return { plan, created: [], omittedProposals, notApplicable };
	}
	mkdirSync(reportsPath, { recursive: true });
	const path = join(reportsPath, `skill-draft-${timestamp(now)}.json`);
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
	return {
		path,
		plan,
		created: skillDrafts,
		omittedProposals,
		notApplicable,
	};
}

export function reviewSkillDraft(
	pathOrLatest: string,
	reportsPath: string,
): SkillDraftReview {
	const resolved = resolveDraftPath(pathOrLatest, reportsPath);
	if (!resolved.valid) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: resolved.errors,
		};
	}
	try {
		const parsed = JSON.parse(readFileSync(resolved.path, "utf8")) as unknown;
		const plan = normalizeDraftPlan(parsed);
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: true,
			errors: [],
			plan,
		};
	} catch (error) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: [
				`No pude leer JSON válido de draft de skill: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

export function formatSkillDraftCreationResult(
	result: SkillDraftCreationResult,
): string {
	return [
		"Skill Drafts Created",
		"",
		"Ruta:",
		result.path ?? "-",
		"",
		"Drafts:",
		...(result.created.length
			? result.created.map(
					(draft) => `- ${draft.proposalId} ${draft.action} ${draft.skillName}`,
				)
			: ["- ninguno"]),
		"",
		"Omitidas:",
		...formatOmitted(result.omittedProposals),
		"",
		"Nota segura:",
		"Sólo guardé borradores en reports. No modifiqué skills reales, .agents ni .atl. No ejecuté AgentLabs.",
	].join("\n");
}

export function formatSkillDraftReview(review: SkillDraftReview): string {
	if (!review.valid || !review.plan) {
		return [
			"Skill Draft Review",
			"",
			"Draft válido:",
			"no",
			"",
			"Errores:",
			...formatList(review.errors),
			"",
			"Nota segura:",
			"No modifiqué skills reales, .agents ni .atl. No ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"Skill Draft Review",
		"",
		"Archivo:",
		review.name,
		"",
		"Warning:",
		review.plan.warning,
		"",
		"Drafts:",
		...(review.plan.skillDrafts.length
			? review.plan.skillDrafts.flatMap((draft, index) => [
					`${index + 1}. ${draft.skillName} — ${draft.action}`,
					`   Purpose: ${draft.purpose}`,
					`   When to use: ${draft.whenToUse}`,
					"   Safety rules:",
					...draft.safetyRules.map((item) => `   - ${item}`),
					"   Tests suggested:",
					...draft.testsSuggested.map((item) => `   - ${item}`),
				])
			: ["- ninguno"]),
		"",
		"Omitted proposals:",
		...formatOmitted(review.plan.omittedProposals),
		"",
		"Nota segura:",
		"No modifiqué skills reales, .agents ni .atl. No ejecuté AgentLabs.",
	].join("\n");
}

function buildDraft(
	proposal: SkillImprovementProposalWithDecision,
): SkillDraft {
	const purpose = purposeFor(proposal);
	const whenToUse = whenToUseFor(proposal);
	const targetPath = `.agents/skills/${normalizeSkillName(proposal.skillName)}/SKILL.md`;
	return {
		proposalId: proposal.id,
		action: proposal.type as
			| "create_skill"
			| "improve_skill"
			| "validate_skill",
		skillName: proposal.skillName,
		...(proposal.type === "create_skill" || proposal.type === "improve_skill"
			? { targetPath }
			: {}),
		title: proposal.title,
		purpose,
		whenToUse,
		safetyRules: safetyRulesFor(proposal),
		inputsExpected: [
			"Human-approved skill proposal",
			"Relevant evidence from semantic compaction",
			"Existing project safety constraints",
		],
		outputsExpected: [
			"Reviewable SKILL.md draft content",
			"Explicit safety rules and non-goals",
			"Suggested tests or validation checks",
		],
		testsSuggested: testsFor(proposal),
		contentPreview: contentPreviewFor(proposal, purpose, whenToUse),
		requiresHumanApproval: true,
	};
}

function purposeFor(proposal: SkillImprovementProposalWithDecision): string {
	return redact(
		`Draft for ${proposal.skillName}: ${proposal.description || proposal.title}`,
	);
}

function whenToUseFor(proposal: SkillImprovementProposalWithDecision): string {
	const evidence = proposal.evidence.join("; ");
	if (
		/auth|login|security|seguridad/iu.test(`${proposal.skillName} ${evidence}`)
	) {
		return "Use when reviewing auth, login, session, access, or security-sensitive changes.";
	}
	if (
		/db|database|base de datos|schema|sql/iu.test(
			`${proposal.skillName} ${evidence}`,
		)
	) {
		return "Use when reviewing database, schema, migration, queue, or data-loss risk changes.";
	}
	if (
		/project core|constitution|arquitect/iu.test(
			`${proposal.skillName} ${evidence}`,
		)
	) {
		return "Use when project understanding, Project Core, Constitution, or architecture alignment is required.";
	}
	return `Use when evidence matches the approved proposal for ${proposal.skillName}.`;
}

function safetyRulesFor(
	proposal: SkillImprovementProposalWithDecision,
): string[] {
	const rules = [
		"Do not modify files automatically; produce reviewable guidance only.",
		"Do not read .env or expose secrets; redact token/secret/password/apiKey/bearer/credentials.",
		"Do not execute AgentLabs unless a future human-approved stage explicitly requests it.",
		"Preserve Project Core, Constitution, blueprint, flows, and existing skills until human approval.",
	];
	if (proposal.type === "validate_skill") {
		rules.push(
			"Validation drafts must not claim a skill is useful without evidence.",
		);
	}
	return rules;
}

function testsFor(proposal: SkillImprovementProposalWithDecision): string[] {
	return [
		`Review generated draft for ${proposal.skillName} against approved proposal ${proposal.id}.`,
		"Verify no .agents/.atl files changed before apply stage.",
		"Run skill-check before any future manual application.",
		"Confirm examples and triggers do not broaden scope beyond evidence.",
	];
}

function contentPreviewFor(
	proposal: SkillImprovementProposalWithDecision,
	purpose: string,
	whenToUse: string,
): string {
	return redact(
		[
			"---",
			`name: ${normalizeSkillName(proposal.skillName)}`,
			`description: ${short(purpose, 180)}`,
			"---",
			"",
			`# ${proposal.skillName}`,
			"",
			"## Purpose",
			purpose,
			"",
			"## When to use",
			whenToUse,
			"",
			"## Safety",
			"- Review-only draft. Do not apply automatically.",
			"- Preserve human approval gates.",
		].join("\n"),
	);
}

function omit(
	proposal: SkillImprovementProposalWithDecision,
	reason: string,
): SkillDraftOmittedProposal {
	return {
		id: proposal.id,
		type: proposal.type,
		status: proposal.status,
		reason,
	};
}

function resolveDraftPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestDraftFile(reports);
		return latest
			? { valid: true, path: latest, errors: [] }
			: {
					valid: false,
					path: reports,
					errors: ["No encontré archivos skill-draft-*.json en reports."],
				};
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed) {
		return {
			valid: false,
			path: reports,
			errors: ["Falta ruta de skill draft."],
		};
	}
	const candidate = resolve(
		isAbsolute(trimmed) ? trimmed : join(reports, trimmed),
	);
	const relativeToReports = relative(reports, candidate);
	if (
		relativeToReports === "" ||
		relativeToReports.startsWith("..") ||
		isAbsolute(relativeToReports)
	) {
		return {
			valid: false,
			path: candidate,
			errors: ["La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports."],
		};
	}
	if (!DRAFT_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: ["El archivo debe llamarse skill-draft-*.json."],
		};
	}
	if (!existsSync(candidate)) {
		return {
			valid: false,
			path: candidate,
			errors: [`No existe archivo: ${candidate}`],
		};
	}
	return { valid: true, path: candidate, errors: [] };
}

function latestDraftFile(reportsPath: string): string | undefined {
	if (!existsSync(reportsPath)) return undefined;
	const latest = readdirSync(reportsPath)
		.filter((file) => DRAFT_RE.test(file))
		.sort()
		.at(-1);
	return latest ? join(reportsPath, latest) : undefined;
}

function normalizeDraftPlan(value: unknown): SkillDraftPlan {
	if (!isRecord(value)) throw new Error("Skill draft inválido.");
	if (value.warning !== WARNING) throw new Error("Warning de draft inválido.");
	if (typeof value.generatedAt !== "string")
		throw new Error("generatedAt inválido.");
	if (typeof value.sourceProposalFile !== "string") {
		throw new Error("sourceProposalFile inválido.");
	}
	if (!Array.isArray(value.skillDrafts))
		throw new Error("skillDrafts[] inválido.");
	if (!Array.isArray(value.omittedProposals)) {
		throw new Error("omittedProposals[] inválido.");
	}
	return {
		generatedAt: value.generatedAt,
		sourceProposalFile: value.sourceProposalFile,
		warning: WARNING,
		skillDrafts: value.skillDrafts.map(normalizeDraft),
		omittedProposals: value.omittedProposals.map(normalizeOmitted),
	};
}

function normalizeDraft(value: unknown): SkillDraft {
	if (!isRecord(value)) throw new Error("skillDraft inválido.");
	const action = value.action;
	if (
		action !== "create_skill" &&
		action !== "improve_skill" &&
		action !== "validate_skill"
	) {
		throw new Error("skillDraft action inválida.");
	}
	for (const field of [
		"proposalId",
		"skillName",
		"title",
		"purpose",
		"whenToUse",
		"contentPreview",
	]) {
		if (typeof value[field] !== "string")
			throw new Error(`skillDraft ${field} inválido.`);
	}
	if (
		!isStringArray(value.safetyRules) ||
		!isStringArray(value.inputsExpected) ||
		!isStringArray(value.outputsExpected) ||
		!isStringArray(value.testsSuggested)
	) {
		throw new Error("skillDraft arrays inválidos.");
	}
	if (value.requiresHumanApproval !== true) {
		throw new Error("skillDraft requiere aprobación humana.");
	}
	return value as unknown as SkillDraft;
}

function normalizeOmitted(value: unknown): SkillDraftOmittedProposal {
	if (!isRecord(value)) throw new Error("omittedProposals inválido.");
	return {
		id: typeof value.id === "string" ? value.id : "unknown",
		type: typeof value.type === "string" ? value.type : "unknown",
		status: typeof value.status === "string" ? value.status : "unknown",
		reason: typeof value.reason === "string" ? value.reason : "sin motivo",
	};
}

function normalizeSkillName(skillName: string): string {
	return skillName
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function redact(text: string): string {
	return text.replace(SECRET_PATTERN, "$1=[REDACTED]");
}

function short(text: string, max: number): string {
	const compact = text.replace(/\s+/gu, " ").trim();
	return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function formatOmitted(items: SkillDraftOmittedProposal[]): string[] {
	return items.length
		? items.map(
				(item) => `- ${item.id} ${item.type} ${item.status} — ${item.reason}`,
			)
		: ["- ninguna"];
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function timestamp(date: Date): string {
	const compact = date
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14);
	return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
}
