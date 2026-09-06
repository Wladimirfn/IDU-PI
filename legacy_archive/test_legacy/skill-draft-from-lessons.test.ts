import assert from "node:assert/strict";
import { test } from "node:test";
import { createSkillDraftFromLessons } from "../src/skill-draft-from-lessons.js";
import type { SaveSemanticCompactionDraftResult } from "../src/semantic-compaction.js";
import type { SkillImprovementCreationResult } from "../src/skill-improvement-proposals.js";
import type { SkillDraftCreationResult } from "../src/skill-drafts.js";

const semanticDraft: SaveSemanticCompactionDraftResult = {
	path: "reports/semantic-compaction-draft-20260604-120000.json",
	prompt: "safe prompt",
	draft: {
		projectId: "idu-pi",
		generatedAt: "2026-06-04T12:00:00.000Z",
		warning: "Borrador IA. No es fuente de verdad.",
		sourceAuditRunIds: ["audit-1"],
		inputSummary: { source: "test" },
		preservedRules: [],
		criticalBugs: [],
		humanDecisions: [],
		reusableLessons: ["CI needs hermetic env fixtures"],
		architecturalRisks: [],
		suggestedRuleUpdates: [],
		suggestedSkillUpdates: ["create CI hermetic testing skill"],
		suggestedMemoryItems: [],
		suggestedAgentTasks: [],
		noiseToIgnore: [],
		openQuestions: [],
		classifierQualityReview: {
			emotionCorrect: "likely_ok",
			categoryCorrect: "likely_ok",
			priorityCorrect: "likely_ok",
			intentCorrect: "likely_ok",
			guardrailCorrect: "likely_ok",
			falsePositives: [],
			falseNegatives: [],
			errorPatterns: [],
			recommendedRules: [],
		},
		misclassifiedExamples: [],
	},
};

const proposalResult: SkillImprovementCreationResult = {
	path: "reports/skill-improvement-proposals-20260604-120001.json",
	created: [
		{
			id: "skill-improvement-001",
			type: "create_skill",
			skillName: "ci-hermetic-testing",
			title: "Create CI hermetic testing skill",
			description: "Capture CI hermetic testing lessons.",
			evidence: ["CI needs hermetic env fixtures"],
			sourceDraftPath: semanticDraft.path,
			riskLevel: "medium",
			expectedBenefit: ["quality", "safety"],
			requiresHumanApproval: true,
			suggestedAction: "approve_for_agent_review",
			status: "proposed",
			createdAt: "2026-06-04T12:00:01.000Z",
		},
	],
	plan: {
		draftPath: semanticDraft.path,
		sourceDraftPath: semanticDraft.path,
		draftName: "semantic-compaction-draft-20260604-120000.json",
		projectId: "idu-pi",
		validDraft: true,
		errors: [],
		skillRegistry: [],
		proposals: [],
	},
};

const draftResult: SkillDraftCreationResult = {
	path: "reports/skill-draft-20260604-120002.json",
	created: [
		{
			proposalId: "skill-improvement-001",
			action: "create_skill",
			skillName: "ci-hermetic-testing",
			title: "CI Hermetic Testing",
			purpose: "Prevent non-hermetic CI failures.",
			whenToUse: "Use before changing CI or tests.",
			safetyRules: ["Do not mutate repo .env"],
			inputsExpected: ["Failure logs"],
			outputsExpected: ["Hermetic test plan"],
			testsSuggested: ["Run tests without env vars"],
			contentPreview: "# CI Hermetic Testing",
			requiresHumanApproval: true,
		},
	],
	omittedProposals: [],
	notApplicable: [],
	plan: {
		generatedAt: "2026-06-04T12:00:02.000Z",
		sourceProposalFile: "skill-improvement-proposals-20260604-120001.json",
		warning: "Borrador de skill. No es fuente de verdad.",
		skillDrafts: [],
		omittedProposals: [],
	},
};

test("proposal-only creates semantic draft and skill proposals without skill drafts", () => {
	let draftCalls = 0;
	let proposalSelector = "";
	let draftCreateCalls = 0;
	const result = createSkillDraftFromLessons({
		mode: "proposal-only",
		reportsPath: "reports",
		createSemanticCompactionDraft: () => {
			draftCalls += 1;
			return semanticDraft;
		},
		createSkillImprovementProposals: (selector: string) => {
			proposalSelector = selector;
			return proposalResult;
		},
		createSkillDraftsFromApprovedProposals: () => {
			draftCreateCalls += 1;
			return draftResult;
		},
	});

	assert.equal(draftCalls, 1);
	assert.equal(proposalSelector, semanticDraft.path);
	assert.equal(draftCreateCalls, 0);
	assert.equal(result.mode, "proposal-only");
	assert.equal(result.semanticDraftPath, semanticDraft.path);
	assert.equal(result.proposalsPath, proposalResult.path);
	assert.equal(result.skillDraftPath, undefined);
	assert.equal(result.createdProposals.length, 1);
	assert.equal(result.createdDrafts.length, 0);
	assert.equal(result.allowedToProceed, false);
	assert.match(result.nextActions.join("\n"), /approve/i);
});

test("approved-only creates skill drafts from approved proposals without semantic draft", () => {
	let compactionCalls = 0;
	let proposalCalls = 0;
	let draftSelector = "";
	const result = createSkillDraftFromLessons({
		mode: "approved-only",
		selector: "latest",
		reportsPath: "reports",
		createSemanticCompactionDraft: () => {
			compactionCalls += 1;
			return semanticDraft;
		},
		createSkillImprovementProposals: () => {
			proposalCalls += 1;
			return proposalResult;
		},
		createSkillDraftsFromApprovedProposals: (selector: string) => {
			draftSelector = selector;
			return draftResult;
		},
	});

	assert.equal(compactionCalls, 0);
	assert.equal(proposalCalls, 0);
	assert.equal(draftSelector, "latest");
	assert.equal(result.mode, "approved-only");
	assert.equal(result.skillDraftPath, draftResult.path);
	assert.equal(result.createdDrafts.length, 1);
	assert.equal(result.allowedToProceed, false);
	assert.match(result.safeNotes.join("\n"), /No modifiqué skills reales/i);
});
