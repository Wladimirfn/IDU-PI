import { join } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import {
	scoreSkillsForTask,
	type SkillIndexEntry,
} from "./skills-index.js";

const SKILLS_INDEX_DEFAULT_RATING = 7;

export function loadSkillsIndexFromLabDb(stateRoot: string): SkillIndexEntry[] {
	const repo = new LabDbRepository(join(stateRoot, "lab.db"));
	const rows = repo.listSkillIndex();
	return rows.map((row) => ({
		skillId: row.id,
		name: row.name,
		summary: row.description?.trim() ?? "",
		path: row.path,
		rating: SKILLS_INDEX_DEFAULT_RATING,
	}));
}

export function loadSkillsForTask(
	stateRoot: string,
	taskDescription: string,
): SkillIndexEntry[] {
	const index = loadSkillsIndexFromLabDb(stateRoot);
	return scoreSkillsForTask(index, taskDescription);
}
