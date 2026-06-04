import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getExternalSourceRegistry,
	recommendExternalSources,
	type ExternalSourceCategory,
	type ExternalSourceDomain,
} from "../src/external-source-registry.js";

const requiredCategories: ExternalSourceCategory[] = [
	"official_docs",
	"academic_discovery",
	"community_signal",
	"blocked_or_manual",
];

const requiredDomains: ExternalSourceDomain[] = [
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

const requiredSourceIds = [
	"iso-obp",
	"aenor-search",
	"ibm-cloud-docs",
	"openalex",
	"crossref",
	"semantic-scholar",
	"arxiv",
	"pubmed",
	"doaj",
	"base-search",
	"github-similar-projects",
	"github-issues",
	"github-releases",
	"reddit",
	"x-public-posts-accounts",
	"google-scholar",
	"academia-edu",
];

test("external source registry is versioned, complete, and no-fetch safe", () => {
	const registry = getExternalSourceRegistry();

	assert.equal(registry.version, 1);
	for (const category of requiredCategories) {
		assert.equal(registry.categories.includes(category), true, category);
	}
	for (const domain of requiredDomains) {
		assert.equal(registry.domains.includes(domain), true, domain);
	}
	for (const id of requiredSourceIds) {
		assert.ok(registry.sources.find((source) => source.id === id), id);
	}

	assert.deepEqual(registry.safety, {
		advisoryOnly: true,
		fetchAllowed: false,
		rawDocsStored: false,
		promotionAllowed: false,
		agentLabAutoRunAllowed: false,
	});
	for (const source of registry.sources) {
		assert.equal(source.advisoryOnly, true, source.id);
		assert.equal(source.fetchAllowed, false, source.id);
		assert.equal(source.rawDocsStored, false, source.id);
		assert.equal(source.promotionAllowed, false, source.id);
		assert.equal(source.agentLabAutoRunAllowed, false, source.id);
	}
});

test("external source recommendation guides HTML separation without web fetch", () => {
	const report = recommendExternalSources({
		projectId: "idu-pi",
		request: "HTML sin JavaScript embebido ni onclick inline; separar estructura, eventos y servicios",
		domains: ["web", "separation_of_concerns", "programming_structure"],
		language: "html",
		now: () => new Date("2026-06-04T12:00:00.000Z"),
	});

	assert.equal(report.fetchAllowed, false);
	assert.equal(report.rawDocsStored, false);
	assert.equal(report.promotionAllowed, false);
	assert.ok(report.matches.length > 0);
	assert.ok(
		report.matches.some((match) =>
			match.domains.includes("separation_of_concerns"),
		),
	);
	assert.ok(
		report.matches.some((match) => /HTML|semántica|inline|embebido/iu.test(match.whyRelevant)),
	);
	assert.equal(JSON.stringify(report).includes("<script>raw prompt"), false);
});

test("external source recommendation covers TypeScript and Next.js project structure", () => {
	const report = recommendExternalSources({
		projectId: "idu-pi",
		request: "estructura de carpetas para una app TypeScript Next.js con routing, services y tests",
		domains: ["programming_structure", "code_architecture", "project_similarity"],
		language: "typescript",
		framework: "nextjs",
		maxMatches: 6,
	});

	assert.ok(report.matches.length > 0);
	assert.ok(
		report.matches.some((match) => match.sourceId === "github-similar-projects"),
	);
	assert.ok(
		report.matches.some((match) => match.domains.includes("code_architecture")),
	);
	assert.ok(
		report.matches.every((match) => match.promotionAllowed === false),
	);
});

test("external source recommendation separates standards, civil works, academic discovery, and manual blocks", () => {
	const standards = recommendExternalSources({
		projectId: "idu-pi",
		request: "normas ISO y AENOR para obras civiles y seguridad",
		domains: ["standards", "civil_works", "security"],
	});
	assert.ok(standards.matches.some((match) => match.sourceId === "iso-obp"));
	assert.ok(
		standards.matches.some((match) => match.sourceId === "aenor-search"),
	);

	const academic = recommendExternalSources({
		projectId: "idu-pi",
		request: "buscar papers académicos y evidencia científica",
		domains: ["academic"],
	});
	for (const id of ["openalex", "crossref", "semantic-scholar", "arxiv", "pubmed", "doaj", "base-search"]) {
		assert.ok(academic.matches.some((match) => match.sourceId === id), id);
	}

	const blocked = recommendExternalSources({
		projectId: "idu-pi",
		request: "usar Google Scholar y Academia.edu",
		domains: ["academic"],
		maxMatches: 10,
	});
	assert.ok(
		blocked.matches.some(
			(match) =>
				match.sourceId === "google-scholar" &&
				match.automationMode === "blocked_no_automation",
		),
	);
	assert.ok(
		blocked.matches.some(
			(match) =>
				match.sourceId === "academia-edu" &&
				match.automationMode === "manual_visit_required",
		),
	);
});

test("external source recommendation marks GitHub Reddit and X as community signals", () => {
	const report = recommendExternalSources({
		projectId: "idu-pi",
		request: "noticias de lenguajes, issues, releases y proyectos similares en GitHub Reddit X",
		domains: ["community_signal" as ExternalSourceDomain, "project_similarity"],
		maxMatches: 8,
	});

	for (const id of ["github-similar-projects", "github-issues", "github-releases", "reddit", "x-public-posts-accounts"]) {
		const match = report.matches.find((entry) => entry.sourceId === id);
		assert.ok(match, id);
		assert.equal(match.category, "community_signal", id);
		assert.match(match.orchestratorInstruction, /verificaci[oó]n humana|señal/i, id);
	}
});

test("external source recommendation reports missing knowledge instead of generic claims", () => {
	const report = recommendExternalSources({
		projectId: "idu-pi",
		request: "fuente desconocida para astronomía submarina alienígena",
		domains: [],
		maxMatches: 3,
	});

	assert.equal(report.matches.length, 0);
	assert.ok(report.missingKnowledge.length > 0);
	assert.equal(report.advisoryOnly, true);
});
