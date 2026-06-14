import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
	reviewSemanticCompactionDraft,
	type SemanticCompactionDraft,
	type SemanticCompactionReview,
} from "./semantic-compaction.js";
import {
	collectDraftInputs,
	type DraftInputs,
} from "./skill-draft-inputs.js";

export type SkillImprovementProposalType =
	| "create_skill"
	| "improve_skill"
	| "archive_skill"
	| "move_skill"
	| "validate_skill";
export type SkillImprovementRisk = "low" | "medium" | "high" | "critical";
export type SkillImprovementBenefit =
	| "quality"
	| "time"
	| "token_cost"
	| "safety"
	| "architecture_consistency";
export type SkillImprovementAction =
	| "approve_for_agent_review"
	| "approve_for_manual_apply"
	| "reject"
	| "defer";
export type SkillImprovementStatus =
	| "proposed"
	| "approved"
	| "rejected"
	| "deferred";

export type SkillImprovementProposal = {
	id: string;
	type: SkillImprovementProposalType;
	skillName: string;
	title: string;
	description: string;
	evidence: string[];
	sourceDraftPath: string;
	riskLevel: SkillImprovementRisk;
	expectedBenefit: SkillImprovementBenefit[];
	requiresHumanApproval: true;
	suggestedAction: SkillImprovementAction;
	status: SkillImprovementStatus;
	createdAt: string;
};

export type SkillImprovementPlan = {
	draftPath: string;
	sourceDraftPath: string;
	draftName: string;
	projectId: string;
	validDraft: boolean;
	errors: string[];
	skillRegistry: SkillMetadata[];
	proposals: SkillImprovementProposal[];
};

export type SkillImprovementCreationResult = {
	plan: SkillImprovementPlan;
	path?: string;
	created: SkillImprovementProposal[];
};

export type SkillImprovementStatusResult = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	createdAt?: string;
	sourceDraftPath?: string;
	projectId?: string;
	countsByStatus: Record<SkillImprovementStatus, number>;
	countsByType: Record<SkillImprovementProposalType, number>;
	proposals: SkillImprovementProposal[];
};

type SkillMetadata = {
	name: string;
	path: string;
	source: "atl" | "index" | "skill";
};

type BuildOptions = {
	workspaceRoot?: string;
	dbPath?: string;
	maxProposals?: number;
	now?: () => Date;
};

const MAX_PROPOSALS = 10;
const FILE_PREFIX = "skill-improvement-proposals-";
const FILE_RE = /^skill-improvement-proposals-\d{8}-\d{6}\.json$/u;
const SECRET_PATTERN =
	/(token|secret|password|api[_-]?key|bearer|credentials?)\s*[:=]?\s*[^\s,;\]}]+/giu;

export function buildSkillImprovementPlan(
	pathOrLatest: string,
	reportsPath: string,
	options: BuildOptions = {},
): SkillImprovementPlan {
	const review = reviewSemanticCompactionDraft(pathOrLatest, reportsPath);
	const skillRegistry = collectSkillRegistry(
		options.workspaceRoot,
		options.dbPath,
	);
	if (!review.validDraft || !review.draft) {
		return {
			draftPath: review.path,
			sourceDraftPath: review.path,
			draftName: basename(review.path || pathOrLatest),
			projectId: review.draft?.projectId ?? "",
			validDraft: false,
			errors: review.errors,
			skillRegistry,
			proposals: [],
		};
	}
	const draft = review.draft;
	const createdAt = (options.now?.() ?? new Date()).toISOString();
	const stateRoot = options.workspaceRoot ?? reportsPath;
	const inputs: DraftInputs = collectDraftInputs(stateRoot, draft.projectId);
	const proposals = buildProposals(
		{ ...review, draft },
		skillRegistry,
		createdAt,
		{ stateRoot, projectId: draft.projectId, inputs },
	)
		.sort(compareProposal)
		.slice(0, options.maxProposals ?? MAX_PROPOSALS)
		.map((proposalItem, index) => ({
			...proposalItem,
			id: `skill-improvement-${String(index + 1).padStart(3, "0")}`,
		}));
	return {
		draftPath: review.path,
		sourceDraftPath: review.path,
		draftName: basename(review.path),
		projectId: draft.projectId,
		validDraft: true,
		errors: [],
		skillRegistry,
		proposals,
	};
}

export function createSkillImprovementProposals(
	pathOrLatest: string,
	reportsPath: string,
	options: BuildOptions = {},
): SkillImprovementCreationResult {
	const plan = buildSkillImprovementPlan(pathOrLatest, reportsPath, options);
	if (!plan.validDraft || plan.proposals.length === 0) {
		return { plan, created: [] };
	}
	const now = options.now?.() ?? new Date();
	const path = join(reportsPath, `${FILE_PREFIX}${timestamp(now)}.json`);
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				warning:
					"Propuestas revisables. No modificar skills sin aprobación humana.",
				createdAt: now.toISOString(),
				sourceDraftPath: plan.draftPath,
				projectId: plan.projectId,
				proposals: plan.proposals,
			},
			null,
			2,
		)}\n`,
	);
	return { plan, path, created: plan.proposals };
}

export function getSkillImprovementStatus(
	pathOrLatest: string,
	reportsPath: string,
): SkillImprovementStatusResult {
	const resolved = resolveProposalPath(pathOrLatest, reportsPath);
	const empty = emptyStatus(resolved.path);
	if (!resolved.valid) {
		return { ...empty, errors: resolved.errors };
	}
	if (!existsSync(resolved.path)) {
		return {
			...empty,
			errors: [`No existe ${basename(resolved.path)}.`],
		};
	}
	try {
		const parsed = JSON.parse(readFileSync(resolved.path, "utf8")) as Record<
			string,
			unknown
		>;
		const proposals = parseProposals(parsed.proposals);
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: true,
			errors: [],
			createdAt: stringOrUndefined(parsed.createdAt),
			sourceDraftPath: stringOrUndefined(parsed.sourceDraftPath),
			projectId: stringOrUndefined(parsed.projectId),
			countsByStatus: countByStatus(proposals),
			countsByType: countByType(proposals),
			proposals,
		};
	} catch (error) {
		return {
			...empty,
			errors: [
				`JSON inválido: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

export function formatSkillImprovementPlan(plan: SkillImprovementPlan): string {
	if (!plan.validDraft) {
		return [
			"Skill Improvement Proposals",
			"",
			"Draft válido:",
			"no",
			"",
			"Errores:",
			...formatList(plan.errors),
			"",
			"Nota segura:",
			"No modifiqué skills, no modifiqué .agents/.atl y no ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"Skill Improvement Proposals",
		"",
		"Draft:",
		plan.draftName,
		"",
		"Skills detectadas:",
		...(plan.skillRegistry.length
			? plan.skillRegistry
					.slice(0, 8)
					.map((skill) => `- ${skill.name} (${skill.source})`)
			: ["- ninguna"]),
		"",
		"Propuestas:",
		...formatProposals(plan.proposals),
		"",
		"Acción:",
		"Crear propuestas:",
		" /skill_improvements_create latest",
		" idu-pi skill-improvements-create latest",
		"",
		"Nota segura:",
		"No modifiqué skills, no modifiqué .agents/.atl y no ejecuté AgentLabs.",
	].join("\n");
}

export function formatSkillImprovementCreationResult(
	result: SkillImprovementCreationResult,
): string {
	if (!result.plan.validDraft) return formatSkillImprovementPlan(result.plan);
	return [
		"Skill Improvement Proposals Created",
		"",
		"Ruta:",
		result.path ?? "-",
		"",
		"Creadas:",
		...(result.created.length
			? result.created.map(
					(proposalItem) =>
						`- ${proposalItem.id} ${proposalItem.type} ${proposalItem.riskLevel} ${proposalItem.skillName}`,
				)
			: ["- ninguna"]),
		"",
		"Nota segura:",
		"Sólo guardé propuestas revisables. No modifiqué skills, .agents ni .atl.",
	].join("\n");
}

export function formatSkillImprovementStatus(
	status: SkillImprovementStatusResult,
): string {
	if (!status.valid) {
		return [
			"Skill Improvement Status",
			"",
			"Archivo válido:",
			"no",
			"",
			"Errores:",
			...formatList(status.errors),
			"",
			"Nota segura:",
			"Sólo mostré estado. No modifiqué skills ni ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"Skill Improvement Status",
		"",
		"Archivo:",
		status.name,
		"",
		"Resumen:",
		`- proposed: ${status.countsByStatus.proposed}`,
		`- approved: ${status.countsByStatus.approved}`,
		`- rejected: ${status.countsByStatus.rejected}`,
		`- deferred: ${status.countsByStatus.deferred}`,
		"",
		"Tipos:",
		...formatTypeCounts(status.countsByType),
		"",
		"Propuestas:",
		...(status.proposals.length
			? status.proposals.map(
					(proposalItem, index) =>
						`${index + 1}. ${proposalItem.id} ${proposalItem.type} ${proposalItem.riskLevel} ${proposalItem.status} — ${proposalItem.skillName} — ${proposalItem.title}`,
				)
			: ["- ninguna"]),
		"",
		"Nota segura:",
		"Sólo mostré estado. No modifiqué skills ni ejecuté AgentLabs.",
	].join("\n");
}

function buildCitationsSuffix(inputs: DraftInputs): string {
	const parts: string[] = [];
	if (inputs.generalSpec) {
		parts.push(
			`[general-spec v${inputs.generalSpec.specVersion ?? "?"}]`,
		);
	}
	if (inputs.blueprint) {
		parts.push(`[blueprint: ${inputs.blueprint.objective}]`);
	}
	if (inputs.flows) {
		parts.push(`[flows: ${inputs.flows.projectType}]`);
	}
	if (inputs.agentlabFindings && inputs.agentlabFindings.length > 0) {
		parts.push(
			`[findings: ${inputs.agentlabFindings.length} open]`,
		);
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function buildProposals(
	review: SemanticCompactionReview & { draft: SemanticCompactionDraft },
	skillRegistry: SkillMetadata[],
	createdAt: string,
	context: { stateRoot: string; projectId: string; inputs: DraftInputs },
): SkillImprovementProposal[] {
	const draft = review.draft;
	const proposals: SkillImprovementProposal[] = [];
	const citations = buildCitationsSuffix(context.inputs);
	const candidateTexts = [
		...draft.suggestedSkillUpdates,
		...draft.suggestedAgentTasks.filter((item) =>
			/skill|habilidad/iu.test(item),
		),
	];
	for (const group of groupByDomain(candidateTexts)) {
		const text = group.items.join(" ");
		const skillName = skillNameFor(text, skillRegistry);
		const hasSkill = skillExists(skillName, skillRegistry);
		const noisy =
			/ruido|ruidosa|obsoleta|archivar|archive|no se usa|no usada/iu.test(text);
		const move = /mover|fuera del proyecto|no aplica|otro proyecto/iu.test(
			text,
		);
		const validate =
			/validar|revisar utilidad|agentlab|agent lab|útil|utilidad/iu.test(text);
		let type: SkillImprovementProposalType = hasSkill
			? "improve_skill"
			: "create_skill";
		if (noisy) type = "archive_skill";
		else if (move) type = "move_skill";
		else if (validate) type = "validate_skill";
		proposals.push(
			proposal({
				type,
				skillName,
				title: titleFor(type, skillName, text),
				description: descriptionFor(type) + citations,
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel: riskFor(text, type),
				expectedBenefit: benefitFor(text, type),
				suggestedAction:
					type === "improve_skill"
						? "approve_for_manual_apply"
						: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	for (const group of groupByDomain([...draft.criticalBugs.map(recordTitle)])) {
		const text = group.items.join(" ");
		if (
			!/auth|login|loggin|security|seguridad|db|database|base de datos|schema/iu.test(
				text,
			)
		) {
			continue;
		}
		const skillName = skillNameFor(text, skillRegistry);
		proposals.push(
			proposal({
				type: skillExists(skillName, skillRegistry)
					? "improve_skill"
					: "create_skill",
				skillName,
				title: titleFor("create_skill", skillName, text),
				description:
					"Proponer cobertura de skill para fallas repetidas detectadas; no crea ni modifica archivos automáticamente.",
				evidence: group.items,
				sourceDraftPath: review.path,
				riskLevel: riskFor(text, "create_skill"),
				expectedBenefit: benefitFor(text, "create_skill"),
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	const classifierEvidence = [
		...draft.classifierQualityReview.falsePositives,
		...draft.classifierQualityReview.falseNegatives,
		...draft.classifierQualityReview.errorPatterns,
		...draft.classifierQualityReview.recommendedRules,
	].filter(Boolean);
	if (
		classifierEvidence.some((item) =>
			/skill|auth|login|db|schema|ruido/iu.test(item),
		)
	) {
		const text = classifierEvidence.join(" ");
		const noisy = /ruido|false positive|falso positivo/iu.test(text);
		proposals.push(
			proposal({
				type: noisy ? "archive_skill" : "validate_skill",
				skillName: noisy
					? "noisy-skill-review"
					: skillNameFor(text, skillRegistry),
				title: noisy
					? "Validar skill ruidosa antes de archivarla"
					: "Validar utilidad de skill sugerida",
				description: noisy
					? descriptionFor("archive_skill")
					: descriptionFor("validate_skill"),
				evidence: classifierEvidence,
				sourceDraftPath: review.path,
				riskLevel: "high",
				expectedBenefit: ["quality", "token_cost", "safety"],
				suggestedAction: "approve_for_agent_review",
				createdAt,
			}),
		);
	}
	if (
		draft.architecturalRisks.some((item) =>
			/project core|constitution|skill/iu.test(item),
		) ||
		draft.preservedRules.some((item) =>
			/project core|constitution|skill/iu.test(item),
		)
	) {
		const evidence = [
			...draft.architecturalRisks.filter((item) =>
				/project core|constitution|skill/iu.test(item),
			),
			...draft.preservedRules.filter((item) =>
				/project core|constitution|skill/iu.test(item),
			),
		];
		proposals.push(
			proposal({
				type: skillExists("project-understanding", skillRegistry)
					? "improve_skill"
					: "create_skill",
				skillName: "project-understanding",
				title:
					"Mejorar skill project-understanding con Project Core/Constitution",
				description:
					"Proponer revisión de skill para alinear Project Core, Constitution y comprensión real del proyecto; no modifica esos artefactos.",
				evidence,
				sourceDraftPath: review.path,
				riskLevel: "medium",
				expectedBenefit: ["architecture_consistency", "quality", "safety"],
				suggestedAction: "approve_for_manual_apply",
				createdAt,
			}),
		);
	}
	return dedupeProposals(proposals);
}

function proposal(
	input: Omit<
		SkillImprovementProposal,
		"id" | "requiresHumanApproval" | "status"
	>,
): SkillImprovementProposal {
	return {
		id: "pending",
		...input,
		evidence: input.evidence.map(short).filter(Boolean).slice(0, 8),
		requiresHumanApproval: true,
		status: "proposed",
	};
}

function collectSkillRegistry(
	workspaceRoot?: string,
	dbPath?: string,
): SkillMetadata[] {
	const sqliteSkills = collectSqliteSkills(dbPath);
	if (!workspaceRoot) return sqliteSkills;
	const root = resolve(workspaceRoot);
	const skills = new Map<string, SkillMetadata>();
	readSkillIndex(join(root, ".atl", "skill-registry.md"), "atl", root, skills);
	readSkillIndex(
		join(root, ".agents", "skills", "INDEX.md"),
		"index",
		root,
		skills,
	);
	const skillsDir = join(root, ".agents", "skills");
	if (existsSync(skillsDir)) {
		for (const entry of safeReaddir(skillsDir)) {
			const skillPath = join(skillsDir, entry, "SKILL.md");
			if (!safeFileUnder(skillPath, root) || !existsSync(skillPath)) continue;
			const name = readSkillName(skillPath) ?? entry;
			if (!skills.has(normalize(name))) {
				skills.set(normalize(name), {
					name,
					path: relative(root, skillPath).replace(/\\/gu, "/"),
					source: "skill",
				});
			}
		}
	}
	for (const skill of sqliteSkills) {
		if (!skills.has(normalize(skill.name))) {
			skills.set(normalize(skill.name), skill);
		}
	}
	return [...skills.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

function collectSqliteSkills(dbPath?: string): SkillMetadata[] {
	if (!dbPath || !existsSync(dbPath)) return [];
	try {
		const output = execFileSync(
			"sqlite3",
			[
				"-json",
				dbPath,
				"SELECT name, path FROM skill_index ORDER BY priority ASC, name ASC LIMIT 20;",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		if (!output) return [];
		const rows = JSON.parse(output) as Array<{
			name?: unknown;
			path?: unknown;
		}>;
		return rows.flatMap((row) => {
			if (typeof row.name !== "string" || typeof row.path !== "string")
				return [];
			return [
				{
					name: short(row.name),
					path: short(row.path),
					source: "index" as const,
				},
			];
		});
	} catch {
		return [];
	}
}

function readSkillIndex(
	path: string,
	source: SkillMetadata["source"],
	root: string,
	skills: Map<string, SkillMetadata>,
): void {
	if (
		!safeFileUnder(path, root) ||
		!existsSync(path) ||
		statSync(path).size > 64_000
	)
		return;
	const content = redact(readFileSync(path, "utf8"));
	for (const line of content.split(/\r?\n/u)) {
		const match = line.match(/\|\s*([^|]+?)\s*\|\s*([^|]+?SKILL\.md)\s*\|/iu);
		if (!match) continue;
		const name = match[1]?.trim();
		const skillPath = match[2]?.trim();
		if (!name || /^---$/u.test(name) || /skill|trigger/iu.test(name)) continue;
		if (!skillPath || /\.env/iu.test(skillPath)) continue;
		const key = normalize(name);
		if (!skills.has(key)) {
			skills.set(key, { name, path: skillPath, source });
		}
	}
}

function readSkillName(path: string): string | undefined {
	if (statSync(path).size > 16_000) return undefined;
	const content = redact(readFileSync(path, "utf8").slice(0, 4000));
	return content.match(/^name:\s*([^\n]+)/imu)?.[1]?.trim();
}

function resolveProposalPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reportsRoot = resolve(reportsPath);
	if (pathOrLatest === "latest") {
		const latest = latestProposalFile(reportsRoot);
		return latest
			? { valid: true, path: latest, errors: [] }
			: {
					valid: false,
					path: reportsRoot,
					errors: [
						"No encontré archivos skill-improvement-proposals-*.json en reports.",
					],
				};
	}
	const candidate = isAbsolute(pathOrLatest)
		? resolve(pathOrLatest)
		: resolve(reportsRoot, pathOrLatest);
	if (!safeFileUnder(candidate, reportsRoot)) {
		return {
			valid: false,
			path: candidate,
			errors: ["El archivo debe estar dentro de reports."],
		};
	}
	if (!FILE_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: ["El archivo debe llamarse skill-improvement-proposals-*.json."],
		};
	}
	return { valid: true, path: candidate, errors: [] };
}

function latestProposalFile(reportsRoot: string): string | undefined {
	if (!existsSync(reportsRoot)) return undefined;
	return safeReaddir(reportsRoot)
		.filter((name) => FILE_RE.test(name))
		.sort()
		.reverse()
		.map((name) => join(reportsRoot, name))[0];
}

function parseProposals(value: unknown): SkillImprovementProposal[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const record = item as Record<string, unknown>;
		const parsed: SkillImprovementProposal = {
			id: stringOrUndefined(record.id) ?? "unknown",
			type: parseType(record.type),
			skillName: stringOrUndefined(record.skillName) ?? "unknown-skill",
			title: short(stringOrUndefined(record.title) ?? "Sin título"),
			description: short(stringOrUndefined(record.description) ?? ""),
			evidence: arrayOfStrings(record.evidence).map(redact),
			sourceDraftPath: stringOrUndefined(record.sourceDraftPath) ?? "",
			riskLevel: parseRisk(record.riskLevel),
			expectedBenefit: arrayOfStrings(record.expectedBenefit).flatMap(
				parseBenefit,
			),
			requiresHumanApproval: true,
			suggestedAction: parseAction(record.suggestedAction),
			status: parseStatus(record.status),
			createdAt: stringOrUndefined(record.createdAt) ?? "",
		};
		return [parsed];
	});
}

function emptyStatus(path: string): SkillImprovementStatusResult {
	return {
		path,
		name: basename(path),
		valid: false,
		errors: [],
		countsByStatus: countByStatus([]),
		countsByType: countByType([]),
		proposals: [],
	};
}

function countByStatus(
	proposals: SkillImprovementProposal[],
): Record<SkillImprovementStatus, number> {
	return {
		proposed: proposals.filter(
			(proposalItem) => proposalItem.status === "proposed",
		).length,
		approved: proposals.filter(
			(proposalItem) => proposalItem.status === "approved",
		).length,
		rejected: proposals.filter(
			(proposalItem) => proposalItem.status === "rejected",
		).length,
		deferred: proposals.filter(
			(proposalItem) => proposalItem.status === "deferred",
		).length,
	};
}

function countByType(
	proposals: SkillImprovementProposal[],
): Record<SkillImprovementProposalType, number> {
	return {
		create_skill: proposals.filter(
			(proposalItem) => proposalItem.type === "create_skill",
		).length,
		improve_skill: proposals.filter(
			(proposalItem) => proposalItem.type === "improve_skill",
		).length,
		archive_skill: proposals.filter(
			(proposalItem) => proposalItem.type === "archive_skill",
		).length,
		move_skill: proposals.filter(
			(proposalItem) => proposalItem.type === "move_skill",
		).length,
		validate_skill: proposals.filter(
			(proposalItem) => proposalItem.type === "validate_skill",
		).length,
	};
}

function groupByDomain(
	items: string[],
): Array<{ key: string; items: string[] }> {
	const groups = new Map<string, string[]>();
	for (const item of items.map((value) => value.trim()).filter(Boolean)) {
		const key = domainKey(item);
		const current = groups.get(key) ?? [];
		if (!current.some((existing) => normalize(existing) === normalize(item))) {
			current.push(item);
		}
		groups.set(key, current);
	}
	return [...groups.entries()].map(([key, groupItems]) => ({
		key,
		items: groupItems,
	}));
}

function dedupeProposals(
	proposals: SkillImprovementProposal[],
): SkillImprovementProposal[] {
	const seen = new Set<string>();
	return proposals.filter((proposalItem) => {
		const key = `${proposalItem.skillName}:${proposalItem.type}:${domainKey(`${proposalItem.title} ${proposalItem.evidence.join(" ")}`)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function compareProposal(
	left: SkillImprovementProposal,
	right: SkillImprovementProposal,
): number {
	const riskOrder: Record<SkillImprovementRisk, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
	};
	const domainOrder = priorityFor(left) - priorityFor(right);
	if (domainOrder !== 0) return domainOrder;
	return riskOrder[left.riskLevel] - riskOrder[right.riskLevel];
}

function priorityFor(proposalItem: SkillImprovementProposal): number {
	const text = `${proposalItem.skillName} ${proposalItem.title} ${proposalItem.evidence.join(" ")}`;
	if (/security|seguridad|auth|login/iu.test(text)) return 0;
	if (/db|database|base de datos|schema/iu.test(text)) return 1;
	if (/classifier|human-intent|intent|clasificador/iu.test(text)) return 2;
	if (/project core|constitution/iu.test(text)) return 3;
	if (/ui|ux|frontend/iu.test(text)) return 4;
	if (/token|costo|cost/iu.test(text)) return 5;
	return 6;
}

function skillNameFor(text: string, skillRegistry: SkillMetadata[]): string {
	const existing = skillRegistry.find((skill) => {
		const skillText = `${skill.name} ${skill.path}`;
		return (
			domainKey(skillText) === domainKey(text) ||
			normalize(text).includes(normalize(skill.name))
		);
	});
	if (existing) return existing.name;
	if (/auth|login|loggin|session|security|seguridad/iu.test(text))
		return "security-auth-review";
	if (/db|database|base de datos|schema|sql|sqlite|postgres/iu.test(text))
		return "db-schema-review";
	if (/ui|ux|frontend|duplicaci/iu.test(text))
		return "frontend-ui-duplication-review";
	if (/classifier|human-intent|intent|clasificador/iu.test(text))
		return "human-intent-review";
	if (/project core|constitution|arquitect/iu.test(text))
		return "project-understanding";
	if (/ruido|ruidosa|obsoleta|archive|archivar/iu.test(text))
		return "noisy-skill-review";
	return "project-skill-review";
}

function skillExists(
	skillName: string,
	skillRegistry: SkillMetadata[],
): boolean {
	return skillRegistry.some(
		(skill) => normalize(skill.name) === normalize(skillName),
	);
}

function titleFor(
	type: SkillImprovementProposalType,
	skillName: string,
	text: string,
): string {
	if (type === "archive_skill")
		return `Revisar archivo de skill ruidosa: ${skillName}`;
	if (type === "move_skill")
		return `Revisar mover skill fuera del proyecto: ${skillName}`;
	if (type === "validate_skill")
		return `Validar utilidad de skill: ${skillName}`;
	if (type === "improve_skill") return `Mejorar skill existente: ${skillName}`;
	if (/auth|login|security|seguridad/iu.test(text))
		return "Crear skill security-auth-review";
	if (/db|database|base de datos|schema/iu.test(text))
		return "Crear skill db-schema-review";
	if (/ui|ux|frontend/iu.test(text))
		return "Crear skill frontend-ui-duplication-review";
	return `Crear skill ${skillName}`;
}

function descriptionFor(type: SkillImprovementProposalType): string {
	switch (type) {
		case "create_skill":
			return "Proponer una skill nueva; no crear carpeta ni SKILL.md automáticamente.";
		case "improve_skill":
			return "Proponer mejora de una skill existente; requiere aprobación humana antes de aplicar manualmente.";
		case "archive_skill":
			return "No archivar automáticamente: enviar a revisión humana por ruido o bajo valor antes de cualquier cambio.";
		case "move_skill":
			return "Proponer mover la skill fuera del proyecto activo si no aplica; no mover archivos automáticamente.";
		case "validate_skill":
			return "Proponer revisar utilidad de la skill antes de cambiarla; no ejecutar AgentLabs automáticamente.";
	}
}

function riskFor(
	text: string,
	type: SkillImprovementProposalType,
): SkillImprovementRisk {
	if (
		/critical|crítico|critico|seguridad|security|auth|login|db|database|base de datos|schema/iu.test(
			text,
		)
	) {
		return type === "archive_skill" ? "high" : "high";
	}
	if (type === "archive_skill" || type === "move_skill") return "medium";
	return "medium";
}

function benefitFor(
	text: string,
	type: SkillImprovementProposalType,
): SkillImprovementBenefit[] {
	const benefits = new Set<SkillImprovementBenefit>(["quality"]);
	if (/auth|security|seguridad|db|database|schema/iu.test(text))
		benefits.add("safety");
	if (/project core|constitution|arquitect/iu.test(text))
		benefits.add("architecture_consistency");
	if (
		/ruido|token|costo|cost|obsoleta/iu.test(text) ||
		type === "archive_skill"
	)
		benefits.add("token_cost");
	if (/time|tiempo|workflow|flujo/iu.test(text)) benefits.add("time");
	return [...benefits];
}

function domainKey(text: string): string {
	if (/auth|login|loggin|session|token|seguridad|security/iu.test(text))
		return "auth-login";
	if (/db|database|base de datos|schema|sql|sqlite|postgres/iu.test(text))
		return "database-schema";
	if (/classifier|clasificador|human-intent|intent|intenci/iu.test(text))
		return "classifier";
	if (/project core|constitution|blueprint|flow|arquitect/iu.test(text))
		return "project-core";
	if (/ui|ux|frontend|duplicaci/iu.test(text)) return "ui-ux";
	if (/ruido|ruidosa|obsoleta|archive|archivar|no se usa|no usada/iu.test(text))
		return "noisy-skill";
	if (/token|costo|cost/iu.test(text)) return "token-cost";
	if (/skill|habilidad/iu.test(text)) return normalize(text).slice(0, 80);
	return normalize(text).slice(0, 80);
}

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function safeReaddir(path: string): string[] {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
}

function safeFileUnder(path: string, root: string): boolean {
	const relativePath = relative(resolve(root), resolve(path));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function recordTitle(record: Record<string, unknown>): string {
	return [record.title, record.severity, record.evidence]
		.map((value) => (typeof value === "string" ? value : ""))
		.filter(Boolean)
		.join(" — ");
}

function short(text: string): string {
	const compact = redact(text).replace(/\s+/gu, " ").trim();
	return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function redact(text: string): string {
	return text.replace(SECRET_PATTERN, "$1=[REDACTED]");
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseType(value: unknown): SkillImprovementProposalType {
	const valid: SkillImprovementProposalType[] = [
		"create_skill",
		"improve_skill",
		"archive_skill",
		"move_skill",
		"validate_skill",
	];
	return valid.includes(value as SkillImprovementProposalType)
		? (value as SkillImprovementProposalType)
		: "validate_skill";
}

function parseRisk(value: unknown): SkillImprovementRisk {
	const valid: SkillImprovementRisk[] = ["low", "medium", "high", "critical"];
	return valid.includes(value as SkillImprovementRisk)
		? (value as SkillImprovementRisk)
		: "medium";
}

function parseBenefit(value: string): SkillImprovementBenefit[] {
	const valid: SkillImprovementBenefit[] = [
		"quality",
		"time",
		"token_cost",
		"safety",
		"architecture_consistency",
	];
	return valid.includes(value as SkillImprovementBenefit)
		? [value as SkillImprovementBenefit]
		: [];
}

function parseAction(value: unknown): SkillImprovementAction {
	const valid: SkillImprovementAction[] = [
		"approve_for_agent_review",
		"approve_for_manual_apply",
		"reject",
		"defer",
	];
	return valid.includes(value as SkillImprovementAction)
		? (value as SkillImprovementAction)
		: "approve_for_agent_review";
}

function parseStatus(value: unknown): SkillImprovementStatus {
	const valid: SkillImprovementStatus[] = [
		"proposed",
		"approved",
		"rejected",
		"deferred",
	];
	return valid.includes(value as SkillImprovementStatus)
		? (value as SkillImprovementStatus)
		: "proposed";
}

function formatProposals(proposals: SkillImprovementProposal[]): string[] {
	if (!proposals.length) return ["- ninguna"];
	return proposals.flatMap((proposalItem, index) => [
		`${index + 1}. ${proposalItem.type} — ${proposalItem.riskLevel}`,
		`   Skill: ${proposalItem.skillName}`,
		`   Título: ${proposalItem.title}`,
		`   Beneficio: ${proposalItem.expectedBenefit.join(", ")}`,
		"   Evidencia:",
		...(proposalItem.evidence.length
			? proposalItem.evidence.slice(0, 3).map((item) => `   - ${item}`)
			: ["   - sin evidencia detallada"]),
		`   Acción recomendada: ${proposalItem.suggestedAction}`,
		"   Requiere aprobación humana: sí",
	]);
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function formatTypeCounts(
	counts: Record<SkillImprovementProposalType, number>,
): string[] {
	return [
		`- create_skill: ${counts.create_skill}`,
		`- improve_skill: ${counts.improve_skill}`,
		`- archive_skill: ${counts.archive_skill}`,
		`- move_skill: ${counts.move_skill}`,
		`- validate_skill: ${counts.validate_skill}`,
	];
}

function timestamp(date: Date): string {
	const compact = date
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14);
	return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
}
