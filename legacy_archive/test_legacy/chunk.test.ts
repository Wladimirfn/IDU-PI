import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkTelegramText } from "../src/chunk.js";

test("chunkTelegramText returns placeholder for empty output", () => {
	assert.deepEqual(chunkTelegramText("   "), ["(sin salida)"]);
});

test("chunkTelegramText splits long messages under the limit", () => {
	const chunks = chunkTelegramText("a ".repeat(20), 10);
	assert.ok(chunks.length > 1);
	assert.ok(chunks.every((chunk) => chunk.length <= 10));
});
