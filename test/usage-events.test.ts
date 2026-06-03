import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildIduUsageReport,
	formatIduUsagePanel,
	formatIduUsageSummary,
	readIduUsageEvents,
	recordIduUsageEvent,
	summarizeIduUsageEvents,
	usageEventsPath,
} from "../src/usage-events.js";

function tempStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-usage-events-"));
}

test("usage events append safe JSONL under stateRoot reports", async () => {
	const root = tempStateRoot();
	try {
		const result = await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "idu-preflight dangerous text should sanitize",
			active: true,
			risk: "high",
			recommendation: "ask_human",
			allowedToProceed: false,
			requiresHuman: true,
			durationMs: 12.4,
			ok: false,
		});
		assert.equal(result.ok, true);
		assert.equal(result.path, usageEventsPath(root));
		const events = readIduUsageEvents(root);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.projectId, "idu-pi");
		assert.equal(events[0]?.surface, "cli");
		assert.equal(
			events[0]?.action,
			"idu-preflight_dangerous_text_should_sanitize",
		);
		assert.equal(events[0]?.allowedToProceed, false);
		assert.equal(events[0]?.requiresHuman, true);
		assert.equal(events[0]?.durationMs, 12);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage event reader ignores malformed and bounds by limit", async () => {
	const root = tempStateRoot();
	try {
		const path = usageEventsPath(root);
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "status",
		});
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_status",
		});
		writeFileSync(
			path,
			`${readIduUsageEvents(root)
				.map((event) => JSON.stringify(event))
				.join("\n")}\nnot-json\n`,
			"utf8",
		);
		const events = readIduUsageEvents(root, 1);
		assert.equal(events.length, 0, "bounded malformed tail should be ignored");
		const all = readIduUsageEvents(root, 10);
		assert.equal(all.length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage summary counts surfaces actions recommendations and tri-state fields", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "idu-preflight",
			active: true,
			recommendation: "ask_human",
			allowedToProceed: false,
			requiresHuman: true,
			ok: false,
		});
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
			active: false,
			recommendation: "warn",
			allowedToProceed: true,
			requiresHuman: false,
			ok: true,
		});
		const summary = summarizeIduUsageEvents(readIduUsageEvents(root));
		assert.equal(summary.totalEvents, 2);
		assert.equal(summary.bySurface.cli, 1);
		assert.equal(summary.bySurface.mcp, 1);
		assert.equal(summary.byAction["idu-preflight"], 1);
		assert.equal(summary.byRecommendation.ask_human, 1);
		assert.equal(summary.active.true, 1);
		assert.equal(summary.active.false, 1);
		assert.equal(summary.allowedToProceed.false, 1);
		assert.equal(summary.requiresHuman.true, 1);
		assert.match(formatIduUsageSummary(summary), /Uso Idu-pi/u);
		assert.match(formatIduUsageSummary(summary), /idu_postflight/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage report calculates compact project panel metrics", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "idu-status",
			active: true,
			recommendation: "ok",
			allowedToProceed: true,
			requiresHuman: false,
			ok: true,
		});
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
			active: false,
			recommendation: "ask_human",
			allowedToProceed: false,
			requiresHuman: true,
			ok: false,
		});
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "idu-status",
			active: true,
			recommendation: "ok",
			allowedToProceed: true,
			requiresHuman: false,
			ok: true,
		});
		const report = buildIduUsageReport(readIduUsageEvents(root));
		assert.equal(report.totalEvents, 3);
		assert.equal(report.surface.cli, 2);
		assert.equal(report.surface.mcp, 1);
		assert.equal(report.active.true, 2);
		assert.equal(report.active.false, 1);
		assert.equal(report.requiresHuman, 1);
		assert.equal(report.notAllowed, 1);
		assert.equal(report.failed, 1);
		assert.equal(report.topActions[0]?.action, "idu-status");
		assert.match(formatIduUsagePanel(report), /Uso local/u);
		assert.match(formatIduUsagePanel(report), /requiere humano: 1/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage report uses newest timestamp instead of event order", () => {
	const newer = new Date(Date.now() - 3 * 60_000).toISOString();
	const older = new Date(Date.now() - 10 * 60_000).toISOString();
	const report = buildIduUsageReport([
		{
			version: 1,
			id: "newer",
			timestamp: newer,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_status",
		},
		{
			version: 1,
			id: "older",
			timestamp: older,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
		},
	]);
	assert.equal(report.lastActivity, newer);
	assert.match(formatIduUsagePanel(report), /último evento: hace 3m/u);
	assert.doesNotMatch(formatIduUsagePanel(report), /último evento: hace 10m/u);
});

test("usage panel distinguishes refresh time from last recorded event", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
		});
		const panel = formatIduUsagePanel(
			buildIduUsageReport(readIduUsageEvents(root)),
		);
		assert.match(panel, /actualizado: recién/u);
		assert.match(panel, /último evento: recién/u);
		assert.doesNotMatch(panel, /última actividad/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage panel formats empty report without errors", () => {
	const panel = formatIduUsagePanel(buildIduUsageReport([]));
	assert.match(panel, /Uso local/u);
	assert.match(panel, /eventos: 0/u);
	assert.match(panel, /actualizado: recién/u);
	assert.match(panel, /último evento: sin eventos/u);
});
