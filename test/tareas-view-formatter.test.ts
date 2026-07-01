import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	formatTareasView,
	sortTasksByCreatedAtDesc,
	TAREAS_VIEW_PAGE_SIZE_DEFAULT,
	TAREAS_VIEW_SUMMARY_MAX,
	type StructuredTask,
} from "../src/structured-task-queue.js";
import {
	formatColaDeAccionesFeed,
	paginateColaDeAccionesFeed,
	readColaDeAccionesFeed,
	COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT,
} from "../src/cola-acciones-feed.js";
import { recordIduUsageEvent } from "../src/usage-events.js";
import { recordSupervisorActivityEvent } from "../src/supervisor-activity-events.js";
import { supervisorActivityEventsPath } from "../src/supervisor-activity-events.js";
import { usageEventsPath } from "../src/usage-events.js";

function makeTask(overrides: Partial<StructuredTask> = {}): StructuredTask {
	return {
		id: "task-abcdef123456789",
		text: "Test task",
		category: "bug",
		priority: 3,
		status: "pending",
		createdAt: "2026-06-10T10:00:00.000Z",
		updatedAt: "2026-06-10T10:00:00.000Z",
		...overrides,
	};
}

function tempDir(prefix = "idu-tareas-cola-") {
	return mkdtempSync(join(tmpdir(), prefix));
}

function writeSupervisorEvent(
	stateRoot: string,
	event: Record<string, unknown>,
): void {
	const path = supervisorActivityEventsPath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

function writeUsageEvent(stateRoot: string, event: Record<string, unknown>): void {
	const path = usageEventsPath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

// Test 1: sortTasksByCreatedAtDesc sorts tasks by createdAt DESC
// (newest first). This is the single-source-of-truth used by the
// Tareas TUI view body.
test("sortTasksByCreatedAtDesc sorts by createdAt DESC (newest first)", () => {
	const tasks: StructuredTask[] = [
		makeTask({ id: "task-a", createdAt: "2026-06-10T10:00:00.000Z" }),
		makeTask({ id: "task-b", createdAt: "2026-06-12T10:00:00.000Z" }),
		makeTask({ id: "task-c", createdAt: "2026-06-11T10:00:00.000Z" }),
	];
	const sorted = sortTasksByCreatedAtDesc(tasks);
	assert.equal(sorted.length, 3);
	assert.equal(sorted[0].id, "task-b");
	assert.equal(sorted[1].id, "task-c");
	assert.equal(sorted[2].id, "task-a");
});

// Test 2: formatTareasView shows ALL tasks (including done and
// skipped), not just the actionable ones.
test("formatTareasView shows ALL tasks including done and skipped", () => {
	const done = makeTask({
		id: "task-done0000001",
		text: "Closed task",
		status: "done",
	});
	const skipped = makeTask({
		id: "task-skip0000001",
		text: "Skipped task",
		status: "skipped",
	});
	const pending = makeTask({
		id: "task-pend0000001",
		text: "Pending task",
		status: "pending",
	});
	const output = formatTareasView([done, skipped, pending], {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
	});
	assert.match(output, /^Tareas \(3\)/mu);
	assert.ok(output.includes("task-done000"));
	assert.ok(output.includes("task-skip000"));
	assert.ok(output.includes("task-pend000"));
	// Done task line should still appear with its "done" status
	// marker so the user can see closed work in the read-only view.
	assert.ok(output.includes("done"));
});

// Test 3: formatTareasView sorts tasks by createdAt DESC.
test("formatTareasView sorts tasks by createdAt DESC", () => {
	const tasks: StructuredTask[] = [
		makeTask({ id: "task-aaaa00000001", createdAt: "2026-06-10T10:00:00.000Z" }),
		makeTask({ id: "task-bbbb00000001", createdAt: "2026-06-12T10:00:00.000Z" }),
		makeTask({ id: "task-cccc00000001", createdAt: "2026-06-11T10:00:00.000Z" }),
	];
	const output = formatTareasView(tasks, {
		now: () => new Date("2026-06-13T10:00:00.000Z"),
	});
	const lines = output.split("\n");
	const taskLines = lines.filter((line) => line.includes("task-"));
	assert.equal(taskLines.length, 3);
	assert.ok(
		taskLines[0].includes("task-bbbb"),
		`first task line should be the newest, got: ${taskLines[0]}`,
	);
	assert.ok(
		taskLines[1].includes("task-cccc"),
		`second task line should be the middle one, got: ${taskLines[1]}`,
	);
	assert.ok(
		taskLines[2].includes("task-aaaa"),
		`third task line should be the oldest, got: ${taskLines[2]}`,
	);
});

// Test 4: formatTareasView paginates 30 tasks into 2 pages of 15/15
// (the new page size is 15, not 10).
test("formatTareasView paginates 30 tasks into 2 pages of 15/15", () => {
	const tasks: StructuredTask[] = Array.from({ length: 30 }, (_, i) =>
		makeTask({
			id: `task-pg15-${i.toString().padStart(4, "0")}aa`,
			createdAt: new Date(
				Date.UTC(2026, 5, 1, 0, 0, 0) + i * 60_000,
			).toISOString(),
		}),
	);
	const page0 = formatTareasView(tasks, {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
		pageIndex: 0,
		pageSize: 15,
	});
	assert.match(page0, /página 1\/2/u);
	const page0TaskLines = page0
		.split("\n")
		.filter((line) => line.includes("task-pg15-"));
	assert.equal(
		page0TaskLines.length,
		15,
		`page 0 should have 15 task lines, got ${page0TaskLines.length}`,
	);

	const page1 = formatTareasView(tasks, {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
		pageIndex: 1,
		pageSize: 15,
	});
	assert.match(page1, /página 2\/2/u);
	const page1TaskLines = page1
		.split("\n")
		.filter((line) => line.includes("task-pg15-"));
	assert.equal(
		page1TaskLines.length,
		15,
		`page 1 should have 15 task lines, got ${page1TaskLines.length}`,
	);
});

// Test 5: formatTareasView truncates the summary column to 60 chars
// with an ellipsis (TAREAS_VIEW_SUMMARY_MAX is 60, NOT 80 like the
// legacy Tareas y cola list).
test("formatTareasView truncates the summary to 60 chars with ellipsis", () => {
	const longDetails =
		"Realizar x cosa en x lugar con varios detalles que se extienden mucho mas alla del limite";
	assert.ok(longDetails.length > TAREAS_VIEW_SUMMARY_MAX);
	const task = makeTask({ text: longDetails, originalText: longDetails });
	const output = formatTareasView([task], {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
	});
	// The summary column is the last pipe-separated field on the
	// row. Look for the first 57 chars of the long details to
	// confirm the truncation.
	const expectedPrefix = longDetails.slice(0, TAREAS_VIEW_SUMMARY_MAX - 3);
	assert.ok(
		output.includes(expectedPrefix),
		`output should contain the first ${TAREAS_VIEW_SUMMARY_MAX - 3} chars, got: ${output}`,
	);
	// The summary ends with "...".
	assert.ok(output.includes("..."));
});

// Test 6: formatTareasView shows the empty-state marker for an
// empty list.
test("formatTareasView shows the empty-state marker for an empty list", () => {
	const output = formatTareasView([], {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
	});
	assert.match(output, /^Tareas \(0\)/mu);
	assert.match(output, /sin tareas/u);
});

// Test 7: TAREAS_VIEW_PAGE_SIZE_DEFAULT is 15 (matches the new TUI
// page size).
test("TAREAS_VIEW_PAGE_SIZE_DEFAULT is 15", () => {
	assert.equal(TAREAS_VIEW_PAGE_SIZE_DEFAULT, 15);
});

// Test 8: formatTareasView when paginated to a page beyond the
// total is clamped to the last page. Use 16 tasks (page size 15)
// so that page index 99 is past the last page; the body must show
// the last page (2/2) with the remaining 1 task line.
test("formatTareasView clamps out-of-range page index to the last page", () => {
	const tasks: StructuredTask[] = Array.from({ length: 16 }, (_, i) =>
		makeTask({
			id: `task-rng-${i.toString().padStart(4, "0")}abcdef`,
			createdAt: new Date(
				Date.UTC(2026, 5, 1, 0, 0, 0) + i * 60_000,
			).toISOString(),
		}),
	);
	const output = formatTareasView(tasks, {
		now: () => new Date("2026-06-10T12:00:00.000Z"),
		pageIndex: 99,
		pageSize: 15,
	});
	// Clamped to page 2/2 — there must be 1 task line on this page.
	assert.match(output, /página 2\/2/u);
	const taskLines = output.split("\n").filter((line) => line.includes("task-"));
	assert.equal(
		taskLines.length,
		1,
		`page 2 should have 1 task line, got ${taskLines.length}: ${taskLines.join(" | ")}`,
	);
});

// -----------------------------------------------------------------
// Tests for the "Cola de acciones" live feed.
// -----------------------------------------------------------------

// Test 9: readColaDeAccionesFeed returns an empty list when there
// is no stateRoot.
test("readColaDeAccionesFeed returns an empty list when stateRoot is undefined", () => {
	const events = readColaDeAccionesFeed(undefined);
	assert.equal(events.length, 0);
});

// Test 10: readColaDeAccionesFeed reads supervisor activity events.
test("readColaDeAccionesFeed includes supervisor activity events", async () => {
	const stateRoot = tempDir();
	try {
		const recorded = await recordSupervisorActivityEvent(stateRoot, {
			projectId: "test-project",
			eventType: "supervisor_tick",
			origin: "supervisor_auto_hook",
			trigger: "after_task_registered",
			status: "completed",
		});
		assert.equal(recorded.ok, true);
		const events = readColaDeAccionesFeed(stateRoot);
		assert.ok(events.length >= 1, `expected >=1 event, got ${events.length}`);
		const supervisorEvents = events.filter((e) => e.kind === "supervisor");
		assert.ok(
			supervisorEvents.length >= 1,
			`expected >=1 supervisor event, got ${supervisorEvents.length}`,
		);
		assert.match(
			supervisorEvents[0].summary,
			/supervisor supervisor_tick/u,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 11: readColaDeAccionesFeed reads idu usage events as
// "trigger fires" (excluding pi_compaction_detected noise).
test("readColaDeAccionesFeed includes idu usage events as trigger fires", async () => {
	const stateRoot = tempDir();
	try {
		const recorded = await recordIduUsageEvent(stateRoot, {
			projectId: "test-project",
			surface: "cli",
			action: "idu-supervisor-tick",
			recommendation: "proceed",
		});
		assert.equal(recorded.ok, true);
		const events = readColaDeAccionesFeed(stateRoot);
		const triggerEvents = events.filter((e) => e.kind === "trigger");
		assert.ok(
			triggerEvents.length >= 1,
			`expected >=1 trigger event, got ${triggerEvents.length}`,
		);
		assert.match(
			triggerEvents[0].summary,
			/trigger fire: cli\/idu-supervisor-tick/u,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 12: readColaDeAccionesFeed reads agentlab runs from the
// agentlabs/runs directory.
test("readColaDeAccionesFeed includes agentlab runs from agentlabs/runs", () => {
	const stateRoot = tempDir();
	try {
		const runDir = join(stateRoot, "agentlabs", "runs");
		mkdirSync(runDir, { recursive: true });
		const runResult = {
			generatedAt: "2026-06-10T12:00:00.000Z",
			sourceRequestFile: "agentlabs/requests/current.json",
			warning: "Revisión AgentLab. No aplica cambios.",
			projectId: "test-project",
			runs: [
				{
					requestId: "req-001",
					specialty: "security",
					status: "completed",
					commandsExecuted: [],
					rawSummary: "All good",
					contractValidation: { valid: true, errors: [] },
					findings: [],
					recommendations: [],
					testsSuggested: [],
					requiresHumanApproval: false,
				},
			],
		};
		writeFileSync(
			join(runDir, "current.json"),
			`${JSON.stringify(runResult, null, 2)}\n`,
			"utf8",
		);
		const events = readColaDeAccionesFeed(stateRoot);
		const agentlabEvents = events.filter((e) => e.kind === "agentlab");
		assert.ok(
			agentlabEvents.length >= 1,
			`expected >=1 agentlab event, got ${agentlabEvents.length}`,
		);
		assert.match(
			agentlabEvents[0].summary,
			/agentlab security/u,
		);
		assert.match(
			agentlabEvents[0].summary,
			/status=completed/u,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 13: readColaDeAccionesFeed sorts the merged events by ts DESC.
// This test writes events directly to the JSONL files with controlled
// timestamps so the sort order is deterministic.
test("readColaDeAccionesFeed sorts the merged events by ts DESC", () => {
	const stateRoot = tempDir();
	try {
		// Older supervisor event (1h ago).
		writeSupervisorEvent(stateRoot, {
			version: 1,
			id: "evt-supervisor-1",
			timestamp: new Date(Date.now() - 3_600_000).toISOString(),
			projectId: "test-project",
			eventType: "supervisor_hook",
			origin: "supervisor_auto_hook",
			trigger: "after_postflight",
			status: "completed",
		});
		// Newer usage event (5s ago).
		writeUsageEvent(stateRoot, {
			version: 1,
			id: "evt-usage-1",
			timestamp: new Date(Date.now() - 5_000).toISOString(),
			projectId: "test-project",
			surface: "tui",
			action: "idu-task",
		});

		const events = readColaDeAccionesFeed(stateRoot);
		assert.ok(events.length >= 2);
		// Verify the array is sorted DESC.
		for (let i = 1; i < events.length; i += 1) {
			const leftMs = Date.parse(events[i - 1].ts);
			const rightMs = Date.parse(events[i].ts);
			if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
				assert.ok(
					leftMs >= rightMs,
					`events should be sorted DESC; index ${i - 1} (${events[i - 1].ts}) should be >= index ${i} (${events[i].ts})`,
				);
			}
		}
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 14: formatColaDeAccionesFeed renders the empty-state marker
// for an empty list.
test("formatColaDeAccionesFeed renders the empty-state marker for an empty list", () => {
	const output = formatColaDeAccionesFeed([]);
	assert.match(output, /Cola de acciones \(0\)/u);
	assert.match(output, /sin eventos recientes/u);
});

// Test 15: formatColaDeAccionesFeed renders a header that includes
// the count and a sorted list of events with kind/summary/ts.
test("formatColaDeAccionesFeed renders the count header and rows with kind and ts", () => {
	const events = [
		{
			kind: "supervisor" as const,
			summary: "supervisor supervisor_tick/auto status=completed",
			ts: "2026-06-10T12:00:00.000Z",
			source: "idu-supervisor-activity-events.jsonl",
		},
		{
			kind: "agentlab" as const,
			summary: "agentlab security (test-project) status=completed",
			ts: "2026-06-10T11:00:00.000Z",
			source: "agentlabs/runs/current.json",
		},
	];
	const output = formatColaDeAccionesFeed(events);
	assert.match(output, /^Cola de acciones \(2\)/mu);
	assert.ok(output.includes("supervisor"));
	assert.ok(output.includes("agentlab"));
	// Etapa 4c.1: ts is now rendered in the operator's local time as
	// `YYYY-MM-DD HH:MM:SS` (not raw ISO with `Z`). Zone-agnostic: we
	// check both that the raw ISO no longer leaks AND that the new
	// local-time shape is present (the hour suffix depends on the
	// runner's timezone, so we match `\d{2}:00:00` which holds for
	// any of the 24-hour offsets the test fixtures produce).
	assert.ok(
		!/2026-06-10T1[12]:00:00\.000Z/.test(output),
		"raw ISO timestamp should not leak into the displayed feed",
	);
	assert.match(
		output,
		/2026-06-1\d \d{2}:00:00/,
		"expected local-time ts in `YYYY-MM-DD HH:MM:SS` format",
	);
});

// Test 16: formatColaDeAccionesFeed body NEVER contains the
// per-task action labels (👁 Ver / ✓ Aprobar / ✗ Rechazar) because
// the Cola de acciones is a read-only live feed.
test("formatColaDeAccionesFeed body never contains per-task action labels", () => {
	const events = [
		{
			kind: "supervisor" as const,
			summary: "supervisor tick — approve all the things",
			ts: "2026-06-10T12:00:00.000Z",
			source: "idu-supervisor-activity-events.jsonl",
		},
		{
			kind: "agentlab" as const,
			summary: "agentlab review (test-project) status=completed",
			ts: "2026-06-10T11:00:00.000Z",
			source: "agentlabs/runs/current.json",
		},
	];
	const output = formatColaDeAccionesFeed(events);
	assert.doesNotMatch(output, /👁 Ver/u);
	assert.doesNotMatch(output, /✓ Aprobar/u);
	assert.doesNotMatch(output, /✗ Rechazar/u);
});

// Test 17: paginateColaDeAccionesFeed paginates 50 events into 2
// pages of 30/20.
test("paginateColaDeAccionesFeed paginates 50 events into 2 pages of 30/20", () => {
	const events = Array.from({ length: 50 }, (_, i) => ({
		kind: "supervisor" as const,
		summary: `event ${i}`,
		ts: new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + i * 60_000).toISOString(),
		source: "idu-supervisor-activity-events.jsonl",
	}));
	const page0 = paginateColaDeAccionesFeed(events, 0, 30);
	assert.equal(page0.events.length, 30);
	assert.equal(page0.page.pageCount, 2);
	assert.equal(page0.page.pageIndex, 0);
	const page1 = paginateColaDeAccionesFeed(events, 1, 30);
	assert.equal(page1.events.length, 20);
	assert.equal(page1.page.pageIndex, 1);
});

// Test 18: COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT is positive.
test("COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT is a positive number", () => {
	assert.ok(COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT > 0);
});

// Test 19: readColaDeAccionesFeed ignores pi_compaction_detected
// events so the live feed stays focused on real activity.
test("readColaDeAccionesFeed ignores pi_compaction_detected events", () => {
	const stateRoot = tempDir();
	try {
		writeUsageEvent(stateRoot, {
			version: 1,
			id: "evt-compaction-1",
			timestamp: new Date().toISOString(),
			projectId: "test-project",
			surface: "cli",
			action: "compaction-noise",
			eventType: "pi_compaction_detected",
		});
		const events = readColaDeAccionesFeed(stateRoot);
		const triggerEvents = events.filter((e) => e.kind === "trigger");
		assert.equal(
			triggerEvents.length,
			0,
			`pi_compaction_detected should be filtered, got ${triggerEvents.length} trigger events`,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 20: readColaDeAccionesFeed combines multiple sources into a
// single sorted feed. The "supervisor" + "agentlab" + "trigger"
// kinds are all present and the merged array is sorted by ts DESC.
test("readColaDeAccionesFeed combines supervisor + agentlab + trigger into one sorted feed", () => {
	const stateRoot = tempDir();
	try {
		// 1 supervisor event (60s ago).
		writeSupervisorEvent(stateRoot, {
			version: 1,
			id: "evt-sup-1",
			timestamp: new Date(Date.now() - 60_000).toISOString(),
			projectId: "test-project",
			eventType: "supervisor_tick",
			origin: "supervisor_manual_tick",
			trigger: "manual",
			status: "completed",
		});
		// 1 trigger event (30s ago).
		writeUsageEvent(stateRoot, {
			version: 1,
			id: "evt-use-1",
			timestamp: new Date(Date.now() - 30_000).toISOString(),
			projectId: "test-project",
			surface: "mcp",
			action: "idu-supervisor-tick",
		});
		// 1 agentlab run (10s ago).
		const runDir = join(stateRoot, "agentlabs", "runs");
		mkdirSync(runDir, { recursive: true });
		const runResult = {
			generatedAt: new Date(Date.now() - 10_000).toISOString(),
			sourceRequestFile: "agentlabs/requests/current.json",
			warning: "Revisión AgentLab. No aplica cambios.",
			projectId: "test-project",
			runs: [
				{
					requestId: "req-001",
					specialty: "database",
					status: "completed",
					commandsExecuted: [],
					rawSummary: "No issues found",
					contractValidation: { valid: true, errors: [] },
					findings: [],
					recommendations: [],
					testsSuggested: [],
					requiresHumanApproval: false,
				},
			],
		};
		writeFileSync(
			join(runDir, "current.json"),
			`${JSON.stringify(runResult, null, 2)}\n`,
			"utf8",
		);

		const events = readColaDeAccionesFeed(stateRoot);
		assert.equal(events.length, 3, `expected 3 events, got ${events.length}`);
		const kinds = events.map((e) => e.kind);
		assert.ok(kinds.includes("supervisor"), "should include supervisor");
		assert.ok(kinds.includes("agentlab"), "should include agentlab");
		assert.ok(kinds.includes("trigger"), "should include trigger");
		// Sorted DESC: the agentlab event is the newest (10s ago),
		// the trigger event is 30s ago, the supervisor is 60s ago.
		assert.equal(events[0].kind, "agentlab");
		assert.equal(events[1].kind, "trigger");
		assert.equal(events[2].kind, "supervisor");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

// Test 21: paginateColaDeAccionesFeed clamps out-of-range page
// indices to the last page.
test("paginateColaDeAccionesFeed clamps out-of-range page index to the last page", () => {
	const events = Array.from({ length: 5 }, (_, i) => ({
		kind: "supervisor" as const,
		summary: `event ${i}`,
		ts: new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + i * 60_000).toISOString(),
		source: "idu-supervisor-activity-events.jsonl",
	}));
	const result = paginateColaDeAccionesFeed(events, 99, 30);
	assert.equal(result.page.pageIndex, 0);
	assert.equal(result.events.length, 5);
});

// Test 22: formatColaDeAccionesFeed is stable when the input is
// empty AND when the input has a single event.
test("formatColaDeAccionesFeed handles a single-event feed", () => {
	const events = [
		{
			kind: "trigger" as const,
			summary: "trigger fire: cli/idu-task",
			ts: "2026-06-10T12:00:00.000Z",
			source: "idu-usage-events.jsonl",
		},
	];
	const output = formatColaDeAccionesFeed(events);
	assert.match(output, /^Cola de acciones \(1\)/mu);
	assert.ok(output.includes("trigger fire: cli/idu-task"));
});
