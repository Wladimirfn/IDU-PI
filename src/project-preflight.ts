import type { ProjectBlueprint } from "./project-blueprint.js";
import type { ProjectConnectionReport } from "./project-connection.js";
import type { ProjectFlows } from "./project-flows.js";

export type ProjectPreflightRisk = "low" | "medium" | "high" | "blocker";

export type ProjectPreflightContext = {
	connection: ProjectConnectionReport;
	blueprint?: ProjectBlueprint;
	flows?: ProjectFlows;
	projectId?: string;
	projectPath?: string;
};

export type ProjectPreflightReport = {
	risk: ProjectPreflightRisk;
	okToProceed: boolean;
	request: string;
	projectId?: string;
	projectPath?: string;
	connectionStatus: ProjectConnectionReport["status"];
	affectedAreas: string[];
	missingContext: string[];
	warnings: string[];
	recommendedNext: string;
	requiresHumanConfirmation: boolean;
	shouldRunAgentLab: boolean;
};

type IntentFlags = {
	architecture: boolean;
	data: boolean;
	critical: boolean;
	functional: boolean;
	flow: boolean;
	simple: boolean;
	newModule: boolean;
	moduleConnection: boolean;
	requestedModules: string[];
};

const ARCHITECTURE_TERMS = [
	"crear modulo",
	"crear módulo",
	"nuevo modulo",
	"nuevo módulo",
	"conectar modulos",
	"conectar módulos",
	"conectalo",
	"conéctalo",
	"reorganizar carpetas",
	"cambiar estructura",
	"arquitectura",
];
const DATA_TERMS = [
	"db",
	"database",
	"base de datos",
	"tabla",
	"table",
	"schema",
	"migracion",
	"migración",
	"migration",
	"supabase",
	"sqlite",
];
const CRITICAL_TERMS = [
	"login",
	"auth",
	"permission",
	"permissions",
	"permiso",
	"permisos",
	"security",
	"seguridad",
	"token",
	"tokens",
	"secret",
	"secrets",
	"secreto",
	"secretos",
];
const FUNCTIONAL_TERMS = [
	"dashboard",
	"view",
	"vista",
	"screen",
	"pantalla",
	"button",
	"boton",
	"botón",
	"form",
	"formulario",
	"api",
];
const FLOW_TERMS = [
	"compras",
	"inventario",
	"bodega",
	"ot",
	"bitacora",
	"bitácora",
	"rcm",
	"sgc",
];
const SIMPLE_TERMS = [
	"explain",
	"explicar",
	"explicame",
	"summary",
	"summarize",
	"resumir",
	"review",
	"revisar",
	"run tests",
	"tests",
	"correr tests",
];

export function analyzeProjectPreflight(
	request: string,
	context: ProjectPreflightContext,
): ProjectPreflightReport {
	const normalizedRequest = request.trim();
	const normalized = normalize(normalizedRequest);
	const connection = context.connection;
	const affectedAreas: string[] = [];
	const missingContext: string[] = [];
	const warnings: string[] = [...connection.warnings];
	const intents = detectIntent(normalized);

	if (!normalizedRequest) {
		return buildReport({
			request: normalizedRequest,
			context,
			risk: "blocker",
			affectedAreas: ["solicitud vacía"],
			missingContext: ["Falta solicitud para analizar."],
			warnings,
			recommendedNext: "/preflight <solicitud>",
			requiresHumanConfirmation: true,
			shouldRunAgentLab: false,
		});
	}

	if (
		connection.status === "broken_connection" ||
		connection.status === "not_connected" ||
		connection.status === "unknown_project"
	) {
		return buildReport({
			request: normalizedRequest,
			context,
			risk: "blocker",
			affectedAreas: ["conexión de proyecto"],
			missingContext: connection.problems,
			warnings,
			recommendedNext: connection.recommendedNext,
			requiresHumanConfirmation: true,
			shouldRunAgentLab: false,
		});
	}

	pushIf(affectedAreas, intents.architecture, "arquitectura");
	pushIf(affectedAreas, intents.data, "datos");
	pushIf(affectedAreas, intents.critical, "auth/seguridad");
	pushIf(affectedAreas, intents.functional, "interfaz/API");
	pushIf(affectedAreas, intents.flow, "flujo funcional");
	pushIf(affectedAreas, intents.simple, "tarea simple");
	pushIf(affectedAreas, intents.newModule, "módulo nuevo");
	pushIf(affectedAreas, intents.moduleConnection, "conexión entre módulos");

	if (!hasLocalValidBlueprint(connection, context)) {
		missingContext.push("project-blueprint project-local válido");
	}
	if (!hasLocalValidFlows(connection, context)) {
		missingContext.push("project-flows project-local válido");
	}

	for (const moduleName of missingRequestedModules(
		intents.requestedModules,
		context.flows,
	)) {
		warnings.push(`${moduleName} no está confirmado en project-flows.`);
	}

	const largeChange =
		intents.architecture ||
		intents.data ||
		intents.critical ||
		intents.newModule ||
		intents.moduleConnection ||
		intents.functional ||
		intents.flow;
	let risk: ProjectPreflightRisk = "low";
	if (
		intents.data ||
		intents.critical ||
		intents.newModule ||
		intents.moduleConnection
	) {
		risk = "high";
	} else if (connection.status === "needs_understanding" && largeChange) {
		risk = "high";
	} else if (intents.functional && !hasLocalValidFlows(connection, context)) {
		risk = "high";
	} else if (intents.functional || intents.flow || intents.architecture) {
		risk = "medium";
	}
	if (
		warnings.some((warning) => /no está confirmado/u.test(warning)) &&
		largeChange
	) {
		risk = maxRisk(risk, "high");
	}
	if (connection.status === "connected" && largeChange) {
		risk = maxRisk(risk, "high");
	}

	const requiresHumanConfirmation = risk === "high" || risk === "blocker";
	const shouldRunAgentLab =
		risk === "high" &&
		(intents.architecture || intents.newModule || intents.moduleConnection);
	return buildReport({
		request: normalizedRequest,
		context,
		risk,
		affectedAreas: affectedAreas.length
			? affectedAreas
			: ["sin impacto estructural detectado"],
		missingContext,
		warnings,
		recommendedNext: recommendedNext(
			risk,
			connection,
			missingContext,
			warnings,
		),
		requiresHumanConfirmation,
		shouldRunAgentLab,
	});
}

export function formatProjectPreflightReport(
	report: ProjectPreflightReport,
): string {
	return [
		"Preflight Idu-pi",
		"",
		"Riesgo:",
		report.risk,
		"",
		"Solicitud:",
		report.request || "—",
		"",
		"Proyecto:",
		report.projectId ?? "—",
		"",
		"Ruta:",
		report.projectPath ?? "—",
		"",
		"Impacto detectado:",
		formatList(report.affectedAreas),
		"",
		"Contexto faltante:",
		formatList(report.missingContext),
		"",
		"Problemas:",
		formatList(report.warnings),
		"",
		"Recomendación:",
		report.recommendedNext,
		"",
		"Acciones:",
		formatList(actions(report)),
		"",
		"okToProceed:",
		String(report.okToProceed),
		"",
		"requiresHumanConfirmation:",
		String(report.requiresHumanConfirmation),
		"",
		"shouldRunAgentLab:",
		String(report.shouldRunAgentLab),
	].join("\n");
}

function detectIntent(normalized: string): IntentFlags {
	const requestedModules = FLOW_TERMS.filter((term) =>
		includesTerm(normalized, term),
	);
	return {
		architecture: hasAny(normalized, ARCHITECTURE_TERMS),
		data: hasAny(normalized, DATA_TERMS),
		critical: hasAny(normalized, CRITICAL_TERMS),
		functional: hasAny(normalized, FUNCTIONAL_TERMS),
		flow: requestedModules.length > 0,
		simple: hasAny(normalized, SIMPLE_TERMS),
		newModule:
			/(?:crear|crea|agrega|agregar|nuevo|nueva)\s+(?:un\s+|una\s+)?m[oó]dulo/u.test(
				normalized,
			),
		moduleConnection: /con(?:ectar|ecta|ectalo|éctalo|exion|exión)/u.test(
			normalized,
		),
		requestedModules,
	};
}

function missingRequestedModules(
	requestedModules: string[],
	flows: ProjectFlows | undefined,
): string[] {
	if (!flows) return requestedModules;
	const confirmed = new Set(
		flows.modules.flatMap((module) => [
			normalize(module.id),
			normalize(module.name),
		]),
	);
	return requestedModules.filter(
		(moduleName) => !confirmed.has(normalize(moduleName)),
	);
}

function hasLocalValidBlueprint(
	connection: ProjectConnectionReport,
	context: ProjectPreflightContext,
): boolean {
	return Boolean(
		context.blueprint &&
			connection.blueprint?.source === "project-local" &&
			connection.blueprint.valid,
	);
}

function hasLocalValidFlows(
	connection: ProjectConnectionReport,
	context: ProjectPreflightContext,
): boolean {
	return Boolean(
		context.flows &&
			connection.flows?.source === "project-local" &&
			connection.flows.valid,
	);
}

function buildReport(options: {
	request: string;
	context: ProjectPreflightContext;
	risk: ProjectPreflightRisk;
	affectedAreas: string[];
	missingContext: string[];
	warnings: string[];
	recommendedNext: string;
	requiresHumanConfirmation: boolean;
	shouldRunAgentLab: boolean;
}): ProjectPreflightReport {
	return {
		risk: options.risk,
		okToProceed: options.risk === "low",
		request: options.request,
		projectId:
			options.context.projectId ?? options.context.connection.projectId,
		projectPath:
			options.context.projectPath ?? options.context.connection.projectPath,
		connectionStatus: options.context.connection.status,
		affectedAreas: dedupe(options.affectedAreas),
		missingContext: dedupe(options.missingContext),
		warnings: dedupe(options.warnings),
		recommendedNext: options.recommendedNext,
		requiresHumanConfirmation: options.requiresHumanConfirmation,
		shouldRunAgentLab: options.shouldRunAgentLab,
	};
}

function recommendedNext(
	risk: ProjectPreflightRisk,
	connection: ProjectConnectionReport,
	missingContext: string[],
	warnings: string[],
): string {
	if (risk === "blocker") return connection.recommendedNext;
	if (missingContext.length > 0) return "/config init_project_config o /idu";
	if (warnings.some((warning) => /no está confirmado/u.test(warning))) {
		return "Ejecutar /config inspect_project_map y confirmar flujo antes de implementar.";
	}
	if (risk === "high") {
		return "Pedir confirmación humana y revisar arquitectura antes de implementar.";
	}
	if (risk === "medium") {
		return "Revisar project-flows y confirmar alcance antes de implementar.";
	}
	return "Puede continuar sin preflight adicional.";
}

function actions(report: ProjectPreflightReport): string[] {
	const result: string[] = [];
	if (report.requiresHumanConfirmation)
		result.push("pedir confirmación humana");
	if (report.shouldRunAgentLab)
		result.push(
			"marcar para revisión arquitectónica futura; no lanzar AgentLab todavía",
		);
	if (!report.requiresHumanConfirmation && !report.shouldRunAgentLab) {
		result.push("continuar con tarea simple");
	}
	return result;
}

function normalize(value: string): string {
	return value.toLocaleLowerCase("es");
}

function hasAny(value: string, terms: string[]): boolean {
	return terms.some((term) => includesTerm(value, term));
}

function includesTerm(value: string, term: string): boolean {
	const normalizedTerm = normalize(term);
	const pattern = new RegExp(
		`(^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedTerm)}($|[^\\p{L}\\p{N}_])`,
		"u",
	);
	return pattern.test(value);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function pushIf(target: string[], condition: boolean, value: string): void {
	if (condition) target.push(value);
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function maxRisk(
	current: ProjectPreflightRisk,
	candidate: ProjectPreflightRisk,
): ProjectPreflightRisk {
	const order: ProjectPreflightRisk[] = ["low", "medium", "high", "blocker"];
	return order.indexOf(candidate) > order.indexOf(current)
		? candidate
		: current;
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}
