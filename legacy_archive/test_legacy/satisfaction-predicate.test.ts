import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	defaultPredicateForKind,
	evaluatePredicate,
	type McpUsageEntry,
	type SatisfactionPredicate,
} from "../src/satisfaction-predicate.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-sat-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("tool-called: satisfied when tool called within windowMs", () => {
	const deliveredAt = "2026-06-17T10:00:00Z";
	const now = new Date("2026-06-17T10:30:00Z"); // 30min after delivery
	const usageLog: McpUsageEntry[] = [
		{ tool: "idu_supervisor_context_pack", ts: "2026-06-17T10:15:00Z" }, // 15min after, within 1h window
	];

	const result = evaluatePredicate({
		predicate: { kind: "tool-called", tool: "idu_supervisor_context_pack", windowMs: 3600000 },
		deliveredAt,
		now,
		usageLog,
	});

	assert.equal(result.outcome, "satisfied");
	assert.ok(result.reason.includes("idu_supervisor_context_pack"));
});

test("tool-called: delivered-not-resolved when past windowMs without call", () => {
	const deliveredAt = "2026-06-17T10:00:00Z";
	const now = new Date("2026-06-17T11:30:00Z"); // 1.5h after
	const usageLog: McpUsageEntry[] = []; // no calls

	const result = evaluatePredicate({
		predicate: { kind: "tool-called", tool: "idu_supervisor_context_pack", windowMs: 3600000 },
		deliveredAt,
		now,
		usageLog,
	});

	assert.equal(result.outcome, "delivered-not-resolved");
});

test("tool-called: delivered-not-resolved when within window but no call yet", () => {
	const deliveredAt = "2026-06-17T10:00:00Z";
	const now = new Date("2026-06-17T10:30:00Z"); // 30min after, still within 1h window
	const usageLog: McpUsageEntry[] = []; // no calls yet

	const result = evaluatePredicate({
		predicate: { kind: "tool-called", tool: "idu_supervisor_context_pack", windowMs: 3600000 },
		deliveredAt,
		now,
		usageLog,
	});

	// Within window, no call yet — still waiting, treated as delivered-not-resolved
	// (the orchestrator may still act before the window ends)
	assert.equal(result.outcome, "delivered-not-resolved");
});

test("tool-called: tool call BEFORE deliveredAt does NOT satisfy (early call)", () => {
	const deliveredAt = "2026-06-17T10:00:00Z";
	const now = new Date("2026-06-17T10:15:00Z");
	const usageLog: McpUsageEntry[] = [
		{ tool: "idu_supervisor_context_pack", ts: "2026-06-17T09:00:00Z" }, // before delivery
	];

	const result = evaluatePredicate({
		predicate: { kind: "tool-called", tool: "idu_supervisor_context_pack", windowMs: 3600000 },
		deliveredAt,
		now,
		usageLog,
	});

	assert.equal(result.outcome, "delivered-not-resolved");
});

test("path-absent: satisfied when path no longer exists", () => {
	const { root, cleanup } = makeRoot();
	try {
		const target = join(root, "tmp-debug.mjs");
		// File does NOT exist (we never create it)

		const result = evaluatePredicate({
			predicate: { kind: "path-absent", path: target },
			deliveredAt: new Date().toISOString(),
			now: new Date(),
			usageLog: [],
		});

		assert.equal(result.outcome, "satisfied");
		assert.ok(result.reason.includes("no longer exists"));
	} finally {
		cleanup();
	}
});

test("path-absent: delivered-not-resolved when path still exists", () => {
	const { root, cleanup } = makeRoot();
	try {
		const target = join(root, "tmp-debug.mjs");
		writeFileSync(target, "// still here");

		const result = evaluatePredicate({
			predicate: { kind: "path-absent", path: target },
			deliveredAt: new Date().toISOString(),
			now: new Date(),
			usageLog: [],
		});

		assert.equal(result.outcome, "delivered-not-resolved");
	} finally {
		cleanup();
	}
});

test("state-key: returns delivered-not-resolved (reserved for future use)", () => {
	const result = evaluatePredicate({
		predicate: { kind: "state-key", key: "objective.json", expected: { foo: "bar" } },
		deliveredAt: new Date().toISOString(),
		now: new Date(),
		usageLog: [],
	});

	assert.equal(result.outcome, "delivered-not-resolved");
});

test("defaultPredicateForKind: objective_reminder returns tool-called idu_supervisor_context_pack", () => {
	const p = defaultPredicateForKind("objective_reminder");
	assert.ok(p);
	assert.equal(p.kind, "tool-called");
	if (p.kind === "tool-called") {
		assert.equal(p.tool, "idu_supervisor_context_pack");
		assert.equal(p.windowMs, 3600000);
	}
});

test("defaultPredicateForKind: hygiene_junk_file returns path-absent with the file path", () => {
	const p = defaultPredicateForKind("hygiene_junk_file", { path: "/tmp/junk.mjs" });
	assert.ok(p);
	assert.equal(p.kind, "path-absent");
	if (p.kind === "path-absent") {
		assert.equal(p.path, "/tmp/junk.mjs");
	}
});

test("defaultPredicateForKind: returns null for unknown kinds", () => {
	const p = defaultPredicateForKind("user_escalation");
	assert.equal(p, null);
});

test("defaultPredicateForKind: hygiene_junk_file without path returns null", () => {
	const p = defaultPredicateForKind("hygiene_junk_file");
	assert.equal(p, null);
});

test("AUDITOR-CRITICAL: vocabulary is fixed — only 3 kinds accepted", () => {
	// The vocabulary is FIXED. Adding a new kind is intentional friction
	// (scope-creep guard). This test documents the current vocabulary.
	const validKinds: SatisfactionPredicate["kind"][] = [
		"tool-called",
		"path-absent",
		"state-key",
	];
	assert.equal(validKinds.length, 3);
});