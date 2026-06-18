/**
 * sweep-command.test.ts — tests for planSweep() and autoCleanStateRoot().
 *
 * The critical invariant (auditor-flagged): planSweep must NEVER propose
 * `find -name 'pattern' -delete`. It must always propose a per-path
 * explicit `rm <exact-path>` derived from the sensor's findings[].path.
 * Re-validating at sweep time defends against TOCTOU (file changed
 * between sensor and sweep) and against symlink attacks.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SensorResult } from "../src/hygiene-sensor.js";
import {
	autoCleanStateRoot,
	planSweep,
	type PlanSweepInput,
} from "../src/sweep-command.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixture(): {
	stateRoot: string;
	repoPath: string;
	cleanup: () => void;
} {
	const stateRoot = mkdtempSync(join(tmpdir(), "sweep-state-"));
	const repoPath = mkdtempSync(join(tmpdir(), "sweep-repo-"));
	return {
		stateRoot,
		repoPath,
		cleanup: () => {
			rmSync(stateRoot, { recursive: true, force: true });
			rmSync(repoPath, { recursive: true, force: true });
		},
	};
}

function makeSensor(
	findings: { path: string; pattern: string }[],
): SensorResult {
	return {
		findings: findings.map((f) => ({
			path: f.path,
			pattern: f.pattern,
			severity: "info" as const,
			fingerprint: "fp-" + f.path,
		})),
		scannedPaths: 100,
		matchedPaths: findings.length,
		truncated: false,
		now: "2026-06-17T10:00:00.000Z",
	};
}

function makeInput(
	overrides: Partial<PlanSweepInput> & { stateRoot: string; repoPath: string },
): PlanSweepInput {
	return {
		sensorOutput: overrides.sensorOutput ?? makeSensor([]),
		stateRoot: overrides.stateRoot,
		repoPath: overrides.repoPath,
		now: overrides.now,
		mode: overrides.mode,
	};
}

// ---------------------------------------------------------------------------
// Empty sensor
// ---------------------------------------------------------------------------

test("planSweep: empty sensor output returns empty result", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		const result = planSweep(makeInput({ stateRoot, repoPath }));
		assert.deepEqual(result.paths, []);
		assert.deepEqual(result.commands, []);
		assert.deepEqual(result.skipped, []);
		assert.ok(result.revalidatedAt, "revalidatedAt set");
		assert.equal(result.sensorSnapshot.ts, "2026-06-17T10:00:00.000Z");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// CRITICAL: per-path `rm`, never `find -delete` (auditor-flagged)
// ---------------------------------------------------------------------------

test("AUDITOR-CRITICAL: planSweep never proposes `find -delete`, only per-path `rm`", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		// Create the files the sensor "found"
		writeFileSync(join(repoPath, "tmp-debug.mjs"), "// debug");
		writeFileSync(join(repoPath, ".DS_Store"), "junk");
		writeFileSync(join(repoPath, "tmp-keep.mjs"), "// keep");

		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([
					{ path: join(repoPath, "tmp-debug.mjs"), pattern: "tmp-*.mjs" },
					{ path: join(repoPath, ".DS_Store"), pattern: ".DS_Store" },
				]),
			}),
		);

		// CRITICAL ASSERTION 1: no `find -delete` anywhere in the result
		for (const cmd of result.commands) {
			assert.ok(
				!cmd.includes("find ") || !cmd.includes("-delete"),
				`forbidden \`find -delete\` in command: ${cmd}`,
			);
		}
		// CRITICAL ASSERTION 2: no glob expansion in the suggested commands
		for (const cmd of result.commands) {
			assert.ok(
				!cmd.includes("*.mjs") &&
					!cmd.includes("'*.bak'") &&
					!cmd.includes("*"),
				`forbidden glob expansion in command: ${cmd}`,
			);
		}
		// CRITICAL ASSERTION 3: each command is `rm <exact-path>`
		assert.equal(result.commands.length, 2);
		assert.ok(
			result.commands[0].startsWith("rm "),
			`command 0 starts with rm: ${result.commands[0]}`,
		);
		assert.ok(
			result.commands[1].startsWith("rm "),
			`command 1 starts with rm: ${result.commands[1]}`,
		);
		// CRITICAL ASSERTION 4: each command targets the EXACT path, not a glob
		assert.ok(result.commands[0].includes(join(repoPath, "tmp-debug.mjs")));
		assert.ok(result.commands[1].includes(join(repoPath, ".DS_Store")));
		// tmp-keep.mjs was NOT a finding, so it must not appear
		for (const cmd of result.commands) {
			assert.ok(
				!cmd.includes("tmp-keep.mjs"),
				`must not include unvetted path: ${cmd}`,
			);
		}
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Territoriality: protected paths are SKIPPED
// ---------------------------------------------------------------------------

test("planSweep (advisory): SKIPS paths inside <stateRoot>/", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		mkdirSync(join(stateRoot, "tmp"), { recursive: true });
		const stateFile = join(stateRoot, "tmp", "scratch.mjs");
		writeFileSync(stateFile, "scratch");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([{ path: stateFile, pattern: "tmp-*.mjs" }]),
			}),
		);
		assert.deepEqual(result.paths, []);
		assert.deepEqual(result.commands, []);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "territory: stateRoot");
	} finally {
		cleanup();
	}
});

test("planSweep (advisory): SKIPS paths inside <repo>/.git/", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		const gitDir = join(repoPath, ".git");
		mkdirSync(gitDir, { recursive: true });
		const gitFile = join(gitDir, "hooks.tmp");
		writeFileSync(gitFile, "junk");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([{ path: gitFile, pattern: "*.tmp" }]),
			}),
		);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "territory: .git");
	} finally {
		cleanup();
	}
});

test("planSweep (advisory): SKIPS paths inside <repo>/.idu/", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		mkdirSync(join(repoPath, ".idu"), { recursive: true });
		const iduFile = join(repoPath, ".idu", "scratch.tmp");
		writeFileSync(iduFile, "scratch");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([{ path: iduFile, pattern: "*.tmp" }]),
			}),
		);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "territory: .idu");
	} finally {
		cleanup();
	}
});

test("planSweep (advisory): SKIPS paths inside <repo>/node_modules/", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		mkdirSync(join(repoPath, "node_modules"), { recursive: true });
		const depsFile = join(repoPath, "node_modules", "foo.tmp");
		writeFileSync(depsFile, "junk");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([{ path: depsFile, pattern: "*.tmp" }]),
			}),
		);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "territory: node_modules");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Re-validation: file no longer exists, pattern no longer matches
// ---------------------------------------------------------------------------

test("planSweep: re-validates — file no longer exists is SKIPPED", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		const ghostPath = join(repoPath, "ghost.tmp");
		// Note: file intentionally NOT created
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([{ path: ghostPath, pattern: "*.tmp" }]),
			}),
		);
		assert.equal(result.paths.length, 0);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "file no longer exists");
	} finally {
		cleanup();
	}
});

test("planSweep: re-validates — pattern no longer matches is SKIPPED", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		// Sensor saw this as a junk file, but the file's name was changed
		// to something legitimate between sensor and sweep
		const legitFile = join(repoPath, "production.mjs");
		writeFileSync(legitFile, "// legit");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor([
					{ path: legitFile, pattern: "tmp-*.mjs" }, // claims it matched `tmp-*.mjs`
				]),
			}),
		);
		assert.equal(result.paths.length, 0);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "pattern no longer matches");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Re-validation: symlink target outside repo
// ---------------------------------------------------------------------------

test("planSweep: re-validates — symlink target outside repo is SKIPPED", {
	skip: process.platform === "win32",
}, () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		// Create a target OUTSIDE the repo
		const outside = mkdtempSync(join(tmpdir(), "sweep-outside-"));
		try {
			const outsideFile = join(outside, "secret.txt");
			writeFileSync(outsideFile, "secret");
			// Create a symlink in the repo that points to the outside file
			const link = join(repoPath, "tmp-link.mjs");
			symlinkSync(outsideFile, link, "file");
			const result = planSweep(
				makeInput({
					stateRoot,
					repoPath,
					sensorOutput: makeSensor([{ path: link, pattern: "tmp-*.mjs" }]),
				}),
			);
			assert.equal(result.paths.length, 0);
			assert.equal(result.skipped.length, 1);
			// Either "pattern no longer matches" (link's basename) or
			// "path resolves outside repo" (realpath check) — both are valid
			assert.ok(
				result.skipped[0].reason === "path resolves outside repo" ||
					result.skipped[0].reason === "pattern no longer matches",
				`unexpected reason: ${result.skipped[0].reason}`,
			);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Mode: auto (internal-only, not exposed via CLI/MCP)
// ---------------------------------------------------------------------------

test("planSweep (auto): ALLOWS paths in stateRoot/tmp", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		mkdirSync(join(stateRoot, "tmp"), { recursive: true });
		const tmpFile = join(stateRoot, "tmp", "scratch.mjs");
		writeFileSync(tmpFile, "scratch");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				mode: "auto",
				sensorOutput: makeSensor([{ path: tmpFile, pattern: "tmp-*.mjs" }]),
			}),
		);
		assert.equal(result.paths.length, 1);
		assert.equal(result.skipped.length, 0);
	} finally {
		cleanup();
	}
});

test("planSweep (auto): SKIPS user's repo paths (auto is stateRoot-only)", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		const repoFile = join(repoPath, "tmp-debug.mjs");
		writeFileSync(repoFile, "junk");
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				mode: "auto",
				sensorOutput: makeSensor([{ path: repoFile, pattern: "tmp-*.mjs" }]),
			}),
		);
		assert.equal(result.paths.length, 0);
		assert.equal(result.skipped.length, 1);
		assert.equal(result.skipped[0].reason, "territory: stateRoot");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// autoCleanStateRoot (INTERNAL — DEFERRED, not yet wired from production)
//
// AUDITOR-FIX: the prior comment said "for cron preflight to clean its
// own scratch", but no production code calls autoCleanStateRoot today.
// The tests below document the CONTRACT for when the wiring lands. The
// auditor-required hard guarantee (a test that fails if the function
// is removed or its behavior regresses) is satisfied by these tests.
// ---------------------------------------------------------------------------

test("autoCleanStateRoot: returns empty when stateRoot/tmp does not exist", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "sweep-clean-"));
	try {
		const result = autoCleanStateRoot(stateRoot);
		assert.equal(result.cleaned.length, 0);
		assert.equal(result.errors.length, 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("autoCleanStateRoot: cleans files in tmp and returns them", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "sweep-clean-"));
	try {
		const tmpDir = join(stateRoot, "tmp");
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(join(tmpDir, "a.txt"), "a");
		writeFileSync(join(tmpDir, "b.txt"), "b");

		const result = autoCleanStateRoot(stateRoot);
		assert.equal(result.cleaned.length, 2);
		assert.equal(result.errors.length, 0);
		assert.ok(!existsSync(join(tmpDir, "a.txt")), "a.txt removed");
		assert.ok(!existsSync(join(tmpDir, "b.txt")), "b.txt removed");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("autoCleanStateRoot: does NOT touch files outside stateRoot", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "sweep-clean-"));
	const repoPath = mkdtempSync(join(tmpdir(), "sweep-repo-"));
	try {
		mkdirSync(join(stateRoot, "tmp"), { recursive: true });
		writeFileSync(join(stateRoot, "tmp", "scratch.txt"), "scratch");
		const legitFile = join(repoPath, "important.mjs");
		writeFileSync(legitFile, "// legit");

		const result = autoCleanStateRoot(stateRoot);
		assert.equal(result.cleaned.length, 1);
		assert.ok(existsSync(legitFile), "user's repo file is untouched");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		rmSync(repoPath, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

test("planSweep: result.sensorSnapshot echoes the sensor's findings (idempotent)", () => {
	const { stateRoot, repoPath, cleanup } = makeFixture();
	try {
		const findings = [{ path: join(repoPath, "a.tmp"), pattern: "*.tmp" }];
		const result = planSweep(
			makeInput({
				stateRoot,
				repoPath,
				sensorOutput: makeSensor(findings),
			}),
		);
		assert.equal(result.sensorSnapshot.ts, "2026-06-17T10:00:00.000Z");
		assert.equal(result.sensorSnapshot.findings.length, 1);
		assert.equal(result.sensorSnapshot.findings[0].path, findings[0].path);
		assert.equal(
			result.sensorSnapshot.findings[0].pattern,
			findings[0].pattern,
		);
	} finally {
		cleanup();
	}
});
