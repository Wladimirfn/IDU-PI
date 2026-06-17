import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { runHygieneSensor, type SensorResult } from "../src/hygiene-sensor.js";

/**
 * Build a sandbox with a fresh stateRoot and repoPath. stateRoot is
 * outside repoPath by default so the sensor's stateRoot exclusion does
 * not interfere with repo content.
 */
function makeSandbox(): {
	root: string;
	stateRoot: string;
	repoPath: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "hygiene-sensor-"));
	const stateRoot = join(root, "state");
	const repoPath = join(root, "repo");
	mkdirSync(stateRoot, { recursive: true });
	mkdirSync(repoPath, { recursive: true });
	return {
		root,
		stateRoot,
		repoPath,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function writeRepoFile(
	repoPath: string,
	relPath: string,
	content = "",
): string {
	const fullPath = join(repoPath, relPath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

function runSensor(stateRoot: string, repoPath: string): SensorResult {
	return runHygieneSensor({ stateRoot, repoPath });
}

test("runHygieneSensor: finds .DS_Store in a fixture repo", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeRepoFile(repoPath, "src/.DS_Store");
		const result = runSensor(stateRoot, repoPath);
		assert.ok(result.findings.some((f) => f.pattern === ".DS_Store"));
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: finds tmp-debug.mjs at the repo root", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeRepoFile(repoPath, "tmp-debug.mjs", "console.log('debug');\n");
		const result = runSensor(stateRoot, repoPath);
		const matches = result.findings.filter((f) => f.pattern === "tmp-*.mjs");
		assert.equal(matches.length, 1);
		assert.ok(matches[0].path.endsWith(`tmp-debug.mjs`));
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: excludes <repo>/.git/ (default exclusion)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeRepoFile(repoPath, ".git/.DS_Store");
		writeRepoFile(repoPath, ".git/HEAD");
		const result = runSensor(stateRoot, repoPath);
		assert.equal(result.findings.length, 0);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: excludes <repo>/node_modules/ (default exclusion)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeRepoFile(repoPath, "node_modules/some-pkg/.DS_Store");
		writeRepoFile(repoPath, "node_modules/some-pkg/index.js");
		const result = runSensor(stateRoot, repoPath);
		assert.equal(result.findings.length, 0);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: excludes <repo>/.idu/ (territory — don't scan our own governance)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeRepoFile(repoPath, ".idu/skills/foo/.DS_Store");
		writeRepoFile(repoPath, ".idu/config/.DS_Store");
		const result = runSensor(stateRoot, repoPath);
		assert.equal(result.findings.length, 0);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: excludes <stateRoot>/", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		// Put junk inside stateRoot — should never be reported.
		writeRepoFile(stateRoot, ".DS_Store");
		writeRepoFile(stateRoot, "tmp-leak.mjs", "// stateRoot junk\n");
		const result = runSensor(stateRoot, repoPath);
		assert.equal(result.findings.length, 0);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: respects per-project blocklist (e.g. *.pyc)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		writeFileSync(
			join(stateRoot, "hygiene-patterns.json"),
			JSON.stringify({ blocklist: ["*.pyc"], allowlist: [] }),
		);
		writeRepoFile(repoPath, "build/app.pyc", "fake bytecode");
		const result = runSensor(stateRoot, repoPath);
		const matches = result.findings.filter((f) => f.pattern === "*.pyc");
		assert.equal(matches.length, 1);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: respects per-project allowlist", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		// Whitelist tmp-debug.mjs so the canonical tmp-*.mjs pattern
		// does not match it.
		writeFileSync(
			join(stateRoot, "hygiene-patterns.json"),
			JSON.stringify({
				blocklist: [],
				allowlist: ["tmp-debug.mjs"],
			}),
		);
		writeRepoFile(repoPath, "tmp-debug.mjs", "// intentional\n");
		const result = runSensor(stateRoot, repoPath);
		assert.equal(result.findings.length, 0);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: returns truncated: true when maxFiles reached", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		// Create enough files to hit the cap. Use a tiny maxFiles so the
		// test stays fast.
		for (let i = 0; i < 25; i += 1) {
			writeRepoFile(repoPath, `dir-${i}/file.txt`, "");
		}
		const result = runHygieneSensor({
			stateRoot,
			repoPath,
			maxFiles: 10,
		});
		assert.equal(result.truncated, true);
		// scannedPaths is bounded by maxFiles.
		assert.ok(result.scannedPaths <= 10);
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: bounded by maxDepth (11 levels deep should NOT be scanned)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		// Build a deep path: a/a/a/a/a/a/a/a/a/a/a (11 levels) + .DS_Store
		// The walker starts at depth 0 (the repo root). Default maxDepth=10,
		// so depth 11 must be unreachable.
		const deepRel =
			Array.from({ length: 11 }, () => "a").join(sep) + sep + ".DS_Store";
		writeRepoFile(repoPath, deepRel);
		// Also place a junk file at depth 1 that SHOULD be found.
		writeRepoFile(repoPath, "b" + sep + ".DS_Store");

		const result = runSensor(stateRoot, repoPath);
		const deepHit = result.findings.some((f) =>
			f.path.includes(`a${sep}a${sep}a`),
		);
		const shallowHit = result.findings.some(
			(f) => f.pattern === ".DS_Store" && f.path.endsWith(`b${sep}.DS_Store`),
		);
		assert.equal(deepHit, false, "deep junk should be out of reach");
		assert.equal(shallowHit, true, "shallow junk must be reported");
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: produces fingerprint (sha1 of absolute path)", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		const written = writeRepoFile(repoPath, "src/.DS_Store");
		const result = runSensor(stateRoot, repoPath);
		const ds = result.findings.find((f) => f.pattern === ".DS_Store");
		assert.ok(ds, "expected a .DS_Store finding");
		const expected = createHash("sha1").update(written).digest("hex");
		assert.equal(ds.fingerprint, expected);
		assert.equal(ds.severity, "info");
		assert.equal(typeof ds.path, "string");
	} finally {
		cleanup();
	}
});

test("runHygieneSensor: performance — 1k files scanned in under 2s", () => {
	const { repoPath, stateRoot, cleanup } = makeSandbox();
	try {
		// Create 1000 files in a balanced directory tree.
		for (let i = 0; i < 1000; i += 1) {
			const dir = `bucket-${i % 20}`;
			writeRepoFile(repoPath, `${dir}/file-${i}.txt`, "");
		}
		const start = performance.now();
		const result = runSensor(stateRoot, repoPath);
		const elapsedMs = performance.now() - start;
		assert.ok(
			elapsedMs < 2000,
			`sensor took ${elapsedMs.toFixed(1)}ms (expected <2000ms) for ${result.scannedPaths} scanned paths`,
		);
		assert.equal(result.truncated, false);
	} finally {
		cleanup();
	}
});
