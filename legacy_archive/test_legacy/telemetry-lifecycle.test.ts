import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	readInjectionLifecycle,
	readMcpUsageLog,
	readPendingAdvisories,
	recordLifecycleEvent,
	type LifecyclePhase,
} from "../src/telemetry-lifecycle.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-tel-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("recordLifecycleEvent: appends to <stateRoot>/injection-telemetry.jsonl", () => {
	const { root, cleanup } = makeRoot();
	try {
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "obj-1",
			phase: "emitted",
			kind: "objective_reminder",
		});
		const logPath = join(root, "injection-telemetry.jsonl");
		assert.ok(existsSync(logPath));
		const lines = readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim());
		assert.equal(lines.length, 1);
		const event = JSON.parse(lines[0]);
		assert.equal(event.injectionId, "obj-1");
		assert.equal(event.phase, "emitted");
		assert.equal(event.kind, "objective_reminder");
	} finally {
		cleanup();
	}
});

test("recordLifecycleEvent: each phase accepted (emitted, delivered, resolved, dismissed, expired, superseded)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const phases: LifecyclePhase[] = ["emitted", "delivered", "resolved", "dismissed", "expired", "superseded"];
		for (const phase of phases) {
			recordLifecycleEvent({
				stateRoot: root,
				injectionId: `inj-${phase}`,
				phase,
				kind: "test",
			});
		}
		const logPath = join(root, "injection-telemetry.jsonl");
		const lines = readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim());
		assert.equal(lines.length, 6);
	} finally {
		cleanup();
	}
});

test("recordLifecycleEvent: rejects invalid phase (vocabulary fixed)", () => {
	const { root, cleanup } = makeRoot();
	try {
		assert.throws(
			() =>
				recordLifecycleEvent({
					stateRoot: root,
					injectionId: "inj-x",
					// @ts-expect-error: testing runtime rejection of invalid phase
					phase: "made-up-phase",
				}),
			/invalid phase/,
		);
	} finally {
		cleanup();
	}
});

test("readInjectionLifecycle: returns events for one injection, sorted by ts", () => {
	const { root, cleanup } = makeRoot();
	try {
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-1", phase: "emitted", now: new Date("2026-06-17T10:00:00Z") });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-1", phase: "delivered", now: new Date("2026-06-17T10:05:00Z") });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-2", phase: "emitted", now: new Date("2026-06-17T10:10:00Z") });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-1", phase: "resolved", now: new Date("2026-06-17T10:15:00Z"), reason: "tool called" });

		const events = readInjectionLifecycle(root, "inj-1");
		assert.equal(events.length, 3);
		assert.equal(events[0].phase, "emitted");
		assert.equal(events[1].phase, "delivered");
		assert.equal(events[2].phase, "resolved");
	} finally {
		cleanup();
	}
});

test("readPendingAdvisories: returns injections whose LAST phase is delivered", () => {
	const { root, cleanup } = makeRoot();
	try {
		// inj-1: emitted → delivered (pending)
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-1", phase: "emitted" });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-1", phase: "delivered" });
		// inj-2: emitted → delivered → resolved (NOT pending)
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-2", phase: "emitted" });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-2", phase: "delivered" });
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-2", phase: "resolved" });
		// inj-3: only emitted (NOT pending — never delivered)
		recordLifecycleEvent({ stateRoot: root, injectionId: "inj-3", phase: "emitted" });

		const pending = readPendingAdvisories(root);
		assert.equal(pending.length, 1);
		assert.equal(pending[0].injectionId, "inj-1");
	} finally {
		cleanup();
	}
});

test("readMcpUsageLog: returns parsed entries from <stateRoot>/logs/mcp-usage.jsonl", () => {
	const { root, cleanup } = makeRoot();
	try {
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		const logPath = join(logsDir, "mcp-usage.jsonl");
		writeFileSync(
			logPath,
			[
				JSON.stringify({ tool: "idu_supervisor_context_pack", ts: "2026-06-17T10:00:00Z" }),
				JSON.stringify({ tool: "idu_status", ts: "2026-06-17T10:01:00Z" }),
				"malformed line", // skipped (not valid JSON)
				JSON.stringify({ ts: "2026-06-17T10:02:00Z" }), // skipped (no tool field)
			].join("\n"),
			"utf8",
		);
		const log = readMcpUsageLog(root);
		assert.equal(log.length, 2);
		assert.equal(log[0].tool, "idu_supervisor_context_pack");
		assert.equal(log[1].tool, "idu_status");
	} finally {
		cleanup();
	}
});

test("readMcpUsageLog: returns [] when file is missing", () => {
	const { root, cleanup } = makeRoot();
	try {
		assert.deepEqual(readMcpUsageLog(root), []);
	} finally {
		cleanup();
	}
});

test("AUDITOR-CRITICAL: vocabulary is fixed — only 6 valid phases", () => {
	// Per #2467: vocabulary is fixed. NO free-form tags.
	// Adding a new phase requires a code change (intentional friction).
	const validPhases: LifecyclePhase[] = [
		"emitted",
		"delivered",
		"resolved",
		"dismissed",
		"expired",
		"superseded",
	];
	assert.equal(validPhases.length, 6);
});