import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");

test("README.md mentions openspec/changes/ as the canonical SDD home (B4 housekeeping)", () => {
	const path = join(repoRoot, "README.md");
	assert.ok(existsSync(path));
	const contents = readFileSync(path, "utf8");
	assert.ok(
		/openspec\/changes\//.test(contents),
		`expected README.md to mention openspec/changes/ as the canonical SDD home`,
	);
	assert.ok(
		/Spec[\s-]*Driven/i.test(contents),
		`expected README.md to have a 'Spec-Driven' section`,
	);
});
