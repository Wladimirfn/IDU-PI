/**
 * idu-ack-advisory.test.ts — tests for the explicit dismissal escape hatch.
 *
 * Forward obligation #2 from PR #153 audit. Post-#156-audit-fix:
 * the contract is now that ackAdvisory only writes a `dismissed` lifecycle
 * event when markInjectionAcked reports a real transition ("acked"). The
 * other two outcomes ("already-acked", "not-found") are no-ops and must
 * NOT generate lifecycle noise. This is the auditor-required guard that
 * fixes the phantom-dismissal bug.
 *
 * Contract:
 *   - markInjectionAcked → "acked": real transition, write `dismissed`, return
 *     { acked: true, status: "acked" }.
 *   - markInjectionAcked → "already-acked": no-op, NO event, return
 *     { acked: false, status: "already-acked" }.
 *   - markInjectionAcked → "not-found": no-op, NO event, return
 *     { acked: false, status: "not-found" }.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ackAdvisory } from "../src/idu-ack-advisory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "ack-state-"));
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function seedInjection(stateRoot: string, injectionId: string, acked = false): void {
	// The injection-store writes to <stateRoot>/injections.jsonl with shape:
	//   { ts, triggerId, decisionEnvelope, injectionId, acked: false }
	// We write a minimal valid line so markInjectionAcked can find it.
	const line = JSON.stringify({
		ts: new Date().toISOString(),
		triggerId: "test-trigger",
		decisionEnvelope: {
			severity: "warning",
			summary: "test advisory",
			options: [],
			evidenceRefs: [],
			orchestratorDecisionRequired: true,
		},
		injectionId,
		acked,
		kind: "hygiene_junk_file",
	});
	writeFileSync(join(stateRoot, "injections.jsonl"), line + "\n");
}

function readInjections(stateRoot: string): Array<{ injectionId: string; acked: boolean }> {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
	return lines.map((line) => JSON.parse(line));
}

function readTelemetry(stateRoot: string): Array<{ phase: string; injectionId: string; reason: string }> {
	const path = join(stateRoot, "injection-telemetry.jsonl");
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
	return lines.map((line) => JSON.parse(line));
}

function countDismissed(stateRoot: string, injectionId: string): number {
	const events = readTelemetry(stateRoot);
	return events.filter((e) => e.phase === "dismissed" && e.injectionId === injectionId).length;
}

// ---------------------------------------------------------------------------
// Tests — the "acked" path (real transition)
// ---------------------------------------------------------------------------

test("ackAdvisory: marks the injection as acked in injections.jsonl", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-1";
		seedInjection(stateRoot, id);
		ackAdvisory({ stateRoot, injectionId: id });
		const injections = readInjections(stateRoot);
		assert.equal(injections.length, 1);
		assert.equal(injections[0].injectionId, id);
		assert.equal(injections[0].acked, true, "injection should be marked acked");
	} finally {
		cleanup();
	}
});

test("ackAdvisory: writes a `dismissed` lifecycle event on real transition", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-2";
		seedInjection(stateRoot, id);
		ackAdvisory({ stateRoot, injectionId: id, reason: "manual review done" });
		const events = readTelemetry(stateRoot);
		const dismissed = events.find((e) => e.phase === "dismissed" && e.injectionId === id);
		assert.ok(dismissed, "should have a dismissed event for the injection");
		assert.equal(dismissed.reason, "manual review done");
	} finally {
		cleanup();
	}
});

test("ackAdvisory: returns acked:true, status:'acked' on real transition", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-3";
		seedInjection(stateRoot, id);
		const result = ackAdvisory({ stateRoot, injectionId: id });
		assert.equal(result.injectionId, id);
		assert.equal(result.acked, true);
		assert.equal(result.phase, "dismissed");
		assert.equal((result as { status: string }).status, "acked");
		assert.ok(result.reason);
		assert.ok(result.ts);
	} finally {
		cleanup();
	}
});

test("ackAdvisory: default reason is 'idu_ack_advisory' (the tool name)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-4";
		seedInjection(stateRoot, id);
		const result = ackAdvisory({ stateRoot, injectionId: id });
		assert.equal(result.reason, "idu_ack_advisory");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Tests — the "already-acked" path (idempotent, no new event)
// ---------------------------------------------------------------------------

test("ackAdvisory: idempotent — second call on already-acked returns acked:false, status:'already-acked'", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-5";
		seedInjection(stateRoot, id);
		// First call: real transition
		ackAdvisory({ stateRoot, injectionId: id });
		const firstDismissedCount = countDismissed(stateRoot, id);
		assert.equal(firstDismissedCount, 1, "first call wrote exactly 1 dismissed event");
		// Second call: should be a no-op
		const result = ackAdvisory({ stateRoot, injectionId: id, reason: "second call" });
		assert.equal(result.acked, false, "second call should report acked:false");
		assert.equal(
			(result as { status: string }).status,
			"already-acked",
			"second call should report status:'already-acked'",
		);
		// CRITICAL: NO new event written on no-op
		const secondDismissedCount = countDismissed(stateRoot, id);
		assert.equal(
			secondDismissedCount,
			1,
			"no-op must NOT write a new dismissed event (phantom dismissal guard)",
		);
	} finally {
		cleanup();
	}
});

test("ackAdvisory: line seeded as already-acked returns acked:false, status:'already-acked'", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-already-acked";
		seedInjection(stateRoot, id, true);  // already-acked=true
		const result = ackAdvisory({ stateRoot, injectionId: id });
		assert.equal(result.acked, false);
		assert.equal((result as { status: string }).status, "already-acked");
		// No event written
		assert.equal(countDismissed(stateRoot, id), 0);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Tests — the "not-found" path (ghost id, no event)
// ---------------------------------------------------------------------------

test("ackAdvisory: not-found (ghost id) returns acked:false, status:'not-found', 0 events in telemetry", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// No injection seeded
		const result = ackAdvisory({
			stateRoot,
			injectionId: "ghost-id",
			reason: "test",
		});
		assert.equal(result.injectionId, "ghost-id");
		assert.equal(result.acked, false, "ghost id must report acked:false");
		assert.equal(
			(result as { status: string }).status,
			"not-found",
			"ghost id must report status:'not-found'",
		);
		// CRITICAL: NO event written on ghost id
		assert.equal(
			countDismissed(stateRoot, "ghost-id"),
			0,
			"ghost id must NOT write a dismissed event (phantom dismissal guard)",
		);
		// The telemetry file should be empty (no events at all)
		const allEvents = readTelemetry(stateRoot);
		assert.equal(allEvents.length, 0, "ghost id must NOT write any telemetry event");
	} finally {
		cleanup();
	}
});
