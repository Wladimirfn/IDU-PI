/**
 * idu-ack-advisory.test.ts — tests for the explicit dismissal escape hatch.
 *
 * Forward obligation #2 from PR #153 audit: "hoy el dismissal explícito va
 * por ack:true en el pull; el tool dedicado de dismissal sigue pendiente."
 *
 * Contract:
 *   - ackAdvisory({ stateRoot, injectionId, reason? }) calls markInjectionAcked
 *     AND writes a `dismissed` lifecycle event.
 *   - The result echoes the injectionId, acked:true, phase:"dismissed", reason.
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

function seedInjection(stateRoot: string, injectionId: string): void {
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
		acked: false,
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

// ---------------------------------------------------------------------------
// Tests
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

test("ackAdvisory: writes a `dismissed` lifecycle event", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-2";
		seedInjection(stateRoot, id);
		ackAdvisory({ stateRoot, injectionId: id, reason: "manual review done" });
		const events = readTelemetry(stateRoot);
		assert.ok(events.length >= 1, "telemetry should have at least 1 event");
		const dismissed = events.find((e) => e.phase === "dismissed" && e.injectionId === id);
		assert.ok(dismissed, "should have a dismissed event for the injection");
		assert.equal(dismissed.reason, "manual review done");
	} finally {
		cleanup();
	}
});

test("ackAdvisory: returns the result with injectionId, acked:true, phase:'dismissed'", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-3";
		seedInjection(stateRoot, id);
		const result = ackAdvisory({ stateRoot, injectionId: id });
		assert.equal(result.injectionId, id);
		assert.equal(result.acked, true);
		assert.equal(result.phase, "dismissed");
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

test("ackAdvisory: idempotent — calling twice is safe (second call is a no-op for the file write)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const id = "obj-test-5";
		seedInjection(stateRoot, id);
		ackAdvisory({ stateRoot, injectionId: id });
		// The second call still writes a `dismissed` event (the audit log
		// captures the intent). The injection-store keeps the line as
		// acked:true (it skips already-acked lines).
		ackAdvisory({ stateRoot, injectionId: id, reason: "second call" });
		const injections = readInjections(stateRoot);
		assert.equal(injections[0].acked, true);
		const events = readTelemetry(stateRoot);
		const dismissed = events.filter((e) => e.phase === "dismissed" && e.injectionId === id);
		assert.equal(dismissed.length, 2, "two dismissed events recorded");
	} finally {
		cleanup();
	}
});

test("ackAdvisory: does NOT crash when the injectionId doesn't exist", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// No injection seeded
		const result = ackAdvisory({
			stateRoot,
			injectionId: "ghost-id",
			reason: "test",
		});
		// markInjectionAcked is a no-op when not found, but we still write
		// the lifecycle event. The result reflects the operation.
		assert.equal(result.injectionId, "ghost-id");
		assert.equal(result.acked, true);
	} finally {
		cleanup();
	}
});
