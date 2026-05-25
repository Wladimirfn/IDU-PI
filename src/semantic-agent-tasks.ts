import { basename } from "node:path";
import {
	reviewSemanticCompactionDraft,
	type SemanticCompactionDraft,
	type SemanticCompactionReview,
} from "./semantic-compaction.js";
import type {
	StructuredTaskQueue,
	StructuredTask,
	StructuredTaskInput,
} from "./structured-task-queue.js";

export type SemanticAgentTaskType =
	| "security"
	| "database"
	| "classifier_review"
	| "architecture"
	| "code_quality"
	| "ui_ux"
	| "skill_review";

export type SemanticAgentTaskCandidate = {
	type: SemanticAgentTaskType;
	category: "review";
	title: string;
	priority: number;
	reason: string;
	recommendation: string;
	evidence: string;
	requiresHumanApproval: boolean;
	dedupeKey: string;
	queuePriority: number;
	text: string;
};

export type SemanticAgentTaskPlan = {
	draftPath: string;
	draftName: string;
	projectId: string;
	validDraft: boolean;
	errors: string[];
	candidates: SemanticAgentTaskCandidate[];
};

export type CreateSemanticAgentTasksInput = {
	pathOrLatest: string;
	reportsPath: string;
	queue: StructuredTaskQueue;
	projectId?: string;
	maxCreatedTasks?: number;
};

export type SemanticAgentTaskCreationResult = {
	plan: SemanticAgentTaskPlan;
	created: StructuredTask[];
	skippedDuplicates: SemanticAgentTaskCandidate[];
};

const MAX_TEXT = 300;
const DEFAULT_MAX_TASKS_PER_CYCLE = 7;

export function buildSemanticAgentTaskPlan(
	pathOrLatest: string,
	reportsPath: string,
): SemanticAgentTaskPlan {
	const review = reviewSemanticCompactionDraft(pathOrLatest, reportsPath);
	if (!review.validDraft || !review.draft) {
		return {
			draftPath: review.path,
			draftName: basename(review.path),
			projectId: review.draft?.projectId ?? "unknown",
			validDraft: false,
			errors: review.errors,
			candidates: [],
		};
	}
	const candidates = groupCandidatesByDomain(
		candidatesFromDraft(review.draft, review),
	);
	return {
		draftPath: review.path,
		draftName: basename(review.path),
		projectId: review.draft.projectId,
		validDraft: true,
		errors: [],
		candidates,
	};
}

export function createSemanticAgentTasks(
	input: CreateSemanticAgentTasksInput,
): SemanticAgentTaskCreationResult {
	const plan = buildSemanticAgentTaskPlan(
		input.pathOrLatest,
		input.reportsPath,
	);
	const created: StructuredTask[] = [];
	const skippedDuplicates: SemanticAgentTaskCandidate[] = [];
	if (!plan.validDraft) return { plan, created, skippedDuplicates };
	const projectId = input.projectId ?? plan.projectId;
	const existing = input.queue.listTasks();
	const maxCreatedTasks = input.maxCreatedTasks ?? DEFAULT_MAX_TASKS_PER_CYCLE;
	for (const candidate of plan.candidates.slice(0, maxCreatedTasks)) {
		if (hasExistingDedupe(existing, candidate.dedupeKey, projectId)) {
			skippedDuplicates.push(candidate);
			continue;
		}
		const task = input.queue.enqueueTask(
			taskInputForCandidate(candidate, projectId),
		);
		created.push(task);
		existing.push(task);
	}
	return { plan, created, skippedDuplicates };
}

export function formatSemanticAgentTaskPlan(
	plan: SemanticAgentTaskPlan,
): string {
	if (!plan.validDraft) {
		return [
			"Semantic Agent Tasks Review",
			"",
			"Draft:",
			plan.draftName || plan.draftPath,
			"",
			"Draft válido:",
			"no",
			"",
			"Errores:",
			...formatList(plan.errors),
			"",
			"Nota segura:",
			"No ejecuté AgentLabs ni modifiqué código.",
		].join("\n");
	}
	return [
		"Semantic Agent Tasks Review",
		"",
		"Draft:",
		plan.draftName,
		"",
		"Tareas candidatas:",
		...formatCandidates(plan.candidates),
		"",
		"Acción:",
		"Crear tareas:",
		" /idu_semantic_agent_tasks_create latest",
		" idu-pi idu-semantic-agent-tasks-create latest",
		"",
		"Nota segura:",
		"No ejecuté AgentLabs ni modifiqué código.",
	].join("\n");
}

export function formatSemanticAgentTaskCreationResult(
	result: SemanticAgentTaskCreationResult,
): string {
	if (!result.plan.validDraft) return formatSemanticAgentTaskPlan(result.plan);
	return [
		"Semantic Agent Tasks Created",
		"",
		"Creadas:",
		...(result.created.length
			? result.created.map(
					(task) =>
						`- ${task.id} ${candidateTypeFromTask(task)} priority ${semanticPriorityFromTask(task)}`,
				)
			: ["- ninguna"]),
		"",
		"Omitidas por duplicado:",
		...formatList(
			result.skippedDuplicates.map(
				(candidate) => `${candidate.type} ${candidate.title}`,
			),
		),
		"",
		"Nota segura:",
		"Solo registré tareas para revisión. No ejecuté AgentLabs.",
	].join("\n");
}

function candidatesFromDraft(
	draft: SemanticCompactionDraft,
	review: SemanticCompactionReview,
): SemanticAgentTaskCandidate[] {
	const candidates: SemanticAgentTaskCandidate[] = [];
	for (const task of draft.suggestedAgentTasks) {
		const type = classifyType(task);
		candidates.push(
			candidate({
				type,
				title: short(task),
				reason: `Sugerencia SG4: ${short(task)}`,
				recommendation: recommendationFor(type),
				evidence: task,
				priority: priorityFor(type, task),
			}),
		);
	}
	for (const bug of draft.criticalBugs) {
		const text = recordSearchText(bug);
		const type = classifyType(text, "code_quality");
		candidates.push(
			candidate({
				type,
				title: short(String(bug.title ?? bug.id ?? "bug crítico")),
				reason: "Finding crítico/alto desde auditoría semántica.",
				recommendation: recommendationFor(type),
				evidence: text,
				priority: 5,
			}),
		);
	}
	for (const risk of draft.architecturalRisks) {
		candidates.push(
			candidate({
				type: "architecture",
				title: short(risk),
				reason: "Riesgo arquitectónico detectado por SG4.",
				recommendation: recommendationFor("architecture"),
				evidence: risk,
				priority: 4,
			}),
		);
	}
	const classifierEvidence = [
		...draft.classifierQualityReview.falseNegatives,
		...draft.classifierQualityReview.falsePositives,
		...draft.classifierQualityReview.errorPatterns,
		...review.summary.classifierErrors,
	].filter(Boolean);
	const needsClassifierReview =
		classifierEvidence.length > 0 ||
		[
			draft.classifierQualityReview.categoryCorrect,
			draft.classifierQualityReview.priorityCorrect,
			draft.classifierQualityReview.intentCorrect,
			draft.classifierQualityReview.guardrailCorrect,
		].includes("needs_review");
	if (needsClassifierReview) {
		candidates.push(
			candidate({
				type: "classifier_review",
				title: "Revisar clasificador de intención humana",
				reason: "classifierQualityReview marcó errores o needs_review.",
				recommendation: recommendationFor("classifier_review"),
				evidence:
					classifierEvidence.join("; ") ||
					"classifierQualityReview needs_review",
				priority: classifierEvidence.some((item) =>
					/high|blocker|delete|auth|db|security|schema|login/iu.test(item),
				)
					? 5
					: 4,
			}),
		);
	}
	for (const rule of draft.suggestedRuleUpdates) {
		candidates.push(
			candidate({
				type: "classifier_review",
				title: short(rule),
				reason:
					"suggestedRuleUpdates requiere revisión humana antes de SG5/SG6.",
				recommendation: recommendationFor("classifier_review"),
				evidence: rule,
				priority: priorityFor("classifier_review", rule),
			}),
		);
	}
	for (const skill of draft.suggestedSkillUpdates) {
		candidates.push(
			candidate({
				type: "skill_review",
				title: short(skill),
				reason: "suggestedSkillUpdates requiere revisión humana.",
				recommendation: recommendationFor("skill_review"),
				evidence: skill,
				priority: 3,
			}),
		);
	}
	return candidates;
}

function candidate(input: {
	type: SemanticAgentTaskType;
	title: string;
	priority: number;
	reason: string;
	recommendation: string;
	evidence: string;
	dedupeKey?: string;
}): SemanticAgentTaskCandidate {
	const title = short(input.title);
	const reason = short(input.reason);
	const recommendation = short(input.recommendation);
	const evidence = short(input.evidence);
	const dedupeKey =
		input.dedupeKey ?? dedupeKeyFor(input.type, title, evidence);
	const queuePriority = queuePriorityFor(input.priority);
	const text = [
		`Revisión SG5 semantic-audit — ${input.type}: ${title}`,
		`Motivo: ${reason}`,
		`Evidencia: ${evidence}`,
		`Recomendación: ${recommendation}`,
		`Prioridad semántica: ${input.priority}`,
		`Prioridad cola: ${queuePriority}`,
		"No ejecutar cambios sin aprobación humana.",
		`Dedupe: ${dedupeKey}`,
	].join("\n");
	return {
		type: input.type,
		category: "review",
		title,
		priority: input.priority,
		reason,
		recommendation,
		evidence,
		requiresHumanApproval: true,
		dedupeKey,
		queuePriority,
		text,
	};
}

function taskInputForCandidate(
	candidate: SemanticAgentTaskCandidate,
	projectId: string,
): StructuredTaskInput {
	return {
		text: candidate.text,
		originalText: candidate.title,
		category: "review",
		priority: candidate.queuePriority,
		semanticPriority: candidate.priority,
		emotion: "neutral",
		source: "semantic-audit",
		projectId,
	};
}

function classifyType(
	text: string,
	fallback: SemanticAgentTaskType = "code_quality",
): SemanticAgentTaskType {
	if (
		/auth|login|session|security|seguridad|token|credential|permiso/iu.test(
			text,
		)
	) {
		return "security";
	}
	if (
		/db|database|base de datos|schema|migration|sqlite|postgres|sql/iu.test(
			text,
		)
	) {
		return "database";
	}
	if (
		/arquitect|architecture|project core|constitution|flow|blueprint/iu.test(
			text,
		)
	) {
		return "architecture";
	}
	if (
		/classifier|clasificador|intenci[oó]n|false negative|false positive|guardrail/iu.test(
			text,
		)
	) {
		return "classifier_review";
	}
	if (/skill|habilidad|cleanup|limpiar|obsolet|noise|ruido/iu.test(text)) {
		return "skill_review";
	}
	if (/ui|ux|interfaz|pantalla|button|form/iu.test(text)) return "ui_ux";
	if (
		/doc|readme|document|performance|perf|slow|latenc|rendimiento|bug|test|fail|error|c[oó]digo|code/iu.test(
			text,
		)
	)
		return "code_quality";
	return fallback;
}

function priorityFor(type: SemanticAgentTaskType, text: string): number {
	if (type === "security" || type === "database") return 5;
	if (
		/critical|high|blocker|auth|login|security|db|database|schema|false negative/iu.test(
			text,
		)
	) {
		return 5;
	}
	if (type === "classifier_review") return 4;
	if (type === "architecture") return 4;
	if (type === "skill_review") return 3;
	return 3;
}

function recommendationFor(type: SemanticAgentTaskType): string {
	switch (type) {
		case "security":
			return "Revisar seguridad/autenticación con especialista antes de cambiar código.";
		case "database":
			return "Revisar arquitectura y riesgos de datos/schema antes de migrar.";
		case "architecture":
			return "Revisar consistencia con Project Core, Constitution, blueprint y flows.";
		case "classifier_review":
			return "Revisar reglas deterministic human-intent y falsos positivos/negativos.";
		case "skill_review":
			return "Revisar skills sugeridas; no modificar automáticamente.";
		case "ui_ux":
			return "Revisar flujo/interfaz con foco en UX y seguridad.";
		case "code_quality":
			return "Revisar bug, documentación, performance o calidad de código con pruebas antes de aplicar cambios.";
	}
}

function groupCandidatesByDomain(
	candidates: SemanticAgentTaskCandidate[],
): SemanticAgentTaskCandidate[] {
	const groups = new Map<SemanticAgentTaskType, SemanticAgentTaskCandidate[]>();
	for (const item of candidates) {
		const group = groups.get(item.type) ?? [];
		group.push(item);
		groups.set(item.type, group);
	}
	return [...groups.entries()]
		.map(([type, items]) => groupedCandidate(type, items))
		.sort((left, right) =>
			left.queuePriority === right.queuePriority
				? left.type.localeCompare(right.type)
				: left.queuePriority - right.queuePriority,
		);
}

function groupedCandidate(
	type: SemanticAgentTaskType,
	items: SemanticAgentTaskCandidate[],
): SemanticAgentTaskCandidate {
	const sorted = [...items].sort(
		(left, right) => right.priority - left.priority,
	);
	const top = sorted[0] ?? items[0];
	const priority = Math.max(...items.map((item) => item.priority));
	const topExamples = sorted
		.slice(0, 3)
		.map((item, index) => `${index + 1}) ${item.title}`)
		.join("; ");
	const evidence = short(
		items
			.map((item) => item.evidence)
			.filter(Boolean)
			.slice(0, 5)
			.join("; "),
	);
	return candidate({
		type,
		title: `${top.title} (${items.length} hallazgo${items.length === 1 ? "" : "s"})`,
		reason: `Hallazgos agrupados: ${items.length}. Top 3 ejemplos: ${topExamples}`,
		recommendation: top.recommendation || recommendationFor(type),
		evidence: `Resumen: ${evidence}`,
		priority,
		dedupeKey: dedupeKeyFor(
			type,
			items.map((item) => item.title).join(" "),
			evidence,
		),
	});
}

function hasExistingDedupe(
	tasks: StructuredTask[],
	dedupeKey: string,
	projectId: string,
): boolean {
	return tasks.some(
		(task) =>
			(task.projectId ?? projectId) === projectId &&
			task.source === "semantic-audit" &&
			task.text.includes(`Dedupe: ${dedupeKey}`),
	);
}

function dedupeKeyFor(
	type: SemanticAgentTaskType,
	title: string,
	evidence: string,
): string {
	return `${type}:${domainKeyFor(type, `${title} ${evidence}`)}`;
}

function queuePriorityFor(semanticPriority: number): number {
	if (semanticPriority >= 5) return 1;
	if (semanticPriority === 4) return 2;
	if (semanticPriority === 3) return 3;
	if (semanticPriority === 2) return 4;
	return 5;
}

function domainKeyFor(type: SemanticAgentTaskType, text: string): string {
	if (/auth|login|session|token|credential/iu.test(text)) return "auth-login";
	if (
		/db|database|base de datos|schema|migration|sqlite|postgres|sql/iu.test(
			text,
		)
	)
		return "database-schema";
	if (
		/classifier|clasificador|intenci[oó]n|false negative|false positive|guardrail/iu.test(
			text,
		)
	)
		return "classifier-intent";
	if (/skill|habilidad|cleanup|limpiar|obsolet|noise|ruido/iu.test(text))
		return "skill-maintenance";
	if (
		/project core|constitution|blueprint|flow|arquitect|architecture/iu.test(
			text,
		)
	)
		return "architecture-core";
	if (/ui|ux|interfaz|pantalla|button|form/iu.test(text)) return "ui-ux";
	if (/performance|perf|slow|latenc|rendimiento/iu.test(text))
		return "performance";
	return normalize(`${type} ${text}`);
}

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "")
		.slice(0, 120);
}

function short(text: string): string {
	const compact = text.replace(/\s+/gu, " ").trim();
	return compact.length > MAX_TEXT
		? `${compact.slice(0, MAX_TEXT - 1)}…`
		: compact;
}

function recordSearchText(record: Record<string, unknown>): string {
	return Object.values(record)
		.map((value) => (typeof value === "string" ? value : ""))
		.filter(Boolean)
		.join(" ");
}

function formatCandidates(candidates: SemanticAgentTaskCandidate[]): string[] {
	if (!candidates.length) return ["- ninguna"];
	return candidates.flatMap((candidate, index) => [
		`${index + 1}. ${candidate.type} — priority ${candidate.priority}`,
		`   Motivo: ${candidate.reason}`,
		`   Recomendación: ${candidate.recommendation}`,
		`   Requiere aprobación humana: ${candidate.requiresHumanApproval ? "sí" : "no"}`,
	]);
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function candidateTypeFromTask(task: StructuredTask): string {
	const match = /^Revisión SG5 semantic-audit — ([a-z_]+):/u.exec(task.text);
	return match?.[1] ?? task.category;
}

function semanticPriorityFromTask(task: StructuredTask): number {
	const match = /Prioridad semántica: (\d+)/u.exec(task.text);
	return match?.[1] ? Number(match[1]) : task.priority;
}
