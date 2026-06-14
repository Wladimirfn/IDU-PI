import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readTaxonomyGuide,
	reviewPlacement,
	seedTaxonomyTemplates,
} from "../src/taxonomy-placement.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-g5-taxonomy-"));
}

test("readTaxonomyGuide returns built-in default when guide is absent (no throw)", () => {
	const stateRoot = makeStateRoot();
	try {
		const guide = readTaxonomyGuide(stateRoot, "web");
		assert.ok(Array.isArray(guide.rules));
		assert.ok(guide.rules.length > 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("readTaxonomyGuide parses a persisted guide when present", () => {
	const stateRoot = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "birth", "taxonomy"), { recursive: true });
		writeFileSync(
			join(stateRoot, "birth", "taxonomy", "web.json"),
			JSON.stringify({
				version: 1,
				projectType: "web",
				rules: [{ id: "r1", canonicalDir: "src/components", mustIndex: true }],
			}),
			"utf8",
		);
		const guide = readTaxonomyGuide(stateRoot, "web");
		assert.equal(guide.rules.length, 1);
		assert.equal(guide.rules[0]?.id, "r1");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("reviewPlacement returns no violation for artifact in canonical dir", () => {
	const guide = {
		version: 1 as const,
		projectType: "web",
		rules: [{ id: "r1", canonicalDir: "src/components", mustIndex: true }],
	};
	const artifacts = [{ path: "src/components/Button.tsx", indexed: true }];
	const violations = reviewPlacement(artifacts, guide);
	assert.deepEqual(violations, []);
});

test("reviewPlacement emits violation for artifact in wrong dir (no throw)", () => {
	const guide = {
		version: 1 as const,
		projectType: "web",
		rules: [{ id: "r1", canonicalDir: "src/components", mustIndex: true }],
	};
	const artifacts = [{ path: "lib/Button.tsx", indexed: true }];
	const violations = reviewPlacement(artifacts, guide);
	assert.equal(violations.length, 1);
	assert.equal(violations[0]?.ruleId, "r1");
	assert.equal(violations[0]?.artifactPath, "lib/Button.tsx");
});

test("reviewPlacement emits violation when mustIndex set but artifact is missing from index", () => {
	const guide = {
		version: 1 as const,
		projectType: "web",
		rules: [{ id: "r1", canonicalDir: "src/components", mustIndex: true }],
	};
	const artifacts = [{ path: "src/components/Button.tsx", indexed: false }];
	const violations = reviewPlacement(artifacts, guide);
	assert.equal(violations.length, 1);
	assert.match(violations[0]?.message ?? "", /must be indexed/u);
});

test("reviewPlacement with multi-rule guide: artifact matches one rule → single violation only if mustIndex unmet", () => {
	const guide = {
		version: 1 as const,
		projectType: "web",
		rules: [
			{ id: "components", canonicalDir: "src/components", mustIndex: true },
			{ id: "pages", canonicalDir: "src/pages", mustIndex: true },
			{ id: "routes", canonicalDir: "src/routes", mustIndex: false },
		],
	};
	// Artifact in src/components, indexed → no violation
	const violations1 = reviewPlacement(
		[{ path: "src/components/Button.tsx", indexed: true }],
		guide,
	);
	assert.deepEqual(violations1, []);
	// Artifact in src/components, NOT indexed → 1 violation (not 3)
	const violations2 = reviewPlacement(
		[{ path: "src/components/Button.tsx", indexed: false }],
		guide,
	);
	assert.equal(violations2.length, 1);
	assert.equal(violations2[0]?.ruleId, "components");
	// Artifact in unknown dir → 1 violation naming the artifact
	const violations3 = reviewPlacement(
		[{ path: "lib/Helper.ts", indexed: true }],
		guide,
	);
	assert.equal(violations3.length, 1);
	assert.equal(violations3[0]?.artifactPath, "lib/Helper.ts");
});

test("seedTaxonomyTemplates creates default guide for the given project type", () => {
	const stateRoot = makeStateRoot();
	try {
		seedTaxonomyTemplates(stateRoot, "web");
		const path = join(stateRoot, "birth", "taxonomy", "web.json");
		assert.equal(existsSync(path), true, "seeded file should exist on disk");
		const guide = readTaxonomyGuide(stateRoot, "web");
		assert.equal(guide.projectType, "web");
		assert.ok(guide.rules.length > 0);
		void path;
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("seedTaxonomyTemplates is idempotent (does not overwrite existing guide)", () => {
	const stateRoot = makeStateRoot();
	try {
		seedTaxonomyTemplates(stateRoot, "web");
		// Seed twice — should not throw
		seedTaxonomyTemplates(stateRoot, "web");
		const guide = readTaxonomyGuide(stateRoot, "web");
		assert.ok(guide.rules.length > 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
