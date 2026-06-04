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
