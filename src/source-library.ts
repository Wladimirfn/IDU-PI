import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
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

export type SourceLibraryKind = "manual_doc" | "pdf" | "markdown" | "text";
export type SourceLibraryTrustLevel =
	| "manual"
	| "official"
	| "vendor"
	| "security_advisory"
	| "community";
export type SourceLibraryFreshnessPolicy =
	| "manual"
	| "daily"
	| "weekly"
	| "monthly";
export type SourceLibraryItemStatus = "ready" | "missing" | "stale";
export type SourceLibraryIndexState =
	| "missing"
	| "empty"
	| "ready"
	| "stale"
	| "invalid";

export type SourceLibraryItem = {
	id: string;
	title: string;
	kind: SourceLibraryKind;
	trustLevel: SourceLibraryTrustLevel;
	freshnessPolicy: SourceLibraryFreshnessPolicy;
	originalPath: string;
	storedPath: string;
	sha256: string;
	sizeBytes: number;
	status: SourceLibraryItemStatus;
	addedAt: string;
	lastCheckedAt: string;
	contractPromotionAllowed: false;
	extractedTextPath?: string;
	notes?: string;
};

export type SourceLibraryIndex = {
	version: 1;
	projectId: string;
	updatedAt: string;
	contractPromotionAllowed: false;
	sources: SourceLibraryItem[];
};

export type SourceLibraryPaths = {
	root: string;
	indexPath: string;
	localSourcesDir: string;
	extractedDir: string;
};

export type SourceLibraryStatus = {
	projectId: string;
	paths: SourceLibraryPaths;
	state: SourceLibraryIndexState;
	index?: SourceLibraryIndex;
	sources: SourceLibraryItem[];
	missingSources: string[];
	staleSources: string[];
	unindexedLocalFiles: string[];
	errors: string[];
	advisory: string;
};

export type AddSourceLibraryItemInput = {
	stateRoot: string;
	projectId: string;
	inputPath: string;
	title?: string;
	kind?: SourceLibraryKind;
	trustLevel?: SourceLibraryTrustLevel;
	freshnessPolicy?: SourceLibraryFreshnessPolicy;
	notes?: string;
	now?: () => Date;
};

export type SourceLibraryMutationResult = SourceLibraryStatus & {
	addedSource?: SourceLibraryItem;
};

export function safeDocProjectName(projectId: string): string {
	return (
		projectId
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/gu, "_")
			.replace(/^_+|_+$/gu, "") || "project"
	);
}

export function sourceLibraryPaths(
	stateRoot: string,
	projectId: string,
): SourceLibraryPaths {
	const root = resolve(stateRoot, "Doc", safeDocProjectName(projectId));
	return {
		root,
		indexPath: join(root, "source-index.json"),
		localSourcesDir: join(root, "sources", "local"),
		extractedDir: join(root, "sources", "extracted"),
	};
}

export function getSourceLibraryStatus(input: {
	stateRoot: string;
	projectId: string;
}): SourceLibraryStatus {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const errors: string[] = [];
	const unindexedLocalFiles = listLocalFiles(paths.localSourcesDir);
	if (!existsSync(paths.indexPath)) {
		return statusResult(
			input.projectId,
			paths,
			"missing",
			undefined,
			[],
			[],
			[],
			unindexedLocalFiles,
			[],
		);
	}
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok) {
		return statusResult(
			input.projectId,
			paths,
			"invalid",
			undefined,
			[],
			[],
			[],
			unindexedLocalFiles,
			parsed.errors,
		);
	}
	const refreshed = reconcileIndex(
		parsed.index,
		paths,
		input.projectId,
		new Date().toISOString(),
		false,
	);
	const missingSources = refreshed.sources
		.filter((source) => source.status === "missing")
		.map((source) => source.id);
	const staleSources = refreshed.sources
		.filter((source) => source.status === "stale")
		.map((source) => source.id);
	const state: SourceLibraryIndexState =
		refreshed.sources.length === 0
			? "empty"
			: missingSources.length > 0 || staleSources.length > 0
				? "stale"
				: "ready";
	return statusResult(
		input.projectId,
		paths,
		state,
		refreshed,
		refreshed.sources,
		missingSources,
		staleSources,
		unindexedLocalFiles,
		errors,
	);
}

export function addSourceLibraryItem(
	input: AddSourceLibraryItemInput,
): SourceLibraryMutationResult {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const sourcePath = resolve(input.inputPath);
	if (!existsSync(sourcePath))
		throw new Error(`Fuente no encontrada: ${sourcePath}`);
	const sourceStat = statSync(sourcePath);
	if (!sourceStat.isFile())
		throw new Error(`La fuente debe ser un archivo: ${sourcePath}`);
	const kind = input.kind ?? inferKind(sourcePath);
	if (!kind)
		throw new Error("Tipo de fuente no soportado; usá .md, .txt o .pdf.");
	const now = (input.now?.() ?? new Date()).toISOString();
	const sha256 = sha256File(sourcePath);
	const id = sourceId(input.projectId, sourcePath, sha256);
	const destinationName = `${id}-${sanitizeFileName(basename(sourcePath))}`;
	mkdirSync(paths.localSourcesDir, { recursive: true });
	mkdirSync(paths.extractedDir, { recursive: true });
	const destination = assertInside(
		paths.localSourcesDir,
		join(paths.localSourcesDir, destinationName),
	);
	copyFileSync(sourcePath, destination);
	const storedPath = relative(paths.root, destination).replace(/\\/gu, "/");
	const extractedTextPath = maybeWriteTextSnapshot({
		paths,
		id,
		sourcePath,
		kind,
	});
	const item: SourceLibraryItem = {
		id,
		title: input.title?.trim() || basename(sourcePath),
		kind,
		trustLevel: input.trustLevel ?? "manual",
		freshnessPolicy: input.freshnessPolicy ?? "manual",
		originalPath: sourcePath,
		storedPath,
		sha256,
		sizeBytes: sourceStat.size,
		status: "ready",
		addedAt: now,
		lastCheckedAt: now,
		contractPromotionAllowed: false,
		...(extractedTextPath ? { extractedTextPath } : {}),
		...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
	};
	const existing = loadOrCreateIndex(paths, input.projectId, now);
	const index: SourceLibraryIndex = {
		...existing,
		updatedAt: now,
		contractPromotionAllowed: false,
		sources: [...existing.sources.filter((source) => source.id !== id), item],
	};
	writeIndex(paths, index);
	return { ...getSourceLibraryStatus(input), addedSource: item };
}

export function refreshSourceLibrary(input: {
	stateRoot: string;
	projectId: string;
	now?: () => Date;
}): SourceLibraryStatus {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	if (!existsSync(paths.indexPath)) return getSourceLibraryStatus(input);
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok) return getSourceLibraryStatus(input);
	const now = (input.now?.() ?? new Date()).toISOString();
	const refreshed = reconcileIndex(
		parsed.index,
		paths,
		input.projectId,
		now,
		true,
	);
	writeIndex(paths, refreshed);
	return getSourceLibraryStatus(input);
}

export function formatSourceLibraryStatus(status: SourceLibraryStatus): string {
	return [
		"Idu-pi Source Library",
		"",
		"Estado:",
		status.state,
		"",
		"Source index:",
		status.paths.indexPath,
		"",
		"Sources:",
		...(status.sources.length
			? status.sources.map(
					(source) =>
						`- ${source.id} [${source.status}] ${source.title} (${source.kind}, ${source.trustLevel})`,
				)
			: ["- ninguna"]),
		"",
		"Missing:",
		...formatList(status.missingSources),
		"",
		"Stale:",
		...formatList(status.staleSources),
		"",
		"Errores:",
		...formatList(status.errors),
		"",
		"Nota segura:",
		status.advisory,
	].join("\n");
}

export function formatSourceLibraryAddResult(
	result: SourceLibraryMutationResult,
): string {
	return [
		"Idu-pi Source Library Add",
		"",
		"Agregada:",
		result.addedSource
			? `${result.addedSource.id} -> ${result.addedSource.storedPath}`
			: "- ninguna",
		"",
		formatSourceLibraryStatus(result),
	].join("\n");
}

export function formatSourceLibraryRefreshResult(
	result: SourceLibraryStatus,
): string {
	return [
		"Idu-pi Source Library Refresh",
		"",
		formatSourceLibraryStatus(result),
	].join("\n");
}

function statusResult(
	projectId: string,
	paths: SourceLibraryPaths,
	state: SourceLibraryIndexState,
	index: SourceLibraryIndex | undefined,
	sources: SourceLibraryItem[],
	missingSources: string[],
	staleSources: string[],
	unindexedLocalFiles: string[],
	errors: string[],
): SourceLibraryStatus {
	return {
		projectId,
		paths,
		state,
		...(index ? { index } : {}),
		sources,
		missingSources,
		staleSources,
		unindexedLocalFiles,
		errors,
		advisory:
			"Biblioteca de fuentes advisory: escribe sólo en stateRoot/Doc, no promueve contratos, no ejecuta AgentLabs ni toca el repo real.",
	};
}

function readIndex(
	path: string,
): { ok: true; index: SourceLibraryIndex } | { ok: false; errors: string[] } {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return validateIndex(value);
	} catch (error) {
		return {
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

function validateIndex(
	value: unknown,
): { ok: true; index: SourceLibraryIndex } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (!value || typeof value !== "object")
		return { ok: false, errors: ["source-index must be an object"] };
	const record = value as Record<string, unknown>;
	if (record.version !== 1) errors.push("version must be 1");
	if (typeof record.projectId !== "string" || !record.projectId.trim())
		errors.push("projectId is required");
	if (typeof record.updatedAt !== "string" || !record.updatedAt.trim())
		errors.push("updatedAt is required");
	if (record.contractPromotionAllowed !== false)
		errors.push("contractPromotionAllowed must be false");
	if (!Array.isArray(record.sources)) errors.push("sources must be an array");
	if (errors.length > 0) return { ok: false, errors };
	const sources: SourceLibraryItem[] = [];
	for (const [index, item] of (record.sources as unknown[]).entries()) {
		const result = validateItem(item, `sources[${index}]`);
		if (result.ok) sources.push(result.item);
		else errors.push(...result.errors);
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		index: {
			version: 1,
			projectId: record.projectId as string,
			updatedAt: record.updatedAt as string,
			contractPromotionAllowed: false,
			sources,
		},
	};
}

function validateItem(
	value: unknown,
	path: string,
): { ok: true; item: SourceLibraryItem } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (!value || typeof value !== "object")
		return { ok: false, errors: [`${path} must be an object`] };
	const record = value as Record<string, unknown>;
	const required = [
		"id",
		"title",
		"kind",
		"trustLevel",
		"freshnessPolicy",
		"originalPath",
		"storedPath",
		"sha256",
		"addedAt",
		"lastCheckedAt",
	];
	for (const key of required) {
		if (typeof record[key] !== "string" || !(record[key] as string).trim())
			errors.push(`${path}.${key} is required`);
	}
	if (typeof record.sizeBytes !== "number" || record.sizeBytes < 0)
		errors.push(`${path}.sizeBytes must be a non-negative number`);
	if (!["ready", "missing", "stale"].includes(String(record.status)))
		errors.push(`${path}.status is invalid`);
	if (record.contractPromotionAllowed !== false)
		errors.push(`${path}.contractPromotionAllowed must be false`);
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, item: record as SourceLibraryItem };
}

function loadOrCreateIndex(
	paths: SourceLibraryPaths,
	projectId: string,
	now: string,
): SourceLibraryIndex {
	if (!existsSync(paths.indexPath)) {
		return {
			version: 1,
			projectId,
			updatedAt: now,
			contractPromotionAllowed: false,
			sources: [],
		};
	}
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok)
		throw new Error(`source-index inválido: ${parsed.errors.join("; ")}`);
	return parsed.index;
}

function writeIndex(
	paths: SourceLibraryPaths,
	index: SourceLibraryIndex,
): void {
	mkdirSync(paths.root, { recursive: true });
	const target = assertInside(paths.root, paths.indexPath);
	writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function reconcileIndex(
	index: SourceLibraryIndex,
	paths: SourceLibraryPaths,
	projectId: string,
	now: string,
	updateCheckedAt: boolean,
): SourceLibraryIndex {
	return {
		version: 1,
		projectId: index.projectId || projectId,
		updatedAt: updateCheckedAt ? now : index.updatedAt,
		contractPromotionAllowed: false,
		sources: index.sources.map((source) =>
			reconcileItem(source, paths, now, updateCheckedAt),
		),
	};
}

function reconcileItem(
	item: SourceLibraryItem,
	paths: SourceLibraryPaths,
	now: string,
	updateCheckedAt: boolean,
): SourceLibraryItem {
	const stored = assertInside(paths.root, join(paths.root, item.storedPath));
	if (!existsSync(stored)) {
		return {
			...item,
			status: "missing",
			lastCheckedAt: updateCheckedAt ? now : item.lastCheckedAt,
			contractPromotionAllowed: false,
		};
	}
	const hash = sha256File(stored);
	const size = statSync(stored).size;
	return {
		...item,
		status: hash === item.sha256 && size === item.sizeBytes ? "ready" : "stale",
		lastCheckedAt: updateCheckedAt ? now : item.lastCheckedAt,
		contractPromotionAllowed: false,
	};
}

function maybeWriteTextSnapshot(input: {
	paths: SourceLibraryPaths;
	id: string;
	sourcePath: string;
	kind: SourceLibraryKind;
}): string | undefined {
	if (input.kind !== "markdown" && input.kind !== "text") return undefined;
	const text = readFileSync(input.sourcePath, "utf8");
	const target = assertInside(
		input.paths.extractedDir,
		join(input.paths.extractedDir, `${input.id}.txt`),
	);
	writeFileSync(target, text, "utf8");
	return relative(input.paths.root, target).replace(/\\/gu, "/");
}

function inferKind(path: string): SourceLibraryKind | undefined {
	const extension = extname(path).toLowerCase();
	if (extension === ".pdf") return "pdf";
	if (extension === ".md" || extension === ".markdown") return "markdown";
	if (extension === ".txt") return "text";
	return undefined;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceId(projectId: string, path: string, sha256: string): string {
	const slug =
		sanitizeFileName(basename(path, extname(path)))
			.toLowerCase()
			.slice(0, 40) || "source";
	return `source-${safeDocProjectName(projectId)}-${slug}-${sha256.slice(0, 12)}`;
}

function sanitizeFileName(value: string): string {
	return (
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/gu, "")
			.replace(/[^a-zA-Z0-9._-]+/gu, "-")
			.replace(/(?:^[-.]+|[-.]+$)/gu, "") || "source"
	);
}

function assertInside(root: string, target: string): string {
	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(target);
	const relativePath = relative(resolvedRoot, resolvedTarget);
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		throw new Error(`Ruta fuera de Source Library: ${resolvedTarget}`);
	}
	return resolvedTarget;
}

function listLocalFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listLocalFiles(path));
		if (entry.isFile()) files.push(path);
	}
	return files.sort();
}

function formatList(values: string[]): string[] {
	return values.length ? values.map((value) => `- ${value}`) : ["- ninguno"];
}
