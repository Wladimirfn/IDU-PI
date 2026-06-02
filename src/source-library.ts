import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
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

export type SourceLibraryConversionStatus =
	| "converted"
	| "metadata_only"
	| "not_applicable";
export type SourceLibraryDigestStatus =
	| "pending"
	| "ready"
	| "stale"
	| "not_applicable";

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
	convertedTextPath?: string;
	conversionStatus?: SourceLibraryConversionStatus;
	conversionLimitations?: string[];
	digestStatus?: SourceLibraryDigestStatus;
	notes?: string;
};

export type SourceLibraryIndex = {
	version: 1;
	projectId: string;
	updatedAt: string;
	contractPromotionAllowed: false;
	sources: SourceLibraryItem[];
	[key: string]: unknown;
};

export type SourceLibraryPaths = {
	root: string;
	indexPath: string;
	libraryIndexPath: string;
	localSourcesDir: string;
	extractedDir: string;
	convertedDir: string;
	chunksDir: string;
	digestsDir: string;
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

export type SourceLibraryReadStatus =
	| "ready"
	| "metadata_only"
	| "missing"
	| "unsupported";
export type SourceLibraryExtractionStatus =
	| "extracted"
	| "metadata_only"
	| "missing"
	| "unsupported";

export type SourceLibraryReadResult = {
	projectId: string;
	paths: SourceLibraryPaths;
	source: SourceLibraryItem;
	readStatus: SourceLibraryReadStatus;
	content: string;
	maxChars: number;
	truncated: boolean;
	citationPath: string;
	limitations: string[];
	contractPromotionAllowed: false;
};

export type SourceLibraryExtractResult = SourceLibraryReadResult & {
	extractionStatus: SourceLibraryExtractionStatus;
	extractedTextPath?: string;
};

export type SourceLibraryItemReport = {
	projectId: string;
	paths: SourceLibraryPaths;
	source: SourceLibraryItem;
	extractedAvailable: boolean;
	extractionStatus: SourceLibraryExtractionStatus;
	citationPath: string;
	limitations: string[];
	contractPromotionAllowed: false;
};

export type RemoveSourceLibraryItemResult = SourceLibraryStatus & {
	removedSource?: SourceLibraryItem;
	removedFiles: string[];
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
		libraryIndexPath: join(root, "source-library-index.json"),
		localSourcesDir: join(root, "sources", "local"),
		extractedDir: join(root, "sources", "extracted"),
		convertedDir: join(root, "sources", "converted"),
		chunksDir: join(root, "sources", "chunks"),
		digestsDir: join(root, "sources", "digests"),
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
		unindexedFiles(paths, refreshed.sources, unindexedLocalFiles),
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
	mkdirSync(paths.convertedDir, { recursive: true });
	mkdirSync(paths.chunksDir, { recursive: true });
	mkdirSync(paths.digestsDir, { recursive: true });
	const destination = assertInside(
		paths.localSourcesDir,
		join(paths.localSourcesDir, destinationName),
	);
	copyFileSync(sourcePath, destination);
	const storedPath = relative(paths.root, destination).replace(/\\/gu, "/");
	const conversion = maybeConvertSourceToReadableText({
		paths,
		id,
		sourcePath,
		kind,
		title: input.title?.trim() || basename(sourcePath),
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
		...(conversion.extractedTextPath
			? { extractedTextPath: conversion.extractedTextPath }
			: {}),
		...(conversion.convertedTextPath
			? { convertedTextPath: conversion.convertedTextPath }
			: {}),
		conversionStatus: conversion.conversionStatus,
		conversionLimitations: conversion.conversionLimitations,
		digestStatus:
			conversion.extractedTextPath || conversion.convertedTextPath
				? "pending"
				: "not_applicable",
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

export function removeSourceLibraryItem(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
	now?: () => Date;
}): RemoveSourceLibraryItemResult {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	if (!existsSync(paths.indexPath)) {
		throw new Error("Source Library no existe; no hay fuentes para remover.");
	}
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok) {
		throw new Error(`source-index inválido: ${parsed.errors.join("; ")}`);
	}
	const sourceId = input.sourceId.trim();
	if (!sourceId) throw new Error("sourceId requerido para remover fuente.");
	const source = parsed.index.sources.find((item) => item.id === sourceId);
	if (!source) throw new Error(`Fuente no encontrada en índice: ${sourceId}`);
	const removedFiles = removeSourceFiles(paths, source);
	const now = (input.now?.() ?? new Date()).toISOString();
	writeIndex(paths, {
		...parsed.index,
		updatedAt: now,
		contractPromotionAllowed: false,
		sources: parsed.index.sources.filter((item) => item.id !== sourceId),
	});
	return {
		...getSourceLibraryStatus(input),
		removedSource: source,
		removedFiles,
	};
}

export function readSourceLibraryItem(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
	maxChars?: number;
}): SourceLibraryReadResult {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const source = findSource(paths, input.sourceId);
	const maxChars = boundedMaxChars(input.maxChars);
	const limitations: string[] = [];
	const stored = assertInside(paths.root, join(paths.root, source.storedPath));
	if (!existsSync(stored)) {
		return sourceReadResult({
			projectId: input.projectId,
			paths,
			source,
			readStatus: "missing",
			content: "",
			maxChars,
			truncated: false,
			citationPath: source.storedPath,
			limitations: ["Fuente registrada no encontrada en Source Library."],
		});
	}
	if (source.extractedTextPath) {
		const extracted = assertInside(
			paths.root,
			join(paths.root, source.extractedTextPath),
		);
		if (existsSync(extracted)) {
			const read = readBoundedUtf8(extracted, maxChars);
			return sourceReadResult({
				projectId: input.projectId,
				paths,
				source,
				readStatus: "ready",
				content: read.content,
				maxChars,
				truncated: read.truncated,
				citationPath: source.extractedTextPath,
				limitations: read.truncated
					? ["Contenido truncado por límite de lectura."]
					: [],
			});
		}
		limitations.push(
			"Snapshot extraído registrado no existe en Source Library.",
		);
	}
	if (source.convertedTextPath) {
		const converted = assertInside(
			paths.root,
			join(paths.root, source.convertedTextPath),
		);
		if (existsSync(converted)) {
			const read = readBoundedUtf8(converted, maxChars);
			return sourceReadResult({
				projectId: input.projectId,
				paths,
				source,
				readStatus: "ready",
				content: read.content,
				maxChars,
				truncated: read.truncated,
				citationPath: source.convertedTextPath,
				limitations: read.truncated
					? [
							...limitations,
							"Contenido convertido truncado por límite de lectura.",
						]
					: limitations,
			});
		}
		limitations.push(
			"Markdown convertido registrado no existe en Source Library.",
		);
	}
	if (isTextReadableKind(source.kind)) {
		const read = readBoundedUtf8(stored, maxChars);
		return sourceReadResult({
			projectId: input.projectId,
			paths,
			source,
			readStatus: "ready",
			content: read.content,
			maxChars,
			truncated: read.truncated,
			citationPath: source.storedPath,
			limitations: read.truncated
				? [...limitations, "Contenido truncado por límite de lectura."]
				: limitations,
		});
	}
	return sourceReadResult({
		projectId: input.projectId,
		paths,
		source,
		readStatus: "metadata_only",
		content: "",
		maxChars,
		truncated: false,
		citationPath: source.storedPath,
		limitations: [
			...limitations,
			...(source.conversionLimitations?.length
				? source.conversionLimitations
				: [
						"PDF registrado como binario; sin texto embebido legible. No se ejecutó OCR ni parser pesado.",
					]),
		],
	});
}

export function extractSourceLibraryItem(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
	maxChars?: number;
	now?: () => Date;
}): SourceLibraryExtractResult {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const source = findSource(paths, input.sourceId);
	if (source.kind === "pdf") {
		const read = readSourceLibraryItem(input);
		return {
			...read,
			extractionStatus:
				read.readStatus === "ready" ? "extracted" : "metadata_only",
			extractedTextPath: source.extractedTextPath,
		};
	}
	if (!isTextReadableKind(source.kind)) {
		return {
			...readSourceLibraryItem(input),
			extractionStatus: "unsupported",
		};
	}
	const stored = assertInside(paths.root, join(paths.root, source.storedPath));
	if (!existsSync(stored)) {
		return {
			...readSourceLibraryItem(input),
			extractionStatus: "missing",
		};
	}
	mkdirSync(paths.extractedDir, { recursive: true });
	const maxChars = boundedMaxChars(input.maxChars);
	const read = readBoundedUtf8(stored, maxChars);
	const target = assertInside(
		paths.extractedDir,
		join(paths.extractedDir, `${source.id}.txt`),
	);
	writeFileSync(target, read.content, "utf8");
	const extractedTextPath = relative(paths.root, target).replace(/\\/gu, "/");
	const now = (input.now?.() ?? new Date()).toISOString();
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok)
		throw new Error(`source-index inválido: ${parsed.errors.join("; ")}`);
	writeIndex(paths, {
		...parsed.index,
		updatedAt: now,
		contractPromotionAllowed: false,
		sources: parsed.index.sources.map((item) =>
			item.id === source.id
				? { ...item, extractedTextPath, lastCheckedAt: now }
				: item,
		),
	});
	const result = readSourceLibraryItem({ ...input, maxChars });
	return {
		...result,
		extractionStatus: "extracted",
		extractedTextPath,
		limitations: read.truncated
			? ["Extracción truncada por límite de lectura."]
			: result.limitations,
	};
}

export function reportSourceLibraryItem(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
}): SourceLibraryItemReport {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const source = findSource(paths, input.sourceId);
	const extractedAvailable = Boolean(
		(source.extractedTextPath &&
			existsSync(
				assertInside(paths.root, join(paths.root, source.extractedTextPath)),
			)) ||
			(source.convertedTextPath &&
				existsSync(
					assertInside(paths.root, join(paths.root, source.convertedTextPath)),
				)),
	);
	const read = readSourceLibraryItem({ ...input, maxChars: 1_000 });
	return {
		projectId: input.projectId,
		paths,
		source,
		extractedAvailable,
		extractionStatus:
			source.kind === "pdf"
				? extractedAvailable
					? "extracted"
					: "metadata_only"
				: extractedAvailable
					? "extracted"
					: read.readStatus === "missing"
						? "missing"
						: "unsupported",
		citationPath: read.citationPath,
		limitations: read.limitations,
		contractPromotionAllowed: false,
	};
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

export function formatSourceLibraryRemoveResult(
	result: RemoveSourceLibraryItemResult,
): string {
	return [
		"Idu-pi Source Library Remove",
		"",
		"Removida:",
		result.removedSource
			? `${result.removedSource.id} -> ${result.removedSource.storedPath}`
			: "- ninguna",
		"",
		"Archivos removidos:",
		...formatList(result.removedFiles),
		"",
		formatSourceLibraryStatus(result),
	].join("\n");
}

export function formatSourceLibraryReadResult(
	result: SourceLibraryReadResult,
): string {
	return [
		"Idu-pi Source Library Read",
		"",
		"Fuente:",
		`${result.source.id} (${result.source.title})`,
		"",
		"Estado:",
		result.readStatus,
		"",
		"Citation:",
		result.citationPath,
		"",
		"Limitaciones:",
		...formatList(result.limitations),
		"",
		"Contenido:",
		result.content || "- sin contenido legible en este MVP",
	].join("\n");
}

export function formatSourceLibraryExtractResult(
	result: SourceLibraryExtractResult,
): string {
	return [
		"Idu-pi Source Library Extract",
		"",
		"Fuente:",
		`${result.source.id} (${result.source.title})`,
		"",
		"Estado extracción:",
		result.extractionStatus,
		"",
		"Extracted path:",
		result.extractedTextPath ?? "- ninguno",
		"",
		"Limitaciones:",
		...formatList(result.limitations),
	].join("\n");
}

export function formatSourceLibraryItemReport(
	result: SourceLibraryItemReport,
): string {
	return [
		"Idu-pi Source Library Report",
		"",
		"Fuente:",
		`${result.source.id} (${result.source.title})`,
		"",
		"Kind:",
		result.source.kind,
		"",
		"Status:",
		result.source.status,
		"",
		"SHA-256:",
		result.source.sha256,
		"",
		"Extracción:",
		result.extractionStatus,
		"",
		"Limitaciones:",
		...formatList(result.limitations),
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

function findSource(
	paths: SourceLibraryPaths,
	sourceId: string,
): SourceLibraryItem {
	const parsed = readIndex(paths.indexPath);
	if (!parsed.ok)
		throw new Error(`source-index inválido: ${parsed.errors.join("; ")}`);
	const cleanId = sourceId.trim();
	if (!cleanId) throw new Error("sourceId requerido.");
	const source = parsed.index.sources.find((item) => item.id === cleanId);
	if (!source) throw new Error(`Fuente no encontrada en índice: ${cleanId}`);
	return source;
}

function sourceReadResult(input: {
	projectId: string;
	paths: SourceLibraryPaths;
	source: SourceLibraryItem;
	readStatus: SourceLibraryReadStatus;
	content: string;
	maxChars: number;
	truncated: boolean;
	citationPath: string;
	limitations: string[];
}): SourceLibraryReadResult {
	return { ...input, contractPromotionAllowed: false };
}

function boundedMaxChars(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 12_000;
	return Math.max(1, Math.min(Math.floor(value), 50_000));
}

function readBoundedUtf8(
	path: string,
	maxChars: number,
): { content: string; truncated: boolean } {
	const content = readFileSync(path, "utf8");
	return {
		content: content.slice(0, maxChars),
		truncated: content.length > maxChars,
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
	const hasLegacySources =
		Array.isArray(record.localSources) ||
		Array.isArray(record.externalLiveSources);
	if (record.contractPromotionAllowed !== false && !hasLegacySources)
		errors.push("contractPromotionAllowed must be false");
	if (!Array.isArray(record.sources) && !hasLegacySources)
		errors.push("sources must be an array");
	if (errors.length > 0) return { ok: false, errors };
	const sources: SourceLibraryItem[] = [];
	for (const [index, item] of (Array.isArray(record.sources)
		? record.sources
		: []
	).entries()) {
		const result = validateItem(item, `sources[${index}]`);
		if (result.ok) sources.push(result.item);
		else errors.push(...result.errors);
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		index: {
			...record,
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

function removeSourceFiles(
	paths: SourceLibraryPaths,
	source: SourceLibraryItem,
): string[] {
	const removed: string[] = [];
	for (const relativePath of [
		source.storedPath,
		source.extractedTextPath,
		source.convertedTextPath,
	]) {
		if (!relativePath) continue;
		const target = assertInside(paths.root, join(paths.root, relativePath));
		if (!existsSync(target)) continue;
		rmSync(target, { force: true });
		removed.push(relative(paths.root, target).replace(/\\/gu, "/"));
	}
	return removed;
}

function maybeConvertSourceToReadableText(input: {
	paths: SourceLibraryPaths;
	id: string;
	sourcePath: string;
	kind: SourceLibraryKind;
	title: string;
}): {
	extractedTextPath?: string;
	convertedTextPath?: string;
	conversionStatus: SourceLibraryConversionStatus;
	conversionLimitations: string[];
} {
	if (isTextReadableKind(input.kind)) {
		const text = readFileSync(input.sourcePath, "utf8");
		const target = assertInside(
			input.paths.extractedDir,
			join(input.paths.extractedDir, `${input.id}.txt`),
		);
		writeFileSync(target, text, "utf8");
		return {
			extractedTextPath: relative(input.paths.root, target).replace(
				/\\/gu,
				"/",
			),
			conversionStatus: "not_applicable",
			conversionLimitations: [],
		};
	}
	if (input.kind !== "pdf") {
		return {
			conversionStatus: "metadata_only",
			conversionLimitations: ["Tipo de fuente no legible en este MVP."],
		};
	}
	const extracted = extractEmbeddedPdfText(input.sourcePath);
	if (!extracted.trim()) {
		return {
			conversionStatus: "metadata_only",
			conversionLimitations: [
				"PDF sin texto embebido legible; queda metadata_only/pending_conversion. No se ejecutó OCR ni parser pesado.",
			],
		};
	}
	const markdown = [`# ${input.title}`, "", extracted.trim(), ""].join("\n");
	const convertedTarget = assertInside(
		input.paths.convertedDir,
		join(input.paths.convertedDir, `${input.id}.md`),
	);
	writeFileSync(convertedTarget, markdown, "utf8");
	return {
		convertedTextPath: relative(input.paths.root, convertedTarget).replace(
			/\\/gu,
			"/",
		),
		conversionStatus: "converted",
		conversionLimitations: [
			"Conversión PDF best-effort desde texto embebido; sin OCR ni dependencias nuevas.",
		],
	};
}

function extractEmbeddedPdfText(path: string): string {
	const latin = readFileSync(path).toString("latin1");
	const snippets: string[] = [];
	for (const objectMatch of latin.matchAll(/\bBT\b[\s\S]{0,20000}?\bET\b/gu)) {
		const object = objectMatch[0];
		for (const match of object.matchAll(/\((?:\\.|[^\\)]){3,}\)/gu)) {
			const text = decodePdfLiteral(match[0].slice(1, -1));
			if (isReadableSnippet(text)) snippets.push(text);
		}
		for (const match of object.matchAll(/<([0-9A-Fa-f]{8,})>/gu)) {
			const text = decodePdfHex(match[1]);
			if (isReadableSnippet(text)) snippets.push(text);
		}
	}
	return [...new Set(snippets)]
		.join("\n")
		.replace(/[ \t]+/gu, " ")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

function decodePdfLiteral(value: string): string {
	return value
		.replace(/\\n/gu, "\n")
		.replace(/\\r/gu, "\n")
		.replace(/\\t/gu, "\t")
		.replace(/\\([()\\])/gu, "$1")
		.replace(/\\[0-7]{1,3}/gu, (match) =>
			String.fromCharCode(Number.parseInt(match.slice(1), 8)),
		);
}

function decodePdfHex(value: string): string {
	const bytes = value.match(/../gu) ?? [];
	return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 16))).toString(
		"utf8",
	);
}

function isReadableSnippet(value: string): boolean {
	const text = value.replace(/\s+/gu, " ").trim();
	if (text.length < 3) return false;
	const chars = [...text];
	const controls = chars.filter((char) =>
		/[\u0000-\u001f\u007f-\u009f]/u.test(char),
	).length;
	if (controls > 0) return false;
	const safePrintable = chars.filter((char) =>
		/[\p{L}\p{N}\s.,;:!?¿¡()[\]{}'"/@#%&+_\-=–—áéíóúÁÉÍÓÚñÑüÜ]/u.test(char),
	).length;
	const letters = chars.filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
	return safePrintable / chars.length >= 0.9 && letters / chars.length >= 0.35;
}

function isTextReadableKind(kind: SourceLibraryKind): boolean {
	return kind === "markdown" || kind === "text" || kind === "manual_doc";
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

function unindexedFiles(
	paths: SourceLibraryPaths,
	sources: SourceLibraryItem[],
	localFiles: string[],
): string[] {
	const indexed = new Set(
		sources.map((source) =>
			assertInside(paths.root, join(paths.root, source.storedPath)),
		),
	);
	return localFiles.filter((file) => !indexed.has(resolve(file)));
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
