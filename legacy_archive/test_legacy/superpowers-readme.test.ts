import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");

test("docs/superpowers/README.md exists and points to openspec/changes/ (B4 housekeeping)", () => {
	const path = join(repoRoot, "docs/superpowers/README.md");
	assert.ok(existsSync(path), `expected ${path} to exist`);
	const contents = readFileSync(path, "utf8");
	assert.ok(
		/openspec\/changes\//.test(contents),
		`expected docs/superpowers/README.md to mention openspec/changes/`,
	);
});
