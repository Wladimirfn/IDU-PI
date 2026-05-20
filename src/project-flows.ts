import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectFlow = {
	id: string;
	summary: string;
	steps: string[];
};

export type ProjectFlows = {
	version: string;
	projectType: string;
	invariants: string[];
	qualityRules: string[];
	forbiddenTransitions: string[];
	allowedTransitions: string[];
	validationChecklist: string[];
	flows: ProjectFlow[];
};

export type ProjectFlowsValidationResult =
	| { ok: true; flows: ProjectFlows; errors: [] }
	| { ok: false; errors: string[] };

const REQUIRED_STRING_FIELDS = ["version", "projectType"] as const;
const REQUIRED_STRING_ARRAY_FIELDS = [
	"invariants",
	"qualityRules",
	"forbiddenTransitions",
	"allowedTransitions",
	"validationChecklist",
] as const;

export function loadProjectFlows(projectPath: string): ProjectFlows {
	const projectFlowsPath = join(projectPath, "config", "project-flows.json");
	const flowsPath = existsSync(projectFlowsPath)
		? projectFlowsPath
		: defaultFlowsPath();
	const raw = readFileSync(flowsPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid project flows JSON at ${flowsPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const result = validateProjectFlows(parsed);
	if (!result.ok) {
		throw new Error(
			`Invalid project flows at ${flowsPath}: ${result.errors.join("; ")}`,
		);
	}
	return result.flows;
}

export function validateProjectFlows(
	value: unknown,
): ProjectFlowsValidationResult {
	const errors: string[] = [];
	const record = asRecord(value);
	if (!record) return { ok: false, errors: ["flows must be an object"] };

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
	const flows = readFlows(record.flows, errors);

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		flows: {
			version: strings.version!,
			projectType: strings.projectType!,
			invariants: arrays.invariants!,
			qualityRules: arrays.qualityRules!,
			forbiddenTransitions: arrays.forbiddenTransitions!,
			allowedTransitions: arrays.allowedTransitions!,
			validationChecklist: arrays.validationChecklist!,
			flows: flows!,
		},
	};
}

export function formatFlowsForPrompt(flows: ProjectFlows): string {
	return [
		`Tipo de proyecto: ${flows.projectType}`,
		`Invariantes: ${flows.invariants.join(" | ")}`,
		`Calidad: ${flows.qualityRules.join(" | ")}`,
		`Transiciones prohibidas: ${flows.forbiddenTransitions.join(" | ")}`,
		`Transiciones permitidas: ${flows.allowedTransitions.join(" | ")}`,
		`Validación: ${flows.validationChecklist.join(" && ")}`,
		`Flows: ${flows.flows.map((flow) => `${flow.id}: ${flow.summary}`).join(" | ")}`,
	].join("\n");
}

function readFlows(
	value: unknown,
	errors: string[],
): ProjectFlow[] | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push("flows must be a non-empty array");
		return undefined;
	}
	const flows: ProjectFlow[] = [];
	value.forEach((item, index) => {
		const path = `flows[${index}]`;
		const record = asRecord(item);
		if (!record) {
			errors.push(`${path} must be an object`);
			return;
		}
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const summary = readRequiredString(
			record,
			`${path}.summary`,
			errors,
			"summary",
		);
		const steps = readRequiredStringArray(
			record,
			`${path}.steps`,
			errors,
			"steps",
		);
		if (id && summary && steps) flows.push({ id, summary, steps });
	});
	return errors.length > 0 ? undefined : flows;
}

function readRequiredString(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
	key = field,
): string | undefined {
	const value = record[key];
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${field} must be a non-empty string`);
	return undefined;
}

function readRequiredStringArray(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
	key = field,
): string[] | undefined {
	const value = record[key];
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

function defaultFlowsPath(): string {
	return join(process.cwd(), "config", "default-flows.json");
}
