import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildSupervisorActivityReport,
	filterRecentSupervisorActivityEvents,
	formatSupervisorActivityPanel,
	readSupervisorActivityEvents,
	recordSupervisorActivityEvent,
	summarizeSupervisorActivityEvents,
	supervisorActivityEventsPath,
} from "../src/supervisor-activity-events.js";

function tempStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-supervisor-activity-"));
}

test("supervisor activity events append safe JSONL under stateRoot reports", async () => {
	const root = tempStateRoot();
	try {
		const result = await recordSupervisorActivityEvent(root, {
			projectId: "idu-pi project",
			eventType: "supervisor_hook",
			origin: "supervisor_auto_hook",
			trigger: "after_task_registered",
			status: "completed",
			reason: "not_enough_data",
			active: true,
			bypassedThrottle: false,
			stepCounts: {
				active: 1,
				completed: 2,
				skipped: 2,
				warning: 0,
				inactive: 0,
			},
			createdTasks: 2,
			auditRunRecorded: true,
			semanticDraftCreated: true,
			agentTaskPlanBuilt: true,
			durationMs: 12.7,
			ok: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.path, supervisorActivityEventsPath(root));
		assert.equal(existsSync(result.path), true);
		const events = readSupervisorActivityEvents(root);
		assert.equal(events.length, 1);
		assert.equal(events[0]?.projectId, "idu-pi_project");
		assert.equal(events[0]?.origin, "supervisor_auto_hook");
		assert.equal(events[0]?.durationMs, 13);
		assert.equal(events[0]?.createdTasks, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor activity reader ignores malformed and bounds recent events", async () => {
	const root = tempStateRoot();
	try {
		await recordSupervisorActivityEvent(root, {
			projectId: "idu-pi",
			eventType: "supervisor_tick",
			origin: "supervisor_manual_tick",
			trigger: "manual",
			status: "completed",
		});
		await recordSupervisorActivityEvent(root, {
			projectId: "idu-pi",
			eventType: "supervisor_hook",
			origin: "supervisor_auto_hook",
			trigger: "after_postflight",
			status: "skipped",
			reason: "throttled",
		});
		const path = supervisorActivityEventsPath(root);
		writeFileSync(
			path,
			`${readSupervisorActivityEvents(root)
				.map((event) => JSON.stringify(event))
				.join("\n")}\nnot-json\n`,
			"utf8",
		);
		assert.equal(readSupervisorActivityEvents(root, 1).length, 0);
		assert.equal(readSupervisorActivityEvents(root, 10).length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor activity events can be filtered to a recent pressure window", () => {
	const events = [
		{
			version: 1 as const,
			id: "old",
			timestamp: "2026-06-04T23:59:59.999Z",
			projectId: "idu-pi",
			eventType: "supervisor_tick" as const,
			origin: "orchestrator_requested" as const,
			trigger: "cron_planning" as const,
			status: "skipped" as const,
			reason: "throttled" as const,
		},
		{
			version: 1 as const,
			id: "cutoff",
			timestamp: "2026-06-05T00:00:00.000Z",
			projectId: "idu-pi",
			eventType: "supervisor_tick" as const,
			origin: "orchestrator_requested" as const,
			trigger: "cron_planning" as const,
			status: "skipped" as const,
			reason: "throttled" as const,
		},
		{
			version: 1 as const,
			id: "recent",
			timestamp: "2026-06-05T12:00:00.000Z",
			projectId: "idu-pi",
			eventType: "supervisor_tick" as const,
			origin: "orchestrator_requested" as const,
			trigger: "manual" as const,
			status: "completed" as const,
		},
	];

	const recent = filterRecentSupervisorActivityEvents(
		events,
		new Date("2026-06-06T00:00:00.000Z"),
		24 * 60 * 60 * 1000,
	);

	assert.deepEqual(
		recent.map((event) => event.id),
		["cutoff", "recent"],
	);
});

test("supervisor activity summary counts origins triggers statuses and artifacts", async () => {
	const root = tempStateRoot();
	try {
		await recordSupervisorActivityEvent(root, {
			projectId: "idu-pi",
			eventType: "supervisor_hook",
			origin: "supervisor_auto_hook",
			trigger: "after_semantic_threshold",
			status: "completed",
			active: true,
			createdTasks: 3,
			auditRunRecorded: true,
			semanticDraftCreated: true,
			agentTaskPlanBuilt: true,
		});
		await recordSupervisorActivityEvent(root, {
			projectId: "idu-pi",
			eventType: "supervisor_tick",
			origin: "supervisor_manual_tick",
			trigger: "manual",
			status: "skipped",
			reason: "idu_inactive",
			active: false,
		});
		const summary = summarizeSupervisorActivityEvents(
			readSupervisorActivityEvents(root),
		);
		assert.equal(summary.totalEvents, 2);
		assert.equal(summary.totalHooks, 1);
		assert.equal(summary.totalTicks, 1);
		assert.equal(summary.byOrigin.supervisor_auto_hook, 1);
		assert.equal(summary.byTrigger.after_semantic_threshold, 1);
		assert.equal(summary.byStatus.completed, 1);
		assert.equal(summary.byReason.idu_inactive, 1);
		assert.equal(summary.active.true, 1);
		assert.equal(summary.active.false, 1);
		assert.equal(summary.createdTasks, 3);
		assert.equal(summary.auditRunsRecorded, 1);
		assert.equal(summary.semanticDraftsCreated, 1);
		assert.equal(summary.agentTaskPlansBuilt, 1);
		assert.equal(summary.tokensMeasured, false);
		assert.equal(summary.contextPercentMeasured, false);
		assert.equal(summary.remoteAnalytics, false);
		const panel = formatSupervisorActivityPanel(
			buildSupervisorActivityReport(readSupervisorActivityEvents(root)),
		);
		assert.match(panel, /Actividad supervisor local/u);
		assert.match(panel, /hooks automáticos: 1/u);
		assert.match(panel, /ticks manuales: 1/u);
		assert.match(panel, /tareas propuestas: 3/u);
		assert.match(panel, /tokens supervisor: no medido/u);
		assert.match(panel, /% contexto supervisor: no medido/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor activity empty panel is honest", () => {
	const panel = formatSupervisorActivityPanel(
		buildSupervisorActivityReport([]),
	);
	assert.match(panel, /Actividad supervisor local/u);
	assert.match(panel, /eventos supervisor: 0/u);
	assert.match(panel, /sin actividad supervisor medida/u);
	assert.match(panel, /tokens supervisor: no medido/u);
});
