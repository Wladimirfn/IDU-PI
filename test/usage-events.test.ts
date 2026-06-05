import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("usage event reader preserves safe event type and session id", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
			sessionId: "session with spaces",
		});
		const events = readIduUsageEvents(root);
		assert.equal(events[0]?.eventType, "pi_compaction_detected");
		assert.equal(events[0]?.sessionId, "session_with_spaces");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage event reader treats legacy JSONL without event type as idu calls", () => {
	const root = tempStateRoot();
	try {
		const path = usageEventsPath(root);
		mkdirSync(join(root, "reports"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				id: "legacy",
				timestamp: new Date().toISOString(),
				projectId: "idu-pi",
				surface: "mcp",
				action: "idu_postflight",
			}) + "\n",
			"utf8",
		);
		const report = buildIduUsageReport(readIduUsageEvents(root));
		assert.equal(report.totalEvents, 1);
		assert.equal(report.totalIduCalls, 1);
		assert.equal(report.compactionsDetected, 0);
		assert.equal(report.topActions[0]?.action, "idu_postflight");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage event reader counts tui surface in reliable report", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "tui",
			action: "project_panel_open",
		});
		const report = buildIduUsageReport(readIduUsageEvents(root));
		assert.equal(report.totalIduCalls, 1);
		assert.equal(report.surface.tui, 1);
		assert.match(
			formatIduUsagePanel(report),
			/superficie: cli 0 · mcp 0 · tui 1/u,
		);
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
		assert.equal(report.totalIduCalls, 3);
		assert.equal(report.compactionsDetected, 0);
		assert.equal(report.surface.cli, 2);
		assert.equal(report.surface.mcp, 1);
		assert.equal(report.active.true, 2);
		assert.equal(report.active.false, 1);
		assert.equal(report.requiresHuman, 1);
		assert.equal(report.notAllowed, 1);
		assert.equal(report.failed, 1);
		assert.equal(report.topActions[0]?.action, "idu-status");
		const panel = formatIduUsagePanel(report);
		assert.match(panel, /Uso local/u);
		assert.match(panel, /llamadas Idu-pi: 3/u);
		assert.doesNotMatch(panel, /eventos Idu-pi: 3/u);
		assert.match(panel, /superficie: cli 2 · mcp 1 · tui 0/u);
		assert.doesNotMatch(panel, /actividad automática supervisor/u);
		assert.match(panel, /requiere humano: 1/u);
		assert.match(panel, /compactaciones detectadas: no medido/u);
		assert.match(panel, /tokens Idu-pi: no medido/u);
		assert.match(panel, /% contexto Idu-pi: no medido/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage report separates idu calls from compaction events", () => {
	const now = new Date().toISOString();
	const report = buildIduUsageReport([
		{
			version: 1,
			id: "legacy-call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
		},
		{
			version: 1,
			id: "typed-call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "idu_status",
			eventType: "idu_call",
			sessionId: "pi-session-1",
		},
		{
			version: 1,
			id: "compact-1",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
			sessionId: "pi-session-1",
		},
	]);

	assert.equal(report.totalEvents, 3);
	assert.equal(report.totalIduCalls, 2);
	assert.equal(report.compactionsDetected, 1);
	assert.equal(report.observedSessions, 1);
	assert.equal(report.surface.cli, 1);
	assert.equal(report.surface.mcp, 1);
	assert.equal(
		report.topActions.some(
			(entry) => entry.action === "pi_compaction_detected",
		),
		false,
	);
	assert.equal(report.tokensMeasured, false);
	assert.equal(report.contextPercentMeasured, false);
});

test("usage summary counts only idu calls for action metrics", () => {
	const now = new Date().toISOString();
	const summary = summarizeIduUsageEvents([
		{
			version: 1,
			id: "call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
			eventType: "idu_call",
		},
		{
			version: 1,
			id: "compact",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
		},
	]);

	assert.equal(summary.totalEvents, 2);
	assert.equal(summary.totalIduCalls, 1);
	assert.equal(summary.compactionsDetected, 1);
	assert.equal(summary.byAction.idu_postflight, 1);
	assert.equal(summary.byAction.pi_compaction_detected, undefined);
});

test("usage report uses newest Idu-pi call timestamp, ignoring newer compaction events", () => {
	const olderCall = new Date(Date.now() - 10 * 60_000).toISOString();
	const newerCompaction = new Date(Date.now() - 1 * 60_000).toISOString();
	const report = buildIduUsageReport([
		{
			version: 1,
			id: "call",
			timestamp: olderCall,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_status",
			eventType: "idu_call",
		},
		{
			version: 1,
			id: "compact",
			timestamp: newerCompaction,
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
		},
	]);
	assert.equal(report.lastActivity, olderCall);
	assert.match(formatIduUsagePanel(report), /última llamada Idu-pi: hace 10m/u);
	assert.doesNotMatch(
		formatIduUsagePanel(report),
		/última llamada Idu-pi: hace 1m/u,
	);
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
	assert.match(formatIduUsagePanel(report), /última llamada Idu-pi: hace 3m/u);
	assert.doesNotMatch(
		formatIduUsagePanel(report),
		/última llamada Idu-pi: hace 10m/u,
	);
});

test("usage report surfaces stale MCP supervisor context pack separately from fresh CLI activity", () => {
	const recentCli = new Date(Date.now() - 1 * 60_000).toISOString();
	const staleContextPack = new Date(Date.now() - 15 * 60_000).toISOString();
	const report = buildIduUsageReport([
		{
			version: 1,
			id: "context-pack",
			timestamp: staleContextPack,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_supervisor_context_pack",
		},
		{
			version: 1,
			id: "recent-cli",
			timestamp: recentCli,
			projectId: "idu-pi",
			surface: "cli",
			action: "automaticov1",
		},
	]);

	assert.equal(report.lastActivity, recentCli);
	assert.equal(report.lastMcpActivity, staleContextPack);
	assert.equal(report.lastSupervisorContextPack, staleContextPack);
	assert.equal(report.mcpContextPackStaleness, "stale");
	const panel = formatIduUsagePanel(report);
	assert.match(panel, /última llamada Idu-pi: hace 1m/u);
	assert.match(
		panel,
		/MCP context pack: stale hace 15m; sugerido refrescar idu_supervisor_context_pack/u,
	);
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
		assert.match(panel, /última llamada Idu-pi: recién/u);
		assert.doesNotMatch(panel, /último evento/u);
		assert.doesNotMatch(panel, /última actividad/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("usage panel formats empty report without errors", () => {
	const panel = formatIduUsagePanel(buildIduUsageReport([]));
	assert.match(panel, /Uso local/u);
	assert.match(panel, /llamadas Idu-pi: 0/u);
	assert.match(panel, /actualizado: recién/u);
	assert.match(panel, /última llamada Idu-pi: sin eventos/u);
	assert.doesNotMatch(panel, /actividad automática supervisor/u);
	assert.match(panel, /compactaciones detectadas: no medido/u);
	assert.match(panel, /tokens Idu-pi: no medido/u);
	assert.match(panel, /% contexto Idu-pi: no medido/u);
});
