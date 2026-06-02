import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
	getSourceLibraryStatus,
	readSourceLibraryItem,
	sourceLibraryPaths,
	type SourceLibraryItem,
	type SourceLibraryPaths,
} from "./source-library.js";

export type SourceDigestChunk = {
	chunkId: string;
	sourceId: string;
	path: string;
	startChar: number;
	endChar: number;
	summary: string;
	topics: string[];
	useWhen: string[];
	contractPromotionAllowed: false;
};

export type SourceDigest = {
	version: 1;
	projectId: string;
	sourceId: string;
	title: string;
	kind: SourceLibraryItem["kind"];
	generatedAt: string;
	processingMode: "direct" | "chunked" | "metadata_only";
	summary: string;
	topics: string[];
	useWhen: string[];
	chunks: SourceDigestChunk[];
	recommendedReads: string[];
	limitations: string[];
	contractPromotionAllowed: false;
};

export type SourceLibraryIndexEntry = {
	sourceId: string;
	title: string;
	kind: SourceLibraryItem["kind"];
	summary: string;
	topics: string[];
	useWhen: string[];
	recommendedReads: string[];
	generatedAt: string;
	contractPromotionAllowed: false;
};

export type SourceLibraryKnowledgeIndex = {
	version: 1;
	projectId: string;
	updatedAt: string;
	entries: SourceLibraryIndexEntry[];
	contractPromotionAllowed: false;
};

export type SourceDigestStatus = {
	projectId: string;
	paths: SourceLibraryPaths;
	digests: Array<{
		sourceId: string;
		title: string;
		status: "ready" | "missing";
		digestPath: string;
		contractPromotionAllowed: false;
	}>;
	libraryIndexExists: boolean;
	contractPromotionAllowed: false;
};

export type SourceChunkReadResult = {
	projectId: string;
	sourceId: string;
	chunkId: string;
	path: string;
	content: string;
	maxChars: number;
	truncated: boolean;
	contractPromotionAllowed: false;
};

export type SourceRecommendation = {
	sourceId: string;
	title: string;
	chunkIds: string[];
	whyRelevant: string;
	confidence: "low" | "medium" | "high";
	orchestratorInstruction: string;
	contractPromotionAllowed: false;
};

export type SourceRecommendationReport = {
	projectId: string;
	request: string;
	generatedAt: string;
	matches: SourceRecommendation[];
	missingKnowledge: string[];
	limitations: string[];
	contractPromotionAllowed: false;
};

export function createSourceDigest(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
	chunkChars?: number;
	overlapChars?: number;
	now?: () => Date;
}): SourceDigest {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const status = getSourceLibraryStatus({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
	});
	const source = status.sources.find(
		(item) => item.id === input.sourceId.trim(),
	);
	if (!source)
		throw new Error(`Fuente no encontrada en índice: ${input.sourceId}`);
	const read = readSourceLibraryItem({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		sourceId: source.id,
		maxChars: 50_000,
	});
	const sourceText = readDigestSourceText(paths, source);
	const generatedAt = (input.now?.() ?? new Date()).toISOString();
	const limitations = [...read.limitations, ...sourceText.limitations];
	const content = sourceText.content.trim();
	const chunkChars = boundedChunkChars(input.chunkChars);
	const overlapChars = boundedOverlap(input.overlapChars, chunkChars);
	const chunkRoot = assertInside(
		paths.chunksDir,
		join(paths.chunksDir, source.id),
	);
	rmSync(chunkRoot, { recursive: true, force: true });
	mkdirSync(chunkRoot, { recursive: true });
	mkdirSync(paths.digestsDir, { recursive: true });

	let chunks: SourceDigestChunk[] = [];
	let processingMode: SourceDigest["processingMode"] = "metadata_only";
	if (content) {
		const rawChunks = chunkText(content, chunkChars, overlapChars);
		processingMode = rawChunks.length > 1 ? "chunked" : "direct";
		chunks = rawChunks.map((chunk, index) => {
			const chunkId = `${source.id}-chunk-${String(index + 1).padStart(3, "0")}`;
			const path = assertInside(chunkRoot, join(chunkRoot, `${chunkId}.md`));
			const topics = extractTopics(chunk.content);
			const useWhen = useWhenForTopics(topics, source.title);
			writeFileSync(path, chunk.content, "utf8");
			return {
				chunkId,
				sourceId: source.id,
				path: relative(paths.root, path).replace(/\\/gu, "/"),
				startChar: chunk.startChar,
				endChar: chunk.endChar,
				summary: summarizeText(chunk.content),
				topics,
				useWhen,
				contractPromotionAllowed: false,
			};
		});
	} else {
		limitations.push(
			"Fuente sin texto legible para digest; registrar .md/.txt asociado o convertir manualmente.",
		);
	}
	const topics = unique([
		...extractTopics(`${source.title} ${content}`),
		...chunks.flatMap((chunk) => chunk.topics),
	]).slice(0, 12);
	const digest: SourceDigest = {
		version: 1,
		projectId: input.projectId,
		sourceId: source.id,
		title: source.title,
		kind: source.kind,
		generatedAt,
		processingMode,
		summary: content
			? summarizeText(content)
			: `${source.title}: metadata-only; sin contenido textual legible.`,
		topics,
		useWhen: useWhenForTopics(topics, source.title),
		chunks,
		recommendedReads: chunks.slice(0, 5).map((chunk) => chunk.chunkId),
		limitations: unique(limitations),
		contractPromotionAllowed: false,
	};
	writeDigest(paths, digest);
	updateLibraryIndex(paths, input.projectId, digest, generatedAt);
	return digest;
}

export function getSourceDigestStatus(input: {
	stateRoot: string;
	projectId: string;
}): SourceDigestStatus {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const status = getSourceLibraryStatus(input);
	return {
		projectId: input.projectId,
		paths,
		digests: status.sources.map((source) => {
			const digestPath = join(paths.digestsDir, `${source.id}.json`);
			return {
				sourceId: source.id,
				title: source.title,
				status: existsSync(digestPath) ? "ready" : "missing",
				digestPath: relative(paths.root, digestPath).replace(/\\/gu, "/"),
				contractPromotionAllowed: false,
			};
		}),
		libraryIndexExists: existsSync(paths.libraryIndexPath),
		contractPromotionAllowed: false,
	};
}

export function readSourceChunk(input: {
	stateRoot: string;
	projectId: string;
	sourceId: string;
	chunkId: string;
	maxChars?: number;
}): SourceChunkReadResult {
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const chunkRoot = assertInside(
		paths.chunksDir,
		join(paths.chunksDir, input.sourceId),
	);
	const chunkPath = assertInside(
		chunkRoot,
		join(chunkRoot, `${input.chunkId}.md`),
	);
	if (!existsSync(chunkPath))
		throw new Error(`Chunk no encontrado: ${input.chunkId}`);
	const maxChars = Math.max(
		1,
		Math.min(Math.floor(input.maxChars ?? 12_000), 50_000),
	);
	const content = readFileSync(chunkPath, "utf8");
	return {
		projectId: input.projectId,
		sourceId: input.sourceId,
		chunkId: input.chunkId,
		path: relative(paths.root, chunkPath).replace(/\\/gu, "/"),
		content: content.slice(0, maxChars),
		maxChars,
		truncated: content.length > maxChars,
		contractPromotionAllowed: false,
	};
}

export function recommendSourcesForTask(input: {
	stateRoot: string;
	projectId: string;
	request: string;
	maxMatches?: number;
	now?: () => Date;
}): SourceRecommendationReport {
	const request = input.request.trim();
	if (!request) throw new Error("request requerido para recomendar fuentes.");
	const paths = sourceLibraryPaths(input.stateRoot, input.projectId);
	const index = readLibraryIndex(paths, input.projectId);
	const terms = termsFor(request);
	const scored = index.entries
		.map((entry) => scoreEntry(entry, terms))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, Math.min(Math.floor(input.maxMatches ?? 5), 10)));
	return {
		projectId: input.projectId,
		request,
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		matches: scored.map(({ entry, score, matchedTerms }) => ({
			sourceId: entry.sourceId,
			title: entry.title,
			chunkIds: entry.recommendedReads,
			whyRelevant: `Coincide con ${matchedTerms.join(", ")} en índice bibliotecario.`,
			confidence: score >= 6 ? "high" : score >= 3 ? "medium" : "low",
			orchestratorInstruction: `Antes de implementar, mandá un scout/reviewer a leer ${entry.sourceId}${entry.recommendedReads.length ? ` chunks ${entry.recommendedReads.join(", ")}` : ""} y contrastar contra la tarea: ${request}`,
			contractPromotionAllowed: false,
		})),
		missingKnowledge: scored.length
			? []
			: ["No hay digest/index relevante para esta solicitud."],
		limitations: [
			"Recomendación advisory basada en digests locales; no consulta web/live sources y no aprueba contratos.",
		],
		contractPromotionAllowed: false,
	};
}

export function formatSourceDigest(digest: SourceDigest): string {
	return [
		"Idu-pi Source Digest",
		"",
		"Fuente:",
		`${digest.sourceId} (${digest.title})`,
		"",
		"Modo:",
		digest.processingMode,
		"",
		"Resumen:",
		digest.summary,
		"",
		"Topics:",
		...formatList(digest.topics),
		"",
		"Chunks:",
		...(digest.chunks.length
			? digest.chunks.map((chunk) => `- ${chunk.chunkId}: ${chunk.summary}`)
			: ["- ninguno"]),
		"",
		"Limitaciones:",
		...formatList(digest.limitations),
		"",
		"Nota segura:",
		"Digest advisory: no promueve contratos, no ejecuta AgentLabs y no consulta web/live.",
	].join("\n");
}

export function formatSourceDigestStatus(status: SourceDigestStatus): string {
	return [
		"Idu-pi Source Digest Status",
		"",
		"Library index:",
		status.libraryIndexExists ? "ready" : "missing",
		"",
		"Digests:",
		...(status.digests.length
			? status.digests.map((digest) => `- ${digest.sourceId}: ${digest.status}`)
			: ["- ninguno"]),
	].join("\n");
}

export function formatSourceChunkRead(result: SourceChunkReadResult): string {
	return [
		"Idu-pi Source Chunk Read",
		"",
		"Chunk:",
		`${result.sourceId}/${result.chunkId}`,
		"",
		"Path:",
		result.path,
		"",
		"Contenido:",
		result.content || "- sin contenido",
	].join("\n");
}

export function formatSourceRecommendationReport(
	report: SourceRecommendationReport,
): string {
	return [
		"Idu-pi Source Recommend For Task",
		"",
		"Solicitud:",
		report.request,
		"",
		"Matches:",
		...(report.matches.length
			? report.matches.map(
					(match) =>
						`- [${match.confidence}] ${match.sourceId}: ${match.whyRelevant}; leer ${match.chunkIds.join(", ") || "fuente"}`,
				)
			: ["- ninguno"]),
		"",
		"Missing knowledge:",
		...formatList(report.missingKnowledge),
		"",
		"Limitaciones:",
		...formatList(report.limitations),
	].join("\n");
}

function writeDigest(paths: SourceLibraryPaths, digest: SourceDigest): void {
	const target = assertInside(
		paths.digestsDir,
		join(paths.digestsDir, `${digest.sourceId}.json`),
	);
	writeFileSync(target, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
}

function updateLibraryIndex(
	paths: SourceLibraryPaths,
	projectId: string,
	digest: SourceDigest,
	updatedAt: string,
): void {
	const current = readLibraryIndex(paths, projectId);
	const entry: SourceLibraryIndexEntry = {
		sourceId: digest.sourceId,
		title: digest.title,
		kind: digest.kind,
		summary: digest.summary,
		topics: digest.topics,
		useWhen: digest.useWhen,
		recommendedReads: digest.recommendedReads,
		generatedAt: digest.generatedAt,
		contractPromotionAllowed: false,
	};
	const next: SourceLibraryKnowledgeIndex = {
		version: 1,
		projectId,
		updatedAt,
		entries: [
			...current.entries.filter((item) => item.sourceId !== digest.sourceId),
			entry,
		].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
		contractPromotionAllowed: false,
	};
	writeFileSync(
		paths.libraryIndexPath,
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
}

function readLibraryIndex(
	paths: SourceLibraryPaths,
	projectId: string,
): SourceLibraryKnowledgeIndex {
	if (!existsSync(paths.libraryIndexPath)) {
		return {
			version: 1,
			projectId,
			updatedAt: new Date(0).toISOString(),
			entries: [],
			contractPromotionAllowed: false,
		};
	}
	const value = JSON.parse(
		readFileSync(paths.libraryIndexPath, "utf8"),
	) as Partial<SourceLibraryKnowledgeIndex>;
	return {
		version: 1,
		projectId:
			typeof value.projectId === "string" ? value.projectId : projectId,
		updatedAt:
			typeof value.updatedAt === "string"
				? value.updatedAt
				: new Date(0).toISOString(),
		entries: Array.isArray(value.entries)
			? value.entries.filter((entry): entry is SourceLibraryIndexEntry =>
					Boolean(entry?.sourceId),
				)
			: [],
		contractPromotionAllowed: false,
	};
}

function readDigestSourceText(
	paths: SourceLibraryPaths,
	source: SourceLibraryItem,
): { content: string; limitations: string[] } {
	const relativePath = source.extractedTextPath ?? source.convertedTextPath;
	if (!relativePath) return { content: "", limitations: [] };
	const textPath = assertInside(paths.root, join(paths.root, relativePath));
	if (!existsSync(textPath)) {
		return {
			content: "",
			limitations: [`Texto legible no encontrado: ${relativePath}`],
		};
	}
	const content = readFileSync(textPath, "utf8");
	const maxDigestChars = 500_000;
	return {
		content: content.slice(0, maxDigestChars),
		limitations:
			content.length > maxDigestChars
				? [
						`Digest truncado a ${maxDigestChars} caracteres para mantener procesamiento acotado.`,
					]
				: [],
	};
}

function chunkText(
	content: string,
	chunkChars: number,
	overlapChars: number,
): Array<{ content: string; startChar: number; endChar: number }> {
	const chunks: Array<{ content: string; startChar: number; endChar: number }> =
		[];
	let start = 0;
	while (start < content.length) {
		const end = Math.min(content.length, start + chunkChars);
		chunks.push({
			content: content.slice(start, end),
			startChar: start,
			endChar: end,
		});
		if (end >= content.length) break;
		start = Math.max(end - overlapChars, start + 1);
	}
	return chunks;
}

function summarizeText(content: string): string {
	const normalized = content.replace(/\s+/gu, " ").trim();
	if (!normalized) return "Sin contenido legible.";
	return normalized.slice(0, 360) + (normalized.length > 360 ? "..." : "");
}

function extractTopics(content: string): string[] {
	const stop = new Set([
		"para",
		"with",
		"from",
		"that",
		"este",
		"esta",
		"como",
		"sobre",
		"documento",
		"source",
		"the",
		"and",
		"los",
		"las",
		"una",
		"por",
	]);
	const counts = new Map<string, number>();
	for (const term of termsFor(content)) {
		if (stop.has(term)) continue;
		counts.set(term, (counts.get(term) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 8)
		.map(([term]) => term);
}

function useWhenForTopics(topics: string[], title: string): string[] {
	const values = topics
		.slice(0, 5)
		.map((topic) => `cuando la tarea menciona ${topic}`);
	if (values.length === 0)
		values.push(`cuando la tarea requiera revisar ${title}`);
	return values;
}

function scoreEntry(
	entry: SourceLibraryIndexEntry,
	terms: string[],
): { entry: SourceLibraryIndexEntry; score: number; matchedTerms: string[] } {
	const haystack = [
		entry.title,
		entry.summary,
		...entry.topics,
		...entry.useWhen,
		...entry.recommendedReads,
	]
		.join(" ")
		.toLowerCase();
	const matchedTerms = terms.filter((term) => haystack.includes(term));
	let score = matchedTerms.length;
	for (const topic of entry.topics) if (terms.includes(topic)) score += 2;
	return { entry, score, matchedTerms: unique(matchedTerms) };
}

function termsFor(value: string): string[] {
	return unique(
		value
			.toLowerCase()
			.split(/[^\p{L}\p{N}_-]+/u)
			.map((term) => term.trim())
			.filter((term) => term.length >= 3),
	);
}

function boundedChunkChars(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 8_000;
	return Math.max(1_000, Math.min(Math.floor(value), 20_000));
}

function boundedOverlap(value: number | undefined, chunkChars: number): number {
	if (value === undefined || !Number.isFinite(value))
		return Math.min(500, Math.floor(chunkChars / 10));
	return Math.max(0, Math.min(Math.floor(value), Math.floor(chunkChars / 2)));
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function assertInside(root: string, target: string): string {
	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(target);
	const relativePath = relative(resolvedRoot, resolvedTarget);
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		resolve(relativePath) === relativePath
	) {
		throw new Error(`Ruta fuera de Source Digest: ${resolvedTarget}`);
	}
	return resolvedTarget;
}

function formatList(values: string[]): string[] {
	return values.length ? values.map((value) => `- ${value}`) : ["- ninguno"];
}
