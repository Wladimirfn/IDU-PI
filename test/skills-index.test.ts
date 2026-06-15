import assert from "node:assert/strict";
import test from "node:test";
import {
	SKILLS_INDEX_PACK_CAP,
	buildSkillsIndex,
	packSkillsIndex,
	scoreByTerms,
	scoreSkillsForTask,
	type SkillIndexEntry,
} from "../src/skills-index.js";

test("scoreByTerms returns zero for no overlap and higher for more overlapping terms", () => {
	const entry = {
		name: "Onboarding",
		summary: "Helps onboard new team members with the agentlab workflow.",
	};
	assert.equal(scoreByTerms(entry, []), 0);
	assert.equal(scoreByTerms(entry, ["python"]), 0);
	assert.equal(scoreByTerms(entry, ["onboard"]), 1);
	const onAndTeam = scoreByTerms(entry, ["onboard", "team", "agentlab"]);
	assert.ok(
		onAndTeam > scoreByTerms(entry, ["onboard"]),
		"more matches must score higher",
	);
});

test("buildSkillsIndex filters to active skills with rating >= 7 only", () => {
	const rows: Array<SkillIndexRow> = [
		{
			id: "1",
			name: "active-strong",
			path: "/skills/active-strong",
			active: true,
			rating: 9,
		},
		{
			id: "2",
			name: "active-medium",
			path: "/skills/active-medium",
			active: true,
			rating: 7,
		},
		{
			id: "3",
			name: "active-weak",
			path: "/skills/active-weak",
			active: true,
			rating: 5,
		},
		{
			id: "4",
			name: "archived-strong",
			path: "/skills/archived-strong",
			active: false,
			rating: 9,
		},
		{
			id: "5",
			name: "active-strong-2",
			path: "/skills/active-strong-2",
			active: true,
			rating: 8,
		},
	];
	const index = buildSkillsIndex(stubDb(rows));
	assert.deepEqual(
		index.map((entry) => entry.skillId),
		["1", "5", "2"],
		"expected active skills with rating >= 7 ordered by rating desc then name asc",
	);
});

test("packSkillsIndex caps to SKILLS_INDEX_PACK_CAP entries and truncates summaries", () => {
	const entries: SkillIndexEntry[] = Array.from({ length: 25 }, (_, i) => ({
		skillId: `s${String(i + 1).padStart(2, "0")}`,
		name: `skill-${i + 1}`,
		summary: "x".repeat(300),
		path: `/skills/s${i + 1}`,
		rating: 10 - i,
	}));
	const packed = packSkillsIndex(entries);
	assert.equal(packed.length, SKILLS_INDEX_PACK_CAP);
	assert.equal(SKILLS_INDEX_PACK_CAP, 20);
	assert.ok(
		packed.every((entry) => entry.summary.length <= 200),
		"summaries should be truncated to 200 chars",
	);
	assert.deepEqual(
		packed.map((entry) => entry.skillId),
		entries.slice(0, 20).map((entry) => entry.skillId),
	);
});

test("scoreSkillsForTask sorts by score descending using scoreByTerms", () => {
	const entries: SkillIndexEntry[] = [
		{
			skillId: "alpha",
			name: "alpha",
			summary: "documentation drafting helper",
			path: "/skills/alpha",
			rating: 7,
		},
		{
			skillId: "beta",
			name: "beta",
			summary: "onboarding and documentation review",
			path: "/skills/beta",
			rating: 7,
		},
		{
			skillId: "gamma",
			name: "gamma",
			summary: "no overlap at all",
			path: "/skills/gamma",
			rating: 10,
		},
	];
	const ranked = scoreSkillsForTask(entries, "review onboarding documentation");
	assert.deepEqual(
		ranked.map((entry) => entry.skillId),
		["beta", "alpha"],
	);
});

type SkillIndexRow = {
	id: string;
	name: string;
	path: string;
	active: boolean;
	rating: number;
};

function stubDb(rows: SkillIndexRow[]): Parameters<typeof buildSkillsIndex>[0] {
	return {
		prepare: (sql: string) => ({
			all: () => {
				if (sql.includes("skill_index")) {
					const filtered = rows
						.filter((row) => row.active && row.rating >= 7)
						.slice()
						.sort((a, b) => {
							if (b.rating !== a.rating) return b.rating - a.rating;
							return a.name.localeCompare(b.name);
						})
						.map((row) => ({
							id: row.id,
							name: row.name,
							path: row.path,
							description: null,
							active: row.active ? 1 : 0,
							rating: row.rating,
						}));
					return filtered;
				}
				return [];
			},
		}),
	} as unknown as Parameters<typeof buildSkillsIndex>[0];
}
