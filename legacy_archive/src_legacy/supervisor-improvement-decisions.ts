import {
	copyFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	SupervisorImprovementAction,
	SupervisorImprovementBenefit,
	SupervisorImprovementProposal,
	SupervisorImprovementProposalType,
	SupervisorImprovementRisk,
	SupervisorImprovementStatus,
} from "./supervisor-improvement-proposals.js";

export type SupervisorImprovementDecision = {
	decision: Exclude<SupervisorImprovementStatus, "proposed">;
	decidedAt: string;
	source: "telegram" | "cli";
	reason?: string;
};

export type SupervisorImprovementProposalWithDecision =
	SupervisorImprovementProposal & {
		decision?: SupervisorImprovementDecision;
	};

export type SupervisorImprovementProposalFile = {
	path: string;
	name: string;
	warning: string;
	createdAt?: string;
	sourceDraftPath?: string;
	projectId?: string;
	proposals: SupervisorImprovementProposalWithDecision[];
};

export type SupervisorImprovementStatusResult = {
	file: SupervisorImprovementProposalFile;
	counts: Record<SupervisorImprovementStatus, number>;
	recommendedNext: string;
};

export type SupervisorImprovementDecisionResult = {
	action: Exclude<SupervisorImprovementStatus, "proposed">;
	file: SupervisorImprovementProposalFile;
	updated: SupervisorImprovementProposalWithDecision[];
	skipped: SupervisorImprovementProposalWithDecision[];
	backupPath?: string;
	reason?: string;
};

type DecisionOptions = {
	source?: "telegram" | "cli";
	reason?: string;
	now?: () => Date;
};

const FILE_RE = /^supervisor-improvement-proposals-\d{8}-\d{6}\.json$/u;
const WARNING = "Propuestas revisables. No aplicar sin aprobación humana.";
const PROPOSAL_TYPES: SupervisorImprovementProposalType[] = [
	"intent_rule_update",
	"skill_update",
	"constitution_suggestion",
	"project_core_review",
	"classifier_review",
	"workflow_improvement",
];
const RISKS: SupervisorImprovementRisk[] = [
	"low",
	"medium",
	"high",
	"critical",
];
const BENEFITS: SupervisorImprovementBenefit[] = [
	"quality",
	"time",
	"token_cost",
	"safety",
	"architecture_consistency",
];
const ACTIONS: SupervisorImprovementAction[] = [
	"approve_for_agent_review",
	"approve_for_manual_apply",
	"reject",
	"defer",
];

export function loadSupervisorImprovementProposalFile(
	pathOrLatest: string,
	reportsPath: string,
): SupervisorImprovementProposalFile {
	const path = resolveProposalPath(pathOrLatest, reportsPath);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`No pude leer JSON válido de propuestas: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return normalizeProposalFile(parsed, path);
}

export function getSupervisorImprovementStatus(
	pathOrLatest: string,
	reportsPath: string,
): SupervisorImprovementStatusResult {
	const file = loadSupervisorImprovementProposalFile(pathOrLatest, reportsPath);
	const counts = countStatuses(file.proposals);
	return {
		file,
		counts,
		recommendedNext: counts.proposed
			? "Aprobar, rechazar o diferir propuestas pendientes."
			: "Todas las propuestas ya tienen decisión humana registrada.",
	};
}

export function approveSupervisorImprovement(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SupervisorImprovementDecisionResult {
	return decideSupervisorImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"approved",
		options,
	);
}

export function rejectSupervisorImprovement(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SupervisorImprovementDecisionResult {
	return decideSupervisorImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"rejected",
		options,
	);
}

export function deferSupervisorImprovement(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	options: DecisionOptions = {},
): SupervisorImprovementDecisionResult {
	return decideSupervisorImprovement(
		pathOrLatest,
		proposalIdOrAll,
		reportsPath,
		"deferred",
		options,
	);
}

export function formatSupervisorImprovementStatus(
	result: SupervisorImprovementStatusResult,
): string {
	return [
		"Supervisor Improvement Status",
		"",
		"Archivo:",
		result.file.name,
		"",
		"Resumen:",
		`- proposed: ${result.counts.proposed}`,
		`- approved: ${result.counts.approved}`,
		`- rejected: ${result.counts.rejected}`,
		`- deferred: ${result.counts.deferred}`,
		"",
		"Propuestas:",
		...formatStatusItems(result.file.proposals),
		"",
		"Próximo recomendado:",
		result.recommendedNext,
		"",
		"Nota segura:",
		"Sólo mostré decisiones. No apliqué cambios ni ejecuté AgentLabs.",
	].join("\n");
}

export function formatSupervisorImprovementDecisionResult(
	result: SupervisorImprovementDecisionResult,
): string {
	return [
		"Supervisor Improvement Decision",
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
			? result.updated.map((proposal) => `- ${proposal.id} ${proposal.type}`)
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
		"Sólo registré decisión humana. No apliqué cambios.",
	].join("\n");
}

function decideSupervisorImprovement(
	pathOrLatest: string,
	proposalIdOrAll: string,
	reportsPath: string,
	action: Exclude<SupervisorImprovementStatus, "proposed">,
	options: DecisionOptions,
): SupervisorImprovementDecisionResult {
	const target = proposalIdOrAll.trim();
	if (!target) throw new Error("Falta proposalId o all.");
	const file = loadSupervisorImprovementProposalFile(pathOrLatest, reportsPath);
	const selected = selectProposals(file.proposals, target);
	if (!selected.length) {
		throw new Error(`No existe propuesta: ${target}`);
	}
	const alreadyDecided = selected.filter(
		(proposal) => proposal.status !== "proposed",
	);
	if (target !== "all" && alreadyDecided.length) {
		throw new Error(
			`La propuesta ${target} ya tiene decisión: ${alreadyDecided[0]?.status}`,
		);
	}
	const updated = selected.filter((proposal) => proposal.status === "proposed");
	if (!updated.length) {
		return { action, file, updated: [], skipped: alreadyDecided };
	}
	const now = options.now?.() ?? new Date();
	const decision: SupervisorImprovementDecision = {
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
					decision,
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
		if (!latest)
			throw new Error(
				"No encontré archivos supervisor-improvement-proposals-*.json en reports.",
			);
		return latest;
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed) throw new Error("Falta ruta de propuestas.");
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
			"El archivo debe llamarse supervisor-improvement-proposals-*.json.",
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
): SupervisorImprovementProposalFile {
	if (!isRecord(value)) throw new Error("Archivo de propuestas inválido.");
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
): SupervisorImprovementProposalWithDecision {
	if (!isRecord(value))
		throw new Error(`Propuesta inválida en índice ${index}.`);
	const requiredStrings = [
		"id",
		"type",
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
		...(value as unknown as SupervisorImprovementProposalWithDecision),
		type: value.type,
		riskLevel: value.riskLevel,
		suggestedAction: value.suggestedAction,
		status: value.status,
		evidence: value.evidence,
		expectedBenefit: value.expectedBenefit,
		decision: normalizeDecision(value.decision),
	};
}

function normalizeDecision(
	value: unknown,
): SupervisorImprovementDecision | undefined {
	if (!isRecord(value)) return undefined;
	if (
		!isDecidedStatus(value.decision) ||
		typeof value.decidedAt !== "string" ||
		(value.source !== "telegram" && value.source !== "cli")
	) {
		return undefined;
	}
	return {
		decision: value.decision,
		decidedAt: value.decidedAt,
		source: value.source,
		...(typeof value.reason === "string" && value.reason.trim()
			? { reason: value.reason.trim() }
			: {}),
	};
}

function selectProposals(
	proposals: SupervisorImprovementProposalWithDecision[],
	proposalIdOrAll: string,
): SupervisorImprovementProposalWithDecision[] {
	if (proposalIdOrAll === "all")
		return proposals.filter((item) => item.status === "proposed");
	return proposals.filter((proposal) => proposal.id === proposalIdOrAll);
}

function backupProposalFile(
	path: string,
	reportsPath: string,
	now: Date,
): string {
	const backupPath = join(
		resolve(reportsPath),
		`supervisor-improvement-proposals.backup-${timestamp(now)}.json`,
	);
	copyFileSync(path, backupPath);
	return backupPath;
}

function serializeProposalFile(
	file: SupervisorImprovementProposalFile,
): Record<string, unknown> {
	return {
		warning: file.warning,
		...(file.createdAt ? { createdAt: file.createdAt } : {}),
		...(file.sourceDraftPath ? { sourceDraftPath: file.sourceDraftPath } : {}),
		...(file.projectId ? { projectId: file.projectId } : {}),
		proposals: file.proposals,
	};
}

function countStatuses(
	proposals: SupervisorImprovementProposalWithDecision[],
): Record<SupervisorImprovementStatus, number> {
	return proposals.reduce<Record<SupervisorImprovementStatus, number>>(
		(counts, proposal) => ({
			...counts,
			[proposal.status]: counts[proposal.status] + 1,
		}),
		{ proposed: 0, approved: 0, rejected: 0, deferred: 0 },
	);
}

function formatStatusItems(
	proposals: SupervisorImprovementProposalWithDecision[],
): string[] {
	if (!proposals.length) return ["- ninguna"];
	return proposals.map(
		(proposal, index) =>
			`${index + 1}. ${proposal.id} ${proposal.type} ${proposal.riskLevel} ${proposal.status} — ${proposal.title}`,
	);
}

function isProposalType(
	value: unknown,
): value is SupervisorImprovementProposalType {
	return PROPOSAL_TYPES.includes(value as SupervisorImprovementProposalType);
}

function isRisk(value: unknown): value is SupervisorImprovementRisk {
	return RISKS.includes(value as SupervisorImprovementRisk);
}

function isAction(value: unknown): value is SupervisorImprovementAction {
	return ACTIONS.includes(value as SupervisorImprovementAction);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isBenefitArray(
	value: unknown,
): value is SupervisorImprovementBenefit[] {
	return (
		Array.isArray(value) &&
		value.every((item) =>
			BENEFITS.includes(item as SupervisorImprovementBenefit),
		)
	);
}

function isStatus(value: unknown): value is SupervisorImprovementStatus {
	return ["proposed", "approved", "rejected", "deferred"].includes(
		String(value),
	);
}

function isDecidedStatus(
	value: unknown,
): value is Exclude<SupervisorImprovementStatus, "proposed"> {
	return ["approved", "rejected", "deferred"].includes(String(value));
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
