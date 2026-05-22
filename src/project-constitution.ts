import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectCore, ProjectCoreStatus } from "./project-core.js";
import type { ProjectPreflightRisk } from "./project-preflight.js";

export type ProjectConstitutionStatus = "draft" | "active" | "stale";
export type ConstitutionGateSeverity = "medium" | "high" | "blocker";

export type ConstitutionValidationGate = {
	id: string;
	severity: ConstitutionGateSeverity;
	description: string;
};

export type ProjectConstitution = {
	version: string;
	projectName: string;
	sourceCoreStatus: ProjectCoreStatus;
	principles: string[];
	forbiddenPractices: string[];
	requiredPractices: string[];
	technologyRules: {
		preferredStack: string[];
		rejectedStack: string[];
	};
	securityRules: string[];
	dataRules: string[];
	approvalRules: string[];
	validationGates: ConstitutionValidationGate[];
	specialistRoles: string[];
	createdAt: string;
	updatedAt: string;
	status: ProjectConstitutionStatus;
};

export type ConstitutionGateIssue = {
	gateId: string;
	severity: ConstitutionGateSeverity;
	message: string;
};

export type ConstitutionGateResult = {
	ok: boolean;
	risk: ProjectPreflightRisk;
	requiresHumanConfirmation: boolean;
	failures: ConstitutionGateIssue[];
	warnings: ConstitutionGateIssue[];
	affectedRules: string[];
};

export type ConstitutionGateInput = {
	request?: string;
	changedFiles?: string[];
	constitution: ProjectConstitution;
};

export type ProjectConstitutionValidationResult =
	| { ok: true; constitution: ProjectConstitution; errors: [] }
	| { ok: false; errors: string[] };

const STATUSES = ["draft", "active", "stale"] as const;
const CORE_STATUSES = ["draft", "proposed", "confirmed", "stale"] as const;
const GATE_SEVERITIES = ["medium", "high", "blocker"] as const;

export function validateProjectConstitution(
	value: unknown,
): ProjectConstitutionValidationResult {
	const errors: string[] = [];
	const record = asRecord(value);
	if (!record) return { ok: false, errors: ["constitution must be an object"] };
	const version = readString(record, "version", errors);
	const projectName = readString(record, "projectName", errors);
	const sourceCoreStatus = readEnum(
		record,
		"sourceCoreStatus",
		CORE_STATUSES,
		errors,
	);
	const principles = readStringArray(record, "principles", errors);
	const forbiddenPractices = readStringArray(
		record,
		"forbiddenPractices",
		errors,
	);
	const requiredPractices = readStringArray(
		record,
		"requiredPractices",
		errors,
	);
	const securityRules = readStringArray(record, "securityRules", errors);
	const dataRules = readStringArray(record, "dataRules", errors);
	const approvalRules = readStringArray(record, "approvalRules", errors);
	const specialistRoles = readStringArray(record, "specialistRoles", errors);
	const createdAt = readString(record, "createdAt", errors);
	const updatedAt = readString(record, "updatedAt", errors);
	const status = readEnum(record, "status", STATUSES, errors);
	const technologyRules = readTechnologyRules(record.technologyRules, errors);
	const validationGates = readValidationGates(record.validationGates, errors);
	if (errors.length) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		constitution: {
			version: version!,
			projectName: projectName!,
			sourceCoreStatus: sourceCoreStatus!,
			principles: principles!,
			forbiddenPractices: forbiddenPractices!,
			requiredPractices: requiredPractices!,
			technologyRules: technologyRules!,
			securityRules: securityRules!,
			dataRules: dataRules!,
			approvalRules: approvalRules!,
			validationGates: validationGates!,
			specialistRoles: specialistRoles!,
			createdAt: createdAt!,
			updatedAt: updatedAt!,
			status: status!,
		},
	};
}

export function loadProjectConstitution(
	projectPath: string,
): ProjectConstitution {
	const localPath = join(projectPath, "config", "project-constitution.json");
	const path = existsSync(localPath) ? localPath : defaultConstitutionPath();
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const result = validateProjectConstitution(parsed);
	if (!result.ok) {
		throw new Error(
			`Invalid project constitution at ${path}: ${result.errors.join("; ")}`,
		);
	}
	return result.constitution;
}

export function deriveConstitutionFromProjectCore(
	core: ProjectCore,
): ProjectConstitution {
	const now = core.updatedAt || new Date().toISOString();
	return {
		version: "1.0.0",
		projectName: core.projectName,
		sourceCoreStatus: core.status,
		principles: [
			"La IA puede proponer, pero el humano confirma.",
			"Solo el Project Core confirmado es fuente de verdad.",
			`Project Core confirmado requerido para ${core.projectName}.`,
		],
		forbiddenPractices: [
			"Saltar tests o build requeridos",
			"Usar tecnología rechazada por Project Core",
			"Implementar alcance explícitamente excluido",
		],
		requiredPractices: [
			"Pedir confirmación humana para cambios high/blocker",
			"Mantener cambios dentro de includedScope",
			`Alcance incluido: ${core.includedScope.join(" | ")}`,
			`Alcance excluido: ${core.excludedScope.join(" | ")}`,
			"Revisar seguridad para auth, secrets y datos sensibles",
		],
		technologyRules: {
			preferredStack: core.preferredStack,
			rejectedStack: core.rejectedStack,
		},
		securityRules: [
			`Nivel de seguridad confirmado: ${core.securityLevel}`,
			"Auth/login/security requiere confirmación humana.",
		],
		dataRules: [
			`Sensibilidad de datos confirmada: ${core.dataSensitivity}`,
			"Cambios de datos high/critical requieren revisión de seguridad.",
		],
		approvalRules: [
			"Project Core debe estar confirmed.",
			"Cambios fuera de preferredStack con arquitectura requieren confirmación humana.",
		],
		validationGates: defaultValidationGates(),
		specialistRoles: ["security", "database", "architecture"],
		createdAt: now,
		updatedAt: now,
		status: core.status === "confirmed" ? "active" : "draft",
	};
}

export function formatConstitutionForPrompt(
	constitution: ProjectConstitution,
): string {
	return [
		"Project Constitution",
		`Proyecto: ${constitution.projectName}`,
		`Estado: ${constitution.status}`,
		`Source Core: ${constitution.sourceCoreStatus}`,
		`Principios: ${formatInline(constitution.principles)}`,
		`Prácticas prohibidas: ${formatInline(constitution.forbiddenPractices)}`,
		`Prácticas requeridas: ${formatInline(constitution.requiredPractices)}`,
		`Preferred stack: ${formatInline(constitution.technologyRules.preferredStack)}`,
		`Rejected stack: ${formatInline(constitution.technologyRules.rejectedStack)}`,
		`Gates: ${formatInline(constitution.validationGates.map((gate) => gate.id))}`,
	].join("\n");
}

export function evaluateConstitutionGates(
	input: ConstitutionGateInput,
): ConstitutionGateResult {
	const text = normalize(
		`${input.request ?? ""} ${(input.changedFiles ?? []).join(" ")}`,
	);
	const failures: ConstitutionGateIssue[] = [];
	const warnings: ConstitutionGateIssue[] = [];
	if (input.constitution.sourceCoreStatus !== "confirmed") {
		failures.push(
			issue(
				"project_core_not_confirmed",
				"blocker",
				"Project Core no está confirmed.",
			),
		);
	}
	if (hasSkipValidation(text)) {
		failures.push(
			issue(
				"skip_tests_blocker",
				"blocker",
				"No se permite saltar tests/build.",
			),
		);
	}
	for (const rejected of input.constitution.technologyRules.rejectedStack) {
		if (includesTerm(text, rejected)) {
			failures.push(
				issue(
					"rejected_stack",
					"blocker",
					`Tecnología rechazada por Project Core: ${rejected}`,
				),
			);
		}
	}
	for (const forbidden of input.constitution.forbiddenPractices) {
		if (matchesForbiddenPractice(text, forbidden)) {
			failures.push(
				issue(
					"forbidden_practice",
					"blocker",
					`Práctica prohibida: ${forbidden}`,
				),
			);
		}
	}
	for (const excluded of input.constitution.approvalRules.length
		? extractScope(input.constitution, "excluded")
		: []) {
		if (includesTerm(text, excluded)) {
			failures.push(
				issue(
					"scope_excluded",
					"blocker",
					`Solicitud toca excludedScope: ${excluded}`,
				),
			);
		}
	}
	if (hasAuthSecurity(text)) {
		failures.push(
			issue(
				"auth_security_review",
				"high",
				"Auth/login/security requiere confirmación humana.",
			),
		);
	}
	if (hasDataChange(text)) {
		failures.push(
			issue(
				"db_schema_plan",
				"high",
				"DB/schema requiere regla, plan o migración explícita.",
			),
		);
		if (
			/high|critical/u.test(
				input.constitution.dataRules.join(" ").toLowerCase(),
			)
		) {
			failures.push(
				issue(
					"data_security_review",
					"high",
					"Datos high/critical requieren revisión de seguridad.",
				),
			);
		}
	}
	const included = extractScope(input.constitution, "included");
	if (
		hasNewModule(text) &&
		included.length > 0 &&
		!included.some((scope) => includesTerm(text, scope))
	) {
		warnings.push(
			issue(
				"scope_included",
				"medium",
				"Solicitud parece fuera de includedScope confirmado.",
			),
		);
	}
	if (hasArchitectureChange(text)) {
		const preferredHit = input.constitution.technologyRules.preferredStack.some(
			(tech) => includesTerm(text, tech),
		);
		const mentionsTech =
			/react|vue|svelte|firebase|supabase|postgres|mysql|mongodb|next|nestjs|express/u.test(
				text,
			);
		if (mentionsTech && !preferredHit) {
			warnings.push(
				issue(
					"non_preferred_stack",
					"high",
					"Tecnología fuera de preferredStack requiere confirmación humana.",
				),
			);
		}
	}
	const risk = [...failures, ...warnings].reduce<ProjectPreflightRisk>(
		(current, item) =>
			maxRisk(current, item.severity === "medium" ? "medium" : item.severity),
		"low",
	);
	return {
		ok: failures.length === 0,
		risk,
		requiresHumanConfirmation: risk === "high" || risk === "blocker",
		failures,
		warnings,
		affectedRules: dedupe(
			[...failures, ...warnings].map((item) => item.gateId),
		),
	};
}

function defaultValidationGates(): ConstitutionValidationGate[] {
	return [
		{
			id: "project_core_not_confirmed",
			severity: "blocker",
			description: "Project Core debe estar confirmed.",
		},
		{
			id: "db_schema_plan",
			severity: "high",
			description: "DB/schema requiere plan o migración.",
		},
		{
			id: "auth_security_review",
			severity: "high",
			description: "Auth/login/security requiere confirmación humana.",
		},
		{
			id: "scope_included",
			severity: "medium",
			description: "Cambios deben respetar includedScope.",
		},
		{
			id: "scope_excluded",
			severity: "blocker",
			description: "No tocar excludedScope.",
		},
		{
			id: "rejected_stack",
			severity: "blocker",
			description: "No usar rejectedStack.",
		},
		{
			id: "non_preferred_stack",
			severity: "high",
			description: "Stack no preferido requiere confirmación.",
		},
		{
			id: "data_security_review",
			severity: "high",
			description: "Datos high/critical requieren revisión.",
		},
		{
			id: "skip_tests_blocker",
			severity: "blocker",
			description: "No saltar tests/build.",
		},
		{
			id: "forbidden_practice",
			severity: "blocker",
			description: "No usar prácticas prohibidas.",
		},
	];
}

function extractScope(
	constitution: ProjectConstitution,
	kind: "included" | "excluded",
): string[] {
	const marker =
		kind === "included" ? "Alcance incluido:" : "Alcance excluido:";
	const rule = constitution.requiredPractices.find((item) =>
		item.startsWith(marker),
	);
	return rule
		? rule
				.slice(marker.length)
				.split("|")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

function readTechnologyRules(
	value: unknown,
	errors: string[],
): ProjectConstitution["technologyRules"] | undefined {
	const record = asRecord(value);
	if (!record) {
		errors.push("technologyRules must be an object");
		return undefined;
	}
	return {
		preferredStack: readStringArray(record, "preferredStack", errors) ?? [],
		rejectedStack: readStringArray(record, "rejectedStack", errors) ?? [],
	};
}

function readValidationGates(
	value: unknown,
	errors: string[],
): ConstitutionValidationGate[] | undefined {
	if (!Array.isArray(value)) {
		errors.push("validationGates must be an array");
		return undefined;
	}
	const gates: ConstitutionValidationGate[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) {
			errors.push("validationGates entries must be objects");
			return undefined;
		}
		const id = readString(record, "id", errors);
		const severity = readEnum(record, "severity", GATE_SEVERITIES, errors);
		const description = readString(record, "description", errors);
		if (id && severity && description)
			gates.push({ id, severity, description });
	}
	return gates;
}

function readString(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string | undefined {
	const value = record[field];
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${field} must be a non-empty string`);
	return undefined;
}

function readStringArray(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string[] | undefined {
	const value = record[field];
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || !item.trim())
	) {
		errors.push(`${field} must be an array of non-empty strings`);
		return undefined;
	}
	return value.map((item) => item.trim());
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

function issue(
	gateId: string,
	severity: ConstitutionGateSeverity,
	message: string,
): ConstitutionGateIssue {
	return { gateId, severity, message };
}

function hasAuthSecurity(text: string): boolean {
	return /(auth|login|security|seguridad|token|secret|permiso|permission)/u.test(
		text,
	);
}

function hasDataChange(text: string): boolean {
	return /(db|database|base de datos|schema|migration|migraci[oó]n|tabla|table|datos|data)/u.test(
		text,
	);
}

function hasNewModule(text: string): boolean {
	return /(?:crear|crea|agrega|agregar|nuevo|nueva)\s+(?:un\s+|una\s+)?m[oó]dulo/u.test(
		text,
	);
}

function hasArchitectureChange(text: string): boolean {
	return /(arquitectura|architecture|stack|framework|migrar|usar|cambiar)/u.test(
		text,
	);
}

function hasSkipValidation(text: string): boolean {
	return /(sin|skip|saltar|omite|omitir|no correr|no ejecutes).{0,24}(test|tests|build)/u.test(
		text,
	);
}

function matchesForbiddenPractice(text: string, forbidden: string): boolean {
	const normalized = normalize(forbidden);
	if (/saltar.*(test|build)|tests?.*build/u.test(normalized)) {
		return hasSkipValidation(text);
	}
	if (/tecnolog.+rechazada|rejected/u.test(normalized)) return false;
	if (/alcance.*excluido/u.test(normalized)) return false;
	return includesTerm(text, normalized);
}

function includesTerm(value: string, term: string): boolean {
	const normalizedTerm = normalize(term);
	if (!normalizedTerm) return false;
	return value.includes(normalizedTerm);
}

function normalize(value: string): string {
	return value.toLocaleLowerCase("es");
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

function formatInline(items: string[]): string {
	return items.length ? items.join(" | ") : "—";
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function defaultConstitutionPath(): string {
	return join(process.cwd(), "config", "default-constitution.json");
}
