import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	CANONICAL_PATTERNS,
	compileJunkPatterns,
	globToRegex,
	loadJunkPatterns,
	type JunkPatterns,
} from "../src/junk-patterns.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "junk-patterns-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("loadJunkPatterns: returns canonical + empty blocklist + empty allowlist when no override file", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = loadJunkPatterns(root);
		assert.deepEqual(result.canonical, CANONICAL_PATTERNS);
		assert.deepEqual(result.blocklist, []);
		assert.deepEqual(result.allowlist, []);
	} finally {
		cleanup();
	}
});

test("loadJunkPatterns: reads blocklist from hygiene-patterns.json", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "hygiene-patterns.json"),
			JSON.stringify({ blocklist: ["*.pyc", "build/"], allowlist: [] }),
		);
		const result = loadJunkPatterns(root);
		assert.deepEqual(result.blocklist, ["*.pyc", "build/"]);
		assert.deepEqual(result.allowlist, []);
	} finally {
		cleanup();
	}
});

test("loadJunkPatterns: reads allowlist from hygiene-patterns.json", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "hygiene-patterns.json"),
			JSON.stringify({ blocklist: [], allowlist: ["tmp-keep/", "*.secret"] }),
		);
		const result = loadJunkPatterns(root);
		assert.deepEqual(result.blocklist, []);
		assert.deepEqual(result.allowlist, ["tmp-keep/", "*.secret"]);
	} finally {
		cleanup();
	}
});

test("loadJunkPatterns: falls back to canonical-only on malformed JSON (fail-safe)", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(join(root, "hygiene-patterns.json"), "{not valid json");
		const result = loadJunkPatterns(root);
		assert.deepEqual(result.canonical, CANONICAL_PATTERNS);
		assert.deepEqual(result.blocklist, []);
		assert.deepEqual(result.allowlist, []);
	} finally {
		cleanup();
	}
});

test("loadJunkPatterns: falls back to canonical-only on missing file", () => {
	const { root, cleanup } = makeRoot();
	try {
		assert.equal(existsSync(join(root, "hygiene-patterns.json")), false);
		const result = loadJunkPatterns(root);
		assert.deepEqual(result.canonical, CANONICAL_PATTERNS);
		assert.deepEqual(result.blocklist, []);
		assert.deepEqual(result.allowlist, []);
	} finally {
		cleanup();
	}
});

test("compileJunkPatterns: adds blocklist to canonical, removes allowlist", () => {
	const patterns: JunkPatterns = {
		canonical: [".DS_Store", "*.bak"],
		blocklist: ["*.pyc", "build/"],
		allowlist: [".DS_Store"], // user wants to whitelist .DS_Store
	};
	const compiled = compileJunkPatterns(patterns);
	// effective = canonical + blocklist - allowlist
	assert.ok(compiled.patterns.includes("*.bak"));
	assert.ok(compiled.patterns.includes("*.pyc"));
	assert.ok(compiled.patterns.includes("build/"));
	assert.ok(!compiled.patterns.includes(".DS_Store"));
	// raw is preserved
	assert.deepEqual(compiled.raw, patterns);
});

test("globToRegex: matches canonical patterns against known-good paths", () => {
	const cases: Array<{ pattern: string; path: string; expected: boolean }> = [
		{ pattern: ".DS_Store", path: "src/.DS_Store", expected: true },
		{ pattern: ".DS_Store", path: "src/index.ts", expected: false },
		{ pattern: "Thumbs.db", path: "docs/Thumbs.db", expected: true },
		{ pattern: "*.bak", path: "config/old.bak", expected: true },
		{ pattern: "*.bak", path: "config/current.json", expected: false },
		{ pattern: "*~", path: "README~", expected: true },
		{ pattern: "*.swp", path: "src/foo.swp", expected: true },
		{ pattern: "tmp-*.mjs", path: "tmp-debug.mjs", expected: true },
		{ pattern: "tmp-*.mjs", path: "scripts/run.mjs", expected: false },
		{ pattern: "tmp-*.cjs", path: "tmp-build.cjs", expected: true },
		{ pattern: "sdd-*-output.md", path: "sdd-init-output.md", expected: true },
		{ pattern: "sdd-*-output.md", path: "sdd-apply-output.md", expected: true },
		{ pattern: "sdd-*-output.md", path: "docs/notes.md", expected: false },
	];
	for (const { pattern, path, expected } of cases) {
		const re = globToRegex(pattern);
		assert.equal(
			re.test(path),
			expected,
			`pattern=${pattern} path=${path} expected=${expected}`,
		);
	}
});

test("auditor-validated: canonical pattern set does NOT include node_modules, __pycache__, .vs, .idea", () => {
	// Auditor correction #2456: deps/IDE dirs are NOT garbage. They are
	// user-managed and excluded from the canonical set.
	const set = CANONICAL_PATTERNS as readonly string[];
	assert.ok(!set.includes("node_modules/"));
	assert.ok(!set.includes("node_modules"));
	assert.ok(!set.includes("__pycache__/"));
	assert.ok(!set.includes("__pycache__"));
	assert.ok(!set.includes(".vs/"));
	assert.ok(!set.includes(".vs"));
	assert.ok(!set.includes(".idea/"));
	assert.ok(!set.includes(".idea"));
});