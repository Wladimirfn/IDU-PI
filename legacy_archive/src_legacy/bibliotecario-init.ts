import { existsSync } from "node:fs";
import { join } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import type { SkillRecord } from "./bibliotecario-types.js";

const BOOTSTRAP_SKILL_NAME = "bibliotecario-bootstrap";
const BOOTSTRAP_SKILL_VERSION = "0.0.0";
const BOOTSTRAP_SKILL_STATUS = "draft" as const;

/**
 * Seeds the bootstrap skill if it doesn't already exist.
 * 
 * @param stateRoot - The project state root directory
 * @returns The bootstrap skill record, or null if the stateRoot doesn't exist
 *          or doesn't contain a lab.db
 * 
 * This function is idempotent: calling it multiple times will not duplicate
 * the bootstrap skill. If a skill with name "bibliotecario-bootstrap" already
 * exists, it returns the existing skill without inserting a new one.
 */
export function seedBootstrapSkillIfMissing(stateRoot: string): SkillRecord | null {
	// Check if stateRoot exists and contains a lab.db
	if (!existsSync(stateRoot)) {
		return null;
	}

	const dbPath = join(stateRoot, "lab.db");
	if (!existsSync(dbPath)) {
		return null;
	}

	// Create a repository pointing to this lab.db
	const repo = new LabDbRepository(dbPath);

	// Check if bootstrap skill already exists
	const skills = repo.listSkills();
	const existingBootstrap = skills.find((skill) => skill.name === BOOTSTRAP_SKILL_NAME);
	
	if (existingBootstrap) {
		// Bootstrap skill already exists, return it
		return existingBootstrap;
	}

	// Bootstrap skill doesn't exist, insert it
	const bootstrapSkill = repo.appendSkill({
		id: "bootstrap",
		name: BOOTSTRAP_SKILL_NAME,
		version: BOOTSTRAP_SKILL_VERSION,
		status: BOOTSTRAP_SKILL_STATUS,
	});

	return bootstrapSkill;
}
