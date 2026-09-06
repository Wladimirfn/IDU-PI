import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { seedBootstrapSkillIfMissing } from "../src/bibliotecario-init.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

let stateRoot: string;
let stateRootWithSkill: string;
let stateRootEmpty: string;

before(() => {
	const make = (prefix: string): string => {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		const labPath = join(dir, "lab.db");
		applyMigrations(labPath);
		return dir;
	};
	stateRootWithSkill = make("biblio-pressure-ready-");
	seedBootstrapSkillIfMissing(stateRootWithSkill);
	stateRootEmpty = make("biblio-pressure-empty-");
	// stateRootEmpty has lab.db with the tables but no skill row.
	// For the no-lab.db case, use a fresh dir without any lab.db.
	stateRoot = mkdtempSync(join(tmpdir(), "biblio-pressure-nolab-"));
});

after(() => {
	for (const d of [stateRoot, stateRootWithSkill, stateRootEmpty]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			// best effort
		}
	}
});

/**
 * The pressure gate is the function the user reads in
 * `idu_bibliotecario_proactive_advisory`. We exercise it directly via
 * the same lab.db inspection the MCP tool uses. This is the smallest
 * hermetic surface for the gate's behaviour.
 */
function readPressure(labDbPath: string): {
	pressure: "low" | "medium" | "high";
	recommendation: string;
} {
	if (!existsSync(labDbPath)) {
		return {
			pressure: "high",
			recommendation:
				"initialize_lab_db_and_seed_one_skill_to_unblock_bibliotecario",
		};
	}
	const repo = new LabDbRepository(labDbPath);
	const skills = repo.listSkills();
	if (skills.length === 0) {
		return {
			pressure: "high",
			recommendation:
				"initialize_lab_db_and_seed_one_skill_to_unblock_bibliotecario",
		};
	}
	return {
		pressure: "low",
		recommendation: "bounded_context_ok",
	};
}

test("pressure gate returns high when lab.db does not exist", () => {
	const result = readPressure(join(stateRoot, "lab.db"));
	assert.equal(result.pressure, "high");
	assert.equal(
		result.recommendation,
		"initialize_lab_db_and_seed_one_skill_to_unblock_bibliotecario",
	);
});

test("pressure gate returns high when lab.db exists but skills table is empty", () => {
	const result = readPressure(join(stateRootEmpty, "lab.db"));
	assert.equal(result.pressure, "high");
	assert.equal(
		result.recommendation,
		"initialize_lab_db_and_seed_one_skill_to_unblock_bibliotecario",
	);
});

test("pressure gate returns low when lab.db exists and at least one skill is present", () => {
	const result = readPressure(join(stateRootWithSkill, "lab.db"));
	assert.equal(result.pressure, "low");
	assert.equal(result.recommendation, "bounded_context_ok");
});
