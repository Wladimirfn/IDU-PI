import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { formatFlowsForPrompt, loadProjectFlows } from "./project-flows.js";
import {
	loadProjectBlueprint,
	formatBlueprintForPrompt,
} from "./project-blueprint.js";
import { formatProjectMapScan, scanProjectMap } from "./project-map-scanner.js";

const AI_PROJECT_DRAFT_WARNING = "Borrador IA. No es fuente de verdad.";

type AiDraftKind = "project-blueprint" | "project-flows";

type GenerateAiDraft = (prompt: string) => Promise<string>;

export type AiProjectDraftOptions = {
	projectPath: string;
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

type AiDraftFile = {
	generatedAt: string;
	projectPath: string;
	warning: string;
	validJson: boolean;
	proposal?: unknown;
	rawOutput?: string;
};

const MAX_CONTEXT_FILE_BYTES = 48_000;
const MAX_CONTEXT_CHARS = 12_000;
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

export async function createAiProjectBlueprintDraft(
	options: AiProjectDraftOptions,
): Promise<AiProjectDraftResult> {
	try {
		return await createAiProjectDraft({
			...options,
			kind: "project-blueprint",
			prompt: buildBlueprintPrompt(options.projectPath),
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
			prompt: buildFlowsPrompt(options.projectPath),
		});
	} catch (error) {
		return draftError("project-flows", error);
	}
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

function buildBlueprintPrompt(projectPath: string): string {
	return [
		"Generá una propuesta JSON para project-blueprint.",
		`Warning obligatorio: ${AI_PROJECT_DRAFT_WARNING}`,
		"Reglas: no aplicar cambios, no tratar la IA como fuente de verdad, no pedir secretos.",
		"Contexto seguro del proyecto:",
		collectSafeProjectSummary(projectPath),
		"Blueprint actual:",
		safeCurrentBlueprint(projectPath),
	].join("\n\n");
}

function buildFlowsPrompt(projectPath: string): string {
	const flows = loadProjectFlows(projectPath);
	const scan = scanProjectMap(projectPath, flows);
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

function safeCurrentBlueprint(projectPath: string): string {
	try {
		return formatBlueprintForPrompt(loadProjectBlueprint(projectPath));
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
