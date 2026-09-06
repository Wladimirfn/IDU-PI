import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("semantic compaction Telegram commands are wired without apply", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("semantic_compact_draft"/u);
	assert.match(source, /bot\.command\("semantic_compact_review"/u);
	assert.match(source, /saveSemanticCompactionDraft/u);
	assert.match(source, /reviewSemanticCompactionDraft/u);
	assert.doesNotMatch(source, /semantic_compact_apply/u);
});
