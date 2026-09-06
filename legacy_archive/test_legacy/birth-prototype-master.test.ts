import assert from "node:assert/strict";
import test from "node:test";
import {
	approvePrototypeMaster,
	createPrototypeMasterDraft,
	reviewPrototypeMaster,
	validatePrototypeMaster,
} from "../src/birth-prototype-master.js";

const validDraft = {
	productIntent: "Define the first scalable product base before feature work.",
	visualStyle: "Project-specific shell approved by user.",
	layoutBase: "Project-specific layout base.",
	stackRecommendation: {
		packageManager: "pnpm" as const,
		runtime: "Node/TypeScript",
	},
	alternativesDiscarded: ["vanilla-html"],
	dependencies: {
		allowed: ["typescript"],
		risky: ["experimental-package"],
	},
	motionRules: ["respect prefers-reduced-motion"],
	uiPatterns: ["app-shell"],
	forbiddenPatterns: ["inline onclick"],
	bibliotecarioReferences: ["README.md"],
	scalingRules: ["feature-folders"],
};

test("createPrototypeMasterDraft produces status=draft", () => {
	const draft = createPrototypeMasterDraft({
		projectId: "idu-pi",
		...validDraft,
	});
	assert.equal(draft.status, "draft");
	assert.equal(draft.projectId, "idu-pi");
});

test("reviewPrototypeMaster moves draft to reviewed", () => {
	const draft = createPrototypeMasterDraft({ projectId: "idu-pi", ...validDraft });
	const reviewed = reviewPrototypeMaster(draft);
	assert.equal(reviewed.status, "reviewed");
});

test("approvePrototypeMaster requires reviewed status", () => {
	const draft = createPrototypeMasterDraft({ projectId: "idu-pi", ...validDraft });
	assert.throws(
		() => approvePrototypeMaster(draft, "reviewer-1"),
		/cannot approve a prototype in status 'draft'/i,
	);
});

test("approvePrototypeMaster from reviewed sets approved and approver", () => {
	const draft = createPrototypeMasterDraft({ projectId: "idu-pi", ...validDraft });
	const reviewed = reviewPrototypeMaster(draft);
	const approved = approvePrototypeMaster(reviewed, "reviewer-1");
	assert.equal(approved.status, "approved");
	assert.equal(approved.approvedBy, "reviewer-1");
});

test("validatePrototypeMaster rejects missing required fields", () => {
	const result = validatePrototypeMaster({
		projectId: "idu-pi",
		status: "draft",
		productIntent: "",
		visualStyle: "",
		layoutBase: "",
		stackRecommendation: { packageManager: "unknown", runtime: "" },
		alternativesDiscarded: [],
		dependencies: { allowed: [], risky: [] },
		motionRules: [],
		uiPatterns: [],
		forbiddenPatterns: [],
		bibliotecarioReferences: [],
		scalingRules: [],
	});
	assert.equal(result.ok, false);
	assert.ok(result.missingFields.length > 0);
});

test("validatePrototypeMaster accepts a complete draft", () => {
	const draft = createPrototypeMasterDraft({ projectId: "idu-pi", ...validDraft });
	const result = validatePrototypeMaster(draft);
	assert.equal(result.ok, true);
	assert.deepEqual(result.missingFields, []);
});

test("approvePrototypeMaster rejects a draft that fails validation", () => {
	const draft = createPrototypeMasterDraft({ projectId: "idu-pi", ...validDraft });
	const reviewed = reviewPrototypeMaster(draft);
	const invalid: typeof reviewed = {
		...reviewed,
		productIntent: "",
	};
	assert.throws(
		() => approvePrototypeMaster(invalid, "reviewer-1"),
		/validation/i,
	);
});
