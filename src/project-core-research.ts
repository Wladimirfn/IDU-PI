import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	formatProjectCoreForPrompt,
	loadProjectCore,
	type ProjectCore,
} from "./project-core.js";
import {
	formatBlueprintForPrompt,
	loadProjectBlueprint,
} from "./project-blueprint.js";
import { formatFlowsForPrompt, loadProjectFlows } from "./project-flows.js";

const PROJECT_CORE_RESEARCH_WARNING = "Borrador IA. No es fuente de verdad.";
const DRAFT_PREFIX = "project-core-research-draft-";
const DRAFT_SUFFIX = ".json";
const MAX_CONTEXT_FILE_BYTES = 48_000;
const MAX_CONTEXT_CHARS = 12_000;
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

type GenerateResearchDraft = (prompt: string) => Promise<string>;

export type ProjectCoreResearchRecommendations = {
	suggestedLanguages: string[];
	suggestedFrameworks: string[];
	suggestedDatabase: string[];
	suggestedAuthSecurity: string[];
	suggestedArchitecture: string[];
	suggestedDeployment: string[];
	scalabilityNotes: string[];
	maintainabilityNotes: string[];
	risks: string[];
	alternatives: string[];
	openQuestions: string[];
};

export type ProjectCoreResearchDraft = {
	generatedAt: string;
	projectPath: string;
	warning: string;
	sourceCoreStatus: string;
	validJson: boolean;
	recommendations?: ProjectCoreResearchRecommendations;
	rawOutput?: string;
};

export type ProjectCoreResearchOptions = {
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	generate: GenerateResearchDraft;
	now?: () => Date;
};

export type ProjectCoreResearchDraftResult =
	| {
			ok: true;
			path: string;
			validJson: boolean;
			warning: string;
	  }
	| { ok: false; error: string };

export type ProjectCoreResearchReview = {
	path: string;
	validDraft: boolean;
	hasRequiredWarning: boolean;
	validJson: boolean;
	hasRawOutput: boolean;
	recommendations: Partial<ProjectCoreResearchRecommendations>;
	risks: string[];
	openQuestions: string[];
	projectCoreFieldsToComplete: string[];
	errors: string[];
};

export function buildProjectCoreResearchPrompt(
	coreOrProjectPath: ProjectCore | string,
	context = "",
	stateRoot: string,
): string {
	// Slice 3/5: when the first arg is a string, it is the projectPath
	// (used to read README, package.json, docs, and flows). stateRoot is
	// required and is where loadProjectCore / safeBlueprint read from.
	// The `?? coreOrProjectPath` fallback that used to live here was dead
	// code AND a latent split-brain trap: a future caller passing the
	// wrong arg ordering would silently feed projectPath into
	// loadProjectCore. Removed; auditor verified stateRoot is required
	// on ProjectCoreResearchOptions and all callers pass it.
	const core =
		typeof coreOrProjectPath === "string"
			? loadProjectCore(stateRoot)
			: coreOrProjectPath;
	const safeContext =
		typeof coreOrProjectPath === "string"
			? collectSafeProjectCoreResearchContext(coreOrProjectPath, stateRoot)
			: context;
	return [
		"Generá un research draft para Project Core.",
		`Warning obligatorio: ${PROJECT_CORE_RESEARCH_WARNING}`,
		"Responder en JSON si es posible con la clave recommendations.",
		"No decidir por el humano. La IA propone; el humano confirma.",
		"Comparar mínimo 2 alternativas cuando aplique.",
		"Priorizar seguridad, mantenibilidad y escalabilidad según el Project Core.",
		"Declarar incertidumbres y preguntas abiertas.",
		"No inventar información que no esté en el repo o en el Project Core.",
		"Marcar preguntas que necesita hacer al humano.",
		"Estructura JSON esperada:",
		JSON.stringify({ recommendations: emptyRecommendations() }, null, 2),
		"Project Core:",
		formatProjectCoreForPrompt(core),
		"Contexto seguro del repo:",
		safeContext || "—",
	].join("\n\n");
}

export async function saveProjectCoreResearchDraft(
	options: ProjectCoreResearchOptions,
): Promise<ProjectCoreResearchDraftResult> {
	let rawOutput: string;
	try {
		rawOutput = await options.generate(
			buildProjectCoreResearchPrompt(
				options.projectPath,
				"",
				options.stateRoot,
			),
		);
	} catch (error) {
		return {
			ok: false,
			error: `No pude generar research draft Project Core: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	// Slice 3/5: loadProjectCore reads from stateRoot, not projectPath.
	const core = loadProjectCore(options.stateRoot);
	const parsed = parseJson(rawOutput);
	const recommendations = parsed.ok
		? extractRecommendations(parsed.value)
		: undefined;
	const generatedAt = (options.now ?? (() => new Date()))();
	const draft: ProjectCoreResearchDraft = {
		generatedAt: generatedAt.toISOString(),
		projectPath: options.projectPath,
		warning: PROJECT_CORE_RESEARCH_WARNING,
		sourceCoreStatus: core.status,
		validJson: parsed.ok && Boolean(recommendations),
		...(recommendations ? { recommendations } : { rawOutput }),
	};
	mkdirSync(options.reportsDir, { recursive: true });
	const path = join(
		options.reportsDir,
		`${DRAFT_PREFIX}${timestamp(generatedAt)}${DRAFT_SUFFIX}`,
	);
	writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
	return {
		ok: true,
		path,
		validJson: draft.validJson,
		warning: PROJECT_CORE_RESEARCH_WARNING,
	};
}

export function reviewProjectCoreResearchDraft(
	pathOrLatest: string,
	reportsDir: string,
): ProjectCoreResearchReview {
	const review: ProjectCoreResearchReview = {
		path: pathOrLatest,
		validDraft: false,
		hasRequiredWarning: false,
		validJson: false,
		hasRawOutput: false,
		recommendations: {},
		risks: [],
		openQuestions: [],
		projectCoreFieldsToComplete: [],
		errors: [],
	};
	const path = resolveDraftPath(pathOrLatest, reportsDir);
	if (!path) {
		review.errors.push("No encontré research draft Project Core en reports/.");
		return review;
	}
	review.path = path;
	let draft: ProjectCoreResearchDraft;
	try {
		draft = JSON.parse(readFileSync(path, "utf8")) as ProjectCoreResearchDraft;
	} catch (error) {
		review.errors.push(
			`No pude leer research draft: ${error instanceof Error ? error.message : String(error)}`,
		);
		return review;
	}
	review.hasRequiredWarning = draft.warning === PROJECT_CORE_RESEARCH_WARNING;
	review.validJson = draft.validJson === true && Boolean(draft.recommendations);
	review.hasRawOutput = typeof draft.rawOutput === "string";
	if (draft.recommendations) {
		review.recommendations = draft.recommendations;
		review.risks = draft.recommendations.risks ?? [];
		review.openQuestions = draft.recommendations.openQuestions ?? [];
		review.projectCoreFieldsToComplete = fieldsSuggestedBy(
			draft.recommendations,
		);
	}
	if (review.hasRawOutput) {
		review.errors.push(
			"La IA no entregó JSON válido; revisar rawOutput manualmente.",
		);
	}
	review.validDraft =
		review.hasRequiredWarning && (review.validJson || review.hasRawOutput);
	return review;
}

export function formatProjectCoreResearchDraft(
	result: ProjectCoreResearchDraftResult,
): string {
	if (!result.ok) return result.error;
	return [
		"Project Core research draft guardado",
		`Ruta: ${result.path}`,
		`Warning: ${result.warning}`,
		`JSON válido: ${result.validJson ? "sí" : "no, guardé rawOutput"}`,
		"No modifiqué config/project-core.json.",
		"No confirmé decisiones ni apliqué recomendaciones.",
	].join("\n");
}

export function formatProjectCoreResearchReview(
	review: ProjectCoreResearchReview,
): string {
	return [
		"Project Core research — revisión",
		`Ruta: ${review.path}`,
		`Warning existe: ${review.hasRequiredWarning ? "sí" : "no"}`,
		`JSON válido: ${review.validJson ? "sí" : "no"}`,
		`recomendaciones principales: ${listOrNone(mainRecommendations(review.recommendations))}`,
		`riesgos: ${listOrNone(review.risks)}`,
		`preguntas abiertas: ${listOrNone(review.openQuestions)}`,
		`campos Project Core a completar: ${listOrNone(review.projectCoreFieldsToComplete)}`,
		`errores: ${listOrNone(review.errors)}`,
		"Solo lectura: no escribí config/project-core.json.",
	].join("\n");
}

function collectSafeProjectCoreResearchContext(
	projectPath: string,
	stateRoot: string,
): string {
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
	parts.push("## project-blueprint\n" + safeBlueprint(stateRoot));
	parts.push("## project-flows\n" + safeFlows(projectPath));
	return clamp(parts.join("\n\n"), MAX_CONTEXT_CHARS);
}

function safeBlueprint(stateRoot: string): string {
	try {
		return formatBlueprintForPrompt(loadProjectBlueprint(stateRoot));
	} catch (error) {
		return `No pude leer project-blueprint: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function safeFlows(projectPath: string): string {
	try {
		return formatFlowsForPrompt(loadProjectFlows(projectPath));
	} catch (error) {
		return `No pude leer project-flows: ${error instanceof Error ? error.message : String(error)}`;
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

function extractRecommendations(
	value: unknown,
): ProjectCoreResearchRecommendations | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const source = asRecord(record.recommendations) ?? record;
	return {
		suggestedLanguages: readStringArray(source.suggestedLanguages),
		suggestedFrameworks: readStringArray(source.suggestedFrameworks),
		suggestedDatabase: readStringArray(source.suggestedDatabase),
		suggestedAuthSecurity: readStringArray(source.suggestedAuthSecurity),
		suggestedArchitecture: readStringArray(source.suggestedArchitecture),
		suggestedDeployment: readStringArray(source.suggestedDeployment),
		scalabilityNotes: readStringArray(source.scalabilityNotes),
		maintainabilityNotes: readStringArray(source.maintainabilityNotes),
		risks: readStringArray(source.risks),
		alternatives: readStringArray(source.alternatives),
		openQuestions: readStringArray(source.openQuestions),
	};
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter(
					(item): item is string =>
						typeof item === "string" && item.trim().length > 0,
				)
				.map((item) => item.trim())
		: [];
}

function fieldsSuggestedBy(
	recommendations: ProjectCoreResearchRecommendations,
): string[] {
	const fields: string[] = [];
	if (
		recommendations.suggestedLanguages.length ||
		recommendations.suggestedFrameworks.length
	)
		fields.push("preferredStack");
	if (recommendations.suggestedDatabase.length)
		fields.push("preferredStack/base de datos");
	if (recommendations.suggestedAuthSecurity.length)
		fields.push("securityLevel / dataSensitivity / humanDecisions");
	if (recommendations.suggestedArchitecture.length)
		fields.push("architectureStyle");
	if (recommendations.suggestedDeployment.length)
		fields.push("deploymentTarget");
	if (recommendations.risks.length) fields.push("assumptions / openQuestions");
	return fields;
}

function mainRecommendations(
	recommendations: Partial<ProjectCoreResearchRecommendations>,
): string[] {
	return [
		...(recommendations.suggestedLanguages ?? []),
		...(recommendations.suggestedFrameworks ?? []),
		...(recommendations.suggestedDatabase ?? []),
		...(recommendations.suggestedArchitecture ?? []),
		...(recommendations.suggestedDeployment ?? []),
	].slice(0, 8);
}

function resolveDraftPath(
	pathOrLatest: string,
	reportsDir: string,
): string | undefined {
	const requested = pathOrLatest.trim();
	if (requested === "latest") {
		if (!existsSync(reportsDir)) return undefined;
		return readdirSync(reportsDir)
			.filter(
				(entry) =>
					entry.startsWith(DRAFT_PREFIX) && entry.endsWith(DRAFT_SUFFIX),
			)
			.sort()
			.map((entry) => join(reportsDir, entry))
			.at(-1);
	}
	const candidate = resolve(requested);
	const reportsRoot = resolve(reportsDir);
	const relativeToReports = relative(reportsRoot, candidate);
	const isInsideReports =
		relativeToReports.length > 0 &&
		!relativeToReports.startsWith("..") &&
		!isAbsolute(relativeToReports);
	const filename = basename(candidate);
	if (
		!isInsideReports ||
		!filename.startsWith(DRAFT_PREFIX) ||
		!filename.endsWith(DRAFT_SUFFIX)
	) {
		return undefined;
	}
	return candidate;
}

function emptyRecommendations(): ProjectCoreResearchRecommendations {
	return {
		suggestedLanguages: [],
		suggestedFrameworks: [],
		suggestedDatabase: [],
		suggestedAuthSecurity: [],
		suggestedArchitecture: [],
		suggestedDeployment: [],
		scalabilityNotes: [],
		maintainabilityNotes: [],
		risks: [],
		alternatives: [],
		openQuestions: [],
	};
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
