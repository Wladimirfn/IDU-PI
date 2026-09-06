// skill-rating.ts
// B1 thin slice: REQ-B1-2 + REQ-B1-3 + REQ-B1-5 — pure helper, parser,
// and end-to-end recorder for skill rating 0-10.

import { join } from "node:path";
import { initLabDb, runSql, sqlInteger, sqlString } from "./lab-db.js";
import { appendEvent, appendLabWriteEvent } from "./event-bus.js";
import type {
	RecordSkillRatingOptions,
	RecordSkillRatingResult,
	SkillRecommendation,
	SkillScore,
} from "./skill-rating-types.js";

export type {
	RecordSkillRatingOptions,
	RecordSkillRatingResult,
	SkillRecommendation,
	SkillScore,
};

/**
 * REQ-B1-2: Pure function that returns a recommendation based on the score.
 * - score >= 7 → "promote"
 * - score < 4 → "archive"
 * - 4 <= score <= 6 → "defer"
 */
export function recommendationFromScore(
	score: SkillScore,
): SkillRecommendation {
	if (score >= 7) return "promote";
	if (score < 4) return "archive";
	return "defer";
}

/**
 * Parse a string into a SkillScore. Throws if the input is not a valid
 * integer in the range 0..10.
 */
export function parseSkillScore(raw: string): SkillScore {
	const n = Number(raw);

	// Reject non-numeric input (including decimals like "3.5")
	if (!Number.isFinite(n) || !Number.isInteger(n)) {
		throw new Error(`score must be a number, got "${raw}"`);
	}

	// Check range
	if (n < 0 || n > 10) {
		throw new Error(`score must be in 0..10, got ${n}`);
	}

	return n as SkillScore;
}

/**
 * REQ-B1-3 + REQ-B1-5: open the project lab.db, look up the proposal by
 * id, validate the score, update the score column, emit a `lab_write`
 * event, and (when the recommendation is "archive") emit a second
 * `skill_archive_reason` event. Returns the recommendation.
 *
 * Throws "proposal not found: <id>" if the proposal id is not in
 * `bibliotecario_proposals`. Throws "score must be in 0..10, got <n>"
 * if the score is out of range.
 */
export function recordSkillRating(
	options: RecordSkillRatingOptions,
): RecordSkillRatingResult {
	const { proposalId, score, stateRoot } = options;
	const projectId = options.projectId ?? "skill-rating";

	// Validate score up front (defense in depth, even though the
	// type system already constrains it to 0..10).
	if (!Number.isInteger(score) || score < 0 || score > 10) {
		throw new Error(`score must be in 0..10, got ${score}`);
	}

	// 1. Ensure the schema is up-to-date (runs the B1 migration on first call).
	const dbPath = join(stateRoot, "lab.db");
	initLabDb(dbPath);

	// 2. Look up the proposal by id.
	const lookupSql = `SELECT id FROM bibliotecario_proposals WHERE id = ${sqlString(proposalId)};`;
	const lookupRaw = runSql(dbPath, lookupSql).trim();
	if (!lookupRaw) {
		throw new Error(`proposal not found: ${proposalId}`);
	}
	const lookupRows = JSON.parse(lookupRaw) as Array<{ id: string }>;
	if (lookupRows.length === 0) {
		throw new Error(`proposal not found: ${proposalId}`);
	}

	// 3. Update the score column.
	const updateSql = `UPDATE bibliotecario_proposals SET score = ${sqlInteger(score, "score")} WHERE id = ${sqlString(proposalId)};`;
	runSql(dbPath, updateSql);

	// 4. Emit the lab_write event (REQ-B1-5).
	appendLabWriteEvent(
		stateRoot,
		{
			table: "bibliotecario_proposals",
			operation: "update",
			rowId: proposalId,
		},
		projectId,
	);

	// 5. Compute the recommendation and (if archive) emit the second event.
	const recommendation = recommendationFromScore(score);
	if (recommendation === "archive") {
		appendEvent(stateRoot, {
			ts: new Date().toISOString(),
			kind: "skill_archive_reason",
			projectId,
			payload: { proposalId, score, threshold: 4 },
			sourceRef: "skill-rating",
			evidenceRefs: [],
		});
	}

	return {
		proposalId,
		score,
		recommendation,
		events: {
			labWrite: true,
			skillArchiveReason: recommendation === "archive",
		},
	};
}
