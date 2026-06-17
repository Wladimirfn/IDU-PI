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
		writeJSON(join(repoRoot, "config", "project-constitution.json"), {
			name: "const",
		});
		writeJSON(join(repoRoot, "config", "project-blueprint.json"), {
			name: "bp",
		});
		writeJSON(join(repoRoot, "config", "project-flows.json"), {
			name: "flows",
		});

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Result shape
		assert.equal(result.moved.length, 4);
		assert.equal(result.skipped.length, 0);
		assert.equal(result.errors.length, 0);

		// All 4 files are in .idu/config/
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-core.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-constitution.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-blueprint.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-flows.json")),
		);

		// Legacy config/ is gone
		assert.ok(!existsSync(join(repoRoot, "config", "project-core.json")));
		assert.ok(!existsSync(join(repoRoot, "config")));

		// Content preserved
		assert.equal(
			JSON.parse(
				readFileSync(
					join(repoRoot, ".idu", "config", "project-core.json"),
					"utf8",
				),
			).name,
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
		writeJSON(join(repoRoot, ".idu", "config", "project-core.json"), {
			name: "newer",
		});
		// Legacy config also exists
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "older" });

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// Skipped, not moved
		assert.equal(result.moved.length, 0);
		assert.ok(result.skipped.length >= 1);
		assert.ok(
			result.skipped.some((s) =>
				s.reason.includes(".idu/config/ already exists"),
			),
		);

		// .idu/config/ is unchanged (still has the newer value)
		assert.equal(
			JSON.parse(
				readFileSync(
					join(repoRoot, ".idu", "config", "project-core.json"),
					"utf8",
				),
			).name,
			"newer",
		);
		// Legacy config/ is also unchanged (untouched)
		assert.equal(
			JSON.parse(
				readFileSync(join(repoRoot, "config", "project-core.json"), "utf8"),
			).name,
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
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-core.json")),
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});
// =========================================================================
// Skills migration by directory enumeration + SKILL.md presence
// =========================================================================

test("migrateHygieneLayout: skills migration by SKILL.md enumeration", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		mkdirSync(join(repoRoot, ".agents", "skills", "skill-a"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "skill-a", "SKILL.md"),
			"# Skill A",
			"utf8",
		);
		mkdirSync(join(repoRoot, ".agents", "skills", "skill-b"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "skill-b", "SKILL.md"),
			"# Skill B",
			"utf8",
		);
		writeFileSync(
			join(repoRoot, ".agents", "skills", "INDEX.md"),
			"# Index",
			"utf8",
		);
		writeFileSync(join(repoRoot, ".agents", "skills", ".gitkeep"), "", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		assert.ok(
			result.moved.some(
				(m) =>
					m.from.endsWith(join(".agents", "skills", "skill-a")) &&
					m.to.endsWith(join(".idu", "skills", "skill-a")),
			),
			"skill-a moved",
		);
		assert.ok(
			result.moved.some(
				(m) =>
					m.from.endsWith(join(".agents", "skills", "skill-b")) &&
					m.to.endsWith(join(".idu", "skills", "skill-b")),
			),
			"skill-b moved",
		);
		assert.ok(
			result.moved.some(
				(m) =>
					m.from.endsWith(join(".agents", "skills", "INDEX.md")) &&
					m.to.endsWith(join(".idu", "skills", "INDEX.md")),
			),
			"INDEX.md moved",
		);
		assert.ok(
			result.moved.some(
				(m) =>
					m.from.endsWith(join(".agents", "skills", ".gitkeep")) &&
					m.to.endsWith(join(".idu", "skills", ".gitkeep")),
			),
			".gitkeep moved",
		);

		assert.ok(
			existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "skills", "skill-b", "SKILL.md")),
		);
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", "INDEX.md")));
		assert.ok(!existsSync(join(repoRoot, ".agents", "skills")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: leaves dirs without SKILL.md untouched", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		mkdirSync(join(repoRoot, ".agents", "skills", "skill-a"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "skill-a", "SKILL.md"),
			"# A",
			"utf8",
		);
		mkdirSync(join(repoRoot, ".agents", "skills", "skill-other"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "skill-other", "README.md"),
			"user's stuff",
			"utf8",
		);

		migrateHygieneLayout({ repoRoot, stateRoot });

		assert.ok(
			existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")),
		);
		assert.ok(
			existsSync(
				join(repoRoot, ".agents", "skills", "skill-other", "README.md"),
			),
		);
		assert.ok(!existsSync(join(repoRoot, ".idu", "skills", "skill-other")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: non-dir entry at .agents/skills/<name> is skipped", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		mkdirSync(join(repoRoot, ".agents", "skills"), { recursive: true });
		writeFileSync(
			join(repoRoot, ".agents", "skills", "stray-file"),
			"stray content",
			"utf8",
		);

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		assert.ok(
			!result.moved.some((m) =>
				m.from.endsWith(join(".agents", "skills", "stray-file")),
			),
			"stray file not moved",
		);
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: skill dir with sub-dirs is moved recursively", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		mkdirSync(join(repoRoot, ".agents", "skills", "rich-skill", "examples"), {
			recursive: true,
		});
		mkdirSync(join(repoRoot, ".agents", "skills", "rich-skill", "templates"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "rich-skill", "SKILL.md"),
			"# Rich",
			"utf8",
		);
		writeFileSync(
			join(repoRoot, ".agents", "skills", "rich-skill", "examples", "ex1.md"),
			"ex1",
			"utf8",
		);
		writeFileSync(
			join(repoRoot, ".agents", "skills", "rich-skill", "templates", "t1.md"),
			"t1",
			"utf8",
		);

		migrateHygieneLayout({ repoRoot, stateRoot });

		assert.ok(
			existsSync(join(repoRoot, ".idu", "skills", "rich-skill", "SKILL.md")),
		);
		assert.ok(
			existsSync(
				join(repoRoot, ".idu", "skills", "rich-skill", "examples", "ex1.md"),
			),
		);
		assert.ok(
			existsSync(
				join(repoRoot, ".idu", "skills", "rich-skill", "templates", "t1.md"),
			),
		);
		assert.ok(!existsSync(join(repoRoot, ".agents", "skills", "rich-skill")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});

test("migrateHygieneLayout: no .agents/skills/ dir is a no-op for skills", () => {
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	const { stateRoot, cleanup: stateCleanup } = makeStateRoot();
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { name: "core" });

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		assert.ok(
			result.moved.some((m) =>
				m.from.endsWith(join("config", "project-core.json")),
			),
		);
		assert.equal(result.moved.length, 1);
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
		writeJSON(join(repoRoot, "config", "project-constitution.json"), {
			name: "const",
		});
		// Skills (using .agents/skills/ + SKILL.md enumeration, no manifest)
		mkdirSync(join(repoRoot, ".agents", "skills", "skill-a"), {
			recursive: true,
		});
		writeFileSync(
			join(repoRoot, ".agents", "skills", "skill-a", "SKILL.md"),
			"# A",
			"utf8",
		);
		writeFileSync(join(repoRoot, ".agents", "skills", ".gitkeep"), "", "utf8");

		const result = migrateHygieneLayout({ repoRoot, stateRoot });

		// 2 config + 1 skill dir + 1 .gitkeep = 4 moves
		// (no skills.json manifest; no INDEX.md in setup)
		assert.equal(result.moved.length, 4);

		// All in new locations
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-core.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "config", "project-constitution.json")),
		);
		assert.ok(
			existsSync(join(repoRoot, ".idu", "skills", "skill-a", "SKILL.md")),
		);
		assert.ok(existsSync(join(repoRoot, ".idu", "skills", ".gitkeep")));

		// Legacy gone
		assert.ok(!existsSync(join(repoRoot, "config")));
		assert.ok(!existsSync(join(repoRoot, ".agents", "skills")));
	} finally {
		repoCleanup();
		stateCleanup();
	}
});
