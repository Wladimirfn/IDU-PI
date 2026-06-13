import assert from "node:assert/strict";
import test from "node:test";
import {
	applyVisualDerivation,
	buildStage2Prompt,
	runVisualDerivation,
} from "../src/birth-general-spec-derive.js";
import type { NormalizedBirthGeneralSpec } from "../src/birth-general-spec.js";

function baseSpec(): NormalizedBirthGeneralSpec {
	return {
		version: 1,
		projectId: "demo",
		status: "approved",
		derivedFrom: ["project-core", "master-plan", "prototype-master"],
		specVersion: 1,
		navigation: [],
		baseComponents: ["Button"],
		pageStructureRules: ["pages use explicit layouts"],
		dataRules: ["no secrets in client state"],
		interactionRules: [],
		motionRules: [],
		accessibilityCriteria: [],
		performanceCriteria: [],
		provenance: {
			navigation: "scan-empty",
			interactionRules: "scan-empty",
			motionRules: "scan-empty",
			accessibilityCriteria: "scan-empty",
			performanceCriteria: "scan-empty",
		},
		evidence: {},
	};
}

test("applyVisualDerivation applies evidence-bearing visual patch items", () => {
	const result = applyVisualDerivation({
		spec: baseSpec(),
		modelPatch: {
			motionRules: [
				{
					value: "Respect prefers-reduced-motion before animating UI.",
					evidence: ["src/Button.tsx:42"],
				},
			],
		},
		uiFiles: ["src/Button.tsx"],
	});

	assert.deepEqual(result.spec.motionRules, [
		"Respect prefers-reduced-motion before animating UI.",
	]);
	assert.equal(result.spec.provenance.motionRules, "model");
	assert.deepEqual(result.spec.evidence.motionRules, ["src/Button.tsx:42"]);
	assert.equal(result.appliedCount, 1);
});

test("applyVisualDerivation drops evidence-free visual patch items", () => {
	const spec = baseSpec();
	const result = applyVisualDerivation({
		spec,
		modelPatch: {
			motionRules: [{ value: "Never animate anything without evidence." }],
		},
		uiFiles: ["src/Button.tsx"],
	});

	assert.deepEqual(result.spec.motionRules, []);
	assert.equal(result.spec.provenance.motionRules, "scan-empty");
	assert.equal(result.appliedCount, 0);
	assert.ok(result.droppedCount > 0);
});

test("applyVisualDerivation drops evidence when no UI files were provided", () => {
	const result = applyVisualDerivation({
		spec: baseSpec(),
		modelPatch: {
			motionRules: [
				{
					value: "Use opacity transitions only.",
					evidence: ["src/Button.tsx:7"],
				},
			],
		},
		uiFiles: [],
	});

	assert.deepEqual(result.spec.motionRules, []);
	assert.equal(result.appliedCount, 0);
	assert.equal(result.droppedCount, 1);
});

test("applyVisualDerivation preserves human-provenance visual fields", () => {
	const spec = baseSpec();
	spec.navigation = ["Owner-approved sidebar navigation"];
	spec.provenance.navigation = "human";
	spec.evidence.navigation = ["owner:meeting-note"];

	const result = applyVisualDerivation({
		spec,
		modelPatch: {
			navigation: [
				{ value: "Replace with top nav", evidence: ["src/App.tsx:12"] },
			],
		},
		uiFiles: ["src/App.tsx"],
	});

	assert.deepEqual(result.spec.navigation, [
		"Owner-approved sidebar navigation",
	]);
	assert.equal(result.spec.provenance.navigation, "human");
	assert.deepEqual(result.spec.evidence.navigation, ["owner:meeting-note"]);
	assert.equal(result.appliedCount, 0);
});

test("applyVisualDerivation ignores non-visual patch fields", () => {
	const spec = baseSpec();
	const result = applyVisualDerivation({
		spec,
		modelPatch: {
			baseComponents: [{ value: "Card", evidence: ["src/Card.tsx:1"] }],
			dataRules: [{ value: "Use GraphQL", evidence: ["src/api.ts:1"] }],
		},
		uiFiles: ["src/Card.tsx", "src/api.ts"],
	});

	assert.deepEqual(result.spec.baseComponents, ["Button"]);
	assert.deepEqual(result.spec.dataRules, ["no secrets in client state"]);
	assert.equal(result.appliedCount, 0);
});

test("runVisualDerivation handles agentlab-ui-ux router fallback without changing scan-empty visual fields", async () => {
	const spec = baseSpec();
	const result = await runVisualDerivation({
		spec,
		uiFiles: ["src/App.tsx"],
		promptForRole: async () => ({ ok: false, output: "" }),
	});

	assert.deepEqual(result.spec.navigation, []);
	assert.deepEqual(result.spec.motionRules, []);
	assert.equal(result.spec.provenance.navigation, "scan-empty");
	assert.match(result.routerFallbackWarning ?? "", /agentlab-ui-ux/i);
});

test("runVisualDerivation catches promptForRole exceptions and leaves spec unchanged", async () => {
	const spec = baseSpec();
	const result = await runVisualDerivation({
		spec,
		uiFiles: ["src/App.tsx"],
		promptForRole: async () => {
			throw new Error("router unavailable");
		},
	});

	assert.deepEqual(result.spec.navigation, []);
	assert.deepEqual(result.spec.motionRules, []);
	assert.match(result.routerFallbackWarning ?? "", /router unavailable/i);
});

test("buildStage2Prompt names visual fields and UI files", () => {
	const prompt = buildStage2Prompt(baseSpec(), [
		"src/App.tsx",
		"src/Button.tsx",
	]);
	for (const field of [
		"navigation",
		"interactionRules",
		"motionRules",
		"accessibilityCriteria",
		"performanceCriteria",
	]) {
		assert.ok(prompt.includes(field), `expected prompt to mention ${field}`);
	}
	assert.match(prompt, /src\/App\.tsx/u);
	assert.match(prompt, /src\/Button\.tsx/u);
	assert.match(prompt, /file:line/u);
});
