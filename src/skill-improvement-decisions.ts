import {
	copyFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	SkillImprovementAction,
	SkillImprovementBenefit,
	SkillImprovementProposal,
	SkillImprovementProposalType,
	SkillImprovementRisk,
	SkillImprovementStatus,
} from "./skill-improvement-proposals.js";

export type SkillImprovementDecision = {
	decision: Exclude<SkillImprovementStatus, "proposed">;
	decidedAt: string;
	source: "telegram" | "cli";
	reason?: string;
};

export type SkillImprovementProposalWithDecision = SkillImprovementProposal & {
	decisionLog?: SkillImprovementDecision[];
};

export type SkillImprovementProposalFile = {
	path: string;
	name: string;
	warning: string;
	createdAt?: string;
	sourceDraftPath?: string;
	projectId?: string;
	proposals: SkillImprovementProposalWithDecision[];
};

export type SkillImprovementDecisionResult = {
	action: Exclude<SkillImprovementStatus, "proposed">;
	file: SkillImprovementProposalFile;
	updated: SkillImprovementProposalWithDecision[];
	skipped: SkillImprovementProposalWithDecision[];
	backupPath?: string;
	reason?: string;
};

type DecisionOptions = {
	source?: "telegram" | "cli";
	reason?: string;
	now?: () => Date;
};

const FILE_RE = /^skill-improvement-proposals-\d{8}-\d{6}\.json$/u;
const WARNING =
	"Propuestas revisables. No modificar skills sin aprobación humana.";
const PROPOSAL_TYPES: SkillImprovementProposalType[] = [
	"create_skill",
	"improve_skill",
	"archive_skill",
	"move_skill",
	"validate_skill",
];
const RISKS: SkillImprovementRisk[] = ["low", "medium", "high", "critical"];
const BENEFITS: SkillImprovementBenefit[] = [
	"quality",
	"time",
	"token_cost",
	"safety",
	"architecture_consistency",
];
const ACTIONS: SkillImprovementAction[] = [
	"approve_for_agent_review",
	"approve_for_manual_apply",
	"reject",
	"defer",
];

export function loadSkillImprovementProposalFile(
	pathOrLatest: string,
	reportsPath: string,
): SkillImprovementProposalFile {
	const path = resolveProposalPath(pathOrLatest, reportsPath);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`No pude leer JSON válido de propuestas de skills: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return normalizeProposalFile(parsed, path);
}

export function approveSkillImprovementProposal(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SkillImprovementDecisionResult {
	return decideSkillImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"approved",
		options,
	);
}

export function rejectSkillImprovementProposal(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SkillImprovementDecisionResult {
	return decideSkillImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"rejected",
		options,
	);
}

export function deferSkillImprovementProposal(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SkillImprovementDecisionResult {
	return decideSkillImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"deferred",
		options,
	);
}

export function formatSkillImprovementDecisionResult(
	result: SkillImprovementDecisionResult,
): string {
	return [
		"Skill Improvement Decision",
		"",
		"Acción:",
		result.action,
		"",
		"Archivo:",
		result.file.name,
		"",
		"Backup:",
		result.backupPath ? basename(result.backupPath) : "-",
		"",
		"Actualizadas:",
		...(result.updated.length
			? result.updated.map(
					(proposal) =>
						`- ${proposal.id} ${proposal.type} ${proposal.skillName}`,
				)
			: ["- ninguna"]),
		...(result.skipped.length
			? [
					"",
					"Omitidas:",
					...result.skipped.map(
						(proposal) =>
							`- ${proposal.id} ${proposal.type} ${proposal.status}`,
					),
				]
			: []),
		...(result.reason ? ["", "Motivo:", result.reason] : []),
		"",
		"Nota segura:",
		"Sólo registré decisión humana. No modifiqué skills, .agents ni .atl. No ejecuté AgentLabs.",
	].join("\n");
}

function decideSkillImprovement(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	action: Exclude<SkillImprovementStatus, "proposed">,
	options: DecisionOptions,
): SkillImprovementDecisionResult {
	const target = proposalIdOrAll.trim();
	if (!target) throw new Error("Falta proposalId o all.");
	const file = loadSkillImprovementProposalFile(pathOrLatest, reportsPath);
	const selected = selectProposals(file.proposals, target);
	if (!selected.length) throw new Error(`No existe propuesta: ${target}`);
	const alreadyDecided = selected.filter(
		(proposal) => proposal.status !== "proposed",
	);
	if (target !== "all" && alreadyDecided.length) {
		throw new Error(
			`La propuesta ${target} ya tiene decisión: ${alreadyDecided[0]?.status}`,
		);
	}
	const updated = selected.filter((proposal) => proposal.status === "proposed");
	if (!updated.length)
		return { action, file, updated: [], skipped: alreadyDecided };
	const now = options.now?.() ?? new Date();
	const decision: SkillImprovementDecision = {
		decision: action,
		decidedAt: now.toISOString(),
		source: options.source ?? "cli",
		...(options.reason?.trim() ? { reason: options.reason.trim() } : {}),
	};
	const selectedIds = new Set(updated.map((proposal) => proposal.id));
	file.proposals = file.proposals.map((proposal) =>
		selectedIds.has(proposal.id)
			? {
					...proposal,
					status: action,
					decisionLog: [...(proposal.decisionLog ?? []), decision],
				}
			: proposal,
	);
	const updatedAfter = file.proposals.filter((proposal) =>
		selectedIds.has(proposal.id),
	);
	const backupPath = backupProposalFile(file.path, reportsPath, now);
	writeFileSync(
		file.path,
		`${JSON.stringify(serializeProposalFile(file), null, 2)}\n`,
	);
	return {
		action,
		file,
		updated: updatedAfter,
		skipped: alreadyDecided,
		backupPath,
		reason: decision.reason,
	};
}

function resolveProposalPath(
	pathOrLatest: string,
	reportsPath: string,
): string {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestProposalFile(reports);
		if (!latest) {
			throw new Error(
				"No encontré archivos skill-improvement-proposals-*.json en reports.",
			);
		}
		return latest;
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed) throw new Error("Falta ruta de propuestas de skills.");
	const candidate = resolve(
		isAbsolute(trimmed) ? trimmed : join(reports, trimmed),
	);
	const relativeToReports = relative(reports, candidate);
	if (
		relativeToReports === "" ||
		relativeToReports.startsWith("..") ||
		isAbsolute(relativeToReports)
	) {
		throw new Error(
			"La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports.",
		);
	}
	if (!FILE_RE.test(basename(candidate))) {
		throw new Error(
			"El archivo debe llamarse skill-improvement-proposals-*.json.",
		);
	}
	if (!existsSync(candidate))
		throw new Error(`No existe archivo: ${candidate}`);
	return candidate;
}

function latestProposalFile(reportsPath: string): string | undefined {
	if (!existsSync(reportsPath)) return undefined;
	const files = readdirSync(reportsPath)
		.filter((file) => FILE_RE.test(file))
		.sort();
	const latest = files.at(-1);
	return latest ? join(reportsPath, latest) : undefined;
}

function normalizeProposalFile(
	value: unknown,
	path: string,
): SkillImprovementProposalFile {
	if (!isRecord(value))
		throw new Error("Archivo de propuestas de skills inválido.");
	if (value.warning !== WARNING) {
		throw new Error(
			"El archivo no tiene warning válido de propuestas revisables.",
		);
	}
	if (!Array.isArray(value.proposals)) {
		throw new Error("El archivo no contiene proposals[].");
	}
	const proposals = value.proposals.map((proposal, index) =>
		normalizeProposal(proposal, index),
	);
	return {
		path,
		name: basename(path),
		warning: WARNING,
		createdAt:
			typeof value.createdAt === "string" ? value.createdAt : undefined,
		sourceDraftPath:
			typeof value.sourceDraftPath === "string"
				? value.sourceDraftPath
				: undefined,
		projectId:
			typeof value.projectId === "string" ? value.projectId : undefined,
		proposals,
	};
}

function normalizeProposal(
	value: unknown,
	index: number,
): SkillImprovementProposalWithDecision {
	if (!isRecord(value))
		throw new Error(`Propuesta inválida en índice ${index}.`);
	const requiredStrings = [
		"id",
		"type",
		"skillName",
		"title",
		"description",
		"sourceDraftPath",
		"riskLevel",
		"suggestedAction",
		"status",
		"createdAt",
	];
	for (const key of requiredStrings) {
		if (typeof value[key] !== "string" || !value[key].trim()) {
			throw new Error(`Propuesta ${index} sin campo válido: ${key}.`);
		}
	}
	if (!isProposalType(value.type)) {
		throw new Error(`Propuesta ${value.id} con type inválido.`);
	}
	if (!isRisk(value.riskLevel)) {
		throw new Error(`Propuesta ${value.id} con riskLevel inválido.`);
	}
	if (!isAction(value.suggestedAction)) {
		throw new Error(`Propuesta ${value.id} con suggestedAction inválido.`);
	}
	if (!isStatus(value.status)) {
		throw new Error(`Propuesta ${value.id} con status inválido.`);
	}
	if (value.requiresHumanApproval !== true) {
		throw new Error(`Propuesta ${value.id} debe requerir aprobación humana.`);
	}
	if (
		!isStringArray(value.evidence) ||
		!isBenefitArray(value.expectedBenefit)
	) {
		throw new Error(`Propuesta ${value.id} tiene arrays inválidos.`);
	}
	return {
		...(value as unknown as SkillImprovementProposalWithDecision),
		type: value.type,
		riskLevel: value.riskLevel,
		suggestedAction: value.suggestedAction,
		status: value.status,
		evidence: value.evidence,
		expectedBenefit: value.expectedBenefit,
		decisionLog: normalizeDecisionLog(value.decisionLog),
	};
}

function normalizeDecisionLog(
	value: unknown,
): SkillImprovementDecision[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const decisions = value.flatMap((item): SkillImprovementDecision[] => {
		if (!isRecord(item)) return [];
		if (
			!isDecidedStatus(item.decision) ||
			typeof item.decidedAt !== "string" ||
			(item.source !== "telegram" && item.source !== "cli")
		) {
			return [];
		}
		return [
			{
				decision: item.decision,
				decidedAt: item.decidedAt,
				source: item.source,
				...(typeof item.reason === "string" && item.reason.trim()
					? { reason: item.reason.trim() }
					: {}),
			},
		];
	});
	return decisions.length ? decisions : undefined;
}

function selectProposals(
	proposals: SkillImprovementProposalWithDecision[],
	proposalIdOrAll: string,
): SkillImprovementProposalWithDecision[] {
	if (proposalIdOrAll === "all") {
		return proposals.filter((item) => item.status === "proposed");
	}
	return proposals.filter((proposal) => proposal.id === proposalIdOrAll);
}

function backupProposalFile(
	path: string,
	reportsPath: string,
	now: Date,
): string {
	const backupPath = join(
		resolve(reportsPath),
		`skill-improvement-proposals.backup-${timestamp(now)}.json`,
	);
	copyFileSync(path, backupPath);
	return backupPath;
}

function serializeProposalFile(
	file: SkillImprovementProposalFile,
): Record<string, unknown> {
	return {
		warning: file.warning,
		...(file.createdAt ? { createdAt: file.createdAt } : {}),
		...(file.sourceDraftPath ? { sourceDraftPath: file.sourceDraftPath } : {}),
		...(file.projectId ? { projectId: file.projectId } : {}),
		proposals: file.proposals,
	};
}

function isProposalType(value: unknown): value is SkillImprovementProposalType {
	return PROPOSAL_TYPES.includes(value as SkillImprovementProposalType);
}

function isRisk(value: unknown): value is SkillImprovementRisk {
	return RISKS.includes(value as SkillImprovementRisk);
}

function isAction(value: unknown): value is SkillImprovementAction {
	return ACTIONS.includes(value as SkillImprovementAction);
}

function isStatus(value: unknown): value is SkillImprovementStatus {
	return ["proposed", "approved", "rejected", "deferred"].includes(
		value as SkillImprovementStatus,
	);
}

function isDecidedStatus(
	value: unknown,
): value is Exclude<SkillImprovementStatus, "proposed"> {
	return ["approved", "rejected", "deferred"].includes(
		value as Exclude<SkillImprovementStatus, "proposed">,
	);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isBenefitArray(value: unknown): value is SkillImprovementBenefit[] {
	return (
		Array.isArray(value) &&
		value.every((item) => BENEFITS.includes(item as SkillImprovementBenefit))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(date: Date): string {
	const compact = date
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14);
	return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
}
