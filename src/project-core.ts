import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectCoreComplexityLevel =
	| "simple"
	| "medium"
	| "scalable"
	| "enterprise";
export type ProjectCoreDeploymentTarget =
	| "local"
	| "server"
	| "cloud"
	| "hybrid"
	| "unknown";
export type ProjectCoreSecurityLevel = "low" | "medium" | "high" | "critical";
export type ProjectCoreDataSensitivity =
	| "none"
	| "low"
	| "medium"
	| "high"
	| "critical";
export type ProjectCoreStatus = "draft" | "proposed" | "confirmed" | "stale";
export type ProjectCoreHumanDecision =
	| string
	| {
			decision: string;
			confirmedAt?: string;
			rejectedAt?: string;
			source?: string;
			reason?: string;
			researchDraftPath?: string;
	  };

export type ProjectCore = {
	version: string;
	projectName: string;
	projectGoal: string;
	problemStatement: string;
	targetUsers: string[];
	projectType: string;
	complexityLevel: ProjectCoreComplexityLevel;
	deploymentTarget: ProjectCoreDeploymentTarget;
	securityLevel: ProjectCoreSecurityLevel;
	dataSensitivity: ProjectCoreDataSensitivity;
	preferredStack: string[];
	rejectedStack: string[];
	architectureStyle: string;
	includedScope: string[];
	excludedScope: string[];
	initialModules: string[];
	criticalFlows: string[];
	successCriteria: string[];
	validationCommands: string[];
	humanDecisions: ProjectCoreHumanDecision[];
	assumptions: string[];
	openQuestions: string[];
	status: ProjectCoreStatus;
	createdAt: string;
	updatedAt: string;
};

export type ProjectCoreValidationResult =
	| { ok: true; core: ProjectCore; errors: [] }
	| { ok: false; errors: string[] };

const REQUIRED_STRING_FIELDS = [
	"version",
	"projectName",
	"projectGoal",
	"problemStatement",
	"projectType",
	"architectureStyle",
	"createdAt",
	"updatedAt",
] as const;

const REQUIRED_STRING_ARRAY_FIELDS = [
	"targetUsers",
	"preferredStack",
	"rejectedStack",
	"includedScope",
	"excludedScope",
	"initialModules",
	"criticalFlows",
	"successCriteria",
	"validationCommands",
	"assumptions",
	"openQuestions",
] as const;

const COMPLEXITY_LEVELS = [
	"simple",
	"medium",
	"scalable",
	"enterprise",
] as const;
const DEPLOYMENT_TARGETS = [
	"local",
	"server",
	"cloud",
	"hybrid",
	"unknown",
] as const;
const SECURITY_LEVELS = ["low", "medium", "high", "critical"] as const;
const DATA_SENSITIVITY_LEVELS = [
	"none",
	"low",
	"medium",
	"high",
	"critical",
] as const;
const STATUSES = ["draft", "proposed", "confirmed", "stale"] as const;

export function loadProjectCore(projectPath: string): ProjectCore {
	const projectCorePath = join(projectPath, "config", "project-core.json");
	const corePath = existsSync(projectCorePath)
		? projectCorePath
		: defaultCorePath();
	const raw = readFileSync(corePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid project core JSON at ${corePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const result = validateProjectCore(parsed);
	if (!result.ok) {
		throw new Error(
			`Invalid project core at ${corePath}: ${result.errors.join("; ")}`,
		);
	}
	return result.core;
}

export function validateProjectCore(
	value: unknown,
): ProjectCoreValidationResult {
	const errors: string[] = [];
	const record = asRecord(value);
	if (!record) return { ok: false, errors: ["project core must be an object"] };

	const strings = Object.fromEntries(
		REQUIRED_STRING_FIELDS.map((field) => [
			field,
			readRequiredString(record, field, errors),
		]),
	) as Partial<Record<(typeof REQUIRED_STRING_FIELDS)[number], string>>;
	const arrays = Object.fromEntries(
		REQUIRED_STRING_ARRAY_FIELDS.map((field) => [
			field,
			readRequiredStringArray(record, field, errors),
		]),
	) as Partial<Record<(typeof REQUIRED_STRING_ARRAY_FIELDS)[number], string[]>>;
	const humanDecisions = readHumanDecisions(record, errors);

	const complexityLevel = readEnum(
		record,
		"complexityLevel",
		COMPLEXITY_LEVELS,
		errors,
	);
	const deploymentTarget = readEnum(
		record,
		"deploymentTarget",
		DEPLOYMENT_TARGETS,
		errors,
	);
	const securityLevel = readEnum(
		record,
		"securityLevel",
		SECURITY_LEVELS,
		errors,
	);
	const dataSensitivity = readEnum(
		record,
		"dataSensitivity",
		DATA_SENSITIVITY_LEVELS,
		errors,
	);
	const status = readEnum(record, "status", STATUSES, errors);

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		core: {
			version: strings.version!,
			projectName: strings.projectName!,
			projectGoal: strings.projectGoal!,
			problemStatement: strings.problemStatement!,
			targetUsers: arrays.targetUsers!,
			projectType: strings.projectType!,
			complexityLevel: complexityLevel!,
			deploymentTarget: deploymentTarget!,
			securityLevel: securityLevel!,
			dataSensitivity: dataSensitivity!,
			preferredStack: arrays.preferredStack!,
			rejectedStack: arrays.rejectedStack!,
			architectureStyle: strings.architectureStyle!,
			includedScope: arrays.includedScope!,
			excludedScope: arrays.excludedScope!,
			initialModules: arrays.initialModules!,
			criticalFlows: arrays.criticalFlows!,
			successCriteria: arrays.successCriteria!,
			validationCommands: arrays.validationCommands!,
			humanDecisions: humanDecisions!,
			assumptions: arrays.assumptions!,
			openQuestions: arrays.openQuestions!,
			status: status!,
			createdAt: strings.createdAt!,
			updatedAt: strings.updatedAt!,
		},
	};
}

export function createDefaultProjectCore(projectName: string): ProjectCore {
	const now = new Date().toISOString();
	return {
		version: "1.0.0",
		projectName: projectName.trim() || "Proyecto sin definir",
		projectGoal: "Definir objetivo antes de construir",
		problemStatement:
			"Plantilla inicial: definir el problema real antes de construir.",
		targetUsers: ["Usuarios por definir"],
		projectType: "unknown",
		complexityLevel: "simple",
		deploymentTarget: "unknown",
		securityLevel: "medium",
		dataSensitivity: "none",
		preferredStack: [],
		rejectedStack: [],
		architectureStyle: "Por definir",
		includedScope: ["Definir alcance incluido antes de construir"],
		excludedScope: ["Definir qué queda fuera del alcance"],
		initialModules: [],
		criticalFlows: [],
		successCriteria: ["Project Core confirmado por un humano"],
		validationCommands: [],
		humanDecisions: [
			"Confirmar objetivo, alcance, seguridad y datos antes de construir",
		],
		assumptions: [
			"Esta es una plantilla inicial genérica, no una especificación confirmada",
		],
		openQuestions: defaultOpenQuestions(),
		status: "draft",
		createdAt: now,
		updatedAt: now,
	};
}

export function summarizeProjectCore(core: ProjectCore): string {
	return [
		`Proyecto: ${core.projectName}`,
		`Estado: ${core.status}`,
		`Objetivo: ${core.projectGoal}`,
		`Problema: ${core.problemStatement}`,
		`Tipo: ${core.projectType}`,
		`Complejidad: ${core.complexityLevel}`,
		`Despliegue: ${core.deploymentTarget}`,
		`Seguridad: ${core.securityLevel}`,
		`Sensibilidad de datos: ${core.dataSensitivity}`,
		`Alcance incluido: ${formatList(core.includedScope)}`,
		`Alcance excluido: ${formatList(core.excludedScope)}`,
	].join("\n");
}

export function formatProjectCoreForPrompt(core: ProjectCore): string {
	return [
		"Project Core",
		`Proyecto: ${core.projectName}`,
		`Estado: ${core.status}`,
		`Objetivo: ${core.projectGoal}`,
		`Problema: ${core.problemStatement}`,
		`Usuarios: ${formatList(core.targetUsers)}`,
		`Tipo/complejidad: ${core.projectType} / ${core.complexityLevel}`,
		`Despliegue: ${core.deploymentTarget}`,
		`Seguridad/datos: ${core.securityLevel} / ${core.dataSensitivity}`,
		`Arquitectura: ${core.architectureStyle}`,
		`Alcance: ${formatList(core.includedScope)}`,
		`Fuera de alcance: ${formatList(core.excludedScope)}`,
		`Módulos iniciales: ${formatList(core.initialModules)}`,
		`Flujos críticos: ${formatList(core.criticalFlows)}`,
		`Criterios de éxito: ${formatList(core.successCriteria)}`,
		`Decisiones humanas: ${formatList(core.humanDecisions)}`,
		`Preguntas abiertas: ${formatList(core.openQuestions)}`,
	].join("\n");
}

function readRequiredString(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string | undefined {
	const value = record[field];
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${field} must be a non-empty string`);
	return undefined;
}

function readRequiredStringArray(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string[] | undefined {
	const value = record[field];
	if (!Array.isArray(value)) {
		errors.push(`${field} must be an array of strings`);
		return undefined;
	}
	const strings = value.map((item) =>
		typeof item === "string" ? item.trim() : undefined,
	);
	if (strings.some((item) => item === undefined)) {
		errors.push(`${field} must contain only strings`);
		return undefined;
	}
	const nonEmpty = strings.filter((item): item is string => Boolean(item));
	if (nonEmpty.length !== strings.length) {
		errors.push(`${field} must not contain empty strings`);
		return undefined;
	}
	return nonEmpty;
}

function readHumanDecisions(
	record: Record<string, unknown>,
	errors: string[],
): ProjectCoreHumanDecision[] | undefined {
	const value = record.humanDecisions;
	if (!Array.isArray(value)) {
		errors.push("humanDecisions must be an array");
		return undefined;
	}
	const decisions: ProjectCoreHumanDecision[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			if (!item.trim()) {
				errors.push("humanDecisions must not contain empty strings");
				return undefined;
			}
			decisions.push(item.trim());
			continue;
		}
		const decision = asRecord(item);
		if (
			!decision ||
			typeof decision.decision !== "string" ||
			!decision.decision.trim()
		) {
			errors.push("humanDecisions objects must include a non-empty decision");
			return undefined;
		}
		decisions.push({
			decision: decision.decision.trim(),
			...(typeof decision.confirmedAt === "string" &&
			decision.confirmedAt.trim()
				? { confirmedAt: decision.confirmedAt.trim() }
				: {}),
			...(typeof decision.rejectedAt === "string" && decision.rejectedAt.trim()
				? { rejectedAt: decision.rejectedAt.trim() }
				: {}),
			...(typeof decision.source === "string" && decision.source.trim()
				? { source: decision.source.trim() }
				: {}),
			...(typeof decision.reason === "string" && decision.reason.trim()
				? { reason: decision.reason.trim() }
				: {}),
			...(typeof decision.researchDraftPath === "string" &&
			decision.researchDraftPath.trim()
				? { researchDraftPath: decision.researchDraftPath.trim() }
				: {}),
		});
	}
	return decisions;
}

function readEnum<T extends readonly string[]>(
	record: Record<string, unknown>,
	field: string,
	allowed: T,
	errors: string[],
): T[number] | undefined {
	const value = record[field];
	if (typeof value === "string" && allowed.includes(value)) return value;
	errors.push(`${field} must be one of: ${allowed.join(", ")}`);
	return undefined;
}

function formatList(items: readonly unknown[]): string {
	return items.length
		? items
				.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
				.join(" | ")
		: "—";
}

function defaultOpenQuestions(): string[] {
	return [
		"¿Qué problema resuelve?",
		"¿Quiénes son los usuarios?",
		"¿Será local, servidor o cloud?",
		"¿Qué nivel de seguridad requiere?",
		"¿Qué datos sensibles manejará?",
		"¿Qué queda fuera del alcance?",
	];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function defaultCorePath(): string {
	return join(process.cwd(), "config", "default-core.json");
}
