// skill-rating-types.ts
// B1 thin slice: REQ-B1-2 — pure types for skill rating 0-10.

export type SkillScore = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type SkillRecommendation = "promote" | "archive" | "defer";

export type RecordSkillRatingOptions = {
	proposalId: string;
	score: SkillScore;
	stateRoot: string;
	/**
	 * Override the default `lab_write` projectId (defaults to
	 * "skill-rating"). Tests use this to assert event payload fields.
	 */
	projectId?: string;
};

export type RecordSkillRatingResult = {
	proposalId: string;
	score: SkillScore;
	recommendation: SkillRecommendation;
	events: {
		labWrite: boolean;
		skillArchiveReason: boolean;
	};
};
