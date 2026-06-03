import assert from "node:assert/strict";
import test from "node:test";
import {
	mergeContextBudgetUsage,
	sliceListToBudget,
	sliceTextToBudget,
} from "../src/context-budget.js";

test("sliceTextToBudget truncates deterministically and records omission", () => {
	const result = sliceTextToBudget({
		text: "x".repeat(2_000),
		profile: "agentlab_request",
		path: "contextSummary",
		maxChars: 100,
	});

	assert.equal(result.text.endsWith("[context truncated]"), true);
	assert.equal(result.usage.profile, "agentlab_request");
	assert.equal(result.usage.truncated, true);
	assert.equal(result.usage.advisoryOnly, true);
	assert.equal(result.usage.contractPromotionAllowed, false);
	assert.deepEqual(result.usage.omitted[0]?.path, "contextSummary");
	assert.equal(result.usage.omitted[0]?.reason, "max_chars");
});

test("sliceListToBudget caps items and item length", () => {
	const result = sliceListToBudget({
		items: ["a".repeat(50), "b".repeat(50), "c".repeat(50)],
		profile: "agentlab_request",
		path: "evidence",
		maxItems: 2,
		maxItemChars: 20,
	});

	assert.equal(result.items.length, 2);
	assert.ok(result.items.every((item) => item.includes("[context truncated]")));
	assert.equal(result.usage.truncated, true);
	assert.equal(
		result.usage.omitted.some((item) => item.reason === "max_items"),
		true,
	);
	assert.equal(
		result.usage.omitted.some((item) => item.reason === "max_chars"),
		true,
	);
});

test("mergeContextBudgetUsage combines deterministic usage", () => {
	const one = sliceTextToBudget({
		text: "short",
		profile: "agentlab_request",
		path: "a",
	}).usage;
	const two = sliceTextToBudget({
		text: "x".repeat(200),
		profile: "agentlab_request",
		path: "b",
		maxChars: 50,
	}).usage;

	const merged = mergeContextBudgetUsage("agentlab_request", [one, two]);
	assert.equal(merged.truncated, true);
	assert.equal(merged.usedChars, one.usedChars + two.usedChars);
	assert.equal(merged.omitted.length, two.omitted.length);
});

test("mergeContextBudgetUsage records total overflow", () => {
	const usage = sliceTextToBudget({
		text: "x".repeat(1_500),
		profile: "agentlab_request",
		path: "field",
	}).usage;
	const merged = mergeContextBudgetUsage(
		"agentlab_request",
		Array.from({ length: 7 }, () => usage),
	);

	assert.equal(merged.usedChars, 8_000);
	assert.equal(merged.truncated, true);
	assert.equal(
		merged.omitted.some((item) => item.path === "contextBudget.total"),
		true,
	);
});
