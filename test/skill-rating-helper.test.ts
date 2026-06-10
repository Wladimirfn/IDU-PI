import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	recommendationFromScore,
	parseSkillScore,
} from "../src/skill-rating.js";
import type { SkillScore } from "../src/skill-rating.js";

describe("skill-rating-helper", () => {
	describe("recommendationFromScore", () => {
		it('returns "promote" for scores 7, 8, 9, 10', () => {
			assert.equal(recommendationFromScore(7 as SkillScore), "promote");
			assert.equal(recommendationFromScore(8 as SkillScore), "promote");
			assert.equal(recommendationFromScore(9 as SkillScore), "promote");
			assert.equal(recommendationFromScore(10 as SkillScore), "promote");
		});

		it('returns "archive" for scores 0, 1, 2, 3', () => {
			assert.equal(recommendationFromScore(0 as SkillScore), "archive");
			assert.equal(recommendationFromScore(1 as SkillScore), "archive");
			assert.equal(recommendationFromScore(2 as SkillScore), "archive");
			assert.equal(recommendationFromScore(3 as SkillScore), "archive");
		});

		it('returns "defer" for scores 4, 5, 6', () => {
			assert.equal(recommendationFromScore(4 as SkillScore), "defer");
			assert.equal(recommendationFromScore(5 as SkillScore), "defer");
			assert.equal(recommendationFromScore(6 as SkillScore), "defer");
		});
	});

	describe("parseSkillScore", () => {
		it('accepts "0" through "10" and returns the corresponding SkillScore', () => {
			for (let i = 0; i <= 10; i++) {
				assert.equal(parseSkillScore(String(i)), i);
			}
		});

		it('rejects non-numeric input ("abc", "3.5")', () => {
			assert.throws(() => parseSkillScore("abc"), /score must be/iu);
			assert.throws(() => parseSkillScore("3.5"), /score must be/iu);
		});

		it('rejects out-of-range integers ("-1", "11", "100")', () => {
			assert.throws(() => parseSkillScore("-1"), /score must be in 0\.\.10/iu);
			assert.throws(() => parseSkillScore("11"), /score must be in 0\.\.10/iu);
			assert.throws(() => parseSkillScore("100"), /score must be in 0\.\.10/iu);
		});
	});
});
