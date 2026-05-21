import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type {
	DataStoreType,
	FlowStepType,
	ProjectDataStore,
	ProjectFlow,
	ProjectFlows,
	ProjectScreen,
	ProjectUiElement,
	UiElementType,
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
		pushApiEndpoint(result, match[1], file);
	}
	for (const match of content.matchAll(/["'](\/api\/[^"']+)["']/gu)) {
		pushApiEndpoint(result, match[1], file);
	}
	if (/\blocalStorage\b/u.test(content))
		pushDataStore(result, "localStorage", "localStorage", file);
	if (/\bsessionStorage\b/u.test(content))
		pushDataStore(result, "sessionStorage", "sessionStorage", file);
	if (/\bsupabase\b/u.test(content))
		pushDataStore(result, "supabase", "supabase", file);
	if (/\bsqlite\b|\.sqlite\b|\.db\b/iu.test(content))
		pushDataStore(result, "sqlite", "sqlite", file);
	for (const match of content.matchAll(/["']([^"']+\.json)["']/giu)) {
		pushDataStore(result, "json", match[1], file);
	}
}

function scanJsonFile(
	file: string,
	_content: string,
	result: ProjectMapScanResult,
): void {
	if (!file.includes("package-lock") && !file.includes("pnpm-lock")) {
		pushDataStore(result, "json", file, file);
	}
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
