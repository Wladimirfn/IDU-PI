import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");

function readGitignore(): string {
	const path = join(repoRoot, ".gitignore");
	assert.ok(existsSync(path), `.gitignore should exist at ${path}`);
	return readFileSync(path, "utf8");
}

function hasGitignoreEntry(contents: string, entry: string): boolean {
	// Match an entry on its own line: leading whitespace, the entry,
	// optional trailing whitespace and comment. We split the contents
	// into lines and check each line.
	const lines = contents.split(/\r?\n/);
	for (const line of lines) {
		const stripped = line.replace(/\s*(#.*)?$/, "").trim();
		if (stripped === entry.trim()) return true;
	}
	return false;
}

test("REGRESSION: .gitignore contains outputMode/ (B4 housekeeping)", () => {
	const contents = readGitignore();
	assert.ok(
		hasGitignoreEntry(contents, "outputMode/"),
		`expected .gitignore to contain 'outputMode/' on its own line. ` +
			`Got contents:\n${contents}`,
	);
});

test(".gitignore still contains sdd-*-output.md (B4 housekeeping: pre-existing entry)", () => {
	const contents = readGitignore();
	assert.ok(
		hasGitignoreEntry(contents, "sdd-*-output.md"),
		`expected .gitignore to contain 'sdd-*-output.md' on its own line. ` +
			`Got contents:\n${contents}`,
	);
});

test(".gitignore still contains tmp-mcp-probe.mjs (B4 housekeeping: pre-existing entry)", () => {
	const contents = readGitignore();
	assert.ok(
		hasGitignoreEntry(contents, "tmp-mcp-probe.mjs"),
		`expected .gitignore to contain 'tmp-mcp-probe.mjs' on its own line. ` +
			`Got contents:\n${contents}`,
	);
});
