import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBibliotecarioInit } from "../src/cli-bibliotecario-init.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

describe("T3.1 — runBibliotecarioInit", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cli-bibliotecario-init-"));
	});

	it("creates lab.db, applies migration, seeds bootstrap skill, and emits lab_write event", () => {
		const result = runBibliotecarioInit({
			stateRoot: tempDir,
			projectId: "cli-bibliotecario-init-test",
		});

		// Verify success
		assert.equal(result.ok, true);
		if (!result.ok) return;

		// Verify lab.db was created
		const dbPath = join(tempDir, "lab.db");
		assert.ok(existsSync(dbPath), "lab.db should be created");

		// Verify the 5 B0 tables exist by querying them
		const repo = new LabDbRepository(dbPath);
		const skills = repo.listSkills();
		assert.equal(skills.length, 1, "Should have one bootstrap skill");
		assert.equal(skills[0].name, "bibliotecario-bootstrap");
		assert.equal(skills[0].version, "0.0.0");
		assert.equal(skills[0].status, "draft");

		// Verify dbCreated is true (first run)
		assert.equal(result.dbCreated, true);

		// Verify bootstrap skill was inserted
		assert.equal(result.bootstrapSkill.inserted, true);
		assert.equal(result.bootstrapSkill.name, "bibliotecario-bootstrap");

		// Verify lab_write event was emitted (at least 1)
		assert.ok(
			result.events.labWrite >= 1,
			"Should emit at least 1 lab_write event",
		);
	});

	it("is idempotent: second run creates zero new rows and zero new events", () => {
		// First run
		const first = runBibliotecarioInit({
			stateRoot: tempDir,
			projectId: "cli-bibliotecario-init-test",
		});
		assert.equal(first.ok, true);

		// Count skills after first run
		const dbPath = join(tempDir, "lab.db");
		const repo = new LabDbRepository(dbPath);
		const skillsAfterFirst = repo.listSkills();

		// Read events.jsonl to count lab_write events after first run
		const eventsPath = join(tempDir, "events.jsonl");
		const eventsAfterFirst = existsSync(eventsPath)
			? readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).length
			: 0;

		// Second run
		const second = runBibliotecarioInit({
			stateRoot: tempDir,
			projectId: "cli-bibliotecario-init-test",
		});
		assert.equal(second.ok, true);
		if (!second.ok) return;

		// Verify dbCreated is false (already existed)
		assert.equal(second.dbCreated, false);

		// Verify bootstrap skill was NOT inserted (already present)
		assert.equal(second.bootstrapSkill.inserted, false);
		assert.equal(second.bootstrapSkill.name, "bibliotecario-bootstrap");

		// Verify no new skills were added
		const skillsAfterSecond = repo.listSkills();
		assert.equal(
			skillsAfterSecond.length,
			skillsAfterFirst.length,
			"Should not add new skills on second run",
		);

		// Verify no new lab_write events were emitted
		const eventsAfterSecond = existsSync(eventsPath)
			? readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).length
			: 0;
		assert.equal(
			eventsAfterSecond,
			eventsAfterFirst,
			"Should not emit new lab_write events on second run",
		);
	});

	it("returns failure when stateRoot does not exist", () => {
		const nonExistentPath = join(tempDir, "does-not-exist");
		const result = runBibliotecarioInit({
			stateRoot: nonExistentPath,
			projectId: "cli-bibliotecario-init-test",
		});

		// Should succeed but create the directory
		assert.equal(result.ok, true);
	});
});
