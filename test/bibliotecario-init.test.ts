import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { makeTempDir } from "./helpers/temp.js";
import { seedBootstrapSkillIfMissing } from "../src/bibliotecario-init.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

describe("T2.3 — seedBootstrapSkillIfMissing", () => {
	let tempDir: string;
	let dbPath: string;
	let repo: LabDbRepository;

	beforeEach(() => {
		tempDir = makeTempDir("bibliotecario-init-");
		dbPath = join(tempDir, "lab.db");
		repo = new LabDbRepository(dbPath, {
			bibliotecarioProjectId: "test-project",
		});
		repo.init();
	});

	it("returns null when stateRoot does not exist", () => {
		const nonExistentPath = join(tempDir, "does-not-exist");
		const result = seedBootstrapSkillIfMissing(nonExistentPath);
		assert.equal(result, null);
	});

	it("returns null when lab.db does not exist in stateRoot", () => {
		// Use a completely fresh directory without any lab.db
		const freshDir = makeTempDir("bibliotecario-init-empty-");
		const result = seedBootstrapSkillIfMissing(freshDir);
		assert.equal(result, null);
	});

	it("inserts bootstrap skill when skills table is empty", () => {
		const result = seedBootstrapSkillIfMissing(tempDir);

		assert.notEqual(result, null);
		assert.equal(result!.name, "bibliotecario-bootstrap");
		assert.equal(result!.version, "0.0.0");
		assert.equal(result!.status, "draft");

		// Verify the skill is in the database
		const skills = repo.listSkills();
		assert.equal(skills.length, 1);
		assert.equal(skills[0].name, "bibliotecario-bootstrap");
	});

	it("is idempotent: does not duplicate when bootstrap skill already exists", () => {
		// First call should insert
		const first = seedBootstrapSkillIfMissing(tempDir);
		assert.notEqual(first, null);
		assert.equal(first!.name, "bibliotecario-bootstrap");

		// Second call should return the existing skill
		const second = seedBootstrapSkillIfMissing(tempDir);
		assert.notEqual(second, null);
		assert.equal(second!.name, "bibliotecario-bootstrap");
		assert.equal(second!.id, first!.id, "Should return the same skill ID");

		// Verify only one skill in database
		const skills = repo.listSkills();
		assert.equal(skills.length, 1, "Should not duplicate the bootstrap skill");
	});

	it("returns existing skill when other skills are present but bootstrap is missing", () => {
		// Add a different skill first
		repo.appendSkill({
			id: "skill-other",
			name: "other-skill",
			version: "1.0.0",
			status: "draft",
		});

		// seedBootstrapSkillIfMissing should still insert the bootstrap skill
		const result = seedBootstrapSkillIfMissing(tempDir);
		assert.notEqual(result, null);
		assert.equal(result!.name, "bibliotecario-bootstrap");

		// Verify both skills are in the database
		const skills = repo.listSkills();
		assert.equal(skills.length, 2);
		const bootstrapSkill = skills.find((s) => s.name === "bibliotecario-bootstrap");
		assert.ok(bootstrapSkill, "Bootstrap skill should be present");
	});

	it("returns existing bootstrap skill even when other skills are present", () => {
		// First, seed the bootstrap skill
		const first = seedBootstrapSkillIfMissing(tempDir);
		assert.notEqual(first, null);

		// Add another skill
		repo.appendSkill({
			id: "skill-other",
			name: "other-skill",
			version: "1.0.0",
			status: "draft",
		});

		// Second call should return the existing bootstrap skill
		const second = seedBootstrapSkillIfMissing(tempDir);
		assert.notEqual(second, null);
		assert.equal(second!.id, first!.id, "Should return the same bootstrap skill");

		// Verify both skills are still in the database
		const skills = repo.listSkills();
		assert.equal(skills.length, 2);
	});
});
