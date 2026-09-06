import assert from "node:assert/strict";
import test from "node:test";
import {
	approveGeneralSpec,
	checkSpecAgainstPrototype,
	deriveGeneralSpec,
	reviewGeneralSpec,
	validateGeneralSpec,
} from "../src/birth-general-spec.js";
import { createPrototypeMasterDraft } from "../src/birth-prototype-master.js";

const validPrototype = createPrototypeMasterDraft({
	projectId: "idu-pi",
	productIntent: "Define the first scalable product base before feature work.",
	visualStyle: "Project-specific shell approved by user.",
	layoutBase: "Project-specific layout base.",
	stackRecommendation: { packageManager: "pnpm", runtime: "Node/TypeScript" },
	alternativesDiscarded: ["vanilla-html"],
	dependencies: { allowed: ["typescript"], risky: [] },
	motionRules: ["respect prefers-reduced-motion"],
	uiPatterns: ["app-shell"],
	forbiddenPatterns: ["inline onclick"],
	bibliotecarioReferences: ["README.md"],
	scalingRules: ["feature-folders"],
});

const validSpecInput = {
	navigation: ["header", "sidebar"],
	baseComponents: ["Button", "Card"],
	pageStructureRules: ["every page declares a layout"],
	dataRules: ["no secrets in client state"],
	interactionRules: ["confirm before destructive actions"],
	motionRules: ["respect prefers-reduced-motion"],
	accessibilityCriteria: ["keyboard reachable"],
	performanceCriteria: ["TTI under 3s on midrange"],
};

test("cannot derive without approved prototype", () => {
	assert.throws(
		() => deriveGeneralSpec({
			projectId: "idu-pi",
			prototype: { ...validPrototype, status: "draft" },
			specInput: validSpecInput,
		}),
		/prototype must be approved/i,
	);
});

test("derive includes derivedFrom project-core, master-plan, prototype-master", () => {
	const spec = deriveGeneralSpec({
		projectId: "idu-pi",
		prototype: { ...validPrototype, status: "approved" },
		specInput: validSpecInput,
	});
	assert.deepEqual(spec.derivedFrom, [
		"project-core",
		"master-plan",
		"prototype-master",
	]);
});

test("approveGeneralSpec requires reviewed status", () => {
	const spec = deriveGeneralSpec({
		projectId: "idu-pi",
		prototype: { ...validPrototype, status: "approved" },
		specInput: validSpecInput,
	});
	assert.throws(
		() => approveGeneralSpec(spec, "reviewer-1"),
		/cannot approve a general spec in status 'draft'/i,
	);
});

test("approveGeneralSpec from reviewed sets approved", () => {
	let spec = deriveGeneralSpec({
		projectId: "idu-pi",
		prototype: { ...validPrototype, status: "approved" },
		specInput: validSpecInput,
	});
	spec = reviewGeneralSpec(spec);
	spec = approveGeneralSpec(spec, "reviewer-1");
	assert.equal(spec.status, "approved");
	assert.equal(spec.approvedBy, "reviewer-1");
});

test("checkSpecAgainstPrototype detects contradiction with forbiddenPatterns", () => {
	const prototype = { ...validPrototype, status: "approved" as const };
	const result = checkSpecAgainstPrototype({
		prototype,
		pageSpecText: "Use inline onclick for the menu buttons.",
	});
	assert.equal(result.ok, false);
	assert.ok(result.violations.some((v) => /forbiddenPatterns/i.test(v)));
});

test("checkSpecAgainstPrototype passes when no contradiction", () => {
	const prototype = { ...validPrototype, status: "approved" as const };
	const result = checkSpecAgainstPrototype({
		prototype,
		pageSpecText: "Use a Button component to navigate.",
	});
	assert.equal(result.ok, true);
	assert.deepEqual(result.violations, []);
});

test("validateGeneralSpec rejects empty sections", () => {
	const result = validateGeneralSpec({
		...validSpecInput,
		navigation: [],
	});
	assert.equal(result.ok, false);
	assert.ok(result.missingFields.length > 0);
});
