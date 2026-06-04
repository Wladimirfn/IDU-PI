import { basename } from "node:path";
import {
	createSkillImprovementProposals,
	type SkillImprovementCreationResult,
	type SkillImprovementProposal,
} from "./skill-improvement-proposals.js";
import {
	createSkillDraftsFromApprovedProposals,
	type SkillDraft,
	type SkillDraftCreationResult,
	type SkillDraftOmittedProposal,
} from "./skill-drafts.js";
import {
	saveSemanticCompactionDraft,
	type SaveSemanticCompactionDraftInput,
	type SaveSemanticCompactionDraftResult,
} from "./semantic-compaction.js";

export type SkillDraftFromLessonsMode = "proposal-only" | "approved-only";

export type SkillDraftFromLessonsResult = {
	mode: SkillDraftFromLessonsMode;
	selector: string;
	semanticDraftPath?: string;
	proposalsPath?: string;
	skillDraftPath?: string;
	createdProposals: SkillImprovementProposal[];
	createdDrafts: SkillDraft[];
	omittedProposals: SkillDraftOmittedProposal[];
	nextActions: string[];
	requiredActions: string[];
	allowedToProceed: false;
	advisoryOnly: true;
	safeNotes: string[];
};

type Dependencies = {
	createSemanticCompactionDraft?: () => SaveSemanticCompactionDraftResult;
	createSkillImprovementProposals?: (
		selector: string,
	) => SkillImprovementCreationResult;
	createSkillDraftsFromApprovedProposals?: (
		selector: string,
	) => SkillDraftCreationResult;
};

export type SkillDraftFromLessonsInput = Dependencies & {
	mode?: SkillDraftFromLessonsMode;
	selector?: string;
	reportsPath: string;
	semanticCompactionInput?: SaveSemanticCompactionDraftInput;
};

export function createSkillDraftFromLessons(
	input: SkillDraftFromLessonsInput,
): SkillDraftFromLessonsResult {
	const mode = input.mode ?? "proposal-only";
	if (mode === "approved-only") return createFromApprovedProposals(input);
	return createProposalsFromLessons(input);
}

function createProposalsFromLessons(
	input: SkillDraftFromLessonsInput,
): SkillDraftFromLessonsResult {
	const semanticDraft = resolveSemanticDraft(input);
	const selector = input.selector ?? semanticDraft.path;
	const proposalCreator =
		input.createSkillImprovementProposals ??
		((pathOrLatest: string) =>
			createSkillImprovementProposals(pathOrLatest, input.reportsPath));
	const proposals = proposalCreator(selector);
	return {
		mode: "proposal-only",
		selector,
		semanticDraftPath: semanticDraft.path,
		proposalsPath: proposals.path,
		createdProposals: proposals.created,
		createdDrafts: [],
		omittedProposals: [],
		nextActions: nextProposalActions(proposals),
		requiredActions: [
			"Review skill improvement proposals.",
			"Approve an explicit proposal before generating skill drafts.",
		],
		allowedToProceed: false,
		advisoryOnly: true,
		safeNotes: safeNotes(),
	};
}

function createFromApprovedProposals(
	input: SkillDraftFromLessonsInput,
): SkillDraftFromLessonsResult {
	const selector = input.selector ?? "latest";
	const draftCreator =
		input.createSkillDraftsFromApprovedProposals ??
		((pathOrLatest: string) =>
			createSkillDraftsFromApprovedProposals(pathOrLatest, input.reportsPath));
	const drafts = draftCreator(selector);
	return {
		mode: "approved-only",
		selector,
		skillDraftPath: drafts.path,
		createdProposals: [],
		createdDrafts: drafts.created,
		omittedProposals: drafts.omittedProposals,
		nextActions: nextDraftActions(drafts),
		requiredActions: [
			"Review generated skill drafts.",
			"Run AgentLab review explicitly if the orchestrator needs audit evidence.",
			"Apply or install skills only after human approval.",
		],
		allowedToProceed: false,
		advisoryOnly: true,
		safeNotes: safeNotes(),
	};
}

function resolveSemanticDraft(
	input: SkillDraftFromLessonsInput,
): SaveSemanticCompactionDraftResult {
	if (input.selector) {
		return {
			path: input.selector,
			prompt: "",
			draft: {
				generatedAt: "",
				projectId: "",
				warning: "Borrador IA. No es fuente de verdad.",
				sourceAuditRunIds: [],
				inputSummary: {},
				preservedRules: [],
				criticalBugs: [],
				humanDecisions: [],
				reusableLessons: [],
				architecturalRisks: [],
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
				suggestedRuleUpdates: [],
				suggestedSkillUpdates: [],
				suggestedMemoryItems: [],
				suggestedAgentTasks: [],
				noiseToIgnore: [],
				openQuestions: [],
			},
		};
	}
	if (input.createSemanticCompactionDraft) {
		return input.createSemanticCompactionDraft();
	}
	if (!input.semanticCompactionInput) {
		throw new Error(
			"semanticCompactionInput is required when selector is omitted.",
		);
	}
	return saveSemanticCompactionDraft(input.semanticCompactionInput);
}

function nextProposalActions(result: SkillImprovementCreationResult): string[] {
	if (!result.created.length) {
		return [
			"No skill improvement proposals were created from the selected lessons.",
			"Run semantic compaction again after more failure evidence is recorded.",
		];
	}
	const file = result.path ? basename(result.path) : "latest";
	return [
		`Review ${file}.`,
		"Approve a proposal with idu_skill_improvements_approve before draft generation.",
		"Then run idu_skill_draft_from_lessons with mode approved-only.",
	];
}

function nextDraftActions(result: SkillDraftCreationResult): string[] {
	if (!result.created.length) {
		return [
			"No skill drafts were created because no approved applicable proposals were found.",
			"Approve a create/improve/validate skill proposal first.",
		];
	}
	const file = result.path ? basename(result.path) : "latest";
	return [
		`Review ${file}.`,
		"Optionally create an explicit AgentLab skill-draft review request.",
		"Apply or install the skill only after human approval.",
	];
}

function safeNotes(): string[] {
	return [
		"Advisory-only: Idu-pi generated reports/drafts only.",
		"No modifiqué skills reales, .agents ni .atl.",
		"No ejecuté AgentLabs automáticamente.",
		"No hice commit ni push.",
	];
}
