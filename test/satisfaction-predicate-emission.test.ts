import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	readInjectionLifecycle,
	recordLifecycleEvent,
} from "../src/telemetry-lifecycle.js";
import { evaluateSatisfactionPredicates } from "../src/cron-preflight.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-sat-eval-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("evaluateSatisfactionPredicates: resolves objective_reminder when idu_supervisor_context_pack is called within window", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:30:00Z");

		// 1. emitted + delivered (the cron-emitted + orchestrator-pulled)
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: deliveredAt });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: deliveredAt });

		// 2. MCP usage log: idu_supervisor_context_pack was called at 10:15
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({ tool: "idu_supervisor_context_pack", ts: "2026-06-17T10:15:00Z" }) + "\n",
			"utf8",
		);

		// 3. evaluate (now is 30min after deliveredAt, within 1h window)
		evaluateSatisfactionPredicates({ stateRoot: root, now });

		// 4. Should have written a "resolved" event
		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(phases, ["emitted", "delivered", "resolved"], "lifecycle should end at resolved");
		const resolved = events.find((e) => e.phase === "resolved");
		assert.ok(resolved);
		assert.ok(resolved.reason?.includes("idu_supervisor_context_pack"));
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: expires objective_reminder when past window without satisfaction", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T12:00:00Z"); // 2h after, past 1h window

		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: deliveredAt });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: deliveredAt });

		// Empty MCP usage log (no calls)
		mkdirSync(join(root, "logs"), { recursive: true });

		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(phases, ["emitted", "delivered", "expired"], "expired after window passed");
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: does NOT resolve if tool called BEFORE deliveredAt (early call)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:15:00Z");

		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: deliveredAt });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: deliveredAt });

		// Tool called BEFORE deliveredAt
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({ tool: "idu_supervisor_context_pack", ts: "2026-06-17T09:00:00Z" }) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		// No resolved event written because the call was before deliveredAt
		assert.deepEqual(phases, ["emitted", "delivered"]);
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: idempotent — running twice does not double-write resolved", () => {
	const { root, cleanup } = makeRoot();
	try {
		const deliveredAt = new Date("2026-06-17T10:00:00Z");
		const now = new Date("2026-06-17T10:30:00Z");

		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: deliveredAt });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: deliveredAt });

		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({ tool: "idu_supervisor_context_pack", ts: "2026-06-17T10:15:00Z" }) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now });
		evaluateSatisfactionPredicates({ stateRoot: root, now });

		const events = readInjectionLifecycle(root, "obj-1");
		// After the first run, the advisory's latest phase is "resolved",
		// so readPendingAdvisories does not include it on the second run.
		const resolvedEvents = events.filter((e) => e.phase === "resolved");
		assert.equal(resolvedEvents.length, 1, "resolved event should be written exactly once");
	} finally {
		cleanup();
	}
});

test("evaluateSatisfactionPredicates: handles multiple pending advisories of DIFFERENT kinds", () => {
	const { root, cleanup } = makeRoot();
	try {
		const t0 = new Date("2026-06-17T10:00:00Z");
		const t30 = new Date("2026-06-17T10:30:00Z");
		const t2h = new Date("2026-06-17T12:00:00Z");

		// inj-1: objective_reminder (tool-called predicate)
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: t0 });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: t0 });

		// inj-2: hygiene_junk_file (path-absent predicate). Different kind = different predicate.
		const junkFile = join(root, "junk.mjs");
		writeFileSync(junkFile, "// still here");
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "hyg-1",
			phase: "emitted",
			kind: "hygiene_junk_file",
			now: t30,
		});
		recordLifecycleEvent({
			stateRoot: root,
			injectionId: "hyg-1",
			phase: "delivered",
			kind: "hygiene_junk_file",
			now: t30,
		});

		// MCP usage: idu_supervisor_context_pack called at 10:45 (within inj-1's window)
		const logsDir = join(root, "logs");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(
			join(logsDir, "mcp-usage.jsonl"),
			JSON.stringify({ tool: "idu_supervisor_context_pack", ts: "2026-06-17T10:45:00Z" }) + "\n",
			"utf8",
		);

		evaluateSatisfactionPredicates({ stateRoot: root, now: t2h });

		// obj-1: tool-called within window → resolved
		const events1 = readInjectionLifecycle(root, "obj-1");
		assert.ok(events1.some((e) => e.phase === "resolved"), "obj-1 should be resolved (tool-called within window)");

		// hyg-1: path still exists → still waiting (no event for path-absent yet)
		const events2 = readInjectionLifecycle(root, "hyg-1");
		const phases = events2.map((e) => e.phase);
		assert.deepEqual(phases, ["emitted", "delivered"], "hyg-1 still waiting (path still exists)");
	} finally {
		cleanup();
	}
});

test("AUDITOR-CRITICAL: pull marks delivered ONLY (no resolved event on pull)", () => {
	// Per #2467: pull = delivered only. The resolved event is written
	// by the cron tick AFTER predicate evaluation, not by the pull.
	const { root, cleanup } = makeRoot();
	try {
		const t0 = new Date("2026-06-17T10:00:00Z");

		// Simulate the full pull path: emitted → delivered.
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "emitted", kind: "objective_reminder", now: t0 });
		recordLifecycleEvent({ stateRoot: root, injectionId: "obj-1", phase: "delivered", kind: "objective_reminder", now: t0 });

		// NO cron tick yet → only emitted + delivered. No resolved.
		const events = readInjectionLifecycle(root, "obj-1");
		const phases = events.map((e) => e.phase);
		assert.deepEqual(phases, ["emitted", "delivered"], "delivered-not-resolved is the expected pre-cron state");
	} finally {
		cleanup();
	}
});