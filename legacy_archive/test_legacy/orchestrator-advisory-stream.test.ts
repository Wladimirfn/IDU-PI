/**
 * Orchestrator Advisory Stream tests — T1.5 (RED → GREEN).
 *
 * These tests lock the stream's public contract: subscribe/unsubscribe,
 * filtering by roleId/sinceMs/limit, next/markRead, ring buffer bounds,
 * and JSONL disk persistence.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { RoleAdvisory } from "../src/roles/index.js";
import {
	getOrchestratorAdvisoryStream,
	resetOrchestratorAdvisoryStream,
} from "../src/orchestrator-advisory-stream.js";

let tempDir: string;

afterEach(() => {
	resetOrchestratorAdvisoryStream();
	if (tempDir && existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

function makeAdvisory(overrides: Partial<RoleAdvisory> = {}): RoleAdvisory {
	return {
		roleId: "supervisor-main",
		priority: 90,
		ts: new Date().toISOString(),
		advisory: "test advisory",
		evidenceRefs: ["test:ref"],
		meta: { test: true },
		...overrides,
	};
}

test("subscribe() yields advisories to the listener and unsubscribes correctly", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	const received: RoleAdvisory[] = [];
	const unsubscribe = stream.subscribe((advisory: RoleAdvisory) => {
		received.push(advisory);
	});

	const advisory1 = makeAdvisory({ roleId: "supervisor-main" });
	stream.append(advisory1);

	assert.equal(received.length, 1, "listener should receive first advisory");
	assert.deepEqual(received[0], advisory1, "advisory should match");

	const advisory2 = makeAdvisory({ roleId: "supervisor-semantic" });
	stream.append(advisory2);

	assert.equal(received.length, 2, "listener should receive second advisory");

	// Unsubscribe
	unsubscribe();

	const advisory3 = makeAdvisory({ roleId: "agentlab-security" });
	stream.append(advisory3);

	assert.equal(received.length, 2, "listener should NOT receive advisory after unsubscribe");
});

test("getAdvisories({ roleId }) filters by role", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	stream.append(makeAdvisory({ roleId: "supervisor-main" }));
	stream.append(makeAdvisory({ roleId: "supervisor-semantic" }));
	stream.append(makeAdvisory({ roleId: "supervisor-main" }));
	stream.append(makeAdvisory({ roleId: "agentlab-security" }));

	const mainAdvisories = stream.getAdvisories({ roleId: "supervisor-main" });
	assert.equal(mainAdvisories.length, 2, "should filter to supervisor-main only");
	assert.ok(
		mainAdvisories.every((a: RoleAdvisory) => a.roleId === "supervisor-main"),
		"all advisories should be supervisor-main",
	);

	const semanticAdvisories = stream.getAdvisories({ roleId: "supervisor-semantic" });
	assert.equal(semanticAdvisories.length, 1, "should filter to supervisor-semantic only");

	const securityAdvisories = stream.getAdvisories({ roleId: "agentlab-security" });
	assert.equal(securityAdvisories.length, 1, "should filter to agentlab-security only");
});

test("getAdvisories({ sinceMs }) filters by ts", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	const now = Date.now();
	const oldTs = new Date(now - 10000).toISOString(); // 10 seconds ago
	const recentTs = new Date(now - 3000).toISOString(); // 3 seconds ago
	const veryRecentTs = new Date(now - 500).toISOString(); // 0.5 seconds ago

	stream.append(makeAdvisory({ ts: oldTs }));
	stream.append(makeAdvisory({ ts: recentTs }));
	stream.append(makeAdvisory({ ts: veryRecentTs }));

	// Filter advisories since 5 seconds ago (should get recent + veryRecent)
	const sinceFiveSecondsAgo = now - 5000;
	const recent = stream.getAdvisories({ sinceMs: sinceFiveSecondsAgo });
	assert.equal(recent.length, 2, "should get 2 recent advisories");
	assert.ok(
		recent.every((a: RoleAdvisory) => Date.parse(a.ts) >= sinceFiveSecondsAgo),
		"all advisories should be recent",
	);

	// Filter since 1 second ago (should get only veryRecent)
	const sinceOneSecondAgo = now - 1000;
	const veryRecent = stream.getAdvisories({ sinceMs: sinceOneSecondAgo });
	assert.equal(veryRecent.length, 1, "should get 1 very recent advisory");
});

test("getAdvisories({ limit }) caps the result count", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	// Append 10 advisories
	const roleIds = ["supervisor-main", "supervisor-semantic", "supervisor-compaction", "agentlab-general", "agentlab-project-understanding", "agentlab-security", "agentlab-architecture", "agentlab-database", "agentlab-ui-ux", "agentlab-performance"] as const;
	for (let i = 0; i < 10; i++) {
		stream.append(makeAdvisory({ roleId: roleIds[i] }));
	}

	const limited = stream.getAdvisories({ limit: 5 });
	assert.equal(limited.length, 5, "should cap at 5 advisories");

	const limited3 = stream.getAdvisories({ limit: 3 });
	assert.equal(limited3.length, 3, "should cap at 3 advisories");

	const unlimited = stream.getAdvisories();
	assert.equal(unlimited.length, 10, "should return all 10 advisories when no limit");
});

test("getNextAdvisory(turnId) returns the highest-priority unread advisory", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	// Append advisories with different priorities
	stream.append(makeAdvisory({ roleId: "supervisor-main", priority: 90 }));
	stream.append(makeAdvisory({ roleId: "agentlab-security", priority: 95 }));
	stream.append(makeAdvisory({ roleId: "supervisor-semantic", priority: 80 }));

	const turnId = "turn-123";

	// First call should return highest priority (95)
	const first = stream.getNextAdvisory(turnId);
	assert.ok(first, "should return an advisory");
	assert.equal(first.priority, 95, "should return highest priority (95)");
	assert.equal(first.roleId, "agentlab-security", "should be agentlab-security");

	// Without marking as read, next call returns the same advisory
	const second = stream.getNextAdvisory(turnId);
	assert.ok(second, "should return an advisory");
	assert.equal(second.priority, 95, "should still return highest priority (95)");
	assert.equal(second.roleId, "agentlab-security", "should still be agentlab-security");
});

test("markAdvisoryRead(turnId, roleId) prevents the advisory from being returned again", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	stream.append(makeAdvisory({ roleId: "supervisor-main", priority: 90 }));
	stream.append(makeAdvisory({ roleId: "agentlab-security", priority: 95 }));
	stream.append(makeAdvisory({ roleId: "supervisor-semantic", priority: 80 }));

	const turnId = "turn-456";

	// Get highest priority (95)
	const first = stream.getNextAdvisory(turnId);
	assert.ok(first);
	assert.equal(first.priority, 95);
	assert.equal(first.roleId, "agentlab-security");

	// Mark it as read
	stream.markAdvisoryRead(turnId, "agentlab-security");

	// Next call should return the next highest (90)
	const second = stream.getNextAdvisory(turnId);
	assert.ok(second);
	assert.equal(second.priority, 90, "should return next highest priority (90)");
	assert.equal(second.roleId, "supervisor-main", "should be supervisor-main");

	// Mark it as read
	stream.markAdvisoryRead(turnId, "supervisor-main");

	// Next call should return the last one (80)
	const third = stream.getNextAdvisory(turnId);
	assert.ok(third);
	assert.equal(third.priority, 80, "should return last priority (80)");
	assert.equal(third.roleId, "supervisor-semantic", "should be supervisor-semantic");

	// Mark it as read
	stream.markAdvisoryRead(turnId, "supervisor-semantic");

	// Next call should return undefined (all read)
	const fourth = stream.getNextAdvisory(turnId);
	assert.equal(fourth, undefined, "should return undefined when all advisories are read");
});

test("the ring buffer is bounded (oldest advisories drop first)", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	// Default ring buffer size is 100
	// Append 120 advisories
	const roleIds = ["supervisor-main", "supervisor-semantic", "supervisor-compaction", "agentlab-general", "agentlab-project-understanding", "agentlab-security", "agentlab-architecture", "agentlab-database", "agentlab-ui-ux", "agentlab-performance"] as const;
	for (let i = 0; i < 120; i++) {
		stream.append(makeAdvisory({ roleId: roleIds[i % roleIds.length], advisory: `advisory-${i}` }));
	}

	// Should only have the last 100
	const all = stream.getAdvisories();
	assert.equal(all.length, 100, "ring buffer should cap at 100 advisories");

	// The first advisory in the buffer should be advisory-20 (oldest 20 dropped)
	assert.equal(all[0].advisory, "advisory-20", "oldest advisories should be dropped");
	assert.equal(all[99].advisory, "advisory-119", "newest advisory should be present");
});

test("the disk JSONL appender writes each advisory exactly once", () => {
	tempDir = mkdtempSync(join(tmpdir(), "oas-test-"));
	const stream = getOrchestratorAdvisoryStream(tempDir);

	const advisory1 = makeAdvisory({ roleId: "supervisor-main", advisory: "first" });
	const advisory2 = makeAdvisory({ roleId: "supervisor-semantic", advisory: "second" });
	const advisory3 = makeAdvisory({ roleId: "agentlab-security", advisory: "third" });

	stream.append(advisory1);
	stream.append(advisory2);
	stream.append(advisory3);

	// Check the JSONL file exists
	const jsonlPath = join(tempDir, "reports", "orchestrator-advisories.jsonl");
	assert.ok(existsSync(jsonlPath), "JSONL file should exist");

	// Read and parse the JSONL file
	const content = readFileSync(jsonlPath, "utf8");
	const lines = content.trim().split("\n");
	assert.equal(lines.length, 3, "JSONL should have 3 lines");

	// Parse each line and verify they match
	const parsed = lines.map((line) => JSON.parse(line));
	assert.deepEqual(parsed[0].roleId, "supervisor-main", "first line should be supervisor-main");
	assert.deepEqual(parsed[1].roleId, "supervisor-semantic", "second line should be supervisor-semantic");
	assert.deepEqual(parsed[2].roleId, "agentlab-security", "third line should be agentlab-security");

	// Verify each advisory appears exactly once
	const mainCount = parsed.filter((a) => a.roleId === "supervisor-main").length;
	assert.equal(mainCount, 1, "supervisor-main should appear exactly once");
});
