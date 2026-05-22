import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/index.ts", "utf8");

test("/queue_clear_structured clears structured queue only", () => {
	assert.match(source, /bot\.command\("queue_clear_structured"/u);
	const handler = source.slice(
		source.indexOf('bot.command("queue_clear_structured"'),
	);
	const handlerBlock = handler.slice(0, handler.indexOf('bot.command("mode"'));
	assert.match(handlerBlock, /structuredTaskQueue\.clearPersisted\(\)/u);
	assert.doesNotMatch(handlerBlock, /taskQueue\.clear\(\)/u);
	assert.match(handlerBlock, /Cola estructurada limpiada/u);
});
