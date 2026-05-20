import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatDurationChoices,
	labPrompt,
	parseLabDuration,
} from "../src/lab.js";

test("parseLabDuration accepts depth labels and selector numbers", () => {
	assert.equal(parseLabDuration("1")?.label, "quick");
	assert.equal(parseLabDuration("2")?.label, "3tests");
	assert.equal(parseLabDuration("4.")?.label, "full");
	assert.equal(parseLabDuration("5tests")?.maxCommands, 5);
	assert.equal(parseLabDuration("bad"), undefined);
});

test("formatDurationChoices lists all options", () => {
	const choices = formatDurationChoices();
	assert.match(choices, /1\. quick/);
	assert.match(choices, /4\. full/);
});

test("labPrompt includes lab safety constraints", () => {
	const prompt = labPrompt(
		{
			label: "3tests",
			ms: 900_000,
			maxCommands: 3,
			description: "hasta 3 comandos",
		},
		{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
	);
	assert.match(prompt, /Profundidad: 3tests/);
	assert.match(prompt, /No hagas commit/);
	assert.match(prompt, /No hagas push/);
	assert.match(prompt, /workspace\/clon/);
	assert.match(prompt, /máximo 3 comandos/);
	assert.match(prompt, /corepack pnpm test/);
});
