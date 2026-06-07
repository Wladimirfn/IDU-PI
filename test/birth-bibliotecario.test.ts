import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBibliotecarioAcquisition } from "../src/birth-bibliotecario.js";

const baseInput = {
	projectId: "idu-pi",
	localSourceRefs: [
		{ path: "README.md", quality: "primary" as const },
		{ path: "docs/spec.md", quality: "secondary" as const },
	],
	requestedExternalCategories: [] as string[],
	externalPermission: "not_requested" as const,
	masterPlanSummary: "Idu-pi supervises a living project loop.",
};

test("local sources found returns local_sources_found and ideas compatibility", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [{ path: "README.md", quality: "primary" }],
	});
	assert.equal(result.status, "local_sources_found");
	assert.equal(result.ideas.length, 1);
	assert.equal(result.ideas[0]?.decisionStatus, "idea_only");
	assert.equal(result.nextRequiredAction, "idu_birth_bibliotecario_discovery");
});

test("local empty + no permission returns external_fetch_blocked", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [],
		requestedExternalCategories: ["security", "performance"],
		externalPermission: "not_requested",
	});
	assert.equal(result.status, "external_fetch_blocked");
	assert.deepEqual(result.externalCategoriesNeeded, [
		"security",
		"performance",
	]);
});

test("local empty + granted permission + categories returns external_fetch_needed", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [],
		requestedExternalCategories: ["security"],
		externalPermission: "granted",
	});
	assert.equal(result.status, "external_fetch_needed");
});

test("ideas are always marked idea_only, never decision/contract", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [{ path: "a.md", quality: "primary" }],
	});
	for (const idea of result.ideas) {
		assert.equal(idea.decisionStatus, "idea_only");
		// The idea must not include a decision/contract/approved verdict.
		assert.equal(
			(idea as unknown as { decision?: unknown }).decision,
			undefined,
		);
		assert.equal(
			(idea as unknown as { contract?: unknown }).contract,
			undefined,
		);
		assert.equal(
			(idea as unknown as { approved?: unknown }).approved,
			undefined,
		);
	}
});

test("ideas can be compatible/incompatible/needs_review against Master Plan text", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [
			{ path: "loops.md", quality: "primary" },
			{ path: "static.md", quality: "primary" },
		],
		masterPlanSummary: "Idu-pi supervises a living project loop.",
	});
	const map = new Map(result.ideas.map((i) => [i.sourcePath, i.compatibility]));
	assert.equal(map.get("loops.md"), "compatible_with_master_plan");
	assert.equal(map.get("static.md"), "incompatible_with_master_plan");
});

test("local empty + granted + no categories returns external_fetch_blocked", () => {
	const result = evaluateBibliotecarioAcquisition({
		...baseInput,
		localSourceRefs: [],
		requestedExternalCategories: [],
		externalPermission: "granted",
	});
	assert.equal(result.status, "external_fetch_blocked");
	assert.equal(result.nextRequiredAction, "idu_birth_bibliotecario_discovery");
});
