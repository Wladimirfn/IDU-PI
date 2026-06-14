import {
	buildBibliotecarioEvidencePolicy,
	policyForSourceRecommendation,
	type BibliotecarioCanonicality,
	type BibliotecarioClaimType,
	type BibliotecarioEvidencePolicy,
	type BibliotecarioEvidenceRole,
} from "./bibliotecario-evidence-policy.js";

export type ExternalSourceRegistryVersion = 1;

export type ExternalSourceCategory =
	| "official_docs"
	| "academic_discovery"
	| "community_signal"
	| "blocked_or_manual";

export type ExternalSourceDomain =
	| "programming_structure"
	| "code_architecture"
	| "language_conventions"
	| "separation_of_concerns"
	| "security"
	| "civil_works"
	| "web"
	| "database"
	| "cloud"
	| "ai_agents"
	| "project_similarity"
	| "standards"
	| "academic";

export type ExternalSourceTrustLevel =
	| "official"
	| "standards_body"
	| "vendor"
	| "academic_index"
	| "preprint"
	| "community"
	| "manual_or_blocked";

export type ExternalSourceAutomationMode =
	| "no_fetch_registry_only"
	| "manual_visit_required"
	| "public_metadata_api_possible_future"
	| "blocked_no_automation";

export type ExternalSourceQuality = {
	evidenceStrength: "low" | "medium" | "high";
	freshnessSignal: "stable" | "live" | "manual";
	biasRisk: "low" | "medium" | "high";
	requiresHumanVerification: boolean;
};

export type ExternalSourceDescriptor = {
	id: string;
	name: string;
	category: ExternalSourceCategory;
	domains: ExternalSourceDomain[];
	languages?: string[];
	frameworks?: string[];
	url?: string;
	useWhen: string[];
	avoidWhen: string[];
	trustLevel: ExternalSourceTrustLevel;
	quality: ExternalSourceQuality;
	automationMode: ExternalSourceAutomationMode;
	advisoryOnly: true;
	fetchAllowed: boolean;
	rawDocsStored: false;
	promotionAllowed: false;
	agentLabAutoRunAllowed: false;
	notes?: string;
};

export type ExternalSourceRegistry = {
	version: ExternalSourceRegistryVersion;
	updatedAt: string;
	categories: ExternalSourceCategory[];
	domains: ExternalSourceDomain[];
	sources: ExternalSourceDescriptor[];
	safety: {
		advisoryOnly: true;
		fetchAllowed: boolean;
		rawDocsStored: false;
		promotionAllowed: false;
		agentLabAutoRunAllowed: false;
	};
};

export type ExternalSourceRegistryRecommendation = {
	sourceId: string;
	name: string;
	category: ExternalSourceCategory;
	domains: ExternalSourceDomain[];
	whyRelevant: string;
	confidence: "low" | "medium" | "high";
	automationMode: ExternalSourceAutomationMode;
	orchestratorInstruction: string;
	promotionAllowed: false;
	claimType: BibliotecarioClaimType;
	evidenceRole: BibliotecarioEvidenceRole;
	canonicality: BibliotecarioCanonicality;
	requiresCorroboration: boolean;
	forbiddenAsSoleAuthority: boolean;
	policyWarnings: string[];
};

export type ExternalSourceRecommendationReport = {
	version: 1;
	projectId: string;
	request: string;
	generatedAt: string;
	filters: {
		domains?: ExternalSourceDomain[];
		language?: string;
		framework?: string;
	};
	matches: ExternalSourceRegistryRecommendation[];
	evidencePolicy: BibliotecarioEvidencePolicy;
	missingKnowledge: string[];
	limitations: string[];
	advisoryOnly: true;
	fetchAllowed: boolean;
	rawDocsStored: false;
	promotionAllowed: false;
	agentLabAutoRunAllowed: false;
};

const CATEGORIES: ExternalSourceCategory[] = [
	"official_docs",
	"academic_discovery",
	"community_signal",
	"blocked_or_manual",
];

const DOMAINS: ExternalSourceDomain[] = [
	"programming_structure",
	"code_architecture",
	"language_conventions",
	"separation_of_concerns",
	"security",
	"civil_works",
	"web",
	"database",
	"cloud",
	"ai_agents",
	"project_similarity",
	"standards",
	"academic",
];

const SAFE = {
	advisoryOnly: true,
	fetchAllowed: false,
	rawDocsStored: false,
	promotionAllowed: false,
	agentLabAutoRunAllowed: false,
} as const;

const highOfficial: ExternalSourceQuality = {
	evidenceStrength: "high",
	freshnessSignal: "stable",
	biasRisk: "low",
	requiresHumanVerification: false,
};

const liveOfficial: ExternalSourceQuality = {
	evidenceStrength: "high",
	freshnessSignal: "live",
	biasRisk: "low",
	requiresHumanVerification: false,
};

const academicQuality: ExternalSourceQuality = {
	evidenceStrength: "medium",
	freshnessSignal: "live",
	biasRisk: "medium",
	requiresHumanVerification: true,
};

const communityQuality: ExternalSourceQuality = {
	evidenceStrength: "low",
	freshnessSignal: "live",
	biasRisk: "high",
	requiresHumanVerification: true,
};

const manualBlockedQuality: ExternalSourceQuality = {
	evidenceStrength: "medium",
	freshnessSignal: "manual",
	biasRisk: "medium",
	requiresHumanVerification: true,
};

const SOURCES: ExternalSourceDescriptor[] = [
	descriptor({
		id: "iso-obp",
		name: "ISO Online Browsing Platform",
		category: "official_docs",
		domains: ["standards", "security", "civil_works"],
		url: "https://www.iso.org/obp/ui",
		trustLevel: "standards_body",
		quality: highOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"ISO terms",
			"standards discovery",
			"civil works standards",
			"security terminology",
		],
		avoidWhen: [
			"copying licensed standards",
			"treating terms as implementation contracts",
		],
		notes:
			"Use as official terminology/standards discovery; do not copy licensed standard text.",
	}),
	descriptor({
		id: "aenor-search",
		name: "AENOR Search",
		category: "official_docs",
		domains: ["standards", "civil_works", "security"],
		url: "https://www.aenor.com/buscador",
		trustLevel: "standards_body",
		quality: highOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"Spanish standards discovery",
			"civil works standards",
			"ISO/UNE references",
		],
		avoidWhen: ["automated scraping", "paywalled/licensed content copying"],
	}),
	descriptor({
		id: "ibm-cloud-docs",
		name: "IBM Cloud Docs",
		category: "official_docs",
		domains: ["cloud", "database", "security", "ai_agents"],
		url: "https://cloud.ibm.com/docs",
		trustLevel: "vendor",
		quality: liveOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"IBM Cloud architecture",
			"cloud security",
			"database services",
			"AI/cloud feasibility",
		],
		avoidWhen: ["non-IBM stacks unless used as comparative reference"],
	}),
	descriptor({
		id: "mdn-html-structure",
		name: "MDN HTML Structure and Semantics",
		category: "official_docs",
		domains: [
			"web",
			"programming_structure",
			"language_conventions",
			"separation_of_concerns",
		],
		languages: ["html"],
		url: "https://developer.mozilla.org/",
		trustLevel: "official",
		quality: highOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"HTML semantics",
			"HTML sin JavaScript embebido",
			"avoid inline onclick",
			"separate structure events services",
		],
		avoidWhen: ["framework-specific server/client boundaries"],
		notes:
			"Preferred structure signal for HTML: HTML expresses semantics; JS behavior lives in modules/services.",
	}),
	descriptor({
		id: "typescript-handbook",
		name: "TypeScript Handbook",
		category: "official_docs",
		domains: [
			"programming_structure",
			"language_conventions",
			"code_architecture",
			"web",
		],
		languages: ["typescript", "javascript"],
		url: "https://www.typescriptlang.org/docs/",
		trustLevel: "official",
		quality: highOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"TypeScript module boundaries",
			"typed APIs",
			"project structure",
			"validation types",
		],
		avoidWhen: ["runtime framework behavior without framework docs"],
	}),
	descriptor({
		id: "nextjs-docs",
		name: "Next.js Docs",
		category: "official_docs",
		domains: [
			"web",
			"programming_structure",
			"code_architecture",
			"separation_of_concerns",
		],
		languages: ["typescript", "javascript"],
		frameworks: ["nextjs", "react"],
		url: "https://nextjs.org/docs",
		trustLevel: "official",
		quality: liveOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"Next.js routing",
			"app folder",
			"server client boundary",
			"project structure",
			"data fetching",
		],
		avoidWhen: ["generic backend architecture without Next.js"],
	}),
	descriptor({
		id: "nodejs-docs",
		name: "Node.js Docs",
		category: "official_docs",
		domains: ["programming_structure", "code_architecture", "security", "web"],
		languages: ["javascript", "typescript"],
		frameworks: ["node", "nodejs"],
		url: "https://nodejs.org/docs/latest/api/",
		trustLevel: "official",
		quality: liveOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"Node.js runtime behavior",
			"service boundaries",
			"security controls",
			"package scripts",
		],
		avoidWhen: ["browser-only behavior"],
	}),
	descriptor({
		id: "postgresql-docs",
		name: "PostgreSQL Docs",
		category: "official_docs",
		domains: ["database", "security", "programming_structure"],
		url: "https://www.postgresql.org/docs/",
		trustLevel: "official",
		quality: highOfficial,
		automationMode: "manual_visit_required",
		useWhen: [
			"database schema",
			"indexes",
			"constraints",
			"migrations",
			"permissions",
		],
		avoidWhen: ["NoSQL-specific modeling"],
	}),
	descriptor({
		id: "openalex",
		name: "OpenAlex",
		category: "academic_discovery",
		domains: ["academic", "civil_works", "security", "ai_agents"],
		url: "https://openalex.org/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "public_metadata_api_possible_future",
		useWhen: [
			"academic discovery",
			"papers",
			"feasibility evidence",
			"literature mapping",
		],
		avoidWhen: ["treating abstracts/index metadata as final proof"],
	}),
	descriptor({
		id: "crossref",
		name: "Crossref",
		category: "academic_discovery",
		domains: ["academic", "standards", "civil_works"],
		url: "https://www.crossref.org/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "public_metadata_api_possible_future",
		useWhen: [
			"DOI metadata",
			"citation discovery",
			"academic source verification",
		],
		avoidWhen: ["using metadata instead of reading source paper"],
	}),
	descriptor({
		id: "semantic-scholar",
		name: "Semantic Scholar",
		category: "academic_discovery",
		domains: ["academic", "ai_agents", "security", "web"],
		url: "https://www.semanticscholar.org/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "public_metadata_api_possible_future",
		useWhen: [
			"paper discovery",
			"AI/software engineering research",
			"related work",
		],
		avoidWhen: [
			"claiming implementation best practice from citation count alone",
		],
	}),
	descriptor({
		id: "arxiv",
		name: "arXiv",
		category: "academic_discovery",
		domains: ["academic", "ai_agents", "security", "web"],
		url: "https://arxiv.org/",
		trustLevel: "preprint",
		quality: { ...academicQuality, evidenceStrength: "low" },
		automationMode: "public_metadata_api_possible_future",
		useWhen: ["preprint discovery", "emerging research", "AI agents"],
		avoidWhen: ["treating preprints as peer-reviewed consensus"],
	}),
	descriptor({
		id: "pubmed",
		name: "PubMed",
		category: "academic_discovery",
		domains: ["academic", "security", "civil_works"],
		url: "https://pubmed.ncbi.nlm.nih.gov/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "public_metadata_api_possible_future",
		useWhen: ["health/safety evidence", "human factors", "occupational safety"],
		avoidWhen: ["general software architecture unless domain is health/safety"],
	}),
	descriptor({
		id: "doaj",
		name: "Directory of Open Access Journals",
		category: "academic_discovery",
		domains: ["academic", "civil_works", "security"],
		url: "https://doaj.org/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "public_metadata_api_possible_future",
		useWhen: ["open access journal discovery", "academic feasibility"],
		avoidWhen: ["assuming all indexed content is directly applicable"],
	}),
	descriptor({
		id: "base-search",
		name: "BASE Search",
		category: "academic_discovery",
		domains: ["academic", "standards", "civil_works"],
		url: "https://www.base-search.net/",
		trustLevel: "academic_index",
		quality: academicQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"broad academic discovery",
			"repository search",
			"gray literature",
		],
		avoidWhen: [
			"automated scraping or treating search result snippets as evidence",
		],
	}),
	descriptor({
		id: "github-similar-projects",
		name: "GitHub Similar Projects",
		category: "community_signal",
		domains: [
			"project_similarity",
			"programming_structure",
			"code_architecture",
			"web",
			"database",
		],
		languages: ["html", "javascript", "typescript", "python", "go", "rust"],
		frameworks: ["nextjs", "react", "node", "express", "supabase"],
		url: "https://github.com/search",
		trustLevel: "community",
		quality: communityQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"similar project examples",
			"folder structure examples",
			"implementation patterns",
			"Next.js TypeScript app structure",
		],
		avoidWhen: ["copying code blindly", "treating popular repos as contracts"],
	}),
	descriptor({
		id: "github-issues",
		name: "GitHub Issues",
		category: "community_signal",
		domains: [
			"security",
			"project_similarity",
			"web",
			"database",
			"programming_structure",
		],
		url: "https://github.com/search",
		trustLevel: "community",
		quality: communityQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"known issues",
			"recent bugs",
			"language or framework regressions",
			"project risk signals",
		],
		avoidWhen: ["unverified issue comments", "unmaintained repos"],
	}),
	descriptor({
		id: "github-releases",
		name: "GitHub Releases",
		category: "community_signal",
		domains: ["security", "web", "database", "cloud", "project_similarity"],
		url: "https://github.com/search",
		trustLevel: "community",
		quality: communityQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"framework releases",
			"language ecosystem news",
			"breaking changes",
			"security patch awareness",
		],
		avoidWhen: [
			"automatic dependency updates without official advisory review",
		],
	}),
	descriptor({
		id: "reddit",
		name: "Reddit Public Communities",
		category: "community_signal",
		domains: [
			"community_signal" as ExternalSourceDomain,
			"security",
			"web",
			"database",
			"project_similarity",
		].filter(isKnownDomain),
		url: "https://www.reddit.com/",
		trustLevel: "community",
		quality: communityQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"community reports",
			"developer experience",
			"incident rumors",
			"language news",
		],
		avoidWhen: [
			"using anecdotes as final evidence",
			"private or personalized feeds",
		],
	}),
	descriptor({
		id: "x-public-posts-accounts",
		name: "X Public Posts and Official Accounts",
		category: "community_signal",
		domains: ["security", "web", "cloud", "project_similarity"],
		url: "https://x.com/",
		trustLevel: "community",
		quality: communityQuality,
		automationMode: "manual_visit_required",
		useWhen: [
			"official account announcements",
			"public incident signals",
			"language/framework news",
		],
		avoidWhen: [
			"X home feed",
			"login-only personalized content",
			"single unverified posts",
		],
	}),
	descriptor({
		id: "google-scholar",
		name: "Google Scholar",
		category: "blocked_or_manual",
		domains: ["academic"],
		url: "https://scholar.google.com/",
		trustLevel: "manual_or_blocked",
		quality: manualBlockedQuality,
		automationMode: "blocked_no_automation",
		useWhen: ["manual academic search only", "human-provided citations"],
		avoidWhen: ["automation", "scraping", "using snippets as evidence"],
		notes:
			"Prefer OpenAlex, Crossref, Semantic Scholar, arXiv, PubMed, DOAJ or BASE for automatable discovery.",
	}),
	descriptor({
		id: "academia-edu",
		name: "Academia.edu",
		category: "blocked_or_manual",
		domains: ["academic"],
		url: "https://www.academia.edu/",
		trustLevel: "manual_or_blocked",
		quality: manualBlockedQuality,
		automationMode: "manual_visit_required",
		useWhen: ["manual user-provided paper reference", "human-curated source"],
		avoidWhen: [
			"login/paywall automation",
			"bulk scraping",
			"treating uploads as peer-reviewed proof",
		],
	}),
];

export function getExternalSourceRegistry(): ExternalSourceRegistry {
	return {
		version: 1,
		updatedAt: "2026-06-04T00:00:00.000Z",
		categories: [...CATEGORIES],
		domains: [...DOMAINS],
		sources: SOURCES.map((source) => ({
			...source,
			domains: [...source.domains],
		})),
		safety: { ...SAFE },
	};
}

export function recommendExternalSources(input: {
	projectId: string;
	request: string;
	domains?: ExternalSourceDomain[];
	language?: string;
	framework?: string;
	maxMatches?: number;
	now?: () => Date;
}): ExternalSourceRecommendationReport {
	const request = input.request.trim();
	const maxMatches = clampMax(input.maxMatches ?? 12);
	const requestedDomains = (input.domains ?? []).filter(isKnownDomain);
	const language = normalizeTerm(input.language);
	const framework = normalizeTerm(input.framework);
	const requestTerms = terms(request);
	const policyRequest = [
		request,
		...requestedDomains,
		language,
		framework,
	].join(" ");
	const evidencePolicy = buildBibliotecarioEvidencePolicy({
		request: policyRequest,
	});
	const scored = SOURCES.map((source) => ({
		source,
		score: scoreSource(source, {
			requestTerms,
			requestedDomains,
			language,
			framework,
		}),
	}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
		.slice(0, maxMatches);

	const matches = scored.map(({ source, score }) =>
		recommendationFor(source, score, policyRequest),
	);
	return {
		version: 1,
		projectId: input.projectId,
		request,
		generatedAt: (input.now?.() ?? new Date()).toISOString(),
		filters: {
			domains: requestedDomains.length ? requestedDomains : undefined,
			language: language || undefined,
			framework: framework || undefined,
		},
		matches,
		evidencePolicy,
		missingKnowledge: matches.length
			? []
			: [
					"No registry source matched this request. Add a curated source descriptor or provide a manual source before using external evidence.",
				],
		limitations: [
			"Registry-only: recommendations are source pointers, not fetched evidence.",
			"No web/live fetch, no raw docs, no Source Library import, no AgentLab execution, and no contract promotion occurred.",
			"Community and social signals require human verification and cannot govern plans by themselves.",
		],
		advisoryOnly: true,
		fetchAllowed: false,
		rawDocsStored: false,
		promotionAllowed: false,
		agentLabAutoRunAllowed: false,
	};
}

function descriptor(
	input: Omit<ExternalSourceDescriptor, keyof typeof SAFE>,
): ExternalSourceDescriptor {
	return { ...input, ...SAFE };
}

function scoreSource(
	source: ExternalSourceDescriptor,
	input: {
		requestTerms: Set<string>;
		requestedDomains: ExternalSourceDomain[];
		language: string;
		framework: string;
	},
): number {
	let score = 0;
	for (const domain of input.requestedDomains) {
		if (source.domains.includes(domain)) score += 8;
	}
	if (input.language && source.languages?.includes(input.language)) score += 10;
	if (input.framework && source.frameworks?.includes(input.framework))
		score += 10;
	const haystack = terms(
		[
			source.id,
			source.name,
			source.category,
			source.trustLevel,
			...source.domains,
			...(source.languages ?? []),
			...(source.frameworks ?? []),
			...source.useWhen,
			...source.avoidWhen,
			source.notes ?? "",
		].join(" "),
	);
	for (const term of input.requestTerms) {
		if (haystack.has(term)) score += 2;
	}
	if (
		source.category === "blocked_or_manual" &&
		mentionsBlockedSource(source, input.requestTerms)
	)
		score += 14;
	if (
		source.category === "academic_discovery" &&
		input.requestTerms.has("academic")
	)
		score += 5;
	if (
		source.category === "community_signal" &&
		hasAny(input.requestTerms, [
			"github",
			"reddit",
			"x",
			"issue",
			"issues",
			"release",
			"releases",
			"news",
			"noticias",
		])
	)
		score += 7;
	if (
		source.domains.includes("programming_structure") &&
		hasAny(input.requestTerms, [
			"structure",
			"estructura",
			"folder",
			"carpetas",
			"separation",
			"separar",
		])
	)
		score += 6;
	if (
		source.domains.includes("separation_of_concerns") &&
		hasAny(input.requestTerms, [
			"inline",
			"embebido",
			"onclick",
			"separar",
			"html",
		])
	)
		score += 8;
	return score;
}

function recommendationFor(
	source: ExternalSourceDescriptor,
	score: number,
	request: string,
): ExternalSourceRegistryRecommendation {
	const community = source.category === "community_signal";
	const blocked = source.category === "blocked_or_manual";
	const policy = policyForSourceRecommendation({
		request,
		category: source.category,
		trustLevel: source.trustLevel,
	});
	return {
		sourceId: source.id,
		name: source.name,
		category: source.category,
		domains: [...source.domains],
		whyRelevant: buildWhy(source),
		confidence:
			score >= 18 && !community ? "high" : score >= 8 ? "medium" : "low",
		automationMode: source.automationMode,
		orchestratorInstruction: blocked
			? "Manual/blocked source: ask the human for a curated citation or use safer alternatives before plan decisions."
			: community
				? "Señal comunitaria únicamente: usar para alertas/ejemplos tempranos y exigir verificación humana más evidencia oficial antes de decidir."
				: "Use as advisory source pointer; consult/validate source externally before promoting any rule or plan claim.",
		promotionAllowed: false,
		claimType: policy.claimType,
		evidenceRole: policy.evidenceRole,
		canonicality: policy.canonicality,
		requiresCorroboration: policy.requiresCorroboration,
		forbiddenAsSoleAuthority: policy.forbiddenAsSoleAuthority,
		policyWarnings: policy.policyWarnings,
	};
}

function buildWhy(source: ExternalSourceDescriptor): string {
	const base = source.useWhen.slice(0, 3).join("; ");
	if (source.id === "mdn-html-structure") {
		return "HTML structure guidance: keep semantics in HTML, avoid inline/embedded JS, and separate events/services into modules.";
	}
	if (source.id === "github-similar-projects") {
		return "Project similarity signal for folder structure, implementation patterns, and comparable stack examples; verify before reuse.";
	}
	return (
		base ||
		`Relevant ${source.category} source for ${source.domains.join(", ")}.`
	);
}

function clampMax(value: number): number {
	if (!Number.isFinite(value)) return 8;
	return Math.max(1, Math.min(20, Math.trunc(value)));
}

function normalizeTerm(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function terms(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/gu, "")
			.split(/[^a-z0-9_.-]+/u)
			.map((term) => term.trim())
			.filter((term) => term.length >= 2),
	);
}

function hasAny(termsSet: Set<string>, candidates: string[]): boolean {
	return candidates.some((candidate) => termsSet.has(candidate));
}

function mentionsBlockedSource(
	source: ExternalSourceDescriptor,
	termsSet: Set<string>,
): boolean {
	if (source.id === "google-scholar") {
		return termsSet.has("google") || termsSet.has("scholar");
	}
	if (source.id === "academia-edu") {
		return termsSet.has("academia") || termsSet.has("academia.edu");
	}
	return false;
}

function isKnownDomain(value: string): value is ExternalSourceDomain {
	return (DOMAINS as string[]).includes(value);
}
