import { join } from "node:path";
import {
	loadSupervisorLearningRules,
	matchingRules,
} from "./supervisor-learning-rules.js";
import {
	analyzeUserSignal,
	type UserEmotion,
	type UserSignalConfidence,
} from "./user-signal.js";

export type HumanIntent =
	| "bug_report"
	| "feature_request"
	| "change_request"
	| "documentation_task"
	| "question"
	| "status_check"
	| "review_request"
	| "command"
	| "unknown";

export type HumanIntentConcept =
	| "auth"
	| "login"
	| "session"
	| "access"
	| "password"
	| "permission"
	| "database"
	| "schema"
	| "security"
	| "ui"
	| "dashboard"
	| "module"
	| "flow"
	| "recurring_failure"
	| "urgent"
	| "docs"
	| "tests"
	| "deployment"
	| "performance"
	| "cost_tokens"
	| "quality"
	| "maintenance"
	| "task"
	| "queue"
	| "semantic-audit"
	| "project-core"
	| "configuration"
	| "review"
	| "unknown";

export type HumanIntentRiskHint =
	| "security"
	| "data_loss"
	| "auth_change"
	| "db_change"
	| "architecture_change"
	| "scope_change"
	| "low_risk";

export type HumanIntentTaskCategory =
	| "bug"
	| "feature"
	| "refactor"
	| "docs"
	| "review"
	| "general";

export type HumanIntentLanguageHint =
	| "spanish"
	| "english"
	| "mixed"
	| "unknown";

export type HumanIntentRecommendedHandling =
	| "record_only"
	| "preflight"
	| "needs_confirmation"
	| "safe_to_execute"
	| "ask_clarification";

export type IntentRiskHint = "low" | "medium" | "high" | "blocker";
export type IntentConcept = HumanIntentConcept;
export type IntentKind =
	| HumanIntent
	| "task"
	| "approval"
	| "rejection"
	| "status";
export type IntentAction =
	| "answer"
	| "enqueue"
	| "require_confirmation"
	| "inspect_status"
	| "approve"
	| "reject"
	| "cancel"
	| "configure"
	| "review"
	| "none";

export interface HumanIntentClassification {
	originalText: string;
	normalizedText: string;
	languageHints: HumanIntentLanguageHint;
	intent: HumanIntent;
	taskCategory: HumanIntentTaskCategory;
	concepts: HumanIntentConcept[];
	riskHints: HumanIntentRiskHint[];
	confidence: UserSignalConfidence;
	matchedEvidence: string[];
	ambiguity: string[];
	shouldAskClarification: boolean;
	shouldBlockIfIduActive: boolean;
	recommendedHandling: HumanIntentRecommendedHandling;

	// Backward-compatible INT-1A fields used by existing queue/CLI code.
	kind: IntentKind;
	action: IntentAction;
	riskHint: IntentRiskHint;
	requiresHumanConfirmation: boolean;
	emotion: UserEmotion;
	urgency: number;
	evidence: string[];
}

export type IntentClassification = HumanIntentClassification;

export interface IntentClassificationContext {
	taskCategory?: string;
	projectRisk?: IntentRiskHint;
}

export interface ClassifyHumanIntentOptions {
	explicitCategory?: string;
}

export interface HumanIntentProvider {
	classify(
		text: string,
		options?: ClassifyHumanIntentOptions,
	): Promise<HumanIntentClassification> | HumanIntentClassification;
}

type Rule = {
	concept?: HumanIntentConcept;
	intent?: HumanIntent;
	riskHints?: HumanIntentRiskHint[];
	terms: string[];
};

const TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
	[/\blogg?in\b/gu, "login"],
	[/\bloguin\b/gu, "login"],
	[/\blegin\b/gu, "login"],
	[/\bsec?ion\b/gu, "sesion"],
	[/\bsession\b/gu, "session"],
	[/\bsegimos\b/gu, "seguimos"],
	[/\bnuevamnet\b/gu, "nuevamente"],
	[/\bmirda\b/gu, "mierda"],
	[/\bcontrasena\b/gu, "contraseña"],
];

const CONCEPT_RULES: Rule[] = [
	{
		concept: "login",
		riskHints: ["auth_change"],
		terms: [
			"login",
			"log in",
			"signin",
			"sign in",
			"sign-in",
			"inicio de sesion",
			"inicio sesion",
			"iniciar sesion",
		],
	},
	{
		concept: "auth",
		riskHints: ["auth_change", "security"],
		terms: [
			"auth",
			"authentication",
			"autentic",
			"no puedo entrar",
			"no entra",
			"no ingresa",
			"ingresar",
			"entrar",
			"usuario no entra",
			"usuario no puede ingresar",
			"user cannot login",
			"user cannot sign in",
			"cannot login",
			"cannot sign in",
		],
	},
	{
		concept: "access",
		riskHints: ["auth_change"],
		terms: [
			"acceso",
			"pantalla de acceso",
			"access",
			"access screen",
			"cannot sign in",
			"no puedo entrar",
		],
	},
	{
		concept: "session",
		riskHints: ["auth_change"],
		terms: [
			"sesion",
			"session",
			"me saca del sistema",
			"se sale del sistema",
			"kicked out",
			"logs me out",
			"session expires",
		],
	},
	{
		concept: "password",
		riskHints: ["auth_change", "security"],
		terms: [
			"clave",
			"contraseña",
			"password",
			"password is wrong",
			"clave mala",
		],
	},
	{
		concept: "permission",
		riskHints: ["security", "auth_change"],
		terms: ["permiso", "permisos", "permission", "permissions"],
	},
	{
		concept: "database",
		riskHints: ["db_change", "data_loss"],
		terms: [
			"base de datos",
			"bases de datos",
			"bd",
			"db",
			"database",
			"databases",
			"sqlite",
			"postgres",
			"postgresql",
			"mysql",
			"supabase",
		],
	},
	{
		concept: "schema",
		riskHints: ["db_change", "data_loss"],
		terms: [
			"tabla",
			"tablas",
			"table",
			"tables",
			"schema",
			"esquema",
			"migration",
			"migracion",
			"users table",
			"tabla users",
		],
	},
	{
		concept: "security",
		riskHints: ["security"],
		terms: ["security", "seguridad", "token", "secret", "secreto"],
	},
	{
		concept: "ui",
		terms: [
			"ui",
			"interfaz",
			"pantalla",
			"screen",
			"button",
			"boton",
			"botón",
			"form",
			"formulario",
			"access screen",
		],
	},
	{ concept: "dashboard", terms: ["dashboard", "panel"] },
	{
		concept: "module",
		riskHints: ["architecture_change", "scope_change"],
		terms: ["modulo", "módulo", "module"],
	},
	{
		concept: "flow",
		riskHints: ["architecture_change", "scope_change"],
		terms: [
			"flujo",
			"flow",
			"conecta",
			"conectar",
			"connect",
			"compras con inventario",
		],
	},
	{
		concept: "recurring_failure",
		terms: [
			"otra vez",
			"nuevamente",
			"de nuevo",
			"sigue fallando",
			"volvio a fallar",
			"falla recurrente",
			"sigue igual",
			"keeps failing",
			"again",
			"still failing",
			"recurring",
			"happens again",
		],
	},
	{
		concept: "urgent",
		terms: [
			"urgente",
			"critico",
			"crítico",
			"ahora",
			"ya",
			"por la mierda",
			"por la mirda",
			"immediately",
			"urgent",
			"critical",
			"asap",
			"now",
		],
	},
	{
		concept: "docs",
		terms: [
			"documenta",
			"explica",
			"resume",
			"readme",
			"manual",
			"guia",
			"guía",
			"documentation",
			"document",
			"explain",
			"summarize",
			"docs",
			"guide",
		],
	},
	{ concept: "tests", terms: ["test", "tests", "prueba", "pruebas", "build"] },
	{
		concept: "deployment",
		terms: [
			"deploy",
			"deployment",
			"produccion",
			"production",
			"release",
			"push",
		],
	},
	{
		concept: "performance",
		terms: ["performance", "rendimiento", "lento", "slow"],
	},
	{
		concept: "cost_tokens",
		terms: ["tokens", "costo", "cost", "barato", "expensive"],
	},
	{
		concept: "quality",
		terms: [
			"calidad",
			"quality",
			"bien",
			"correcto",
			"code",
			"revisa",
			"review",
		],
	},
	{ concept: "maintenance", terms: ["mantenimiento", "maintenance"] },
];

const BUG_TERMS = [
	"falla",
	"fallas",
	"fallo",
	"fallando",
	"no funciona",
	"se cae",
	"se cayo",
	"error",
	"rompe",
	"roto",
	"no entra",
	"me saca",
	"quedo pegado",
	"queda cargando",
	"no responde",
	"arreglar",
	"arreglalo",
	"arreglarla",
	"corregir",
	"reparar",
	"solucionar",
	"fails",
	"failed",
	"failing",
	"broken",
	"bug",
	"crash",
	"crashes",
	"not working",
	"does not work",
	"stuck",
	"freezes",
	"fix",
	"repair",
	"solve",
];
const CHANGE_TERMS = [
	"agrega",
	"agregar",
	"crea",
	"crear",
	"implementa",
	"implementar",
	"necesito que tenga",
	"quiero que incluya",
	"conectar",
	"conecta",
	"modificar",
	"modifica",
	"cambia",
	"cambiar",
	"add",
	"create",
	"implement",
	"connect",
	"change",
	"modify",
	"include",
];
const DOC_TERMS = [
	"documenta",
	"explica",
	"resume",
	"readme",
	"manual",
	"guia",
	"guía",
	"documentation",
	"document",
	"explain",
	"summarize",
	"docs",
	"guide",
];
const REVIEW_TERMS = [
	"revisa",
	"analiza",
	"valida",
	"audita",
	"verifica",
	"review",
	"analyze",
	"validate",
	"audit",
	"verify",
	"check",
];
const STATUS_TERMS = [
	"estado",
	"status",
	"queue-detail",
	"cola",
	"mostrame",
	"mostrar",
];
const QUESTION_TERMS = [
	"?",
	"que ",
	"qué ",
	"como ",
	"cómo ",
	"por que",
	"por qué",
	"cual ",
	"cuál ",
	"cuando",
	"when",
	"how",
	"why",
	"what",
];
const COMMAND_TERMS = [
	"idu-task",
	"idu-status",
	"idu-queue",
	"queue-detail",
	"queue_approve",
	"queue_reject",
	"queue_complete",
];
const REFACTOR_TERMS = ["refactor", "refactorizar", "reestructurar", "limpiar"];
const APPROVAL_TERMS = [
	"aproba",
	"aprobar",
	"approve",
	"approval",
	"ok",
	"dale",
	"confirmo",
	"confirmar",
	"confirm",
];
const REJECTION_TERMS = ["rechaza", "rechazar", "reject", "rejection"];
const DESTRUCTIVE_TERMS = [
	"borra",
	"borrar",
	"delete",
	"drop",
	"truncate",
	"wipe",
	"elimina",
	"eliminar",
	"remove",
];

const HIGH_RISK_HINTS = new Set<HumanIntentRiskHint>([
	"security",
	"data_loss",
	"auth_change",
	"db_change",
	"architecture_change",
	"scope_change",
]);

export function normalizeHumanText(text: string): string {
	let normalized = text
		.toLocaleLowerCase("es")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^\p{L}\p{N}_? -]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
		normalized = normalized.replace(pattern, replacement);
	}
	return normalized.replace(/\s+/gu, " ").trim();
}

export function classifyHumanIntent(
	text: string,
	options: ClassifyHumanIntentOptions = {},
): HumanIntentClassification {
	const originalText = text;
	const normalizedText = normalizeHumanText(text);
	const signal = analyzeUserSignal(text);
	const concepts: HumanIntentConcept[] = [];
	const riskHints: HumanIntentRiskHint[] = [];
	const matchedEvidence: string[] = [];

	for (const rule of CONCEPT_RULES) {
		const matches = rule.terms.filter((term) =>
			includesTerm(normalizedText, term),
		);
		if (!matches.length) continue;
		if (rule.concept) concepts.push(rule.concept);
		if (rule.riskHints) riskHints.push(...rule.riskHints);
		matchedEvidence.push(...matches);
	}

	const bugMatches = matchingTerms(normalizedText, BUG_TERMS);
	const changeMatches = matchingTerms(normalizedText, CHANGE_TERMS);
	const docsMatches = matchingTerms(normalizedText, DOC_TERMS);
	const reviewMatches = matchingTerms(normalizedText, REVIEW_TERMS);
	const statusMatches = matchingTerms(normalizedText, STATUS_TERMS);
	const questionMatches = matchingTerms(normalizedText, QUESTION_TERMS);
	const commandMatches = matchingTerms(normalizedText, COMMAND_TERMS);
	const refactorMatches = matchingTerms(normalizedText, REFACTOR_TERMS);
	const approvalMatches = matchingTerms(normalizedText, APPROVAL_TERMS);
	const rejectionMatches = matchingTerms(normalizedText, REJECTION_TERMS);
	const destructiveMatches = matchingTerms(normalizedText, DESTRUCTIVE_TERMS);
	matchedEvidence.push(
		...bugMatches,
		...changeMatches,
		...docsMatches,
		...reviewMatches,
		...statusMatches,
		...questionMatches,
		...commandMatches,
		...refactorMatches,
		...approvalMatches,
		...rejectionMatches,
		...destructiveMatches,
		...signal.matchedKeywords,
	);

	const hasBug = bugMatches.length > 0;
	const hasChange = changeMatches.length > 0;
	const hasDocs = docsMatches.length > 0;
	const hasReview = reviewMatches.length > 0;
	const hasStatus = statusMatches.length > 0;
	const hasQuestion = questionMatches.length > 0;
	const hasCommand = commandMatches.length > 0;
	const hasRefactor = refactorMatches.length > 0;
	const hasApproval = approvalMatches.length > 0;
	const hasRejection = rejectionMatches.length > 0;
	const hasDestructive = destructiveMatches.length > 0;
	const criticalConcept = concepts.some((concept) =>
		[
			"auth",
			"login",
			"session",
			"access",
			"password",
			"permission",
			"database",
			"schema",
			"security",
			"module",
			"flow",
		].includes(concept),
	);

	let intent: HumanIntent = "unknown";
	if (hasApproval) {
		intent = "command";
	} else if (hasRejection) {
		intent = "command";
	} else if (
		hasBug ||
		(hasQuestion && criticalConcept && concepts.includes("recurring_failure"))
	) {
		intent = "bug_report";
	} else if (hasDocs) {
		intent = "documentation_task";
	} else if (hasReview) {
		intent = "review_request";
	} else if (hasStatus) {
		intent = "status_check";
	} else if (hasChange || hasRefactor) {
		intent = hasChange && !hasRefactor ? "change_request" : "change_request";
	} else if (hasQuestion) {
		intent = "question";
	} else if (hasCommand) {
		intent = "command";
	} else if (concepts.length > 0) {
		intent = criticalConcept ? "bug_report" : "feature_request";
	}

	if (hasChange && !hasBug && !hasDocs && !hasReview) {
		intent = "change_request";
	}
	if (hasChange && !criticalConcept && !hasBug) intent = "feature_request";

	let taskCategory = inferTaskCategoryFromIntent(
		{
			intent,
			concepts,
			normalizedText,
			matchedEvidence,
		} as HumanIntentClassification,
		options.explicitCategory,
	);
	if (concepts.includes("schema") && !concepts.includes("database")) {
		concepts.push("database");
	}
	if (
		concepts.some((concept) =>
			["login", "session", "access", "password", "permission"].includes(
				concept,
			),
		) &&
		!concepts.includes("auth")
	) {
		concepts.push("auth");
	}
	if (concepts.includes("password") && !concepts.includes("security")) {
		concepts.push("security");
	}
	if (hasDestructive) {
		riskHints.push("scope_change");
		if (concepts.includes("database") || concepts.includes("schema")) {
			riskHints.push("data_loss", "db_change");
		}
	}
	if (taskCategory === "refactor") concepts.push("maintenance");
	if (taskCategory !== "general") concepts.push("task");

	if (concepts.includes("module") || concepts.includes("flow")) {
		riskHints.push("architecture_change", "scope_change");
	}
	if (concepts.includes("security")) riskHints.push("security");

	let dynamicShouldBlockIfIduActive = false;
	for (const rule of loadMatchingSupervisorLearningRules(originalText)) {
		concepts.push(...rule.outcome.concepts);
		riskHints.push(
			...rule.outcome.riskHints.filter((risk) => risk !== "low_risk"),
		);
		matchedEvidence.push(`learning-rule:${rule.id}`);
		if (
			rule.outcome.intent &&
			(intent === "unknown" || intent === "feature_request")
		) {
			intent = rule.outcome.intent;
		}
		if (rule.outcome.taskCategory && options.explicitCategory === undefined) {
			if (
				rule.outcome.taskCategory !== "general" &&
				taskCategory === "general"
			) {
				taskCategory = rule.outcome.taskCategory;
				concepts.push("task");
			}
		}
		if (rule.outcome.shouldBlockIfIduActive)
			dynamicShouldBlockIfIduActive = true;
	}
	if (riskHints.length === 0) riskHints.push("low_risk");

	const uniqueConcepts: HumanIntentConcept[] = unique(
		concepts.length ? concepts : (["unknown"] as HumanIntentConcept[]),
	);
	const uniqueRiskHints: HumanIntentRiskHint[] = unique(riskHints);
	const legacyRisk = hasDestructive
		? "blocker"
		: legacyRiskHint(uniqueRiskHints, uniqueConcepts, intent);
	const shouldBlockIfIduActive =
		dynamicShouldBlockIfIduActive ||
		legacyRisk === "high" ||
		legacyRisk === "blocker";
	const ambiguity = ambiguityFor(
		intent,
		uniqueConcepts,
		matchedEvidence,
		normalizedText,
	);
	const confidence = confidenceFor(
		signal.confidence,
		matchedEvidence.length,
		ambiguity.length,
	);
	const shouldAskClarification =
		confidence === "low" &&
		(shouldBlockIfIduActive || intent === "unknown" || ambiguity.length > 0);
	const recommendedHandling = handlingFor(
		intent,
		shouldAskClarification,
		shouldBlockIfIduActive,
	);

	return {
		originalText,
		normalizedText,
		languageHints: languageHint(originalText, normalizedText),
		intent,
		taskCategory,
		concepts: uniqueConcepts,
		riskHints: uniqueRiskHints,
		confidence,
		matchedEvidence: unique(matchedEvidence),
		ambiguity,
		shouldAskClarification,
		shouldBlockIfIduActive,
		recommendedHandling,
		kind: legacyKindFor(
			intent,
			hasApproval,
			hasRejection,
			hasStatus,
			legacyRisk,
		),
		action: actionFor(recommendedHandling, intent, hasApproval, hasRejection),
		riskHint: legacyRisk,
		requiresHumanConfirmation: shouldBlockIfIduActive,
		emotion: signal.emotion,
		urgency: signal.urgency,
		evidence: unique(matchedEvidence),
	};
}

export function classifyHumanIntentWithContext(
	text: string,
	context: IntentClassificationContext = {},
): HumanIntentClassification {
	const classification = classifyHumanIntent(text, {
		explicitCategory: context.taskCategory,
	});
	const riskHint = context.projectRisk
		? maxLegacyRisk(classification.riskHint, context.projectRisk)
		: classification.riskHint;
	const shouldBlockIfIduActive =
		classification.shouldBlockIfIduActive ||
		riskHint === "high" ||
		riskHint === "blocker";
	return {
		...classification,
		riskHint,
		shouldBlockIfIduActive,
		requiresHumanConfirmation: shouldBlockIfIduActive,
		action: actionFor(
			handlingFor(
				classification.intent,
				classification.shouldAskClarification,
				shouldBlockIfIduActive,
			),
			classification.intent,
		),
		recommendedHandling: handlingFor(
			classification.intent,
			classification.shouldAskClarification,
			shouldBlockIfIduActive,
		),
	};
}

export function classifyIntentDeterministic(
	text: string,
): HumanIntentClassification {
	return classifyHumanIntent(text);
}

export function classifyIntentWithContext(
	text: string,
	context: IntentClassificationContext = {},
): HumanIntentClassification {
	return classifyHumanIntentWithContext(text, context);
}

export async function classifyHumanIntentWithProvider(
	text: string,
	provider: HumanIntentProvider,
	options: ClassifyHumanIntentOptions = {},
): Promise<HumanIntentClassification> {
	return provider.classify(text, options);
}

export function inferTaskCategoryFromIntent(
	classification: Pick<
		HumanIntentClassification,
		"intent" | "concepts" | "normalizedText" | "matchedEvidence"
	>,
	explicitCategory?: string,
): HumanIntentTaskCategory {
	const explicit = normalizeCategory(explicitCategory);
	if (explicit) return explicit;
	if (classification.intent === "bug_report") return "bug";
	if (classification.intent === "documentation_task") return "docs";
	if (classification.intent === "review_request") return "review";
	if (
		classification.matchedEvidence?.some((item) =>
			REFACTOR_TERMS.includes(item),
		)
	)
		return "refactor";
	if (
		classification.intent === "feature_request" ||
		classification.intent === "change_request"
	)
		return "feature";
	return "general";
}

export function formatHumanIntentClassification(
	classification: HumanIntentClassification,
): string {
	return [
		`intent: ${classification.intent}`,
		`taskCategory: ${classification.taskCategory}`,
		`category: ${classification.taskCategory}`,
		`concepts: ${classification.concepts.join(", ")}`,
		`risk: ${classification.riskHint}`,
		`riskHints: ${classification.riskHints.join(", ")}`,
		`confidence: ${classification.confidence}`,
		`evidence: ${classification.matchedEvidence.length ? classification.matchedEvidence.join(", ") : "none"}`,
	].join("\n");
}

export function formatIntentClassification(
	classification: HumanIntentClassification,
): string {
	return formatHumanIntentClassification(classification);
}

function loadMatchingSupervisorLearningRules(text: string) {
	const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT?.trim();
	if (!workspaceRoot) return [];
	try {
		const loaded = loadSupervisorLearningRules(join(workspaceRoot, "reports"));
		return loaded.file ? matchingRules(loaded.file.rules, text) : [];
	} catch {
		return [];
	}
}

function normalizeCategory(
	category: string | undefined,
): HumanIntentTaskCategory | undefined {
	switch (category?.trim().toLowerCase()) {
		case "bug":
		case "feature":
		case "refactor":
		case "docs":
		case "review":
		case "general":
			return category.trim().toLowerCase() as HumanIntentTaskCategory;
		default:
			return undefined;
	}
}

function matchingTerms(normalizedText: string, terms: string[]): string[] {
	return terms.filter((term) => includesTerm(normalizedText, term));
}

function includesTerm(normalizedText: string, term: string): boolean {
	const normalizedTerm = normalizeHumanText(term);
	if (!normalizedTerm) return false;
	if (normalizedTerm.length <= 3 || normalizedTerm === "auth") {
		return new RegExp(
			`(^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedTerm)}($|[^\\p{L}\\p{N}_])`,
			"u",
		).test(normalizedText);
	}
	return normalizedText.includes(normalizedTerm);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function legacyRiskHint(
	riskHints: HumanIntentRiskHint[],
	concepts: HumanIntentConcept[],
	intent: HumanIntent,
): IntentRiskHint {
	if (riskHints.some((risk) => HIGH_RISK_HINTS.has(risk))) return "high";
	if (
		concepts.some((concept) =>
			["urgent", "recurring_failure", "deployment", "performance"].includes(
				concept,
			),
		) ||
		intent === "change_request"
	)
		return "medium";
	return "low";
}

function maxLegacyRisk(
	left: IntentRiskHint,
	right: IntentRiskHint,
): IntentRiskHint {
	const order: IntentRiskHint[] = ["low", "medium", "high", "blocker"];
	return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function ambiguityFor(
	intent: HumanIntent,
	concepts: HumanIntentConcept[],
	evidence: string[],
	normalizedText: string,
): string[] {
	const ambiguity: string[] = [];
	if (intent === "unknown" && normalizedText) ambiguity.push("intent_unknown");
	if (concepts.includes("unknown") && evidence.length === 0)
		ambiguity.push("concept_unknown");
	return ambiguity;
}

function confidenceFor(
	signalConfidence: UserSignalConfidence,
	evidenceCount: number,
	ambiguityCount: number,
): UserSignalConfidence {
	if (ambiguityCount > 0 || evidenceCount === 0) return "low";
	if (evidenceCount >= 2 || signalConfidence === "high") return "high";
	return "medium";
}

function handlingFor(
	intent: HumanIntent,
	shouldAskClarification: boolean,
	shouldBlockIfIduActive: boolean,
): HumanIntentRecommendedHandling {
	if (shouldBlockIfIduActive) return "needs_confirmation";
	if (shouldAskClarification) return "ask_clarification";
	if (
		[
			"bug_report",
			"feature_request",
			"change_request",
			"documentation_task",
			"review_request",
		].includes(intent)
	)
		return "preflight";
	if (intent === "question" || intent === "status_check")
		return "safe_to_execute";
	return "record_only";
}

function legacyKindFor(
	intent: HumanIntent,
	hasApproval: boolean,
	hasRejection: boolean,
	hasStatus: boolean,
	riskHint: IntentRiskHint,
): IntentKind {
	if (hasApproval) return "approval";
	if (hasRejection) return "rejection";
	if (hasStatus) return "status";
	if (riskHint === "blocker") return "task";
	return intent;
}

function actionFor(
	handling: HumanIntentRecommendedHandling,
	intent: HumanIntent,
	hasApproval = false,
	hasRejection = false,
): IntentAction {
	if (hasApproval) return "approve";
	if (hasRejection) return "reject";
	if (handling === "needs_confirmation") return "require_confirmation";
	if (handling === "ask_clarification") return "answer";
	if (intent === "question") return "answer";
	if (intent === "status_check") return "inspect_status";
	if (intent === "review_request") return "review";
	if (intent === "command") return "none";
	return "enqueue";
}

function languageHint(
	originalText: string,
	normalizedText: string,
): HumanIntentLanguageHint {
	if (!normalizedText) return "unknown";
	const spanish =
		/\b(el|la|las|los|que|no puedo|sesion|base de datos|fallas?|arreglar|usuario|clave|contraseña|revisa|documenta)\b/u.test(
			normalizedText,
		);
	const english =
		/\b(the|user|cannot|sign in|login|database|broken|review|document|password|access|again)\b/u.test(
			originalText.toLocaleLowerCase("en"),
		);
	if (spanish && english) return "mixed";
	if (spanish) return "spanish";
	if (english) return "english";
	return "unknown";
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values.filter(Boolean))];
}
