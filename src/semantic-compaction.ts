import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type SemanticCompactionClassifierQualityReview = {
	emotionCorrect: "needs_review" | "likely_ok";
	categoryCorrect: "needs_review" | "likely_ok";
	priorityCorrect: "needs_review" | "likely_ok";
	intentCorrect: "needs_review" | "likely_ok";
	guardrailCorrect: "needs_review" | "likely_ok";
	falsePositives: string[];
	falseNegatives: string[];
	errorPatterns: string[];
	recommendedRules: string[];
};

export type SemanticCompactionClassificationSample = {
	originalText: string;
	category?: string;
	priority?: number;
	emotion?: string;
	intent?: string;
	guardStatus?: string;
	guardRisk?: string;
	approved?: boolean;
	rejected?: boolean;
};

export type SemanticCompactionDraft = {
	generatedAt: string;
	projectId: string;
	warning: "Borrador IA. No es fuente de verdad.";
	sourceAuditRunIds: string[];
	inputSummary: Record<string, unknown>;
	preservedRules: string[];
	criticalBugs: Array<Record<string, unknown>>;
	humanDecisions: string[];
	reusableLessons: string[];
	architecturalRisks: string[];
	classifierQualityReview: SemanticCompactionClassifierQualityReview;
	misclassifiedExamples: SemanticCompactionClassificationSample[];
	suggestedRuleUpdates: string[];
	suggestedSkillUpdates: string[];
	suggestedMemoryItems: string[];
	suggestedAgentTasks: string[];
	noiseToIgnore: string[];
	openQuestions: string[];
	rawOutput?: string;
};

export type SemanticCompactionReview = {
	path: string;
	validDraft: boolean;
	errors: string[];
	draft?: SemanticCompactionDraft;
	hasRawOutput: boolean;
	summary: {
		preservedRules: string[];
		criticalBugs: string[];
		classifierErrors: string[];
		suggestedRuleUpdates: string[];
		suggestedSkillUpdates: string[];
		suggestedAgentTasks: string[];
		noiseToIgnore: string[];
		openQuestions: string[];
	};
};

export type SemanticCompactionPromptInput = {
	projectId: string;
	inputSummary: Record<string, unknown>;
	auditRuns?: Array<Record<string, unknown>>;
	criticalBugs?: Array<Record<string, unknown>>;
	proposals?: Array<Record<string, unknown>>;
	userSignals?: Array<Record<string, unknown>>;
	structuredTasks?: SemanticCompactionClassificationSample[];
	labRuns?: Array<Record<string, unknown>>;
	semanticMemoryItems?: Array<Record<string, unknown>>;
	projectCore?: string;
	constitution?: string;
	classificationSamples?: SemanticCompactionClassificationSample[];
};

export type SaveSemanticCompactionDraftInput = {
	projectId: string;
	dbPath: string;
	reportsPath: string;
	workspaceRoot?: string;
	projectCore?: string;
	constitution?: string;
	now?: () => Date;
};

export type SaveSemanticCompactionDraftResult = {
	path: string;
	draft: SemanticCompactionDraft;
	prompt: string;
};

const WARNING = "Borrador IA. No es fuente de verdad." as const;
const DRAFT_PREFIX = "semantic-compaction-draft-";
const MAX_ROWS = 20;
const MAX_TEXT = 600;
const SECRET_PATTERN =
	/(token|secret|password|api[_-]?key|bearer|credentials?)\s*[:=]?\s*[^\s,;\]}]+/giu;

export function buildSemanticCompactionPrompt(
	input: SemanticCompactionPromptInput,
): string {
	const safeInput = sanitizeForPrompt(input);
	return [
		"Idu-pi SG4 Semantic Compaction Supervisor",
		"",
		"You are reviewing accumulated local events. Return JSON only matching SemanticCompactionDraft fields.",
		"Rules: do not delete data, do not apply rules, do not modify skills, do not execute AgentLabs.",
		"Separate useful memory from noise, preserve important rules, detect critical bugs and human decisions.",
		"Review classifierQualityReview: emotion, category, priority, intention, guardrails, false positives, false negatives, error patterns, recommended rules.",
		"",
		JSON.stringify(safeInput, null, 2),
	].join("\n");
}

export function saveSemanticCompactionDraft(
	input: SaveSemanticCompactionDraftInput,
): SaveSemanticCompactionDraftResult {
	const now = input.now?.() ?? new Date();
	const snapshot = collectCompactionSnapshot(input);
	const prompt = buildSemanticCompactionPrompt(snapshot);
	const draft = buildDeterministicDraft(snapshot, now);
	mkdirSync(input.reportsPath, { recursive: true });
	const path = join(
		input.reportsPath,
		`${DRAFT_PREFIX}${timestampForPath(now)}.json`,
	);
	writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`);
	return { path, draft, prompt };
}

export function reviewSemanticCompactionDraft(
	pathOrLatest: string,
	reportsPath: string,
): SemanticCompactionReview {
	const resolvedReports = resolve(reportsPath);
	const errors: string[] = [];
	const path = resolveDraftPath(pathOrLatest, resolvedReports, errors);
	if (!path) return emptyReview(pathOrLatest, errors);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return emptyReview(path, [
			`No pude leer JSON del draft: ${error instanceof Error ? error.message : String(error)}`,
		]);
	}
	const draft = parsed as Partial<SemanticCompactionDraft>;
	if (draft.warning !== WARNING) {
		errors.push("El draft no trae el warning requerido.");
	}
	if (typeof draft.rawOutput === "string") {
		errors.push(
			"El draft contiene rawOutput; requiere regenerar JSON estructurado antes de considerarlo válido.",
		);
	}
	if (!draft.generatedAt) errors.push("Falta generatedAt.");
	if (!draft.projectId) errors.push("Falta projectId.");
	const normalized = normalizeDraft(draft);
	return {
		path,
		validDraft: errors.length === 0,
		errors,
		draft: normalized,
		hasRawOutput: typeof draft.rawOutput === "string",
		summary: reviewSummary(normalized),
	};
}

export function formatSemanticCompactionDraft(
	result: SaveSemanticCompactionDraftResult,
): string {
	return [
		"Semantic Compaction Draft",
		"",
		"Proyecto:",
		result.draft.projectId,
		"",
		"Ruta:",
		result.path,
		"",
		"Warning:",
		result.draft.warning,
		"",
		"Resumen input:",
		...formatObject(result.draft.inputSummary),
		"",
		"Siguiente:",
		`semantic-compact-review ${result.path}`,
		"",
		"Nota segura:",
		"No apliqué reglas, no creé semantic_memory_items, no borré datos y no ejecuté AgentLabs.",
	].join("\n");
}

export function formatSemanticCompactionReview(
	review: SemanticCompactionReview,
): string {
	return [
		"Semantic Compaction Review",
		"",
		"Ruta:",
		review.path,
		"",
		"Draft válido:",
		review.validDraft ? "sí" : "no",
		"",
		"Errores:",
		...formatList(review.errors),
		"",
		"Reglas a preservar:",
		...formatList(review.summary.preservedRules),
		"",
		"Bugs críticos:",
		...formatList(review.summary.criticalBugs),
		"",
		"Errores de clasificación:",
		...formatList(review.summary.classifierErrors),
		"",
		"suggestedRuleUpdates:",
		...formatList(review.summary.suggestedRuleUpdates),
		"",
		"suggestedSkillUpdates:",
		...formatList(review.summary.suggestedSkillUpdates),
		"",
		"suggestedAgentTasks:",
		...formatList(review.summary.suggestedAgentTasks),
		"",
		"Ruido a ignorar:",
		...formatList(review.summary.noiseToIgnore),
		"",
		"Preguntas abiertas:",
		...formatList(review.summary.openQuestions),
		"",
		"Nota segura:",
		"Revisión solamente: no apliqué reglas, no modifiqué memoria definitiva y no ejecuté AgentLabs.",
	].join("\n");
}

function collectCompactionSnapshot(
	input: SaveSemanticCompactionDraftInput,
): SemanticCompactionPromptInput {
	const auditRuns = selectRows(
		input.dbPath,
		`SELECT id, trigger_reason AS triggerReason, mode, status, scanned_counts AS scannedCounts, summary, critical_findings AS criticalFindings, rules_to_preserve AS rulesToPreserve, suggested_agent_tasks AS suggestedAgentTasks, completed_at AS completedAt FROM semantic_audit_runs WHERE project_id = ${sqlString(input.projectId)} ORDER BY created_at DESC LIMIT ${MAX_ROWS};`,
	);
	const criticalBugs = selectRows(
		input.dbPath,
		`SELECT id, title, description, severity, confidence, status, evidence, suspected_cause AS suspectedCause, affected_files AS affectedFiles, dedupe_key AS dedupeKey, updated_at AS updatedAt FROM bug_findings WHERE project_id = ${sqlString(input.projectId)} AND severity IN ('critical','high') ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, updated_at DESC LIMIT ${MAX_ROWS};`,
	);
	const proposals = selectRows(
		input.dbPath,
		`SELECT p.id, p.proposal_type AS proposalType, p.summary, p.details, p.priority, p.status, p.created_by_agent_id AS createdByAgentId, p.created_at AS createdAt, f.title AS findingTitle, f.severity AS findingSeverity FROM proposals p JOIN bug_findings f ON f.id = p.finding_id WHERE f.project_id = ${sqlString(input.projectId)} ORDER BY p.created_at DESC LIMIT ${MAX_ROWS};`,
	);
	const userSignals = selectRows(
		input.dbPath,
		`SELECT id, source, raw_text AS rawText, detected_emotion AS detectedEmotion, urgency, confidence, matched_keywords AS matchedKeywords, created_at AS createdAt FROM user_signal_events WHERE project_id = ${sqlString(input.projectId)} ORDER BY created_at DESC LIMIT ${MAX_ROWS};`,
	);
	const labRuns = selectRows(
		input.dbPath,
		`SELECT id, agent_id AS agentId, agent_label AS agentLabel, status, summary, error, duration_label AS durationLabel, created_at AS createdAt FROM lab_runs WHERE project_id = ${sqlString(input.projectId)} ORDER BY created_at DESC LIMIT ${MAX_ROWS};`,
	);
	const semanticMemoryItems = selectRows(
		input.dbPath,
		`SELECT id, source_type AS sourceType, source_id AS sourceId, importance, title, summary, tags, status, updated_at AS updatedAt FROM semantic_memory_items WHERE project_id = ${sqlString(input.projectId)} ORDER BY updated_at DESC LIMIT ${MAX_ROWS};`,
	);
	const structuredTasks = readStructuredTaskSamples(input.workspaceRoot);
	return {
		projectId: input.projectId,
		inputSummary: {
			auditRuns: auditRuns.length,
			criticalFindings: criticalBugs.length,
			proposals: proposals.length,
			userSignals: userSignals.length,
			structuredTasks: structuredTasks.length,
			labRuns: labRuns.length,
			semanticMemoryItems: semanticMemoryItems.length,
		},
		auditRuns,
		criticalBugs,
		proposals,
		userSignals,
		structuredTasks,
		classificationSamples: structuredTasks,
		labRuns,
		semanticMemoryItems,
		...(input.projectCore ? { projectCore: input.projectCore } : {}),
		...(input.constitution ? { constitution: input.constitution } : {}),
	};
}

function buildDeterministicDraft(
	input: SemanticCompactionPromptInput,
	now: Date,
): SemanticCompactionDraft {
	const criticalBugs = (input.criticalBugs ?? []).map((bug) => ({
		id: String(bug.id ?? ""),
		title: sanitizeText(String(bug.title ?? "")),
		severity: String(bug.severity ?? ""),
		status: String(bug.status ?? ""),
		evidence: sanitizeText(String(bug.evidence ?? "")),
	}));
	const samples = input.classificationSamples ?? [];
	const hasAuth = textBucket(input).some((value) =>
		/auth|login|loggin|session|entrar/iu.test(value),
	);
	const hasDb = textBucket(input).some((value) =>
		/base de datos|database|db|schema|tabla/iu.test(value),
	);
	const hasCritical = criticalBugs.length > 0;
	return {
		generatedAt: now.toISOString(),
		projectId: input.projectId,
		warning: WARNING,
		sourceAuditRunIds: (input.auditRuns ?? [])
			.map((run) => String(run.id ?? ""))
			.filter(Boolean),
		inputSummary: input.inputSummary,
		preservedRules: [
			"No borrar datos durante compactación semántica.",
			"No aplicar suggestedRuleUpdates sin aprobación humana.",
			"No ejecutar AgentLabs desde SG4.",
			...(hasAuth
				? ["Auth/login requiere confirmación humana en riesgo alto."]
				: []),
			...(hasDb
				? ["DB/schema requiere confirmación humana en riesgo alto."]
				: []),
		],
		criticalBugs,
		humanDecisions: extractHumanDecisions(input),
		reusableLessons: [
			...(hasAuth
				? ["Lenguaje de login imperfecto debe mapear a auth/login/high."]
				: []),
			...(hasDb ? ["Falla + DB/schema debe mapear a bug/database/high."] : []),
		],
		architecturalRisks: [
			...(hasCritical
				? ["Existen findings critical/high pendientes de revisión humana."]
				: []),
			...(hasDb
				? ["Eventos DB/schema pueden impactar persistencia y migraciones."]
				: []),
		],
		classifierQualityReview: {
			emotionCorrect: "needs_review",
			categoryCorrect: "needs_review",
			priorityCorrect: "needs_review",
			intentCorrect: "needs_review",
			guardrailCorrect: samples.some((sample) => sample.guardStatus)
				? "needs_review"
				: "likely_ok",
			falsePositives: [],
			falseNegatives: [],
			errorPatterns: [
				"Revisar textos con typos de login/loggin/loguin/session.",
				"Revisar destructivos y DB aunque la categoría explícita sea ambigua.",
			],
			recommendedRules: defaultRuleUpdates(hasAuth, hasDb),
		},
		misclassifiedExamples: samples.filter((sample) =>
			["rejected", "needs_confirmation"].includes(sample.guardStatus ?? ""),
		),
		suggestedRuleUpdates: defaultRuleUpdates(hasAuth, hasDb),
		suggestedSkillUpdates: [
			...(hasAuth
				? [
						"Agregar o mejorar skill de seguridad auth/login si los eventos se repiten.",
					]
				: []),
			...(hasDb
				? [
						"Agregar o mejorar skill de revisión DB/schema si aparecen findings altos.",
					]
				: []),
			"Archivar skills que generen ruido sólo después de revisión humana.",
		],
		suggestedMemoryItems: [
			...(hasAuth
				? [
						"Guardar patrón validado: no puedo entrar/loggin/session → auth/login/high.",
					]
				: []),
			...(hasDb
				? [
						"Guardar patrón validado: falla/arreglar + base de datos/db/schema → bug/database/high.",
					]
				: []),
		],
		suggestedAgentTasks: [
			...(hasAuth ? ["Revisar seguridad auth/login."] : []),
			...(hasDb ? ["Revisar arquitectura de DB."] : []),
			"Revisar classifier de intención humana.",
			"Revisar Project Core vs código real.",
		],
		noiseToIgnore: [
			"Raw output largo de lab_runs no incluido en SG4.",
			"Eventos informativos repetidos sin finding ni decisión humana.",
		],
		openQuestions: [
			"¿Qué suggestedRuleUpdates se aprueban para SG5?",
			"¿Qué suggestedAgentTasks deben convertirse en cola AgentLab?",
		],
	};
}

function defaultRuleUpdates(hasAuth: boolean, hasDb: boolean): string[] {
	return [
		...(hasDb
			? [
					"Si texto contiene falla/arreglar + base de datos/db/schema → bug/database/high.",
				]
			: []),
		...(hasAuth
			? [
					"Si texto contiene no puedo entrar/me saca/loggin/loguin/session → auth/login/high.",
				]
			: []),
		"Si tarea docs no toca auth/db/security → low risk.",
	];
}

function extractHumanDecisions(input: SemanticCompactionPromptInput): string[] {
	const proposals = input.proposals ?? [];
	return proposals
		.filter((proposal) =>
			["approved", "rejected"].includes(String(proposal.status)),
		)
		.map(
			(proposal) =>
				`${proposal.status}: ${sanitizeText(String(proposal.summary ?? proposal.id ?? ""))}`,
		)
		.slice(0, 10);
}

function readStructuredTaskSamples(
	workspaceRoot: string | undefined,
): SemanticCompactionClassificationSample[] {
	if (!workspaceRoot) return [];
	const path = join(workspaceRoot, "reports", "tasks.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter(Boolean)
		.slice(-MAX_ROWS)
		.map((line) => safeJson(line))
		.filter((value): value is Record<string, unknown> => Boolean(value))
		.map((task) => ({
			originalText: sanitizeText(String(task.originalText ?? task.text ?? "")),
			category: stringValue(task.category),
			priority: numberValue(task.priority),
			emotion: stringValue(task.emotion),
			intent: [
				task.intentKind,
				primaryConcept(task.intentConcepts),
				task.intentRiskHint,
			]
				.filter(Boolean)
				.join("/"),
			guardStatus: stringValue(task.guardStatus),
			guardRisk: stringValue(task.guardRisk),
			approved: task.guardStatus === "approved",
			rejected: task.guardStatus === "rejected",
		}));
}

function resolveDraftPath(
	pathOrLatest: string,
	reportsPath: string,
	errors: string[],
): string | undefined {
	if (pathOrLatest === "latest") {
		if (!existsSync(reportsPath)) {
			errors.push("No existe reportsPath.");
			return undefined;
		}
		const latest = readdirSync(reportsPath)
			.filter(isDraftFileName)
			.sort()
			.at(-1);
		if (!latest) {
			errors.push("No encontré drafts semantic-compaction en reports.");
			return undefined;
		}
		return join(reportsPath, latest);
	}
	const candidate = resolve(
		isAbsolute(pathOrLatest) ? pathOrLatest : join(reportsPath, pathOrLatest),
	);
	const relativeToReports = relative(reportsPath, candidate);
	if (
		relativeToReports.startsWith("..") ||
		isAbsolute(relativeToReports) ||
		relativeToReports === ""
	) {
		errors.push("La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports.");
		return undefined;
	}
	if (!isDraftFileName(basename(candidate))) {
		errors.push("El archivo debe llamarse semantic-compaction-draft-*.json.");
		return undefined;
	}
	if (!existsSync(candidate)) {
		errors.push("No existe el draft solicitado.");
		return undefined;
	}
	return candidate;
}

function isDraftFileName(name: string): boolean {
	return /^semantic-compaction-draft-\d{8}-\d{6}\.json$/u.test(name);
}

function normalizeDraft(
	draft: Partial<SemanticCompactionDraft>,
): SemanticCompactionDraft {
	return {
		generatedAt: String(draft.generatedAt ?? ""),
		projectId: String(draft.projectId ?? ""),
		warning: WARNING,
		sourceAuditRunIds: arrayOfStrings(draft.sourceAuditRunIds),
		inputSummary: isRecord(draft.inputSummary) ? draft.inputSummary : {},
		preservedRules: arrayOfStrings(draft.preservedRules),
		criticalBugs: Array.isArray(draft.criticalBugs)
			? (draft.criticalBugs.filter(isRecord) as Array<Record<string, unknown>>)
			: [],
		humanDecisions: arrayOfStrings(draft.humanDecisions),
		reusableLessons: arrayOfStrings(draft.reusableLessons),
		architecturalRisks: arrayOfStrings(draft.architecturalRisks),
		classifierQualityReview: {
			emotionCorrect:
				draft.classifierQualityReview?.emotionCorrect ?? "needs_review",
			categoryCorrect:
				draft.classifierQualityReview?.categoryCorrect ?? "needs_review",
			priorityCorrect:
				draft.classifierQualityReview?.priorityCorrect ?? "needs_review",
			intentCorrect:
				draft.classifierQualityReview?.intentCorrect ?? "needs_review",
			guardrailCorrect:
				draft.classifierQualityReview?.guardrailCorrect ?? "needs_review",
			falsePositives: arrayOfStrings(
				draft.classifierQualityReview?.falsePositives,
			),
			falseNegatives: arrayOfStrings(
				draft.classifierQualityReview?.falseNegatives,
			),
			errorPatterns: arrayOfStrings(
				draft.classifierQualityReview?.errorPatterns,
			),
			recommendedRules: arrayOfStrings(
				draft.classifierQualityReview?.recommendedRules,
			),
		},
		misclassifiedExamples: Array.isArray(draft.misclassifiedExamples)
			? (draft.misclassifiedExamples as SemanticCompactionClassificationSample[])
			: [],
		suggestedRuleUpdates: arrayOfStrings(draft.suggestedRuleUpdates),
		suggestedSkillUpdates: arrayOfStrings(draft.suggestedSkillUpdates),
		suggestedMemoryItems: arrayOfStrings(draft.suggestedMemoryItems),
		suggestedAgentTasks: arrayOfStrings(draft.suggestedAgentTasks),
		noiseToIgnore: arrayOfStrings(draft.noiseToIgnore),
		openQuestions: arrayOfStrings(draft.openQuestions),
	};
}

function reviewSummary(
	draft: SemanticCompactionDraft,
): SemanticCompactionReview["summary"] {
	return {
		preservedRules: draft.preservedRules,
		criticalBugs: draft.criticalBugs.map((bug) =>
			String(bug.title ?? bug.id ?? "bug crítico sin título"),
		),
		classifierErrors: [
			...draft.classifierQualityReview.errorPatterns,
			...draft.misclassifiedExamples.map(
				(item) => `${item.originalText}: ${item.intent ?? "intent?"}`,
			),
		],
		suggestedRuleUpdates: draft.suggestedRuleUpdates,
		suggestedSkillUpdates: draft.suggestedSkillUpdates,
		suggestedAgentTasks: draft.suggestedAgentTasks,
		noiseToIgnore: draft.noiseToIgnore,
		openQuestions: draft.openQuestions,
	};
}

function emptyReview(path: string, errors: string[]): SemanticCompactionReview {
	return {
		path,
		validDraft: false,
		errors,
		hasRawOutput: false,
		summary: {
			preservedRules: [],
			criticalBugs: [],
			classifierErrors: [],
			suggestedRuleUpdates: [],
			suggestedSkillUpdates: [],
			suggestedAgentTasks: [],
			noiseToIgnore: [],
			openQuestions: [],
		},
	};
}

function selectRows(
	dbPath: string,
	sql: string,
): Array<Record<string, unknown>> {
	if (!existsSync(dbPath)) return [];
	try {
		const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		const rows = output
			? (JSON.parse(output) as Array<Record<string, unknown>>)
			: [];
		return rows.map(sanitizeRecord);
	} catch {
		return [];
	}
}

function sanitizeForPrompt(
	input: SemanticCompactionPromptInput,
): SemanticCompactionPromptInput {
	return sanitizeRecord(input) as SemanticCompactionPromptInput;
}

function sanitizeRecord(
	record: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (/rawOutput/iu.test(key)) continue;
		if (Array.isArray(value)) {
			result[key] = value
				.slice(0, MAX_ROWS)
				.map((item) =>
					isRecord(item) ? sanitizeRecord(item) : sanitizeValue(item),
				);
		} else if (isRecord(value)) {
			result[key] = sanitizeRecord(value);
		} else {
			result[key] = sanitizeValue(value);
		}
	}
	return result;
}

function sanitizeValue(value: unknown): unknown {
	if (typeof value !== "string") return value;
	return sanitizeText(value);
}

function sanitizeText(value: string): string {
	const redacted = value.replace(SECRET_PATTERN, "$1=[REDACTED]");
	return redacted.length > MAX_TEXT
		? `${redacted.slice(0, MAX_TEXT)}…`
		: redacted;
}

function sqlString(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

function timestampForPath(date: Date): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function formatObject(value: Record<string, unknown>): string[] {
	const entries = Object.entries(value);
	return entries.length
		? entries.map(([key, item]) => `- ${key}: ${String(item)}`)
		: ["- ninguno"];
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function textBucket(input: SemanticCompactionPromptInput): string[] {
	return JSON.stringify(input).split(/[\n,{}[\]"]+/u);
}

function primaryConcept(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	return (
		value.find((item) => item === "auth") ??
		value.find((item) => item !== "task") ??
		value[0]
	);
}

function safeJson(line: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(line) as unknown;
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
