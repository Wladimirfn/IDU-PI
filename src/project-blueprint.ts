import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectBlueprint = {
	projectName: string;
	projectGoal: string;
	projectType: string;
	version: string;
	agentHierarchy: string[];
	architectureRules: string[];
	forbiddenActions: string[];
	qualityRules: string[];
	requiredValidation: string[];
	createdAt: string;
	updatedAt: string;
};

export type ProjectBlueprintValidationResult =
	| { ok: true; blueprint: ProjectBlueprint; errors: [] }
	| { ok: false; errors: string[] };

const REQUIRED_STRING_FIELDS = [
	"projectName",
	"projectGoal",
	"projectType",
	"version",
	"createdAt",
	"updatedAt",
] as const;

const REQUIRED_STRING_ARRAY_FIELDS = [
	"agentHierarchy",
	"architectureRules",
	"forbiddenActions",
	"qualityRules",
	"requiredValidation",
] as const;

export function loadProjectBlueprint(projectPath: string): ProjectBlueprint {
	const projectBlueprintPath = join(
		projectPath,
		"config",
		"project-blueprint.json",
	);
	const blueprintPath = existsSync(projectBlueprintPath)
		? projectBlueprintPath
		: defaultBlueprintPath();
	const raw = readFileSync(blueprintPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid project blueprint JSON at ${blueprintPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const result = validateProjectBlueprint(parsed);
	if (!result.ok) {
		throw new Error(
			`Invalid project blueprint at ${blueprintPath}: ${result.errors.join("; ")}`,
		);
	}
	return result.blueprint;
}

export function validateProjectBlueprint(
	value: unknown,
): ProjectBlueprintValidationResult {
	const errors: string[] = [];
	const record = asRecord(value);
	if (!record) return { ok: false, errors: ["blueprint must be an object"] };

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

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		blueprint: {
			projectName: strings.projectName!,
			projectGoal: strings.projectGoal!,
			projectType: strings.projectType!,
			version: strings.version!,
			agentHierarchy: arrays.agentHierarchy!,
			architectureRules: arrays.architectureRules!,
			forbiddenActions: arrays.forbiddenActions!,
			qualityRules: arrays.qualityRules!,
			requiredValidation: arrays.requiredValidation!,
			createdAt: strings.createdAt!,
			updatedAt: strings.updatedAt!,
		},
	};
}

export function formatBlueprintForPrompt(blueprint: ProjectBlueprint): string {
	return [
		`Proyecto: ${blueprint.projectName}`,
		`Objetivo: ${blueprint.projectGoal}`,
		`Tipo: ${blueprint.projectType}`,
		`Jerarquía: ${blueprint.agentHierarchy.join(" | ")}`,
		`Reglas arquitectura: ${blueprint.architectureRules.join(" | ")}`,
		`Prohibido: ${blueprint.forbiddenActions.join(" | ")}`,
		`Calidad: ${blueprint.qualityRules.join(" | ")}`,
		`Validación requerida: ${blueprint.requiredValidation.join(" && ")}`,
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
		errors.push(`${field} must be an array of non-empty strings`);
		return undefined;
	}
	const strings = value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
	if (strings.length !== value.length || strings.length === 0) {
		errors.push(`${field} must contain at least one non-empty string`);
		return undefined;
	}
	return strings.map((item) => item.trim());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function defaultBlueprintPath(): string {
	return join(process.cwd(), "config", "default-blueprint.json");
}
