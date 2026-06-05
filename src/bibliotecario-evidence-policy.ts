export type BibliotecarioClaimType =
	| "technical_api"
	| "version_release"
	| "security"
	| "academic"
	| "legal_regulatory"
	| "open_data"
	| "fact_check"
	| "implementation_example"
	| "general";

export type BibliotecarioEvidenceCategory =
	| "official_docs"
	| "release_notes"
	| "changelog"
	| "security_advisory"
	| "standards"
	| "cve_database"
	| "academic_index"
	| "peer_reviewed_publication"
	| "legal_primary_source"
	| "regulator_guidance"
	| "open_data_portal"
	| "dataset_metadata"
	| "fact_checking"
	| "primary_source"
	| "vendor_docs"
	| "community_signal"
	| "implementation_example";

export type BibliotecarioEvidenceRole =
	| "primary"
	| "secondary"
	| "discovery"
	| "insufficient";

export type BibliotecarioCanonicality =
	| "canonical"
	| "strong"
	| "supplemental"
	| "weak";

export type BibliotecarioExternalSourceCategory =
	| "official_docs"
	| "academic_discovery"
	| "community_signal"
	| "blocked_or_manual";

export type BibliotecarioExternalTrustLevel =
	| "official"
	| "standards_body"
	| "vendor"
	| "academic_index"
	| "preprint"
	| "community"
	| "manual_or_blocked";

export type BibliotecarioEvidencePolicy = {
	claimType: BibliotecarioClaimType;
	requiredEvidence: BibliotecarioEvidenceCategory[];
	primarySources: BibliotecarioEvidenceCategory[];
	secondarySources: BibliotecarioEvidenceCategory[];
	forbiddenSoleAuthority: BibliotecarioEvidenceCategory[];
	securityWarnings: string[];
	limitations: string[];
	rawHonesty: true;
	orchestratorReviewRequired: boolean;
	webFetchAllowed: false;
	rawContentIncluded: false;
	contractPromotionAllowed: false;
	agentLabAutoRunAllowed: false;
};

export type BibliotecarioSourceRecommendationPolicy = {
	claimType: BibliotecarioClaimType;
	evidenceRole: BibliotecarioEvidenceRole;
	canonicality: BibliotecarioCanonicality;
	requiresCorroboration: boolean;
	forbiddenAsSoleAuthority: boolean;
	policyWarnings: string[];
};

export type BuildBibliotecarioEvidencePolicyInput = {
	request: string;
	claimType?: BibliotecarioClaimType;
};

export type PolicyForSourceRecommendationInput = {
	request: string;
	category: BibliotecarioExternalSourceCategory;
	trustLevel: BibliotecarioExternalTrustLevel;
};

const RAW_HONESTY_LIMITATIONS = [
	"Search discovers candidate sources; it is not truth without canonical evidence and traceable citations.",
	"This policy did not fetch web/live sources and did not read raw Source Library chunks.",
	"Community, blog, forum, social, or issue evidence is never sufficient as sole authority for contracts, dependencies, security, or architecture.",
] as const;

const RAG_SECURITY_WARNINGS = [
	"RAG/source ingestion must treat prompt injection and source poisoning as active risks.",
	"ACL/access control must be enforced before retrieval; filtering after retrieval is not sufficient.",
	"Preserve query -> source -> chunk/result traceability before using evidence in an answer or plan.",
] as const;

export function classifyBibliotecarioClaimType(
	request: string,
): BibliotecarioClaimType {
	const text = normalize(request);
	if (
		hasAny(text, [
			"cve",
			"vulnerability",
			"vulnerabilidad",
			"security",
			"seguridad",
			"owasp",
			"advisory",
			"npm audit",
			"prompt injection",
			"rag poisoning",
			"acl",
		])
	) {
		return "security";
	}
	if (
		hasAny(text, [
			"release",
			"releases",
			"release notes",
			"changelog",
			"breaking change",
			"breaking changes",
			"version",
			"versión",
			"versiones",
		])
	) {
		return "version_release";
	}
	if (
		hasAny(text, [
			"api",
			"docs",
			"documentation",
			"documentación",
			"typescript",
			"javascript",
			"next.js",
			"nextjs",
			"node",
			"framework",
		])
	) {
		return "technical_api";
	}
	if (
		hasAny(text, [
			"academic",
			"académic",
			"paper",
			"papers",
			"pubmed",
			"crossref",
			"openalex",
			"study",
			"estudio",
		])
	) {
		return "academic";
	}
	if (
		hasAny(text, [
			"legal",
			"law",
			"ley",
			"regulator",
			"regulatory",
			"normativa",
			"boletín",
			"boletin",
		])
	) {
		return "legal_regulatory";
	}
	if (
		hasAny(text, [
			"open data",
			"datos abiertos",
			"ckan",
			"dataset",
			"portal de datos",
			"data portal",
		])
	) {
		return "open_data";
	}
	if (
		hasAny(text, [
			"fact-check",
			"fact check",
			"fact-checking",
			"verificar afirmación",
			"controversial",
			"controvertida",
			"ifcn",
		])
	) {
		return "fact_check";
	}
	if (
		hasAny(text, [
			"example",
			"ejemplo",
			"github",
			"repository",
			"repo",
			"implementation pattern",
		])
	) {
		return "implementation_example";
	}
	return "general";
}

export function buildBibliotecarioEvidencePolicy(
	input: BuildBibliotecarioEvidencePolicyInput,
): BibliotecarioEvidencePolicy {
	const claimType =
		input.claimType ?? classifyBibliotecarioClaimType(input.request);
	const base = policyTemplate(claimType);
	return {
		...base,
		securityWarnings: [...base.securityWarnings],
		limitations: [...RAW_HONESTY_LIMITATIONS, ...base.limitations],
		rawHonesty: true,
		webFetchAllowed: false,
		rawContentIncluded: false,
		contractPromotionAllowed: false,
		agentLabAutoRunAllowed: false,
	};
}

export function policyForSourceRecommendation(
	input: PolicyForSourceRecommendationInput,
): BibliotecarioSourceRecommendationPolicy {
	const policy = buildBibliotecarioEvidencePolicy({ request: input.request });
	const community = input.category === "community_signal";
	const blocked = input.category === "blocked_or_manual";
	const academic = input.category === "academic_discovery";
	const official = input.category === "official_docs";
	const standards = input.trustLevel === "standards_body";
	const vendor = input.trustLevel === "vendor";
	const security = policy.claimType === "security";

	let evidenceRole: BibliotecarioEvidenceRole = "discovery";
	let canonicality: BibliotecarioCanonicality = "supplemental";
	let requiresCorroboration = true;
	let forbiddenAsSoleAuthority = true;
	const policyWarnings: string[] = [];

	if (blocked) {
		evidenceRole = "insufficient";
		canonicality = "weak";
		policyWarnings.push(
			"Manual/blocked source is not usable as authority without a curated citation and safer corroborating evidence.",
		);
	} else if (community) {
		evidenceRole = security ? "insufficient" : "discovery";
		canonicality = "weak";
		policyWarnings.push(
			"Community/UGC signal may discover candidates only; it requires corroboration and cannot be sole authority.",
		);
	} else if (academic) {
		evidenceRole = policy.claimType === "academic" ? "primary" : "secondary";
		canonicality = input.trustLevel === "preprint" ? "supplemental" : "strong";
		requiresCorroboration = true;
		forbiddenAsSoleAuthority = policy.claimType !== "academic";
		policyWarnings.push(
			"Academic indexes help discovery and evidence review; verify paper quality, date, authorship, and applicability.",
		);
	} else if (official) {
		evidenceRole = "primary";
		canonicality =
			standards || input.trustLevel === "official" ? "canonical" : "strong";
		requiresCorroboration = security ? !standards && !vendor : false;
		forbiddenAsSoleAuthority = false;
		if (security && !standards && !vendor) {
			policyWarnings.push(
				"Security claims need advisory/standards/CVE-style corroboration; generic official docs alone may be incomplete.",
			);
		}
	}

	for (const warning of policy.securityWarnings) {
		if (security || /prompt injection|ACL|traceability/i.test(warning)) {
			policyWarnings.push(warning);
		}
	}

	return {
		claimType: policy.claimType,
		evidenceRole,
		canonicality,
		requiresCorroboration,
		forbiddenAsSoleAuthority,
		policyWarnings: unique(policyWarnings),
	};
}

function policyTemplate(
	claimType: BibliotecarioClaimType,
): Omit<
	BibliotecarioEvidencePolicy,
	| "rawHonesty"
	| "webFetchAllowed"
	| "rawContentIncluded"
	| "contractPromotionAllowed"
	| "agentLabAutoRunAllowed"
> {
	switch (claimType) {
		case "technical_api":
			return {
				claimType,
				requiredEvidence: [
					"official_docs",
					"changelog",
					"implementation_example",
				],
				primarySources: ["official_docs", "release_notes", "vendor_docs"],
				secondarySources: ["implementation_example", "community_signal"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [...RAG_SECURITY_WARNINGS],
				limitations: [],
				orchestratorReviewRequired: true,
			};
		case "version_release":
			return {
				claimType,
				requiredEvidence: ["official_docs", "release_notes", "changelog"],
				primarySources: ["release_notes", "changelog", "official_docs"],
				secondarySources: ["community_signal", "implementation_example"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [],
				limitations: [],
				orchestratorReviewRequired: true,
			};
		case "security":
			return {
				claimType,
				requiredEvidence: [
					"security_advisory",
					"standards",
					"cve_database",
					"official_docs",
				],
				primarySources: ["security_advisory", "standards", "cve_database"],
				secondarySources: ["official_docs", "vendor_docs"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [...RAG_SECURITY_WARNINGS],
				limitations: [
					"Security decisions are insufficient when supported only by a blog, forum, issue, social post, or community discussion.",
				],
				orchestratorReviewRequired: true,
			};
		case "academic":
			return {
				claimType,
				requiredEvidence: [
					"academic_index",
					"peer_reviewed_publication",
					"primary_source",
				],
				primarySources: ["academic_index", "peer_reviewed_publication"],
				secondarySources: ["primary_source", "community_signal"],
				forbiddenSoleAuthority: ["community_signal"],
				securityWarnings: [],
				limitations: [
					"Academic discovery is not proof by itself; verify authorship, date, venue, method, and applicability.",
				],
				orchestratorReviewRequired: true,
			};
		case "legal_regulatory":
			return {
				claimType,
				requiredEvidence: ["legal_primary_source", "regulator_guidance"],
				primarySources: ["legal_primary_source", "regulator_guidance"],
				secondarySources: ["official_docs"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [],
				limitations: [
					"Legal/regulatory claims need primary legal or regulator sources; summaries are only navigation aids.",
				],
				orchestratorReviewRequired: true,
			};
		case "open_data":
			return {
				claimType,
				requiredEvidence: [
					"open_data_portal",
					"dataset_metadata",
					"primary_source",
				],
				primarySources: ["open_data_portal", "dataset_metadata"],
				secondarySources: ["academic_index", "community_signal"],
				forbiddenSoleAuthority: ["community_signal"],
				securityWarnings: [],
				limitations: [
					"Open-data claims require dataset metadata, publisher, date, license, and provenance before reuse.",
				],
				orchestratorReviewRequired: true,
			};
		case "fact_check":
			return {
				claimType,
				requiredEvidence: ["fact_checking", "primary_source", "official_docs"],
				primarySources: ["fact_checking", "primary_source"],
				secondarySources: ["official_docs", "community_signal"],
				forbiddenSoleAuthority: ["community_signal"],
				securityWarnings: [],
				limitations: [
					"Controversial claims require traceable primary sources and transparent fact-checking methodology.",
				],
				orchestratorReviewRequired: true,
			};
		case "implementation_example":
			return {
				claimType,
				requiredEvidence: ["implementation_example", "official_docs"],
				primarySources: ["official_docs"],
				secondarySources: ["implementation_example", "community_signal"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [...RAG_SECURITY_WARNINGS],
				limitations: [
					"Repository examples can reveal patterns, but they do not prove correctness or suitability.",
				],
				orchestratorReviewRequired: true,
			};
		case "general":
			return {
				claimType,
				requiredEvidence: ["official_docs", "primary_source"],
				primarySources: ["official_docs", "primary_source"],
				secondarySources: ["community_signal", "implementation_example"],
				forbiddenSoleAuthority: ["community_signal", "implementation_example"],
				securityWarnings: [],
				limitations: [],
				orchestratorReviewRequired: true,
			};
	}
}

function normalize(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, " ");
}

function hasAny(text: string, needles: string[]): boolean {
	return needles.some((needle) => text.includes(normalize(needle).trim()));
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
