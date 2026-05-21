import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type UiElementType =
	| "button"
	| "form"
	| "table"
	| "dashboard"
	| "tab"
	| "modal"
	| "link"
	| "banner"
	| "card";

export type DataStoreType =
	| "sqlite"
	| "supabase"
	| "localStorage"
	| "json"
	| "api"
	| "file"
	| "unknown";

export type FlowStepType =
	| "ui_action"
	| "function_call"
	| "api_call"
	| "data_read"
	| "data_write"
	| "ui_update"
	| "navigation"
	| "validation";

export type ProjectModule = {
	id: string;
	name: string;
	description: string;
	screens: string[];
	dataStores: string[];
	connectedModules: string[];
};

export type ProjectScreen = {
	id: string;
	path: string;
	module: string;
	purpose: string;
	tabs?: string[];
	uiElements: string[];
};

export type ProjectUiElement = {
	id: string;
	type: UiElementType;
	selector?: string;
	label?: string;
	expectedAction: string;
};

export type ProjectDataStore = {
	id: string;
	type: DataStoreType;
	tables: string[];
	ownerModule: string;
};

export type ProjectFlowStep = {
	order: number;
	type: FlowStepType;
	from: string;
	to: string;
	description: string;
};

export type ProjectFlow = {
	id: string;
	name: string;
	module: string;
	trigger: string;
	steps: ProjectFlowStep[];
	expectedResult: string;
	testTargets: string[];
};

export type ProjectModuleConnection = {
	fromModule: string;
	toModule: string;
	reason: string;
	dataShared: string[];
};

export type ProjectFlows = {
	version: string;
	projectType: string;
	invariants: string[];
	qualityRules: string[];
	forbiddenTransitions: string[];
	allowedTransitions: string[];
	validationChecklist: string[];
	modules: ProjectModule[];
	screens: ProjectScreen[];
	uiElements: ProjectUiElement[];
	dataStores: ProjectDataStore[];
	flows: ProjectFlow[];
	moduleConnections: ProjectModuleConnection[];
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
const UI_ELEMENT_TYPES = new Set<UiElementType>([
	"button",
	"form",
	"table",
	"dashboard",
	"tab",
	"modal",
	"link",
	"banner",
	"card",
]);
const DATA_STORE_TYPES = new Set<DataStoreType>([
	"sqlite",
	"supabase",
	"localStorage",
	"json",
	"api",
	"file",
	"unknown",
]);
const STEP_TYPES = new Set<FlowStepType>([
	"ui_action",
	"function_call",
	"api_call",
	"data_read",
	"data_write",
	"ui_update",
	"navigation",
	"validation",
]);

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
	const modules = readModules(record.modules, errors);
	const moduleIds = new Set((modules ?? []).map((module) => module.id));
	const screens = readScreens(record.screens, moduleIds, errors);
	const uiElements = readUiElements(record.uiElements, errors);
	const dataStores = readDataStores(record.dataStores, moduleIds, errors);
	const flows = readFlows(record.flows, moduleIds, errors);
	const moduleConnections = readModuleConnections(
		record.moduleConnections,
		moduleIds,
		errors,
	);

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
			modules: modules!,
			screens: screens!,
			uiElements: uiElements!,
			dataStores: dataStores!,
			flows: flows!,
			moduleConnections: moduleConnections!,
		},
	};
}

export function formatFlowsForPrompt(flows: ProjectFlows): string {
	return [
		"project-flows es el mapa funcional del proyecto real, no el mapa interno de Idu-pi.",
		`Tipo de proyecto: ${flows.projectType}`,
		`Módulos: ${flows.modules.map((module) => `${module.name}(${module.id})`).join(" | ")}`,
		`Pantallas: ${flows.screens.map((screen) => `${screen.path} -> ${screen.module}`).join(" | ")}`,
		`Datos: ${flows.dataStores.map((store) => `${store.id}:${store.type}`).join(" | ")}`,
		`Flujos: ${flows.flows.map((flow) => `${flow.name}: ${flow.trigger} => ${flow.expectedResult}`).join(" | ")}`,
		`Conexiones: ${flows.moduleConnections.map((connection) => `${connection.fromModule}->${connection.toModule}`).join(" | ")}`,
		`Validación: ${flows.validationChecklist.join(" && ")}`,
	].join("\n");
}

function readModules(
	value: unknown,
	errors: string[],
): ProjectModule[] | undefined {
	return readObjectArray(value, "modules", errors, (record, path) => {
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const name = readRequiredString(record, `${path}.name`, errors, "name");
		const description = readRequiredString(
			record,
			`${path}.description`,
			errors,
			"description",
		);
		const screens = readRequiredStringArray(
			record,
			`${path}.screens`,
			errors,
			"screens",
		);
		const dataStores = readRequiredStringArray(
			record,
			`${path}.dataStores`,
			errors,
			"dataStores",
		);
		const connectedModules = readRequiredStringArray(
			record,
			`${path}.connectedModules`,
			errors,
			"connectedModules",
		);
		return id &&
			name &&
			description &&
			screens &&
			dataStores &&
			connectedModules
			? { id, name, description, screens, dataStores, connectedModules }
			: undefined;
	});
}

function readScreens(
	value: unknown,
	moduleIds: Set<string>,
	errors: string[],
): ProjectScreen[] | undefined {
	return readObjectArray(value, "screens", errors, (record, path) => {
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const screenPath = readRequiredString(
			record,
			`${path}.path`,
			errors,
			"path",
		);
		const module = readRequiredString(
			record,
			`${path}.module`,
			errors,
			"module",
		);
		const purpose = readRequiredString(
			record,
			`${path}.purpose`,
			errors,
			"purpose",
		);
		const tabs = readOptionalStringArray(
			record,
			`${path}.tabs`,
			errors,
			"tabs",
		);
		const uiElements = readRequiredStringArray(
			record,
			`${path}.uiElements`,
			errors,
			"uiElements",
		);
		if (module && !moduleIds.has(module))
			errors.push(`${path}.module references missing module ${module}`);
		return id && screenPath && module && purpose && uiElements
			? {
					id,
					path: screenPath,
					module,
					purpose,
					...(tabs ? { tabs } : {}),
					uiElements,
				}
			: undefined;
	});
}

function readUiElements(
	value: unknown,
	errors: string[],
): ProjectUiElement[] | undefined {
	return readObjectArray(value, "uiElements", errors, (record, path) => {
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const type = readEnum(
			record.type,
			`${path}.type`,
			UI_ELEMENT_TYPES,
			errors,
		);
		const selector = readOptionalString(
			record,
			`${path}.selector`,
			errors,
			"selector",
		);
		const label = readOptionalString(record, `${path}.label`, errors, "label");
		const expectedAction = readRequiredString(
			record,
			`${path}.expectedAction`,
			errors,
			"expectedAction",
		);
		if (!selector && !label) errors.push(`${path} requires selector or label`);
		return id && type && expectedAction
			? {
					id,
					type,
					...(selector ? { selector } : {}),
					...(label ? { label } : {}),
					expectedAction,
				}
			: undefined;
	});
}

function readDataStores(
	value: unknown,
	moduleIds: Set<string>,
	errors: string[],
): ProjectDataStore[] | undefined {
	return readObjectArray(value, "dataStores", errors, (record, path) => {
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const type = readEnum(
			record.type,
			`${path}.type`,
			DATA_STORE_TYPES,
			errors,
		);
		const tables = readRequiredStringArray(
			record,
			`${path}.tables`,
			errors,
			"tables",
		);
		const ownerModule = readRequiredString(
			record,
			`${path}.ownerModule`,
			errors,
			"ownerModule",
		);
		if (ownerModule && !moduleIds.has(ownerModule))
			errors.push(
				`${path}.ownerModule references missing module ${ownerModule}`,
			);
		return id && type && tables && ownerModule
			? { id, type, tables, ownerModule }
			: undefined;
	});
}

function readFlows(
	value: unknown,
	moduleIds: Set<string>,
	errors: string[],
): ProjectFlow[] | undefined {
	return readObjectArray(value, "flows", errors, (record, path) => {
		const id = readRequiredString(record, `${path}.id`, errors, "id");
		const name = readRequiredString(record, `${path}.name`, errors, "name");
		const module = readRequiredString(
			record,
			`${path}.module`,
			errors,
			"module",
		);
		const trigger = readRequiredString(
			record,
			`${path}.trigger`,
			errors,
			"trigger",
		);
		const steps = readFlowSteps(record.steps, `${path}.steps`, errors);
		const expectedResult = readRequiredString(
			record,
			`${path}.expectedResult`,
			errors,
			"expectedResult",
		);
		const testTargets = readRequiredStringArray(
			record,
			`${path}.testTargets`,
			errors,
			"testTargets",
		);
		if (module && !moduleIds.has(module))
			errors.push(`${path}.module references missing module ${module}`);
		return id &&
			name &&
			module &&
			trigger &&
			steps &&
			expectedResult &&
			testTargets
			? { id, name, module, trigger, steps, expectedResult, testTargets }
			: undefined;
	});
}

function readFlowSteps(
	value: unknown,
	path: string,
	errors: string[],
): ProjectFlowStep[] | undefined {
	return readObjectArray(value, path, errors, (record, itemPath) => {
		const orderValue = record.order;
		const order =
			typeof orderValue === "number" && Number.isSafeInteger(orderValue)
				? orderValue
				: undefined;
		if (order === undefined)
			errors.push(`${itemPath}.order must be an integer`);
		const type = readEnum(record.type, `${itemPath}.type`, STEP_TYPES, errors);
		const from = readRequiredString(record, `${itemPath}.from`, errors, "from");
		const to = readRequiredString(record, `${itemPath}.to`, errors, "to");
		const description = readRequiredString(
			record,
			`${itemPath}.description`,
			errors,
			"description",
		);
		return order !== undefined && type && from && to && description
			? { order, type, from, to, description }
			: undefined;
	});
}

function readModuleConnections(
	value: unknown,
	moduleIds: Set<string>,
	errors: string[],
): ProjectModuleConnection[] | undefined {
	return readObjectArray(value, "moduleConnections", errors, (record, path) => {
		const fromModule = readRequiredString(
			record,
			`${path}.fromModule`,
			errors,
			"fromModule",
		);
		const toModule = readRequiredString(
			record,
			`${path}.toModule`,
			errors,
			"toModule",
		);
		const reason = readRequiredString(
			record,
			`${path}.reason`,
			errors,
			"reason",
		);
		const dataShared = readRequiredStringArray(
			record,
			`${path}.dataShared`,
			errors,
			"dataShared",
		);
		if (fromModule && !moduleIds.has(fromModule))
			errors.push(`${path}.fromModule references missing module ${fromModule}`);
		if (toModule && !moduleIds.has(toModule))
			errors.push(`${path}.toModule references missing module ${toModule}`);
		return fromModule && toModule && reason && dataShared
			? { fromModule, toModule, reason, dataShared }
			: undefined;
	});
}

function readObjectArray<T>(
	value: unknown,
	path: string,
	errors: string[],
	reader: (record: Record<string, unknown>, path: string) => T | undefined,
): T[] | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${path} must be a non-empty array`);
		return undefined;
	}
	const items: T[] = [];
	value.forEach((item, index) => {
		const itemPath = `${path}[${index}]`;
		const record = asRecord(item);
		if (!record) {
			errors.push(`${itemPath} must be an object`);
			return;
		}
		const parsed = reader(record, itemPath);
		if (parsed) items.push(parsed);
	});
	return errors.length > 0 ? undefined : items;
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

function readOptionalString(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
	key = field,
): string | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${field} must be a non-empty string when provided`);
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

function readOptionalStringArray(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
	key = field,
): string[] | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	return readRequiredStringArray(record, field, errors, key);
}

function readEnum<T extends string>(
	value: unknown,
	path: string,
	allowed: Set<T>,
	errors: string[],
): T | undefined {
	if (typeof value === "string" && allowed.has(value as T)) return value as T;
	errors.push(`${path} must be one of: ${[...allowed].join(", ")}`);
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function defaultFlowsPath(): string {
	return join(process.cwd(), "config", "default-flows.json");
}
