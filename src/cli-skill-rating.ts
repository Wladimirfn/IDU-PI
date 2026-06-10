// cli-skill-rating.ts
// B1 thin slice: REQ-B1-4 — idu-skill-rating CLI command wrapper.
// Parses <proposalId> <score> from argv, validates the score, calls
// recordSkillRating, and formats the result for stdout/stderr output.

import { parseSkillScore, recordSkillRating } from "./skill-rating.js";
import type { SkillRecommendation } from "./skill-rating-types.js";

export type SkillRatingCliResult =
	| {
			ok: true;
			proposalId: string;
			score: number;
			recommendation: SkillRecommendation;
	  }
	| {
			ok: false;
			error: string;
			exitCode: number;
	  };

/**
 * Run the idu-skill-rating CLI flow. Pure-ish: takes the `rest` of the
 * argv (everything after the command name) and the `stateRoot` to use.
 * The stateRoot is typically `activeRuntime.workspaceRoot`.
 */
export function runSkillRating(
	rest: string[],
	options: { stateRoot: string },
): SkillRatingCliResult {
	if (rest.length < 2) {
		return {
			ok: false,
			error: "uso: idu-skill-rating <proposalId> <score>",
			exitCode: 2,
		};
	}
	const [proposalId, scoreRaw] = rest;
	if (!proposalId || proposalId.length === 0) {
		return {
			ok: false,
			error: "uso: idu-skill-rating <proposalId> <score>",
			exitCode: 2,
		};
	}

	// Parse + validate the score.
	let score: ReturnType<typeof parseSkillScore>;
	try {
		score = parseSkillScore(scoreRaw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: message,
			exitCode: 2,
		};
	}

	// Call the recorder. Domain errors (e.g., proposal not found) throw;
	// we map them to exit code 3.
	try {
		const result = recordSkillRating({
			proposalId,
			score,
			stateRoot: options.stateRoot,
		});
		return {
			ok: true,
			proposalId: result.proposalId,
			score: result.score,
			recommendation: result.recommendation,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: message,
			exitCode: 3,
		};
	}
}

/**
 * Format a SkillRatingCliResult for stdout/stderr output.
 */
export function formatSkillRating(result: SkillRatingCliResult): string {
	if (!result.ok) {
		return [
			"Skill rating",
			"",
			"Error:",
			result.error,
			"",
			`exit: ${result.exitCode}`,
		].join("\n");
	}
	return [
		"Skill rating",
		"",
		`proposalId:    ${result.proposalId}`,
		`score:         ${result.score}`,
		`recommendation: ${result.recommendation}`,
		"",
		"exit: 0",
	].join("\n");
}
