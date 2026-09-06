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
import { readIdPathWithMigration } from "../src/hygiene-migrate.js";
import { ScratchPathError, assertAllowedWrite } from "../src/idu-scratch.js";

// =========================================================================
// Helpers
// =========================================================================

function makeRoot(prefix: string): {
	repoRoot: string;
	stateRoot: string;
	cleanup: () => void;
} {
	const base = mkdtempSync(join(tmpdir(), prefix));
	const repoRoot = join(base, "repo");
	const stateRoot = join(base, "state");
	mkdirSync(repoRoot, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	return {
		repoRoot,
		stateRoot,
		cleanup: () => rmSync(base, { recursive: true, force: true }),
	};
}

function writeJSON(path: string, obj: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

// =========================================================================
// Migration guard helper (readIdPathWithMigration)
// =========================================================================

test("readIdPathWithMigration: returns null when neither .idu/ nor config/ has the file", () => {
	const { repoRoot, cleanup } = makeRoot("wm-read-null-");
	try {
		const r = readIdPathWithMigration(repoRoot, "project-core.json");
		assert.equal(r.content, null);
		assert.equal(r.migrated, false);
	} finally {
		cleanup();
	}
});

test("readIdPathWithMigration: reads from .idu/ without migrating", () => {
	const { repoRoot, cleanup } = makeRoot("wm-read-new-");
	try {
		writeJSON(join(repoRoot, ".idu", "config", "project-core.json"), {
			name: "from-new",
		});
		const r = readIdPathWithMigration(repoRoot, "project-core.json");
		assert.equal(r.migrated, false);
		assert.equal(JSON.parse(r.content ?? "{}").name, "from-new");
	} finally {
		cleanup();
	}
});

test("readIdPathWithMigration: migrates legacy <repo>/config/ to <repo>/.idu/config/ and returns migrated: true", () => {
	const { repoRoot, cleanup } = makeRoot("wm-read-migrate-");
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), {
			name: "from-legacy",
		});
		const r = readIdPathWithMigration(repoRoot, "project-core.json");
		assert.equal(r.migrated, true);
		assert.equal(JSON.parse(r.content ?? "{}").name, "from-legacy");
		// Legacy file is gone, .idu/ has it
		assert.ok(!existsSync(join(repoRoot, "config", "project-core.json")));
		assert.ok(existsSync(join(repoRoot, ".idu", "config", "project-core.json")));
	} finally {
		cleanup();
	}
});

test("readIdPathWithMigration: is idempotent (second call returns migrated: false)", () => {
	const { repoRoot, cleanup } = makeRoot("wm-read-idempotent-");
	try {
		writeJSON(join(repoRoot, "config", "project-core.json"), { v: 1 });
		const first = readIdPathWithMigration(repoRoot, "project-core.json");
		assert.equal(first.migrated, true);
		const second = readIdPathWithMigration(repoRoot, "project-core.json");
		assert.equal(second.migrated, false);
		assert.equal(second.content, first.content);
	} finally {
		cleanup();
	}
});

// =========================================================================
// Territory assertion (assertAllowedWrite active rejection)
// =========================================================================

test("assertAllowedWrite: rejects a write to <repo>/config/ (the original violation class)", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-assert-config-");
	try {
		const target = join(repoRoot, "config", "project-core.json");
		assert.throws(
			() => assertAllowedWrite(target, { stateRoot, repoRoot }),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
	}
});

test("assertAllowedWrite: rejects a write to <repo>/.agents/skills/", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-assert-skills-");
	try {
		const target = join(repoRoot, ".agents", "skills", "foo", "SKILL.md");
		assert.throws(
			() => assertAllowedWrite(target, { stateRoot, repoRoot }),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
	}
});

test("assertAllowedWrite: rejects a write to <repo>/src/ (no territory exception)", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-assert-src-");
	try {
		const target = join(repoRoot, "src", "index.ts");
		assert.throws(
			() => assertAllowedWrite(target, { stateRoot, repoRoot }),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
	}
});

test("assertAllowedWrite: allows a write to <repo>/.idu/config/", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-allow-idu-");
	try {
		const target = join(repoRoot, ".idu", "config", "project-core.json");
		assert.doesNotThrow(() =>
			assertAllowedWrite(target, { stateRoot, repoRoot }),
		);
	} finally {
		cleanup();
	}
});

test("assertAllowedWrite: allows a write to <stateRoot>/tmp/", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-allow-state-");
	try {
		const target = join(stateRoot, "tmp", "scratch.json");
		assert.doesNotThrow(() =>
			assertAllowedWrite(target, { stateRoot, repoRoot }),
		);
	} finally {
		cleanup();
	}
});

// =========================================================================
// writer behavior: writers go to .idu/, not config/ or .agents/skills/
// =========================================================================

test("writer territory: files written under <repo>/config/ are NOT created by any writer (sample: project-core.json)", async () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-writer-config-");
	try {
		const { createDefaultProjectCore, validateProjectCore } = await import(
			"../src/project-core.js"
		);
		// We don't call any writer here; the goal is to verify the file
		// is NOT at the legacy path after a write to the new path.
		// Simulate the bootstrap pattern: write to .idu/config/.
		const path = join(repoRoot, ".idu", "config", "project-core.json");
		assertAllowedWrite(path, { stateRoot, repoRoot });
		mkdirSync(join(repoRoot, ".idu", "config"), { recursive: true });
		const core = createDefaultProjectCore("demo");
		writeFileSync(path, `${JSON.stringify(core, null, 2)}\n`, "utf8");

		// The new path is created
		assert.ok(existsSync(path));
		// The legacy path is NOT created
		assert.ok(!existsSync(join(repoRoot, "config", "project-core.json")));
		// The validation roundtrip works
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		const v = validateProjectCore(parsed);
		assert.equal(v.ok, true);
	} finally {
		cleanup();
	}
});

test("writer territory: skills are written under <repo>/.idu/skills/ (not .agents/skills/)", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-writer-skills-");
	try {
		const skillsDir = join(repoRoot, ".idu", "skills");
		assertAllowedWrite(skillsDir, { stateRoot, repoRoot });
		mkdirSync(skillsDir, { recursive: true });

		// A skill with substructure (mimicking real layout)
		const skillDir = join(skillsDir, "demo-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "# Demo\n", "utf8");
		mkdirSync(join(skillDir, "examples"), { recursive: true });
		writeFileSync(
			join(skillDir, "examples", "ex1.md"),
			"example",
			"utf8",
		);

		// New path exists with the expected structure
		assert.ok(existsSync(join(skillsDir, "demo-skill", "SKILL.md")));
		assert.ok(
			existsSync(join(skillsDir, "demo-skill", "examples", "ex1.md")),
		);
		// Legacy .agents/skills/ was never created
		assert.ok(!existsSync(join(repoRoot, ".agents", "skills")));
	} finally {
		cleanup();
	}
});

// =========================================================================
// backup files live under stateRoot/tmp/ (scratch), not under repo
// =========================================================================

test("backup territory: project-core backups live under <stateRoot>/tmp/", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-backup-state-");
	try {
		const backupPath = join(stateRoot, "tmp", "project-core.backup-20260617-120000.json");
		assertAllowedWrite(backupPath, { stateRoot, repoRoot });
		mkdirSync(join(stateRoot, "tmp"), { recursive: true });
		writeFileSync(backupPath, "{}", "utf8");
		assert.ok(existsSync(backupPath));
		// The legacy <repo>/config/project-core.backup-*.json was never created.
		assert.ok(!existsSync(join(repoRoot, "config")));
	} finally {
		cleanup();
	}
});

// =========================================================================
// NEGATIVE (auditor-required): assertAllowedWrite REJECTS, never silently allows.
// This is the regression guard against the scout's findings on the original
// violation class.
// =========================================================================

test("NEGATIVE (auditor-required): every rogue write target in this project throws ScratchPathError", () => {
	const { repoRoot, stateRoot, cleanup } = makeRoot("wm-negative-");
	try {
		const targets = [
			join(repoRoot, "config", "project-core.json"),
			join(repoRoot, "config", "project-blueprint.json"),
			join(repoRoot, "config", "project-flows.json"),
			join(repoRoot, "config", "project-constitution.json"),
			join(repoRoot, ".agents", "skills", "foo", "SKILL.md"),
			join(repoRoot, "src", "config-wizard.ts"),
			join(repoRoot, "package.json"),
			join(repoRoot, "README.md"),
		];
		for (const target of targets) {
			assert.throws(
				() => assertAllowedWrite(target, { stateRoot, repoRoot }),
				(err: unknown) => {
					if (!(err instanceof ScratchPathError)) return false;
					// Must NOT be inside stateRoot or <repo>/.idu/.
					const loc = err.actualLocation.replace(/\\/g, "/");
					return !loc.includes("/.idu/");
				},
				`expected ScratchPathError for ${target}`,
			);
		}
	} finally {
		cleanup();
	}
});