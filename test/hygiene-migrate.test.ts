import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateHygieneLayout } from "../src/hygiene-migrate.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-hygiene-migrate-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-state-"));
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function writeJSON(path: string, obj: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

// =========================================================================
// Config migration
// =========================================================================

test("migrateHygieneLayout: moves 4 governance files from <repo>/config/ to <repo>/.idu/config/", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });
		writeJSON(join(repoRoot, "config", "project-constitution.json"), { name: "const" });
		writeJSON(join(repoRoot, "config", "project-blueprint.json"), { name: "bp" });
		writeJSON(join(repoRoot, "config", "project-flows.json"), { name: "flows" });

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Result shape
		assert.equal(result.moved.length, 4);
		assert.equal(result.skipped.length, 0);
		assert.equal(result.errors.length, 0);

		// All 4 files are in .idu/config/
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-core.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-constitution.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-blueprint.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-flows.json")));

		// Legacy config/ is gone
		assert.ok(!existsSync(join(repoRoot, "config", "project-core.json")));
		assert.ok(!existsSync(join(repoRoot, "config")));

		// Content preserved
		assert.equal(
			JSON.parse(readFileSync(join(repoRoot, ".idu", "config", "project-core.json"), "utf8")).name,
			"core",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: is a no-op when <repo>/.idu/config/ already exists (skipped with reason)", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// .idu/config/ already exists (pre-created)
		writeJSON(join(repoRoot, ".idu", "config", "project-core.json"), { name: "newer" });
		// Legacy config also exists
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "older" });

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Skipped, not moved
		assert.equal(result.moved.length, 0);
		assert.ok(result.skipped.length >= 1);
		assert.ok(result.skipped.some((s) => s.reason.includes(".idu/config/ already exists")));

		// .idu/config/ is unchanged (still has the newer value)
		assert.equal(
			JSON.parse(readFileSync(join(repoRoot, ".idu", "config", "project-core.json"), "utf8")).name,
			"newer",
		);
		// Legacy config/ is also unchanged (untouched)
		assert.equal(
			JSON.parse(readFileSync(join(repoRoot, "config", "project-core.json"), "utf8")).name,
			"older",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: returns shape with moved, skipped, errors arrays", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		const result = migrateHygieneLayout({ repoRoot, stateRoot });
		assert.ok(Array.isArray(result.moved));
		assert.ok(Array.isArray(result.skipped));
		assert.ok(Array.isArray(result.errors));
		// Each moved entry has from + to
		for (const m of result.moved) {
			assert.equal(typeof m.from, "string");
			assert.equal(typeof m.to, "string");
		}
		// Each skipped has from + reason
		for (const s of result.skipped) {
			assert.equal(typeof s.from, "string");
			assert.equal(typeof s.reason, "string");
		}
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: is idempotent (running twice does not double-move)", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const first = migrateHygieneLayout({ repoRoot, stateRoot });
		assert.equal(first.moved.length, 1);

		const second = migrateHygieneLayout({ repoRoot, stateRoot });
		assert.equal(second.moved.length, 0);
		assert.ok(second.skipped.length >= 1);

		// .idu/config/ has the file
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-core.json")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

// =========================================================================
// Skills migration by manifest
// =========================================================================

test("migrateHygieneLayout: skills migration by manifest (array shape)", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// Skills manifest with array shape
		const manifest = {
			skills: [
				{ name: "skill-a" },
				{ name: "skill-b" },
			],
		};
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		// Each skill is a dir with SKILL.md
		mkdirSync(join(repoRoot, "skills", "skill-a"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-a", "SKILL.md"), "# Skill A", "utf8");
		mkdirSync(join(repoRoot, "skills", "skill-b"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-b", "SKILL.md"), "# Skill B", "utf8");
		// Plus .gitkeep
		writeFileSync(join(repoRoot, "skills", ".gitkeep"), "", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Both skill dirs moved
		assert.ok(
			result.moved.some(
				(m) => m.from.endsWith(join("skills", "skill-a")) && m.to.endsWith(join(".idu", "skills", "skill-a")),
			),
			"skill-a should be moved",
		);
		assert.ok(
			result.moved.some(
				(m) => m.from.endsWith(join("skills", "skill-b")) && m.to.endsWith(join(".idu", "skills", "skill-b")),
			),
			"skill-b should be moved",
		);
		// Manifest moved
		assert.ok(
			result.moved.some(
				(m) => m.from.endsWith(join("skills", "skills.json")) && m.to.endsWith(join(".idu", "skills", "skills.json")),
			),
			"skills.json manifest should be moved",
		);
		// .gitkeep moved
		assert.ok(
			result.moved.some((m) => m.from.endsWith(join("skills", ".gitkeep"))),
			".gitkeep should be moved",
		);

		// Files are in the new location
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skill-b", "SKILL.md")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skills.json")));

		// Legacy skills/ is gone
		assert.ok(!existsSync(join(repoRoot, "skills")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: skills migration by manifest (object-map shape)", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		const manifest = {
			skills: {
				"skill-x": { version: "1" },
				"skill-y": { version: "2" },
			},
		};
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		mkdirSync(join(repoRoot, "skills", "skill-x"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-x", "SKILL.md"), "# X", "utf8");
		mkdirSync(join(repoRoot, "skills", "skill-y"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-y", "SKILL.md"), "# Y", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Both skills moved
		assert.ok(
			result.moved.some((m) => m.from.endsWith(join("skills", "skill-x"))),
			"skill-x should be moved",
		);
		assert.ok(
			result.moved.some((m) => m.from.endsWith(join("skills", "skill-y"))),
			"skill-y should be moved",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: leaves non-listed dirs in <repo>/skills/ untouched", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// Manifest lists only "skill-a"
		const manifest = { skills: [{ name: "skill-a" }] };
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		// skill-a exists
		mkdirSync(join(repoRoot, "skills", "skill-a"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-a", "SKILL.md"), "# A", "utf8");
		// skill-other is NOT in the manifest, must stay
		mkdirSync(join(repoRoot, "skills", "skill-other"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-other", "README.md"), "user's stuff", "utf8");

		migrateHygieneLayout({ repoRoot, stateRoot });

		// skill-a moved
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")));
		// skill-other untouched (still in legacy path)
		assert.ok(existsSync(join(repoRoot, "skills", "skill-other", "README.md")));
		assert.ok(!existsSync(join(repoRoot, ".idu", "skills", "skill-other")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: missing skill dir on disk (only in manifest) is silently skipped", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// Manifest lists skill-a, but no dir on disk (re-derivable scenario)
		const manifest = { skills: [{ name: "skill-a" }] };
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// No move for skill-a (dir doesn't exist), but manifest is moved
		assert.ok(
			!result.moved.some((m) => m.from.endsWith(join("skills", "skill-a"))),
			"skill-a should not be in moved (no dir on disk)",
		);
		assert.ok(
			result.moved.some((m) => m.from.endsWith(join("skills", "skills.json"))),
			"skills.json manifest should still be moved",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: non-dir entry at <repo>/skills/<skillname> (stray file) is skipped", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// Manifest lists "skill-a", but it's a file not a dir
		const manifest = { skills: [{ name: "skill-a" }] };
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		writeFileSync(join(repoRoot, "skills", "skill-a"), "stray file content", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// skill-a is NOT moved (not a dir)
		assert.ok(
			!result.moved.some((m) => m.from.endsWith(join("skills", "skill-a"))),
			"stray file should not be moved as a dir",
		);
		// The stray file is left in place
		assert.ok(existsSync(join(repoRoot, "skills", "skill-a")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: skill dir with sub-dirs is moved recursively", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		const manifest = { skills: [{ name: "rich-skill" }] };
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		// Skill with nested structure
		mkdirSync(join(repoRoot, "skills", "rich-skill", "examples"), { recursive: true });
		mkdirSync(join(repoRoot, "skills", "rich-skill", "templates"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "rich-skill", "SKILL.md"), "# Rich", "utf8");
		writeFileSync(join(repoRoot, "skills", "rich-skill", "examples", "ex1.md"), "ex1", "utf8");
		writeFileSync(join(repoRoot, "skills", "rich-skill", "templates", "t1.md"), "t1", "utf8");

		migrateHygieneLayout({ repoRoot, stateRoot });

		// All substructure preserved in new location
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "rich-skill", "SKILL.md")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "rich-skill", "examples", "ex1.md")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "rich-skill", "templates", "t1.md")));
		// Legacy is gone
		assert.ok(!existsSync(join(repoRoot, "skills", "rich-skill")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: malformed skills.json (invalid JSON) does not crash", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		mkdirSync(join(repoRoot, "skills"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skills.json"), "this is not json {{{", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// The function should NOT throw. It should log an error and skip skills.
		assert.ok(result.errors.length >= 1, "expected an error for malformed manifest");
		assert.ok(
			result.errors.some((e) => e.from.endsWith("skills.json")),
			"the error should reference skills.json",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: skills with no manifest file are a no-op", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// skills/ exists but no skills.json
		mkdirSync(join(repoRoot, "skills"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", ".gitkeep"), "", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// .gitkeep still in legacy
		assert.ok(existsSync(join(repoRoot, "skills", ".gitkeep")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

// =========================================================================
// Events log
// =========================================================================

test("migrateHygieneLayout: logs to <stateRoot>/events.jsonl (hygiene_migration event)", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		migrateHygieneLayout({ repoRoot, stateRoot });

		const eventsPath = join(stateRoot, "events.jsonl");
		assert.ok(existsSync(eventsPath));
		const events = readFileSync(eventsPath, "utf8")
			.split("\n")
			.filter((l) => l.trim());
		assert.ok(events.length >= 1);
		const parsed = JSON.parse(events[0]);
		assert.equal(parsed.kind, "hygiene_migration");
		assert.ok(Array.isArray(parsed.moved));
		assert.equal(parsed.moved.length, 1);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

// =========================================================================
// Both config and skills
// =========================================================================

test("migrateHygieneLayout: migrates BOTH config and skills in one call", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		// Config
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });
		writeJSON(join(repoRoot, "config", "project-constitution.json"), { name: "const" });
		// Skills
		const manifest = { skills: [{ name: "skill-a" }] };
		writeJSON(join(repoRoot, "skills", "skills.json"), manifest);
		mkdirSync(join(repoRoot, "skills", "skill-a"), { recursive: true });
		writeFileSync(join(repoRoot, "skills", "skill-a", "SKILL.md"), "# A", "utf8");
		writeFileSync(join(repoRoot, "skills", ".gitkeep"), "", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// 2 config + 1 skill dir + 1 manifest + 1 .gitkeep = 5 moves
		assert.equal(result.moved.length, 5);

		// All in new locations
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-core.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-constitution.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")));
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "skills.json")));

		// Legacy gone
		assert.ok(!existsSync(join(repoRoot, "config")));
		assert.ok(!existsSync(join(repoRoot, "skills")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});
