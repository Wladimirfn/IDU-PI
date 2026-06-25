import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import {
	formatFlowsForPrompt,
	loadProjectFlows,
	validateProjectFlows,
	type ProjectFlows,
} from "./project-flows.js";
import {
	formatBlueprintForPrompt,
	loadProjectBlueprint,
	validateProjectBlueprint,
	type ProjectBlueprint,
} from "./project-blueprint.js";
import { formatProjectMapScan, scanProjectMap } from "./project-map-scanner.js";

const AI_PROJECT_DRAFT_WARNING = "Borrador IA. No es fuente de verdad.";

type AiDraftKind = "project-blueprint" | "project-flows";

type GenerateAiDraft = (prompt: string) => Promise<string>;

export type AiProjectDraftOptions = {
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	generate: GenerateAiDraft;
	now?: () => Date;
};

export type AiProjectDraftResult =
	| {
			ok: true;
			path: string;
			kind: AiDraftKind;
			validJson: boolean;
			warning: string;
	  }
	| { ok: false; kind: AiDraftKind; error: string };

export type AiProjectDraftReview = {
	kind: AiDraftKind;
	path: string;
	validDraft: boolean;
	hasRequiredWarning: boolean;
	validJson: boolean;
	hasRawOutput: boolean;
	validBlueprint?: boolean;
	validFlows?: boolean;
	newFields: string[];
	differentFields: string[];
	missingFields: string[];
	suggestedModules: string[];
	suggestedScreens: string[];
	suggestedUiElements: string[];
	suggestedDataStores: string[];
	suggestedFlows: string[];
	idConflicts: string[];
	possibleDuplicates: string[];
	risks: string[];
	errors: string[];
};

type AiDraftFile = {
	generatedAt?: unknown;
	projectPath?: unknown;
	warning?: unknown;
	validJson?: unknown;
	proposal?: unknown;
	rawOutput?: unknown;
};

const MAX_CONTEXT_FILE_BYTES = 48_000;
const MAX_CONTEXT_CHARS = 12_000;
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const BLUEPRINT_DRAFT_PREFIX = "project-blueprint-ai-draft-";
const FLOWS_DRAFT_PREFIX = "project-flows-ai-draft-";
const DRAFT_SUFFIX = ".json";

export async function createAiProjectBlueprintDraft(
	options: AiProjectDraftOptions,
): Promise<AiProjectDraftResult> {
	try {
		return await createAiProjectDraft({
			...options,
			kind: "project-blueprint",
			prompt: buildBlueprintPrompt(options.projectPath, options.stateRoot),
		});
	} catch (error) {
		return draftError("project-blueprint", error);
	}
}

export async function createAiProjectFlowsDraft(
	options: AiProjectDraftOptions,
): Promise<AiProjectDraftResult> {
	try {
		return await createAiProjectDraft({
			...options,
			kind: "project-flows",
			prompt: buildFlowsPrompt(options.projectPath, options.stateRoot),
		});
	} catch (error) {
		return draftError("project-flows", error);
	}
}

export function reviewAiProjectBlueprintDraft(
	pathOrLatest: string,
	projectPath: string,
	reportsDir: string,
	stateRoot: string,
): AiProjectDraftReview {
	const review = emptyReview("project-blueprint", pathOrLatest);
	const path = resolveDraftPath(
		pathOrLatest,
		reportsDir,
		BLUEPRINT_DRAFT_PREFIX,
	);
	if (!path) {
		review.validDraft = false;
		review.errors.push("No encontré borrador IA de blueprint en reports/.");
		return review;
	}
	review.path = path;
	const draft = readDraftFile(path, review);
	if (!draft) return review;
	inspectCommonDraft(draft, review);
	if (review.hasRawOutput || !review.validJson) return review;
	const proposal = draft.proposal;
	const validation = validateProjectBlueprint(proposal);
	review.validBlueprint = validation.ok;
	if (!validation.ok) {
		review.errors.push(...validation.errors);
		review.risks.push(
			"El JSON no cumple estructura completa de project-blueprint.",
		);
	} else {
		compareBlueprint(
			validation.blueprint,
			loadProjectBlueprint(stateRoot),
			review,
		);
	}
	review.validDraft =
		review.hasRequiredWarning && review.validJson && validation.ok;
	return review;
}

export function reviewAiProjectFlowsDraft(
	pathOrLatest: string,
	projectPath: string,
	reportsDir: string,
	stateRoot: string,
): AiProjectDraftReview {
	const review = emptyReview("project-flows", pathOrLatest);
	const path = resolveDraftPath(pathOrLatest, reportsDir, FLOWS_DRAFT_PREFIX);
	if (!path) {
		review.validDraft = false;
		review.errors.push("No encontré borrador IA de flows en reports/.");
		return review;
	}
	review.path = path;
	const draft = readDraftFile(path, review);
	if (!draft) return review;
	inspectCommonDraft(draft, review);
	if (review.hasRawOutput || !review.validJson) return review;
	const proposal = draft.proposal;
	collectFlowIds(proposal, loadProjectFlows(stateRoot), review);
	const validation = validateProjectFlows(proposal);
	review.validFlows = validation.ok;
	if (!validation.ok) {
		review.errors.push(...validation.errors);
		review.risks.push(
			"El JSON no cumple estructura completa de project-flows; tratá el resultado como parcial.",
		);
	}
	review.validDraft = review.hasRequiredWarning && review.validJson;
	return review;
}

export function formatAiProjectDraftResult(
	result: AiProjectDraftResult,
): string {
	if (!result.ok) return result.error;
	return [
		`${result.kind} — borrador IA guardado`,
		`Ruta: ${result.path}`,
		`Warning: ${result.warning}`,
		`JSON válido: ${result.validJson ? "sí" : "no, guardé rawOutput"}`,
		"No modifiqué config/project-blueprint.json ni config/project-flows.json.",
		"Revisión humana requerida antes de aplicar o copiar cambios.",
	].join("\n");
}

export function formatAiProjectDraftReview(
	review: AiProjectDraftReview,
): string {
	if (review.errors.length && review.path === "latest") {
		return `${review.kind} — revisión de borrador IA\n${review.errors.join("\n")}`;
	}
	const lines = [
		`${review.kind} — revisión de borrador IA`,
		`Ruta: ${review.path}`,
		`Warning requerido: ${review.hasRequiredWarning ? "sí" : "no"}`,
		`JSON válido: ${review.validJson ? "sí" : "no"}`,
	];
	if (review.kind === "project-blueprint") {
		lines.push(
			`Blueprint válido: ${review.validBlueprint ? "sí" : "no"}`,
			`campos nuevos sugeridos: ${listOrNone(review.newFields)}`,
			`campos distintos: ${listOrNone(review.differentFields)}`,
			`campos faltantes: ${listOrNone(review.missingFields)}`,
		);
	} else {
		lines.push(
			`Flows válido completo: ${review.validFlows ? "sí" : "no/parcial"}`,
			`modules sugeridos: ${listOrNone(review.suggestedModules)}`,
			`screens sugeridas: ${listOrNone(review.suggestedScreens)}`,
			`uiElements sugeridos: ${listOrNone(review.suggestedUiElements)}`,
			`dataStores sugeridos: ${listOrNone(review.suggestedDataStores)}`,
			`flows sugeridos: ${listOrNone(review.suggestedFlows)}`,
			`conflictos de ID: ${listOrNone(review.idConflicts)}`,
			`posibles duplicados: ${listOrNone(review.possibleDuplicates)}`,
		);
	}
	lines.push(
		`riesgos: ${listOrNone(review.risks)}`,
		`errores: ${listOrNone(review.errors)}`,
		"Solo lectura: no apliqué cambios ni escribí config.",
		"Revisión humana requerida antes de copiar/aplicar.",
	);
	return lines.join("\n");
}

async function createAiProjectDraft(
	options: AiProjectDraftOptions & { kind: AiDraftKind; prompt: string },
): Promise<AiProjectDraftResult> {
	let rawOutput: string;
	try {
		rawOutput = await options.generate(options.prompt);
	} catch (error) {
		return draftError(options.kind, error);
	}

	const parsed = parseJson(rawOutput);
	const generatedAt = (options.now ?? (() => new Date()))();
	const draft: AiDraftFile = {
		generatedAt: generatedAt.toISOString(),
		projectPath: options.projectPath,
		warning: AI_PROJECT_DRAFT_WARNING,
		validJson: parsed.ok,
		...(parsed.ok ? { proposal: parsed.value } : { rawOutput }),
	};
	mkdirSync(options.reportsDir, { recursive: true });
	const path = join(
		options.reportsDir,
		`${options.kind}-ai-draft-${timestamp(generatedAt)}.json`,
	);
	writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
	return {
		ok: true,
		path,
		kind: options.kind,
		validJson: parsed.ok,
		warning: AI_PROJECT_DRAFT_WARNING,
	};
}

function draftError(kind: AiDraftKind, error: unknown): AiProjectDraftResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		kind,
		error: `No pude generar borrador IA (${kind}): ${message}`,
	};
}

function buildBlueprintPrompt(projectPath: string, stateRoot: string): string {
	return [
		"Generá una propuesta JSON para project-blueprint.",
		`Warning obligatorio: ${AI_PROJECT_DRAFT_WARNING}`,
		"Reglas: no aplicar cambios, no tratar la IA como fuente de verdad, no pedir secretos.",
		"Contexto seguro del proyecto:",
		collectSafeProjectSummary(projectPath),
		"Blueprint actual:",
		safeCurrentBlueprint(stateRoot),
	].join("\n\n");
}

function buildFlowsPrompt(projectPath: string, stateRoot: string): string {
	// Slice 4/5: projectPath for scan target (listScannableFiles scans the
	// repo); stateRoot for flows file location (mirrors the Slice 3
	// buildProjectCoreResearchPrompt two-params pattern — avoids the
	// ef42a8d trap of mixing semantics in one string-arg).
	const flows = loadProjectFlows(stateRoot);
	const scan = scanProjectMap(projectPath, stateRoot, flows);
	return [
		"Generá una propuesta JSON parcial para project-flows.",
		`Warning obligatorio: ${AI_PROJECT_DRAFT_WARNING}`,
		"Reglas: usar solo este resumen seguro, no aplicar automáticamente, revisión humana requerida.",
		"scan_project_map:",
		formatProjectMapScan(scan),
		"project-flows actual:",
		formatFlowsForPrompt(flows),
	].join("\n\n");
}

function emptyReview(kind: AiDraftKind, path: string): AiProjectDraftReview {
	return {
		kind,
		path,
		validDraft: false,
		hasRequiredWarning: false,
		validJson: false,
		hasRawOutput: false,
		newFields: [],
		differentFields: [],
		missingFields: [],
		suggestedModules: [],
		suggestedScreens: [],
		suggestedUiElements: [],
		suggestedDataStores: [],
		suggestedFlows: [],
		idConflicts: [],
		possibleDuplicates: [],
		risks: [],
		errors: [],
	};
}

function resolveDraftPath(
	pathOrLatest: string,
	reportsDir: string,
	prefix: string,
): string | undefined {
	if (pathOrLatest.trim() !== "latest") return pathOrLatest.trim();
	if (!existsSync(reportsDir)) return undefined;
	return readdirSync(reportsDir)
		.filter((entry) => entry.startsWith(prefix) && entry.endsWith(DRAFT_SUFFIX))
		.sort()
		.map((entry) => join(reportsDir, entry))
		.at(-1);
}

function readDraftFile(
	path: string,
	review: AiProjectDraftReview,
): AiDraftFile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			review.errors.push("El draft IA debe ser un objeto JSON.");
			return undefined;
		}
		return parsed as AiDraftFile;
	} catch (error) {
		review.errors.push(
			`No pude leer draft IA: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

function inspectCommonDraft(
	draft: AiDraftFile,
	review: AiProjectDraftReview,
): void {
	review.hasRequiredWarning = draft.warning === AI_PROJECT_DRAFT_WARNING;
	if (!review.hasRequiredWarning)
		review.risks.push("El draft no trae el warning requerido.");
	review.validJson = draft.validJson === true && draft.proposal !== undefined;
	review.hasRawOutput = typeof draft.rawOutput === "string";
	if (review.hasRawOutput)
		review.risks.push(
			"La IA devolvió JSON inválido; se guardó rawOutput para revisión manual.",
		);
	if (!review.validJson && !review.hasRawOutput) {
		review.errors.push("El draft no trae proposal JSON válido ni rawOutput.");
	}
}

function compareBlueprint(
	proposal: ProjectBlueprint,
	current: ProjectBlueprint,
	review: AiProjectDraftReview,
): void {
	const proposalRecord = proposal as unknown as Record<string, unknown>;
	const currentRecord = current as unknown as Record<string, unknown>;
	const requiredFields = Object.keys(currentRecord);
	for (const field of Object.keys(proposalRecord)) {
		if (!(field in currentRecord)) review.newFields.push(field);
		else if (
			JSON.stringify(proposalRecord[field]) !==
			JSON.stringify(currentRecord[field])
		) {
			review.differentFields.push(field);
		}
	}
	for (const field of requiredFields) {
		if (!(field in proposalRecord)) review.missingFields.push(field);
	}
	if (review.newFields.length)
		review.risks.push("El draft propone campos fuera del schema actual.");
}

function collectFlowIds(
	proposal: unknown,
	current: ProjectFlows,
	review: AiProjectDraftReview,
): void {
	const record =
		proposal && typeof proposal === "object" && !Array.isArray(proposal)
			? (proposal as Record<string, unknown>)
			: {};
	const currentIds = {
		modules: new Set(current.modules.map((item) => item.id)),
		screens: new Set(current.screens.map((item) => item.id)),
		uiElements: new Set(current.uiElements.map((item) => item.id)),
		dataStores: new Set(current.dataStores.map((item) => item.id)),
		flows: new Set(current.flows.map((item) => item.id)),
	};
	collectTypedIds(
		record.modules,
		currentIds.modules,
		"module",
		review.suggestedModules,
		review,
	);
	collectTypedIds(
		record.screens,
		currentIds.screens,
		"screen",
		review.suggestedScreens,
		review,
	);
	collectTypedIds(
		record.uiElements,
		currentIds.uiElements,
		"uiElement",
		review.suggestedUiElements,
		review,
	);
	collectTypedIds(
		record.dataStores,
		currentIds.dataStores,
		"dataStore",
		review.suggestedDataStores,
		review,
	);
	collectTypedIds(
		record.flows,
		currentIds.flows,
		"flow",
		review.suggestedFlows,
		review,
	);
}

function collectTypedIds(
	value: unknown,
	currentIds: Set<string>,
	label: string,
	suggested: string[],
	review: AiProjectDraftReview,
): void {
	if (!Array.isArray(value)) return;
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const id = (item as { id?: unknown }).id;
		if (typeof id !== "string" || !id.trim()) continue;
		if (seen.has(id)) review.possibleDuplicates.push(`${label}:${id}`);
		seen.add(id);
		if (currentIds.has(id)) {
			review.idConflicts.push(`${label}:${id}`);
			review.possibleDuplicates.push(`${label}:${id}`);
		} else {
			suggested.push(id);
		}
	}
}

function collectSafeProjectSummary(projectPath: string): string {
	const parts: string[] = [];
	for (const relativePath of ["README.md", "package.json"]) {
		const content = readSmallTextFile(join(projectPath, relativePath));
		if (content) parts.push(`## ${relativePath}\n${content}`);
	}
	const docsDir = join(projectPath, "docs");
	if (existsSync(docsDir)) {
		for (const entry of readdirSync(docsDir).sort().slice(0, 5)) {
			const path = join(docsDir, entry);
			if (!statSync(path).isFile()) continue;
			if (!DOC_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
			const content = readSmallTextFile(path);
			if (content) parts.push(`## docs/${basename(entry)}\n${content}`);
		}
	}
	return clamp(parts.join("\n\n"), MAX_CONTEXT_CHARS);
}

function safeCurrentBlueprint(stateRoot: string): string {
	try {
		return formatBlueprintForPrompt(loadProjectBlueprint(stateRoot));
	} catch (error) {
		return `No pude leer blueprint actual: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function readSmallTextFile(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	const stat = statSync(path);
	if (!stat.isFile() || stat.size > MAX_CONTEXT_FILE_BYTES) return undefined;
	return clamp(
		redactSecretLines(readFileSync(path, "utf8")),
		MAX_CONTEXT_CHARS,
	);
}

function redactSecretLines(content: string): string {
	return content
		.split("\n")
		.map((line) =>
			/(secret|token|password|passwd|api[_-]?key|private[_-]?key)\s*[:=]/iu.test(
				line,
			)
				? "[redacted-secret-line]"
				: line,
		)
		.join("\n");
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(raw) as unknown };
	} catch {
		return { ok: false };
	}
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function clamp(value: string, maxChars: number): string {
	return value.length <= maxChars
		? value
		: `${value.slice(0, maxChars)}\n[truncado]`;
}

function listOrNone(items: string[]): string {
	return items.length ? items.join(", ") : "ninguno";
}
