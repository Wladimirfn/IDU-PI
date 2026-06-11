import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");

test("docs/cli-commands.md has a Cold start section (B4 housekeeping)", () => {
	const path = join(repoRoot, "docs/cli-commands.md");
	assert.ok(existsSync(path), `expected ${path} to exist`);
	const contents = readFileSync(path, "utf8");
	assert.ok(
		/##\s*Cold[\s_]?start/i.test(contents),
		`expected docs/cli-commands.md to have a 'Cold start' section`,
	);
	assert.ok(
		/tsc[\s-]+p[\s-]+tsconfig/.test(contents),
		`expected docs/cli-commands.md Cold start section to mention 'tsc -p tsconfig' (the reason the first invocation is slow)`,
	);
});
