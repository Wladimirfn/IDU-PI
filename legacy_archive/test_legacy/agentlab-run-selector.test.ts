import assert from "node:assert/strict";
import test from "node:test";
import {
	isAgentLabDispatchFilename,
	isAgentLabRunFilename,
	parseAgentLabRunSelector,
	RUN_SELECTOR_ERROR_HINT,
	type RunSelector,
} from "../src/agentlab-run-selector.js";

// Scenario: parseAgentLabRunSelector — current selector
test("parseAgentLabRunSelector returns current for bare \"current\"", () => {
	const result = parseAgentLabRunSelector("current");
	assert.deepEqual(result, { kind: "current" } satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — new-format runId (bare)
test("parseAgentLabRunSelector returns run_id for bare run-<unix>-<hex>", () => {
	const result = parseAgentLabRunSelector("run-1783107836-0c0b0b");
	assert.deepEqual(result, {
		kind: "run_id",
		runId: "run-1783107836-0c0b0b",
	} satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — legacy filename
test("parseAgentLabRunSelector returns legacy_file for legacy filename", () => {
	const result = parseAgentLabRunSelector(
		"agentlab-review-run-20260611-101530.json",
	);
	assert.deepEqual(result, {
		kind: "legacy_file",
		filename: "agentlab-review-run-20260611-101530.json",
	} satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — absolute path resolves to basename
test("parseAgentLabRunSelector strips path prefix to find run-<unix>-<hex> runId", () => {
	const result = parseAgentLabRunSelector(
		"/abs/path/to/agentlabs/runs/run-1783107836-0c0b0b.json",
	);
	assert.deepEqual(result, {
		kind: "run_id",
		runId: "run-1783107836-0c0b0b",
	} satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — Windows-style absolute path resolves too
test("parseAgentLabRunSelector strips Windows path prefix", () => {
	const result = parseAgentLabRunSelector(
		"C:\\idu\\state\\agentlabs\\runs\\run-1783107836-0c0b0b.json",
	);
	assert.deepEqual(result, {
		kind: "run_id",
		runId: "run-1783107836-0c0b0b",
	} satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — relative path resolves to basename
test("parseAgentLabRunSelector strips relative directory prefix", () => {
	const result = parseAgentLabRunSelector(
		"agentlabs/runs/run-1783107836-0c0b0b.json",
	);
	assert.deepEqual(result, {
		kind: "run_id",
		runId: "run-1783107836-0c0b0b",
	} satisfies RunSelector);
});

// Scenario: parseAgentLabRunSelector — malformed input returns null
test("parseAgentLabRunSelector returns null for arbitrary path that is not a run artifact", () => {
	const result = parseAgentLabRunSelector("some/random/path.txt");
	assert.equal(result, null);
});

// Scenario: parseAgentLabRunSelector — empty string returns null
test("parseAgentLabRunSelector returns null for empty string", () => {
	const result = parseAgentLabRunSelector("");
	assert.equal(result, null);
});

// Defensive: non-string types also return null instead of throwing.
test("parseAgentLabRunSelector returns null for whitespace-only input", () => {
	const result = parseAgentLabRunSelector("   \t  ");
	assert.equal(result, null);
});

// Backwards compatibility: legacy format parses from a path too.
test("parseAgentLabRunSelector returns legacy_file when basename is the legacy filename", () => {
	const result = parseAgentLabRunSelector(
		"/some/reports/agentlab-review-run-20260101-000000.json",
	);
	assert.deepEqual(result, {
		kind: "legacy_file",
		filename: "agentlab-review-run-20260101-000000.json",
	} satisfies RunSelector);
});

// Predicate: isAgentLabRunFilename accepts every run artifact shape.
test("isAgentLabRunFilename accepts current.json", () => {
	assert.equal(isAgentLabRunFilename("current.json"), true);
});

test("isAgentLabRunFilename accepts legacy filename", () => {
	assert.equal(
		isAgentLabRunFilename("agentlab-review-run-20260611-101530.json"),
		true,
	);
});

test("isAgentLabRunFilename accepts new-format runId filename", () => {
	assert.equal(isAgentLabRunFilename("run-1783107836-0c0b0b.json"), true);
});

// Predicate: isAgentLabRunFilename rejects the dispatch placeholder and other noise.
test("isAgentLabRunFilename rejects dispatch.json placeholders", () => {
	assert.equal(
		isAgentLabRunFilename("run-1783107836-0c0b0b.dispatch.json"),
		false,
	);
});

test("isAgentLabRunFilename rejects arbitrary filenames", () => {
	assert.equal(isAgentLabRunFilename("random.txt"), false);
	assert.equal(isAgentLabRunFilename(""), false);
	assert.equal(isAgentLabRunFilename("   "), false);
});

// Predicate: isAgentLabDispatchFilename accepts the dispatch placeholder shape only.
test("isAgentLabDispatchFilename accepts dispatch.json placeholders", () => {
	assert.equal(
		isAgentLabDispatchFilename("run-1783107836-0c0b0b.dispatch.json"),
		true,
	);
});

test("isAgentLabDispatchFilename rejects non-dispatch filenames", () => {
	assert.equal(isAgentLabDispatchFilename("current.json"), false);
	assert.equal(isAgentLabDispatchFilename("run-1783107836-0c0b0b.json"), false);
	assert.equal(
		isAgentLabDispatchFilename("agentlab-review-run-20260611-101530.json"),
		false,
	);
	assert.equal(isAgentLabDispatchFilename(""), false);
});

// Hint string: must exist and be pure UX prose — no regex literal form
// (e.g. `/^run-\d+-...$/`) leaks the contract.
test("RUN_SELECTOR_ERROR_HINT is a non-empty human-readable string with no regex literal", () => {
	assert.equal(typeof RUN_SELECTOR_ERROR_HINT, "string");
	assert.ok(RUN_SELECTOR_ERROR_HINT.length > 0);
	// No regex literal pattern: a slash-delimited `/^...$/` form. We approximate
	// "regex-like" by checking the hint does not start with `^` and does not end
	// with `$` (a heuristic — not exhaustive, but enough to catch the literal
	// re-export of a regex constant).
	assert.equal(/^\^/u.test(RUN_SELECTOR_ERROR_HINT), false);
	assert.equal(/\$$/u.test(RUN_SELECTOR_ERROR_HINT), false);
});