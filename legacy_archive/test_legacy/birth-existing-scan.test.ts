import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanExistingProject } from "../src/birth-existing-scan.js";
import type { NormalizedBirthGeneralSpec } from "../src/birth-general-spec.js";

function makeFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-birth-scan-"));
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "test"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "assets"), { recursive: true });
	mkdirSync(join(root, "node_modules", "ignored"), { recursive: true });
	mkdirSync(join(root, ".git"), { recursive: true });
	mkdirSync(join(root, "dist"), { recursive: true });

	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "fixture",
			scripts: { test: "node --test dist/test/*.test.js" },
			dependencies: { typescript: "*" },
		}),
		"utf8",
	);
	writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf8");
	writeFileSync(
		join(root, "src", "App.tsx"),
		"export const App = () => null;\n",
		"utf8",
	);
	writeFileSync(
		join(root, "test", "example.test.ts"),
		"test('x', () => {});\n",
		"utf8",
	);
	writeFileSync(join(root, "docs", "readme.md"), "# docs\n", "utf8");
	writeFileSync(join(root, "assets", "logo.svg"), "<svg/>\n", "utf8");
	writeFileSync(
		join(root, "node_modules", "ignored", "x.js"),
		"// ignored\n",
		"utf8",
	);
	return root;
}

test("scanExistingProject detects package manager, languages, tests, docs, assets", () => {
	const root = makeFixture();
	try {
		const result = scanExistingProject({
			projectPath: root,
			projectId: "fixture",
		});
		assert.equal(result.scan.projectId, "fixture");
		assert.equal(result.scan.observed.packageManager, "pnpm");
		assert.ok(
			result.scan.observed.languages.includes("TypeScript"),
			"expected TypeScript detection",
		);
		assert.ok(
			result.scan.observed.frameworks.includes("typescript"),
			"expected typescript framework",
		);
		assert.ok(result.scan.observed.tests.length > 0);
		assert.ok(result.scan.observed.docs.length > 0);
		assert.ok(result.scan.observed.assets.length > 0);
		assert.equal(result.scan.approval.status, "draft");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject ignores node_modules, .git, and dist", () => {
	const root = makeFixture();
	try {
		const result = scanExistingProject({
			projectPath: root,
			projectId: "fixture",
		});
		const all = JSON.stringify(result.scan);
		assert.ok(
			!/node_modules\/ignored/u.test(all),
			"node_modules should be ignored",
		);
		assert.ok(!/\.git/u.test(all), ".git should be ignored");
		assert.ok(
			!/ignored\/x\.js/u.test(all),
			"ignored dist contents should be ignored",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject does not mark Project Core or Master Plan as approved", () => {
	const root = makeFixture();
	try {
		const result = scanExistingProject({
			projectPath: root,
			projectId: "fixture",
		});
		assert.equal(result.detectedSpecs.approval.status, "draft");
		// The scan is evidence, not approval
		assert.equal(result.detectedSpecs.status, "draft");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject emits a General Spec draft with scan-empty visual provenance", () => {
	const root = makeFixture();
	try {
		const result = scanExistingProject({
			projectPath: root,
			projectId: "fixture",
		});
		const detected = result.detectedSpecs as typeof result.detectedSpecs & {
			generalSpecDraft?: NormalizedBirthGeneralSpec;
		};
		const spec = detected.generalSpecDraft;
		assert.ok(spec, "expected detected specs to include generalSpecDraft");
		assert.equal(spec.specVersion, 1);
		assert.ok(
			spec.baseComponents.length > 0,
			"expected evidence-backed base components",
		);
		assert.ok(
			spec.pageStructureRules.length > 0,
			"expected evidence-backed page structure rules",
		);
		assert.ok(spec.dataRules.length > 0, "expected evidence-backed data rules");
		for (const field of [
			"navigation",
			"interactionRules",
			"motionRules",
			"accessibilityCriteria",
			"performanceCriteria",
		] as const) {
			assert.deepEqual(
				spec[field],
				[],
				`${field} should stay empty at scan stage`,
			);
			assert.equal(
				spec.provenance[field],
				"scan-empty",
				`${field} should be distinguishably empty`,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject keeps detectedSpecs fields additive while adding General Spec draft", () => {
	const root = makeFixture();
	try {
		const result = scanExistingProject({
			projectPath: root,
			projectId: "fixture",
		});
		assert.ok(Array.isArray(result.detectedSpecs.detected.stack));
		assert.ok(
			Array.isArray(result.detectedSpecs.detected.architecturePatterns),
		);
		assert.ok(Array.isArray(result.detectedSpecs.detected.visualPatterns));
		assert.ok(Array.isArray(result.detectedSpecs.detected.testPatterns));
		assert.deepEqual(result.detectedSpecs.detected.visualPatterns, []);
		const detected = result.detectedSpecs as typeof result.detectedSpecs & {
			generalSpecDraft?: NormalizedBirthGeneralSpec;
		};
		assert.ok(detected.generalSpecDraft);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject detects yarn when only yarn.lock is present", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-birth-yarn-"));
	try {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "y", dependencies: {} }),
			"utf8",
		);
		writeFileSync(join(root, "yarn.lock"), "yarn lockfile v1\n", "utf8");
		writeFileSync(
			join(root, "src", "index.js"),
			"module.exports = 1;\n",
			"utf8",
		);

		const result = scanExistingProject({
			projectPath: root,
			projectId: "y",
		});
		assert.equal(result.scan.observed.packageManager, "yarn");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanExistingProject detects npm when only package-lock.json is present", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-birth-npm-"));
	try {
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "n", dependencies: {} }),
			"utf8",
		);
		writeFileSync(
			join(root, "package-lock.json"),
			JSON.stringify({ name: "n", lockfileVersion: 1 }),
			"utf8",
		);
		writeFileSync(
			join(root, "src", "index.js"),
			"module.exports = 1;\n",
			"utf8",
		);

		const result = scanExistingProject({
			projectPath: root,
			projectId: "n",
		});
		assert.equal(result.scan.observed.packageManager, "npm");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
