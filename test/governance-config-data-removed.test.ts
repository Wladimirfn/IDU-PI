// Issue #267 — refactor(mcp): remove legacy zero-arg governanceConfigData().
//
// Phase 2 (#267) deletes the zero-argument governanceConfigData() helper
// from src/mcp-server.ts. After Phase 0 (#263) and Phase 1 (#266) every
// builder and handler reads runtime-owned governance config, so the legacy
// helper has zero production callers.
//
// This is a static source-level regression test: it walks src/**/*.ts,
// reads every file, and asserts the identifier governanceConfigData has
// zero occurrences in production source. The pure helper
// governanceConfigFromConfig (src/config.ts) is the single source of truth
// and is NOT flagged by this test.
//
// RED (before deletion): src/mcp-server.ts still defines
// governanceConfigData() → the scan finds 1+ occurrence and fails.
//
// GREEN (after deletion): zero occurrences in src/.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = join(import.meta.dirname, "..", "..");
const srcDir = join(repoRoot, "src");

/**
 * Recursively collect every .ts file path under a directory.
 */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			collectTsFiles(fullPath, acc);
		} else if (entry.endsWith(".ts")) {
			acc.push(fullPath);
		}
	}
	return acc;
}

/**
 * Count occurrences of the identifier `governanceConfigData` in a source
 * string. Uses a regex with word boundaries so that
 * `governanceConfigFromConfig` is NOT matched.
 */
function countGovernanceConfigData(source: string): number {
	const matches = source.match(/\bgovernanceConfigData\b/g);
	return matches ? matches.length : 0;
}

test("#267 src/ has zero occurrences of governanceConfigData (legacy helper removed)", () => {
	const files = collectTsFiles(srcDir);
	const hits: { file: string; count: number }[] = [];

	for (const file of files) {
		const source = readFileSync(file, "utf8");
		const count = countGovernanceConfigData(source);
		if (count > 0) {
			hits.push({ file, count });
		}
	}

	assert.equal(
		hits.length,
		0,
		`Expected zero occurrences of governanceConfigData in src/. ` +
			`Found ${hits.reduce((s, h) => s + h.count, 0)} occurrence(s) in ` +
			`${hits.length} file(s):\n` +
			hits
				.map(
					(h) =>
						`  ${h.file.replace(repoRoot + "\\", "")} (${h.count})`,
				)
				.join("\n") +
			`\nThe legacy zero-arg governanceConfigData() should be deleted ` +
			`from src/mcp-server.ts (Phase 2 of #254).`,
	);
});
