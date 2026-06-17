import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	assertAllowedWrite,
	assertUnderStateRoot,
	ensureScratchDir,
	ScratchPathError,
	scratchPath,
} from "../src/idu-scratch.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-scratch-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("scratchPath: returns <stateRoot>/tmp/<name>", () => {
	assert.equal(scratchPath("/state/root", "foo.json"), join("/state/root", "tmp", "foo.json"));
	assert.equal(scratchPath("C:/state/root", "bar.txt"), join("C:/state/root", "tmp", "bar.txt"));
});

test("scratchPath: rejects names with ..", () => {
	assert.throws(() => scratchPath("/state", ".."), /invalid name/);
	assert.throws(() => scratchPath("/state", "../foo"), /invalid name/);
	assert.throws(() => scratchPath("/state", "foo/.."), /invalid name/);
});

test("scratchPath: rejects names with / or \\", () => {
	assert.throws(() => scratchPath("/state", "foo/bar"), /invalid name/);
	assert.throws(() => scratchPath("/state", "foo\\bar"), /invalid name/);
});

test("scratchPath: rejects empty name", () => {
	assert.throws(() => scratchPath("/state", ""), /invalid name/);
});

test("ensureScratchDir: creates the dir if missing", () => {
	const { root, cleanup } = makeRoot();
	try {
		const tmpDir = ensureScratchDir(root);
		assert.ok(existsSync(tmpDir));
		assert.equal(tmpDir, resolve(join(root, "tmp")));
	} finally {
		cleanup();
	}
});

test("ensureScratchDir: returns the existing path if already present", () => {
	const { root, cleanup } = makeRoot();
	try {
		mkdirSync(join(root, "tmp"), { recursive: true });
		const tmpDir = ensureScratchDir(root);
		assert.ok(existsSync(tmpDir));
		assert.equal(tmpDir, resolve(join(root, "tmp")));
	} finally {
		cleanup();
	}
});

test("assertUnderStateRoot: passes when path is under stateRoot", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	try {
		assertUnderStateRoot(join(stateRoot, "events.jsonl"), stateRoot);
		assertUnderStateRoot(join(stateRoot, "tmp", "foo.txt"), stateRoot);
		assertUnderStateRoot(join(stateRoot, "deeply", "nested", "file"), stateRoot);
		// stateRoot itself is allowed
		assertUnderStateRoot(stateRoot, stateRoot);
	} finally {
		cleanup();
	}
});

test("assertUnderStateRoot: throws when path is not under stateRoot", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: other, cleanup: otherCleanup } = makeRoot();
	try {
		assert.throws(
			() => assertUnderStateRoot(join(other, "events.jsonl"), stateRoot),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
		otherCleanup();
	}
});

test("assertUnderStateRoot: throws when path is not absolute", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	try {
		assert.throws(
			() => assertUnderStateRoot("relative/path", stateRoot),
			/path must be absolute/,
		);
	} finally {
		cleanup();
	}
});

test("assertUnderStateRoot: error has path, allowedRoot, actualLocation fields", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: other, cleanup: otherCleanup } = makeRoot();
	try {
		const badPath = join(other, "events.jsonl");
		let caught: ScratchPathError | null = null;
		try {
			assertUnderStateRoot(badPath, stateRoot);
			assert.fail("should have thrown");
		} catch (err) {
			if (err instanceof ScratchPathError) {
				caught = err;
			} else {
				throw err;
			}
		}
		if (!caught) {
			assert.fail("expected ScratchPathError to be thrown");
		}
		assert.equal(caught.path, badPath);
		// The implementation normalizes to forward slashes for portability;
		// assert the allowedRoot matches stateRoot (modulo separators).
		assert.ok(caught.allowedRoot.includes("idu-scratch"), `expected allowedRoot to be under the temp stateRoot, got: ${caught.allowedRoot}`);
		assert.ok(caught.actualLocation.includes("events.jsonl"), `expected actualLocation to contain events.jsonl, got: ${caught.actualLocation}`);
		assert.equal(caught.name, "ScratchPathError");
	} finally {
		cleanup();
		otherCleanup();
	}
});

test("assertAllowedWrite: passes when path is under stateRoot", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		assertAllowedWrite(join(stateRoot, "injections.jsonl"), {
			stateRoot,
			repoRoot,
		});
		assertAllowedWrite(join(stateRoot, "tmp", "scratch.txt"), {
			stateRoot,
			repoRoot,
		});
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: passes when path is under <repo>/.idu/", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		assertAllowedWrite(join(repoRoot, ".idu", "config", "project-core.json"), {
			stateRoot,
			repoRoot,
		});
		assertAllowedWrite(join(repoRoot, ".idu", "skills", "skills.json"), {
			stateRoot,
			repoRoot,
		});
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: throws when path is under <repo>/config/ (the original bug class)", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		// This is the violation the scout found. A write to <repo>/config/ must be rejected.
		assert.throws(
			() =>
				assertAllowedWrite(join(repoRoot, "config", "project-core.json"), {
					stateRoot,
					repoRoot,
				}),
			(err: unknown) => {
				if (!(err instanceof ScratchPathError)) return false;
				const loc = err.actualLocation.replace(/\\/g, "/");
				return loc.endsWith("/config/project-core.json") && !loc.includes("/.idu/");
			},
		);
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: throws when path is under <repo>/skills/ (legacy skills dir)", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		assert.throws(
			() =>
				assertAllowedWrite(join(repoRoot, "skills", "skills.json"), {
					stateRoot,
					repoRoot,
				}),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: throws when path is under <repo>/src/", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		assert.throws(
			() =>
				assertAllowedWrite(join(repoRoot, "src", "index.ts"), {
					stateRoot,
					repoRoot,
				}),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: accepts a custom allowRepoDir", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		// Default rejects .idu; custom ".custom" accepts it
		assertAllowedWrite(join(repoRoot, ".custom", "foo.json"), {
			stateRoot,
			repoRoot,
			allowRepoDir: ".custom",
		});
		// Default .idu is rejected when allowRepoDir is different
		assert.throws(
			() =>
				assertAllowedWrite(join(repoRoot, ".idu", "foo.json"), {
					stateRoot,
					repoRoot,
					allowRepoDir: ".custom",
				}),
			(err: unknown) => err instanceof ScratchPathError,
		);
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("assertAllowedWrite: throws when path is not absolute", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		assert.throws(
			() => assertAllowedWrite("relative/path", { stateRoot, repoRoot }),
			/path must be absolute/,
		);
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("NEGATIVE (auditor-required): assertAllowedWrite REJECTS a rogue write outside both roots", () => {
	// This is the active-rejection behavior. A write to a path that is
	// NOT under stateRoot and NOT under <repo>/.idu/ must THROW, not
	// silently allow. The test asserts the throw with the right shape.
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		const rogueTargets = [
			join(repoRoot, "config", "project-core.json"),
			join(repoRoot, "src", "index.ts"),
			join(repoRoot, "package.json"),
			join(repoRoot, "docs", "README.md"),
			join(repoRoot, "node_modules", "foo", "bar.js"),
		];
		for (const target of rogueTargets) {
			try {
				assertAllowedWrite(target, { stateRoot, repoRoot });
				assert.fail(`should have thrown for ${target}`);
			} catch (err) {
				assert.ok(
					err instanceof ScratchPathError,
					`expected ScratchPathError for ${target}, got ${err}`,
				);
				assert.equal((err as ScratchPathError).path, target);
			}
		}
	} finally {
		cleanup();
		repoCleanup();
	}
});

test("integration: scratchPath + ensureScratchDir + assertAllowedWrite compose", () => {
	const { root: stateRoot, cleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		// 1. Ensure scratch dir
		ensureScratchDir(stateRoot);
		// 2. Resolve a scratch path
		const scratchFile = scratchPath(stateRoot, "backup-123.json");
		// 3. Write to it
		writeFileSync(scratchFile, "{}", "utf8");
		// 4. Verify the path is allowed
		assertAllowedWrite(scratchFile, { stateRoot, repoRoot });
		// 5. Verify the file exists
		assert.ok(existsSync(scratchFile));
	} finally {
		cleanup();
		repoCleanup();
	}
});
