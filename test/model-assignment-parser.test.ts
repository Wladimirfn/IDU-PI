import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isValidModelAssignment,
	parseModelAssignment,
} from "../src/model-assignment-parser.js";

test("parseModelAssignment splits canonical id into provider and model", () => {
	const result = parseModelAssignment("opencode-go/deepseek-v4-pro");

	assert.deepEqual(result, {
		provider: "opencode-go",
		model: "deepseek-v4-pro",
		canonicalId: "opencode-go/deepseek-v4-pro",
		raw: "opencode-go/deepseek-v4-pro",
	});
});

test("parseModelAssignment trims surrounding whitespace", () => {
	const result = parseModelAssignment("  opencode-go/deepseek-v4-pro\n");

	assert.equal(result.provider, "opencode-go");
	assert.equal(result.model, "deepseek-v4-pro");
	assert.equal(result.canonicalId, "opencode-go/deepseek-v4-pro");
	assert.equal(result.raw, "opencode-go/deepseek-v4-pro");
});

test("parseModelAssignment accepts a multi-segment model id (provider/a/b/c)", () => {
	const result = parseModelAssignment("openai/gpt-4o/vision");

	assert.equal(result.provider, "openai");
	assert.equal(result.model, "gpt-4o/vision");
	assert.equal(result.canonicalId, "openai/gpt-4o/vision");
});

test("parseModelAssignment accepts special characters in provider and model segments", () => {
	const result = parseModelAssignment("a.b_c~d:e@f%g+/model-name_v1");

	assert.equal(result.provider, "a.b_c~d:e@f%g+");
	assert.equal(result.model, "model-name_v1");
	assert.equal(result.canonicalId, "a.b_c~d:e@f%g+/model-name_v1");
});

test("parseModelAssignment rejects an empty string", () => {
	assert.throws(
		() => parseModelAssignment(""),
		/empty assignment/u,
	);
});

test("parseModelAssignment rejects a whitespace-only string", () => {
	assert.throws(
		() => parseModelAssignment("   "),
		/empty assignment/u,
	);
});

test("parseModelAssignment rejects a single-segment string without a slash", () => {
	assert.throws(
		() => parseModelAssignment("bare-profile-id"),
		/missing separator/u,
	);
});

test("parseModelAssignment rejects a value that ends with a slash", () => {
	assert.throws(
		() => parseModelAssignment("opencode-go/"),
		/empty model segment/u,
	);
});

test("parseModelAssignment rejects a value that starts with a slash", () => {
	assert.throws(
		() => parseModelAssignment("/deepseek-v4-pro"),
		/empty provider segment/u,
	);
});

test("isValidModelAssignment returns true for canonical id", () => {
	assert.equal(isValidModelAssignment("opencode-go/deepseek-v4-pro"), true);
});

test("isValidModelAssignment returns false for empty string", () => {
	assert.equal(isValidModelAssignment(""), false);
});

test("isValidModelAssignment returns false for a value without a slash", () => {
	assert.equal(isValidModelAssignment("bare-profile-id"), false);
});
