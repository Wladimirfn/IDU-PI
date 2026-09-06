import {
	getSourceLibraryStatus,
	readSourceLibraryItem,
	type SourceLibraryItem,
} from "./source-library.js";

export type SourceResearchConfidence = "low" | "medium" | "high";

export type SourceResearchSignal = {
	sourceId: string;
	title: string;
	sourceKind: SourceLibraryItem["kind"];
	trustLevel: SourceLibraryItem["trustLevel"];
	freshness: string;
	evidence: string;
	citationPath: string;
	confidence: SourceResearchConfidence;
	contractPromotionAllowed: false;
};

export type SourceResearchReport = {
	projectId: string;
	query: string;
	generatedAt: string;
	searchedSourceIds: string[];
	signals: SourceResearchSignal[];
	limitations: string[];
	contractPromotionAllowed: false;
};

export type CreateSourceResearchReportInput = {
	stateRoot: string;
	projectId: string;
	query: string;
	sourceIds?: string[];
	maxSources?: number;
	maxCharsPerSource?: number;
	now?: () => Date;
};

export function createSourceResearchReport(
	input: CreateSourceResearchReportInput,
): SourceResearchReport {
	const query = input.query.trim();
	if (!query) throw new Error("query requerido para investigación de fuentes.");
	const terms = queryTerms(query);
	if (terms.length === 0)
		throw new Error("query debe incluir al menos un término de 3 caracteres.");
	const status = getSourceLibraryStatus({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
	});
	if (status.errors.length > 0) {
		throw new Error(`Source Library inválida: ${status.errors.join("; ")}`);
	}
	const allowedIds = new Set(
		input.sourceIds?.map((id) => id.trim()).filter(Boolean),
	);
	const maxSources = boundedMaxSources(input.maxSources);
	const candidates = status.sources
		.filter((source) => allowedIds.size === 0 || allowedIds.has(source.id))
		.slice(0, maxSources);
	const limitations: string[] = [];
	const signals: SourceResearchSignal[] = [];
	for (const source of candidates) {
		const read = readSourceLibraryItem({
			stateRoot: input.stateRoot,
			projectId: input.projectId,
			sourceId: source.id,
			maxChars: input.maxCharsPerSource,
		});
		limitations.push(
			...read.limitations.map((item) => `${source.id}: ${item}`),
		);
		if (!read.content.trim()) {
			limitations.push(`${source.id}: sin texto legible para investigar.`);
			continue;
		}
		const matches = matchingSnippets(read.content, terms);
		if (matches.length === 0) continue;
		for (const evidence of matches) {
			signals.push({
				sourceId: source.id,
				title: source.title,
				sourceKind: source.kind,
				trustLevel: source.trustLevel,
				freshness: source.lastCheckedAt,
				evidence,
				citationPath: read.citationPath,
				confidence: confidenceFor(source.trustLevel, evidence, terms),
				contractPromotionAllowed: false,
			});
		}
	}
	if (candidates.length === 0) {
		limitations.push("No hay fuentes registradas para el filtro solicitado.");
	}
	if (signals.length === 0) {
		limitations.push(
			"No se encontraron coincidencias textuales; no se infieren claims sin evidencia.",
		);
	}
	return {
		projectId: input.projectId,
		query,
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		searchedSourceIds: candidates.map((source) => source.id),
		signals,
		limitations: [...new Set(limitations)],
		contractPromotionAllowed: false,
	};
}

export function formatSourceResearchReport(
	report: SourceResearchReport,
): string {
	return [
		"Idu-pi Source Research Report",
		"",
		"Query:",
		report.query,
		"",
		"Signals:",
		...(report.signals.length
			? report.signals.map(
					(signal) =>
						`- [${signal.confidence}] ${signal.sourceId}: ${signal.evidence} (${signal.citationPath})`,
				)
			: ["- ninguno"]),
		"",
		"Limitaciones:",
		...(report.limitations.length
			? report.limitations.map((item) => `- ${item}`)
			: ["- ninguna"]),
		"",
		"Nota segura:",
		"Investigación advisory: no promueve contratos, no ejecuta AgentLabs y no consulta fuentes web/live.",
	].join("\n");
}

function queryTerms(query: string): string[] {
	return [
		...new Set(
			query
				.toLowerCase()
				.split(/[^\p{L}\p{N}_-]+/u)
				.map((term) => term.trim())
				.filter((term) => term.length >= 3),
		),
	];
}

function matchingSnippets(content: string, terms: string[]): string[] {
	const lower = content.toLowerCase();
	const snippets: string[] = [];
	for (const term of terms) {
		const index = lower.indexOf(term);
		if (index < 0) continue;
		const start = Math.max(0, index - 120);
		const end = Math.min(content.length, index + term.length + 180);
		snippets.push(content.slice(start, end).replace(/\s+/gu, " ").trim());
		if (snippets.length >= 3) break;
	}
	return [...new Set(snippets)];
}

function confidenceFor(
	trustLevel: SourceLibraryItem["trustLevel"],
	evidence: string,
	terms: string[],
): SourceResearchConfidence {
	const matchedTerms = terms.filter((term) =>
		evidence.toLowerCase().includes(term),
	).length;
	if (
		matchedTerms >= 2 &&
		["official", "vendor", "security_advisory"].includes(trustLevel)
	)
		return "high";
	if (matchedTerms >= 1) return "medium";
	return "low";
}

function boundedMaxSources(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(Math.floor(value), 20));
}
