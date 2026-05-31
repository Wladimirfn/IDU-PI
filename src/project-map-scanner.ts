import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import {
	validateProjectFlows,
	type DataStoreType,
	type FlowStepType,
	type ProjectDataStore,
	type ProjectFlow,
	type ProjectFlows,
	type ProjectScreen,
	type ProjectUiElement,
	type UiElementType,
} from "./project-flows.js";

export type ProjectMapScanSeverity = "warning" | "info";

export type DetectedUiElementType = "button" | "form" | "table" | "dashboard";

export type ProjectMapScanFinding = {
	severity: ProjectMapScanSeverity;
	message: string;
};

export type DetectedUiElement = {
	type: DetectedUiElementType;
	id?: string;
	selector?: string;
	label?: string;
	dataAction?: string;
	file: string;
};

export type DetectedStorage = {
	type:
		| "supabase"
		| "sqlite"
		| "localStorage"
		| "sessionStorage"
		| "json"
		| "api";
	value: string;
	file: string;
};

export type ProjectFlowSuggestions = {
	projectPath: string;
	limited: boolean;
	screens: ProjectScreen[];
	uiElements: ProjectUiElement[];
	dataStores: ProjectDataStore[];
	flows: ProjectFlow[];
};

export type ProjectFlowDraftResult = {
	path: string;
	projectPath: string;
	suggestions: ProjectFlowSuggestions;
};

export type ProjectFlowDraftReview = {
	path: string;
	valid: boolean;
	errors: string[];
	newScreens: ProjectScreen[];
	newUiElements: ProjectUiElement[];
	newDataStores: ProjectDataStore[];
	newFlows: ProjectFlow[];
	duplicates: string[];
	conflicts: string[];
};

export type ProjectFlowsDraftApplyResult = {
	applied: boolean;
	errors: string[];
	added: {
		screens: number;
		uiElements: number;
		dataStores: number;
		flows: number;
	};
	skipped: string[];
	conflicts: string[];
	backupPath?: string;
	finalValidationOk: boolean;
};

type ProjectFlowDraftFile = {
	generatedAt: string;
	projectPath: string;
	warning: string;
	suggestedScreens: ProjectScreen[];
	suggestedUiElements: ProjectUiElement[];
	suggestedDataStores: ProjectDataStore[];
	suggestedFlows: ProjectFlow[];
};

export type ProjectMapScanResult = {
	projectPath: string;
	mapSource: "default" | "project-local";
	definedFlows: number;
	scannedFiles: string[];
	detected: {
		htmlFiles: string[];
		scriptRefs: Array<{ src: string; file: string }>;
		uiElements: DetectedUiElement[];
		inlineOnclicks: Array<{ value: string; file: string }>;
		functions: Array<{ name: string; file: string }>;
		apiEndpoints: Array<{ value: string; file: string }>;
		dataStores: DetectedStorage[];
	};
	findings: ProjectMapScanFinding[];
};

const SKIPPED_DIRECTORIES = new Set([
	".git",
	".pi",
	".pi-lens",
	"node_modules",
	"dist",
	"coverage",
	"reports",
	"workspaces",
]);
const SCANNED_EXTENSIONS = new Set([
	".html",
	".htm",
	".js",
	".jsx",
	".ts",
	".tsx",
	".json",
]);
const MAX_FILE_BYTES = 512_000;
const MANY_INLINE_ONCLICK_THRESHOLD = 3;

export function scanProjectMap(
	projectPath: string,
	flows: ProjectFlows,
): ProjectMapScanResult {
	const scannedFiles = listScannableFiles(projectPath);
	const result: ProjectMapScanResult = {
		projectPath,
		mapSource: existsSync(join(projectPath, "config", "project-flows.json"))
			? "project-local"
			: "default",
		definedFlows: flows.flows.length,
		scannedFiles,
		detected: {
			htmlFiles: [],
			scriptRefs: [],
			uiElements: [],
			inlineOnclicks: [],
			functions: [],
			apiEndpoints: [],
			dataStores: [],
		},
		findings: [],
	};
	for (const file of scannedFiles) {
		const absolutePath = join(projectPath, file);
		const content = readFileSync(absolutePath, "utf8");
		if (isHtml(file)) scanHtml(file, content, result);
		if (isScriptLike(file) || isHtml(file))
			scanScriptText(file, content, result);
		if (isJson(file)) scanJsonFile(file, content, result);
	}
	compareWithFlows(result, flows);
	return result;
}

export function formatProjectMapScan(result: ProjectMapScanResult): string {
	const warnings = result.findings.filter(
		(finding) => finding.severity === "warning",
	);
	const infos = result.findings.filter(
		(finding) => finding.severity === "info",
	);
	const topFindings = result.findings.slice(0, 10);
	const hiddenFindings = Math.max(
		result.findings.length - topFindings.length,
		0,
	);
	const healthLine = warnings.length
		? "Revisá los riesgos principales antes de pedir cambios grandes."
		: "Mapa funcional consistente con el escaneo básico.";
	const defaultFlowsWarning =
		result.mapSource === "default"
			? "\n⚠️ Estás usando default-flows; crea project-local con /config init_project_config."
			: "";
	return `scan_project_map — escaneo estático del proyecto

Resumen:
- pantallas detectadas: ${result.detected.htmlFiles.length}
- botones/UI detectados: ${result.detected.uiElements.length}
- flows definidos: ${result.definedFlows}
- warnings: ${warnings.length}
- infos: ${infos.length}${defaultFlowsWarning}

Riesgos principales:
- pantallas no declaradas: ${countMessages(warnings, "Pantalla real no declarada")}
- botones no mapeados: ${countMessages(warnings, "UI element detectado no mapeado")}
- selectors faltantes: ${countMessages(warnings, "Flow referencia selector que no aparece")}
- dataStores no mapeados: ${countMessages(warnings, "dataStore detectado no mapeado")}
- funciones no usadas en flows: ${countMessages(infos, "Función detectada no usada en flows")}
- duplicados: ${countMessages(warnings, "Botón duplicado")}
- exceso de onclick inline: ${countMessages(warnings, "HTML con muchos onclick inline")}

Recomendación:
- Actualiza config/project-flows.json antes de pedir cambios grandes a la IA.
- Los AgentLabs pueden revisar estos puntos.
- ${healthLine}

Top 10 hallazgos:
${topFindings.length ? topFindings.map((finding, index) => `${index + 1}. [${finding.severity}] ${finding.message}`).join("\n") : "- ninguno"}${hiddenFindings ? `\n- +${hiddenFindings} más` : ""}

Solo lectura: no escribí archivos, no generé project-flows, no usé IA, no ejecuté código del proyecto.`;
}

export function suggestProjectFlowsFromScan(
	projectPath: string,
	flows: ProjectFlows,
): ProjectFlowSuggestions {
	const scan = scanProjectMap(projectPath, flows);
	const mappedScreenPaths = new Set(
		flows.screens.map((screen) => normalizePath(screen.path)),
	);
	const mappedUi = new Set<string>();
	for (const element of flows.uiElements) {
		mappedUi.add(element.id);
		if (element.selector) mappedUi.add(element.selector);
		if (element.label) mappedUi.add(element.label.toLocaleLowerCase());
	}
	const mappedStores = new Set<string>();
	for (const store of flows.dataStores) {
		mappedStores.add(store.id);
		mappedStores.add(store.type);
	}
	const existingFlowTriggers = new Set(flows.flows.map((flow) => flow.trigger));
	const moduleId = flows.modules[0]?.id ?? "main";
	const uiElements = uniqueBy(
		scan.detected.uiElements
			.filter((element) => {
				const keys = detectedElementKey(element);
				return keys.length > 0 && !keys.some((key) => mappedUi.has(key));
			})
			.map((element) => ({
				id: element.id ?? slugFromPath(`${element.file}-${element.type}`),
				type: uiElementType(element.type),
				selector: element.selector,
				label: element.label,
				expectedAction: element.dataAction ?? "Revisar acción detectada",
			})),
		(element) => element.id,
	);
	const dataStores = uniqueBy(
		scan.detected.dataStores
			.filter(
				(store) =>
					!mappedStores.has(store.type) && !mappedStores.has(store.value),
			)
			.map((store) => ({
				id: slugFromPath(store.value),
				type: dataStoreType(store.type),
				tables: [],
				ownerModule: moduleId,
			})),
		(store) => `${store.type}:${store.id}`,
	);
	const candidateFlows = uniqueBy(
		scan.detected.uiElements
			.filter(
				(element) =>
					element.type === "button" &&
					element.selector &&
					element.dataAction &&
					!existingFlowTriggers.has(element.dataAction),
			)
			.map((element) => ({
				id: `${slugFromPath(element.dataAction!)}-flow`,
				name: element.label ?? element.dataAction!,
				module: moduleId,
				trigger: element.dataAction!,
				steps: [
					{
						order: 1,
						type: "ui_action" as FlowStepType,
						from: element.selector!,
						to: element.dataAction!,
						description: "Candidato detectado desde onclick/data-action",
					},
				],
				expectedResult: "Revisar resultado esperado",
				testTargets: [],
			})),
		(flow) => flow.trigger,
	);
	return {
		projectPath,
		limited: false,
		screens: scan.detected.htmlFiles
			.filter((file) => !mappedScreenPaths.has(file))
			.map((file) => ({
				id: slugFromPath(file),
				path: file,
				module: moduleId,
				purpose: "Revisar pantalla detectada por scan_project_map",
				uiElements: uniqueBy(
					scan.detected.uiElements.filter(
						(element) => element.file === file && element.id,
					),
					(element) => element.id!,
				).map((element) => element.id!),
			})),
		uiElements,
		dataStores,
		flows: candidateFlows,
	};
}

export function formatProjectFlowSuggestions(
	suggestions: ProjectFlowSuggestions,
): string {
	const limit = 10;
	const limited = limitArray(suggestions.uiElements, limit);
	return `suggest_project_flows — borrador sugerido

Esto es un borrador sugerido. Revísalo antes de pegarlo en config/project-flows.json.

Resumen:
- screens sugeridas: ${suggestions.screens.length}
- uiElements sugeridos: ${suggestions.uiElements.length}
- dataStores sugeridos: ${suggestions.dataStores.length}
- flows candidatos: ${suggestions.flows.length}

JSON parcial sugerido (Top 10 por sección):
${JSON.stringify(
	{
		screens: limitArray(suggestions.screens, limit).items,
		uiElements: limited.items,
		dataStores: limitArray(suggestions.dataStores, limit).items,
		flows: limitArray(suggestions.flows, limit).items,
	},
	null,
	2,
)}${limited.hidden ? `\n\n+${limited.hidden} más uiElements. Si la sugerencia es grande, conviene editar manualmente.` : ""}

Solo lectura: No escribí archivos, no modifiqué project-flows, no usé IA, no ejecuté código del proyecto.`;
}

export function applyProjectFlowsDraft(
	projectPath: string,
	draftPath: string,
	now = new Date(),
): ProjectFlowsDraftApplyResult {
	const result: ProjectFlowsDraftApplyResult = {
		applied: false,
		errors: [],
		added: { screens: 0, uiElements: 0, dataStores: 0, flows: 0 },
		skipped: [],
		conflicts: [],
		finalValidationOk: false,
	};
	if (!draftPath.trim()) {
		result.errors.push("apply_project_flows_draft requiere ruta explícita");
		return result;
	}
	if (draftPath.trim().toLowerCase() === "latest") {
		result.errors.push(
			"No se permite aplicar latest; indicá una ruta explícita",
		);
		return result;
	}
	const configPath = join(projectPath, "config", "project-flows.json");
	let current: ProjectFlows;
	try {
		current = readProjectFlowsFile(configPath);
	} catch (error) {
		result.errors.push(error instanceof Error ? error.message : String(error));
		return result;
	}
	const review = reviewProjectFlowsDraft(draftPath, current, "");
	if (!review.valid) {
		result.errors.push(...review.errors);
		return result;
	}
	const draft = JSON.parse(
		readFileSync(draftPath, "utf8"),
	) as ProjectFlowDraftFile;
	if (draft.projectPath !== projectPath) {
		result.errors.push("projectPath no coincide con el proyecto activo");
		return result;
	}
	const merged: ProjectFlows = {
		...current,
		modules: [...current.modules],
		screens: [...current.screens],
		uiElements: [...current.uiElements],
		dataStores: [...current.dataStores],
		flows: [...current.flows],
		moduleConnections: [...current.moduleConnections],
	};
	mergeById(merged.screens, draft.suggestedScreens, "screen", result);
	mergeById(merged.uiElements, draft.suggestedUiElements, "uiElement", result);
	mergeById(merged.dataStores, draft.suggestedDataStores, "dataStore", result);
	mergeById(merged.flows, draft.suggestedFlows, "flow", result);
	const validation = validateProjectFlows(merged);
	if (!validation.ok) {
		result.errors.push(
			`project-flows final inválido: ${validation.errors.join("; ")}`,
		);
		return result;
	}
	result.finalValidationOk = true;
	const backupPath = uniqueBackupPath(projectPath, now);
	writeFileSync(backupPath, readFileSync(configPath, "utf8"), "utf8");
	writeFileSync(
		configPath,
		`${JSON.stringify(validation.flows, null, 2)}\n`,
		"utf8",
	);
	const postWriteValidation = validateProjectFlows(
		JSON.parse(readFileSync(configPath, "utf8")) as unknown,
	);
	if (!postWriteValidation.ok) {
		result.errors.push(
			`project-flows escrito no valida: ${postWriteValidation.errors.join("; ")}`,
		);
		return result;
	}
	result.applied = true;
	result.backupPath = backupPath;
	return result;
}

export function formatProjectFlowsDraftApplyResult(
	result: ProjectFlowsDraftApplyResult,
): string {
	if (!result.applied) {
		return `No apliqué el borrador project-flows

Errores:
${result.errors.length ? result.errors.map((error) => `- ${error}`).join("\n") : "- desconocido"}

No usé IA, no ejecuté código del proyecto.`;
	}
	return `Draft project-flows aplicado

Agregados:
- screens: ${result.added.screens}
- uiElements: ${result.added.uiElements}
- dataStores: ${result.added.dataStores}
- flows: ${result.added.flows}

Saltados:
${result.skipped.length ? result.skipped.map((item) => `- ${item}`).join("\n") : "- ninguno"}

Conflictos:
${result.conflicts.length ? result.conflicts.map((item) => `- ${item}`).join("\n") : "- ninguno"}

Backup creado:
${result.backupPath ?? "sin backup"}

Validación final: ${result.finalValidationOk ? "ok" : "falló"}
No usé IA, no ejecuté código del proyecto.`;
}

export function reviewProjectFlowsDraft(
	draftPathOrLatest: string,
	flows: ProjectFlows,
	reportsPath: string,
): ProjectFlowDraftReview {
	const errors: string[] = [];
	let path = draftPathOrLatest;
	try {
		path =
			draftPathOrLatest === "latest"
				? latestDraftPath(reportsPath)
				: draftPathOrLatest;
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}
	let draft: ProjectFlowDraftFile | undefined;
	try {
		draft = JSON.parse(readFileSync(path, "utf8")) as ProjectFlowDraftFile;
	} catch (error) {
		errors.push(
			`No pude leer draft: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (draft) errors.push(...validateDraftFile(draft));
	const existingScreens = new Set(
		flows.screens.map((screen) => normalizePath(screen.path)),
	);
	const existingUi = new Set(flows.uiElements.map((element) => element.id));
	const existingStores = new Set(
		flows.dataStores.flatMap((store) => [store.id, store.type]),
	);
	const existingFlows = new Set(flows.flows.map((flow) => flow.trigger));
	const duplicates: string[] = [];
	const conflicts: string[] = [];
	const suggestedScreens = Array.isArray(draft?.suggestedScreens)
		? draft.suggestedScreens
		: [];
	const suggestedUiElements = Array.isArray(draft?.suggestedUiElements)
		? draft.suggestedUiElements
		: [];
	const suggestedDataStores = Array.isArray(draft?.suggestedDataStores)
		? draft.suggestedDataStores
		: [];
	const suggestedFlows = Array.isArray(draft?.suggestedFlows)
		? draft.suggestedFlows
		: [];
	const newScreens = suggestedScreens.filter(
		(screen) => !existingScreens.has(normalizePath(screen.path)),
	);
	const newUiElements =
		suggestedUiElements.filter((element) => {
			if (existingUi.has(element.id)) {
				duplicates.push(`uiElement duplicado: ${element.id}`);
				return false;
			}
			return true;
		}) ?? [];
	const newDataStores =
		suggestedDataStores.filter((store) => {
			if (existingStores.has(store.id) || existingStores.has(store.type)) {
				duplicates.push(`dataStore duplicado: ${store.id}`);
				return false;
			}
			return true;
		}) ?? [];
	const newFlows =
		suggestedFlows.filter((flow) => {
			if (existingFlows.has(flow.trigger)) {
				duplicates.push(`flow duplicado: ${flow.trigger}`);
				return false;
			}
			return true;
		}) ?? [];
	for (const screen of suggestedScreens) {
		const existing = flows.screens.find(
			(current) =>
				current.id === screen.id &&
				normalizePath(current.path) !== normalizePath(screen.path),
		);
		if (existing) conflicts.push(`screen conflictivo: ${screen.id}`);
	}
	return {
		path,
		valid: errors.length === 0,
		errors,
		newScreens,
		newUiElements,
		newDataStores,
		newFlows,
		duplicates,
		conflicts,
	};
}

export function formatProjectFlowDraftReview(
	review: ProjectFlowDraftReview,
): string {
	if (!review.valid) {
		return `Draft inválido

Ruta:
${review.path}

Errores:
${review.errors.map((error) => `- ${error}`).join("\n")}

No modifiqué config/project-flows.json, no escribí archivos, no usé IA, no ejecuté código del proyecto.`;
	}
	return `Revisión de borrador project-flows

Ruta:
${review.path}

Este borrador aún no es fuente de verdad. Revisa antes de copiarlo o aprobarlo.

Resumen:
- screens nuevas sugeridas: ${review.newScreens.length}
- uiElements nuevos sugeridos: ${review.newUiElements.length}
- dataStores nuevos sugeridos: ${review.newDataStores.length}
- flows nuevos sugeridos: ${review.newFlows.length}
- posibles duplicados: ${review.duplicates.length}
- posibles conflictos: ${review.conflicts.length}

Duplicados:
${review.duplicates.length ? review.duplicates.map((item) => `- ${item}`).join("\n") : "- ninguno"}

Conflictos:
${review.conflicts.length ? review.conflicts.map((item) => `- ${item}`).join("\n") : "- ninguno"}

No modifiqué config/project-flows.json, no escribí archivos, no usé IA, no ejecuté código del proyecto.`;
}

export function saveProjectFlowsDraft(
	projectPath: string,
	flows: ProjectFlows,
	reportsPath: string,
	now = new Date(),
): ProjectFlowDraftResult {
	const suggestions = suggestProjectFlowsFromScan(projectPath, flows);
	mkdirSync(reportsPath, { recursive: true });
	const path = uniqueDraftPath(reportsPath, now);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				generatedAt: now.toISOString(),
				projectPath,
				warning: "Borrador sugerido, no es fuente de verdad",
				suggestedScreens: suggestions.screens,
				suggestedUiElements: suggestions.uiElements,
				suggestedDataStores: suggestions.dataStores,
				suggestedFlows: suggestions.flows,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return { path, projectPath, suggestions };
}

export function formatProjectFlowDraftResult(
	result: ProjectFlowDraftResult,
): string {
	return `Borrador project-flows guardado

Ruta:
${result.path}

Contenido:
- screens sugeridas: ${result.suggestions.screens.length}
- uiElements sugeridos: ${result.suggestions.uiElements.length}
- dataStores sugeridos: ${result.suggestions.dataStores.length}
- flows candidatos: ${result.suggestions.flows.length}

Esto es un borrador sugerido, no es fuente de verdad: revisalo antes de copiarlo a config/project-flows.json.

No modifiqué config/project-flows.json, no usé IA, no ejecuté código del proyecto.`;
}

function readProjectFlowsFile(path: string): ProjectFlows {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const validation = validateProjectFlows(parsed);
	if (!validation.ok) {
		throw new Error(
			`project-flows actual inválido: ${validation.errors.join("; ")}`,
		);
	}
	return validation.flows;
}

function mergeById<T extends { id: string }>(
	target: T[],
	items: T[],
	label: string,
	result: ProjectFlowsDraftApplyResult,
): void {
	const ids = new Set(target.map((item) => item.id));
	for (const item of items) {
		if (ids.has(item.id)) {
			result.skipped.push(`${label} existente: ${item.id}`);
			result.conflicts.push(`${label} conflictivo: ${item.id}`);
			continue;
		}
		target.push(item);
		ids.add(item.id);
		if (label === "screen") result.added.screens += 1;
		if (label === "uiElement") result.added.uiElements += 1;
		if (label === "dataStore") result.added.dataStores += 1;
		if (label === "flow") result.added.flows += 1;
	}
}

function uniqueBackupPath(projectPath: string, now: Date): string {
	const timestamp = now
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/T/u, "-")
		.slice(0, 15);
	let candidate = join(
		projectPath,
		"config",
		`project-flows.backup-${timestamp}.json`,
	);
	let suffix = 2;
	while (existsSync(candidate)) {
		candidate = join(
			projectPath,
			"config",
			`project-flows.backup-${timestamp}-${suffix}.json`,
		);
		suffix += 1;
	}
	return candidate;
}

function validateDraftFile(value: Partial<ProjectFlowDraftFile>): string[] {
	const errors: string[] = [];
	if (typeof value.generatedAt !== "string")
		errors.push("generatedAt es obligatorio");
	if (typeof value.projectPath !== "string")
		errors.push("projectPath es obligatorio");
	if (typeof value.warning !== "string") errors.push("warning es obligatorio");
	if (!Array.isArray(value.suggestedScreens))
		errors.push("suggestedScreens es obligatorio");
	if (!Array.isArray(value.suggestedUiElements))
		errors.push("suggestedUiElements es obligatorio");
	if (!Array.isArray(value.suggestedDataStores))
		errors.push("suggestedDataStores es obligatorio");
	if (!Array.isArray(value.suggestedFlows))
		errors.push("suggestedFlows es obligatorio");
	return errors;
}

function latestDraftPath(reportsPath: string): string {
	const candidates = readdirSync(reportsPath)
		.filter((file) => /^project-flows-draft-.*\.json$/u.test(file))
		.sort();
	const latest = candidates.at(-1);
	if (!latest)
		throw new Error(`No encontré borradores project-flows en ${reportsPath}`);
	return join(reportsPath, latest);
}

function uniqueDraftPath(reportsPath: string, now: Date): string {
	const timestamp = now
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/T/u, "-")
		.slice(0, 15);
	let candidate = join(reportsPath, `project-flows-draft-${timestamp}.json`);
	let suffix = 2;
	while (existsSync(candidate)) {
		candidate = join(
			reportsPath,
			`${basename(candidate, ".json").replace(/-\d+$/u, "")}-${suffix}.json`,
		);
		suffix += 1;
	}
	return candidate;
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
	const seen = new Set<string>();
	const unique: T[] = [];
	for (const item of items) {
		const key = keyFor(item);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(item);
	}
	return unique;
}

function limitArray<T>(
	items: T[],
	limit: number,
): { items: T[]; hidden: number } {
	return {
		items: items.slice(0, limit),
		hidden: Math.max(items.length - limit, 0),
	};
}

function detectedElementKey(element: DetectedUiElement): string[] {
	return [
		element.id,
		element.selector,
		element.label?.toLocaleLowerCase(),
	].filter((value): value is string => !!value);
}

function uiElementType(type: DetectedUiElementType): UiElementType {
	return type;
}

function dataStoreType(type: DetectedStorage["type"]): DataStoreType {
	return type === "sessionStorage" ? "localStorage" : type;
}

function slugFromPath(value: string): string {
	return (
		value
			.replace(/\.[^.]+$/u, "")
			.replace(/[^a-z0-9]+/giu, "-")
			.replace(/^-|-$/gu, "")
			.toLowerCase() || "detected"
	);
}

function countMessages(
	findings: ProjectMapScanFinding[],
	prefix: string,
): number {
	return findings.filter((finding) => finding.message.startsWith(prefix))
		.length;
}

function listScannableFiles(projectPath: string): string[] {
	const files: string[] = [];
	visit(projectPath, "", files);
	return files.sort();
}

function visit(
	projectPath: string,
	relativeDir: string,
	files: string[],
): void {
	const absoluteDir = join(projectPath, relativeDir);
	for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) {
				visit(projectPath, join(relativeDir, entry.name), files);
			}
			continue;
		}
		if (!entry.isFile()) continue;
		const absolutePath = join(absoluteDir, entry.name);
		if (statSync(absolutePath).size > MAX_FILE_BYTES) continue;
		const file = normalizePath(relative(projectPath, absolutePath));
		if (SCANNED_EXTENSIONS.has(extname(file))) files.push(file);
	}
}

function scanHtml(
	file: string,
	content: string,
	result: ProjectMapScanResult,
): void {
	result.detected.htmlFiles.push(file);
	for (const match of content.matchAll(
		/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu,
	)) {
		result.detected.scriptRefs.push({ src: match[1], file });
	}
	for (const match of content.matchAll(
		/<button\b([^>]*)>([\s\S]*?)<\/button>/giu,
	)) {
		const attrs = match[1];
		const label = cleanText(match[2]);
		const id = attr(attrs, "id");
		const dataAction = attr(attrs, "data-action");
		const onclick = attr(attrs, "onclick");
		result.detected.uiElements.push({
			type: "button",
			id: id || undefined,
			selector: id ? `#${id}` : undefined,
			label: label || undefined,
			dataAction: dataAction || undefined,
			file,
		});
		if (onclick) result.detected.inlineOnclicks.push({ value: onclick, file });
	}
	for (const match of content.matchAll(/<form\b([^>]*)>/giu)) {
		pushElement(result, "form", match[1], file);
	}
	for (const match of content.matchAll(/<table\b([^>]*)>/giu)) {
		pushElement(result, "table", match[1], file);
	}
	for (const match of content.matchAll(/<canvas\b([^>]*)>/giu)) {
		pushElement(result, "dashboard", match[1], file);
	}
	for (const match of content.matchAll(
		/<[^>]+\b(?:id|class)=["'][^"']*dashboard[^"']*["'][^>]*>/giu,
	)) {
		pushElement(result, "dashboard", match[0], file);
	}
	for (const match of content.matchAll(/\bonclick=["']([^"']+)["']/giu)) {
		const value = match[1];
		if (
			!result.detected.inlineOnclicks.some(
				(onclick) => onclick.file === file && onclick.value === value,
			)
		) {
			result.detected.inlineOnclicks.push({ value, file });
		}
	}
}

function pushElement(
	result: ProjectMapScanResult,
	type: DetectedUiElementType,
	attrs: string,
	file: string,
): void {
	const id = attr(attrs, "id");
	result.detected.uiElements.push({
		type,
		id: id || undefined,
		selector: id ? `#${id}` : undefined,
		file,
	});
}

function scanScriptText(
	file: string,
	content: string,
	result: ProjectMapScanResult,
): void {
	for (const match of content.matchAll(
		/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu,
	)) {
		pushFunction(result, match[1], file);
	}
	for (const match of content.matchAll(
		/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gu,
	)) {
		pushFunction(result, match[1], file);
	}
	for (const match of content.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/gu)) {
		pushFunction(result, match[1], file);
	}
	for (const match of content.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/gu)) {
		if (isRuntimeDataStoreEvidence(file, content, "api", match[1]))
			pushApiEndpoint(result, match[1], file);
	}
	for (const match of content.matchAll(/["'](\/api\/[^"']+)["']/gu)) {
		if (isRuntimeDataStoreEvidence(file, content, "api", match[1]))
			pushApiEndpoint(result, match[1], file);
	}
	if (isRuntimeDataStoreEvidence(file, content, "localStorage", "localStorage"))
		pushDataStore(result, "localStorage", "localStorage", file);
	if (
		isRuntimeDataStoreEvidence(
			file,
			content,
			"sessionStorage",
			"sessionStorage",
		)
	)
		pushDataStore(result, "sessionStorage", "sessionStorage", file);
	if (isRuntimeDataStoreEvidence(file, content, "supabase", "supabase"))
		pushDataStore(result, "supabase", "supabase", file);
	if (isRuntimeDataStoreEvidence(file, content, "sqlite", "sqlite"))
		pushDataStore(result, "sqlite", "sqlite", file);
	for (const match of content.matchAll(/["']([^"']+\.json)["']/giu)) {
		if (isRuntimeDataStoreEvidence(file, content, "json", match[1]))
			pushDataStore(result, "json", match[1], file);
	}
}

function scanJsonFile(
	file: string,
	content: string,
	result: ProjectMapScanResult,
): void {
	if (
		!file.includes("package-lock") &&
		!file.includes("pnpm-lock") &&
		isRuntimeDataStoreEvidence(file, content, "json", file)
	) {
		pushDataStore(result, "json", file, file);
	}
}

function isRuntimeDataStoreEvidence(
	file: string,
	content: string,
	type: DetectedStorage["type"],
	value: string,
): boolean {
	const sourceKind = dataStoreSourceKind(file);
	if (sourceKind !== "runtime_store") return false;
	switch (type) {
		case "api":
			return isRuntimeApiEvidence(content, value);
		case "localStorage":
			return /\blocalStorage\s*\.\s*(getItem|setItem|removeItem|clear)\s*\(/u.test(
				content,
			);
		case "sessionStorage":
			return /\bsessionStorage\s*\.\s*(getItem|setItem|removeItem|clear)\s*\(/u.test(
				content,
			);
		case "supabase":
			return /\bsupabase\s*\.\s*(from|auth|storage|rpc|channel)\s*\(/u.test(
				content,
			);
		case "sqlite":
			return /\b(open|connect|new)\w*\s*\([^)]*(sqlite|\.db)|\bsqlite3?\s*\.\s*(Database|open)\s*\(/iu.test(
				content,
			);
		case "json":
			return (
				!isConfigOrDefaultJson(file) &&
				/\b(readFile|writeFile|fetch)\s*\(/u.test(content) &&
				content.includes(value)
			);
	}
}

function isRuntimeApiEvidence(content: string, value: string): boolean {
	return (
		new RegExp(`\\bfetch\\s*\\(\\s*["']${escapeRegExp(value)}["']`, "u").test(
			content,
		) ||
		new RegExp(
			`\\b(?:apiUrl|apiEndpoint|endpoint|url|route)\\b[^\n=]*=\\s*["']${escapeRegExp(value)}["']`,
			"u",
		).test(content)
	);
}

function dataStoreSourceKind(
	file: string,
):
	| "runtime_store"
	| "config"
	| "template/default"
	| "draft/report"
	| "test_fixture"
	| "demo" {
	const normalized = normalizePath(file);
	const parts = normalized.split("/");
	if (parts.includes("docs") || parts.includes("reports"))
		return "draft/report";
	if (
		parts.includes("fixtures") ||
		parts.includes("fixture") ||
		parts.includes("test") ||
		parts.includes("tests") ||
		/\.(test|spec)\.[jt]sx?$/u.test(normalized)
	) {
		return "test_fixture";
	}
	if (
		parts.includes("examples") ||
		parts.includes("example") ||
		parts.includes("demo")
	)
		return "demo";
	if (
		parts.includes("templates") ||
		parts.includes("defaults") ||
		/(^|[-_.])defaults?[-_.]/u.test(basename(normalized))
	)
		return "template/default";
	if (parts.includes("config") || isConfigOrDefaultJson(normalized))
		return "config";
	return "runtime_store";
}

function isConfigOrDefaultJson(file: string): boolean {
	const normalized = normalizePath(file);
	return (
		normalized.endsWith("package.json") ||
		normalized.includes("tsconfig") ||
		normalized.includes("project-flows") ||
		normalized.includes("project-blueprint") ||
		normalized.includes("project-core") ||
		normalized.includes("project-constitution")
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareWithFlows(
	result: ProjectMapScanResult,
	flows: ProjectFlows,
): void {
	const mappedUi = new Set<string>();
	for (const element of flows.uiElements) {
		mappedUi.add(element.id);
		if (element.selector) mappedUi.add(element.selector);
		if (element.label) mappedUi.add(element.label.toLocaleLowerCase());
	}
	for (const element of result.detected.uiElements) {
		const keys = [
			element.id,
			element.selector,
			element.label?.toLocaleLowerCase(),
		].filter((value): value is string => !!value);
		if (keys.length > 0 && !keys.some((key) => mappedUi.has(key))) {
			result.findings.push({
				severity: "warning",
				message: `UI element detectado no mapeado: ${keys[0]} (${element.file})`,
			});
		}
	}

	const htmlFiles = new Set(result.detected.htmlFiles);
	const declaredScreenPaths = new Set(
		flows.screens.map((screen) => normalizePath(screen.path)),
	);
	for (const screen of flows.screens) {
		if (screen.path && !htmlFiles.has(normalizePath(screen.path))) {
			result.findings.push({
				severity: "warning",
				message: `Flow referencia pantalla que no existe: ${screen.path}`,
			});
		}
	}
	for (const htmlFile of htmlFiles) {
		if (!declaredScreenPaths.has(htmlFile)) {
			result.findings.push({
				severity: "warning",
				message: `Pantalla real no declarada en screens: ${htmlFile}`,
			});
		}
	}

	const detectedSelectors = new Set(
		result.detected.uiElements
			.map((element) => element.selector)
			.filter((selector): selector is string => !!selector),
	);
	for (const element of flows.uiElements) {
		if (element.selector && !detectedSelectors.has(element.selector)) {
			result.findings.push({
				severity: "warning",
				message: `Flow referencia selector que no aparece: ${element.selector}`,
			});
		}
	}
	for (const flow of flows.flows) {
		for (const step of flow.steps) {
			for (const target of [step.from, step.to]) {
				if (looksLikeSelector(target) && !detectedSelectors.has(target)) {
					result.findings.push({
						severity: "warning",
						message: `Flow referencia selector que no aparece: ${target}`,
					});
				}
			}
		}
	}

	const flowText = flows.flows
		.map(
			(flow) =>
				`${flow.trigger} ${flow.steps.map((step) => `${step.from} ${step.to} ${step.description}`).join(" ")}`,
		)
		.join(" ");
	for (const fn of result.detected.functions) {
		if (!flowText.includes(fn.name)) {
			result.findings.push({
				severity: "info",
				message: `Función detectada no usada en flows: ${fn.name} (${fn.file})`,
			});
		}
	}

	const mappedDataStores = new Set<string>();
	for (const store of flows.dataStores) {
		mappedDataStores.add(store.id);
		mappedDataStores.add(store.type);
	}
	for (const store of result.detected.dataStores) {
		if (
			!mappedDataStores.has(store.type) &&
			!mappedDataStores.has(store.value)
		) {
			result.findings.push({
				severity: "warning",
				message: `dataStore detectado no mapeado: ${store.type} (${store.file})`,
			});
		}
	}

	const onclicksByFile = new Map<string, number>();
	for (const onclick of result.detected.inlineOnclicks) {
		onclicksByFile.set(
			onclick.file,
			(onclicksByFile.get(onclick.file) ?? 0) + 1,
		);
	}
	for (const [file, count] of onclicksByFile) {
		if (count > MANY_INLINE_ONCLICK_THRESHOLD) {
			result.findings.push({
				severity: "warning",
				message: `HTML con muchos onclick inline: ${file} (${count})`,
			});
		}
	}

	const seenButtons = new Set<string>();
	const duplicateButtons = new Set<string>();
	for (const button of result.detected.uiElements.filter(
		(element) => element.type === "button",
	)) {
		const key = button.id || button.label?.toLocaleLowerCase();
		if (!key) continue;
		if (seenButtons.has(key)) duplicateButtons.add(key);
		seenButtons.add(key);
	}
	for (const key of duplicateButtons) {
		result.findings.push({
			severity: "warning",
			message: `Botón duplicado por mismo id/label: ${key}`,
		});
	}
}

function pushFunction(
	result: ProjectMapScanResult,
	name: string,
	file: string,
): void {
	if (
		!result.detected.functions.some(
			(fn) => fn.name === name && fn.file === file,
		)
	) {
		result.detected.functions.push({ name, file });
	}
}

function pushApiEndpoint(
	result: ProjectMapScanResult,
	value: string,
	file: string,
): void {
	if (
		!result.detected.apiEndpoints.some(
			(endpoint) => endpoint.value === value && endpoint.file === file,
		)
	) {
		result.detected.apiEndpoints.push({ value, file });
		pushDataStore(result, "api", value, file);
	}
}

function pushDataStore(
	result: ProjectMapScanResult,
	type: DetectedStorage["type"],
	value: string,
	file: string,
): void {
	if (
		!result.detected.dataStores.some(
			(store) =>
				store.type === type && store.value === value && store.file === file,
		)
	) {
		result.detected.dataStores.push({ type, value, file });
	}
}

function attr(attrs: string, name: string): string {
	const match = attrs.match(
		new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, "iu"),
	);
	return match?.[1] ?? "";
}

function cleanText(value: string): string {
	return value
		.replace(/<[^>]*>/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function isHtml(file: string): boolean {
	return extname(file) === ".html" || extname(file) === ".htm";
}

function isScriptLike(file: string): boolean {
	return [".js", ".jsx", ".ts", ".tsx"].includes(extname(file));
}

function isJson(file: string): boolean {
	return extname(file) === ".json";
}

function looksLikeSelector(value: string): boolean {
	return (
		value.startsWith("#") || value.startsWith(".") || value.startsWith("[")
	);
}

function normalizePath(value: string): string {
	return value.split(sep).join("/");
}
