import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { loadSkillsIndexFromLabDb } from "../src/skills-index-runtime.js";
import { packSkillsIndex, SKILLS_INDEX_PACK_CAP } from "../src/skills-index.js";

function makeStateRootWithSkillIndex(): {
	stateRoot: string;
	cleanup: () => void;
} {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-b1c-pack-"));
	const repo = new LabDbRepository(join(stateRoot, "lab.db"));
	repo.init();
	repo.appendSkillIndex({
		id: "skill-onboarding",
		name: "Onboarding Helper",
		path: "/skills/onboarding",
		source: "global",
		description: "Onboarding and documentation reviews",
		priority: 80,
		fingerprint: null,
	});
	repo.appendSkillIndex({
		id: "skill-billing",
		name: "Billing Audit",
		path: "/skills/billing",
		source: "project",
		description: "Specializes in billing flows",
		priority: 90,
		fingerprint: null,
	});
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

test("loadSkillsIndexFromLabDb returns packed entries capped at 20 with truncated summaries", () => {
	const { stateRoot, cleanup } = makeStateRootWithSkillIndex();
	try {
		const entries = loadSkillsIndexFromLabDb(stateRoot);
		const packed = packSkillsIndex(entries);
		assert.ok(packed.length > 0);
		assert.ok(packed.length <= SKILLS_INDEX_PACK_CAP);
		for (const entry of packed) {
			assert.ok(typeof entry.skillId === "string");
			assert.ok(entry.summary.length <= 200);
		}
	} finally {
		cleanup();
	}
});

test("loadSkillsIndexFromLabDb returns empty list when no skill_index rows exist", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-b1c-empty-"));
	try {
		const entries = loadSkillsIndexFromLabDb(stateRoot);
		const packed = packSkillsIndex(entries);
		assert.deepEqual(packed, []);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
