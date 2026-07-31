import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	buildContextQualityReport,
	contextQualityEventFromSupervisorContextPack,
	contextQualityEventsPath,
	flushContextQualityEvents,
	formatContextQualityPanel,
	readContextQualityEvents,
	recordContextQualityEvent,
} from "../src/context-quality-events.js";

function tempDir(prefix = "idu-context-quality-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function representativePack(overrides: Record<string, unknown> = {}) {
	return {
		contextBudget: {
			profile: "supervisor_context_pack",
			maxTotalChars: 10000,
			usedChars: 4200,
			truncated: false,
			omitted: [],
			generatedAt: "deterministic",
			advisoryOnly: true,
			contractPromotionAllowed: false,
		},
		goals: {
			humanVision: "compact human vision",
			planObjective: "approved plan objective",
			taskGoal: "compact task goal",
		},
		contracts: ["agent"],
		requiredReads: ["Plan Maestro vigente"],
		risks: ["risk one"],
		autonomyGates: ["run postflight"],
		skipNoiseGuidance: ["do not read huge docs"],
		taskPackage: { id: "task-package" },
		taskContext: { recommendation: "allow" },
		...overrides,
	};
}

// D2: a pack carrying structured per-gate traces (the shape
// buildSupervisorContextPack now emits).
function packWithGateTraces() {
	return representativePack({
		autonomyGates: ["read gate", "write gate"],
		autonomyGateTraces: [
			{
				gateId: "read-gate",
				verdict: "allow",
				honored: true,
				overridden: false,
				operation: "read",
				advisory: true,
				outcome: "proceed (advisory)",
			},
			{
				gateId: "write-gate",
				verdict: "deny",
				honored: true,
				overridden: false,
				operation: "write",
				advisory: false,
				outcome: "blocked (requires condition)",
			},
		],
	});
}

test("context quality events stay under stateRoot reports and keep privacy flags", async () => {
	const root = tempDir();
	try {
		const event = contextQualityEventFromSupervisorContextPack(
			"project one",
			representativePack(),
			"mcp",
		);
		const path = contextQualityEventsPath(root);
		assert.match(path, /reports.*context-quality-events\.jsonl/u);
		const result = await recordContextQualityEvent(root, event);
		assert.equal(result.ok, true);
		await flushContextQualityEvents();
		const events = readContextQualityEvents(root);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.projectId, "project_one");
		assert.equal(events[0]?.scope, "supervisor_context_pack");
		assert.equal(events[0]?.compactness, "ok");
		assert.equal(events[0]?.relevance, "ok");
		assert.equal(events[0]?.noise, "ok");
		assert.equal(events[0]?.completeness, "ok");
		const report = buildContextQualityReport(events);
		assert.equal(report.promptTextStored, false);
		assert.equal(report.rawUserTextStored, false);
		assert.equal(report.rawDocsStored, false);
		assert.equal(report.tokensMeasured, false);
		assert.equal(report.costMeasured, false);
		assert.equal(report.contextPercentMeasured, false);
		assert.equal(report.remoteAnalytics, false);
		assert.equal(report.totalEvents, 1);
		assert.equal(report.byCompactness.ok, 1);
		assert.equal(report.averageUsedChars, 4200);
		const serializedEvent = JSON.stringify(events);
		for (const forbidden of [
			"prompt",
			"rawUserText",
			"rawDocs",
			"tokens",
			"cost",
			"contextPercent",
			"headers",
			"env",
		]) {
			assert.equal(serializedEvent.includes(forbidden), false, forbidden);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("context quality report ignores malformed JSONL and summarizes warnings", () => {
	const root = tempDir();
	try {
		const path = contextQualityEventsPath(root);
		mkdirSync(dirname(path), { recursive: true });
		const event = contextQualityEventFromSupervisorContextPack(
			"project",
			representativePack({
				contextBudget: {
					profile: "supervisor_context_pack",
					maxTotalChars: 10000,
					usedChars: 10000,
					truncated: true,
					omitted: [
						{ path: "goals.humanVision", reason: "max_chars" },
						{ path: "requiredReads", reason: "max_items" },
					],
					generatedAt: "deterministic",
					advisoryOnly: true,
					contractPromotionAllowed: false,
				},
			}),
			"mcp",
		);
		writeFileSync(
			path,
			[
				"not-json",
				JSON.stringify({
					...event,
					version: 1,
					id: "event-1",
					timestamp: "2026-06-04T00:00:00.000Z",
				}),
			].join("\n"),
			"utf8",
		);
		const events = readContextQualityEvents(root);
		assert.equal(events.length, 1);
		const report = buildContextQualityReport(events);
		assert.equal(report.byCompactness.warning, 1);
		assert.equal(report.truncatedEvents, 1);
		assert.equal(report.omittedReasons.max_chars, 1);
		assert.equal(report.omittedReasons.max_items, 1);
		assert.equal(events[0]?.omittedPaths["goals.humanVision"], 1);
		assert.equal(events[0]?.omittedPaths.requiredReads, 1);
		assert.equal(report.omittedPaths["goals.humanVision"], 1);
		assert.equal(report.omittedPaths.requiredReads, 1);
		assert.match(
			formatContextQualityPanel(report),
			/Calidad de contexto local/u,
		);
		assert.match(
			formatContextQualityPanel(report),
			/tokens\/costo\/% contexto: no medido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// D2 part 1: each gate that fires leaves a per-gate verdict trace (not just
// the aggregate autonomyGatesCount).
test("D2: context quality event records a per-gate verdict trace", () => {
	const event = contextQualityEventFromSupervisorContextPack(
		"project one",
		packWithGateTraces(),
		"mcp",
	);
	assert.equal(event.autonomyGatesCount, 2);
	const gateVerdicts = event.gateVerdicts ?? [];
	assert.equal(gateVerdicts.length, 2);
	const ids = gateVerdicts.map((trace) => trace.gateId);
	assert.deepEqual(ids, ["read-gate", "write-gate"]);
});

// D2 part 2: a gate that fires on a READ is advisory-only (agent proceeds);
// a gate that fires on a WRITE is blocking.
test("D2: read gates are advisory (allow), write gates are blocking (deny)", () => {
	const event = contextQualityEventFromSupervisorContextPack(
		"project one",
		packWithGateTraces(),
		"mcp",
	);
	const byId = new Map(
		(event.gateVerdicts ?? []).map((trace) => [trace.gateId, trace]),
	);
	const readGate = byId.get("read-gate");
	const writeGate = byId.get("write-gate");

	// READ gate: advisory, verdict allow, agent proceeds.
	assert.equal(readGate?.operation, "read");
	assert.equal(readGate?.advisory, true);
	assert.equal(readGate?.verdict, "allow");

	// WRITE gate: blocking, verdict deny.
	assert.equal(writeGate?.operation, "write");
	assert.equal(writeGate?.advisory, false);
	assert.equal(writeGate?.verdict, "deny");
});

// D2 fallback: a legacy pack with only the `autonomyGates` string list
// (no structured traces) still derives a per-gate trace via the classifier.
test("D2: legacy packs without autonomyGateTraces derive traces from the string list", () => {
	const event = contextQualityEventFromSupervisorContextPack(
		"project one",
		representativePack({
			autonomyGates: [
				"Consultar Plan Maestro", // read
				"No commit/push sin instrucción", // write
			],
		}),
		"mcp",
	);
	const gateVerdicts = event.gateVerdicts ?? [];
	assert.equal(gateVerdicts.length, 2);
	assert.equal(gateVerdicts[0]?.operation, "read");
	assert.equal(gateVerdicts[0]?.advisory, true);
	assert.equal(gateVerdicts[1]?.operation, "write");
	assert.equal(gateVerdicts[1]?.advisory, false);
});

test("D2: gate verdicts survive a persist -> read round-trip", async () => {
	const root = tempDir();
	try {
		const event = contextQualityEventFromSupervisorContextPack(
			"project one",
			packWithGateTraces(),
			"mcp",
		);
		const result = await recordContextQualityEvent(root, event);
		assert.equal(result.ok, true);
		await flushContextQualityEvents();
		const events = readContextQualityEvents(root);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.gateVerdicts.length, 2);
		assert.equal(events[0]?.gateVerdicts[0]?.gateId, "read-gate");
		assert.equal(events[0]?.gateVerdicts[1]?.verdict, "deny");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
