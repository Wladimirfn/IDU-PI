import {
	analyzeUserSignal,
	type UserEmotion,
	type UserSignalConfidence,
} from "./user-signal.js";

export type IntentConcept =
	| "auth"
	| "database"
	| "schema"
	| "ui"
	| "docs"
	| "tests"
	| "queue"
	| "semantic-audit"
	| "project-core"
	| "configuration"
	| "deployment"
	| "security"
	| "task"
	| "review"
	| "unknown";

export type IntentRiskHint = "low" | "medium" | "high" | "blocker";

export type IntentKind =
	| "task"
	| "bug_report"
	| "question"
	| "status"
	| "approval"
	| "rejection"
	| "cancel"
	| "configuration"
	| "review"
	| "unknown";

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

export interface IntentClassification {
	kind: IntentKind;
	action: IntentAction;
	concepts: IntentConcept[];
	riskHint: IntentRiskHint;
	confidence: UserSignalConfidence;
	requiresHumanConfirmation: boolean;
	emotion: UserEmotion;
	urgency: number;
	evidence: string[];
	normalizedText: string;
}

export interface IntentClassificationContext {
	taskCategory?: string;
	projectRisk?: IntentRiskHint;
}

type IntentRule = {
	concept: IntentConcept;
	riskHint: IntentRiskHint;
	terms: string[];
};

const RISK_ORDER: IntentRiskHint[] = ["low", "medium", "high", "blocker"];

const CONCEPT_RULES: IntentRule[] = [
	{
		concept: "auth",
		riskHint: "high",
		terms: ["login", "auth", "autentic", "sesion", "session", "jwt"],
	},
	{
		concept: "security",
		riskHint: "high",
		terms: [
			"seguridad",
			"security",
			"permiso",
			"permission",
			"token",
			"secret",
		],
	},
	{
		concept: "database",
		riskHint: "high",
		terms: [
			"base de datos",
			"bases de datos",
			"database",
			"db",
			"sqlite",
			"tabla",
			"tablas",
		],
	},
	{
		concept: "schema",
		riskHint: "high",
		terms: ["schema", "esquema", "migration", "migracion"],
	},
	{
		concept: "deployment",
		riskHint: "medium",
		terms: ["deploy", "produccion", "production", "release", "push"],
	},
	{
		concept: "queue",
		riskHint: "medium",
		terms: ["cola", "queue", "tarea", "task"],
	},
	{
		concept: "semantic-audit",
		riskHint: "medium",
		terms: ["semantic audit", "auditoria semantica", "semantic-audit"],
	},
	{
		concept: "project-core",
		riskHint: "high",
		terms: [
			"project core",
			"nucleo del proyecto",
			"constitucion",
			"constitution",
		],
	},
	{
		concept: "configuration",
		riskHint: "medium",
		terms: ["config", "configuracion", "env", "settings"],
	},
	{
		concept: "ui",
		riskHint: "medium",
		terms: ["ui", "interfaz", "pantalla", "boton", "formulario", "dashboard"],
	},
	{
		concept: "docs",
		riskHint: "low",
		terms: ["readme", "docs", "documentacion", "guia"],
	},
	{
		concept: "tests",
		riskHint: "low",
		terms: ["test", "tests", "prueba", "pruebas", "build"],
	},
	{
		concept: "review",
		riskHint: "medium",
		terms: ["review", "revisar", "auditar", "chequear"],
	},
];

const BUG_TERMS = [
	"falla",
	"fallas",
	"fallo",
	"no funciona",
	"error",
	"rompe",
	"rompio",
	"roto",
	"arreglar",
	"arregla",
	"resolver",
	"problema",
];

const DESTRUCTIVE_TERMS = [
	"borrar",
	"borra",
	"delete",
	"drop",
	"eliminar",
	"wipe",
	"reset",
	"truncate",
];
const TASK_TERMS = [
	"arregla",
	"arreglar",
	"implementa",
	"implementar",
	"agrega",
	"agregar",
	"crea",
	"crear",
	"actualiza",
	"actualizar",
	"fix",
	"build",
	"hacer",
	"terminado",
];
const APPROVAL_TERMS = [
	"aproba",
	"aprobar",
	"approve",
	"ok",
	"dale",
	"confirmo",
];
const REJECTION_TERMS = [
	"rechaza",
	"rechazar",
	"reject",
	"no aprobar",
	"descarta",
];
const CANCEL_TERMS = [
	"cancela",
	"cancelar",
	"cancel",
	"detene",
	"detener",
	"stop",
];
const STATUS_TERMS = [
	"estado",
	"status",
	"mostrame",
	"mostrar",
	"queue-detail",
	"cola",
];
const QUESTION_TERMS = ["?", "que ", "como ", "por que", "cual ", "cuando "];

export function normalizeHumanText(text: string): string {
	return text
		.toLocaleLowerCase("es")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^\p{L}\p{N}_? -]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

export function classifyIntentDeterministic(
	text: string,
): IntentClassification {
	const normalizedText = normalizeHumanText(text);
	const signal = analyzeUserSignal(text);
	const concepts: IntentConcept[] = [];
	const evidence: string[] = [];
	let riskHint: IntentRiskHint = signal.urgency >= 4 ? "medium" : "low";

	for (const rule of CONCEPT_RULES) {
		const matched = rule.terms.filter((term) =>
			includesTerm(normalizedText, term),
		);
		if (!matched.length) continue;
		concepts.push(rule.concept);
		evidence.push(...matched);
		riskHint = maxRisk(riskHint, rule.riskHint);
	}

	const bugMatches = BUG_TERMS.filter((term) =>
		includesTerm(normalizedText, term),
	);
	if (bugMatches.length > 0) evidence.push(...bugMatches);
	const databaseBug =
		bugMatches.length > 0 &&
		concepts.some((concept) => concept === "database" || concept === "schema");
	if (databaseBug) riskHint = maxRisk(riskHint, "high");

	const destructiveMatches = DESTRUCTIVE_TERMS.filter((term) =>
		includesTerm(normalizedText, term),
	);
	if (destructiveMatches.length > 0) {
		evidence.push(...destructiveMatches);
		if (
			concepts.some((concept) =>
				["database", "deployment", "security", "auth"].includes(concept),
			)
		) {
			riskHint = "blocker";
		} else {
			riskHint = maxRisk(riskHint, "high");
		}
	}

	const kind = databaseBug
		? "bug_report"
		: detectKind(normalizedText, concepts);
	const requiresHumanConfirmation =
		riskHint === "high" || riskHint === "blocker";
	return {
		kind,
		action: actionFor(kind, requiresHumanConfirmation),
		concepts: concepts.length ? unique(concepts) : ["unknown"],
		riskHint,
		confidence: confidenceFor(
			signal.confidence,
			evidence.length,
			normalizedText,
		),
		requiresHumanConfirmation,
		emotion: signal.emotion,
		urgency: signal.urgency,
		evidence: unique([...evidence, ...signal.matchedKeywords]),
		normalizedText,
	};
}

export function classifyIntentWithContext(
	text: string,
	context: IntentClassificationContext = {},
): IntentClassification {
	const classification = classifyIntentDeterministic(text);
	const concepts = [...classification.concepts];
	const contextualConcept = conceptForTaskCategory(context.taskCategory);
	if (contextualConcept && !concepts.includes(contextualConcept)) {
		concepts.push(contextualConcept);
	}
	const riskHint = context.projectRisk
		? maxRisk(classification.riskHint, context.projectRisk)
		: classification.riskHint;
	return {
		...classification,
		kind:
			classification.kind === "unknown" && context.taskCategory
				? "task"
				: classification.kind,
		action: actionFor(
			classification.kind === "unknown" && context.taskCategory
				? "task"
				: classification.kind,
			riskHint === "high" || riskHint === "blocker",
		),
		concepts: concepts.filter((concept) => concept !== "unknown"),
		riskHint,
		requiresHumanConfirmation: riskHint === "high" || riskHint === "blocker",
	};
}

export function formatIntentClassification(
	classification: IntentClassification,
): string {
	return [
		`kind: ${classification.kind}`,
		`action: ${classification.action}`,
		`concepts: ${classification.concepts.join(", ")}`,
		`risk: ${classification.riskHint}`,
		`confidence: ${classification.confidence}`,
		`evidence: ${classification.evidence.length ? classification.evidence.join(", ") : "none"}`,
	].join("\n");
}

function detectKind(
	normalizedText: string,
	concepts: IntentConcept[],
): IntentKind {
	if (!normalizedText) return "unknown";
	if (hasAny(normalizedText, APPROVAL_TERMS)) return "approval";
	if (hasAny(normalizedText, REJECTION_TERMS)) return "rejection";
	if (hasAny(normalizedText, CANCEL_TERMS)) return "cancel";
	if (hasAny(normalizedText, ["config", "configuracion", "settings"]))
		return "configuration";
	if (hasAny(normalizedText, ["review", "auditar"])) return "review";
	if (
		hasAny(normalizedText, STATUS_TERMS) &&
		!hasAny(normalizedText, TASK_TERMS)
	)
		return "status";
	if (
		hasAny(normalizedText, QUESTION_TERMS) &&
		!hasAny(normalizedText, TASK_TERMS)
	)
		return "question";
	if (
		hasAny(normalizedText, TASK_TERMS) ||
		concepts.some((concept) => concept !== "unknown")
	)
		return "task";
	return "unknown";
}

function actionFor(
	kind: IntentKind,
	requiresHumanConfirmation: boolean,
): IntentAction {
	if (requiresHumanConfirmation && (kind === "task" || kind === "bug_report"))
		return "require_confirmation";
	switch (kind) {
		case "approval":
			return "approve";
		case "rejection":
			return "reject";
		case "cancel":
			return "cancel";
		case "configuration":
			return "configure";
		case "question":
			return "answer";
		case "review":
			return "review";
		case "status":
			return "inspect_status";
		case "task":
		case "bug_report":
			return "enqueue";
		case "unknown":
			return "none";
	}
}

function conceptForTaskCategory(
	category: string | undefined,
): IntentConcept | undefined {
	switch (category?.trim().toLowerCase()) {
		case "bug":
		case "feature":
		case "refactor":
			return "task";
		case "docs":
			return "docs";
		case "review":
			return "review";
		default:
			return undefined;
	}
}

function confidenceFor(
	signalConfidence: UserSignalConfidence,
	evidenceCount: number,
	normalizedText: string,
): UserSignalConfidence {
	if (evidenceCount >= 2 || signalConfidence === "high") return "high";
	if (evidenceCount === 1 || normalizedText.length > 0) return "medium";
	return "low";
}

function hasAny(normalizedText: string, terms: string[]): boolean {
	return terms.some((term) => includesTerm(normalizedText, term));
}

function includesTerm(normalizedText: string, term: string): boolean {
	const normalizedTerm = normalizeHumanText(term);
	return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
}

function maxRisk(left: IntentRiskHint, right: IntentRiskHint): IntentRiskHint {
	return RISK_ORDER.indexOf(right) > RISK_ORDER.indexOf(left) ? right : left;
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}
