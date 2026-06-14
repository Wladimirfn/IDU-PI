import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import {
	loadSkillsForTask,
	loadSkillsIndexFromLabDb,
} from "../src/skills-index-runtime.js";

function makeRepoWithIndex(): string {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-b1b-skills-"));
	const repo = new LabDbRepository(join(stateRoot, "lab.db"));
	repo.init();
	repo.appendSkillIndex({
		id: "skill-onboarding",
		name: "Onboarding Helper",
		path: "/skills/onboarding",
		source: "global",
		description: "Onboarding and documentation reviews for new agents",
		priority: 80,
		fingerprint: null,
	});
	repo.appendSkillIndex({
		id: "skill-billing",
		name: "Billing Audit",
		path: "/skills/billing",
		source: "project",
		description: "Specializes in billing flows and reports",
		priority: 90,
		fingerprint: null,
	});
	repo.appendSkillIndex({
		id: "skill-unrelated",
		name: "Generic Logger",
		path: "/skills/logger",
		source: "project",
		description: "Logs events",
		priority: 100,
		fingerprint: null,
	});
	return stateRoot;
}

test("loadSkillsIndexFromLabDb returns skill_index entries with default rating", () => {
	const stateRoot = makeRepoWithIndex();
	try {
		const entries = loadSkillsIndexFromLabDb(stateRoot);
		assert.equal(entries.length, 3);
		for (const entry of entries) {
			assert.equal(entry.rating, 7);
			assert.ok(typeof entry.skillId === "string");
			assert.ok(typeof entry.name === "string");
			assert.ok(typeof entry.summary === "string");
			assert.ok(typeof entry.path === "string");
		}
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("loadSkillsForTask ranks skills by score and empty result for unrelated task", () => {
	const stateRoot = makeRepoWithIndex();
	try {
		const ranked = loadSkillsForTask(stateRoot, "review onboarding documentation");
		assert.ok(ranked.length > 0, "expected at least one match for onboarding");
		assert.equal(
			ranked[0]?.skillId,
			"skill-onboarding",
			"onboarding skill should rank first",
		);

		const empty = loadSkillsForTask(stateRoot, "quantify quantum entanglement");
		assert.equal(empty.length, 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
