export const SKILLS_INDEX_PACK_CAP = 20;
const SKILLS_INDEX_SUMMARY_CAP = 200;
const SKILLS_INDEX_MIN_RATING = 7;

export type SkillIndexEntry = {
	skillId: string;
	name: string;
	summary: string;
	path: string;
	rating: number;
};

export type SkillIndexDbRow = {
	id: string;
	name: string;
	path: string;
	description: string | null;
	active: number | boolean;
	rating: number;
};

export type SkillIndexDb = {
	prepare: (sql: string) => {
		all: () => SkillIndexDbRow[];
	};
};

export function scoreByTerms(
	entry: { name: string; summary: string },
	terms: string[],
): number {
	if (terms.length === 0) return 0;
	const haystack = `${entry.name} ${entry.summary}`.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (haystack.includes(term)) score += 1;
	}
	return score;
}

export function buildSkillsIndex(db: SkillIndexDb): SkillIndexEntry[] {
	const rows = db
		.prepare(
			"SELECT id, name, path, description, active, rating FROM skill_index WHERE active = 1 AND rating >= ? ORDER BY rating DESC, name ASC",
		)
		.all();
	const minRating = SKILLS_INDEX_MIN_RATING;
	return rows
		.filter((row) => Boolean(row.active) && row.rating >= minRating)
		.map((row) => ({
			skillId: row.id,
			name: row.name,
			summary: (row.description ?? "").trim(),
			path: row.path,
			rating: row.rating,
		}));
}

export function scoreSkillsForTask(
	index: SkillIndexEntry[],
	taskDescription: string,
): SkillIndexEntry[] {
	const terms = uniqueTermsFor(taskDescription);
	if (terms.length === 0) return [...index];
	return [...index]
		.map((entry) => ({
			entry,
			score: scoreByTerms(entry, terms),
		}))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || b.entry.rating - a.entry.rating)
		.map((row) => row.entry);
}

export function packSkillsIndex(entries: SkillIndexEntry[]): SkillIndexEntry[] {
	return entries.slice(0, SKILLS_INDEX_PACK_CAP).map((entry) => ({
		...entry,
		summary: entry.summary.slice(0, SKILLS_INDEX_SUMMARY_CAP),
	}));
}

function uniqueTermsFor(value: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const tokens = value
		.toLowerCase()
		.split(/[^\p{L}\p{N}_-]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);
	for (const token of tokens) {
		if (!seen.has(token)) {
			seen.add(token);
			out.push(token);
		}
	}
	return out;
}
