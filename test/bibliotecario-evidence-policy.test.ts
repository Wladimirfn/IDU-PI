import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildBibliotecarioEvidencePolicy,
	classifyBibliotecarioClaimType,
	policyForSourceRecommendation,
} from "../src/bibliotecario-evidence-policy.js";

test("classifies technical API and version requests with official evidence first", () => {
	assert.equal(
		classifyBibliotecarioClaimType(
			"Next.js TypeScript API release notes and changelog for breaking changes",
		),
		"version_release",
	);

	const policy = buildBibliotecarioEvidencePolicy({
		request:
			"How should we implement a TypeScript API with official Next.js docs?",
	});

	assert.equal(policy.claimType, "technical_api");
	assert.equal(policy.rawHonesty, true);
	assert.ok(policy.requiredEvidence.includes("official_docs"));
	assert.ok(policy.requiredEvidence.includes("changelog"));
	assert.ok(policy.primarySources.includes("official_docs"));
	assert.ok(policy.primarySources.includes("release_notes"));
	assert.ok(policy.forbiddenSoleAuthority.includes("community_signal"));
});

test("security policy requires advisories standards and rejects community-only authority", () => {
	const policy = buildBibliotecarioEvidencePolicy({
		request:
			"Review npm vulnerability, CVE, OWASP and RAG prompt injection risk",
	});

	assert.equal(policy.claimType, "security");
	assert.ok(policy.requiredEvidence.includes("security_advisory"));
	assert.ok(policy.requiredEvidence.includes("standards"));
	assert.ok(policy.primarySources.includes("security_advisory"));
	assert.ok(
		policy.securityWarnings.some((warning) =>
			/prompt injection/i.test(warning),
		),
	);
	assert.ok(policy.securityWarnings.some((warning) => /ACL/i.test(warning)));
	assert.ok(
		policy.limitations.some((limitation) => /blog|community/i.test(limitation)),
	);
	assert.equal(policy.orchestratorReviewRequired, true);

	const community = policyForSourceRecommendation({
		request: "security vulnerability discussion from Reddit",
		category: "community_signal",
		trustLevel: "community",
	});
	assert.equal(community.claimType, "security");
	assert.equal(community.evidenceRole, "insufficient");
	assert.equal(community.canonicality, "weak");
	assert.equal(community.requiresCorroboration, true);
	assert.equal(community.forbiddenAsSoleAuthority, true);
});

test("academic open-data and fact-check requests select appropriate evidence hierarchy", () => {
	const academic = buildBibliotecarioEvidencePolicy({
		request: "Find academic papers and PubMed Crossref evidence for a claim",
	});
	assert.equal(academic.claimType, "academic");
	assert.ok(academic.primarySources.includes("academic_index"));

	const openData = buildBibliotecarioEvidencePolicy({
		request: "Use CKAN official open data portal dataset for city metrics",
	});
	assert.equal(openData.claimType, "open_data");
	assert.ok(openData.primarySources.includes("open_data_portal"));
	assert.ok(openData.requiredEvidence.includes("dataset_metadata"));

	const factCheck = buildBibliotecarioEvidencePolicy({
		request:
			"Verify controversial public claim with fact-checking and primary sources",
	});
	assert.equal(factCheck.claimType, "fact_check");
	assert.ok(factCheck.primarySources.includes("fact_checking"));
	assert.ok(factCheck.requiredEvidence.includes("primary_source"));
});

test("official sources can be primary while academic discovery remains corroborated discovery", () => {
	const official = policyForSourceRecommendation({
		request: "API docs for implementation",
		category: "official_docs",
		trustLevel: "official",
	});
	assert.equal(official.evidenceRole, "primary");
	assert.equal(official.canonicality, "canonical");
	assert.equal(official.requiresCorroboration, false);
	assert.equal(official.forbiddenAsSoleAuthority, false);

	const academic = policyForSourceRecommendation({
		request: "research paper evidence",
		category: "academic_discovery",
		trustLevel: "academic_index",
	});
	assert.equal(academic.claimType, "academic");
	assert.equal(academic.evidenceRole, "primary");
	assert.equal(academic.canonicality, "strong");
	assert.equal(academic.requiresCorroboration, true);
});
